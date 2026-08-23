import * as SecureStore from 'expo-secure-store';
import { OPENROUTER_BASE_URL, OPENROUTER_MODEL, STORAGE_KEYS } from '@/constants/wiretrace';
import type { ReadingStep } from '@/utils/schematic-storage';
import type { JunctionChoice } from '@/utils/schematic-graph';
import { loadUIPreferences } from '@/utils/ui-preferences';
import {
  FREE_SCAN_LIMIT,
  FREE_TEXT_GENERATION_LIMIT,
  getRemainingFreeScans,
  getRemainingFreeTextGenerations,
  incrementFreeScanCount,
  incrementFreeTextGenerationCount,
} from '@/utils/free-scan-limit';
import { validateAnalysisConsistency } from '@/utils/schematic-validation';
import { salvagePartialAnalysis, salvagePartialReadingSteps } from '@/utils/partial-json';

// gpt-4o, not gpt-4o-mini: OpenAI is a rung that has to carry a scan when
// Anthropic and Gemini are both down, and mini is the weakest vision model of
// the family — as a fallback it was quietly downgrading the read rather than
// rescuing it.
const OPENAI_MODEL = process.env.EXPO_PUBLIC_OPENAI_MODEL || 'gpt-4o';
const ANTHROPIC_MODEL = process.env.EXPO_PUBLIC_ANTHROPIC_MODEL || 'claude-sonnet-5';

// Optional second Anthropic rung, off unless an operator sets it. Sonnet is the
// shipped default because customers bring their own keys and Opus is ~2.5x the
// cost per scan — nobody should pay for it by accident. An operator who does
// want Opus sets EXPO_PUBLIC_ANTHROPIC_MODEL=claude-opus-5 and can then name a
// cheaper model here (typically claude-sonnet-5) to catch the case where Opus
// itself is refusing or overloaded. Empty means the chain has exactly one
// Anthropic attempt, which is the behavior every existing install already has.
const ANTHROPIC_FALLBACK_MODEL = (process.env.EXPO_PUBLIC_ANTHROPIC_MODEL_FALLBACK || '').trim();
// The entire Gemini 2.5 family (gemini-2.5-pro AND gemini-2.5-flash) is
// blocked for this account's key with "no longer available to new users" —
// confirmed by calling the API directly, not assumed. gemini-3.1-pro is
// NOT a valid model ID on its own (that was an earlier bad guess here) —
// the real ID is gemini-3.1-pro-preview, which IS confirmed working for
// this key despite being a preview model. Being a preview does still carry
// some risk of being renamed/replaced later, but it's the verified-working
// Pro-tier option right now.
const GEMINI_MODEL = process.env.EXPO_PUBLIC_GEMINI_MODEL || 'gemini-3.1-pro-preview';

// Baked-in Gemini key so the app works immediately after install (and for
// App Store / Play Store reviewers) with no setup. Set at build time via
// the EXPO_PUBLIC_GEMINI_DEFAULT_KEY env var (EAS secret for production
// builds, .env for local dev) — never hardcode a real key directly in this
// file, it ships in the compiled bundle. This key is on a paid Google Cloud
// tier (no hard cap) — the "free tier, lower accuracy" caveat that used to
// apply here no longer does.
const DEFAULT_GEMINI_KEY = (process.env.EXPO_PUBLIC_GEMINI_DEFAULT_KEY || '').trim();

async function getApiKey(): Promise<string> {
  const stored = await SecureStore.getItemAsync(STORAGE_KEYS.API_KEY);
  return stored ? stored.trim() : '';
}

async function getOpenAIKey(): Promise<string> {
  const stored = await SecureStore.getItemAsync(STORAGE_KEYS.OPENAI_API_KEY);
  return stored ? stored.trim() : '';
}

async function getAnthropicKey(): Promise<string> {
  const stored = await SecureStore.getItemAsync(STORAGE_KEYS.ANTHROPIC_API_KEY);
  return stored ? stored.trim() : '';
}

async function getGeminiKey(): Promise<string> {
  const stored = await SecureStore.getItemAsync(STORAGE_KEYS.GEMINI_API_KEY);
  if (stored && stored.trim()) return stored.trim();
  return DEFAULT_GEMINI_KEY;
}

// The free-scan cap meters the key WE ship, not one the customer pays for. A
// customer who pastes their own Gemini key is billed directly by Google, so
// counting their scans against the 20-scan allowance would be metering
// somebody else's bill.
async function isUsingBuiltInGeminiKey(): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(STORAGE_KEYS.GEMINI_API_KEY);
  return !(stored && stored.trim());
}

function validateOpenRouterKeyFormat(apiKey: string): void {
  if (!apiKey.startsWith('sk-or-')) {
    throw new Error(
      'OpenRouter API key appears invalid. It should start with "sk-or-". Please update it in Settings.'
    );
  }
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | { type: string; text?: string; image_url?: { url: string } }[];
}

