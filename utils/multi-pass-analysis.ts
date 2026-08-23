import type { AnalysisResult } from '@/utils/openrouter';
import {
  RECOGNIZED_COMPONENT_TYPES,
  callTextWithFallback,
  callVisionWithFallback,
  parseJsonResult,
  withSingleScanBilling,
} from '@/utils/openrouter';
import { salvagePartialArrayField } from '@/utils/partial-json';
import { validateAnalysisConsistency } from '@/utils/schematic-validation';

// A single vision call has to identify components, resolve wire numbers only a
// few pixels tall, trace conductors through junctions, and serialize the lot as
// JSON — all under one max_tokens ceiling. Whatever it does last is what gets
// truncated, which is why a scan can report twenty wires and then produce two
// reading steps. Splitting the job gives each pass its own output budget and
// one thing to be good at.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Bounding box in normalized 0-1 image coordinates, top-left origin. */
export interface ImageRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Single point in normalized 0-1 image coordinates, top-left origin. */
export interface ImagePoint {
  x: number;
  y: number;
}

export interface DetectedComponent {
  id: string;
  type: string;
  label: string;
  description: string;
  isUnknown: boolean;
  confidence?: number;
  imageRegion?: ImageRegion;
}

export interface ComponentPassResult {
  components: DetectedComponent[];
  unknownSymbols: AnalysisResult['unknownSymbols'];
}

/**
 * One traced conductor, before anyone has tried to read the number printed on
 * it. `midpoint` is how the numbering pass finds this conductor on the page.
 */
export interface ConductorEdge {
  id: string;
  fromPoint: string;
  toPoint: string;
  midpoint?: ImagePoint;
  color?: string;
  voltage?: string;
  confidence?: number;
}

/** One piece of printed text that might be a wire number, and where it sits. */
export interface WireNumberToken {
  text: string;
  position?: ImagePoint;
  confidence?: number;
}

/**
 * Where the numbering pass gets its candidate numbers. Today the only
 * implementation is a vision call, but the tokens are plain text plus
 * coordinates — exactly what an on-device OCR engine produces. Swapping this
 * for OCR leaves the assignment step untouched and makes it text-only.
 */
export type WireNumberTokenSource = (edges: ConductorEdge[]) => Promise<WireNumberToken[]>;

export interface WireNumberAssignment {
  edgeId: string;
  label: string;
  confidence?: number;
}

export interface WireNumberPlacement {
  assignments: WireNumberAssignment[];
  /**
   * Numbers read off the drawing that no conductor would take. This is the
   * accuracy signal for the whole scan: a printed number with nowhere to go
   * almost always means the topology pass missed a conductor.
   */
  unplacedNumbers: string[];
}

export type MultiPassStage = 'components' | 'topology' | 'numbers';

export interface MultiPassCoverage {
  completedStages: MultiPassStage[];
  componentsFound: number;
  edgesTraced: number;
  numbersFound: number;
  numbersPlaced: number;
  unplacedNumbers: string[];
  /** Conductors that were traced but carry no number anyone could place. */
  unnumberedEdges: number;
  /** Set when a stage failed and the result is less than a full three-pass read. */
  degradedReason?: string;
}

/**
 * A normal AnalysisResult — every existing consumer works on it unchanged —
 * with the per-pass accounting the analyze screen needs to show how much of
 * the drawing actually made it through.
 */
export interface MultiPassAnalysisResult extends AnalysisResult {
  coverage: MultiPassCoverage;
}

export interface MultiPassOptions {
  /** Overrides the built-in vision reader; see WireNumberTokenSource. */
  wireNumberTokenSource?: WireNumberTokenSource;
}

// ---------------------------------------------------------------------------
// Pass 1 — components only
// ---------------------------------------------------------------------------

