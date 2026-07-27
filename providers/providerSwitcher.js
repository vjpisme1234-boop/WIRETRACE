import { visionClaude } from './visionClaudeOpenRouter';
import { visionOpenAI } from './visionOpenAI';
import { visionGroq } from './visionGroq';

export async function runVision(provider, uri, prompt) {
  const normalizedProvider = String(provider || '').toLowerCase();

  switch (normalizedProvider) {
    case 'claude':
      return visionClaude(uri, prompt);
    case 'openai':
      return visionOpenAI(uri, prompt);
    case 'groq':
      return visionGroq(uri, prompt);
    default:
      throw new Error(
        `Unsupported vision provider: ${provider}. Expected one of: claude, openai, groq.`
      );
  }
}