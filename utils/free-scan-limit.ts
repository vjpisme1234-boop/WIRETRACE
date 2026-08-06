import * as SecureStore from 'expo-secure-store';
import { STORAGE_KEYS } from '@/constants/wiretrace';

// Closed-test mode: the caps below exist to bound cost/abuse on the shared
// built-in key for the public App Store release. During a small trusted
// closed test (e.g. 12 testers over 14 days) they'd only get in the way, so
// this flag skips the block-on-limit check without touching the underlying
// counters — usage still gets tracked, it just never blocks anyone. Set
// back to false before a public release.
const DISABLE_FREE_LIMITS_FOR_CLOSED_TEST = true;

// Number of schematic scans an install can run on the app's built-in free
// Gemini key before being asked to add their own API key. This is a soft,
// per-install cap (SecureStore, no accounts/server) meant to bound the
// developer's shared Gemini quota/cost — not an anti-abuse control.
export const FREE_SCAN_LIMIT = 100;

export async function getFreeScanCount(): Promise<number> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEYS.FREE_SCAN_COUNT);
    const count = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(count) && count >= 0 ? count : 0;
  } catch (error) {
    console.error('[FreeScanLimit] Failed to read scan count', error);
    return 0;
  }
}

export async function getRemainingFreeScans(): Promise<number> {
  if (DISABLE_FREE_LIMITS_FOR_CLOSED_TEST) return Infinity;
  const used = await getFreeScanCount();
  return Math.max(0, FREE_SCAN_LIMIT - used);
}

export async function incrementFreeScanCount(): Promise<number> {
  const next = (await getFreeScanCount()) + 1;
  await SecureStore.setItemAsync(STORAGE_KEYS.FREE_SCAN_COUNT, String(next));
  return next;
}

// Text-only AI calls (reading-step generation, Ask AI, voice corrections)
// previously had NO cap at all on the built-in Gemini key — unlike scans,
// nothing stopped a single install from generating unbounded requests
// against the shared key. This bounds that the same way, with a higher
// ceiling since these calls are far more frequent per session than scans.
export const FREE_TEXT_GENERATION_LIMIT = 300;

export async function getFreeTextGenerationCount(): Promise<number> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEYS.FREE_TEXT_GENERATION_COUNT);
    const count = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(count) && count >= 0 ? count : 0;
  } catch (error) {
    console.error('[FreeScanLimit] Failed to read text generation count', error);
    return 0;
  }
}

export async function getRemainingFreeTextGenerations(): Promise<number> {
  if (DISABLE_FREE_LIMITS_FOR_CLOSED_TEST) return Infinity;
  const used = await getFreeTextGenerationCount();
  return Math.max(0, FREE_TEXT_GENERATION_LIMIT - used);
}

export async function incrementFreeTextGenerationCount(): Promise<number> {
  const next = (await getFreeTextGenerationCount()) + 1;
  await SecureStore.setItemAsync(STORAGE_KEYS.FREE_TEXT_GENERATION_COUNT, String(next));
  return next;
}