async function callOpenAICompatible(opts: {
  provider: string;
  url: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  extraHeaders?: Record<string, string>;
}): Promise<string> {
  const { provider, url, apiKey, model, messages, maxTokens, extraHeaders } = opts;
  console.log(`[${provider}] Making API request`, { model, messageCount: messages.length });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[${provider}] API error`, { status: response.status, body: errorText });
    if (response.status === 401) {
      throw new Error(`${provider} API error 401 (Unauthorized). Verify your ${provider} key in Settings.`);
    }
    throw new Error(`${provider} API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`No content in ${provider} response`);
  return typeof content === 'string' ? content.trim() : String(content);
}

async function callOpenRouter(messages: ChatMessage[], maxTokens = 4096): Promise<string> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('No API key configured. Please add your OpenRouter API key in Settings.');
  }
  validateOpenRouterKeyFormat(apiKey);

  return callOpenAICompatible({
    provider: 'OpenRouter',
    url: `${OPENROUTER_BASE_URL}/chat/completions`,
    apiKey,
    model: OPENROUTER_MODEL,
    messages,
    maxTokens,
    extraHeaders: { 'HTTP-Referer': 'https://wiretrace.ai', 'X-Title': 'WireTrace AI' },
  });
}

async function callOpenAI(messages: ChatMessage[], maxTokens = 2048): Promise<string> {
  const apiKey = await getOpenAIKey();
  if (!apiKey) throw new Error('OpenAI key is not configured.');
  return callOpenAICompatible({
    provider: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    apiKey,
    model: OPENAI_MODEL,
    messages,
    maxTokens,
  });
}

async function callGemini(messages: ChatMessage[], maxTokens = 2048): Promise<string> {
  const apiKey = await getGeminiKey();
  if (!apiKey) throw new Error('Gemini key is not configured.');
  return callOpenAICompatible({
    provider: 'Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    apiKey,
    model: GEMINI_MODEL,
    messages,
    maxTokens,
  });
}

function toAnthropicContent(content: ChatMessage['content']): any {
  if (typeof content === 'string') return content;
  return content.map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text ?? '' };
    if (part.type === 'image_url' && part.image_url?.url) {
      const match = /^data:(image\/[a-zA-Z]+);base64,(.+)$/.exec(part.image_url.url);
      if (match) {
        return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
      }
    }
    return { type: 'text', text: '' };
  });
}

// `model` is threaded in from the attempt rather than read off module scope so
// the same provider can appear twice in the chain with two different models.
async function callAnthropic(
  messages: ChatMessage[],
  maxTokens = 2048,
  model: string = ANTHROPIC_MODEL
): Promise<string> {
  const apiKey = await getAnthropicKey();
  if (!apiKey) throw new Error('Anthropic key is not configured.');

  const systemMessage = messages.find((m) => m.role === 'system');
  const conversation = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: toAnthropicContent(m.content) }));

  console.log('[Anthropic] Making API request', { model, messageCount: conversation.length });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(systemMessage ? { system: systemMessage.content } : {}),
      messages: conversation,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Anthropic] API error', { status: response.status, body: errorText });
    if (response.status === 401) {
      throw new Error('Anthropic API error 401 (Unauthorized). Verify your Anthropic key in Settings.');
    }
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text;
  if (!content) throw new Error('No content in Anthropic response');
  return content.trim();
}

function visionMessages(imageUrl: string, prompt: string, systemPrompt?: string): ChatMessage[] {
  const userMessage: ChatMessage = {
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: imageUrl } },
    ],
  };
  return systemPrompt ? [{ role: 'system', content: systemPrompt }, userMessage] : [userMessage];
}

type ProviderName = 'anthropic' | 'openrouter' | 'openai' | 'gemini';

// One rung of the fallback chain. A rung is a provider *and* a model, not just
// a provider, so the same provider can legitimately appear more than once.
interface ProviderAttempt {
  name: ProviderName;
  model: string;
  run: () => Promise<string>;
}

