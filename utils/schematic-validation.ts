// Deterministic, non-AI consistency checks run against a freshly parsed
// schematic analysis. Catches structural hallucination (a connection
// pointing at a wire/terminal the model never actually declared) for free,
// with no extra AI calls — informational only, never blocks the scan.

interface ValidationWire {
  label: string;
  fromPoint: string;
  toPoint: string;
}

interface ValidationComponent {
  label: string;
}

interface ValidationConnection {
  from: string;
  to: string;
  wireLabel: string;
}

interface ValidationInput {
  wires: ValidationWire[];
  components: ValidationComponent[];
  connections: ValidationConnection[];
}

export function validateAnalysisConsistency(analysis: ValidationInput): string[] {
  const warnings: string[] = [];

  const wireLabels = new Set(analysis.wires.map((w) => w.label));
  const componentLabels = new Set(analysis.components.map((c) => c.label.toUpperCase().trim()));
  const declaredPoints = new Set<string>();
  analysis.wires.forEach((w) => {
    declaredPoints.add(w.fromPoint.trim());
    declaredPoints.add(w.toPoint.trim());
  });

  function pointIsKnown(point: string): boolean {
    const p = point.trim();
    if (!p) return true;
    if (declaredPoints.has(p)) return true;
    const prefix = p.split(/[-\s]/)[0].toUpperCase();
    return componentLabels.has(prefix) || componentLabels.has(p.toUpperCase());
  }

  // A connection's wire label should match something actually in the wires list.
  analysis.connections.forEach((c) => {
    if (c.wireLabel && !wireLabels.has(c.wireLabel)) {
      warnings.push(`Connection references wire "${c.wireLabel}", which isn't in the extracted wire list.`);
    }
  });

  // A connection's endpoints should tie back to a declared wire endpoint or component.
  analysis.connections.forEach((c) => {
    if (!pointIsKnown(c.from)) {
      warnings.push(`Connection "${c.wireLabel || '?'}" references "${c.from}", which doesn't match any declared wire or component.`);
    }
    if (!pointIsKnown(c.to)) {
      warnings.push(`Connection "${c.wireLabel || '?'}" references "${c.to}", which doesn't match any declared wire or component.`);
    }
  });

  // The same wire label showing up on multiple different endpoint pairs is
  // either a real jumper or a mislabel — flag it either way so a human checks.
  const wireLabelPairs = new Map<string, Set<string>>();
  analysis.wires.forEach((w) => {
    const pairKey = `${w.fromPoint.trim()}->${w.toPoint.trim()}`;
    if (!wireLabelPairs.has(w.label)) wireLabelPairs.set(w.label, new Set());
    wireLabelPairs.get(w.label)!.add(pairKey);
  });
  wireLabelPairs.forEach((pairs, label) => {
    if (pairs.size > 1) {
      warnings.push(`Wire "${label}" appears with ${pairs.size} different terminal pairs — verify this isn't a duplicate label.`);
    }
  });

  return warnings;
}
