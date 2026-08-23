import * as FileSystem from 'expo-file-system/legacy';
import type { GoldenSchematic } from '@/utils/accuracy-scoring';
import type { SchematicAnalysis } from '@/utils/schematic-storage';

const GOLDEN_DIR = FileSystem.documentDirectory + 'golden-set/';

/**
 * Turns a corrected schematic into a golden-set entry.
 *
 * Ground truth is whatever the human settled on, so a component the user
 * re-identified wins over the type the AI guessed — otherwise the eval scores
 * the AI against its own mistakes and every run looks perfect.
 */
export function toGoldenSchematic(schematic: SchematicAnalysis, imagePath?: string): GoldenSchematic {
  return {
    id: schematic.id,
    imagePath: imagePath ?? `./${schematic.id}.jpg`,
    wires: schematic.wires.map((w) => ({
      label: w.label,
      fromPoint: w.fromPoint,
      toPoint: w.toPoint,
      ...(w.color ? { color: w.color } : {}),
    })),
    components: schematic.components.map((c) => ({
      label: c.label,
      type: c.userIdentifiedAs ?? c.type,
    })),
    connections: schematic.connections.map((c) => ({
      from: c.from,
      to: c.to,
      wireLabel: c.wireLabel,
    })),
  };
}

/**
 * Why a scan is not fit to be ground truth. Empty means it is.
 *
 * Exporting a scan nobody checked would measure the AI against its own output
 * and report 100% no matter how wrong it was, which is worse than having no
 * golden set at all — a meaningless number still gets believed.
 */
export function goldenSetBlockers(schematic: SchematicAnalysis): string[] {
  const blockers: string[] = [];
  if (!schematic.isStandard) {
    blockers.push('This scan has not been verified. Correct every mistake and save it as a standard first.');
  }
  if (schematic.wires.length === 0) {
    blockers.push('No wires — nothing to score against.');
  }
  const unresolved = schematic.components.filter((c) => c.isUnknown && !c.userIdentifiedAs).length;
  if (unresolved > 0) {
    blockers.push(`${unresolved} component${unresolved === 1 ? '' : 's'} still unidentified.`);
  }
  const blankEndpoints = schematic.wires.filter((w) => !w.fromPoint.trim() || !w.toPoint.trim()).length;
  if (blankEndpoints > 0) {
    blockers.push(`${blankEndpoints} wire${blankEndpoints === 1 ? '' : 's'} missing an endpoint — fill both ends or drop the wire.`);
  }
  return blockers;
}

/**
 * Writes the entry to the app's document directory and returns its path. The
 * file is pulled off the device with adb and committed to eval/golden-set/.
 *
 * The JSON is also logged, because a release build cannot be reached with
 * `adb run-as` and logcat is then the only way off the phone.
 */
export async function exportGoldenEntry(
  schematic: SchematicAnalysis,
  imagePath?: string
): Promise<{ path: string; json: string; blockers: string[] }> {
  const blockers = goldenSetBlockers(schematic);
  const entry = toGoldenSchematic(schematic, imagePath);
  const json = JSON.stringify(entry, null, 2);

  const info = await FileSystem.getInfoAsync(GOLDEN_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(GOLDEN_DIR, { intermediates: true });
  }
  const path = `${GOLDEN_DIR}${schematic.id}.json`;
  await FileSystem.writeAsStringAsync(path, json);

  console.log('[GoldenSet] Exported entry', { id: schematic.id, path, blockers });
  console.log('[GoldenSet] BEGIN ENTRY');
  console.log(json);
  console.log('[GoldenSet] END ENTRY');

  return { path, json, blockers };
}