async function buildProviderAttempts(
  selectedProvider: string,
  run: (provider: ProviderName, model: string) => Promise<string>
): Promise<ProviderAttempt[]> {
  const [anthropicKey, openRouterKey, openAIKey, geminiKey] = await Promise.all([
    getAnthropicKey(),
    getApiKey(),
    getOpenAIKey(),
    getGeminiKey(),
  ]);

  // Claude leads for accuracy. Gemini sits right behind it as the fast,
  // always-available fallback (the baked-in key with no setup required).
  // OpenAI and OpenRouter follow as further fallbacks for when both of
  // those are unavailable or exhausted.
  const candidates: { name: ProviderName; model: string; key: string }[] = [
    { name: 'anthropic', model: ANTHROPIC_MODEL, key: anthropicKey },
    // Present only when the operator opted in; see ANTHROPIC_FALLBACK_MODEL.
    ...(ANTHROPIC_FALLBACK_MODEL
      ? [{ name: 'anthropic' as ProviderName, model: ANTHROPIC_FALLBACK_MODEL, key: anthropicKey }]
      : []),
    { name: 'gemini', model: GEMINI_MODEL, key: geminiKey },
    { name: 'openai', model: OPENAI_MODEL, key: openAIKey },
    { name: 'openrouter', model: OPENROUTER_MODEL, key: openRouterKey },
  ];

  // Filtering still keys off the provider name alone, so picking "anthropic"
  // in Settings yields every configured Anthropic rung rather than just one.
  return candidates
    .filter((c) => (selectedProvider === 'all' || selectedProvider === c.name) && c.key)
    .map((c) => ({ name: c.name, model: c.model, run: () => run(c.name, c.model) }));
}

// Errors raised because the built-in free allowance is used up are tagged
// rather than matched on their text, so the wording can change freely. A
// property beats subclassing Error here — `instanceof` on an Error subclass is
// unreliable once the code is transpiled.
type TaggedError = Error & { isFreeAllowance?: boolean };

function freeAllowanceError(message: string): Error {
  const error: TaggedError = new Error(message);
  error.isFreeAllowance = true;
  return error;
}

function isFreeAllowanceError(error: unknown): boolean {
  return error instanceof Error && (error as TaggedError).isFreeAllowance === true;
}

async function runWithFallback(
  selectedProvider: string,
  run: (provider: ProviderName, model: string) => Promise<string>,
  noKeyHint: string
): Promise<string> {
  const attempts = await buildProviderAttempts(selectedProvider, run);

  if (attempts.length === 0) {
    throw new Error(
      selectedProvider === 'all'
        ? `No AI provider available. ${noKeyHint}`
        : `No API key configured for selected provider "${selectedProvider}". Add it in Settings or switch to "All (Auto)".`
    );
  }

  const errors: string[] = [];
  let lastFreeAllowanceError: Error | null = null;

  for (const attempt of attempts) {
    try {
      console.log('[AI] Attempting provider', { provider: attempt.name, model: attempt.model });
      return await attempt.run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[AI] Provider failed', { provider: attempt.name, model: attempt.model, message });
      // A used-up free allowance no longer stops the chain outright — Gemini
      // sitting early in the chain means an exhausted allowance should fall
      // through to OpenAI/OpenRouter rather than ending the scan. The
      // specific message is held onto so it can still be surfaced if every
      // other rung also fails, since it's more actionable than the generic
      // aggregate.
      if (isFreeAllowanceError(error)) {
        lastFreeAllowanceError = error as Error;
        continue;
      }
      // The model goes in the clause too: two Anthropic rungs would otherwise
      // produce two indistinguishable lines in the aggregated failure message.
      errors.push(`${attempt.name} (${attempt.model}): ${message}`);
    }
  }

  // Every rung failed. If the only failures were a used-up free allowance
  // (no other provider configured/working), that specific, actionable
  // message beats a generic aggregate.
  if (errors.length === 0 && lastFreeAllowanceError) {
    throw lastFreeAllowanceError;
  }

  // One configured provider means there was no fallback to speak of; the
  // plural aggregate would overstate what was actually tried.
  if (errors.length === 1 && !lastFreeAllowanceError) throw new Error(errors[0]);

  if (lastFreeAllowanceError) {
    errors.push(`gemini: ${lastFreeAllowanceError.message}`);
  }

  throw new Error(`All AI providers failed. ${errors.join(' | ')}`);
}

async function callGeminiWithFreeScanLimit(messages: ChatMessage[], maxTokens: number): Promise<string> {
  if (!(await isUsingBuiltInGeminiKey())) return callGemini(messages, maxTokens);
  const remaining = await getRemainingFreeScans();
  if (remaining <= 0) {
    throw freeAllowanceError(
      `You've used all ${FREE_SCAN_LIMIT} free scans on the built-in AI for this install. Add your own Gemini, Anthropic, OpenRouter, or OpenAI key in Settings to keep scanning. A Gemini key is free at aistudio.google.com/apikey.`
    );
  }
  const result = await callGemini(messages, maxTokens);
  await incrementFreeScanCount();
  return result;
}

async function callGeminiWithTextGenerationLimit(messages: ChatMessage[], maxTokens: number): Promise<string> {
  if (!(await isUsingBuiltInGeminiKey())) return callGemini(messages, maxTokens);
  const remaining = await getRemainingFreeTextGenerations();
  if (remaining <= 0) {
    throw freeAllowanceError(
      `You've used all ${FREE_TEXT_GENERATION_LIMIT} free AI requests on the built-in AI for this install. Add your own Gemini, Anthropic, OpenRouter, or OpenAI key in Settings to keep going. A Gemini key is free at aistudio.google.com/apikey.`
    );
  }
  const result = await callGemini(messages, maxTokens);
  await incrementFreeTextGenerationCount();
  return result;
}

