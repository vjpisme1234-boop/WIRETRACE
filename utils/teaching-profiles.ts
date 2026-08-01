import * as SecureStore from 'expo-secure-store';
import { STORAGE_KEYS } from '@/constants/wiretrace';

// Lets a supervisor set up named reading profiles per crew/group — e.g.
// "Apprentices" (slower, explains terminology) vs "Journeymen" (fast, just
// the path). Builds on the existing TTS speed setting and the reading-step
// generation prompt rather than introducing a separate system.

export interface TeachingProfile {
  id: string;
  name: string;
  speed: 'slow' | 'normal' | 'fast';
  verbosity: 'concise' | 'detailed';
}

export async function loadTeachingProfiles(): Promise<TeachingProfile[]> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEYS.TEACHING_PROFILES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TeachingProfile[]) : [];
  } catch (e) {
    console.error('[TeachingProfiles] Failed to load profiles', e);
    return [];
  }
}

export async function saveTeachingProfiles(profiles: TeachingProfile[]): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEYS.TEACHING_PROFILES, JSON.stringify(profiles));
}

export async function getActiveProfileId(): Promise<string | null> {
  try {
    return (await SecureStore.getItemAsync(STORAGE_KEYS.ACTIVE_TEACHING_PROFILE)) || null;
  } catch (e) {
    console.error('[TeachingProfiles] Failed to load active profile', e);
    return null;
  }
}

export async function setActiveProfileId(id: string | null): Promise<void> {
  if (id) {
    await SecureStore.setItemAsync(STORAGE_KEYS.ACTIVE_TEACHING_PROFILE, id);
  } else {
    await SecureStore.deleteItemAsync(STORAGE_KEYS.ACTIVE_TEACHING_PROFILE);
  }
}

export async function getActiveProfile(): Promise<TeachingProfile | null> {
  const [profiles, activeId] = await Promise.all([loadTeachingProfiles(), getActiveProfileId()]);
  if (!activeId) return null;
  return profiles.find((p) => p.id === activeId) ?? null;
}