const COMPONENT_PASS_SYSTEM_PROMPT = `You are a senior electrical engineer cataloguing the components on an industrial wire schematic. This is one of three separate passes over the same drawing and it has exactly one job: find the components. Other passes handle the conductors and the wire numbers, so you do not have to.

CRITICAL INSTRUCTIONS:
1. IGNORE the wire numbers. Do not read the small numbers printed on or beside conductors, do not report them, and do not let one become a component label. A later pass reads them properly.
2. Report EVERY component symbol on the sheet, including repeats of the same type. Work through the drawing systematically — left to right, top to bottom — so nothing is skipped.
3. "label" is the designation printed next to the symbol, EXACTLY as printed (e.g. "CR1", "M1", "FU2"). If a symbol carries no printed designation, use an empty string — never invent one.
4. "type" must be one of the approved strings below, spelled exactly. If a symbol matches none of them, do NOT guess a type: leave it out of "components" and describe it under "unknownSymbols" instead.
5. "imageRegion" is the symbol's bounding box in normalized 0-1 coordinates measured from the top-left of the image. Later passes reason about position, so give it for every component.
6. "confidence" is 0.0-1.0: 1.0 = perfectly legible; 0.5 = partially obscured or ambiguous; 0.0 = completely unclear.
7. "description" is one short line a field electrician would find useful — rating, function, or circuit role — not a restatement of the type.

${RECOGNIZED_COMPONENT_TYPES}

Return ONLY a valid JSON object — NO markdown, NO code fences, NO comments:
{
  "components": [{ "id": "c1", "type": "relay", "label": "CR1", "description": "Control relay coil, 120VAC, 10A contacts", "isUnknown": false, "confidence": 0.98, "imageRegion": { "x": 0.31, "y": 0.22, "width": 0.06, "height": 0.09 } }],
  "unknownSymbols": [{ "id": "u1", "description": "Upper-right quadrant: inverted triangle with horizontal line, possibly voltage reference or specialty sensor", "imageRegion": { "x": 0.75, "y": 0.1, "width": 0.1, "height": 0.08 } }]
}`;

// The approved list lives in the shared prompt as prose. Parsing it back into a
// set lets a returned type be checked against it instead of trusted, so a
// model that invents "motor-contactor" gets flagged rather than passed through
// as though it were a recognized type.
const APPROVED_COMPONENT_TYPES = new Set(
  RECOGNIZED_COMPONENT_TYPES.split(/\r?\n/)
    .slice(1)
    .join(' ')
    .split(',')
    .map((type) => type.trim().toLowerCase())
    .filter((type) => type.length > 0)
);

export async function detectComponents(imageUrl: string): Promise<ComponentPassResult> {
  const prompt = 'Catalogue every component symbol on this electrical schematic. Ignore the wire numbers entirely.';
  const content = await callVisionWithFallback(imageUrl, prompt, COMPONENT_PASS_SYSTEM_PROMPT);
  const result = parseComponentPass(content);
  console.log('[MultiPass] Component pass complete', {
    components: result.components.length,
    unknownSymbols: result.unknownSymbols.length,
  });
  return result;
}

function parseComponentPass(content: string): ComponentPassResult {
  try {
    const parsed = parseJsonResult<{ components?: unknown[]; unknownSymbols?: unknown[] }>(content, 'componentPass');
    return {
      components: normalizeComponents(parsed.components ?? []),
      unknownSymbols: normalizeUnknownSymbols(parsed.unknownSymbols ?? []),
    };
  } catch (error) {
    const components = normalizeComponents(salvagePartialArrayField(content, 'components'));
    if (components.length === 0) throw error;
    console.warn('[MultiPass] Component pass response was cut off — salvaged partial list', {
      components: components.length,
    });
    return {
      components,
      unknownSymbols: normalizeUnknownSymbols(salvagePartialArrayField(content, 'unknownSymbols')),
    };
  }
}

