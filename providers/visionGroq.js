import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { STORAGE_KEYS } from '../constants/wiretrace';

const GROQ_MODEL = process.env.EXPO_PUBLIC_GROQ_MODEL || 'llama-3.2-11b-vision-preview';

async function getGroqKey() {
  const stored = await SecureStore.getItemAsync(STORAGE_KEYS.GROQ_API_KEY);
  return stored ? stored.trim() : '';
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

export async function visionGroq(uri, prompt) {
  const apiKey = await getGroqKey();

  if (!apiKey) {
    throw new Error('No Groq API key configured. Add it in Settings.');
  }

  const imageUrl = await normalizeImageUri(uri);

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
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
    throw new Error(`Groq API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('No content returned from Groq.');
  }

  return typeof content === 'string' ? content.trim() : String(content);
}