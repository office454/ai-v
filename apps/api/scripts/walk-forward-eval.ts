import path from "node:path";
import { promises as fs } from "node:fs";

type PredictedSide = "home" | "draw" | "away";

type SettledLearningRecord = {
  key: string;
  market: string;
  confidence: number;
  currentOdds: number;
  predictedSide?: PredictedSide;
  actualSide?: PredictedSide;
  settledAt?: string;
  createdAt: string;
};

type LearningDb = {
  pending: unknown[];
  settled: SettledLearningRecord[];
};

const args = process.argv.slice(2);
const warmup = Math.max(10, Number(args.find((arg) => arg.startsWith("--warmup="))?.split("=")[1] ?? 120));
const lookback = Math.max(20, Number(args.find((arg) => arg.startsWith("--lookback="))?.split("=")[1] ?? 300));

function clamp(value: number, min = 0.02, max = 0.95): number {
  return Math.max(min, Math.min(max, value));
}

function toTimestamp(record: SettledLearningRecord): number {
  const base = record.settledAt || record.createdAt;
  const ms = Date.parse(base);
  return Number.isFinite(ms) ? ms : 0;
}

function oneHot(side: PredictedSide): [number, number, number] {
  if (side === "home") return [1, 0, 0];
  if (side === "draw") return [0, 1, 0];
  return [0, 0, 1];
}

function probabilityVector(predictedSide: PredictedSide, p: number): [number, number, number] {
  const safe = clamp(p);
  const rest = (1 - safe) / 2;
  if (predictedSide === "home") return [safe, rest, rest];
  if (predictedSide === "draw") return [rest, safe, rest];
  return [rest, rest, safe];
}

function rps(prob: [number, number, number], actual: [number, number, number]): number {
  let predCum = 0;
  let actualCum = 0;
  let sum = 0;
  for (let i = 0; i < 3; i += 1) {
    predCum += prob[i];
    actualCum += actual[i];
    const diff = predCum - actualCum;
    sum += diff * diff;
  }
  return sum / 2;
}

function ece(samples: Array<{ predicted: number; actual: number }>, bins = 10): number {
  if (samples.length === 0) return 0;
  const bucketed = Array.from({ length: bins }, () => [] as Array<{ predicted: number; actual: number }>);
  for (const sample of samples) {
    const index = Math.min(bins - 1, Math.max(0, Math.floor(sample.predicted * bins)));
    bucketed[index].push(sample);
  }

  let score = 0;
  for (const bucket of bucketed) {
    if (bucket.length === 0) continue;
    const meanPred = bucket.reduce((sum, item) => sum + item.predicted, 0) / bucket.length;
    const meanActual = bucket.reduce((sum, item) => sum + item.actual, 0) / bucket.length;
    score += (bucket.length / samples.length) * Math.abs(meanPred - meanActual);
  }
  return score;
}

function calibrate(
  current: SettledLearningRecord,
  history: SettledLearningRecord[]
): number {
  const p = clamp(current.confidence / 100);
  const sameMarket = history.filter((item) => item.market === current.market && item.actualSide);
  if (sameMarket.length < 25) {
    return p;
  }

  const avgPred = sameMarket.reduce((sum, item) => sum + clamp(item.confidence / 100), 0) / sameMarket.length;
  const wins = sameMarket.filter((item) => item.predictedSide && item.actualSide && item.predictedSide === item.actualSide).length;
  const avgObs = wins / sameMarket.length;
  const scale = Math.max(0.55, Math.min(1.2, avgObs / Math.max(avgPred, 0.05)));
  const scaled = clamp(p * scale);
  const weight = Math.min(0.7, sameMarket.length / 200);
  return clamp(p * (1 - weight) + scaled * weight);
}

async function main(): Promise<void> {
  const workspaceRoot = path.resolve(process.cwd(), "../..");
  const dbPath = path.resolve(workspaceRoot, "apps/api/data/learning-db.json");
  const raw = await fs.readFile(dbPath, "utf8");
  const db = JSON.parse(raw) as LearningDb;

  const settled = [...db.settled]
    .filter((item) => item.predictedSide && item.actualSide)
    .sort((a, b) => toTimestamp(a) - toTimestamp(b));

  if (settled.length <= warmup + 10) {
    console.log("[walk-forward] insufficient settled samples", { total: settled.length, warmup });
    return;
  }

  const rpsScores: number[] = [];
  const calSamples: Array<{ predicted: number; actual: number }> = [];

  for (let i = warmup; i < settled.length; i += 1) {
    const current = settled[i];
    const history = settled.slice(Math.max(0, i - lookback), i);
    if (!current.predictedSide || !current.actualSide) {
      continue;
    }

    const calibrated = calibrate(current, history);
    const prob = probabilityVector(current.predictedSide, calibrated);
    const actual = oneHot(current.actualSide);
    rpsScores.push(rps(prob, actual));

    calSamples.push({
      predicted: calibrated,
      actual: current.predictedSide === current.actualSide ? 1 : 0
    });
  }

  const meanRps = rpsScores.length === 0 ? 0 : rpsScores.reduce((sum, value) => sum + value, 0) / rpsScores.length;
  const calibrationError = ece(calSamples, 10);

  console.log("[walk-forward] evaluation", {
    totalSettled: settled.length,
    warmup,
    lookback,
    evaluated: rpsScores.length,
    meanRPS: Number(meanRps.toFixed(5)),
    ece: Number(calibrationError.toFixed(5))
  });
}

main().catch((error) => {
  console.error("[walk-forward] failed", error);
  process.exit(1);
});