function normalizeComponents(raw: unknown[]): DetectedComponent[] {
  return raw
    .map((entry) => entry as Record<string, unknown>)
    .filter((entry) => !!entry && (coerceString(entry.label) !== '' || coerceString(entry.type) !== ''))
    .map((entry, index) => {
      const type = coerceString(entry.type);
      return {
        id: `c${index + 1}`,
        type,
        label: coerceString(entry.label),
        description: coerceString(entry.description),
        isUnknown: entry.isUnknown === true || !APPROVED_COMPONENT_TYPES.has(type.toLowerCase()),
        confidence: coerceConfidence(entry.confidence),
        imageRegion: coerceRegion(entry.imageRegion),
      };
    });
}

function normalizeUnknownSymbols(raw: unknown[]): AnalysisResult['unknownSymbols'] {
  return raw
    .map((entry) => entry as Record<string, unknown>)
    .filter((entry) => !!entry && coerceString(entry.description) !== '')
    .map((entry, index) => ({
      id: `u${index + 1}`,
      description: coerceString(entry.description),
      imageRegion: coerceRegion(entry.imageRegion),
    }));
}

// ---------------------------------------------------------------------------
// Pass 2 — point-to-point topology, numbers ignored
// ---------------------------------------------------------------------------

const TOPOLOGY_PASS_SYSTEM_PROMPT = `You are tracing the conductors on an industrial wire schematic. This is one of three separate passes over the same drawing. The components have already been catalogued and are given to you below. A different pass reads the printed wire numbers.

Following a line from one symbol to another is a SHAPE task, not a reading task. You do not need to resolve any small printed text to do it — you follow the drawn line. So IGNORE the wire numbers completely. Guessing at a six-pixel-tall number here corrupts the tracing, which is the one thing this pass exists to get right.

CRITICAL INSTRUCTIONS:
1. Report one edge per conductor: the terminal it leaves and the terminal it arrives at. Use full terminal designations ("TB1-1", "CR1-A1"), never a bare pin number.
2. Component labels MUST be reused VERBATIM from the list below — same spelling, same case, same punctuation, same spacing. A later pass joins on these exact strings, so writing "CR-1" where the list says "CR1", or "Relay CR1" where the list says "CR1", silently loses that conductor. Copy, do not paraphrase, and do not tidy up a label you think looks wrong.
3. If a conductor lands on something that is NOT in the component list, do not rename an existing component to cover it. Describe what you see in "note" on that edge and use your best plain designation for the endpoint.
4. "midpoint" is roughly halfway along the drawn conductor, in normalized 0-1 coordinates from the top-left of the image. It is how the numbering pass locates this conductor, so give it for EVERY edge.
5. A conductor that runs off the edge of the sheet still counts. Give the terminal you can see and set the other end to an empty string "" — never drop the conductor and never invent the far end.
6. Where a conductor meets a junction dot and splits, report each branch as its own edge.
7. Only set "color" when the conductor is actually drawn in that color or a color abbreviation is printed beside it ("BLK", "RD", "BLU"). NEVER infer a color from voltage, polarity, AC vs DC, or what the conductor does.
8. Only set "voltage" when a printed label or the circuit's power source makes it explicit.
9. "confidence" is 0.0-1.0 for how certain you are that this conductor runs between these two terminals.

Return ONLY a valid JSON object — NO markdown, NO code fences, NO comments:
{
  "edges": [{ "id": "e1", "fromPoint": "TB1-1", "toPoint": "CR1-A1", "midpoint": { "x": 0.42, "y": 0.31 }, "voltage": "120VAC", "confidence": 0.93 }, { "id": "e2", "fromPoint": "TB1-3", "toPoint": "", "midpoint": { "x": 0.08, "y": 0.62 }, "confidence": 0.7, "note": "runs off the left edge of the sheet" }]
}`;

