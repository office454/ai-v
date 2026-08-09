import type { Fixture, MarketOption, TeamStrength } from "../types.js";

export type HighWaterMarket = "correct_score" | "half_full_time";
export type DriftLevel = "none" | "mild" | "severe";

export type HighWaterThresholdProfile = {
  market: HighWaterMarket;
  label: string;
  minOdds: number;
  minEdgePct: number;
  minEvPct: number;
  minConfidence: number;
};

export type HighWaterCandidate = {
  fixtureId: string;
  match: string;
  kickoffAt: string;
  league?: string;
  marketType: HighWaterMarket;
  market: string;
  selectionName: string;
  currentOdds: number;
  impliedProbability: number;
  modelProbability: number;
  confidence: number;
  edgePct: number;
  evPct: number;
  driftLevel: DriftLevel;
  thresholdLabel: string;
  score: number;
  rationale: string[];
};

export type HighWaterRecommendationSnapshot = {
  generatedAt: string;
  drift: {
    level: DriftLevel;
    candidateRatioFactor: number;
  };
  thresholds: Record<HighWaterMarket, HighWaterThresholdProfile>;
  topCandidates: HighWaterCandidate[];
  byMarket: Record<HighWaterMarket, HighWaterCandidate[]>;
};

const STRENGTH_SIGNAL: Record<TeamStrength, number> = {
  elite: 0.12,
  strong: 0.06,
  average: 0,
  weak: -0.06
};

const BASE_THRESHOLDS: Record<HighWaterMarket, Omit<HighWaterThresholdProfile, "market" | "label">> = {
  correct_score: {
    minOdds: 6.5,
    minEdgePct: 4.6,
    minEvPct: 3.2,
    minConfidence: 74
  },
  half_full_time: {
    minOdds: 4.0,
    minEdgePct: 3.8,
    minEvPct: 2.4,
    minConfidence: 71
  }
};

