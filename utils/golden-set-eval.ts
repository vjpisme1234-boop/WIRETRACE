import { analyzeSchematic } from '@/utils/openrouter';
import { AccuracyReport, formatReport, GoldenSchematic, scoreAnalysis } from '@/utils/accuracy-scoring';

export interface GoldenSetEntry {
  base64Image: string;
  truth: GoldenSchematic;
}

export interface GoldenSetResult {
  id: string;
  report: AccuracyReport;
  formatted: string;
}

/**
 * Runs each golden-set entry through the real analysis pipeline (real AI
 * call, real fallback chain) and scores the result against its hand-verified
 * ground truth. This is the only honest way to know whether a prompt/model
 * change actually helped — call it from a dev-only screen or debug action
 * once real, hand-verified entries exist. See eval/golden-set/README.md for
 * the entry format.
 */
export async function runGoldenSetEval(
  entries: GoldenSetEntry[]
): Promise<{ results: GoldenSetResult[]; summary: string }> {
  const results: GoldenSetResult[] = [];

  for (const entry of entries) {
    console.log(`[GoldenSet] Running ${entry.truth.id}...`);
    const predicted = await analyzeSchematic(entry.base64Image);
    const report = scoreAnalysis(predicted, entry.truth);
    results.push({ id: entry.truth.id, report, formatted: formatReport(report, entry.truth.id) });
  }

  const avg = (key: keyof AccuracyReport): number => {
    const nums = results
      .map((r) => r.report[key])
      .filter((n): n is number => typeof n === 'number');
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
  };

  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  const summaryLines = [
    `Golden-set run: ${entries.length} schematic(s)`,
    `Average wire recall: ${pct(avg('wireRecall'))}, precision: ${pct(avg('wirePrecision'))}`,
    `Average component recall: ${pct(avg('componentRecall'))}, precision: ${pct(avg('componentPrecision'))}`,
    `Average connection recall: ${pct(avg('connectionRecall'))}, precision: ${pct(avg('connectionPrecision'))}`,
    '',
    ...results.map((r) => r.formatted),
  ];

  return { results, summary: summaryLines.join('\n') };
}
