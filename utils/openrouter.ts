import * as SecureStore from 'expo-secure-store';
import { OPENROUTER_API_KEY, OPENROUTER_BASE_URL, OPENROUTER_MODEL, STORAGE_KEYS } from '@/constants/wiretrace';
import type { SchematicAnalysis, ReadingStep } from '@/utils/schematic-storage';

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
  if (!apiKey.trim()) {
    throw new Error('OpenRouter API key is missing. Add one in Settings before running AI analysis.');
  }
  console.log('[OpenRouter] Making API request', { model: OPENROUTER_MODEL, messageCount: messages.length });

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://wiretrace.ai',
      'X-Title': 'WireTrace AI',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      max_tokens: 4096,
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

export interface AnalysisResult {
  wires: { id: string; label: string; color?: string; fromPoint: string; toPoint: string }[];
  components: { id: string; type: string; label: string; description: string; isUnknown: boolean }[];
  connections: { id: string; from: string; to: string; wireLabel: string; description: string }[];
  unknownSymbols: { id: string; description: string; imageRegion?: { x: number; y: number; width: number; height: number } }[];
  summary: string;
}

export async function analyzeSchematic(base64Image: string): Promise<AnalysisResult> {
  console.log('[OpenRouter] analyzeSchematic called, image size:', base64Image.length);

  const systemPrompt = `You are an expert electrical engineer analyzing wire schematics. Extract ALL information from the schematic image with precision. Return a JSON object with this exact structure:
{
  "wires": [{ "id": "w1", "label": "Wire 14", "color": "red", "fromPoint": "TB1-1", "toPoint": "CR1-A1" }],
  "components": [{ "id": "c1", "type": "relay", "label": "CR1", "description": "Control relay coil", "isUnknown": false }],
  "connections": [{ "id": "conn1", "from": "TB1-1", "to": "CR1-A1", "wireLabel": "Wire 14", "description": "Wire 14 runs from Terminal Block TB1 pin 1 to Control Relay CR1 coil terminal A1" }],
  "unknownSymbols": [{ "id": "u1", "description": "Unrecognized symbol near top-right, possibly a sensor or specialty component" }],
  "summary": "This schematic shows a motor control circuit with 3 relays, 2 terminal blocks, and 1 transformer."
}
Identify ALL standard electrical symbols: transformers (T), resistors (R), capacitors (C), diodes (D), relays (CR/K), fuses (F/FU), switches (S/SW), motors (M), terminals (TB/X), grounds, power supplies, contactors, overloads, PLCs, VFDs, circuit breakers, solenoids, sensors. If a symbol is not recognized, add it to unknownSymbols. Return ONLY valid JSON, no markdown.`;

  const content = await callOpenRouter([
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Analyze this electrical schematic and extract all wiring information.' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
      ],
    },
  ]);

  try {
    // Strip markdown code fences if present
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned) as AnalysisResult;
    console.log('[OpenRouter] analyzeSchematic parsed', {
      wires: parsed.wires?.length,
      components: parsed.components?.length,
      connections: parsed.connections?.length,
      unknownSymbols: parsed.unknownSymbols?.length,
    });
    return parsed;
  } catch (e) {
    console.error('[OpenRouter] Failed to parse analysis JSON', e, content.slice(0, 200));
    throw new Error('AI returned malformed JSON. Please try again.');
  }
}

export async function generateReadingSteps(
  analysis: AnalysisResult,
  direction: 'forward' | 'backward',
  startPoint: string
): Promise<ReadingStep[]> {
  console.log('[OpenRouter] generateReadingSteps called', { direction, startPoint });

  const systemPrompt = `You are a wire tracing assistant. Given the schematic analysis data and reading preferences, generate step-by-step reading instructions. Each step should be a clear, spoken instruction like a technician would say it aloud. Include wire numbers, terminal designations, and component labels. Return a JSON array of ReadingStep objects with this structure:
[{ "id": "s1", "stepNumber": 1, "wireLabel": "Wire 14", "componentLabel": "CR1", "instruction": "Wire 14 connects from Terminal Block TB1 pin 1 to Control Relay CR1 coil terminal A1", "detail": "This is a 24VDC control circuit wire", "specialInstruction": "Verify polarity before connecting" }]
Return ONLY valid JSON array, no markdown.`;

  const userMessage = `Generate reading steps for this schematic analysis:
Direction: ${direction}
Start point: ${startPoint}
Analysis data: ${JSON.stringify(analysis, null, 2)}`;

  const content = await callOpenRouter([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ]);

  try {
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const steps = JSON.parse(cleaned) as ReadingStep[];
    console.log('[OpenRouter] generateReadingSteps parsed', { stepCount: steps.length });
    return steps;
  } catch (e) {
    console.error('[OpenRouter] Failed to parse reading steps JSON', e);
    throw new Error('AI returned malformed steps. Please try again.');
  }
}

export async function getSymbolClarification(symbolType: string): Promise<string> {
  console.log('[OpenRouter] getSymbolClarification called', { symbolType });

  const content = await callOpenRouter([
    {
      role: 'user',
      content: `Given that this symbol is a ${symbolType}, provide a brief technical description and any special wiring considerations for this component in 1-2 sentences. Be concise and practical for an electrician.`,
    },
  ]);

  console.log('[OpenRouter] getSymbolClarification response received');
  return content.trim();
}
