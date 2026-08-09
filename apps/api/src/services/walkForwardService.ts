import type { LearningHistoryRecord, PredictedSide } from "../types.js";

export type WalkForwardTrendPoint = {
  at: string;
  sample: number;
  hitRate: number;
  meanRps: number;
  ece: number;
};

export type WalkForwardMetrics = {
  generatedAt: string;
  totalSettled: number;
  evaluated: number;
  warmup: number;
  lookback: number;
  window: number;
  step: number;
  meanRps: number;
  ece: number;
  trend: WalkForwardTrendPoint[];
};

type EvalSample = {
  timestamp: number;
  calibrated: number;
  isHit: number;
  rps: number;
};

function clamp(value: number, min = 0.02, max = 0.95): number {
  return Math.max(min, Math.min(max, value));
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

function toMs(record: LearningHistoryRecord): number {
  const raw = record.settledAt || record.createdAt;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function calibrateFromHistory(current: LearningHistoryRecord, history: LearningHistoryRecord[]): number {
  const p = clamp(current.confidence / 100);
  const sameMarket = history.filter((item) => item.market === current.market && item.actualSide);
  if (sameMarket.length < 25) {
    return p;
  }

  const avgPred = sameMarket.reduce((sum, item) => sum + clamp(item.confidence / 100), 0) / sameMarket.length;
  const wins = sameMarket.filter((item) => item.actualSide === item.predictedSide).length;
  const avgObs = wins / sameMarket.length;
  const scale = Math.max(0.55, Math.min(1.2, avgObs / Math.max(avgPred, 0.05)));
  const scaled = clamp(p * scale);
  const weight = Math.min(0.7, sameMarket.length / 200);
  return clamp(p * (1 - weight) + scaled * weight);
}

export function evaluateWalkForwardMetrics(
  records: LearningHistoryRecord[],
  options?: {
    warmup?: number;
    lookback?: number;
    window?: number;
    step?: number;
  }
): WalkForwardMetrics {
  const warmup = Math.max(10, options?.warmup ?? 120);
  const lookback = Math.max(20, options?.lookback ?? 300);
  const window = Math.max(10, options?.window ?? 40);
  const step = Math.max(5, options?.step ?? 10);

  const settled = [...records]
    .filter((record) => record.status === "settled" && record.actualSide && record.predictedSide)
    .sort((a, b) => toMs(a) - toMs(b));

  const evalSamples: EvalSample[] = [];
  for (let i = warmup; i < settled.length; i += 1) {
    const current = settled[i];
    const history = settled.slice(Math.max(0, i - lookback), i);
    if (!current.actualSide) {
      continue;
    }

    const calibrated = calibrateFromHistory(current, history);
    const prob = probabilityVector(current.predictedSide, calibrated);
    const actual = oneHot(current.actualSide);

    evalSamples.push({
      timestamp: toMs(current),
      calibrated,
      isHit: current.predictedSide === current.actualSide ? 1 : 0,
      rps: rps(prob, actual)
    });
  }

  const trend: WalkForwardTrendPoint[] = [];
  for (let i = window; i <= evalSamples.length; i += step) {
    const segment = evalSamples.slice(i - window, i);
    const meanRps = segment.reduce((sum, item) => sum + item.rps, 0) / segment.length;
    const hitRate = segment.reduce((sum, item) => sum + item.isHit, 0) / segment.length;
    const eceScore = ece(
      segment.map((item) => ({
        predicted: item.calibrated,
        actual: item.isHit
      })),
      10
    );

    trend.push({
      at: new Date(segment[segment.length - 1].timestamp).toISOString(),
      sample: segment.length,
      hitRate: Number(hitRate.toFixed(4)),
      meanRps: Number(meanRps.toFixed(5)),
      ece: Number(eceScore.toFixed(5))
    });
  }

  const meanRps = evalSamples.length === 0 ? 0 : evalSamples.reduce((sum, item) => sum + item.rps, 0) / evalSamples.length;
  const calibrationError = ece(
    evalSamples.map((item) => ({
      predicted: item.calibrated,
      actual: item.isHit
    })),
    10
  );

  return {
    generatedAt: new Date().toISOString(),
    totalSettled: settled.length,
    evaluated: evalSamples.length,
    warmup,
    lookback,
    window,
    step,
    meanRps: Number(meanRps.toFixed(5)),
    ece: Number(calibrationError.toFixed(5)),
    trend
  };
}
