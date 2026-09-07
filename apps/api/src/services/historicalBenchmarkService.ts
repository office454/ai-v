import { poissonOutcomeProbabilities, scoreFixtureHADProbabilities } from "../engine/scoring.js";
import type { Fixture, PredictedSide, TeamStrength } from "../types.js";
import {
  fitDixonColesModel,
  predictDixonColes,
  type DixonColesLeagueParameters,
  type DixonColesModel
} from "./dixonColesService.js";
import type { HistoricalFeatureRow, RollingTeamMetrics } from "./historicalFeatureService.js";

type ProbabilityVector = { home: number; draw: number; away: number };
export type HistoricalModelName =
  | "opening_market"
  | "closing_market"
  | "current_model"
  | "poisson"
  | "dixon_coles_challenger"
  | "ml_logistic";

export type HistoricalBenchmarkMetrics = {
  predictions: number;
  meanRps: number;
  ece: number;
  hitRate: number;
  bets: number;
  betWins: number;
  betHitRate: number;
  profit: number;
  roi: number;
  roiCi95: { lower: number; upper: number } | null;
  maxDrawdown: number;
};

export type HistoricalBenchmarkFold = {
  testSeason: string;
  trainSeasons: string[];
  trainRows: number;
  testRows: number;
  dixonColesLeagueParameters: Record<string, DixonColesLeagueParameters>;
  thresholdSelection: Record<HistoricalModelName, ThresholdSelection>;
  models: Record<HistoricalModelName, HistoricalBenchmarkMetrics>;
};

export type ThresholdSelection = {
  active: boolean;
  selected: number | null;
  validationRows: number;
  validationBets: number;
  validationRoi: number;
};

type ModelMetrics = Record<HistoricalModelName, HistoricalBenchmarkMetrics>;
type GroupedModelMetrics = Record<string, Partial<ModelMetrics>>;

export type HistoricalBenchmarkReport = {
  generatedAt: string;
  methodology: "expanding-window-by-season";
  bettingPolicy: {
    minOdds: number;
    fallbackMinExpectedValue: number;
    thresholdCandidates: number[];
    thresholdMinBets: number;
    stake: number;
  };
  challengerPolicy: {
    model: "dixon_coles_challenger";
    mode: "shadow";
    productionEnabled: false;
    halfLifeDays: number;
    promotionRequires: string[];
  };
  eligibleRows: number;
  evaluatedRows: number;
  trainingOnlyRows: number;
  skippedRows: number;
  featureNames: string[];
  notes: string[];
  folds: HistoricalBenchmarkFold[];
  aggregate: ModelMetrics;
  breakdowns: {
    byLeague: GroupedModelMetrics;
    bySeason: GroupedModelMetrics;
    bySelectedOdds: GroupedModelMetrics;
  };
};

export type HistoricalBenchmarkOptions = {
  minOdds?: number;
  minExpectedValue?: number;
  minTrainingRows?: number;
  epochs?: number;
  learningRate?: number;
  l2?: number;
  thresholdCandidates?: number[];
  thresholdMinBets?: number;
  dixonColesHalfLifeDays?: number;
  dixonColesEpochs?: number;
};

export type HistoricalPredictionObservation = {
  probabilities: ProbabilityVector;
  actual: PredictedSide;
  odds: ProbabilityVector;
  kickoffAt?: string;
  league?: string;
  season?: string;
  selectedMinExpectedValue?: number;
};

type Standardizer = { means: number[]; scales: number[] };
type LogisticModel = { standardizer: Standardizer; weights: number[][] };

const SIDES: PredictedSide[] = ["home", "draw", "away"];
const MODEL_NAMES: HistoricalModelName[] = [
  "opening_market",
  "closing_market",
  "current_model",
  "poisson",
  "dixon_coles_challenger",
  "ml_logistic"
];