const DRIFT_STRICTNESS: Record<DriftLevel, number> = {
  none: 1,
  mild: 1.16,
  severe: 1.34
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function impliedProbability(odds: number): number {
  return 1 / Math.max(odds, 1.0001);
}

function isSellable(option: MarketOption): boolean {
  return option.poolStatus.toLowerCase().includes("sell") && option.combinationStatus.toLowerCase().includes("sell");
}

function marketType(option: MarketOption): HighWaterMarket | null {
  const oddsType = option.oddsType.toUpperCase();
  const name = option.oddsTypeName;
  if (oddsType === "CRS" || name.includes("波膽")) {
    return "correct_score";
  }

  if (oddsType === "HFT" || name.includes("半全場")) {
    return "half_full_time";
  }

  return null;
}

function oddsMomentumSignal(fixture: Fixture): number {
  if (fixture.oddsHistory.length < 2) {
    return 0;
  }

  const first = fixture.oddsHistory[0];
  const last = fixture.oddsHistory[fixture.oddsHistory.length - 1];
  const firstBest = Math.min(first.homeWin, first.draw, first.awayWin);
  const lastBest = Math.min(last.homeWin, last.draw, last.awayWin);
  return clamp((firstBest - lastBest) / Math.max(firstBest, 0.0001), -0.25, 0.25) * 0.4;
}

function lineupSignal(fixture: Fixture): number {
  const avg = (list: Array<{ fitness: number; recentForm: number }>): number => {
    if (list.length === 0) {
      return 0;
    }
    return list.reduce((sum, player) => sum + (player.fitness + player.recentForm) / 200, 0) / list.length;
  };

  const home = avg(fixture.lineup.home);
  const away = avg(fixture.lineup.away);
  const confirmation = fixture.lineup.confirmed ? 0.01 : -0.01;
  return clamp((home - away) * 0.4 + confirmation, -0.08, 0.08);
}

function fixtureBiasSignal(fixture: Fixture): number {
  const strength = STRENGTH_SIGNAL[fixture.homeStrength] - STRENGTH_SIGNAL[fixture.awayStrength];
  const recentForm = clamp((fixture.homeRecentPoints - fixture.awayRecentPoints) / 80, -0.08, 0.08);
  const sentiment = clamp(fixture.expertSentiment * 0.05, -0.04, 0.04);
  return clamp(strength + recentForm + sentiment + lineupSignal(fixture) + oddsMomentumSignal(fixture), -0.16, 0.16);
}

function selectionSignal(option: MarketOption, market: HighWaterMarket, bias: number): number {
  const selection = option.selectionName.replace(/\s+/g, "");
  if (market === "half_full_time") {
    if (selection.includes("主-主") || selection.includes("主/主")) {
      return bias > 0 ? 0.03 : -0.02;
    }
    if (selection.includes("客-客") || selection.includes("客/客")) {
      return bias < 0 ? 0.03 : -0.02;
    }
    if (selection.includes("和-和") || selection.includes("和/和")) {
      return Math.abs(bias) < 0.04 ? 0.012 : -0.01;
    }
    return 0;
  }

  const scoreMatch = selection.match(/(\d+)\s*[:：-]\s*(\d+)/);
  if (!scoreMatch) {
    return 0;
  }

  const homeGoals = Number(scoreMatch[1]);
  const awayGoals = Number(scoreMatch[2]);
  const gap = homeGoals - awayGoals;
  if (gap >= 2) {
    return bias > 0 ? 0.018 : -0.016;
  }
  if (gap <= -2) {
    return bias < 0 ? 0.018 : -0.016;
  }
  if (gap === 0) {
    return Math.abs(bias) < 0.05 ? 0.01 : -0.008;
  }
  return 0.004;
}

function scoreCandidate(
  fixture: Fixture,
  option: MarketOption,
  market: HighWaterMarket,
  drift: DriftLevel
): HighWaterCandidate {
  const odds = Number(option.currentOdds.toFixed(2));
  const pImplied = impliedProbability(odds);
  const fixtureBias = fixtureBiasSignal(fixture);
  const marketBias = market === "correct_score" ? -0.01 : 0.004;
  const selectionBias = selectionSignal(option, market, fixtureBias);
  const confidenceSignal = clamp((fixtureBias + marketBias + selectionBias) * 0.75, -0.08, 0.1);
  const pModel = clamp(pImplied + confidenceSignal, 0.012, 0.92);
  const edgePct = (pModel - pImplied) * 100;
  const evPct = (pModel * odds - 1) * 100;
  const confidence = pModel * 100;
  const driftPenalty = drift === "severe" ? 4 : drift === "mild" ? 2 : 0;
  const score = evPct * 0.56 + edgePct * 0.32 + confidence * 0.12 - driftPenalty;

  const rationale: string[] = [];
  if (fixtureBias > 0.05) {
    rationale.push("主隊訊號偏強，方向一致性較高");
  } else if (fixtureBias < -0.05) {
    rationale.push("客隊訊號偏強，方向一致性較高");
  } else {
    rationale.push("雙方基礎訊號接近，需靠賠率優勢過濾");
  }

  if (!fixture.lineup.confirmed) {
    rationale.push("陣容未最終確認，已提高風險權重");
  }

  if (odds >= 10) {
    rationale.push("屬超高賠率選項，命中波動較大");
  }

  return {
    fixtureId: fixture.id,
    match: `${fixture.homeTeam} vs ${fixture.awayTeam}`,
    kickoffAt: fixture.kickoffAt,
    league: fixture.league,
    marketType: market,
    market: option.oddsTypeName,
    selectionName: option.selectionName,
    currentOdds: odds,
    impliedProbability: Number((pImplied * 100).toFixed(2)),
    modelProbability: Number((pModel * 100).toFixed(2)),
    confidence: Number(confidence.toFixed(1)),
    edgePct: Number(edgePct.toFixed(2)),
    evPct: Number(evPct.toFixed(2)),
    driftLevel: drift,
    thresholdLabel: market === "correct_score" ? "波膽" : "半全場",
    score: Number(score.toFixed(3)),
    rationale
  };
}

function buildThreshold(
  market: HighWaterMarket,
  drift: DriftLevel,
  candidateRatioFactor: number
): HighWaterThresholdProfile {
  const base = BASE_THRESHOLDS[market];
  const strictness = DRIFT_STRICTNESS[drift] * clamp(candidateRatioFactor, 0.7, 1.6);
  const oddsLift = (strictness - 1) * (market === "correct_score" ? 1.1 : 0.7);
  const confidenceLift = (strictness - 1) * 7;

  return {
    market,
    label: market === "correct_score" ? "波膽" : "半全場",
    minOdds: Number((base.minOdds + oddsLift).toFixed(2)),
    minEdgePct: Number((base.minEdgePct * strictness).toFixed(2)),
    minEvPct: Number((base.minEvPct * strictness).toFixed(2)),
    minConfidence: Number((base.minConfidence + confidenceLift).toFixed(1))
  };
}

function passThreshold(candidate: HighWaterCandidate, threshold: HighWaterThresholdProfile): boolean {
  return (
    candidate.currentOdds >= threshold.minOdds
    && candidate.edgePct >= threshold.minEdgePct
    && candidate.evPct >= threshold.minEvPct
    && candidate.confidence >= threshold.minConfidence
  );
}

export function buildHighWaterRecommendationSnapshot(
  fixtures: Fixture[],
  options?: {
    limit?: number;
    driftLevel?: DriftLevel;
    candidateRatioFactor?: number;
  }
): HighWaterRecommendationSnapshot {
  const driftLevel = options?.driftLevel ?? "none";
  const candidateRatioFactor = clamp(options?.candidateRatioFactor ?? 1, 0.7, 1.8);
  const limit = Math.max(1, Math.min(20, options?.limit ?? 8));

  const thresholds: Record<HighWaterMarket, HighWaterThresholdProfile> = {
    correct_score: buildThreshold("correct_score", driftLevel, candidateRatioFactor),
    half_full_time: buildThreshold("half_full_time", driftLevel, candidateRatioFactor)
  };

  const byMarketCandidates: Record<HighWaterMarket, HighWaterCandidate[]> = {
    correct_score: [],
    half_full_time: []
  };

  for (const fixture of fixtures) {
    for (const option of fixture.marketOptions) {
      if (!isSellable(option) || !Number.isFinite(option.currentOdds) || option.currentOdds <= 1.01) {
        continue;
      }

      const typedMarket = marketType(option);
      if (!typedMarket) {
        continue;
      }

      const candidate = scoreCandidate(fixture, option, typedMarket, driftLevel);
      const threshold = thresholds[typedMarket];
      if (!passThreshold(candidate, threshold)) {
        continue;
      }

      byMarketCandidates[typedMarket].push(candidate);
    }
  }

  const perMarketLimit = Math.max(1, Math.ceil(limit / 2));
  const byMarket: Record<HighWaterMarket, HighWaterCandidate[]> = {
    correct_score: byMarketCandidates.correct_score
      .sort((a, b) => b.score - a.score || b.evPct - a.evPct || b.currentOdds - a.currentOdds)
      .slice(0, perMarketLimit),
    half_full_time: byMarketCandidates.half_full_time
      .sort((a, b) => b.score - a.score || b.evPct - a.evPct || b.currentOdds - a.currentOdds)
      .slice(0, perMarketLimit)
  };

  const topCandidates = [...byMarket.correct_score, ...byMarket.half_full_time]
    .sort((a, b) => b.score - a.score || b.evPct - a.evPct || b.edgePct - a.edgePct)
    .slice(0, limit);

  return {
    generatedAt: new Date().toISOString(),
    drift: {
      level: driftLevel,
      candidateRatioFactor: Number(candidateRatioFactor.toFixed(3))
    },
    thresholds,
    topCandidates,
    byMarket
  };
}