async function callVisionWithFallback(imageUrl: string, prompt: string, systemPrompt?: string): Promise<string> {
  const uiPrefs = await loadUIPreferences();
  return runWithFallback(
    uiPrefs.visionProvider,
    (provider, model) => {
      const messages = visionMessages(imageUrl, prompt, systemPrompt);
      if (provider === 'anthropic') return callAnthropic(messages, 4096, model);
      if (provider === 'openrouter') return callOpenRouter(messages, 4096);
      if (provider === 'openai') return callOpenAI(messages, 4096);
      return callGeminiWithFreeScanLimit(messages, 4096);
    },
    'No AI key configured. Add a Gemini, Anthropic, OpenRouter, or OpenAI key in Settings. A Gemini key is free at aistudio.google.com/apikey.'
  );
}

function visionMessagesMulti(imageUrls: string[], prompt: string, systemPrompt: string): ChatMessage[] {
  const userMessage: ChatMessage = {
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
    ],
  };
  return [{ role: 'system', content: systemPrompt }, userMessage];
}

async function callMultiVisionWithFallback(imageUrls: string[], prompt: string, systemPrompt: string, maxTokens: number): Promise<string> {
  const uiPrefs = await loadUIPreferences();
  return runWithFallback(
    uiPrefs.visionProvider,
    (provider, model) => {
      const messages = visionMessagesMulti(imageUrls, prompt, systemPrompt);
      if (provider === 'anthropic') return callAnthropic(messages, maxTokens, model);
      if (provider === 'openrouter') return callOpenRouter(messages, maxTokens);
      if (provider === 'openai') return callOpenAI(messages, maxTokens);
      return callGeminiWithFreeScanLimit(messages, maxTokens);
    },
    'No AI key configured. Add a Gemini, Anthropic, OpenRouter, or OpenAI key in Settings. A Gemini key is free at aistudio.google.com/apikey.'
  );
}

async function callTextWithFallback(messages: ChatMessage[], maxTokens: number): Promise<string> {
  const uiPrefs = await loadUIPreferences();
  return runWithFallback(
    uiPrefs.visionProvider,
    (provider, model) => {
      if (provider === 'anthropic') return callAnthropic(messages, maxTokens, model);
      if (provider === 'openrouter') return callOpenRouter(messages, maxTokens);
      if (provider === 'openai') return callOpenAI(messages, maxTokens);
      return callGeminiWithTextGenerationLimit(messages, maxTokens);
    },
    'No AI key configured. Add a Gemini, Anthropic, OpenRouter, or OpenAI key in Settings. A Gemini key is free at aistudio.google.com/apikey.'
  );
}

// ---------------------------------------------------------------------------
// Shared analysis system prompt
// ---------------------------------------------------------------------------

