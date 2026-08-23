import * as SecureStore from 'expo-secure-store';
import { STORAGE_KEYS } from '@/constants/wiretrace';

// Closed-test mode: skips the block-on-limit check without touching the
// underlying counters — usage still gets tracked, it just never blocks
// anyone. This is OFF for public release, so the caps below are live.
const DISABLE_FREE_LIMITS_FOR_CLOSED_TEST = false;

// Number of schematic scans an install can run on the app's built-in free
// Gemini key before being asked to add their own API key. This is a soft,
// per-install cap (SecureStore, no accounts/server) meant to bound the
// developer's shared Gemini quota/cost — not an anti-abuse control:
// reinstalling clears the counter, which is an accepted tradeoff for not
// running accounts or a server.
export const FREE_SCAN_LIMIT = 20;

// The counters kept incrementing all through closed test, when nothing was
// reading them as a stop. Switching the caps on would therefore apply them
// retroactively: a tester who ran 40 scans would be blocked on their first
// scan after updating, having never seen a free scan under the new rules. The
// allowance is baselined once, the first time an install runs a build whose
// epoch differs from the stored one, so everyone starts the new cap at zero.
// Bump CAP_EPOCH to grant a fresh allowance again in a future release.
const CAP_EPOCH = 'v2-scan20-text600';

async function ensureCapEpoch(): Promise<void> {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEYS.FREE_CAP_EPOCH);
    if (stored === CAP_EPOCH) return;
    console.log('[FreeScanLimit] New cap epoch — baselining free usage counters', { from: stored, to: CAP_EPOCH });
    await Promise.all([
      SecureStore.deleteItemAsync(STORAGE_KEYS.FREE_SCAN_COUNT),
      SecureStore.deleteItemAsync(STORAGE_KEYS.FREE_TEXT_GENERATION_COUNT),
    ]);
    await SecureStore.setItemAsync(STORAGE_KEYS.FREE_CAP_EPOCH, CAP_EPOCH);
  } catch (error) {
    // A failure here must not block scanning — worst case the user keeps the
    // counts they already had and the cap applies a little early.
    console.error('[FreeScanLimit] Failed to baseline counters for new cap epoch', error);
  }
}

export async function getFreeScanCount(): Promise<number> {
  try {
    // Settings reads this directly to draw the usage meter. Without the epoch
    // baseline it would show a pre-cap install its old uncapped total — e.g.
    // "45 of 20 free scans used" — and push a paid-key upsell at somebody the
    // scan path is about to grant a full 20 to.
    await ensureCapEpoch();
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
// ceiling: one scan drives many text calls, so this sits well above what 20
// scans need. The scan cap should be the one a user actually reaches, since
// that is the message that tells them to add their own key.
export const FREE_TEXT_GENERATION_LIMIT = 600;

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
  await ensureCapEpoch();
  const used = await getFreeTextGenerationCount();
  return Math.max(0, FREE_TEXT_GENERATION_LIMIT - used);
}

export async function incrementFreeTextGenerationCount(): Promise<number> {
  const next = (await getFreeTextGenerationCount()) + 1;
  await SecureStore.setItemAsync(STORAGE_KEYS.FREE_TEXT_GENERATION_COUNT, String(next));
  return next;
}
