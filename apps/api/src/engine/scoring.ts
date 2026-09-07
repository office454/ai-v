import type { Fixture, MarketOption, Recommendation, ScoringWeights, TeamStrength } from "../types.js";
import {
  countOverUnderProbability,
  gammaPoissonLiveUpdate,
  leagueCornerDispersion
} from "./cornerDistribution.js";

export interface RecommendationThresholds {
  minRecommendedOdds: number;
  highOddsThreshold: number;
  highOddsMinEdgeScore: number;
  highOddsMinValueScore: number;
}

export const DEFAULT_MIN_RECOMMENDED_ODDS = 1.4;
export const DEFAULT_HIGH_ODDS_THRESHOLD = 2.2;
export const HIGH_ODDS_CONFIDENCE_THRESHOLD = 55;
export const DEFAULT_RECOMMENDATION_THRESHOLDS: RecommendationThresholds = {
  minRecommendedOdds: DEFAULT_MIN_RECOMMENDED_ODDS,
  highOddsThreshold: DEFAULT_HIGH_ODDS_THRESHOLD,
  highOddsMinEdgeScore: 2.2,
  highOddsMinValueScore: 0.07
};

const strengthMap: Record<TeamStrength, number> = {
  elite: 0.95,
  strong: 0.78,
  average: 0.55,
  weak: 0.3
};

export const DEFAULT_WEIGHTS: ScoringWeights = {
  strengthGap: 0.3,
  recentForm: 0.18,
  lineupFitness: 0.18,
  expertSentiment: 0.12,
  oddsMomentum: 0.1
};

const DEFAULT_FULL_TIME_WEIGHTS: ScoringWeights = {
  strengthGap: 0.32,
  recentForm: 0.2,
  lineupFitness: 0.18,
  expertSentiment: 0.12,
  oddsMomentum: 0.08
};

const DEFAULT_HALF_TIME_WEIGHTS: ScoringWeights = {
  strengthGap: 0.24,
  recentForm: 0.16,
  lineupFitness: 0.16,
  expertSentiment: 0.1,
  oddsMomentum: 0.12
};

const DEFAULT_CORNERS_WEIGHTS: ScoringWeights = {
  strengthGap: 0.2,
  recentForm: 0.14,
  lineupFitness: 0.24,
  expertSentiment: 0.12,
  oddsMomentum: 0.1
};

const DEFAULT_GOALS_WEIGHTS: ScoringWeights = {
  strengthGap: 0.24,
  recentForm: 0.18,
  lineupFitness: 0.16,
  expertSentiment: 0.12,
  oddsMomentum: 0.14
};

const ODDS_TYPE_NAME_MAP: Record<string, string> = {
  AGS: "任何時間入球球員",
  CEA: "球隊半場開出角球大細",
  CEH: "球隊半場開出角球大細",
  CFA: "球隊開出角球大細",
  CFH: "球隊開出角球大細",
  CHA: "球隊半場入球大細",
  CHD: "開出角球讓球",
  CHH: "球隊半場入球大細",
  CHL: "開出角球大細",
  CRS: "波膽",
  ECD: "半場開出角球讓球",
  ECH: "半場開出角球大細",
  ECS: "半場波膽",
  EHA: "讓球主客和",
  EDC: "半場讓球",
  EHL: "半場入球大細",
  EHH: "球隊半場入球大細",
  ELA: "球隊半場入球大細",
  ELH: "球隊半場入球大細",
  ENT: "特別項目",
  ETG: "半場總入球",
  FCH: "球隊開出角球大細",
  FCS: "最後入球球員",
  FHA: "半場主客和",
  FHC: "球隊半場開出角球大細",
  FHH: "半場讓球",
  FHL: "半場入球大細",
  FLA: "球隊入球大細",
  FLH: "球隊入球大細",
  FGS: "首名入球",
  FTS: "第一隊入球",
  HAD: "主客和",
  HDC: "讓球",
  HFT: "半全場",
  HHA: "讓球主客和",
  HIL: "入球大細",
  HLH: "球隊入球大細",
  HLA: "球隊入球大細",
  LGS: "最後入球球員",
  MSP: "特別項目",
  NGS: "無入球球員",
  NTS: "兩隊皆入球",
  OOE: "入球單雙",
  SGA: "同場過關",
  TQL: "晉級隊伍",
  TTG: "總入球"
};

type TeamSide = "home" | "away";
type TeamMetric = "角球" | "入球";
type TeamPeriod = "全場" | "半場";

const TEAM_MARKET_CONTEXT: Record<string, { side: TeamSide; metric: TeamMetric; period: TeamPeriod }> = {
  CHH: { side: "home", metric: "角球", period: "全場" },
  CHA: { side: "away", metric: "角球", period: "全場" },
  CFH: { side: "home", metric: "角球", period: "半場" },
  CFA: { side: "away", metric: "角球", period: "半場" },
  CEH: { side: "home", metric: "角球", period: "半場" },
  CEA: { side: "away", metric: "角球", period: "半場" },
  HLH: { side: "home", metric: "入球", period: "全場" },
  HLA: { side: "away", metric: "入球", period: "全場" },
  FLH: { side: "home", metric: "入球", period: "半場" },
  FLA: { side: "away", metric: "入球", period: "半場" },
  ELH: { side: "home", metric: "入球", period: "半場" },
  ELA: { side: "away", metric: "入球", period: "半場" },
  EHH: { side: "home", metric: "入球", period: "半場" }
};

export function normalizeWeights(input: Partial<ScoringWeights> = {}): ScoringWeights {
  const merged: ScoringWeights = {
    ...DEFAULT_WEIGHTS,
    ...input
  };

  const sum = Object.values(merged).reduce((acc, value) => acc + Math.max(0, value), 0);
  if (sum <= 0) {
    return DEFAULT_WEIGHTS;
  }

  return {
    strengthGap: merged.strengthGap / sum,
    recentForm: merged.recentForm / sum,
    lineupFitness: merged.lineupFitness / sum,
    expertSentiment: merged.expertSentiment / sum,
    oddsMomentum: merged.oddsMomentum / sum
  };
}

export function normalizeRecommendationThresholds(
  input: Partial<RecommendationThresholds> = {}
): RecommendationThresholds {
  const minRecommendedOdds = Math.max(
    1.01,
    input.minRecommendedOdds ?? DEFAULT_RECOMMENDATION_THRESHOLDS.minRecommendedOdds
  );
  const highOddsThreshold = Math.max(
    minRecommendedOdds,
    input.highOddsThreshold ?? DEFAULT_RECOMMENDATION_THRESHOLDS.highOddsThreshold
  );
  const highOddsMinEdgeScore = Math.max(
    0,
    input.highOddsMinEdgeScore ?? DEFAULT_RECOMMENDATION_THRESHOLDS.highOddsMinEdgeScore
  );
  const highOddsMinValueScore = Math.max(
    0,
    input.highOddsMinValueScore ?? DEFAULT_RECOMMENDATION_THRESHOLDS.highOddsMinValueScore
  );

  return {
    minRecommendedOdds: Number(minRecommendedOdds.toFixed(2)),
    highOddsThreshold: Number(highOddsThreshold.toFixed(2)),
    highOddsMinEdgeScore: Number(highOddsMinEdgeScore.toFixed(2)),
    highOddsMinValueScore: Number(highOddsMinValueScore.toFixed(3))
  };
}

function avg(n: number[]): number {
  return n.reduce((sum, v) => sum + v, 0) / Math.max(n.length, 1);
}

function lineupScore(fixture: Fixture): number {
  const playerScores = (players: Fixture["lineup"]["home"]): number[] => players
    .filter((player) => Number.isFinite(player.fitness) && Number.isFinite(player.recentForm))
    .map((player) => (player.fitness! + player.recentForm!) / 2);
  const home = avg(playerScores(fixture.lineup.home));
  const away = avg(playerScores(fixture.lineup.away));
  const baseGap = (home - away) / 100;
  const confirmationBoost = fixture.lineup.confirmed ? 0.06 : -0.03;
  return baseGap + confirmationBoost;
}

function recentFormCurve(fixture: Fixture): number {
  const homeRecent = fixture.homeRecentPoints;
  const awayRecent = fixture.awayRecentPoints;
  const rawGap = (homeRecent - awayRecent) / 15;
  return Math.max(-0.4, Math.min(0.4, rawGap));
}

function oddsMomentum(fixture: Fixture): number {
  if (fixture.oddsHistory.length < 2) {
    return 0;
  }

  const first = fixture.oddsHistory[0];
  const last = fixture.oddsHistory[fixture.oddsHistory.length - 1];
  const firstBest = Math.min(first.homeWin, first.draw, first.awayWin);
  const lastBest = Math.min(last.homeWin, last.draw, last.awayWin);
  const drift = (firstBest - lastBest) / Math.max(firstBest, 0.0001);

  return Math.max(-0.25, Math.min(0.25, drift));
}

