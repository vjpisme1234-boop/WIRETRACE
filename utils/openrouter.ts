import * as SecureStore from 'expo-secure-store';
import { OPENROUTER_API_KEY, OPENROUTER_BASE_URL, OPENROUTER_MODEL, STORAGE_KEYS } from '@/constants/wiretrace';
import type { ReadingStep } from '@/utils/schematic-storage';

async function getApiKey(): Promise<string> {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEYS.API_KEY);
    return stored || OPENROUTER_API_KEY;
  } catch {
    return OPENROUTER_API_KEY;
  }
}

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | { type: string; text?: string; image_url?: { url: string } }[];
}

async function callOpenRouter(messages: OpenRouterMessage[]): Promise<string> {
  const apiKey = await getApiKey();

  if (!apiKey) {
    throw new Error('No API key configured. Please add your OpenRouter API key in Settings.');
  }

  console.log('[OpenRouter] Making API request', { model: OPENROUTER_MODEL, messageCount: messages.length });

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://wiretrace.ai',
      'X-Title': 'WireTrace AI',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      // Higher token ceiling supports larger multi-page schematic payloads and follow-up Q&A responses.
      max_tokens: 8192,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[OpenRouter] API error', { status: response.status, body: errorText });
    throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  console.log('[OpenRouter] API response received', { usage: data.usage });
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('No content in OpenRouter response');
  return content;
}

// ---------------------------------------------------------------------------
// Shared analysis system prompt
// ---------------------------------------------------------------------------