export const HISTORICAL_ML_FEATURE_NAMES = [
  "market_home",
  "market_draw",
  "market_away",
  "market_home_move",
  "market_draw_move",
  "market_away_move",
  "poisson_home",
  "poisson_draw",
  "poisson_away",
  "points_form_gap",
  "goals_for_gap",
  "goals_against_gap",
  "shots_for_gap",
  "shots_on_target_gap",
  "corners_for_gap",
  "home_attack",
  "home_defence",
  "away_attack",
  "away_defence",
  "league_home_goals",
  "league_away_goals"
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finite(value: number | null | undefined, fallback = 0): number {
  return value !== null && value !== undefined && Number.isFinite(value) ? value : fallback;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function resultIndex(side: PredictedSide): number {
  return side === "home" ? 0 : side === "draw" ? 1 : 2;
}

function values(probabilities: ProbabilityVector): [number, number, number] {
  return [probabilities.home, probabilities.draw, probabilities.away];
}

function normalize(probabilities: ProbabilityVector): ProbabilityVector {
  const total = probabilities.home + probabilities.draw + probabilities.away;
  return {
    home: probabilities.home / total,
    draw: probabilities.draw / total,
    away: probabilities.away / total
  };
}

function prediction(probabilities: ProbabilityVector): PredictedSide {
  return SIDES.reduce((best, side) => probabilities[side] > probabilities[best] ? side : best, "home");
}

function rps(probabilities: ProbabilityVector, actual: PredictedSide): number {
  const predicted = values(probabilities);
  const observed = SIDES.map((side) => side === actual ? 1 : 0);
  let predictedCumulative = 0;
  let observedCumulative = 0;
  let score = 0;
  for (let index = 0; index < 2; index += 1) {
    predictedCumulative += predicted[index];
    observedCumulative += observed[index];
    score += (predictedCumulative - observedCumulative) ** 2;
  }
  return score / 2;
}

function ece(observations: HistoricalPredictionObservation[], bins = 10): number {
  if (observations.length === 0) {
    return 0;
  }
  const buckets = Array.from({ length: bins }, () => [] as Array<{ confidence: number; hit: number }>);
  for (const observation of observations) {
    const selected = prediction(observation.probabilities);
    const confidence = observation.probabilities[selected];
    const index = Math.min(bins - 1, Math.floor(confidence * bins));
    buckets[index].push({ confidence, hit: selected === observation.actual ? 1 : 0 });
  }
  return buckets.reduce((total, bucket) => {
    if (bucket.length === 0) {
      return total;
    }
    const confidence = bucket.reduce((sum, item) => sum + item.confidence, 0) / bucket.length;
    const accuracy = bucket.reduce((sum, item) => sum + item.hit, 0) / bucket.length;
    return total + (bucket.length / observations.length) * Math.abs(confidence - accuracy);
  }, 0);
}

type SettledBet = { profit: number; block: string };

function deterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function percentile(valuesToSort: number[], fraction: number): number {
  const sorted = [...valuesToSort].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * (sorted.length - 1))));
  return sorted[index];
}

function bootstrapRoiInterval(bets: SettledBet[], iterations = 500): { lower: number; upper: number } | null {
  if (bets.length < 30) {
    return null;
  }
  const grouped = new Map<string, number[]>();
  for (const bet of bets) {
    grouped.set(bet.block, [...(grouped.get(bet.block) ?? []), bet.profit]);
  }
  const blocks = [...grouped.values()];
  const random = deterministicRandom(20260907);
  const samples: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let profit = 0;
    let count = 0;
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      const selected = blocks[Math.floor(random() * blocks.length)];
      profit += selected.reduce((sum, value) => sum + value, 0);
      count += selected.length;
    }
    samples.push(count > 0 ? profit / count : 0);
  }
  return {
    lower: round(percentile(samples, 0.025)),
    upper: round(percentile(samples, 0.975))
  };
}

function maximumDrawdown(profits: number[]): number {
  let balance = 0;
  let peak = 0;
  let drawdown = 0;
  for (const profit of profits) {
    balance += profit;
    peak = Math.max(peak, balance);
    drawdown = Math.max(drawdown, peak - balance);
  }
  return round(drawdown);
}

