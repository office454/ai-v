import { scoreFixture } from "../engine/scoring.js";
import type { BacktestRecord, Fixture, Recommendation } from "../types.js";
import type { AnalysisService } from "./analysisService.js";
import type { BacktestStore } from "./backtestStore.js";
import { reviewRecommendationsForConsensus } from "./assistantReviewService.js";

const FOCUSED_TRAINING_ODDS_TYPES = new Set(["HDC", "EDC", "HAD", "HHA", "HIL", "EHL"]);
const FOCUSED_TRAINING_MARKET_KEYWORDS = ["讓球", "主客和", "入球大細"];

function normalizeText(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function parseLineValue(...parts: string[]): number | null {
  for (const part of parts) {
    const match = part.match(/-?\d+(?:\.\d+)?/);
    if (!match) {
      continue;
    }

    const value = Number(match[0]);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function selectionSide(text: string): "home" | "away" | null {
  const normalized = normalizeText(text);
  const hasHome = normalized.includes("主隊") || normalized.includes("主勝") || normalized.includes("home");
  const hasAway = normalized.includes("客隊") || normalized.includes("客勝") || normalized.includes("away");

  if (hasHome && !hasAway) {
    return "home";
  }

  if (hasAway && !hasHome) {
    return "away";
  }

  return null;
}

function overUnderPick(selectionText: string): "over" | "under" | null {
  const text = normalizeText(selectionText);
  if (text.includes("大") && !text.includes("細")) {
    return "over";
  }

  if (text.includes("細") && !text.includes("大")) {
    return "under";
  }

  return null;
}

function predictedSideFromRecommendation(rec: Recommendation): "homeWin" | "draw" | "awayWin" | null {
  const text = normalizeText(`${rec.market} ${rec.selectionName}`);
  const selectionText = normalizeText(rec.selectionName);

  if (selectionText === "和" || selectionText.includes("和局") || selectionText.includes("draw") || /\b[xd]\b/.test(selectionText)) {
    return "draw";
  }

  if (selectionText.includes("大") && !selectionText.includes("細")) {
    return "homeWin";
  }

  if (selectionText.includes("細") && !selectionText.includes("大")) {
    return "awayWin";
  }

  if (selectionText.includes("單")) {
    return "homeWin";
  }

  if (selectionText.includes("雙")) {
    return "awayWin";
  }

  if (["主", "home", "主勝", "hadh", "homewin", "主隊"].some((token) => text.includes(token))) {
    return "homeWin";
  }

  if (["客", "away", "客勝", "hada", "awaywin", "客隊"].some((token) => text.includes(token))) {
    return "awayWin";
  }

  return null;
}

function actualSideFromFixture(rec: Recommendation, fixture: Fixture): "homeWin" | "draw" | "awayWin" | null {
  if (!fixture.finalScore) {
    return null;
  }

  const text = normalizeText(`${rec.market} ${rec.selectionName}`);
  const selectionText = normalizeText(rec.selectionName);
  const useHalfTimeScore = text.includes("半場");
  const scopedHome = useHalfTimeScore ? (fixture.halfTimeScore?.home ?? null) : fixture.finalScore.home;
  const scopedAway = useHalfTimeScore ? (fixture.halfTimeScore?.away ?? null) : fixture.finalScore.away;
  if (scopedHome === null || scopedAway === null) {
    return null;
  }

  if (text.includes("讓球")) {
    const line = parseLineValue(rec.selectionName, rec.market);
    if (line === null) {
      return null;
    }

    const homeAdjusted = scopedHome + line;
    const awayAdjusted = scopedAway - line;

    if (homeAdjusted > awayAdjusted) {
      return "homeWin";
    }

    if (homeAdjusted < awayAdjusted) {
      return "awayWin";
    }

    return "draw";
  }

  if (text.includes("角球")) {
    const corners = fixture.finalCorners;
    if (!corners) {
      return null;
    }

    const line = parseLineValue(rec.selectionName, rec.market);
    if (line === null) {
      return null;
    }

    const side = selectionSide(text);
    const metric = side === "home" ? corners.home : side === "away" ? corners.away : corners.total;
    const pick = overUnderPick(selectionText);
    if (!pick) {
      return null;
    }
    if (metric > line) {
      return pick === "under" ? "awayWin" : "homeWin";
    }

    if (metric < line) {
      return pick === "under" ? "homeWin" : "awayWin";
    }

    return "draw";
  }

  if (text.includes("總入球") || text.includes("入球大細")) {
    const line = parseLineValue(rec.selectionName, rec.market);
    if (line === null) {
      return null;
    }

    const side = selectionSide(text);
    const metric = side === "home" ? scopedHome : side === "away" ? scopedAway : scopedHome + scopedAway;
    const pick = overUnderPick(selectionText);
    if (!pick) {
      return null;
    }
    if (metric > line) {
      return pick === "under" ? "awayWin" : "homeWin";
    }

    if (metric < line) {
      return pick === "under" ? "homeWin" : "awayWin";
    }

    return "draw";
  }

  if (text.includes("單雙")) {
    const total = scopedHome + scopedAway;
    return total % 2 === 1 ? "homeWin" : "awayWin";
  }

  if (scopedHome > scopedAway) {
    return "homeWin";
  }

  if (scopedHome < scopedAway) {
    return "awayWin";
  }

  return "draw";
}

function isSettledFixture(fixture: Fixture): boolean {
  if (!fixture.finalScore) {
    return false;
  }

  const kickoffMs = new Date(fixture.kickoffAt).getTime();
  if (!Number.isFinite(kickoffMs)) {
    return false;
  }

  return kickoffMs <= Date.now();
}

function classifyFocusedTrainingMarket(rec: Recommendation): "asian_handicap" | "match_result" | "goals_over_under" | null {
  const text = normalizeText(`${rec.market} ${rec.selectionName}`);

  if (text.includes("讓球")) {
    return "asian_handicap";
  }

  if (text.includes("主客和")) {
    return "match_result";
  }

  if (text.includes("入球大細") || text.includes("總入球")) {
    return "goals_over_under";
  }

  return null;
}

function isFocusedTrainingMarketOption(option: Fixture["marketOptions"][number]): boolean {
  if (FOCUSED_TRAINING_ODDS_TYPES.has(option.oddsType.trim().toUpperCase())) {
    return true;
  }

  const name = normalizeText(option.oddsTypeName);
  return FOCUSED_TRAINING_MARKET_KEYWORDS.some((keyword) => name.includes(normalizeText(keyword)));
}

type TrainingConsensusOptions = {
  enabled?: boolean;
  apiKey?: string;
  model?: string;
  fallbackModels?: string[];
  temperature?: number;
  referer?: string;
  title?: string;
  candidateLimit?: number;
};

type AutoTrainingCycleOptions = {
  source?: "auto" | "practice";
  consensus?: TrainingConsensusOptions;
  candidateRatio?: number;
  calibrationProfiles?: PersistedCalibrationProfiles;
  onCalibrationProfilesUpdated?: (profiles: PersistedCalibrationProfiles) => Promise<void> | void;
};

type TrainingCandidate = {
  recommendation: Recommendation;
  predicted: "homeWin" | "draw" | "awayWin";
  actual: "homeWin" | "draw" | "awayWin";
  trainingMarket: "asian_handicap" | "match_result" | "goals_over_under";
  fixture: Fixture;
};

type MarketPerformance = {
  recentHitRate: number;
  recentSample: number;
};

type FocusedMarketKey = "asian_handicap" | "match_result" | "goals_over_under";

export type CalibrationProfile = {
  count: number;
  avgPredicted: number;
  avgObserved: number;
  scale: number;
};

export type PersistedCalibrationProfiles = {
  updatedAt: string;
  markets: Record<FocusedMarketKey, CalibrationProfile>;
};

export type AdaptiveGateSnapshot = {
  generatedAt: string;
  drift: {
    active: boolean;
    severity: "none" | "mild" | "severe";
    candidateRatioFactor: number;
  };
  calibrationUpdatedAt?: string;
  markets: Record<
    FocusedMarketKey,
    {
      recentHitRate: number;
      recentSample: number;
      totalSample: number;
      calibration: CalibrationProfile;
      thresholds: {
        minConfidence: number;
        minEdgeScore: number;
        minValueScore: number;
        minProbabilityEdge: number;
        maxOdds: number;
      };
    }
  >;
};

function recommendationSortScore(left: Recommendation, right: Recommendation): number {
  return (
    right.confidence - left.confidence ||
    right.edgeScore - left.edgeScore ||
    right.valueScore - left.valueScore ||
    right.currentOdds - left.currentOdds
  );
}

function marketPerformanceMap(input: {
  markets: Array<{
    key: FocusedMarketKey;
    recentHitRate: number;
    recentSample: number;
  }>;
}): Record<FocusedMarketKey, MarketPerformance> {
  const fallback: MarketPerformance = {
    recentHitRate: 0.5,
    recentSample: 0
  };

  return {
    asian_handicap: input.markets.find((market) => market.key === "asian_handicap") ?? fallback,
    match_result: input.markets.find((market) => market.key === "match_result") ?? fallback,
    goals_over_under: input.markets.find((market) => market.key === "goals_over_under") ?? fallback
  };
}

function impliedProbabilityFromOdds(odds: number): number {
  return 1 / Math.max(odds, 1.0001);
}

function clampProbability(value: number): number {
  return Math.max(0.02, Math.min(0.95, value));
}

function buildCalibrationProfiles(
  records: BacktestRecord[]
): Record<FocusedMarketKey, CalibrationProfile> {
  const fallback: CalibrationProfile = {
    count: 0,
    avgPredicted: 0.5,
    avgObserved: 0.5,
    scale: 1
  };

  const keys: FocusedMarketKey[] = [
    "asian_handicap",
    "match_result",
    "goals_over_under"
  ];

  const profiles = Object.fromEntries(
    keys.map((key) => {
      const marketRecords = records.filter((record) => record.trainingMarket === key);
      if (marketRecords.length === 0) {
        return [key, fallback];
      }

      const avgPredicted =
        marketRecords.reduce((sum, record) => sum + clampProbability(record.modelProbability), 0) / marketRecords.length;
      const wins = marketRecords.filter((record) => record.result === "win").length;
      const avgObserved = wins / marketRecords.length;
      const rawScale = avgObserved / Math.max(avgPredicted, 0.05);
      const scale = Math.max(0.55, Math.min(1.2, rawScale));

      return [
        key,
        {
          count: marketRecords.length,
          avgPredicted: Number(avgPredicted.toFixed(4)),
          avgObserved: Number(avgObserved.toFixed(4)),
          scale: Number(scale.toFixed(4))
        }
      ];
    })
  ) as Record<FocusedMarketKey, CalibrationProfile>;

  return profiles;
}

function mergeCalibrationProfiles(
  persisted: PersistedCalibrationProfiles | undefined,
  live: Record<FocusedMarketKey, CalibrationProfile>
): PersistedCalibrationProfiles {
  const keys: FocusedMarketKey[] = ["asian_handicap", "match_result", "goals_over_under"];

  const mergedMarkets = Object.fromEntries(
    keys.map((key) => {
      const a = persisted?.markets[key];
      const b = live[key];

      if (!a) {
        return [key, b];
      }

      if (!b || b.count === 0) {
        return [key, a];
      }

      const total = Math.min(2000, Math.max(a.count, b.count));
      const wa = a.count / Math.max(a.count + b.count, 1);
      const wb = b.count / Math.max(a.count + b.count, 1);
      const avgPredicted = Number((a.avgPredicted * wa + b.avgPredicted * wb).toFixed(4));
      const avgObserved = Number((a.avgObserved * wa + b.avgObserved * wb).toFixed(4));
      const scale = Number((a.scale * wa + b.scale * wb).toFixed(4));

      return [
        key,
        {
          count: total,
          avgPredicted,
          avgObserved,
          scale
        }
      ];
    })
  ) as Record<FocusedMarketKey, CalibrationProfile>;

  return {
    updatedAt: new Date().toISOString(),
    markets: mergedMarkets
  };
}

function driftRatioFactor(drift: { severity: "none" | "mild" | "severe" }): number {
  return drift.severity === "severe" ? 0.5 : drift.severity === "mild" ? 0.75 : 1;
}

function calibrateProbability(
  recommendation: Recommendation,
  market: FocusedMarketKey,
  profiles: Record<FocusedMarketKey, CalibrationProfile>
): number {
  const base = clampProbability(recommendation.confidence / 100);
  const profile = profiles[market];
  if (!profile || profile.count < 20) {
    return base;
  }

  const scaled = clampProbability(base * profile.scale);
  const blendWeight = Math.min(0.7, profile.count / 200);
  const blended = clampProbability(base * (1 - blendWeight) + scaled * blendWeight);
  return blended;
}

function detectConceptDrift(input: {
  markets: Array<{
    key: FocusedMarketKey;
    recentHitRate: number;
    recentSample: number;
  }>;
}): { active: boolean; severity: "none" | "mild" | "severe" } {
  const weakMarkets = input.markets.filter((market) => market.recentSample >= 20 && market.recentHitRate < 0.24);
  if (weakMarkets.length >= 2) {
    return { active: true, severity: "severe" };
  }

  const mild = input.markets.some((market) => market.recentSample >= 20 && market.recentHitRate < 0.3);
  if (mild) {
    return { active: true, severity: "mild" };
  }

  return { active: false, severity: "none" };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function dynamicThresholdCurve(input: {
  market: FocusedMarketKey;
  performance: MarketPerformance;
  drift: { active: boolean; severity: "none" | "mild" | "severe" };
}): {
  minConfidence: number;
  minEdgeScore: number;
  minValueScore: number;
  minProbabilityEdge: number;
  maxOdds: number;
} {
  const baseByMarket: Record<FocusedMarketKey, { confidence: number; edge: number; value: number; probEdge: number; maxOdds: number }> = {
    asian_handicap: { confidence: 66.5, edge: 2.8, value: 0.01, probEdge: 0.02, maxOdds: 4.8 },
    match_result: { confidence: 65, edge: 2.4, value: 0.008, probEdge: 0.018, maxOdds: 4.8 },
    goals_over_under: { confidence: 68, edge: 3.6, value: 0.02, probEdge: 0.028, maxOdds: 4.6 }
  };

  const base = baseByMarket[input.market];
  const sampleWeight = clampNumber(input.performance.recentSample / 60, 0, 1);
  const targetHitRate = input.market === "goals_over_under" ? 0.38 : input.market === "asian_handicap" ? 0.4 : 0.42;
  const weakness = clampNumber((targetHitRate - input.performance.recentHitRate) / targetHitRate, 0, 1);
  const driftBoost = input.drift.severity === "severe" ? 0.35 : input.drift.severity === "mild" ? 0.18 : 0;
  const tighten = clampNumber(weakness * sampleWeight + driftBoost, 0, 1);

  return {
    minConfidence: Number((base.confidence + tighten * 13).toFixed(2)),
    minEdgeScore: Number((base.edge + tighten * 8.5).toFixed(2)),
    minValueScore: Number((base.value + tighten * 0.11).toFixed(4)),
    minProbabilityEdge: Number((base.probEdge + tighten * 0.08).toFixed(4)),
    maxOdds: Number(clampNumber(base.maxOdds - tighten * 1.35, 2.6, base.maxOdds).toFixed(2))
  };
}

function passesAdaptiveGate(
  candidate: TrainingCandidate,
  performance: Record<FocusedMarketKey, MarketPerformance>,
  profiles: Record<FocusedMarketKey, CalibrationProfile>,
  drift: { active: boolean; severity: "none" | "mild" | "severe" }
): boolean {
  const rec = candidate.recommendation;
  const perf = performance[candidate.trainingMarket];
  const sampleReady = perf.recentSample >= 25;
  const calibratedProbability = calibrateProbability(rec, candidate.trainingMarket, profiles);
  const implied = impliedProbabilityFromOdds(rec.currentOdds);
  const probabilityEdge = calibratedProbability - implied;

  const thresholdCurve = dynamicThresholdCurve({
    market: candidate.trainingMarket,
    performance: perf,
    drift
  });

  // Baseline quality floor for all markets.
  if (
    rec.confidence < thresholdCurve.minConfidence ||
    rec.edgeScore < thresholdCurve.minEdgeScore ||
    rec.valueScore < thresholdCurve.minValueScore ||
    rec.currentOdds > thresholdCurve.maxOdds
  ) {
    return false;
  }

  if (probabilityEdge < thresholdCurve.minProbabilityEdge) {
    return false;
  }

  // If the market still has little history, require an extra margin on all dimensions.
  if (!sampleReady) {
    return (
      rec.confidence >= thresholdCurve.minConfidence + 2 &&
      rec.edgeScore >= thresholdCurve.minEdgeScore + 0.8 &&
      rec.valueScore >= thresholdCurve.minValueScore + 0.01 &&
      probabilityEdge >= thresholdCurve.minProbabilityEdge + 0.008
    );
  }

  return true;
}

export function toFocusedTrainingFixture(fixture: Fixture, minRecommendedOdds: number): Fixture | null {
  const focusedOptions = fixture.marketOptions.filter(
    (option) => isFocusedTrainingMarketOption(option) && option.currentOdds >= minRecommendedOdds
  );

  if (focusedOptions.length === 0) {
    return null;
  }

  return {
    ...fixture,
    marketOptions: focusedOptions
  };
}

export async function getAdaptiveGateSnapshot(
  backtestStore: BacktestStore,
  persistedProfiles?: PersistedCalibrationProfiles
): Promise<{ snapshot: AdaptiveGateSnapshot; mergedProfiles: PersistedCalibrationProfiles }> {
  const marketTrend = await backtestStore.focusedMarketHitRateTrend({
    source: "auto",
    recentLimit: 80,
    trendDays: 30
  });

  const driftState = detectConceptDrift(
    await backtestStore.focusedMarketHitRateTrend({
      source: "auto",
      recentLimit: 40,
      trendDays: 14
    })
  );

  const recentAutoRecords = await backtestStore.listBackgroundTrainingRecords({
    source: "auto",
    limit: 800
  });

  const performanceByMarket = marketPerformanceMap(marketTrend);
  const liveProfiles = buildCalibrationProfiles(recentAutoRecords);
  const mergedProfiles = mergeCalibrationProfiles(persistedProfiles, liveProfiles);

  const marketKeys: FocusedMarketKey[] = ["asian_handicap", "match_result", "goals_over_under"];
  const markets = Object.fromEntries(
    marketKeys.map((marketKey) => {
      const trendItem = marketTrend.markets.find((market) => market.key === marketKey);
      const performance = performanceByMarket[marketKey];
      return [
        marketKey,
        {
          recentHitRate: performance.recentHitRate,
          recentSample: performance.recentSample,
          totalSample: trendItem?.totalSample ?? 0,
          calibration: mergedProfiles.markets[marketKey],
          thresholds: dynamicThresholdCurve({
            market: marketKey,
            performance,
            drift: driftState
          })
        }
      ];
    })
  ) as AdaptiveGateSnapshot["markets"];

  return {
    snapshot: {
      generatedAt: new Date().toISOString(),
      drift: {
        active: driftState.active,
        severity: driftState.severity,
        candidateRatioFactor: driftRatioFactor(driftState)
      },
      calibrationUpdatedAt: persistedProfiles?.updatedAt,
      markets
    },
    mergedProfiles
  };
}

function normalizeCycleOptions(
  sourceOrOptions: "auto" | "practice" | AutoTrainingCycleOptions
): Required<Pick<AutoTrainingCycleOptions, "source">> &
  Pick<
    AutoTrainingCycleOptions,
    "consensus" | "candidateRatio" | "calibrationProfiles" | "onCalibrationProfilesUpdated"
  > {
  if (typeof sourceOrOptions === "string") {
    return { source: sourceOrOptions };
  }

  return {
    source: sourceOrOptions.source ?? "auto",
    consensus: sourceOrOptions.consensus,
    candidateRatio: sourceOrOptions.candidateRatio,
    calibrationProfiles: sourceOrOptions.calibrationProfiles,
    onCalibrationProfilesUpdated: sourceOrOptions.onCalibrationProfilesUpdated
  };
}

export async function runAutoTrainingCycle(
  service: AnalysisService,
  backtestStore: BacktestStore,
  sourceOrOptions: "auto" | "practice" | AutoTrainingCycleOptions = "auto"
): Promise<number> {
  const { source, consensus, candidateRatio, calibrationProfiles, onCalibrationProfilesUpdated } = normalizeCycleOptions(sourceOrOptions);
  const snapshot = service.getSnapshot();
  const settledFixtures = snapshot.fixtures.filter(isSettledFixture);

  if (settledFixtures.length === 0) {
    return 0;
  }

  const weights = service.getWeights();
  const thresholds = service.getThresholds();

  const candidates: TrainingCandidate[] = [];
  for (const fixture of settledFixtures) {
    const focusedFixture = toFocusedTrainingFixture(fixture, thresholds.minRecommendedOdds);
    if (!focusedFixture) {
      continue;
    }

    const rec = scoreFixture(focusedFixture, weights, thresholds);
    const predicted = predictedSideFromRecommendation(rec);
    const actual = actualSideFromFixture(rec, fixture);

    if (!predicted || !actual) {
      continue;
    }

    const trainingMarket = classifyFocusedTrainingMarket(rec);
    if (!trainingMarket) {
      continue;
    }

    candidates.push({
      recommendation: rec,
      predicted,
      actual,
      trainingMarket,
      fixture
    });
  }

  if (candidates.length === 0) {
    return 0;
  }

  const { snapshot: gateSnapshot, mergedProfiles: mergedCalibrationProfiles } = await getAdaptiveGateSnapshot(
    backtestStore,
    calibrationProfiles
  );

  if (onCalibrationProfilesUpdated && source === "auto") {
    await onCalibrationProfilesUpdated(mergedCalibrationProfiles);
  }

  const performanceFromSnapshot = marketPerformanceMap({
    markets: Object.entries(gateSnapshot.markets).map(([key, value]) => ({
      key: key as FocusedMarketKey,
      recentHitRate: value.recentHitRate,
      recentSample: value.recentSample
    }))
  });

  const gatedCandidates = candidates.filter((candidate) =>
    passesAdaptiveGate(candidate, performanceFromSnapshot, mergedCalibrationProfiles.markets, gateSnapshot.drift)
  );
  if (gatedCandidates.length === 0) {
    return 0;
  }

  const rankedCandidates = [...gatedCandidates].sort((left, right) =>
    recommendationSortScore(left.recommendation, right.recommendation)
  );
  const effectiveCandidateRatio = Math.min(1, Math.max(0.05, (candidateRatio ?? 0.35) * gateSnapshot.drift.candidateRatioFactor));
  const shortlistLimit = Math.max(1, Math.min(rankedCandidates.length, Math.ceil(rankedCandidates.length * effectiveCandidateRatio)));
  const shortlistedCandidates = rankedCandidates.slice(0, shortlistLimit);

  let approvedCandidates = shortlistedCandidates;
  if (consensus?.enabled ?? false) {
    const consensusResult = await reviewRecommendationsForConsensus(
      shortlistedCandidates.map((candidate) => candidate.recommendation),
      {
        apiKey: consensus?.apiKey,
        model: consensus?.model,
        fallbackModels: consensus?.fallbackModels,
        temperature: consensus?.temperature,
        referer: consensus?.referer,
        title: consensus?.title
      }
    );

    if (consensusResult.reviewMode === "openrouter") {
      const approvedKeys = new Set(
        consensusResult.recommendations.map(
          (recommendation) => `${recommendation.fixtureId}::${recommendation.market}::${recommendation.selectionName}`
        )
      );
      approvedCandidates = shortlistedCandidates.filter((candidate) =>
        approvedKeys.has(
          `${candidate.recommendation.fixtureId}::${candidate.recommendation.market}::${candidate.recommendation.selectionName}`
        )
      );
    }
  }

  const autoRecords: BacktestRecord[] = approvedCandidates.map((candidate) => ({
    fixtureId: candidate.fixture.id,
    market: candidate.predicted,
    trainingMarket: candidate.trainingMarket,
    odds: candidate.recommendation.currentOdds,
    modelProbability: candidate.recommendation.confidence / 100,
    stake: 1,
    result: candidate.predicted === candidate.actual ? "win" : "loss",
    placedAt: candidate.fixture.kickoffAt,
    source
  }));

  if (autoRecords.length === 0) {
    return 0;
  }

  const added = source === "practice" ? await backtestStore.addPracticeRecords(autoRecords) : await backtestStore.addAutoRecords(autoRecords);
  return added;
}