export async function traceConductorEdges(
  imageUrl: string,
  components: DetectedComponent[]
): Promise<ConductorEdge[]> {
  const prompt = `Trace every conductor on this schematic and report which terminal connects to which terminal. Ignore the printed wire numbers.

Components already catalogued on this drawing — reuse these labels verbatim:
${JSON.stringify(components.map((c) => ({ label: c.label, type: c.type, imageRegion: c.imageRegion })))}`;

  const content = await callVisionWithFallback(imageUrl, prompt, TOPOLOGY_PASS_SYSTEM_PROMPT);
  const edges = parseTopologyPass(content, components);
  console.log('[MultiPass] Topology pass complete', { edges: edges.length });
  return edges;
}

function parseTopologyPass(content: string, components: DetectedComponent[]): ConductorEdge[] {
  let raw: unknown[];
  try {
    raw = parseJsonResult<{ edges?: unknown[] }>(content, 'topologyPass').edges ?? [];
  } catch (error) {
    raw = salvagePartialArrayField(content, 'edges');
    if (raw.length === 0) throw error;
    console.warn('[MultiPass] Topology pass response was cut off — salvaged partial edge list', { edges: raw.length });
  }
  return normalizeEdges(raw, components);
}

function normalizeEdges(raw: unknown[], components: DetectedComponent[]): ConductorEdge[] {
  const catalog = buildComponentCatalog(components);
  return raw
    .map((entry) => entry as Record<string, unknown>)
    .map((entry) => ({
      fromPoint: snapEndpointToCatalog(coerceString(entry?.fromPoint), catalog),
      toPoint: snapEndpointToCatalog(coerceString(entry?.toPoint), catalog),
      midpoint: coercePoint(entry?.midpoint),
      color: coerceString(entry?.color) || undefined,
      voltage: coerceString(entry?.voltage) || undefined,
      confidence: coerceConfidence(entry?.confidence),
    }))
    // A conductor with neither end identified is not something a field
    // electrician can act on, and it would pull a wire number away from an edge
    // that is real.
    .filter((edge) => edge.fromPoint !== '' || edge.toPoint !== '')
    // Ids are reassigned rather than taken from the response: the numbering
    // pass joins on them, and a model that repeats "e1" would collapse two
    // conductors into one.
    .map((edge, index) => ({ id: `e${index + 1}`, ...edge }));
}

function buildComponentCatalog(components: DetectedComponent[]): Map<string, string> {
  const catalog = new Map<string, string>();
  components.forEach((component) => {
    const key = canonicalKey(component.label);
    if (key && !catalog.has(key)) catalog.set(key, component.label);
  });
  return catalog;
}

function canonicalKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

/**
 * Pass 2 is told to reuse pass 1's labels verbatim because pass 3 and every
 * downstream consumer join on those strings. Models drift anyway — "cr-1" for
 * "CR1", "TB 1-3" for "TB1-3" — so an endpoint is snapped back onto the
 * catalogued spelling whenever the only difference is case or punctuation.
 */
function snapEndpointToCatalog(point: string, catalog: Map<string, string>): string {
  const trimmed = point.trim();
  if (!trimmed) return '';

  const whole = catalog.get(canonicalKey(trimmed));
  if (whole) return whole;

  // Terminal designations read "<component>-<pin>", and a component label can
  // itself contain a dash, so the longest matching prefix wins.
  for (let dash = trimmed.lastIndexOf('-'); dash > 0; dash = trimmed.lastIndexOf('-', dash - 1)) {
    const component = catalog.get(canonicalKey(trimmed.slice(0, dash)));
    if (component) return `${component}-${trimmed.slice(dash + 1).trim()}`;
  }

  return trimmed;
}

// ---------------------------------------------------------------------------
// Pass 3 — assign wire numbers to traced conductors
// ---------------------------------------------------------------------------

