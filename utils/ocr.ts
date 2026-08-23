import { Image } from 'react-native';
import type { ConductorEdge, WireNumberTokenSource } from '@/utils/multi-pass-analysis';

// prepareImageForAI caps the long edge at 2576px before anything is uploaded,
// so a 4000x3000 phone photo loses roughly 40% of its linear detail before the
// vision model ever sees it — and wire numbers are the first thing to go, being
// only a few pixels tall to begin with. On-device recognition has no token cost
// and no upload, so it reads the ORIGINAL file at native resolution instead.
// That asymmetry is the whole reason this module exists: point it at the
// resized copy and it is worth nothing.
//
// ML Kit is loaded lazily and every failure is swallowed. OCR is an accuracy
// aid, never a dependency — a scan has to complete on a build where the native
// module isn't present at all.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Bounding box in normalized 0-1 image coordinates, top-left origin. */
export interface OcrBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One recognized word. Coordinates are normalized so they can be compared
 * against the vision model's normalized output without either side needing to
 * know what resolution the other worked at.
 */
export interface OcrToken {
  text: string;
  box: OcrBox;
  /** Centre of `box`, which is what the numbering pass matches conductors on. */
  center: { x: number; y: number };
  /** Full text of the line this word sits in — context the word alone loses. */
  lineText: string;
}

export interface OcrResult {
  tokens: OcrToken[];
  /** Pixel size of the file that was actually read, before any downscaling. */
  sourceWidth: number;
  sourceHeight: number;
  /** False when the native module is missing or the read failed. */
  available: boolean;
}

// Shape of the ML Kit response. Declared here rather than imported so this file
// still typechecks on a machine where the package hasn't been installed yet.
interface MlKitRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface MlKitText {
  blocks?: {
    lines?: {
      text?: string;
      frame?: MlKitRect;
      elements?: { text?: string; frame?: MlKitRect }[];
    }[];
  }[];
}

interface TextRecognitionModule {
  recognizeText(imagePath: string): Promise<MlKitText>;
}

const EMPTY_RESULT: OcrResult = { tokens: [], sourceWidth: 0, sourceHeight: 0, available: false };

// ---------------------------------------------------------------------------
// Native module access
// ---------------------------------------------------------------------------

let modulePromise: Promise<TextRecognitionModule | null> | undefined;
let lastRead: { uri: string; result: OcrResult } | undefined;

/**
 * The package resolves its native module at import time, so a plain top-level
 * import throws on web and on any binary built before OCR was added. Loading it
 * through a cached dynamic import keeps that failure inside a promise we can
 * catch, and keeps it to one attempt per session rather than one per scan.
 */
function loadTextRecognition(): Promise<TextRecognitionModule | null> {
  if (!modulePromise) {
    modulePromise = import('@infinitered/react-native-mlkit-text-recognition')
      .then((loaded) => {
        const mod = loaded as unknown as TextRecognitionModule;
        if (typeof mod?.recognizeText !== 'function') {
          console.warn('[OCR] Text recognition module loaded but exposes no recognizeText — OCR disabled');
          return null;
        }
        return mod;
      })
      .catch((error) => {
        console.warn('[OCR] Text recognition unavailable in this build — continuing without it', error);
        return null;
      });
  }
  return modulePromise;
}

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

// ---------------------------------------------------------------------------
// Recognition
// ---------------------------------------------------------------------------

/**
 * Reads every word ML Kit can find in the image at `uri`, at whatever
 * resolution the file is stored at. Pass the ORIGINAL camera/library URI here,
 * never the resized copy prepareImageForAI produces.
 *
 * Never throws: an unavailable native module, an unreadable file, or a recognizer
 * error all come back as an empty result with `available: false`.
 */