const ANALYSIS_SYSTEM_PROMPT = `You are a senior electrical engineer and certified electrician analyzing industrial wire schematics. Your analysis must be precise, complete, and useful to a field electrician.

CRITICAL INSTRUCTIONS:
1. Read ALL text visible in the image — wire numbers, component labels, terminal numbers, voltage levels, page numbers, sheet titles.
2. For EVERY wire, record its printed number/label EXACTLY as shown and the EXACT terminal designations on both ends (e.g. "TB1-1" not just "terminal").
3. For EVERY component, identify its type using the approved list and its label exactly as printed (e.g. "CR1", "M1", "FU2").
4. Assign a confidence score (0.0–1.0) to each identification: 1.0 = perfectly legible; 0.5 = partially obscured or ambiguous; 0.0 = completely unclear.
5. If a symbol is UNRECOGNIZED, do NOT guess its type — add it to unknownSymbols with a description of its appearance and location (use normalized 0–1 coordinates for imageRegion).
6. Include voltage level when identifiable from labels or context (e.g. "120VAC", "24VDC", "480VAC").
7. WIRE COLOR — only set "color" when it is EXPLICITLY shown in the image: the wire itself is drawn/rendered in that color, or there is a printed color abbreviation next to it (e.g. "BLU", "RD", "BLK", "WHT", "GRN", "YEL", "ORG", "BRN", "VIO", "GRY"). NEVER infer or assume a color from voltage level, polarity (positive/negative), AC vs DC, or component type — a 24VDC or negative wire is NOT automatically blue, a 120VAC wire is NOT automatically red, etc. If no color is drawn or printed, omit the "color" field entirely rather than guessing.
8. STARTING POINT — determine whether there is an unambiguous place to start reading (e.g. a wire/line explicitly labeled "1", "L1", a clearly marked power input, or a title block indicating a start). Set "startPointAmbiguous" to true if there is no such clear starting point (e.g. multiple plausible entry points, no numbering visible, a sheet that begins mid-circuit) — do NOT silently pick one and call it certain. Set it to false only when a start is genuinely obvious.

WHAT COUNTS AS A WIRE:
Every conductor line that has a number printed on it or immediately beside it is a wire. Record one wire per such number, follow that line to both of its ends, and record the exact terminal designation at each end. Work through the drawing systematically so no numbered line is skipped — the wire count you report should match the numbers actually printed on the drawing.
These numbers are NOT wires — never create a wire entry from them:
- Rung or line numbers running down the left margin of a ladder diagram (they number the rung, not a conductor)
- Cross-reference numbers pointing to another rung, sheet, or drawing
- The pin part of a terminal designation (the "3" in "TB1-3")
- The number inside a component label ("CR1", "FU2", "OL1")
- Item balloons or bill-of-materials callouts
- Sheet, page, revision, or drawing numbers, and dimension callouts
If a numbered conductor runs off the edge of the sheet, still record it: give the terminal you can see and set the far end to an empty string "" rather than dropping the wire. Both "fromPoint" and "toPoint" must always be present on every wire, even when one end is off-sheet.

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

WIRE COLOR ABBREVIATIONS (use ONLY to decode a color you can actually see printed or drawn on the schematic — never to guess a color from voltage, polarity, or wire function):
BLK/BK=black | WHT/WH=white | GRY/GY=gray | GRN/GN=green | G/YEL=green-yellow
RED/RD=red | BLU/BL=blue | YEL/YL=yellow | ORG/OR=orange | BRN/BR=brown | VIO/VI=violet | PNK/PK=pink

Return ONLY a valid JSON object — NO markdown, NO code fences, NO comments:
{
  "wires": [{ "id": "w1", "label": "14", "color": "red", "fromPoint": "TB1-1", "toPoint": "CR1-A1", "voltage": "120VAC", "confidence": 0.95 }, { "id": "w2", "label": "22", "fromPoint": "TB1-3", "toPoint": "M1-T1", "voltage": "24VDC", "confidence": 0.9 }],
  "components": [{ "id": "c1", "type": "relay", "label": "CR1", "description": "Control relay coil, 120VAC, 10A contacts", "isUnknown": false, "confidence": 0.98 }],
  "connections": [{ "id": "conn1", "from": "TB1-1", "to": "CR1-A1", "wireLabel": "14", "description": "Wire 14 from Terminal Block 1 pin 1 to Control Relay CR1 coil A1 (120VAC hot side)" }],
  "unknownSymbols": [{ "id": "u1", "description": "Upper-right quadrant: inverted triangle with horizontal line, possibly voltage reference or specialty sensor", "imageRegion": { "x": 0.75, "y": 0.1, "width": 0.1, "height": 0.08 } }],
  "summary": "12-line 120VAC/24VDC motor control schematic for a conveyor. Contains 1 motor starter (M1), 3 control relays (CR1-CR3), 1 overload relay (OL1), 2 pushbuttons, and 24 wires.",
  "startPointAmbiguous": false
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
  startPointAmbiguous?: boolean;
  validationWarnings?: string[];
}

function parseJsonResult<T>(content: string, label: string): T {
  const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch (e) {
    // Model sometimes wraps the JSON in a sentence or two of commentary
    // despite instructions not to — retry against just the outermost
    // {...} span before giving up.
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch (e2) {
        console.error(`[OpenRouter] Failed to parse ${label} JSON (retry)`, e2, cleaned.slice(0, 300));
      }
    } else {
      console.error(`[OpenRouter] Failed to parse ${label} JSON`, e, cleaned.slice(0, 300));
    }
    throw new Error(`AI returned malformed JSON for ${label}. Please try again.`);
  }
}

// Tries a normal full parse first. If that fails outright (e.g. the
// response was truncated mid-array), salvages whatever wires/components/
// connections parsed cleanly before the cutoff instead of discarding the
// entire response — a partial result the user can fill the gaps in beats
// a hard failure that throws away real, usable data.
function parseAnalysisWithSalvage(content: string, label: string): AnalysisResult {
  try {
    return parseJsonResult<AnalysisResult>(content, label);
  } catch (e) {
    const salvage = salvagePartialAnalysis(content);
    if (salvage.wires.length === 0 && salvage.components.length === 0) {
      throw e; // nothing recoverable
    }
    console.warn(`[OpenRouter] ${label} full parse failed — salvaged partial result`, {
      wires: salvage.wires.length,
      components: salvage.components.length,
      connections: salvage.connections.length,
    });
    return {
      wires: salvage.wires as AnalysisResult['wires'],
      components: salvage.components as AnalysisResult['components'],
      connections: salvage.connections as AnalysisResult['connections'],
      unknownSymbols: salvage.unknownSymbols as AnalysisResult['unknownSymbols'],
      summary: salvage.summary,
      startPointAmbiguous: salvage.startPointAmbiguous,
      validationWarnings: [
        'This is a partial result — the AI response was cut off before finishing. Some wires, components, or connections may be missing. Add them manually if needed.',
      ],
    };
  }
}

// Same idea as parseAnalysisWithSalvage, for reading-steps responses. A
// long schematic (many wires, verbose per-step detail) can push the model
// past the token budget before it closes out the JSON — recovering
// whatever steps parsed cleanly beats throwing the whole reading away.
// pendingChoice is dropped on a salvage since a truncated one can't be
// trusted; the caller's own uncovered-wire detection picks up the slack.
function parseReadingStepsWithSalvage(content: string, label: string): ReadingStepsResult {
  try {
    const result = parseJsonResult<ReadingStepsResult>(content, label);
    return { steps: result.steps ?? [], pendingChoice: result.pendingChoice ?? null };
  } catch (e) {
    const steps = salvagePartialReadingSteps(content);
    if (steps.length === 0) {
      throw e; // nothing recoverable
    }
    console.warn(`[OpenRouter] ${label} full parse failed — salvaged partial steps`, { stepCount: steps.length });
    return { steps: steps as ReadingStep[], pendingChoice: null };
  }
}

// ---------------------------------------------------------------------------
// Single-image schematic analysis
// ---------------------------------------------------------------------------

export async function analyzeSchematic(base64Image: string): Promise<AnalysisResult> {
  console.log('[OpenRouter] analyzeSchematic called, image size:', base64Image.length);

  const imageUrl = `data:image/jpeg;base64,${base64Image}`;
  const prompt = 'Analyze this electrical schematic and extract ALL wiring information as specified.';
  const content = await callVisionWithFallback(imageUrl, prompt, ANALYSIS_SYSTEM_PROMPT);

  const parsed = parseAnalysisWithSalvage(content, 'analyzeSchematic');
  console.log('[OpenRouter] analyzeSchematic parsed', {
    wires: parsed.wires?.length,
    components: parsed.components?.length,
    connections: parsed.connections?.length,
    unknownSymbols: parsed.unknownSymbols?.length,
  });
  parsed.validationWarnings = [...(parsed.validationWarnings ?? []), ...validateAnalysisConsistency(parsed)];
  if (parsed.validationWarnings.length > 0) {
    console.warn('[OpenRouter] analyzeSchematic validation warnings', parsed.validationWarnings);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Multi-image (multi-page) schematic analysis
// ---------------------------------------------------------------------------

export async function analyzeMultipleImages(base64Images: string[]): Promise<AnalysisResult> {
  console.log('[OpenRouter] analyzeMultipleImages called, pageCount:', base64Images.length);

  const imageUrls = base64Images.map((b64) => `data:image/jpeg;base64,${b64}`);
  const prompt = `Analyze these ${base64Images.length} pages of an electrical schematic as a SINGLE complete document. Pages are in order. Combine all wires, components, connections, and unknown symbols from all pages into one unified JSON result. For items spanning pages, note the page in the description (e.g. "Wire 14, page 2").`;

  const content = await callMultiVisionWithFallback(imageUrls, prompt, ANALYSIS_SYSTEM_PROMPT, 8192);

  const parsed = parseAnalysisWithSalvage(content, 'analyzeMultipleImages');
  console.log('[OpenRouter] analyzeMultipleImages parsed', {
    pages: base64Images.length,
    wires: parsed.wires?.length,
    components: parsed.components?.length,
  });
  parsed.validationWarnings = [...(parsed.validationWarnings ?? []), ...validateAnalysisConsistency(parsed)];
  if (parsed.validationWarnings.length > 0) {
    console.warn('[OpenRouter] analyzeMultipleImages validation warnings', parsed.validationWarnings);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Step-by-step reading instructions
// ---------------------------------------------------------------------------

export interface ReadingStepsResult {
  steps: ReadingStep[];
  pendingChoice: JunctionChoice | null;
}

const READING_STEPS_SYSTEM_PROMPT = `You are an experienced electrical journeyman reading wire schematics aloud to a helper or apprentice on a job site. Generate step-by-step spoken instructions that:
1. Reference wire numbers exactly as labeled (e.g. "Wire 14", not "the wire")
2. Give full terminal designations (e.g. "Terminal Block 1, pin 3" not "terminal 3")
3. State voltage and circuit type when known (e.g. "This is a 120VAC control circuit")
4. Flag safety: high voltage levels, polarity requirements, lockout/tagout points
5. For confidence < 0.7: add "Verify this identification — label may be unclear"
6. Use natural, spoken English an electrician would say on site
7. COVERAGE: every wire in the "wires" array must end up referenced by a step's "wireLabel" — either on the main path or, if it only connects at a terminal you've already passed (a parallel run, a tap, a separate branch off an earlier terminal), treat that terminal as a BRANCH POINT per the rule below rather than silently leaving the wire out.