const ANALYSIS_SYSTEM_PROMPT = `You are a senior electrical engineer and certified electrician analyzing industrial wire schematics. Your analysis must be precise, complete, and useful to a field electrician.

CRITICAL INSTRUCTIONS:
1. Read ALL text visible in the image — wire numbers, component labels, terminal numbers, voltage levels, page numbers, sheet titles.
2. For EVERY wire, record its printed number/label EXACTLY as shown, the EXACT terminal designations on both ends (e.g. "TB1-1" not just "terminal"), and its insulation color if visible.
3. For EVERY component, identify its type using the approved list and its label exactly as printed (e.g. "CR1", "M1", "FU2").
4. Assign a confidence score (0.0–1.0) to each identification: 1.0 = perfectly legible; 0.5 = partially obscured or ambiguous; 0.0 = completely unclear.
5. If a symbol is UNRECOGNIZED, do NOT guess its type — add it to unknownSymbols with a description of its appearance and location (use normalized 0–1 coordinates for imageRegion).
6. Include voltage level when identifiable from labels or context (e.g. "120VAC", "24VDC", "480VAC").

RECOGNIZED COMPONENT TYPES (use these exact strings in "type"):
resistor, capacitor, inductor, transformer, auto-transformer, current-transformer, potential-transformer,
diode, zener-diode, LED, transistor, thyristor, TRIAC,
relay, latching-relay, time-delay-relay, contactor, motor-starter,
fuse, circuit-breaker, GFCI, AFCI, disconnect, surge-protector,
switch, pushbutton-NO, pushbutton-NC, selector-switch, limit-switch, float-switch, pressure-switch,
flow-switch, temperature-switch, proximity-sensor, photoelectric-sensor,
motor, servo-motor, stepper-motor, generator,
terminal-block, junction,
ground, chassis-ground, earth-ground,
power-supply, DC-power-supply, AC-power-supply, battery,
PLC, PLC-input, PLC-output, HMI, VFD, soft-starter,
solenoid, solenoid-valve, actuator, valve,
pilot-light, alarm, buzzer, bell,
ammeter, voltmeter, wattmeter, power-meter, hour-meter,
current-sensor, thermistor, RTD, thermocouple, encoder, resolver,
shunt, reactor, choke, filter,
overload, overload-relay, thermal-overload,
panel, panel-board, MCC-bucket, cable-tray, conduit, junction-box

WIRE COLOR STANDARDS (NFPA 79 / IEC 60204-1):
black=ungrounded AC (L1/L2/L3) | white/gray=neutral (N) | green/green-yellow=safety ground (PE)
red=ungrounded AC control (120VAC) | blue=DC control (24VDC) | yellow=ungrounded DC positive
orange=ungrounded AC from separate source | brown=L1 (IEC) | violet=DC negative

Return ONLY a valid JSON object — NO markdown, NO code fences, NO comments:
{
  "wires": [{ "id": "w1", "label": "14", "color": "red", "fromPoint": "TB1-1", "toPoint": "CR1-A1", "voltage": "120VAC", "confidence": 0.95 }],
  "components": [{ "id": "c1", "type": "relay", "label": "CR1", "description": "Control relay coil, 120VAC, 10A contacts", "isUnknown": false, "confidence": 0.98 }],
  "connections": [{ "id": "conn1", "from": "TB1-1", "to": "CR1-A1", "wireLabel": "14", "description": "Wire 14 from Terminal Block 1 pin 1 to Control Relay CR1 coil A1 (120VAC hot side)" }],
  "unknownSymbols": [{ "id": "u1", "description": "Upper-right quadrant: inverted triangle with horizontal line, possibly voltage reference or specialty sensor", "imageRegion": { "x": 0.75, "y": 0.1, "width": 0.1, "height": 0.08 } }],
  "summary": "12-line 120VAC/24VDC motor control schematic for a conveyor. Contains 1 motor starter (M1), 3 control relays (CR1-CR3), 1 overload relay (OL1), 2 pushbuttons, and 24 wires."
}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnalysisResult {
  wires: { id: string; label: string; color?: string; fromPoint: string; toPoint: string; voltage?: string; confidence?: number }[];
  components: { id: string; type: string; label: string; description: string; isUnknown: boolean; confidence?: number }[];
  connections: { id: string; from: string; to: string; wireLabel: string; description: string }[];
  unknownSymbols: { id: string; description: string; imageRegion?: { x: number; y: number; width: number; height: number } }[];
  summary: string;
}

function parseJsonResult<T>(content: string, label: string): T {
  const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch (e) {
    console.error(`[OpenRouter] Failed to parse ${label} JSON`, e, cleaned.slice(0, 300));
    throw new Error(`AI returned malformed JSON for ${label}. Please try again.`);
  }
}

// ---------------------------------------------------------------------------
// Single-image schematic analysis
// ---------------------------------------------------------------------------

export async function analyzeSchematic(base64Image: string): Promise<AnalysisResult> {
  console.log('[OpenRouter] analyzeSchematic called, image size:', base64Image.length);

  const content = await callOpenRouter([
    { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Analyze this electrical schematic and extract ALL wiring information as specified.' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
      ],
    },
  ]);

  const parsed = parseJsonResult<AnalysisResult>(content, 'analyzeSchematic');
  console.log('[OpenRouter] analyzeSchematic parsed', {
    wires: parsed.wires?.length,
    components: parsed.components?.length,
    connections: parsed.connections?.length,
    unknownSymbols: parsed.unknownSymbols?.length,
  });
  return parsed;
}

// ---------------------------------------------------------------------------
// Multi-image (multi-page) schematic analysis
// ---------------------------------------------------------------------------

export async function analyzeMultipleImages(base64Images: string[]): Promise<AnalysisResult> {
  console.log('[OpenRouter] analyzeMultipleImages called, pageCount:', base64Images.length);

  const imageContentParts = base64Images.map((b64) => ({
    type: 'image_url' as const,
    image_url: { url: `data:image/jpeg;base64,${b64}` },
  }));

  const content = await callOpenRouter([
    { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Analyze these ${base64Images.length} pages of an electrical schematic as a SINGLE complete document. Pages are in order. Combine all wires, components, connections, and unknown symbols from all pages into one unified JSON result. For items spanning pages, note the page in the description (e.g. "Wire 14, page 2").`,
        },
        ...imageContentParts,
      ],
    },
  ]);

  const parsed = parseJsonResult<AnalysisResult>(content, 'analyzeMultipleImages');
  console.log('[OpenRouter] analyzeMultipleImages parsed', {
    pages: base64Images.length,
    wires: parsed.wires?.length,
    components: parsed.components?.length,
  });
  return parsed;
}

