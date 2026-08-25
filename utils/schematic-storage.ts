import * as FileSystem from 'expo-file-system/legacy';
import type { MultiPassCoverage } from '@/utils/multi-pass-analysis';
import type { ReadingStepsStopReason } from '@/utils/openrouter';
import type { JunctionChoice } from '@/utils/schematic-graph';

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
  /** Voice note recorded by the user, read aloud when the Reader reaches this wire. */
  userNote?: string;
}

export interface ComponentInfo {
  id: string;
  type: string;
  label: string;
  description: string;
  isUnknown: boolean;
  userIdentifiedAs?: string;
  confidence?: number;
  /** Voice note recorded by the user, read aloud when the Reader reaches this component. */
  userNote?: string;
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
  /** True when the AI could not identify an obvious starting point (no clear "Line 1"/L1). */
  startPointAmbiguous?: boolean;
  /** Set when step generation stopped at a branch the user hasn't resolved yet. */
  pendingJunction?: JunctionChoice | null;
  /** Why readingSteps end where they do, when they cover less than the whole drawing. Saved with the steps so the Reader and the saved-schematic list can explain a short reading too, not just the screen that generated it. Set back to null every time steps are regenerated or cleared — a reason describing a stop that no longer applies is worse than no reason at all. */
  stopReason?: ReadingStepsStopReason | null;
  /** Path choices the user has made at branch terminals: terminal -> chosen "to". */
  branchChoices?: Record<string, string>;
  /** The start label (wire/component name, "Line 1", "Last line") that readingSteps was generated for — lets the caller tell whether cached steps still match the user's current start-point selection. */
  readingStepsStartLabel?: string;
  /** User-picked subset and order of wire IDs for a custom reading pass — only these wires get read, in this exact order, when Start Point is set to "custom". */
  customWireOrder?: string[];
  /** Structural inconsistencies caught by deterministic post-validation (e.g. a connection referencing a wire/component that was never declared). Informational only — not blocking. */
  validationWarnings?: string[];
  /** How much of the drawing a High Detail scan actually got through. Absent on Standard scans, which have nothing per-pass to report. Stored rather than kept in screen state so the figures survive a trip to a sub-screen and back. */
  scanCoverage?: MultiPassCoverage;
  /** True once a user has verified this scan and saved it as a trusted reference for their team. */
  isStandard?: boolean;
  /** Display name for the standard, if different from the schematic's own name. */
  standardName?: string;
  /** User-dragged positions for diagram nodes in the Schematic View, keyed by node key. Overrides the auto-layout. */
  nodePositions?: Record<string, { x: number; y: number }>;
  /** User-dragged positions for note annotation bubbles in the Schematic View, keyed by wire/component id. */
  notePositions?: Record<string, { x: number; y: number }>;
}

/**
 * The stop-reason sentence in the crew's language. The English wording is
 * already written for display, so it is used as-is; Spanish is rebuilt from
 * the same kind and wire counts rather than falling back to English, because
 * the reason a reading stopped short is exactly the part a Spanish-reading
 * electrician cannot afford to miss. Kept beside the stored field because both
 * the analyze screen and the Reader's completion screen show this sentence.
 */
export function stopReasonText(reason: ReadingStepsStopReason, isSpanish: boolean): string {
  if (!isSpanish) return reason.message;
  const counts = `${reason.wiresCovered} de ${reason.wiresTotal} cables`;
  switch (reason.kind) {
    case 'truncated':
      return `La IA llegó a su límite de longitud a mitad del recorrido, así que esta lectura cubre solo ${counts}. Genérala de nuevo, o lee el resto en una segunda pasada desde donde termina esta.`;
    case 'salvaged':
      return `Parte de la respuesta de la IA llegó ilegible. Se recuperaron ${counts}, y cualquier bifurcación donde se haya detenido se perdió con el resto — genérala de nuevo para el recorrido completo.`;
    case 'branch':
      return `El recorrido se divide en una bifurcación, así que la lectura se detiene ahí en vez de adivinar qué cable seguir — ${counts} hasta ahora. Elige un cable en la bifurcación y continúa.`;
    case 'partial-coverage':
      return `Este recorrido cubre ${counts} — los demás se ramifican en otra parte del dibujo y pueden leerse en una segunda pasada.`;
  }
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

/** Verified schematics a user has explicitly saved as a trusted team reference. */
export async function listStandards(): Promise<SchematicAnalysis[]> {
  const all = await loadSchematics();
  return all.filter((s) => s.isStandard);
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