export function summarizeHistoricalPredictions(
  observations: HistoricalPredictionObservation[],
  options: { minOdds: number; minExpectedValue: number }
): HistoricalBenchmarkMetrics {
  let hits = 0;
  let bets = 0;
  let betWins = 0;
  let profit = 0;
  let rpsTotal = 0;
  const settledBets: SettledBet[] = [];

  for (const observation of observations) {
    const selected = prediction(observation.probabilities);
    const isHit = selected === observation.actual;
    const decimalOdds = observation.odds[selected];
    const expectedValue = observation.probabilities[selected] * decimalOdds - 1;
    const minimumExpectedValue = observation.selectedMinExpectedValue ?? options.minExpectedValue;
    hits += isHit ? 1 : 0;
    rpsTotal += rps(observation.probabilities, observation.actual);
    if (decimalOdds >= options.minOdds && expectedValue >= minimumExpectedValue) {
      const betProfit = isHit ? decimalOdds - 1 : -1;
      bets += 1;
      betWins += isHit ? 1 : 0;
      profit += betProfit;
      settledBets.push({
        profit: betProfit,
        block: observation.kickoffAt?.slice(0, 7) ?? `bet-${bets}`
      });
    }
  }

  return {
    predictions: observations.length,
    meanRps: round(observations.length > 0 ? rpsTotal / observations.length : 0),
    ece: round(ece(observations)),
    hitRate: round(observations.length > 0 ? hits / observations.length : 0),
    bets,
    betWins,
    betHitRate: round(bets > 0 ? betWins / bets : 0),
    profit: round(profit),
    roi: round(bets > 0 ? profit / bets : 0),
    roiCi95: bootstrapRoiInterval(settledBets),
    maxDrawdown: maximumDrawdown(settledBets.map((bet) => bet.profit))
  };
}

function strengthFromOdds(odds: number): TeamStrength {
  if (odds <= 1.55) return "elite";
  if (odds <= 2.1) return "strong";
  if (odds <= 3) return "average";
  return "weak";
}

function recentPoints(metrics: RollingTeamMetrics): number {
  return clamp(finite(metrics.pointsPerMatch, 1) * metrics.matches, 0, 15);
}

function historicalFixture(row: HistoricalFeatureRow): Fixture {
  const opening = row.odds.opening!;
  const closing = row.odds.closing!;
  const updatedAt = row.kickoffAt;
  return {
    id: row.key,
    league: row.league,
    kickoffAt: row.kickoffAt,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    homeStrength: strengthFromOdds(closing.decimalHome),
    awayStrength: strengthFromOdds(closing.decimalAway),
    homeRecentPoints: recentPoints(row.rolling.home.recent5),
    awayRecentPoints: recentPoints(row.rolling.away.recent5),
    expertSentiment: clamp(1 / closing.decimalHome, 0.05, 0.95),
    lineup: { confirmed: false, updatedAt, home: [], away: [] },
    oddsHistory: [
      { at: `${updatedAt}-opening`, homeWin: opening.decimalHome, draw: opening.decimalDraw, awayWin: opening.decimalAway },
      { at: `${updatedAt}-closing`, homeWin: closing.decimalHome, draw: closing.decimalDraw, awayWin: closing.decimalAway }
    ],
    marketOptions: [
      { oddsType: "HAD", oddsTypeName: "主客和", selectionCode: "H", selectionName: "主隊勝", lineCondition: "n/a", currentOdds: closing.decimalHome, inplay: false, poolStatus: "Sell", combinationStatus: "Sell", updatedAt },
      { oddsType: "HAD", oddsTypeName: "主客和", selectionCode: "D", selectionName: "和局", lineCondition: "n/a", currentOdds: closing.decimalDraw, inplay: false, poolStatus: "Sell", combinationStatus: "Sell", updatedAt },
      { oddsType: "HAD", oddsTypeName: "主客和", selectionCode: "A", selectionName: "客隊勝", lineCondition: "n/a", currentOdds: closing.decimalAway, inplay: false, poolStatus: "Sell", combinationStatus: "Sell", updatedAt }
    ]
  };
}

function currentModelProbabilities(row: HistoricalFeatureRow): ProbabilityVector {
  return scoreFixtureHADProbabilities(historicalFixture(row));
}

function poissonProbabilities(row: HistoricalFeatureRow): ProbabilityVector {
  return poissonOutcomeProbabilities(
    row.strengths.expectedHomeGoals!,
    row.strengths.expectedAwayGoals!
  );
}

