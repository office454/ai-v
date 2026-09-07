import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateHistoricalWalkForward,
  type HistoricalBenchmarkOptions
} from "../src/services/historicalBenchmarkService.js";
import type { HistoricalFeatureRow } from "../src/services/historicalFeatureService.js";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function numericArgument(name: string, fallback: number): number {
  const raw = argument(name);
  const parsed = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`--${name} must be numeric`);
  }
  return parsed;
}

function numericListArgument(name: string, fallback: number[]): number[] {
  const raw = argument(name);
  if (!raw) {
    return fallback;
  }
  const values = raw.split(",").map(Number);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(`--${name} must be a comma-separated list of non-negative numbers`);
  }
  return values;
}

async function main(): Promise<void> {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = path.resolve(scriptDirectory, "../../..");
  const inputPath = path.resolve(
    workspaceRoot,
    argument("input") ?? "apps/api/data/historical/football-data-features.jsonl"
  );
  const outputPath = path.resolve(
    workspaceRoot,
    argument("output") ?? "apps/api/data/historical/model-benchmark.json"
  );
  const options: HistoricalBenchmarkOptions = {
    minOdds: numericArgument("min-odds", 2),
    minExpectedValue: numericArgument("min-ev", 0.02),
    minTrainingRows: numericArgument("min-training-rows", 500),
    epochs: numericArgument("epochs", 30),
    learningRate: numericArgument("learning-rate", 0.015),
    l2: numericArgument("l2", 0.0005),
    dixonColesHalfLifeDays: numericArgument("dc-half-life-days", 365),
    dixonColesEpochs: numericArgument("dc-epochs", 250),
    thresholdCandidates: numericListArgument("ev-thresholds", [0.02, 0.04, 0.06, 0.08, 0.1]),
    thresholdMinBets: numericArgument("threshold-min-bets", 50)
  };
  const raw = await fs.readFile(inputPath, "utf8");
  const rows = raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as HistoricalFeatureRow);
  const report = evaluateHistoricalWalkForward(rows, options);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.table(Object.entries(report.aggregate).map(([model, metrics]) => ({
    model,
    predictions: metrics.predictions,
    RPS: metrics.meanRps,
    ECE: metrics.ece,
    hitRate: metrics.hitRate,
    bets: metrics.bets,
    ROI: metrics.roi,
    roiCi95: metrics.roiCi95 ? `${metrics.roiCi95.lower}..${metrics.roiCi95.upper}` : "n/a",
    maxDrawdown: metrics.maxDrawdown
  })));
  console.table(report.folds.flatMap((fold) => Object.entries(fold.thresholdSelection).map(([model, selection]) => ({
    testSeason: fold.testSeason,
    model,
    decision: selection.active ? `EV >= ${selection.selected}` : "NO BET",
    validationBets: selection.validationBets,
    validationROI: selection.validationRoi
  }))));
  console.table(report.folds.flatMap((fold) => Object.values(fold.dixonColesLeagueParameters).map((parameters) => ({
    testSeason: fold.testSeason,
    league: parameters.league,
    trainingRows: parameters.trainingRows,
    halfLifeDays: parameters.halfLifeDays,
    homeAdvantage: parameters.homeAdvantage,
    rho: parameters.rho,
    teams: parameters.teams
  }))));
  console.log("[historical-walk-forward] report", outputPath);
}

main().catch((error) => {
  console.error("[historical-walk-forward] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});