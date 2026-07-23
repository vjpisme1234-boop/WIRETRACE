import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/constants/wiretrace';

export interface WireInfo {
  id: string;
  label: string;
  color?: string;
  fromPoint: string;
  toPoint: string;
}

export interface ComponentInfo {
  id: string;
  type: string;
  label: string;
  description: string;
  isUnknown: boolean;
  userIdentifiedAs?: string;
}

export interface Connection {
  id: string;
  from: string;
  to: string;
  wireLabel: string;
  description: string;
}

export interface UnknownSymbol {
  id: string;
  description: string;
  imageRegion?: { x: number; y: number; width: number; height: number };
  userIdentifiedAs?: string;
}

export interface ReadingStep {
  id: string;
  stepNumber: number;
  wireLabel?: string;
  componentLabel?: string;
  instruction: string;
  detail?: string;
  specialInstruction?: string;
}

export interface SchematicAnalysis {
  id: string;
  imageUri: string;
  analyzedAt: string;
  name: string;
  wireCount: number;
  componentCount: number;
  wires: WireInfo[];
  components: ComponentInfo[];
  connections: Connection[];
  unknownSymbols: UnknownSymbol[];
  readingSteps: ReadingStep[];
}

export async function loadSchematics(): Promise<SchematicAnalysis[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.SCHEMATICS);
    if (!raw) return [];
    return JSON.parse(raw) as SchematicAnalysis[];
  } catch (e) {
    console.error('[Storage] Failed to load schematics', e);
    return [];
  }
}

export async function saveSchematic(schematic: SchematicAnalysis): Promise<void> {
  try {
    const existing = await loadSchematics();
    const idx = existing.findIndex((s) => s.id === schematic.id);
    if (idx >= 0) {
      existing[idx] = schematic;
    } else {
      existing.unshift(schematic);
    }
    await AsyncStorage.setItem(STORAGE_KEYS.SCHEMATICS, JSON.stringify(existing));
    console.log('[Storage] Schematic saved', { id: schematic.id });
  } catch (e) {
    console.error('[Storage] Failed to save schematic', e);
    throw e;
  }
}

export async function deleteSchematic(id: string): Promise<void> {
  try {
    const existing = await loadSchematics();
    const filtered = existing.filter((s) => s.id !== id);
    await AsyncStorage.setItem(STORAGE_KEYS.SCHEMATICS, JSON.stringify(filtered));
    console.log('[Storage] Schematic deleted', { id });
  } catch (e) {
    console.error('[Storage] Failed to delete schematic', e);
    throw e;
  }
}

export async function getSchematic(id: string): Promise<SchematicAnalysis | null> {
  const all = await loadSchematics();
  return all.find((s) => s.id === id) ?? null;
}

export async function updateSchematic(id: string, updates: Partial<SchematicAnalysis>): Promise<void> {
  const existing = await loadSchematics();
  const idx = existing.findIndex((s) => s.id === id);
  if (idx < 0) throw new Error(`Schematic ${id} not found`);
  existing[idx] = { ...existing[idx], ...updates };
  await AsyncStorage.setItem(STORAGE_KEYS.SCHEMATICS, JSON.stringify(existing));
  console.log('[Storage] Schematic updated', { id, keys: Object.keys(updates) });
}

export function generateSchematicName(): string {
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'short' });
  const day = now.getDate();
  const time = now.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `Schematic - ${month} ${day} ${time}`;
}