BRANCH POINTS: the connections data may include a terminal with more than one outgoing wire — a point where the path splits. If the user has pre-selected a path at that terminal (given below), follow it exactly and continue. If a split is reached that the user has NOT pre-selected, STOP generating further steps at that point — do not guess which wire to follow. Instead set "pendingChoice" describing the terminal and its available next wires, and leave "steps" ending at the last step before that split.

Return ONLY a valid JSON object — no markdown:
{
  "steps": [{ "id": "s1", "stepNumber": 1, "wireLabel": "14", "componentLabel": "CR1", "instruction": "Wire 14 leaves Terminal Block 1 at pin 1 and connects to Control Relay CR1 coil terminal A1 — this is the 120VAC hot side.", "detail": "Standard red-insulated control wire. Measure continuity before energizing.", "specialInstruction": "Verify CR1 coil is rated 120VAC before energizing." }],
  "pendingChoice": null
}
Or, when stopping at an unresolved split:
{
  "steps": [...steps up to the split...],
  "pendingChoice": { "terminal": "TB1-1", "options": [{ "to": "CR1-A1", "wireLabel": "14", "description": "To Control Relay CR1 coil A1" }, { "to": "M1-T1", "wireLabel": "22", "description": "To Motor M1 terminal T1" }] }
}`;

function readingStepsPrompt(verbosity?: 'concise' | 'detailed'): string {
  if (verbosity === 'detailed') {
    return `${READING_STEPS_SYSTEM_PROMPT}\n\nThis crew is training — favor the "detail" field: explain unfamiliar terminology and the reasoning behind each connection, not just what it is.`;
  }
  if (verbosity === 'concise') {
    return `${READING_STEPS_SYSTEM_PROMPT}\n\nThis crew is experienced — keep "detail" minimal or omit it for standard components; just give the path clearly and quickly.`;
  }
  return READING_STEPS_SYSTEM_PROMPT;
}

export async function generateReadingSteps(
  analysis: AnalysisResult,
  direction: 'forward' | 'backward',
  startPoint: string,
  branchChoices?: Record<string, string>,
  verbosity?: 'concise' | 'detailed'
): Promise<ReadingStepsResult> {
  console.log('[OpenRouter] generateReadingSteps called', { direction, startPoint, branchChoices, verbosity });

  const branchChoicesText =
    branchChoices && Object.keys(branchChoices).length > 0
      ? `\n\nUser-selected path choices at branch terminals (terminal -> chosen next terminal), follow these exactly:\n${JSON.stringify(branchChoices)}`
      : '';

  const userMessage = `Generate ${direction} reading steps starting at: ${startPoint}${branchChoicesText}

