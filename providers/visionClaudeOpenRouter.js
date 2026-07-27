import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { OPENROUTER_BASE_URL, STORAGE_KEYS } from '../constants/wiretrace';

const CLAUDE_MODEL = 'anthropic/claude-sonnet-4.5';

async function getOpenRouterKey() {
  const stored = await SecureStore.getItemAsync(STORAGE_KEYS.API_KEY);
  return stored ? stored.trim() : '';
}

function validateOpenRouterKeyFormat(apiKey) {
  if (!String(apiKey || '').startsWith('sk-or-')) {
    throw new Error(
      'OpenRouter API key appears invalid. It should start with "sk-or-". Please update it in Settings.'
    );
  }
}

function guessMimeType(uri) {
  const lower = String(uri || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

async function normalizeImageUri(uri) {
  if (typeof uri !== 'string' || !uri) {
    throw new Error('A valid image URI is required.');
  }

  if (uri.startsWith('data:') || uri.startsWith('http://') || uri.startsWith('https://')) {
    return uri;
  }

  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return `data:${guessMimeType(uri)};base64,${base64}`;
}

async function callClaudeVision(uri, prompt) {
  const apiKey = await getOpenRouterKey();

  if (!apiKey) {
    throw new Error('No OpenRouter API key configured. Please add your API key in Settings.');
  }
  validateOpenRouterKeyFormat(apiKey);

  const imageUrl = await normalizeImageUri(uri);

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://wiretrace.ai',
      'X-Title': 'WireTrace AI',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401) {
      throw new Error(
        'OpenRouter API error 401 (Unauthorized). Verify your OpenRouter key in Settings and ensure your request includes Authorization: Bearer <key>, HTTP-Referer, and X-Title headers.'
      );
    }
    throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('No content returned from Claude via OpenRouter.');
  }

  return typeof content === 'string' ? content.trim() : String(content);
}

export async function visionClaude(uri, prompt) {
  return callClaudeVision(uri, prompt);
}