export async function recognizeTextInImage(uri: string): Promise<OcrResult> {
  // One scan reads the same file twice — once to number the conductors, once to
  // score how much the numbering missed — and a full-resolution read is the
  // expensive part. Only the newest URI is kept: a photo is written once and
  // never revisited, so anything older is dead weight.
  if (lastRead && lastRead.uri === uri) return lastRead.result;

  const recognizer = await loadTextRecognition();
  if (!recognizer) return EMPTY_RESULT;

  try {
    const [recognized, reported] = await Promise.all([recognizer.recognizeText(uri), getImageSize(uri)]);
    const words = collectWords(recognized);
    const { width, height } = resolveSourceSize(reported, words);
    if (width <= 0 || height <= 0) {
      console.warn('[OCR] Could not determine the source image size — skipping OCR for this image');
      return EMPTY_RESULT;
    }

    const tokens = words
      .map((word) => toToken(word, width, height))
      .filter((token): token is OcrToken => token !== null);

    console.log('[OCR] Read image', { source: `${width}x${height}`, words: words.length, tokens: tokens.length });
    const result: OcrResult = { tokens, sourceWidth: width, sourceHeight: height, available: true };
    lastRead = { uri, result };
    return result;
  } catch (error) {
    console.error('[OCR] Text recognition failed — continuing without it', error);
    return EMPTY_RESULT;
  }
}

interface RecognizedWord {
  text: string;
  frame: MlKitRect;
  lineText: string;
}

function collectWords(recognized: MlKitText): RecognizedWord[] {
  const words: RecognizedWord[] = [];
  (recognized?.blocks ?? []).forEach((block) => {
    (block?.lines ?? []).forEach((line) => {
      const lineText = typeof line?.text === 'string' ? line.text : '';
      const elements = line?.elements ?? [];
      // Word-level boxes are what a wire number needs — a line box around
      // "14 TB1-3" points at neither. A line with no elements still carries its
      // own frame, so fall back to that rather than losing the text.
      const parts = elements.length > 0 ? elements : [{ text: lineText, frame: line?.frame }];
      parts.forEach((part) => {
        const text = typeof part?.text === 'string' ? part.text.trim() : '';
        if (!text || !isRect(part?.frame)) return;
        words.push({ text, frame: part.frame, lineText });
      });
    });
  });
  return words;
}

function isRect(value: unknown): value is MlKitRect {
  const rect = value as MlKitRect | null | undefined;
  if (!rect) return false;
  return [rect.left, rect.top, rect.right, rect.bottom].every((n) => typeof n === 'number' && Number.isFinite(n));
}

/**
 * ML Kit reports boxes in the coordinate space of the image after EXIF rotation
 * has been applied; Image.getSize does not always agree about which way round a
 * rotated photo is. When the reported size can't contain the boxes but the
 * swapped one can, the reported size is the one that's wrong.
 */
function resolveSourceSize(
  reported: { width: number; height: number },
  words: RecognizedWord[]
): { width: number; height: number } {
  const { width, height } = reported;
  if (words.length === 0 || width <= 0 || height <= 0) return reported;

  const maxRight = Math.max(...words.map((word) => word.frame.right));
  const maxBottom = Math.max(...words.map((word) => word.frame.bottom));
  const fits = maxRight <= width && maxBottom <= height;
  const swappedFits = maxRight <= height && maxBottom <= width;
  if (!fits && swappedFits) {
    console.log('[OCR] Source dimensions were reported unrotated — swapping', { reported: `${width}x${height}` });
    return { width: height, height: width };
  }
  return reported;
}