Schematic analysis:
${JSON.stringify(analysis)}`;

  const content = await callTextWithFallback([
    { role: 'system', content: readingStepsPrompt(verbosity) },
    { role: 'user', content: userMessage },
  ], 16384);

  const result = parseReadingStepsWithSalvage(content, 'generateReadingSteps');
  console.log('[OpenRouter] generateReadingSteps parsed', {
    stepCount: result.steps?.length,
    pendingChoice: !!result.pendingChoice,
  });
  return result;
}

/**
 * Continues a reading sequence after the user resolves a branch mid-session
 * (via voice in the Reader). Only the new steps are returned — the caller
 * appends them to the already-spoken steps rather than regenerating from
 * scratch, so earlier wording never changes underneath the user.
 */
export async function continueReadingSteps(
  analysis: AnalysisResult,
  direction: 'forward' | 'backward',
  priorSteps: ReadingStep[],
  resolvedTerminal: string,
  resolvedTo: string,
  verbosity?: 'concise' | 'detailed'
): Promise<ReadingStepsResult> {
  console.log('[OpenRouter] continueReadingSteps called', { resolvedTerminal, resolvedTo, verbosity });

  const userMessage = `You already generated these ${direction} reading steps:
${JSON.stringify(priorSteps)}

The user just chose, at terminal ${resolvedTerminal}, to continue toward ${resolvedTo}. Continue the sequence from step ${priorSteps.length + 1} onward, following that path, in the same style as above. Do NOT repeat the steps already given — return only the NEW steps, with stepNumber continuing on from ${priorSteps.length + 1}. Stop again (with "pendingChoice") if you reach another unresolved split.

