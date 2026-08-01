// Compares an AI analysis result against a hand-verified "ground truth" and
// computes recall/precision so prompt/model changes can be measured instead
// of guessed at. Pure logic, no AI calls or RN dependencies — testable in
// isolation.

export interface WireGroundTruth {
  label: string;
  fromPoint: string;
  toPoint: string;
  color?: string;
}

export interface ComponentGroundTruth {
  label: string;
  type: string;
}

export interface ConnectionGroundTruth {
  from: string;
  to: string;
  wireLabel: string;
}

export interface GoldenSchematic {
  id: string;
  /** Path to the reference photo, supplied by whoever builds the golden set. */
  imagePath: string;
  wires: WireGroundTruth[];
  components: ComponentGroundTruth[];
  connections: ConnectionGroundTruth[];
}

interface PredictedAnalysis {
  wires: { label: string; fromPoint: string; toPoint: string }[];
  components: { label: string; type: string }[];
  connections: { from: string; to: string; wireLabel: string }[];
}

export interface AccuracyReport {
  wireRecall: number;
  wirePrecision: number;
  componentRecall: number;
  componentPrecision: number;
  connectionRecall: number;
  connectionPrecision: number;
  missingWires: string[];
  extraWires: string[];
  wrongWireEndpoints: string[];
  missingComponents: string[];
  extraComponents: string[];
  missingConnections: string[];
  extraConnections: string[];
}

function norm(s: string): string {
  return s.trim().toUpperCase();
}

export function scoreAnalysis(predicted: PredictedAnalysis, truth: GoldenSchematic): AccuracyReport {
  // Wires — match by label, then check endpoints agree.
  const predWireMap = new Map(predicted.wires.map((w) => [norm(w.label), w]));
  const truthWireMap = new Map(truth.wires.map((w) => [norm(w.label), w]));

  const missingWires: string[] = [];
  const wrongWireEndpoints: string[] = [];
  let wireMatches = 0;
  truth.wires.forEach((tw) => {
    const pw = predWireMap.get(norm(tw.label));
    if (!pw) {
      missingWires.push(tw.label);
      return;
    }
    if (norm(pw.fromPoint) === norm(tw.fromPoint) && norm(pw.toPoint) === norm(tw.toPoint)) {
      wireMatches++;
    } else {
      wrongWireEndpoints.push(tw.label);
    }
  });
  const extraWires = predicted.wires.filter((pw) => !truthWireMap.has(norm(pw.label))).map((w) => w.label);

  const wireRecall = truth.wires.length ? wireMatches / truth.wires.length : 1;
  const wirePrecision = predicted.wires.length ? wireMatches / predicted.wires.length : 1;

  // Components — match by label, then check type agrees.
  const predCompMap = new Map(predicted.components.map((c) => [norm(c.label), c]));
  const truthCompMap = new Map(truth.components.map((c) => [norm(c.label), c]));
  const missingComponents: string[] = [];
  let compMatches = 0;
  truth.components.forEach((tc) => {
    const pc = predCompMap.get(norm(tc.label));
    if (!pc) {
      missingComponents.push(tc.label);
      return;
    }
    if (norm(pc.type) === norm(tc.type)) {
      compMatches++;
    } else {
      missingComponents.push(`${tc.label} (type mismatch: got "${pc.type}", expected "${tc.type}")`);
    }
  });
  const extraComponents = predicted.components.filter((pc) => !truthCompMap.has(norm(pc.label))).map((c) => c.label);
  const componentRecall = truth.components.length ? compMatches / truth.components.length : 1;
  const componentPrecision = predicted.components.length ? compMatches / predicted.components.length : 1;

  // Connections — match by the full (from, to, wireLabel) triple.
  const connKey = (c: { from: string; to: string; wireLabel: string }) =>
    `${norm(c.from)}|${norm(c.to)}|${norm(c.wireLabel)}`;
  const predConnSet = new Set(predicted.connections.map(connKey));
  const truthConnSet = new Set(truth.connections.map(connKey));
  const missingConnections = truth.connections
    .filter((c) => !predConnSet.has(connKey(c)))
    .map((c) => `${c.wireLabel}: ${c.from} -> ${c.to}`);
  const extraConnections = predicted.connections
    .filter((c) => !truthConnSet.has(connKey(c)))
    .map((c) => `${c.wireLabel}: ${c.from} -> ${c.to}`);
  const connMatches = truth.connections.length - missingConnections.length;
  const connectionRecall = truth.connections.length ? connMatches / truth.connections.length : 1;
  const connectionPrecision = predicted.connections.length ? connMatches / predicted.connections.length : 1;

  return {
    wireRecall,
    wirePrecision,
    componentRecall,
    componentPrecision,
    connectionRecall,
    connectionPrecision,
    missingWires,
    extraWires,
    wrongWireEndpoints,
    missingComponents,
    extraComponents,
    missingConnections,
    extraConnections,
  };
}

export function formatReport(report: AccuracyReport, label: string): string {
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  const lines = [
    `Accuracy report: ${label}`,
    `  Wires:       recall ${pct(report.wireRecall)}, precision ${pct(report.wirePrecision)}`,
    `  Components:  recall ${pct(report.componentRecall)}, precision ${pct(report.componentPrecision)}`,
    `  Connections: recall ${pct(report.connectionRecall)}, precision ${pct(report.connectionPrecision)}`,
  ];
  if (report.missingWires.length) lines.push(`  Missing wires: ${report.missingWires.join(', ')}`);
  if (report.extraWires.length) lines.push(`  Extra/hallucinated wires: ${report.extraWires.join(', ')}`);
  if (report.wrongWireEndpoints.length) lines.push(`  Wires with wrong endpoints: ${report.wrongWireEndpoints.join(', ')}`);
  if (report.missingComponents.length) lines.push(`  Missing/wrong components: ${report.missingComponents.join(', ')}`);
  if (report.extraComponents.length) lines.push(`  Extra/hallucinated components: ${report.extraComponents.join(', ')}`);
  if (report.missingConnections.length) lines.push(`  Missing connections: ${report.missingConnections.join(', ')}`);
  if (report.extraConnections.length) lines.push(`  Extra/hallucinated connections: ${report.extraConnections.join(', ')}`);
  return lines.join('\n');
}
