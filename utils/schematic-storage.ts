import * as FileSystem from 'expo-file-system/legacy';

const SCHEMATICS_DIR = FileSystem.documentDirectory + 'schematics/';
const INDEX_FILE = SCHEMATICS_DIR + '_index.json';

export interface WireInfo {
  id: string;
  label: string;
  color?: string;
  fromPoint: string;
  toPoint: string;
  voltage?: string;
  confidence?: number;
}

export interface ComponentInfo {
  id: string;
  type: string;
  label: string;
  description: string;
  isUnknown: boolean;
  userIdentifiedAs?: string;
  confidence?: number;
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
  summary?: string;
  wireCount: number;
  componentCount: number;
  wires: WireInfo[];
  components: ComponentInfo[];
  connections: Connection[];
  unknownSymbols: UnknownSymbol[];
  readingSteps: ReadingStep[];
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(SCHEMATICS_DIR);
  if (!info.exists) {
    console.log('[Storage] Creating schematics directory');
    await FileSystem.makeDirectoryAsync(SCHEMATICS_DIR, { intermediates: true });
  }
}

async function readIndex(): Promise<string[]> {
  try {
    const info = await FileSystem.getInfoAsync(INDEX_FILE);
    if (!info.exists) return [];
    const raw = await FileSystem.readAsStringAsync(INDEX_FILE);
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

async function writeIndex(ids: string[]): Promise<void> {
  await FileSystem.writeAsStringAsync(INDEX_FILE, JSON.stringify(ids));
}

function schematicPath(id: string): string {
  return SCHEMATICS_DIR + id + '.json';
}

export async function loadSchematics(): Promise<SchematicAnalysis[]> {
  try {
    await ensureDir();
    const ids = await readIndex();
    const results: SchematicAnalysis[] = [];
    for (const id of ids) {
      try {
        const raw = await FileSystem.readAsStringAsync(schematicPath(id));
        results.push(JSON.parse(raw) as SchematicAnalysis);
      } catch (e) {
        console.warn('[Storage] Could not read schematic file', { id, e });
      }
    }
    return results;
  } catch (e) {
    console.error('[Storage] Failed to load schematics', e);
    return [];
  }
}

export async function saveSchematic(schematic: SchematicAnalysis): Promise<void> {
  try {
    await ensureDir();
    const ids = await readIndex();
    const exists = ids.includes(schematic.id);
    if (!exists) {
      // Prepend new IDs so newest appears first
      ids.unshift(schematic.id);
      await writeIndex(ids);
    }
    await FileSystem.writeAsStringAsync(schematicPath(schematic.id), JSON.stringify(schematic));
    console.log('[Storage] Schematic saved', { id: schematic.id });
  } catch (e) {
    console.error('[Storage] Failed to save schematic', e);
    throw e;
  }
}

export async function deleteSchematic(id: string): Promise<void> {
  try {
    await ensureDir();
    const ids = await readIndex();
    const filtered = ids.filter((i) => i !== id);
    await writeIndex(filtered);
    const path = schematicPath(id);
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) {
      await FileSystem.deleteAsync(path);
    }
    console.log('[Storage] Schematic deleted', { id });
  } catch (e) {
    console.error('[Storage] Failed to delete schematic', e);
    throw e;
  }
}

export async function getSchematic(id: string): Promise<SchematicAnalysis | null> {
  try {
    await ensureDir();
    const path = schematicPath(id);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(path);
    return JSON.parse(raw) as SchematicAnalysis;
  } catch (e) {
    console.error('[Storage] Failed to get schematic', { id, e });
    return null;
  }
}

export async function updateSchematic(id: string, updates: Partial<SchematicAnalysis>): Promise<void> {
  const existing = await getSchematic(id);
  if (!existing) throw new Error(`Schematic ${id} not found`);
  const updated = { ...existing, ...updates };
  await FileSystem.writeAsStringAsync(schematicPath(id), JSON.stringify(updated));
  console.log('[Storage] Schematic updated', { id, keys: Object.keys(updates) });
}

export function generateSchematicName(): string {
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'short' });
  const day = now.getDate();
  const time = now.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `Schematic - ${month} ${day} ${time}`;
}