function impliedProbability(odds: number): number {
  return 1 / Math.max(odds, 1.0001);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scorelineFromExpectedGoals(homeXg: number, awayXg: number): string {
  const homeGoals = Math.max(0, Math.min(5, Math.round(homeXg)));
  const awayGoals = Math.max(0, Math.min(5, Math.round(awayXg)));
  return `${homeGoals}-${awayGoals}`;
}

function poissonProbability(lambda: number, goals: number): number {
  if (goals < 0) {
    return 0;
  }

  const safeLambda = Math.max(0.001, lambda);
  let factorial = 1;
  for (let i = 2; i <= goals; i += 1) {
    factorial *= i;
  }

  return (Math.exp(-safeLambda) * Math.pow(safeLambda, goals)) / factorial;
}

function historicalCornerExpectation(fixture: Fixture, option: MarketOption): number | null {
  const home = fixture.homeAverageCorners;
  const away = fixture.awayAverageCorners;
  const context = TEAM_MARKET_CONTEXT[option.oddsType.toUpperCase()];
  let fullTimeExpectation: number | null = null;

  if (context?.metric === "角球") {
    fullTimeExpectation = context.side === "home" ? home ?? null : away ?? null;
  } else if (marketFamily(option) === "corners") {
    fullTimeExpectation = Number.isFinite(home) && Number.isFinite(away) ? home! + away! : null;
  }

  if (fullTimeExpectation === null) return null;
  return isHalfTimeMarket(option) ? fullTimeExpectation * (45 / 95) : fullTimeExpectation;
}

function liveAttackingHomeShare(fixture: Fixture): number | null {
  const metrics = fixture.liveAttackingMetrics;
  const signals = metrics ? [
    { pair: metrics.dangerousAttacks, weight: 0.35 },
    { pair: metrics.finalThirdEntries, weight: 0.3 },
    { pair: metrics.crosses, weight: 0.2 },
    { pair: metrics.accurateCrosses, weight: 0.1 },
    { pair: metrics.possession, weight: 0.05 }
  ].filter((signal): signal is { pair: { home: number; away: number }; weight: number } => {
    const total = (signal.pair?.home ?? 0) + (signal.pair?.away ?? 0);
    return !!signal.pair && total > 0;
  }) : [];
  const redCards = fixture.livePressureMetrics?.redCards;
  const redCardAdjustment = redCards
    ? clamp((redCards.away - redCards.home) * 0.08, -0.08, 0.08)
    : 0;
  if (signals.length === 0) return redCards ? 0.5 + redCardAdjustment : null;
  const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0);
  const attackingShare = signals.reduce((sum, signal) => {
    const total = signal.pair.home + signal.pair.away;
    return sum + (signal.pair.home / total) * signal.weight;
  }, 0) / totalWeight;
  return clamp(attackingShare + redCardAdjustment, 0.15, 0.85);
}

export function poissonOutcomeProbabilities(
  homeExpectedGoals: number,
  awayExpectedGoals: number
): { home: number; draw: number; away: number } {
  const outcomes = { home: 0, draw: 0, away: 0 };

  for (let homeGoals = 0; homeGoals <= 12; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 12; awayGoals += 1) {
      const probability =
        poissonProbability(homeExpectedGoals, homeGoals) * poissonProbability(awayExpectedGoals, awayGoals);
      if (homeGoals > awayGoals) {
        outcomes.home += probability;
      } else if (homeGoals < awayGoals) {
        outcomes.away += probability;
      } else {
        outcomes.draw += probability;
      }
    }
  }

  const coveredProbability = outcomes.home + outcomes.draw + outcomes.away;
  return {
    home: outcomes.home / coveredProbability,
    draw: outcomes.draw / coveredProbability,
    away: outcomes.away / coveredProbability
  };
}

function scorelineOutcome(scoreline: string): "home" | "draw" | "away" {
  const parsed = parseScoreline(scoreline);
  if (parsed.home > parsed.away) {
    return "home";
  }
  if (parsed.home < parsed.away) {
    return "away";
  }
  return "draw";
}

function parseScoreline(scoreline: string): { home: number; away: number } {
  const match = scoreline.match(/^(\d+)-(\d+)$/);
  if (!match) {
    return { home: 0, away: 0 };
  }

  return {
    home: Number(match[1]),
    away: Number(match[2])
  };
}

function parseExactScoreSelection(selectionName: string): { home: number; away: number } | null {
  const match = selectionName.trim().match(/(\d+)\s*[:-]\s*(\d+)/);
  if (!match) {
    return null;
  }

  return {
    home: Number(match[1]),
    away: Number(match[2])
  };
}

function formatScoreline(home: number, away: number): string {
  return `${Math.max(0, Math.min(5, home))}-${Math.max(0, Math.min(5, away))}`;
}

type ScorelineCandidate = {
  scoreline: string;
  combinedScore: number;
  modelProbability: number;
  marketProbability: number;
  source: "market_blended" | "model_only";
};

function parseLineConditionValue(raw: string): number | null {
  const cleaned = raw.replace(/\[|\]/g, "").trim();
  if (!cleaned || ["n/a", "na"].includes(cleaned.toLowerCase())) {
    return null;
  }

  const matches = cleaned.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) {
    return null;
  }

  const values = matches.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length;
}

function detectOverUnderDirection(selectionName: string): "over" | "under" | null {
  const text = selectionName.replace(/\s+/g, "");
  if ((text.includes("大") || text.toLowerCase().includes("over")) && !text.includes("細")) {
    return "over";
  }
  if ((text.includes("細") || text.toLowerCase().includes("under")) && !text.includes("大")) {
    return "under";
  }
  return null;
}

function detectWinDrawLoseDirection(selectionName: string): "home" | "draw" | "away" | null {
  const text = selectionName.replace(/\s+/g, "").toLowerCase();

  if (text.includes("和") || text.includes("和局") || text.includes("draw") || text === "d") {
    return "draw";
  }

  const homeSignals = ["主勝", "主隊勝", "home"];
  if (homeSignals.some((signal) => text.includes(signal))) {
    return "home";
  }

  const awaySignals = ["客勝", "客隊勝", "away"];
  if (awaySignals.some((signal) => text.includes(signal))) {
    return "away";
  }

  return null;
}

function distributeGoalsByBias(totalGoals: number, homeBias: number): { home: number; away: number } {
  const clampedTotal = Math.max(0, Math.min(5, totalGoals));
  const ratio = Math.max(0, Math.min(1, homeBias));
  const home = Math.max(0, Math.min(clampedTotal, Math.round(clampedTotal * ratio)));
  const away = Math.max(0, clampedTotal - home);
  return { home, away };
}

function applyTotalGoalsConstraint(
  scoreline: string,
  lineValue: number,
  direction: "over" | "under",
  homeBias: number
): string {
  const parsed = parseScoreline(scoreline);
  const currentTotal = parsed.home + parsed.away;

  if (direction === "over") {
    const minRequired = Math.max(0, Math.floor(lineValue) + 1);
    if (currentTotal > lineValue) {
      return scoreline;
    }
    const adjusted = distributeGoalsByBias(minRequired, homeBias);
    return `${adjusted.home}-${adjusted.away}`;
  }

  const maxAllowed = Math.max(0, Math.ceil(lineValue) - 1);
  if (currentTotal < lineValue) {
    return scoreline;
  }
  const adjusted = distributeGoalsByBias(maxAllowed, homeBias);
  return `${adjusted.home}-${adjusted.away}`;
}

function mostLikelyScoreline(
  homeXg: number,
  awayXg: number,
  outcomeConstraint: "home" | "draw" | "away" | null,
  totalGoalsConstraint?: { direction: "over" | "under"; line: number },
  minGoalsConstraint?: { home: number; away: number }
): string {
  const maxGoals = 5;
  let best: { home: number; away: number; probability: number } | null = null;

  const minHomeGoals = Math.max(0, Math.min(maxGoals, minGoalsConstraint?.home ?? 0));
  const minAwayGoals = Math.max(0, Math.min(maxGoals, minGoalsConstraint?.away ?? 0));

  for (let home = minHomeGoals; home <= maxGoals; home += 1) {
    for (let away = minAwayGoals; away <= maxGoals; away += 1) {
      const currentOutcome: "home" | "draw" | "away" = home > away ? "home" : home < away ? "away" : "draw";
      if (outcomeConstraint && currentOutcome !== outcomeConstraint) {
        continue;
      }

      if (totalGoalsConstraint) {
        const total = home + away;
        if (totalGoalsConstraint.direction === "over" && !(total > totalGoalsConstraint.line)) {
          continue;
        }
        if (totalGoalsConstraint.direction === "under" && !(total < totalGoalsConstraint.line)) {
          continue;
        }
      }

      const probability = poissonProbability(homeXg, home) * poissonProbability(awayXg, away);
      if (!best || probability > best.probability) {
        best = { home, away, probability };
      }
    }
  }

  if (best) {
    return `${best.home}-${best.away}`;
  }

  return scorelineFromExpectedGoals(homeXg, awayXg);
}

function rankedModelScoreCandidates(
  homeXg: number,
  awayXg: number,
  outcomeConstraint: "home" | "draw" | "away" | null,
  totalGoalsConstraint?: { direction: "over" | "under"; line: number },
  minGoalsConstraint?: { home: number; away: number }
): ScorelineCandidate[] {
  const maxGoals = 5;
  const minHomeGoals = Math.max(0, Math.min(maxGoals, minGoalsConstraint?.home ?? 0));
  const minAwayGoals = Math.max(0, Math.min(maxGoals, minGoalsConstraint?.away ?? 0));
  const candidates: ScorelineCandidate[] = [];

  for (let home = minHomeGoals; home <= maxGoals; home += 1) {
    for (let away = minAwayGoals; away <= maxGoals; away += 1) {
      const currentOutcome: "home" | "draw" | "away" = home > away ? "home" : home < away ? "away" : "draw";
      if (outcomeConstraint && currentOutcome !== outcomeConstraint) {
        continue;
      }

      if (totalGoalsConstraint) {
        const total = home + away;
        if (totalGoalsConstraint.direction === "over" && !(total > totalGoalsConstraint.line)) {
          continue;
        }
        if (totalGoalsConstraint.direction === "under" && !(total < totalGoalsConstraint.line)) {
          continue;
        }
      }

      const probability = poissonProbability(homeXg, home) * poissonProbability(awayXg, away);
      candidates.push({
        scoreline: formatScoreline(home, away),
        combinedScore: probability,
        modelProbability: probability,
        marketProbability: 0,
        source: "model_only"
      });
    }
  }

  return candidates.sort((left, right) => right.combinedScore - left.combinedScore);
}