function toToken(word: RecognizedWord, width: number, height: number): OcrToken | null {
  const left = clamp01(word.frame.left / width);
  const top = clamp01(word.frame.top / height);
  const right = clamp01(word.frame.right / width);
  const bottom = clamp01(word.frame.bottom / height);
  if (right <= left || bottom <= top) return null;

  const box: OcrBox = { x: left, y: top, width: right - left, height: bottom - top };
  return {
    text: word.text,
    box,
    center: { x: left + box.width / 2, y: top + box.height / 2 },
    lineText: word.lineText,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

// ---------------------------------------------------------------------------
// Wire-number candidates
// ---------------------------------------------------------------------------

// A wire number is a short run of digits, optionally with one letter in front
// ("L1", "X2") or a suffix letter or two ("22A"). Two or more leading letters
// is a component designation — "CR1", "FU2", "TB1", "OL1" — and the digit in
// one of those is not a wire number.
const WIRE_NUMBER_SHAPE = /^[A-Z]?\d{1,4}[A-Z]{0,2}$/;

// Numbers printed in a title block or a note are sheet, revision, drawing,
// scale or dimension numbers. The word next to them gives them away, which is
// why tokens carry the whole line they came from.
const NON_WIRE_LINE_CONTEXT = /\b(SHEET|SHT|SH|PAGE|PG|OF|REV|REVISION|DWG|DRAWING|SCALE|DATE|TITLE|JOB|PROJECT|P\/N|PART|ITEM|QTY|BOM|APPROVED|DRAWN|CHECKED)\b/;

// Title blocks sit in a corner and are dense with numbers that are never
// wires. Bottom-right is the ANSI/ISO convention; a drawing that puts it
// elsewhere is handled by passing excludeRegions.
const DEFAULT_EXCLUDED_REGIONS: OcrBox[] = [{ x: 0.72, y: 0.84, width: 0.28, height: 0.16 }];

// Rung numbers run down the far-left margin of a ladder diagram. They number
// the rung, not a conductor.
const DEFAULT_RUNG_MARGIN_WIDTH = 0.055;

// Wire numbers are printed small. Anything taller than this is a heading, a
// title, or a sheet number set in title-block type.
const DEFAULT_MAX_TOKEN_HEIGHT = 0.05;

export interface WireNumberFilterOptions {
  /**
   * Component labels already catalogued for this drawing. A token matching one
   * of them is a component designation, not a wire number — and unlike every
   * other rule here, that one is a fact rather than a guess.
   */
  componentLabels?: string[];
  /** Normalized regions to discard entirely, e.g. a title block. */
  excludeRegions?: OcrBox[];
  /** Left-margin fraction treated as ladder rung numbering. 0 disables it. */
  rungMarginWidth?: number;
  /** Tokens taller than this fraction of the image are not wire numbers. */
  maxTokenHeight?: number;
}

/**
 * Narrows a raw OCR read down to the tokens that could plausibly be wire
 * numbers, mirroring the exclusions the analysis prompt gives the vision model:
 * rung numbers, cross-references, the pin half of "TB1-3", the digit inside
 * "CR1", item balloons, and sheet/revision/dimension numbers are all dropped.
 *
 * The bias is toward keeping a doubtful token: a false candidate costs one
 * unmatched label in the coverage report, while a dropped one is a wire nobody
 * ever finds out was missed. An item balloon that is just a bare digit in open
 * space is the one exclusion that can't be reproduced from text alone — nothing
 * in the token distinguishes it from a wire number, so it survives here.
 */
export function filterWireNumberCandidates(result: OcrResult, options: WireNumberFilterOptions = {}): OcrToken[] {
  const excludeRegions = options.excludeRegions ?? DEFAULT_EXCLUDED_REGIONS;
  const rungMarginWidth = options.rungMarginWidth ?? DEFAULT_RUNG_MARGIN_WIDTH;
  const maxTokenHeight = options.maxTokenHeight ?? DEFAULT_MAX_TOKEN_HEIGHT;
  const componentKeys = new Set((options.componentLabels ?? []).map(canonicalKey).filter((key) => key !== ''));

  return result.tokens.filter((token) => {
    if (token.box.height > maxTokenHeight) return false;

    // Parentheses and brackets mark a cross-reference or a callout, never the
    // number printed on a conductor.
    if (/[()[\]{}]/.test(token.text)) return false;

    const text = stripEdgePunctuation(token.text);
    if (!text) return false;
    // Any surviving separator means this is a compound designation — "TB1-3",
    // a "1/2" dimension, a "2.5" callout — not a bare wire number.
    if (/[^A-Z0-9]/.test(text)) return false;
    if (!WIRE_NUMBER_SHAPE.test(text)) return false;

    if (componentKeys.has(canonicalKey(text))) return false;
    if (NON_WIRE_LINE_CONTEXT.test(token.lineText.toUpperCase())) return false;
    if (rungMarginWidth > 0 && token.center.x <= rungMarginWidth) return false;
    if (excludeRegions.some((region) => containsPoint(region, token.center))) return false;

    return true;
  });
}

function stripEdgePunctuation(text: string): string {
  return text.trim().toUpperCase().replace(/^[^A-Z0-9]+/, '').replace(/[^A-Z0-9]+$/, '');
}

function canonicalKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function containsPoint(region: OcrBox, point: { x: number; y: number }): boolean {
  return (
    point.x >= region.x &&
    point.x <= region.x + region.width &&
    point.y >= region.y &&
    point.y <= region.y + region.height
  );
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

export interface OcrWireCoverage {
  /** Distinct wire numbers OCR read off the full-resolution image. */
  found: number;
  /** Of those, how many the produced wire list also has. */
  matched: number;
  unmatched: number;
  /** The numbers OCR read that no wire carries — read them off the drawing. */
  unmatchedLabels: string[];
  /** The reverse gap: wires whose number OCR never managed to read. */
  wiresWithoutOcrSupport: string[];
}

/**
 * Scores a finished wire list against what OCR could read at native resolution.
 * A long unmatchedLabels list means the pipeline is losing numbers that are
 * demonstrably legible in the file, which is the evidence for spending effort
 * on tiling the image; a short one means the resize is not what's costing us.
 */
export function summarizeOcrWireCoverage(
  candidates: OcrToken[],
  wires: { label: string }[]
): OcrWireCoverage {
  const wireKeys = new Set(wires.map((wire) => normalizeLabel(wire.label)).filter((key) => key !== ''));

  const seen = new Set<string>();
  const distinct: { key: string; label: string }[] = [];
  candidates.forEach((candidate) => {
    const key = normalizeLabel(candidate.text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    distinct.push({ key, label: candidate.text.trim() });
  });

  const unmatchedLabels = distinct.filter((entry) => !wireKeys.has(entry.key)).map((entry) => entry.label);
  const wiresWithoutOcrSupport = wires
    .filter((wire) => {
      const key = normalizeLabel(wire.label);
      return key !== '' && !seen.has(key);
    })
    .map((wire) => wire.label);

  return {
    found: distinct.length,
    matched: distinct.length - unmatchedLabels.length,
    unmatched: unmatchedLabels.length,
    unmatchedLabels,
    wiresWithoutOcrSupport,
  };
}

// Matches how the numbering pass compares labels, so a wire and the token it
// came from don't fail to line up over a "Wire " prefix or a stray space.
function normalizeLabel(value: string): string {
  return value.trim().replace(/^wire\s+/i, '').toUpperCase();
}

// ---------------------------------------------------------------------------
// Multi-pass integration
// ---------------------------------------------------------------------------

export interface OcrWireNumberSourceOptions extends WireNumberFilterOptions {
  /**
   * Used when OCR is unavailable or reads no candidates at all. Without one, a
   * build missing the native module would leave every conductor unnumbered —
   * strictly worse than the vision reader it replaced.
   */
  fallback?: WireNumberTokenSource;
}

/**
 * Wraps a full-resolution OCR read as a WireNumberTokenSource, so the numbering
 * pass gets its candidates for free instead of spending a vision call on them.
 *
 * `uri` must be the original photo, not the base64 copy the vision passes use.
 */
export function createOcrWireNumberSource(
  uri: string,
  options: OcrWireNumberSourceOptions = {}
): WireNumberTokenSource {
  return async (edges) => {
    const result = await recognizeTextInImage(uri);
    const candidates = filterWireNumberCandidates(result, {
      ...options,
      componentLabels: options.componentLabels ?? componentLabelsFromEdges(edges),
    });

    if (candidates.length === 0) {
      if (!options.fallback) return [];
      console.warn('[OCR] No wire-number candidates on device — falling back to the vision reader', {
        available: result.available,
        tokens: result.tokens.length,
      });
      return options.fallback(edges);
    }

    console.log('[OCR] Wire-number candidates ready', {
      source: `${result.sourceWidth}x${result.sourceHeight}`,
      tokens: result.tokens.length,
      candidates: candidates.length,
    });
    // No confidence: ML Kit's Latin recognizer doesn't expose a per-word score
    // through this wrapper, and inventing one would give the assignment step a
    // number it would treat as evidence.
    return candidates.map((candidate) => ({ text: candidate.text.trim(), position: candidate.center }));
  };
}

/**
 * The traced endpoints already name every component on the sheet — "TB1-3"
 * tells us both that "TB1" is a component and that "TB1-3" is a terminal. Both
 * spellings are excluded so the filter doesn't have to guess which tokens are
 * designations.
 */
function componentLabelsFromEdges(edges: ConductorEdge[]): string[] {
  const labels = new Set<string>();
  edges.forEach((edge) => {
    [edge.fromPoint, edge.toPoint].forEach((point) => {
      const trimmed = (point ?? '').trim();
      if (!trimmed) return;
      labels.add(trimmed);
      const dash = trimmed.lastIndexOf('-');
      if (dash > 0) labels.add(trimmed.slice(0, dash));
    });
  });
  return [...labels];
}