const NUMBER_READING_SYSTEM_PROMPT = `You are reading the printed wire numbers off an industrial wire schematic. This is one of three separate passes over the same drawing and it has exactly one job: report the small numbers that label conductors, and where on the page each one sits. Other passes have already identified the components and traced the conductors, so you do not have to.

These numbers are printed small — a few pixels tall — and resolving them is the whole task. Zoom your attention onto the text itself rather than the circuit.

CRITICAL INSTRUCTIONS:
1. Report every number printed ON a conductor or immediately beside one, exactly as printed, including any letter prefix or suffix ("14", "L1", "22A").
2. "position" is the centre of the printed text in normalized 0-1 coordinates measured from the top-left of the image.
3. Report each printed occurrence separately. The same number often appears several times along one run — that is expected and useful. Do not deduplicate.
4. These are NOT wire numbers. Never report them:
   - rung or line numbers running down the left margin of a ladder diagram
   - cross-reference numbers pointing at another rung, sheet, or drawing
   - the pin part of a terminal designation (the "3" in "TB1-3")
   - the number inside a component label ("CR1", "FU2", "OL1")
   - item balloons or bill-of-materials callouts
   - sheet, page, revision, or drawing numbers, and dimension callouts
5. If a number is too small or too blurred to read cleanly, still report it with your best reading and a low "confidence". A flagged guess is worth more to an electrician than a silent omission.

Return ONLY a valid JSON object — NO markdown, NO code fences, NO comments:
{
  "numbers": [{ "text": "14", "position": { "x": 0.41, "y": 0.29 }, "confidence": 0.9 }, { "text": "22A", "position": { "x": 0.63, "y": 0.48 }, "confidence": 0.55 }]
}`;

const NUMBER_ASSIGNMENT_SYSTEM_PROMPT = `You are matching printed wire numbers to the conductors they label on an electrical schematic. Both lists were extracted for you — you are not looking at the drawing and do not need to.

Every conductor has a midpoint in normalized 0-1 image coordinates. Every number has the position it was printed at, in the same coordinate space. A number labels the conductor it sits on or nearest to. Proximity is the main signal, but a number printed along a long run can sit well away from that run's midpoint, so prefer a plausible geometric fit over a blind nearest-neighbour match.

CRITICAL INSTRUCTIONS:
1. Assign at most one number to each conductor, and use "edgeId" values from the conductor list verbatim.
2. The same number printed several times along one run is ONE wire. Assign it once; the repeats are then accounted for and are not leftovers.
3. Do NOT force a match. A conductor you cannot confidently number is simply left out of "assignments" — an unnumbered conductor is a correct answer and a wrong number is not.
4. Every distinct number you did not assign goes in "unplacedNumbers", exactly as printed. A number with nowhere to go usually means a conductor was missed upstream, so never quietly drop one to make the output look tidy.
5. "confidence" is 0.0-1.0 for how sure you are that this number belongs to this conductor.

Return ONLY a valid JSON object — NO markdown, NO code fences, NO comments:
{
  "assignments": [{ "edgeId": "e1", "label": "14", "confidence": 0.92 }],
  "unplacedNumbers": ["27"]
}`;

/**
 * The default token source: one vision call whose only output is text plus
 * coordinates. An on-device OCR engine producing the same tokens drops in
 * here and removes this call entirely.
 */
export function createVisionWireNumberSource(imageUrl: string): WireNumberTokenSource {
  return async () => {
    const prompt = 'Read every printed wire number on this schematic and report where each one sits on the page.';
    const content = await callVisionWithFallback(imageUrl, prompt, NUMBER_READING_SYSTEM_PROMPT);
    const tokens = parseWireNumberTokens(content);
    console.log('[MultiPass] Wire numbers read', { tokens: tokens.length });
    return tokens;
  };
}

function parseWireNumberTokens(content: string): WireNumberToken[] {
  let raw: unknown[];
  try {
    raw = parseJsonResult<{ numbers?: unknown[] }>(content, 'wireNumberPass').numbers ?? [];
  } catch (error) {
    raw = salvagePartialArrayField(content, 'numbers');
    if (raw.length === 0) throw error;
    console.warn('[MultiPass] Wire number response was cut off — salvaged partial token list', { tokens: raw.length });
  }
  return raw
    .map((entry) => entry as Record<string, unknown>)
    .map((entry) => ({
      text: coerceString(entry?.text),
      position: coercePoint(entry?.position),
      confidence: coerceConfidence(entry?.confidence),
    }))
    .filter((token) => token.text !== '');
}