function marketExactScoreline(
  options: MarketOption[],
  oddsTypes: string[],
  homeXg: number,
  awayXg: number,
  outcomeConstraint: "home" | "draw" | "away" | null,
  totalGoalsConstraint?: { direction: "over" | "under"; line: number },
  minGoalsConstraint?: { home: number; away: number }
): string | null {
  const relevant = options
    .filter((option) => oddsTypes.includes(option.oddsType.toUpperCase()))
    .map((option) => {
      const score = parseExactScoreSelection(option.selectionName);
      return score ? { option, score } : null;
    })
    .filter((candidate): candidate is { option: MarketOption; score: { home: number; away: number } } => Boolean(candidate));

  if (relevant.length === 0) {
    return null;
  }

  const normalizedMarketWeight = relevant.reduce((sum, candidate) => sum + impliedProbability(candidate.option.currentOdds), 0);
  const candidates = relevant
    .map((candidate) => {
      const { home, away } = candidate.score;
      const outcome = home > away ? "home" : home < away ? "away" : "draw";
      const total = home + away;

      if (outcomeConstraint && outcome !== outcomeConstraint) {
        return null;
      }

      if (totalGoalsConstraint) {
        if (totalGoalsConstraint.direction === "over" && !(total > totalGoalsConstraint.line)) {
          return null;
        }
        if (totalGoalsConstraint.direction === "under" && !(total < totalGoalsConstraint.line)) {
          return null;
        }
      }

      if (minGoalsConstraint && (home < minGoalsConstraint.home || away < minGoalsConstraint.away)) {
        return null;
      }

      const modelProbability = poissonProbability(homeXg, home) * poissonProbability(awayXg, away);
      const marketProbability = impliedProbability(candidate.option.currentOdds) / Math.max(normalizedMarketWeight, 0.000001);
      const combinedScore = modelProbability * 0.72 + marketProbability * 0.28;
      return {
        scoreline: formatScoreline(home, away),
        combinedScore,
        modelProbability,
        marketProbability,
        source: "market_blended" as const
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => (right?.combinedScore ?? 0) - (left?.combinedScore ?? 0));

  return candidates[0]?.scoreline ?? null;
}

function rankedScoreCandidates(
  options: MarketOption[],
  oddsTypes: string[],
  homeXg: number,
  awayXg: number,
  outcomeConstraint: "home" | "draw" | "away" | null,
  totalGoalsConstraint?: { direction: "over" | "under"; line: number },
  minGoalsConstraint?: { home: number; away: number }
): ScorelineCandidate[] {
  const relevant = options
    .filter((option) => oddsTypes.includes(option.oddsType.toUpperCase()))
    .map((option) => {
      const score = parseExactScoreSelection(option.selectionName);
      return score ? { option, score } : null;
    })
    .filter((candidate): candidate is { option: MarketOption; score: { home: number; away: number } } => Boolean(candidate));

  if (relevant.length > 0) {
    const normalizedMarketWeight = relevant.reduce((sum, candidate) => sum + impliedProbability(candidate.option.currentOdds), 0);
    const marketCandidates = relevant
      .map((candidate) => {
        const { home, away } = candidate.score;
        const outcome = home > away ? "home" : home < away ? "away" : "draw";
        const total = home + away;

        if (outcomeConstraint && outcome !== outcomeConstraint) {
          return null;
        }
        if (totalGoalsConstraint) {
          if (totalGoalsConstraint.direction === "over" && !(total > totalGoalsConstraint.line)) {
            return null;
          }
          if (totalGoalsConstraint.direction === "under" && !(total < totalGoalsConstraint.line)) {
            return null;
          }
        }
        if (minGoalsConstraint && (home < minGoalsConstraint.home || away < minGoalsConstraint.away)) {
          return null;
        }

        const modelProbability = poissonProbability(homeXg, home) * poissonProbability(awayXg, away);
        const marketProbability = impliedProbability(candidate.option.currentOdds) / Math.max(normalizedMarketWeight, 0.000001);
        return {
          scoreline: formatScoreline(home, away),
          combinedScore: modelProbability * 0.72 + marketProbability * 0.28,
          modelProbability,
          marketProbability,
          source: "market_blended" as const
        };
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
      .sort((left, right) => (right?.combinedScore ?? 0) - (left?.combinedScore ?? 0));

    if (marketCandidates.length > 0) {
      return marketCandidates;
    }
  }

  return rankedModelScoreCandidates(homeXg, awayXg, outcomeConstraint, totalGoalsConstraint, minGoalsConstraint);
}

function correctScoreConfidenceLabel(candidates: ScorelineCandidate[]): string {
  const top = candidates[0];
  if (!top) {
    return "模型弱信號";
  }

  const second = candidates[1];
  const gapRatio = second ? top.combinedScore / Math.max(second.combinedScore, 0.000001) : 2;

  if (top.source === "market_blended") {
    if (top.marketProbability >= 0.2 && gapRatio >= 1.18) {
      return "市場強信號";
    }
    if (top.marketProbability >= 0.12 && gapRatio >= 1.08) {
      return "市場中信號";
    }
    return "市場弱信號";
  }

  if (top.modelProbability >= 0.08 && gapRatio >= 1.15) {
    return "模型強信號";
  }
  if (top.modelProbability >= 0.05) {
    return "模型中信號";
  }
  return "模型弱信號";
}

function enforceCumulativeScoreline(
  halfTimeScoreline: string,
  fullTimeScoreline: string,
  homeXg: number,
  awayXg: number,
  outcomeConstraint: "home" | "draw" | "away" | null,
  totalGoalsConstraint?: { direction: "over" | "under"; line: number },
  marketOptions: MarketOption[] = []
): string {
  const half = parseScoreline(halfTimeScoreline);
  const full = parseScoreline(fullTimeScoreline);

  if (full.home >= half.home && full.away >= half.away) {
    return fullTimeScoreline;
  }

  const exactScoreCandidate = marketExactScoreline(
    marketOptions,
    ["CRS"],
    homeXg,
    awayXg,
    outcomeConstraint,
    totalGoalsConstraint,
    { home: half.home, away: half.away }
  );
  if (exactScoreCandidate) {
    return exactScoreCandidate;
  }

  const constrained = mostLikelyScoreline(homeXg, awayXg, outcomeConstraint, totalGoalsConstraint, {
    home: half.home,
    away: half.away
  });
  const parsedConstrained = parseScoreline(constrained);

  if (parsedConstrained.home >= half.home && parsedConstrained.away >= half.away) {
    return constrained;
  }

  const fallbackHome = Math.max(full.home, half.home);
  const fallbackAway = Math.max(full.away, half.away);
  return `${Math.min(5, fallbackHome)}-${Math.min(5, fallbackAway)}`;
}

function alignScorelineWithOutcome(scoreline: string, outcome: "home" | "draw" | "away"): string {
  const parsed = parseScoreline(scoreline);
  if (outcome === scorelineOutcome(scoreline)) {
    return scoreline;
  }

  if (outcome === "draw") {
    const tied = Math.max(0, Math.min(5, Math.round((parsed.home + parsed.away) / 2)));
    return `${tied}-${tied}`;
  }

  const gap = Math.max(1, Math.abs(parsed.home - parsed.away));
  const total = parsed.home + parsed.away;
  const home = outcome === "home"
    ? Math.max(parsed.away + gap, Math.ceil(total / 2))
    : Math.floor((total - gap) / 2);
  const away = outcome === "away"
    ? Math.max(parsed.home + gap, Math.ceil(total / 2))
    : Math.floor((total - gap) / 2);

  if (outcome === "home") {
    return `${Math.min(5, Math.max(1, home))}-${Math.max(0, Math.min(4, away))}`;
  }

  return `${Math.max(0, Math.min(4, home))}-${Math.min(5, Math.max(1, away))}`;
}

function hongKongDateKeyFromIso(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return undefined;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(ms));

  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function recentHeadToHeadSignal(fixture: Fixture): number {
  const matches = fixture.recentHeadToHead ?? [];
  if (matches.length === 0) {
    return 0;
  }

  const recent = matches.slice(-3);
  const total = recent.reduce((acc, match) => {
    const resultBias = match.result === "home" ? 0.045 : match.result === "away" ? -0.045 : 0;
    const venueBias = match.venue === "home" ? 0.01 : match.venue === "away" ? -0.01 : 0;
    const goalGapBias = Math.max(-0.04, Math.min(0.04, (match.homeGoals - match.awayGoals) / 5));
    return acc + resultBias + venueBias + goalGapBias;
  }, 0);

  return Math.max(-0.12, Math.min(0.12, total / Math.max(recent.length, 1)));
}

function venueFormSignal(fixture: Fixture): number {
  const homeVenueForm = fixture.homeVenueForm ?? 0;
  const awayVenueForm = fixture.awayVenueForm ?? 0;
  return (homeVenueForm - awayVenueForm) * 0.35;
}

function marketPhaseSignal(option: MarketOption, baseConfidence: number): number {
  const halfTimeMarket = [
    "EHL",
    "EDC",
    "EHH",
    "EHA",
    "ECS",
    "ECH",
    "ECD",
    "FHH",
    "FHA",
    "FHC",
    "FHL",
    "FLH",
    "FLA",
    "ELH",
    "ELA"
  ].includes(option.oddsType);

  if (!halfTimeMarket) {
    return 0;
  }

  return baseConfidence >= 0 ? 0.2 : -0.06;
}

function optionQualityBoost(option: MarketOption): number {
  const activePool = option.poolStatus.toLowerCase().includes("sell") ? 0.02 : 0;
  const activeSelection = option.combinationStatus.toLowerCase().includes("sell") ? 0.015 : 0;
  const nonInplay = option.inplay ? -0.01 : 0.01;
  return activePool + activeSelection + nonInplay;
}

function marketFamily(option: MarketOption): "fulltime" | "halftime" | "corners" | "goals" | "other" {
  const oddsType = option.oddsType.toUpperCase();
  const name = `${option.oddsTypeName} ${option.selectionName}`.toLowerCase();
  if (oddsType.startsWith("E") || oddsType.startsWith("F")) {
    return "halftime";
  }
  if (["CHL", "CHH", "CHA", "CFA", "CFH", "CEA", "CEH", "ECH", "ECD", "CHD"].includes(oddsType)) {
    return "corners";
  }
  if (["HIL", "EHL", "HLH", "HLA", "FLH", "FLA", "ELH", "ELA", "TTG", "ETG", "OOE"].includes(oddsType) || name.includes("大細") || name.includes("總入球") || name.includes("單雙")) {
    return "goals";
  }
  return "fulltime";
}

function marketName(option: MarketOption): string {
  const teamContext = TEAM_MARKET_CONTEXT[option.oddsType];
  if (teamContext) {
    const teamLabel = teamContext.side === "home" ? "主隊" : "客隊";
    return `${teamLabel}${teamContext.period}${teamContext.metric}大細`;
  }

  const providerName = option.oddsTypeName.trim();
  if (providerName && providerName !== option.oddsType) {
    return providerName;
  }

  return ODDS_TYPE_NAME_MAP[option.oddsType] ?? "未分類玩法";
}

function lineUnit(oddsType: string): string {
  if (["HIL", "EHL", "HLH", "HLA", "FLH", "FLA", "ELH", "ELA", "CHH", "CHA", "FHH", "FHA"].includes(oddsType)) {
    return "球";
  }
  if (["CHL", "ECH", "FCH", "CFA", "CFH", "CEA", "CEH"].includes(oddsType)) {
    return "角球";
  }
  return "";
}

function isGoalsStyleMarket(option: MarketOption): boolean {
  const oddsType = option.oddsType.toUpperCase();
  const marketText = `${option.oddsTypeName} ${option.selectionName}`.toLowerCase();

  return (
    ["EHH", "EHL", "ELH", "ELA", "FHL", "FLH", "FLA", "HIL", "HLH", "HLA", "TTG", "ETG", "OOE"].includes(oddsType) ||
    marketText.includes("半場入球大細") ||
    marketText.includes("入球大細") ||
    marketText.includes("總入球") ||
    marketText.includes("單雙")
  );
}

function liveScoreFloor(fixture: Fixture): { home: number; away: number } | undefined {
  const scores = [fixture.finalScore, fixture.halfTimeScore].filter(
    (score): score is { home: number; away: number } => Boolean(score)
  );
  if (scores.length === 0) {
    return undefined;
  }

  return {
    home: Math.max(...scores.map((score) => score.home)),
    away: Math.max(...scores.map((score) => score.away))
  };
}

function isHalfTimeMarket(option: MarketOption): boolean {
  return marketFamily(option) === "halftime";
}

function isPastHalfTime(status: string | undefined): boolean {
  const normalized = String(status ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  return /firsthalfcompleted|firsthalfended|secondhalf|2ndhalf|halftime|下半場|中場休息|半場完/.test(normalized);
}

function isLiveFixture(fixture: Fixture): boolean {
  return /live|inplay|playing|running|active|firsthalf|secondhalf|halftime|進行|上半場|下半場|半場/i.test(
    String(fixture.status ?? "")
  );
}

type LivePhase = {
  label: string;
  modelElapsedMinute: number;
  liveWeight: number;
};

function livePhase(fixture: Fixture): LivePhase | null {
  const status = String(fixture.status ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  const officialMinute = fixture.liveMinute;
  const source = fixture.liveMinuteSource ?? "外部資料庫";
  if (Number.isInteger(officialMinute) && officialMinute! >= 1 && officialMinute! <= 130 && isLiveFixture(fixture)) {
    return {
      label: `比賽第 ${officialMinute}'（${source}）`,
      modelElapsedMinute: officialMinute!,
      liveWeight: clamp(0.45 + (officialMinute! / 95) * 0.5, 0.45, 0.95)
    };
  }
  if (/secondhalf|2ndhalf|下半場/.test(status)) {
    return { label: "下半場進行中", modelElapsedMinute: 70, liveWeight: 0.88 };
  }
  if (/halftime|中場休息|半場完/.test(status)) {
    return { label: "中場休息", modelElapsedMinute: 45, liveWeight: 0.82 };
  }
  if (/firsthalf|1sthalf|上半場/.test(status)) {
    return { label: "上半場進行中", modelElapsedMinute: 25, liveWeight: 0.68 };
  }
  if (isLiveFixture(fixture)) {
    return { label: "比賽進行中", modelElapsedMinute: 50, liveWeight: 0.75 };
  }
  return null;
}

function liveMarketMetricValue(fixture: Fixture, option: MarketOption): number | null {
  const oddsType = option.oddsType.toUpperCase();
  const teamContext = TEAM_MARKET_CONTEXT[oddsType];

  if (teamContext?.metric === "角球") {
    const corners = fixture.finalCorners;
    return corners ? corners[teamContext.side] : null;
  }

  if (teamContext?.metric === "入球") {
    const score = liveScoreFloor(fixture);
    return score ? score[teamContext.side] : null;
  }

  if (marketFamily(option) === "corners") {
    return fixture.finalCorners?.total ?? null;
  }

  if (isGoalsStyleMarket(option)) {
    const score = liveScoreFloor(fixture);
    return score ? score.home + score.away : null;
  }

  return null;
}

function isLiveMarketOptionEligible(fixture: Fixture, option: MarketOption): boolean {
  if (isHalfTimeMarket(option) && isPastHalfTime(fixture.status)) {
    return false;
  }

  const line = parseLineConditionValue(option.lineCondition);
  const direction = detectOverUnderDirection(option.selectionName);
  const currentValue = liveMarketMetricValue(fixture, option);
  if (currentValue === null || line === null || !direction) {
    return true;
  }

  return direction === "under" ? currentValue < line : currentValue <= line;
}

function parseSignedLineCondition(raw: string): number | null {
  const values = raw.match(/[+-]?\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) ?? [];
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

const SELECTED_SIDE_HANDICAP_ODDS_TYPES = new Set(["HDC", "EDC", "FHH", "CHD", "ECD"]);

function selectedSideHandicapLine(option: MarketOption): number | null {
  const line = parseSignedLineCondition(option.lineCondition);
  if (line === null || !SELECTED_SIDE_HANDICAP_ODDS_TYPES.has(option.oddsType.toUpperCase())) {
    return line;
  }

  return detectWinDrawLoseDirection(option.selectionName) === "away" ? -line : line;
}

function selectedSideHandicapCondition(option: MarketOption): string {
  if (
    !SELECTED_SIDE_HANDICAP_ODDS_TYPES.has(option.oddsType.toUpperCase())
    || detectWinDrawLoseDirection(option.selectionName) !== "away"
  ) {
    return option.lineCondition;
  }

  return option.lineCondition.replace(/[+-]?\d+(?:\.\d+)?/g, (rawValue) => {
    const value = -Number(rawValue);
    if (Object.is(value, -0) || value === 0) {
      return Number(rawValue).toFixed(rawValue.includes(".") ? rawValue.split(".")[1].length : 0);
    }
    const decimals = rawValue.includes(".") ? rawValue.split(".")[1].length : 0;
    return `${value > 0 ? "+" : ""}${value.toFixed(decimals)}`;
  });
}

type LiveOptionAssessment = {
  probability: number;
  note: string;
};

function remainingOutcomeProbability(
  fixture: Fixture,
  option: MarketOption,
  phase: LivePhase,
  baseConfidence: number
): LiveOptionAssessment | null {
  const score = liveScoreFloor(fixture);
  const direction = detectWinDrawLoseDirection(option.selectionName);
  if (!score || !direction) {
    return null;
  }

  const remainingFraction = clamp((95 - phase.modelElapsedMinute) / 95, 0, 1);
  const remainingGoals = 2.65 * remainingFraction;
  const homeShare = clamp(0.5 + baseConfidence * 0.55, 0.2, 0.8);
  const homeLambda = remainingGoals * homeShare;
  const awayLambda = remainingGoals * (1 - homeShare);
  const handicap = selectedSideHandicapLine(option) ?? 0;
  const isHandicap = ["HDC", "HHA", "FHH", "EHA", "EDC"].includes(option.oddsType.toUpperCase());
  let probability = 0;

  for (let homeAdded = 0; homeAdded <= 6; homeAdded += 1) {
    for (let awayAdded = 0; awayAdded <= 6; awayAdded += 1) {
      const eventProbability = poissonProbability(homeLambda, homeAdded) * poissonProbability(awayLambda, awayAdded);
      const homeFinal = score.home + homeAdded;
      const awayFinal = score.away + awayAdded;
      const margin = direction === "away" ? awayFinal - homeFinal : homeFinal - awayFinal;
      const selected = direction === "draw"
        ? homeFinal === awayFinal
        : isHandicap
          ? margin + handicap > 0
          : direction === "home"
            ? homeFinal > awayFinal
            : awayFinal > homeFinal;
      if (selected) {
        probability += eventProbability;
      }
    }
  }

  const lineText = isHandicap && handicap !== 0 ? `，讓球 ${handicap > 0 ? "+" : ""}${handicap}` : "";
  return {
    probability: clamp(probability, 0.001, 0.999),
    note: `${phase.label}${fixture.liveMinute ? "" : "（HKJC 及外部資料庫未提供官方分鐘）"}，比分 ${score.home}:${score.away}${lineText}，按該階段剩餘時間區間的入球分布重估為 ${(probability * 100).toFixed(1)}%`
  };
}

function remainingCornerHandicapProbability(
  fixture: Fixture,
  option: MarketOption,
  phase: LivePhase,
  baseConfidence: number
): LiveOptionAssessment | null {
  const oddsType = option.oddsType.toUpperCase();
  if (!["CHD", "ECD"].includes(oddsType) || !fixture.finalCorners) {
    return null;
  }

  const direction = detectWinDrawLoseDirection(option.selectionName);
  const handicap = selectedSideHandicapLine(option);
  if (!direction || direction === "draw" || handicap === null || !Number.isInteger(fixture.liveMinute)) {
    return null;
  }

  const corners = fixture.finalCorners;
  const periodEnd = oddsType === "ECD" ? 45 : 95;
  const remainingMinutes = Math.max(0, periodEnd - phase.modelElapsedMinute);
  const observedRate = corners.total / Math.max(phase.modelElapsedMinute, 1);
  const observedWeight = clamp(phase.modelElapsedMinute / 60, 0.25, 0.7);
  const remainingCorners = (observedRate * observedWeight + (10 / 95) * (1 - observedWeight)) * remainingMinutes;
  const observedHomeShare = (corners.home + 1) / (corners.total + 2);
  const modelHomeShare = clamp(0.5 + baseConfidence * 0.3, 0.25, 0.75);
  const attackingHomeShare = liveAttackingHomeShare(fixture);
  const homeShare = clamp(
    attackingHomeShare === null
      ? observedHomeShare * 0.6 + modelHomeShare * 0.4
      : observedHomeShare * 0.5 + modelHomeShare * 0.25 + attackingHomeShare * 0.25,
    0.15,
    0.85
  );
  const homeLambda = remainingCorners * homeShare;
  const awayLambda = remainingCorners * (1 - homeShare);
  let probability = 0;

  for (let homeAdded = 0; homeAdded <= 15; homeAdded += 1) {
    for (let awayAdded = 0; awayAdded <= 15; awayAdded += 1) {
      const eventProbability = poissonProbability(homeLambda, homeAdded) * poissonProbability(awayLambda, awayAdded);
      const homeFinal = corners.home + homeAdded;
      const awayFinal = corners.away + awayAdded;
      const selectedMargin = direction === "home" ? homeFinal - awayFinal : awayFinal - homeFinal;
      if (selectedMargin + handicap > 0) {
        probability += eventProbability;
      }
    }
  }

  return {
    probability: clamp(probability, 0.001, 0.999),
    note: `${phase.label}${fixture.liveMinute ? "" : "（HKJC 及外部資料庫未提供官方分鐘）"}，目前角球 ${corners.home}:${corners.away}${attackingHomeShare !== null ? `，${fixture.liveAttackingMetrics?.source ?? fixture.livePressureMetrics?.source} 即時壓力份額 ${Math.round(attackingHomeShare * 100)}:${Math.round((1 - attackingHomeShare) * 100)}` : ""}，${direction === "home" ? "主隊" : "客隊"}角球讓球 ${handicap > 0 ? "+" : ""}${handicap}，按剩餘時間角球分布重估為 ${(probability * 100).toFixed(1)}%`
  };
}

function liveOverUnderProbability(
  fixture: Fixture,
  option: MarketOption,
  phase: LivePhase
): LiveOptionAssessment | null {
  const currentValue = liveMarketMetricValue(fixture, option);
  const direction = detectOverUnderDirection(option.selectionName);
  const line = parseLineConditionValue(option.lineCondition);
  if (currentValue === null || !direction || line === null) {
    return null;
  }

  const teamContext = TEAM_MARKET_CONTEXT[option.oddsType.toUpperCase()];
  const isCorners = teamContext?.metric === "角球" || marketFamily(option) === "corners";
  if (isCorners && !Number.isInteger(fixture.liveMinute)) {
    return null;
  }
  const periodEnd = teamContext?.period === "半場" || isHalfTimeMarket(option) ? 45 : 95;
  const remainingMinutes = Math.max(0, periodEnd - phase.modelElapsedMinute);
  const historicalExpectation = isCorners ? historicalCornerExpectation(fixture, option) : null;
  const rawBaselineRate = isCorners
    ? historicalExpectation !== null ? historicalExpectation / periodEnd : teamContext ? 5 / 95 : 10 / 95
    : teamContext ? 1.3 / 95 : 2.6 / 95;
  const attackingHomeShare = isCorners ? liveAttackingHomeShare(fixture) : null;
  const selectedAttackingShare = attackingHomeShare !== null && teamContext?.metric === "角球"
    ? teamContext.side === "home" ? attackingHomeShare : 1 - attackingHomeShare
    : null;
  const attackingRateAdjustment = selectedAttackingShare === null
    ? 0
    : clamp((selectedAttackingShare - 0.5) * 0.3, -0.08, 0.08);
  const baselineRate = rawBaselineRate * (1 + attackingRateAdjustment);
  const observedRate = currentValue / Math.max(phase.modelElapsedMinute, 1);
  const strengthGap = strengthMap[fixture.homeStrength] - strengthMap[fixture.awayStrength];
  const scoreGap = (fixture.finalScore?.home ?? 0) - (fixture.finalScore?.away ?? 0);
  const strongerTeamTrailing = (strengthGap > 0.12 && scoreGap < 0) || (strengthGap < -0.12 && scoreGap > 0);
  const strongerTeamLeadingByTwo = (strengthGap > 0.12 && scoreGap >= 2) || (strengthGap < -0.12 && scoreGap <= -2);
  const gameStateAdjustment = isCorners && phase.modelElapsedMinute >= 45
    ? strongerTeamTrailing ? 0.12 : strongerTeamLeadingByTwo ? -0.1 : scoreGap !== 0 ? 0.04 : 0
    : 0;
  const bayesianUpdate = isCorners
    ? gammaPoissonLiveUpdate({
        baselineFullPeriodMean: baselineRate * periodEnd,
        elapsedMinutes: phase.modelElapsedMinute,
        observedCount: currentValue,
        remainingMinutes,
        periodMinutes: periodEnd
      })
    : null;
  const remainingLambda = bayesianUpdate
    ? bayesianUpdate.expectedRemaining * (1 + gameStateAdjustment)
    : (observedRate * 0.6 + baselineRate * 0.4) * remainingMinutes;
  const projectedValue = currentValue + remainingLambda;
  const probability = isCorners
    ? countOverUnderProbability({
        expectedAdditional: remainingLambda,
        currentCount: currentValue,
        line,
        direction,
        dispersion: bayesianUpdate?.dispersion
      })
    : (() => {
        const uncertainty = Math.max(0.35, Math.sqrt(Math.max(remainingLambda, 0.1)) * 0.7);
        const overProbability = 1 / (1 + Math.exp(-(projectedValue - line) / uncertainty));
        return direction === "over" ? overProbability : 1 - overProbability;
      })();
  const metricLabel = isCorners
    ? `${teamContext?.side === "home" ? "主隊" : teamContext?.side === "away" ? "客隊" : "全場"}角球`
    : `${teamContext?.side === "home" ? "主隊" : teamContext?.side === "away" ? "客隊" : "全場"}入球`;

  return {
    probability: clamp(probability, 0.001, 0.999),
    note: `${phase.label}${fixture.liveMinute ? "" : "（HKJC 及外部資料庫未提供官方分鐘）"}，${metricLabel} ${currentValue}，${fixture.liveMinute ? `按${fixture.liveMinuteSource ?? "外部資料庫"}提供分鐘計算` : "按階段估算"}${isCorners ? "角球" : "入球"}速度 ${observedRate.toFixed(2)}/分鐘及剩餘時間區間推算 ${projectedValue.toFixed(1)}${selectedAttackingShare !== null ? `，${fixture.liveAttackingMetrics?.source ?? fixture.livePressureMetrics?.source} 即時壓力份額調整 ${attackingRateAdjustment >= 0 ? "+" : ""}${(attackingRateAdjustment * 100).toFixed(1)}%` : ""}${isCorners ? `，比賽狀態調整 ${gameStateAdjustment >= 0 ? "+" : ""}${(gameStateAdjustment * 100).toFixed(0)}%，Gamma–Poisson 貝葉斯更新／負二項預測` : ""} ${direction === "over" ? "大" : "細"} ${line} 後驗機率 ${(probability * 100).toFixed(1)}%`
  };
}

function assessLiveOption(fixture: Fixture, option: MarketOption, baseConfidence: number): LiveOptionAssessment | null {
  const phase = livePhase(fixture);
  if (!phase) {
    return null;
  }

  return liveOverUnderProbability(fixture, option, phase)
    ?? remainingCornerHandicapProbability(fixture, option, phase, baseConfidence)
    ?? remainingOutcomeProbability(fixture, option, phase, baseConfidence);
}

function selectionDisplayName(option: MarketOption): string {
  const baseName = option.selectionName.trim() || option.selectionCode.trim() || "選項";
  const rawCondition = selectedSideHandicapCondition(option).trim();
  const normalizedCondition = rawCondition.replace(/^\[/, "").replace(/\]$/, "").trim();
  const teamContext = TEAM_MARKET_CONTEXT[option.oddsType];
  const contextPrefix = teamContext
    ? `${teamContext.side === "home" ? "主隊" : "客隊"} ${teamContext.period}`
    : "";

  if (teamContext) {
    const code = option.selectionCode.trim().toUpperCase();
    const direction = detectOverUnderDirection(option.selectionName)
      ?? (/^(H|O|OVER)$/.test(code) ? "over" : /^(L|U|UNDER)$/.test(code) ? "under" : null);
    if (direction && normalizedCondition) {
      const line = normalizedCondition.replaceAll("-", "");
      const unit = teamContext.metric === "角球" ? "角球" : "";
      return `${contextPrefix}${direction === "over" ? "大" : "細"}（${line}${unit}）`;
    }
  }

  if (isGoalsStyleMarket(option)) {
    if (!normalizedCondition || ["n/a", "na", "0", "0.0"].includes(normalizedCondition.toLowerCase())) {
      return contextPrefix ? `${contextPrefix}${baseName}` : baseName;
    }

    if (["大", "細", "單", "雙"].includes(baseName)) {
      return contextPrefix ? `${contextPrefix}${baseName}（${normalizedCondition}）` : `${baseName}（${normalizedCondition}）`;
    }

    return contextPrefix ? `${contextPrefix}${baseName}` : baseName;
  }

  if (!normalizedCondition || ["n/a", "na", "0", "0.0"].includes(normalizedCondition.toLowerCase())) {
    return contextPrefix ? `${contextPrefix}${baseName}` : baseName;
  }

  const unit = lineUnit(option.oddsType);
  const lineText = unit ? `${normalizedCondition}${unit}` : normalizedCondition;

  if (baseName === "大" || baseName === "細") {
    return contextPrefix ? `${contextPrefix}${baseName}（${lineText}）` : `${baseName}（${lineText}）`;
  }

  if (["HHA", "EHA"].includes(option.oddsType.toUpperCase())) {
    return `${baseName}（主隊盤口 ${lineText}）`;
  }

  return contextPrefix ? `${contextPrefix}${baseName}（盤口 ${lineText}）` : `${baseName}（盤口 ${lineText}）`;
}

function scoreOption(
  baseConfidence: number,
  option: MarketOption,
  marketType: "fulltime" | "halftime" | "corners" | "goals" | "other",
  fixture: Fixture,
  expectedGoals: { home: number; away: number }
): { modelProbability: number; edge: number; valueScore: number; liveAssessment: LiveOptionAssessment | null } {
  const pImplied = impliedProbability(option.currentOdds);
  const confidenceSignal = Math.max(-0.18, Math.min(0.24, baseConfidence * 0.22));
  const marketPressureBonus = option.currentOdds >= 2.0 ? 0.01 : 0;
  const phaseSignal = marketPhaseSignal(option, baseConfidence);
  const marketTypeBias = marketType === "halftime" ? 0.01 : marketType === "corners" ? 0.008 : marketType === "goals" ? 0.012 : 0;
  let preMatchProbability = Math.min(
    0.95,
    Math.max(0.02, pImplied + confidenceSignal + marketPressureBonus + phaseSignal + marketTypeBias + optionQualityBoost(option))
  );
  if (option.oddsType.toUpperCase() === "HAD") {
    const direction = detectWinDrawLoseDirection(option.selectionName);
    const outcomeProbabilities = poissonOutcomeProbabilities(expectedGoals.home, expectedGoals.away);
    const overround = fixture.marketOptions
      .filter((candidate) => candidate.oddsType.toUpperCase() === "HAD")
      .reduce((total, candidate) => total + impliedProbability(candidate.currentOdds), 0);
    if (direction && overround > 0) {
      const marketProbability = pImplied / overround;
      preMatchProbability = clamp(
        outcomeProbabilities[direction] * 0.65 + marketProbability * 0.35,
        0.02,
        0.95
      );
    }
  }
  if (marketType === "corners") {
    const direction = detectOverUnderDirection(option.selectionName);
    const line = parseLineConditionValue(option.lineCondition);
    const expectedCorners = historicalCornerExpectation(fixture, option);
    if (direction && line !== null && expectedCorners !== null) {
      const calibratedDispersion = leagueCornerDispersion(fixture.league);
      const poissonProbabilityForSelection = countOverUnderProbability({
        expectedAdditional: expectedCorners,
        currentCount: 0,
        line,
        direction,
        dispersion: calibratedDispersion?.dispersion
      });
      preMatchProbability = clamp(
        poissonProbabilityForSelection * 0.65 + preMatchProbability * 0.35,
        0.02,
        0.95
      );
    }
  }
  const liveAssessment = assessLiveOption(fixture, option, baseConfidence);
  const phase = livePhase(fixture);
  const liveWeight = liveAssessment && phase ? phase.liveWeight : 0;
  const pModel = liveAssessment
    ? clamp(preMatchProbability * (1 - liveWeight) + liveAssessment.probability * liveWeight, 0.01, 0.99)
    : phase
      ? clamp(preMatchProbability * 0.55, 0.01, 0.99)
      : preMatchProbability;
  const edge = pModel - pImplied;
  const valueScore = edge * option.currentOdds;
  return { modelProbability: pModel, edge, valueScore, liveAssessment };
}

export function buildReason(fixture: Fixture, option: MarketOption, confidence: number, marketType: "fulltime" | "halftime" | "corners" | "goals" | "other", liveAssessment?: LiveOptionAssessment | null) {
  const strengths: string[] = [];
  const risks: string[] = [];
  const watchpoints: string[] = [];
  const h2h = recentHeadToHeadSignal(fixture);
  const venue = venueFormSignal(fixture);
  const formCurve = recentFormCurve(fixture);
  const lineup = lineupScore(fixture);
  const formGap = fixture.homeRecentPoints - fixture.awayRecentPoints;
  const implied = impliedProbability(option.currentOdds) * 100;
  const teamContext = TEAM_MARKET_CONTEXT[option.oddsType.toUpperCase()];
  const outcomeDirection = detectWinDrawLoseDirection(option.selectionName);
  const sideLabel = teamContext
    ? teamContext.side === "home" ? "主隊" : "客隊"
    : outcomeDirection === "home" ? "主隊" : outcomeDirection === "away" ? "客隊" : outcomeDirection === "draw" ? "和局" : null;
  const selectedLineCondition = selectedSideHandicapCondition(option);
  const lineLabel = selectedLineCondition && selectedLineCondition !== "N/A" ? `（盤口 ${selectedLineCondition}）` : "";
  const marketLabel = marketType === "halftime" ? "半場市場" : marketType === "corners" ? "角球市場" : marketType === "goals" ? "大細市場" : "全場市場";

  if (marketType === "corners") {
    const modelProbability = clamp(confidence / 100, 0.001, 0.999);
    const fairOdds = 1 / modelProbability;
    const expectedValue = modelProbability * option.currentOdds - 1;
    const valueNote = `模型機率 ${(modelProbability * 100).toFixed(1)}%，公平賠率 ${fairOdds.toFixed(2)}，市場賠率 ${option.currentOdds.toFixed(2)}，EV ${expectedValue >= 0 ? "+" : ""}${(expectedValue * 100).toFixed(1)}%`;
    if (expectedValue > 0) strengths.push(valueNote);
    else risks.push(valueNote);

    const calibratedDispersion = leagueCornerDispersion(fixture.league);
    if (calibratedDispersion) {
      strengths.push(`負二項過度離散參數 ${calibratedDispersion.dispersion.toFixed(4)}（${calibratedDispersion.matches} 場歷史樣本）`);
    } else {
      risks.push("此聯賽未有足夠角球 dispersion calibration，賽前分布回退 Poisson");
    }
  }

  if (liveAssessment) {
    if (liveAssessment.probability >= 0.55) {
      strengths.push(liveAssessment.note);
    } else {
      risks.push(liveAssessment.note);
    }
  } else if (marketType === "corners" && isLiveFixture(fixture) && !Number.isInteger(fixture.liveMinute)) {
    const phase = livePhase(fixture);
    risks.push(`${phase?.label ?? "比賽進行中"}（HKJC 及外部資料庫未提供官方分鐘），未採用角球速度及剩餘時間推算`);
  }

  if (h2h > 0.01) {
    strengths.push(`近期對賽有利（H2H 指標 +${(h2h * 100).toFixed(1)}%），主隊對位優勢較明顯`);
  } else if (h2h < -0.01) {
    risks.push(`近期對賽偏弱（H2H 指標 ${(h2h * 100).toFixed(1)}%），需防對手對位壓制`);
  }

  if (venue > 0.01) {
    strengths.push(`主場形勢較佳（主客場差值 +${(venue * 100).toFixed(1)}%），場地因素偏向主隊`);
  } else if (venue < -0.01) {
    risks.push(`客場抗性較強（主客場差值 ${(venue * 100).toFixed(1)}%），主隊壓力偏高`);
  }

  if (Math.abs(formCurve) > 0.1 && sideLabel && (!liveAssessment || liveAssessment.probability >= 0.45)) {
    strengths.push(`最近 5 場 form 差距 ${formGap >= 0 ? "+" : ""}${formGap.toFixed(1)} 分，走勢支持 ${sideLabel}方向`);
  }

  if (lineup > 0.03) {
    strengths.push(`陣容/體能指標偏正（+${(lineup * 100).toFixed(1)}%），有利執行 ${option.selectionName}${lineLabel}`);
  } else if (lineup < -0.01) {
    risks.push(`陣容/體能指標偏弱（${(lineup * 100).toFixed(1)}%），需防節奏被對手帶走`);
  }

  if (confidence >= 70) {
    strengths.push(`模型信心 ${confidence.toFixed(1)}%（隱含機率 ${implied.toFixed(1)}%），屬高位訊號`);
  } else if (confidence >= 60) {
    strengths.push(`模型信心 ${confidence.toFixed(1)}%，屬中高位，可列為觀察主軸`);
  } else {
    risks.push(`模型信心僅 ${confidence.toFixed(1)}%，建議降低注碼或等待臨場確認`);
  }

  if (!fixture.lineup.confirmed) {
    watchpoints.push("陣容若再有變動，建議重評後再決定是否跟進");
  }

  if (option.currentOdds >= 3.0) {
    watchpoints.push(`當前賠率 ${option.currentOdds.toFixed(2)} 偏高，需確認波動是否仍匹配回報`);
  } else {
    watchpoints.push(`留意 ${option.selectionName}${lineLabel} 的即時賠率變動（現價 ${option.currentOdds.toFixed(2)}）`);
  }

  if (marketType === "halftime") {
    watchpoints.push("半場市場節奏波動較大，建議把握轉換點而非盲目追高");
  } else if (marketType === "corners") {
    watchpoints.push("角球市場更容易受比賽節奏與臨場狀態影響");
  } else if (marketType === "goals") {
    watchpoints.push("大細市場需留意比賽進攻節奏與控球時間");
  }

  return {
    strengths,
    risks,
    watchpoints,
    reason: `${marketLabel}：${strengths.length > 0 ? strengths.join("；") : "本場訊號較為平衡"}。${risks.length > 0 ? `風險點：${risks.join("；")}` : "風險點：尚未出現明顯反對訊號"}。${watchpoints.length > 0 ? `觀察重點：${watchpoints.join("；")}` : "觀察重點：賽事節奏與陣容變化"}`
  };
}

function fixtureScoringContext(fixture: Fixture, weightsInput?: Partial<ScoringWeights>) {
  const homeStrength = strengthMap[fixture.homeStrength];
  const awayStrength = strengthMap[fixture.awayStrength];
  const recentGap = (fixture.homeRecentPoints - fixture.awayRecentPoints) / 15;
  const lineupGap = lineupScore(fixture);
  const momentum = oddsMomentum(fixture);
  const headToHeadSignal = recentHeadToHeadSignal(fixture);
  const venueFormSignalValue = venueFormSignal(fixture);
  const formCurveValue = recentFormCurve(fixture);
  const primaryMarketFamily = fixture.marketOptions.some((option) => option.oddsType.startsWith("E") || option.oddsType.startsWith("F"))
    ? "halftime"
    : fixture.marketOptions.some((option) => ["CHL", "CHH", "CHA", "CFA", "CFH", "CEA", "CEH", "ECH", "ECD", "CHD"].includes(option.oddsType.toUpperCase()))
      ? "corners"
      : fixture.marketOptions.some((option) => ["HIL", "EHL", "HLH", "HLA", "FLH", "FLA", "ELH", "ELA", "TTG", "ETG", "OOE"].includes(option.oddsType.toUpperCase()))
        ? "goals"
        : "fulltime";
  const weights = primaryMarketFamily === "halftime"
    ? DEFAULT_HALF_TIME_WEIGHTS
    : primaryMarketFamily === "corners"
      ? DEFAULT_CORNERS_WEIGHTS
      : primaryMarketFamily === "goals"
        ? DEFAULT_GOALS_WEIGHTS
        : (weightsInput ? normalizeWeights(weightsInput) : DEFAULT_FULL_TIME_WEIGHTS);
  const baseConfidence =
    weights.strengthGap * (homeStrength - awayStrength) +
    weights.recentForm * recentGap +
    weights.lineupFitness * lineupGap +
    weights.expertSentiment * fixture.expertSentiment +
    weights.oddsMomentum * momentum +
    0.16 * headToHeadSignal +
    0.18 * venueFormSignalValue +
    0.14 * formCurveValue;
  const homeExpectedGoals = clamp(
    1.35 + baseConfidence * 0.95 + venueFormSignalValue * 0.35 + formCurveValue * 0.25 + lineupGap * 0.2,
    0.2,
    3.8
  );
  const awayExpectedGoals = clamp(
    1.2 - baseConfidence * 0.9 - venueFormSignalValue * 0.25 - formCurveValue * 0.18 - lineupGap * 0.15,
    0.15,
    3.5
  );

  return {
    baseConfidence,
    lineupGap,
    momentum,
    venueFormSignalValue,
    formCurveValue,
    homeExpectedGoals,
    awayExpectedGoals
  };
}

export function scoreFixtureHADProbabilities(
  fixture: Fixture,
  weightsInput?: Partial<ScoringWeights>
): { home: number; draw: number; away: number } {
  const { homeExpectedGoals, awayExpectedGoals } = fixtureScoringContext(fixture, weightsInput);
  const poisson = poissonOutcomeProbabilities(homeExpectedGoals, awayExpectedGoals);
  const hadOptions = fixture.marketOptions.filter((option) => option.oddsType.toUpperCase() === "HAD");
  const overround = hadOptions.reduce((total, option) => total + impliedProbability(option.currentOdds), 0);
  if (overround <= 0) {
    return poisson;
  }

  const market = { home: 0, draw: 0, away: 0 };
  for (const option of hadOptions) {
    const direction = detectWinDrawLoseDirection(option.selectionName);
    if (direction) {
      market[direction] += impliedProbability(option.currentOdds) / overround;
    }
  }
  const blended = {
    home: poisson.home * 0.65 + market.home * 0.35,
    draw: poisson.draw * 0.65 + market.draw * 0.35,
    away: poisson.away * 0.65 + market.away * 0.35
  };
  const total = blended.home + blended.draw + blended.away;
  return {
    home: blended.home / total,
    draw: blended.draw / total,
    away: blended.away / total
  };
}

export function scoreFixture(
  fixture: Fixture,
  weightsInput?: Partial<ScoringWeights>,
  thresholdsInput?: Partial<RecommendationThresholds>
): Recommendation {
  const thresholds = normalizeRecommendationThresholds(thresholdsInput);
  const {
    baseConfidence,
    momentum,
    homeExpectedGoals,
    awayExpectedGoals
  } = fixtureScoringContext(fixture, weightsInput);

  const latestOdds = fixture.oddsHistory[fixture.oddsHistory.length - 1];
  const eligibleOptions = fixture.marketOptions.filter(
    (option) => {
      const oddsType = option.oddsType.toUpperCase();
      const teamContext = TEAM_MARKET_CONTEXT[oddsType];
      const code = option.selectionCode.trim().toUpperCase();
      const teamTotalDirection = detectOverUnderDirection(option.selectionName)
        ?? (/^(H|O|OVER)$/.test(code) ? "over" : /^(L|U|UNDER)$/.test(code) ? "under" : null);
      return option.currentOdds >= thresholds.minRecommendedOdds
        && oddsType !== "SGA"
        && (!teamContext || !!teamTotalDirection)
        && isLiveMarketOptionEligible(fixture, option);
    }
  );

  const scoredOptions = eligibleOptions
    .map((option) => ({
      option,
      ...scoreOption(baseConfidence, option, marketFamily(option), fixture, {
        home: homeExpectedGoals,
        away: awayExpectedGoals
      })
    }));
  const positiveValueOptions = scoredOptions.filter((candidate) => candidate.edge > 0 && candidate.valueScore > 0);
  const bestOption = (positiveValueOptions.length > 0 ? positiveValueOptions : scoredOptions)
    .sort((a, b) => b.modelProbability - a.modelProbability)[0] ?? null;

  const fallbackOdds = Number(latestOdds.homeWin.toFixed(2));
  const fallbackProbability = Math.min(0.9, Math.max(0.05, 0.5 + baseConfidence));
  const fallbackEdge = fallbackProbability - impliedProbability(fallbackOdds);
  const fallbackValueScore = fallbackEdge * fallbackOdds;

  const selectedOdds = bestOption ? bestOption.option.currentOdds : fallbackOdds;
  const selectedProbability = bestOption ? bestOption.modelProbability : fallbackProbability;
  const selectedEdge = bestOption ? bestOption.edge : fallbackEdge;
  const selectedValueScore = bestOption ? bestOption.valueScore : fallbackValueScore;
  const halfHomeExpectedGoals = clamp(homeExpectedGoals * 0.46 + Math.max(0, momentum) * 0.2, 0.05, 2.6);
  const halfAwayExpectedGoals = clamp(awayExpectedGoals * 0.46 + Math.max(0, -momentum) * 0.2, 0.05, 2.6);
  const selectedOption = bestOption?.option;
  const selectedMarketFamily = selectedOption ? marketFamily(selectedOption) : "fulltime";
  const selectedOptionDirection = selectedOption ? detectOverUnderDirection(selectedOption.selectionName) : null;
  const selectedOutcomeDirection = selectedOption ? detectWinDrawLoseDirection(selectedOption.selectionName) : null;
  const selectedOptionLine = selectedOption ? parseLineConditionValue(selectedOption.lineCondition) : null;
  const selectedOddsType = selectedOption?.oddsType.toUpperCase() ?? "";
  const isHalfTimeGoalsSelection = selectedOption
    ? isGoalsStyleMarket(selectedOption) && (selectedOddsType.startsWith("E") || selectedOddsType.startsWith("F"))
    : false;
  const isFullTimeGoalsSelection = selectedOption
    ? isGoalsStyleMarket(selectedOption) && !isHalfTimeGoalsSelection
    : false;
  const halfHomeBias = halfHomeExpectedGoals / Math.max(halfHomeExpectedGoals + halfAwayExpectedGoals, 0.001);
  const fullHomeBias = homeExpectedGoals / Math.max(homeExpectedGoals + awayExpectedGoals, 0.001);
  const halfTimeOutcomeConstraint = selectedMarketFamily === "halftime" ? selectedOutcomeDirection : null;
  const fullTimeOutcomeConstraint = selectedMarketFamily !== "halftime" ? selectedOutcomeDirection : null;

  const halfTimeTotalConstraint =
    selectedOptionDirection && selectedOptionLine !== null && isHalfTimeGoalsSelection
      ? { direction: selectedOptionDirection, line: selectedOptionLine }
      : undefined;
  const fullTimeTotalConstraint =
    selectedOptionDirection && selectedOptionLine !== null && isFullTimeGoalsSelection
      ? { direction: selectedOptionDirection, line: selectedOptionLine }
      : undefined;
  const currentScoreFloor = liveScoreFloor(fixture);
  const halfTimeScoreFloor = isPastHalfTime(fixture.status)
    ? fixture.halfTimeScore ?? currentScoreFloor
    : currentScoreFloor;

  const halfTimeScorePrediction = marketExactScoreline(
    fixture.marketOptions,
    ["ECS"],
    halfHomeExpectedGoals,
    halfAwayExpectedGoals,
    halfTimeOutcomeConstraint,
    halfTimeTotalConstraint,
    halfTimeScoreFloor
  ) ?? mostLikelyScoreline(
    halfHomeExpectedGoals,
    halfAwayExpectedGoals,
    halfTimeOutcomeConstraint,
    halfTimeTotalConstraint,
    halfTimeScoreFloor
  );
  const fullTimeScorePrediction = marketExactScoreline(
    fixture.marketOptions,
    ["CRS"],
    homeExpectedGoals,
    awayExpectedGoals,
    fullTimeOutcomeConstraint,
    fullTimeTotalConstraint,
    currentScoreFloor
  ) ?? mostLikelyScoreline(
    homeExpectedGoals,
    awayExpectedGoals,
    fullTimeOutcomeConstraint,
    fullTimeTotalConstraint,
    currentScoreFloor
  );

  const constrainedHalfTimeScorePrediction =
    selectedOptionDirection && selectedOptionLine !== null && isHalfTimeGoalsSelection
      ? applyTotalGoalsConstraint(halfTimeScorePrediction, selectedOptionLine, selectedOptionDirection, halfHomeBias)
      : halfTimeScorePrediction;
  const constrainedFullTimeScorePrediction =
    selectedOptionDirection && selectedOptionLine !== null && isFullTimeGoalsSelection
      ? applyTotalGoalsConstraint(fullTimeScorePrediction, selectedOptionLine, selectedOptionDirection, fullHomeBias)
      : fullTimeScorePrediction;

  const alignedHalfTimeScorePrediction =
    halfTimeOutcomeConstraint
      ? alignScorelineWithOutcome(constrainedHalfTimeScorePrediction, halfTimeOutcomeConstraint)
      : constrainedHalfTimeScorePrediction;
  const alignedFullTimeScorePrediction =
    fullTimeOutcomeConstraint
      ? alignScorelineWithOutcome(constrainedFullTimeScorePrediction, fullTimeOutcomeConstraint)
      : constrainedFullTimeScorePrediction;
  const selectedExactScore = selectedOption ? parseExactScoreSelection(selectedOption.selectionName) : null;
  const effectiveHalfTimeScorePrediction = selectedOddsType === "ECS" && selectedExactScore
    ? formatScoreline(selectedExactScore.home, selectedExactScore.away)
    : alignedHalfTimeScorePrediction;
  const cumulativeFullTimeScorePrediction = selectedOddsType === "CRS" && selectedExactScore
    ? formatScoreline(selectedExactScore.home, selectedExactScore.away)
    : enforceCumulativeScoreline(
    effectiveHalfTimeScorePrediction,
    alignedFullTimeScorePrediction,
    homeExpectedGoals,
    awayExpectedGoals,
    fullTimeOutcomeConstraint,
    fullTimeTotalConstraint,
    fixture.marketOptions
  );
  const rankedFullTimeScoreCandidates = rankedScoreCandidates(
    fixture.marketOptions,
    ["CRS"],
    homeExpectedGoals,
    awayExpectedGoals,
    fullTimeOutcomeConstraint,
    fullTimeTotalConstraint,
    parseScoreline(effectiveHalfTimeScorePrediction)
  );
  const rankedModelFullTimeCandidates = rankedModelScoreCandidates(
    homeExpectedGoals,
    awayExpectedGoals,
    fullTimeOutcomeConstraint,
    fullTimeTotalConstraint,
    parseScoreline(alignedHalfTimeScorePrediction)
  );
  const scorePredictionAlternatives = [...rankedFullTimeScoreCandidates, ...rankedModelFullTimeCandidates]
    .map((candidate) => candidate.scoreline)
    .filter((scoreline, index, values) => scoreline !== cumulativeFullTimeScorePrediction && values.indexOf(scoreline) === index)
    .slice(0, 2);
  const correctScoreConfidence = correctScoreConfidenceLabel(rankedFullTimeScoreCandidates);
  const selectedMarket = bestOption ? marketName(bestOption.option) : "主客和";
  const selectedName = bestOption ? selectionDisplayName(bestOption.option) : "主勝";
  const confidence = Number((selectedProbability * 100).toFixed(1));
  const reasonSections = bestOption
    ? buildReason(fixture, bestOption.option, confidence, marketFamily(bestOption.option), bestOption.liveAssessment)
    : null;
  const reason = reasonSections ? reasonSections.reason : "此場比賽缺乏可用的高質量市場訊號，請以穩健節奏觀察";

  const recommendationDraft: Recommendation = {
    fixtureId: fixture.id,
    match: `${fixture.homeTeam} vs ${fixture.awayTeam}`,
    kickoffAt: fixture.kickoffAt,
    matchDateHk: hongKongDateKeyFromIso(fixture.kickoffAt),
    league: fixture.league,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    homeTeamEn: fixture.homeTeamEn,
    awayTeamEn: fixture.awayTeamEn,
    matchKey: `${fixture.homeTeam.replace(/\s+/g, "").toLowerCase()}|${fixture.awayTeam.replace(/\s+/g, "").toLowerCase()}`,
    market: selectedMarket,
    selectionName: selectedName,
    currentOdds: Number(selectedOdds.toFixed(2)),
    confidence,
    edgeScore: Number((selectedEdge * 100).toFixed(2)),
    valueScore: Number(selectedValueScore.toFixed(3)),
    recommendationGroup: "focus",
    halfTimeScorePrediction: effectiveHalfTimeScorePrediction,
    fullTimeScorePrediction: cumulativeFullTimeScorePrediction,
    scorePredictionAlternatives,
    correctScoreConfidence,
    reason,
    reasonSections: reasonSections ? { strengths: reasonSections.strengths, risks: reasonSections.risks, watchpoints: reasonSections.watchpoints } : undefined,
    lastUpdatedAt: new Date().toISOString()
  };

  recommendationDraft.recommendationGroup = isHighOddsRecommendation(recommendationDraft, thresholds) ? "highOdds" : "focus";
  return recommendationDraft;
}

export function pickTopRecommendations(fixtures: Fixture[], limit = 5): Recommendation[] {
  const thresholds = normalizeRecommendationThresholds();
  return fixtures
    .map((fixture) => scoreFixture(fixture, undefined, thresholds))
    .filter((r) => r.currentOdds >= thresholds.minRecommendedOdds && r.edgeScore > 0 && r.valueScore > 0)
    .sort((a, b) => b.valueScore - a.valueScore)
    .slice(0, limit);
}

export function pickTopRecommendationsWithWeights(
  fixtures: Fixture[],
  weights: Partial<ScoringWeights>,
  limit = 5,
  thresholdsInput?: Partial<RecommendationThresholds>
): Recommendation[] {
  const thresholds = normalizeRecommendationThresholds(thresholdsInput);
  return fixtures
    .map((fixture) => scoreFixture(fixture, weights, thresholds))
    .filter((r) => r.currentOdds >= thresholds.minRecommendedOdds && r.edgeScore > 0 && r.valueScore > 0)
    .sort((a, b) => b.valueScore - a.valueScore)
    .slice(0, limit);
}

export function isHighOddsRecommendation(
  recommendation: Recommendation,
  thresholdsInput: Partial<RecommendationThresholds>
): boolean {
  const thresholds = normalizeRecommendationThresholds(thresholdsInput);
  return (
    recommendation.currentOdds >= thresholds.highOddsThreshold &&
    recommendation.edgeScore >= thresholds.highOddsMinEdgeScore &&
    recommendation.valueScore >= thresholds.highOddsMinValueScore
  );
}