Schematic analysis:
${JSON.stringify(analysis)}`;

  const content = await callTextWithFallback([
    { role: 'system', content: readingStepsPrompt(verbosity) },
    { role: 'user', content: userMessage },
  ], 16384);

  const result = parseReadingStepsWithSalvage(content, 'continueReadingSteps');
  console.log('[OpenRouter] continueReadingSteps parsed', {
    stepCount: result.steps?.length,
    pendingChoice: !!result.pendingChoice,
  });
  return result;
}

/**
 * Generates reading steps for a user-picked subset of wires in a user-picked
 * order (the "custom reading order" screen). The order is already fully
 * decided by the user, so — unlike generateReadingSteps — this never stops
 * for an unresolved branch; it just narrates exactly the wires given, in
 * that exact sequence.
 */
export async function generateCustomOrderReadingSteps(
  analysis: AnalysisResult,
  orderedWireLabels: string[],
  verbosity?: 'concise' | 'detailed'
): Promise<ReadingStep[]> {
  console.log('[OpenRouter] generateCustomOrderReadingSteps called', { count: orderedWireLabels.length, verbosity });

  const userMessage = `The user has manually selected the exact wires to read aloud and the exact order to read them in. Generate exactly one reading step per wire listed below, in this exact order — do not skip any, do not add wires that aren't listed, and do not stop early for branches even if one of these wires sits at a split:
${orderedWireLabels.map((label, i) => `${i + 1}. Wire ${label}`).join('\n')}

Schematic analysis:
${JSON.stringify(analysis)}`;

  const content = await callTextWithFallback([
    { role: 'system', content: readingStepsPrompt(verbosity) },
    { role: 'user', content: userMessage },
  ], 16384);

  const result = parseReadingStepsWithSalvage(content, 'generateCustomOrderReadingSteps');
  console.log('[OpenRouter] generateCustomOrderReadingSteps parsed', { stepCount: result.steps?.length });
  return result.steps;
}

// ---------------------------------------------------------------------------
// Symbol clarification
// ---------------------------------------------------------------------------

export async function getSymbolClarification(symbolType: string): Promise<string> {
  console.log('[OpenRouter] getSymbolClarification called', { symbolType });

  const content = await callTextWithFallback([
    {
      role: 'user',
      content: `You are a certified electrician. Given that this electrical symbol is a "${symbolType}", provide in under 3 sentences:
1. What it does in a circuit
2. Its standard NEMA/IEC designation code if applicable
3. The most important wiring consideration for a field electrician`,
    },
  ], 700);

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

  const imageUrl = `data:image/jpeg;base64,${base64Image}`;
  const prompt = `Focus on the region described as: "${regionDescription}". Identify the electrical symbol in that area. Provide a 1-2 sentence technical description: what type of component it is, its standard designation code, and one key wiring note for a field electrician.`;
  const content = await callVisionWithFallback(imageUrl, prompt);

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

  const content = await callTextWithFallback([
    {
      role: 'system',
      content:
        'You are a helpful electrical troubleshooting assistant. Answer clearly and briefly using the provided schematic analysis. If asked for directions, give practical step-by-step guidance and include safety cautions when relevant.',
    },
    {
      role: 'user',
      content: `Schematic analysis:\n${JSON.stringify(analysis)}\n\nUser question:\n${question}`,
    },
  ], 1800);

  return content.trim();
}

// ---------------------------------------------------------------------------
// Voice correction — "wire 22, not 14" style spoken fixes
// ---------------------------------------------------------------------------

export interface VoiceCorrectionResult {
  understood: boolean;
  field: string;
  newValue: string;
}

const VOICE_CORRECTION_SYSTEM_PROMPT = `You are helping an electrician correct a mistake the AI made while reading a wire schematic. You'll be given the current field values for one item (a wire, component, or connection) and a spoken correction. Figure out which single field is being corrected and what its new value should be.

Only choose a field name from the list of valid fields given. If the correction clearly describes deleting or doesn't map to any real field, set "understood" to false.

Return ONLY a valid JSON object — no markdown:
{ "understood": true, "field": "label", "newValue": "22" }`;

/**
 * Parses a spoken correction against one item's current fields. Text-only
 * (no image), so this goes through callTextWithFallback and does not count
 * against the free-scan limit — corrections stay free even on the built-in
 * key.
 */
export async function parseVoiceCorrection(
  kind: 'wire' | 'component' | 'connection',
  currentFields: Record<string, string>,
  transcript: string
): Promise<VoiceCorrectionResult> {
  console.log('[OpenRouter] parseVoiceCorrection called', { kind, transcript });

  const userMessage = `Item type: ${kind}
Current fields: ${JSON.stringify(currentFields)}
Valid field names: ${Object.keys(currentFields).join(', ')}
Spoken correction: "${transcript}"

Which field is being corrected, and what should its new value be?`;

  const content = await callTextWithFallback(
    [
      { role: 'system', content: VOICE_CORRECTION_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    300
  );

  const result = parseJsonResult<VoiceCorrectionResult>(content, 'parseVoiceCorrection');
  if (!Object.keys(currentFields).includes(result.field)) {
    return { understood: false, field: '', newValue: '' };
  }
  return result;
}