/**
 * Pass 3. Text-only once the tokens are in hand, which is what makes the OCR
 * swap worth designing for — with on-device OCR this whole pass costs one cheap
 * text call and no vision call at all.
 */
export async function assignWireNumbers(
  edges: ConductorEdge[],
  tokenSource: WireNumberTokenSource
): Promise<WireNumberPlacement> {
  const tokens = await tokenSource(edges);
  if (tokens.length === 0 || edges.length === 0) {
    return { assignments: [], unplacedNumbers: distinctNumbers(tokens) };
  }

  const userMessage = `Conductors traced on this schematic:
${JSON.stringify(edges.map((e) => ({ edgeId: e.id, fromPoint: e.fromPoint, toPoint: e.toPoint, midpoint: e.midpoint })))}

Wire numbers read off the same drawing:
${JSON.stringify(tokens)}

Match each number to the conductor it labels.`;

  const content = await callTextWithFallback(
    [
      { role: 'system', content: NUMBER_ASSIGNMENT_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    4096
  );

  const assignments = parseAssignments(content, edges);
  const placement = {
    assignments,
    // The model is asked for its own leftovers because accounting for them
    // makes it assign more carefully, but the list that ships is derived from
    // the tokens it was actually given. A model under-reporting leftovers is
    // exactly the failure this signal exists to catch.
    unplacedNumbers: distinctNumbers(tokens).filter(
      (number) => !assignments.some((a) => normalizeNumber(a.label) === normalizeNumber(number))
    ),
  };
  console.log('[MultiPass] Number assignment complete', {
    tokens: tokens.length,
    assigned: placement.assignments.length,
    unplaced: placement.unplacedNumbers.length,
  });
  return placement;
}

function parseAssignments(content: string, edges: ConductorEdge[]): WireNumberAssignment[] {
  let raw: unknown[];
  try {
    raw = parseJsonResult<{ assignments?: unknown[] }>(content, 'numberAssignment').assignments ?? [];
  } catch (error) {
    raw = salvagePartialArrayField(content, 'assignments');
    if (raw.length === 0) throw error;
    console.warn('[MultiPass] Assignment response was cut off — salvaged partial list', { assignments: raw.length });
  }

  const edgeIds = new Set(edges.map((e) => e.id));
  const claimed = new Set<string>();
  return raw
    .map((entry) => entry as Record<string, unknown>)
    .map((entry) => ({
      edgeId: coerceString(entry?.edgeId),
      label: coerceString(entry?.label),
      confidence: coerceConfidence(entry?.confidence),
    }))
    .filter((assignment) => {
      // An id that isn't ours, or a second number for a conductor that already
      // has one, is a hallucinated join — dropping it turns into an unplaced
      // number, which is visible, instead of a wrong number read aloud.
      if (!assignment.label || !edgeIds.has(assignment.edgeId)) return false;
      if (claimed.has(assignment.edgeId)) return false;
      claimed.add(assignment.edgeId);
      return true;
    });
}

function normalizeNumber(value: string): string {
  return value.trim().replace(/^wire\s+/i, '').toUpperCase();
}

function distinctNumbers(tokens: WireNumberToken[]): string[] {
  const seen = new Set<string>();
  const numbers: string[] = [];
  tokens.forEach((token) => {
    const key = normalizeNumber(token.text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    numbers.push(token.text.trim());
  });
  return numbers;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

// A sheet whose conductors include one numbered "1" or "L1" has an obvious
// place to begin reading. The single-pass prompt asks the model to judge this;
// here it falls out of the data, so nothing has to be trusted for it.
const OBVIOUS_START_LABELS = new Set(['1', '01', 'L1', 'L-1']);

function describeEdge(edge: ConductorEdge, label: string): string {
  const subject = label ? `Wire ${label}` : 'Unnumbered conductor';
  if (edge.fromPoint && edge.toPoint) return `${subject} from ${edge.fromPoint} to ${edge.toPoint}.`;
  const known = edge.fromPoint || edge.toPoint;
  return `${subject} at ${known} — the other end runs off the sheet.`;
}

function buildSummary(
  components: DetectedComponent[],
  wireCount: number,
  edgeCount: number,
  unplacedNumbers: string[]
): string {
  const typeCounts = new Map<string, number>();
  components.forEach((component) => {
    const type = component.type || 'unidentified symbol';
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  });
  const breakdown = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([type, count]) => `${count} ${type}`)
    .join(', ');

  const parts = [
    `${components.length} component${components.length === 1 ? '' : 's'}${breakdown ? ` (${breakdown})` : ''}`,
    `${edgeCount} conductor${edgeCount === 1 ? '' : 's'} traced`,
    `${wireCount} carrying a printed wire number`,
  ];
  const summary = `${parts.join(', ')}.`;
  if (unplacedNumbers.length === 0) return summary;
  return `${summary} ${unplacedNumbers.length} printed number${
    unplacedNumbers.length === 1 ? '' : 's'
  } could not be matched to a conductor: ${unplacedNumbers.join(', ')}.`;
}

function assembleAnalysis(
  pass1: ComponentPassResult,
  edges: ConductorEdge[],
  placement: WireNumberPlacement,
  completedStages: MultiPassStage[],
  degradedReason?: string
): MultiPassAnalysisResult {
  const labelByEdgeId = new Map(placement.assignments.map((a) => [a.edgeId, a]));

  const wires: AnalysisResult['wires'] = [];
  const connections: AnalysisResult['connections'] = [];

  edges.forEach((edge) => {
    const assignment = labelByEdgeId.get(edge.id);
    const label = assignment?.label ?? '';
    if (label) {
      wires.push({
        id: edge.id,
        label,
        color: edge.color,
        // Non-optional downstream, and consumers call .trim() on them — an
        // off-sheet end is an empty string, never undefined.
        fromPoint: edge.fromPoint,
        toPoint: edge.toPoint,
        voltage: edge.voltage,
        confidence: combineConfidence(edge.confidence, assignment?.confidence),
      });
    }
    // Unnumbered conductors stay out of wires[] — wire labels are the identity
    // key the reader, custom order, and scoring all join on, so a run of blanks
    // would collide. They are still real conductors, so they are reported here
    // and counted in coverage rather than dropped.
    connections.push({
      id: `conn${connections.length + 1}`,
      from: edge.fromPoint,
      to: edge.toPoint,
      wireLabel: label,
      description: describeEdge(edge, label),
    });
  });

  const unnumberedEdges = edges.length - wires.length;
  const warnings: string[] = [];
  if (degradedReason) warnings.push(degradedReason);
  if (placement.unplacedNumbers.length > 0) {
    warnings.push(
      `${placement.unplacedNumbers.length} printed wire number(s) couldn't be matched to a traced conductor: ${placement.unplacedNumbers.join(
        ', '
      )}. A number with nowhere to go usually means a conductor was missed — check those on the drawing.`
    );
  }
  if (unnumberedEdges > 0) {
    warnings.push(
      `${unnumberedEdges} conductor(s) were traced but no printed number could be read for them. They're listed under connections without a wire number, so they won't be read aloud until you add one.`
    );
  }

  const result: MultiPassAnalysisResult = {
    wires,
    components: pass1.components.map((component) => ({
      id: component.id,
      type: component.type,
      label: component.label,
      description: component.description,
      isUnknown: component.isUnknown,
      confidence: component.confidence,
    })),
    connections,
    unknownSymbols: pass1.unknownSymbols,
    summary: buildSummary(pass1.components, wires.length, edges.length, placement.unplacedNumbers),
    startPointAmbiguous: !wires.some((wire) => OBVIOUS_START_LABELS.has(normalizeNumber(wire.label))),
    coverage: {
      completedStages,
      componentsFound: pass1.components.length,
      edgesTraced: edges.length,
      numbersFound: placement.assignments.length + placement.unplacedNumbers.length,
      numbersPlaced: placement.assignments.length,
      unplacedNumbers: placement.unplacedNumbers,
      unnumberedEdges,
      degradedReason,
    },
  };

  result.validationWarnings = [...warnings, ...validateAnalysisConsistency(result)];
  return result;
}

function combineConfidence(...values: (number | undefined)[]): number | undefined {
  const present = values.filter((value): value is number => typeof value === 'number');
  return present.length > 0 ? Math.min(...present) : undefined;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Drop-in alternative to analyzeSchematic: same call shape, and the result is
 * an AnalysisResult with the per-pass coverage numbers added, so the reader,
 * analyze screen, validation, and storage all work on it unchanged.
 *
 * Off by default — UIPreferences.multiPassAnalysis gates it.
 */
export async function analyzeSchematicMultiPass(
  base64Image: string,
  options: MultiPassOptions = {}
): Promise<MultiPassAnalysisResult> {
  console.log('[MultiPass] analyzeSchematicMultiPass called, image size:', base64Image.length);

  const imageUrl = `data:image/jpeg;base64,${base64Image}`;
  const tokenSource = options.wireNumberTokenSource ?? createVisionWireNumberSource(imageUrl);

  // Several vision calls, one schematic, one free scan. Everything the three
  // passes do happens inside this session so the allowance is charged once.
  return withSingleScanBilling(async () => {
    const completedStages: MultiPassStage[] = [];

    // Pass 1 is the floor: without components there is nothing to trace against
    // and nothing worth showing, so a failure here is a failure of the scan.
    const pass1 = await detectComponents(imageUrl);
    completedStages.push('components');

    let edges: ConductorEdge[] = [];
    let degradedReason: string | undefined;

    try {
      edges = await traceConductorEdges(imageUrl, pass1.components);
      completedStages.push('topology');
    } catch (error) {
      // Sixty seconds in with a component list in hand, handing back an error
      // is the worst available answer. Ship what pass 1 found and say plainly
      // what is missing from it.
      degradedReason = `Conductor tracing failed (${errorMessage(
        error
      )}), so this scan is a component list only — no wires or connections were traced. Scan again to retry the full read.`;
      console.error('[MultiPass] Topology pass failed — degrading to components only', error);
    }

    let placement: WireNumberPlacement = { assignments: [], unplacedNumbers: [] };
    if (edges.length > 0) {
      try {
        placement = await assignWireNumbers(edges, tokenSource);
        completedStages.push('numbers');
      } catch (error) {
        degradedReason = `Reading the printed wire numbers failed (${errorMessage(
          error
        )}), so the components and the conductor paths are here but the conductors are unnumbered. Scan again to retry, or add the numbers by hand.`;
        console.error('[MultiPass] Number pass failed — degrading to unnumbered topology', error);
      }
    }

    const result = assembleAnalysis(pass1, edges, placement, completedStages, degradedReason);
    console.log('[MultiPass] analyzeSchematicMultiPass complete', result.coverage);
    if (result.validationWarnings && result.validationWarnings.length > 0) {
      console.warn('[MultiPass] validation warnings', result.validationWarnings);
    }
    return result;
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Shared coercion
// ---------------------------------------------------------------------------

function coerceString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function coerceConfidence(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

function coercePoint(value: unknown): ImagePoint | undefined {
  const point = value as { x?: unknown; y?: unknown } | null | undefined;
  if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') return undefined;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
  return { x: point.x, y: point.y };
}

function coerceRegion(value: unknown): ImageRegion | undefined {
  const region = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | null | undefined;
  if (!region) return undefined;
  const { x, y, width, height } = region;
  if ([x, y, width, height].some((n) => typeof n !== 'number' || !Number.isFinite(n))) return undefined;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}
