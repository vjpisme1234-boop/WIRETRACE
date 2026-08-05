import type { Connection, ReadingStep, WireInfo } from '@/utils/schematic-storage';

export interface JunctionOption {
  to: string;
  wireLabel: string;
  description: string;
}

export interface JunctionChoice {
  terminal: string;
  options: JunctionOption[];
}

/**
 * A junction is a terminal where more than one wire leaves — i.e. a point
 * where following the schematic linearly requires picking a direction.
 * Grouped by "from" since that's the point a reader is standing at when the
 * path branches.
 */
export function findJunctions(connections: Connection[]): JunctionChoice[] {
  const byTerminal = new Map<string, Connection[]>();
  for (const c of connections) {
    if (!c.from || !c.to) continue;
    const list = byTerminal.get(c.from) ?? [];
    list.push(c);
    byTerminal.set(c.from, list);
  }

  const junctions: JunctionChoice[] = [];
  byTerminal.forEach((conns, terminal) => {
    if (conns.length >= 2) {
      junctions.push({
        terminal,
        options: conns.map((c) => ({ to: c.to, wireLabel: c.wireLabel, description: c.description })),
      });
    }
  });
  return junctions;
}

const ORDINAL_WORDS: Record<string, number> = {
  first: 0, one: 0, '1': 0, primero: 0, uno: 0,
  second: 1, two: 1, '2': 1, segundo: 1, dos: 1,
  third: 2, three: 2, '3': 2, tercero: 2, tres: 2,
  fourth: 3, four: 3, '4': 3, cuarto: 3, cuatro: 3,
};

/**
 * Best-effort match of a spoken transcript against a junction's options —
 * by wire number mention first, then by ordinal word ("first"/"second"/
 * "primero"/"segundo"), matching the same handful of commands already used
 * for "next"/"back"/"repeat" elsewhere in the Reader.
 */
export function matchJunctionAnswer(transcript: string, junction: JunctionChoice): JunctionOption | null {
  const normalized = transcript.toLowerCase().trim();

  for (const opt of junction.options) {
    if (opt.wireLabel && normalized.includes(opt.wireLabel.toLowerCase())) {
      return opt;
    }
  }

  for (const word of Object.keys(ORDINAL_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(normalized)) {
      const idx = ORDINAL_WORDS[word];
      if (junction.options[idx]) return junction.options[idx];
    }
  }

  return null;
}

function normalizeWireLabel(value?: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/^wire\s+/, '')
    .trim();
}

/**
 * The reader follows a single linear path per generation pass, and the AI
 * only stops for a branch when it self-reports one via pendingChoice — it
 * can reach the end of a path and declare the schematic "complete" without
 * ever having produced a step for every wire (e.g. a parallel run it never
 * traced). This checks deterministically, against the wires the schematic
 * analysis actually found, rather than trusting the AI's own bookkeeping.
 */
export function getUncoveredWires(wires: WireInfo[], steps: ReadingStep[]): WireInfo[] {
  const covered = new Set(
    steps.map((s) => normalizeWireLabel(s.wireLabel)).filter((label) => label.length > 0)
  );
  return wires.filter((w) => !covered.has(normalizeWireLabel(w.label)));
}