// ---------------------------------------------------------------------------
// Step-by-step reading instructions
// ---------------------------------------------------------------------------

export async function generateReadingSteps(
  analysis: AnalysisResult,
  direction: 'forward' | 'backward',
  startPoint: string
): Promise<ReadingStep[]> {
  console.log('[OpenRouter] generateReadingSteps called', { direction, startPoint });

  const systemPrompt = `You are an experienced electrical journeyman reading wire schematics aloud to a helper or apprentice on a job site. Generate step-by-step spoken instructions that:
1. Reference wire numbers exactly as labeled (e.g. "Wire 14", not "the wire")
2. Give full terminal designations (e.g. "Terminal Block 1, pin 3" not "terminal 3")
3. State voltage and circuit type when known (e.g. "This is a 120VAC control circuit")
4. Flag safety: high voltage levels, polarity requirements, lockout/tagout points
5. For confidence < 0.7: add "Verify this identification — label may be unclear"
6. Use natural, spoken English an electrician would say on site

Return ONLY a valid JSON array — no markdown:
[{ "id": "s1", "stepNumber": 1, "wireLabel": "14", "componentLabel": "CR1", "instruction": "Wire 14 leaves Terminal Block 1 at pin 1 and connects to Control Relay CR1 coil terminal A1 — this is the 120VAC hot side.", "detail": "Standard red-insulated control wire. Measure continuity before energizing.", "specialInstruction": "Verify CR1 coil is rated 120VAC before energizing." }]`;

  const userMessage = `Generate ${direction} reading steps starting at: ${startPoint}

Schematic analysis:
${JSON.stringify(analysis, null, 2)}`;

  const content = await callOpenRouter([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ]);

  const steps = parseJsonResult<ReadingStep[]>(content, 'generateReadingSteps');
  console.log('[OpenRouter] generateReadingSteps parsed', { stepCount: steps.length });
  return steps;
}

// ---------------------------------------------------------------------------
// Symbol clarification
// ---------------------------------------------------------------------------

export async function getSymbolClarification(symbolType: string): Promise<string> {
  console.log('[OpenRouter] getSymbolClarification called', { symbolType });

  const content = await callOpenRouter([
    {
      role: 'user',
      content: `You are a certified electrician. Given that this electrical symbol is a "${symbolType}", provide in under 3 sentences:
1. What it does in a circuit
2. Its standard NEMA/IEC designation code if applicable
3. The most important wiring consideration for a field electrician`,
    },
  ]);

  console.log('[OpenRouter] getSymbolClarification response received');
  return content.trim();
}

// ---------------------------------------------------------------------------
// Region-focused symbol identification
// ---------------------------------------------------------------------------

export async function identifySymbolRegion(
  base64Image: string,
  regionDescription: string
): Promise<string> {
  console.log('[OpenRouter] identifySymbolRegion called');

  const content = await callOpenRouter([
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Focus on the region described as: "${regionDescription}". Identify the electrical symbol in that area. Provide a 1-2 sentence technical description: what type of component it is, its standard designation code, and one key wiring note for a field electrician.`,
        },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
      ],
    },
  ]);

  return content.trim();
}

// ---------------------------------------------------------------------------
// Schematic Q&A assistant
// ---------------------------------------------------------------------------

export async function answerSchematicQuestion(
  analysis: AnalysisResult,
  question: string
): Promise<string> {
  console.log('[OpenRouter] answerSchematicQuestion called');

  const content = await callOpenRouter([
    {
      role: 'system',
      content:
        'You are a helpful electrical troubleshooting assistant. Answer clearly and briefly using the provided schematic analysis. If asked for directions, give practical step-by-step guidance and include safety cautions when relevant.',
    },
    {
      role: 'user',
      content: `Schematic analysis:\n${JSON.stringify(analysis, null, 2)}\n\nUser question:\n${question}`,
    },
  ]);

  return content.trim();
}
