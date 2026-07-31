import * as SecureStore from 'expo-secure-store';
import { STORAGE_KEYS } from '@/constants/wiretrace';

// Number of schematic scans an install can run on the app's built-in free
// Gemini key before being asked to add their own API key. This is a soft,
// per-install cap (SecureStore, no accounts/server) meant to bound the
// developer's shared Gemini quota/cost — not an anti-abuse control.
export const FREE_SCAN_LIMIT = 10;

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
  const used = await getFreeScanCount();
  return Math.max(0, FREE_SCAN_LIMIT - used);
}

export async function incrementFreeScanCount(): Promise<number> {
  const next = (await getFreeScanCount()) + 1;
  await SecureStore.setItemAsync(STORAGE_KEYS.FREE_SCAN_COUNT, String(next));
  return next;
}