function featureVector(row: HistoricalFeatureRow): number[] {
  const market = row.odds.closing!;
  const poisson = poissonProbabilities(row);
  const home = row.rolling.home.recent5;
  const away = row.rolling.away.recent5;
  return [
    market.home,
    market.draw,
    market.away,
    finite(row.odds.movement.homeProbability),
    finite(row.odds.movement.drawProbability),
    finite(row.odds.movement.awayProbability),
    poisson.home,
    poisson.draw,
    poisson.away,
    finite(home.pointsPerMatch) - finite(away.pointsPerMatch),
    finite(home.goalsFor) - finite(away.goalsFor),
    finite(home.goalsAgainst) - finite(away.goalsAgainst),
    finite(home.shotsFor) - finite(away.shotsFor),
    finite(home.shotsOnTargetFor) - finite(away.shotsOnTargetFor),
    finite(home.cornersFor) - finite(away.cornersFor),
    finite(row.strengths.homeAttack, 1),
    finite(row.strengths.homeDefence, 1),
    finite(row.strengths.awayAttack, 1),
    finite(row.strengths.awayDefence, 1),
    finite(row.rolling.league.homeGoals),
    finite(row.rolling.league.awayGoals)
  ];
}

function fitStandardizer(vectors: number[][]): Standardizer {
  const width = vectors[0]?.length ?? 0;
  const means = Array.from({ length: width }, (_, index) =>
    vectors.reduce((sum, vector) => sum + vector[index], 0) / vectors.length
  );
  const scales = means.map((meanValue, index) => {
    const variance = vectors.reduce((sum, vector) => sum + (vector[index] - meanValue) ** 2, 0) / vectors.length;
    const deviation = Math.sqrt(variance);
    return deviation > 1e-8 ? deviation : 1;
  });
  return { means, scales };
}

function standardize(vector: number[], standardizer: Standardizer): number[] {
  return vector.map((value, index) => (value - standardizer.means[index]) / standardizer.scales[index]);
}

function softmax(scores: number[]): number[] {
  const maximum = Math.max(...scores);
  const exponentials = scores.map((score) => Math.exp(score - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

function fitLogisticModel(
  rows: HistoricalFeatureRow[],
  options: { epochs: number; learningRate: number; l2: number }
): LogisticModel {
  const vectors = rows.map(featureVector);
  const standardizer = fitStandardizer(vectors);
  const standardized = vectors.map((vector) => [1, ...standardize(vector, standardizer)]);
  const weights = Array.from({ length: 3 }, () => Array(standardized[0].length).fill(0));

  for (let epoch = 0; epoch < options.epochs; epoch += 1) {
    const rate = options.learningRate / Math.sqrt(epoch + 1);
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const vector = standardized[rowIndex];
      const probabilities = softmax(weights.map((classWeights) =>
        classWeights.reduce((sum, weight, index) => sum + weight * vector[index], 0)
      ));
      const actualIndex = resultIndex(rows[rowIndex].target.result);
      for (let classIndex = 0; classIndex < 3; classIndex += 1) {
        const error = probabilities[classIndex] - (classIndex === actualIndex ? 1 : 0);
        for (let featureIndex = 0; featureIndex < vector.length; featureIndex += 1) {
          const penalty = featureIndex === 0 ? 0 : options.l2 * weights[classIndex][featureIndex];
          weights[classIndex][featureIndex] -= rate * (error * vector[featureIndex] + penalty);
        }
      }
    }
  }

  return { standardizer, weights };
}

function predictLogistic(model: LogisticModel, row: HistoricalFeatureRow): ProbabilityVector {
  const vector = [1, ...standardize(featureVector(row), model.standardizer)];
  const probabilities = softmax(model.weights.map((classWeights) =>
    classWeights.reduce((sum, weight, index) => sum + weight * vector[index], 0)
  ));
  return normalize({ home: probabilities[0], draw: probabilities[1], away: probabilities[2] });
}

function odds(row: HistoricalFeatureRow): ProbabilityVector {
  return {
    home: row.odds.closing!.decimalHome,
    draw: row.odds.closing!.decimalDraw,
    away: row.odds.closing!.decimalAway
  };
}

function marketProbabilities(row: HistoricalFeatureRow, point: "opening" | "closing"): ProbabilityVector {
  const market = row.odds[point]!;
  return { home: market.home, draw: market.draw, away: market.away };
}

function observation(
  row: HistoricalFeatureRow,
  probabilities: ProbabilityVector,
  selectedMinExpectedValue?: number
): HistoricalPredictionObservation {
  return {
    probabilities: normalize(probabilities),
    actual: row.target.result,
    odds: odds(row),
    kickoffAt: row.kickoffAt,
    league: row.league,
    season: row.season,
    selectedMinExpectedValue
  };
}

function eligible(row: HistoricalFeatureRow): boolean {
  return row.strengths.eligible
    && row.strengths.expectedHomeGoals !== null
    && row.strengths.expectedAwayGoals !== null
    && row.odds.opening !== null
    && row.odds.closing !== null;
}

function nestedTrainingSplit(trainSet: HistoricalFeatureRow[]): {
  modelTraining: HistoricalFeatureRow[];
  validation: HistoricalFeatureRow[];
} {
  const seasons = [...new Set(trainSet.map((row) => row.season))].sort();
  if (seasons.length > 1) {
    const validationSeason = seasons[seasons.length - 1];
    return {
      modelTraining: trainSet.filter((row) => row.season !== validationSeason),
      validation: trainSet.filter((row) => row.season === validationSeason)
    };
  }

  const boundaryIndex = Math.max(1, Math.floor(trainSet.length * 0.7));
  const boundaryKickoff = trainSet[boundaryIndex]?.kickoffAt;
  if (!boundaryKickoff) {
    return { modelTraining: trainSet, validation: trainSet };
  }
  const modelTraining = trainSet.filter((row) => row.kickoffAt < boundaryKickoff);
  const validation = trainSet.filter((row) => row.kickoffAt >= boundaryKickoff);
  return {
    modelTraining: modelTraining.length > 0 ? modelTraining : trainSet,
    validation: validation.length > 0 ? validation : trainSet
  };
}

function probabilitiesForModel(
  model: HistoricalModelName,
  row: HistoricalFeatureRow,
  logisticModel: LogisticModel,
  dixonColesModel: DixonColesModel
): ProbabilityVector {
  if (model === "opening_market") return marketProbabilities(row, "opening");
  if (model === "closing_market") return marketProbabilities(row, "closing");
  if (model === "current_model") return currentModelProbabilities(row);
  if (model === "poisson") return poissonProbabilities(row);
  if (model === "dixon_coles_challenger") return predictDixonColes(dixonColesModel, row);
  return predictLogistic(logisticModel, row);
}

function selectExpectedValueThreshold(
  observations: HistoricalPredictionObservation[],
  candidates: number[],
  options: { minOdds: number; minBets: number }
): ThresholdSelection {
  const evaluated = candidates.map((candidate) => ({
    candidate,
    metrics: summarizeHistoricalPredictions(observations, {
      minOdds: options.minOdds,
      minExpectedValue: candidate
    })
  }));
  const qualified = evaluated.filter((item) => item.metrics.bets >= options.minBets);
  const selected = [...qualified].sort(
    (left, right) => right.metrics.roi - left.metrics.roi || right.candidate - left.candidate
  )[0];
  if (!selected || selected.metrics.roi <= 0) {
    return {
      active: false,
      selected: null,
      validationRows: observations.length,
      validationBets: selected?.metrics.bets ?? 0,
      validationRoi: selected?.metrics.roi ?? 0
    };
  }
  return {
    active: true,
    selected: selected.candidate,
    validationRows: observations.length,
    validationBets: selected.metrics.bets,
    validationRoi: selected.metrics.roi
  };
}

function selectedOddsBucket(observation: HistoricalPredictionObservation): string {
  const selected = prediction(observation.probabilities);
  const selectedOdds = observation.odds[selected];
  if (selectedOdds < 2) return "<2.00";
  if (selectedOdds < 2.5) return "2.00-2.49";
  if (selectedOdds < 3) return "2.50-2.99";
  if (selectedOdds < 4) return "3.00-3.99";
  return "4.00+";
}

function groupedMetrics(
  observations: Record<HistoricalModelName, HistoricalPredictionObservation[]>,
  group: (observation: HistoricalPredictionObservation) => string | undefined,
  options: { minOdds: number; minExpectedValue: number }
): GroupedModelMetrics {
  const output: GroupedModelMetrics = {};
  for (const model of MODEL_NAMES) {
    const grouped = new Map<string, HistoricalPredictionObservation[]>();
    for (const item of observations[model]) {
      const key = group(item);
      if (key) grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    for (const [key, items] of grouped) {
      output[key] = {
        ...(output[key] ?? {}),
        [model]: summarizeHistoricalPredictions(items, options)
      };
    }
  }
  return output;
}

export function evaluateHistoricalWalkForward(
  rows: HistoricalFeatureRow[],
  options: HistoricalBenchmarkOptions = {}
): HistoricalBenchmarkReport {
  const minOdds = Math.max(1.01, options.minOdds ?? 2);
  const minExpectedValue = options.minExpectedValue ?? 0.02;
  const minTrainingRows = Math.max(3, options.minTrainingRows ?? 500);
  const epochs = Math.max(1, options.epochs ?? 30);
  const learningRate = options.learningRate ?? 0.015;
  const l2 = options.l2 ?? 0.0005;
  const configuredThresholdCandidates = [...new Set(options.thresholdCandidates ?? [0.02, 0.04, 0.06, 0.08, 0.1])]
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  const thresholdCandidates = configuredThresholdCandidates.length > 0
    ? configuredThresholdCandidates
    : [minExpectedValue];
  const thresholdMinBets = Math.max(1, options.thresholdMinBets ?? 50);
  const dixonColesHalfLifeDays = Math.max(30, options.dixonColesHalfLifeDays ?? 365);
  const dixonColesEpochs = Math.max(1, options.dixonColesEpochs ?? 250);
  const usable = rows.filter(eligible).sort(
    (left, right) => left.kickoffAt.localeCompare(right.kickoffAt) || left.key.localeCompare(right.key)
  );
  const seasons = [...new Set(usable.map((row) => row.season))].sort();
  const folds: HistoricalBenchmarkFold[] = [];
  const aggregateObservations: Record<HistoricalModelName, HistoricalPredictionObservation[]> = {
    opening_market: [],
    closing_market: [],
    current_model: [],
    poisson: [],
    dixon_coles_challenger: [],
    ml_logistic: []
  };

  for (let seasonIndex = 1; seasonIndex < seasons.length; seasonIndex += 1) {
    const testSeason = seasons[seasonIndex];
    const trainSeasons = seasons.slice(0, seasonIndex);
    const trainSet = usable.filter((row) => trainSeasons.includes(row.season));
    const testSet = usable.filter((row) => row.season === testSeason);
    if (trainSet.length < minTrainingRows || testSet.length === 0) {
      continue;
    }

    const mlModel = fitLogisticModel(trainSet, { epochs, learningRate, l2 });
    const dixonColesModel = fitDixonColesModel(trainSet, {
      halfLifeDays: dixonColesHalfLifeDays,
      epochs: dixonColesEpochs
    });
    const nested = nestedTrainingSplit(trainSet);
    const nestedMlModel = fitLogisticModel(nested.modelTraining, { epochs, learningRate, l2 });
    const nestedDixonColesModel = fitDixonColesModel(nested.modelTraining, {
      halfLifeDays: dixonColesHalfLifeDays,
      epochs: dixonColesEpochs
    });
    const thresholdSelection = {} as Record<HistoricalModelName, ThresholdSelection>;
    for (const model of MODEL_NAMES) {
      const validationObservations = nested.validation.map((row) =>
        observation(row, probabilitiesForModel(model, row, nestedMlModel, nestedDixonColesModel))
      );
      thresholdSelection[model] = selectExpectedValueThreshold(validationObservations, thresholdCandidates, {
        minOdds,
        minBets: thresholdMinBets
      });
    }
    const foldObservations: Record<HistoricalModelName, HistoricalPredictionObservation[]> = {
      opening_market: [],
      closing_market: [],
      current_model: [],
      poisson: [],
      dixon_coles_challenger: [],
      ml_logistic: []
    };
    for (const row of testSet) {
      for (const model of MODEL_NAMES) {
        foldObservations[model].push(observation(
          row,
          probabilitiesForModel(model, row, mlModel, dixonColesModel),
          thresholdSelection[model].selected ?? Number.POSITIVE_INFINITY
        ));
      }
    }
    for (const model of MODEL_NAMES) {
      aggregateObservations[model].push(...foldObservations[model]);
    }
    folds.push({
      testSeason,
      trainSeasons,
      trainRows: trainSet.length,
      testRows: testSet.length,
      dixonColesLeagueParameters: dixonColesModel.leagues,
      thresholdSelection,
      models: {
        opening_market: summarizeHistoricalPredictions(foldObservations.opening_market, { minOdds, minExpectedValue }),
        closing_market: summarizeHistoricalPredictions(foldObservations.closing_market, { minOdds, minExpectedValue }),
        current_model: summarizeHistoricalPredictions(foldObservations.current_model, { minOdds, minExpectedValue }),
        poisson: summarizeHistoricalPredictions(foldObservations.poisson, { minOdds, minExpectedValue }),
        dixon_coles_challenger: summarizeHistoricalPredictions(foldObservations.dixon_coles_challenger, { minOdds, minExpectedValue }),
        ml_logistic: summarizeHistoricalPredictions(foldObservations.ml_logistic, { minOdds, minExpectedValue })
      }
    });
  }

  const evaluatedRows = aggregateObservations.current_model.length;
  return {
    generatedAt: new Date().toISOString(),
    methodology: "expanding-window-by-season",
    bettingPolicy: {
      minOdds,
      fallbackMinExpectedValue: minExpectedValue,
      thresholdCandidates,
      thresholdMinBets,
      stake: 1
    },
    challengerPolicy: {
      model: "dixon_coles_challenger",
      mode: "shadow",
      productionEnabled: false,
      halfLifeDays: dixonColesHalfLifeDays,
      promotionRequires: [
        "Out-of-sample RPS below the closing-market baseline",
        "Positive ROI with a 95% confidence interval lower bound above zero",
        "Stable performance across seasons and leagues"
      ]
    },
    eligibleRows: usable.length,
    evaluatedRows,
    trainingOnlyRows: usable.length - evaluatedRows,
    skippedRows: rows.length - usable.length,
    featureNames: HISTORICAL_ML_FEATURE_NAMES,
    notes: [
      "Closing prices are treated as observable immediately before kickoff and are used for both prediction and settlement ROI.",
      "Current-model fixtures are reconstructed without lineup data because Football-Data does not provide historical lineups.",
      `Dixon-Coles is an offline shadow challenger fitted separately by league with a ${dixonColesHalfLifeDays}-day time-decay half-life.`,
      "Dixon-Coles league and team parameters are fitted from each fold's earlier seasons only and are never used by production scoring.",
      "ECE measures top-pick confidence against top-pick accuracy in 10 bins.",
      "ML scaling and weights are fitted independently inside each fold using earlier seasons only.",
      "EV thresholds are selected on a nested chronological validation window inside each training fold.",
      "A model is set to no-bet for a test fold when no adequately sampled threshold has positive validation ROI.",
      "Opening and closing market baselines use de-vigged probabilities; all ROI is settled at closing decimal odds.",
      "ROI confidence intervals use deterministic month-block bootstrap resampling.",
      "The first eligible season is training-only and is not included in aggregate test metrics."
    ],
    folds,
    aggregate: {
      opening_market: summarizeHistoricalPredictions(aggregateObservations.opening_market, { minOdds, minExpectedValue }),
      closing_market: summarizeHistoricalPredictions(aggregateObservations.closing_market, { minOdds, minExpectedValue }),
      current_model: summarizeHistoricalPredictions(aggregateObservations.current_model, { minOdds, minExpectedValue }),
      poisson: summarizeHistoricalPredictions(aggregateObservations.poisson, { minOdds, minExpectedValue }),
      dixon_coles_challenger: summarizeHistoricalPredictions(aggregateObservations.dixon_coles_challenger, { minOdds, minExpectedValue }),
      ml_logistic: summarizeHistoricalPredictions(aggregateObservations.ml_logistic, { minOdds, minExpectedValue })
    },
    breakdowns: {
      byLeague: groupedMetrics(aggregateObservations, (item) => item.league, { minOdds, minExpectedValue }),
      bySeason: groupedMetrics(aggregateObservations, (item) => item.season, { minOdds, minExpectedValue }),
      bySelectedOdds: groupedMetrics(aggregateObservations, selectedOddsBucket, { minOdds, minExpectedValue })
    }
  };
}