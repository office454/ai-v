import type { Fixture, MarketOption, Recommendation, ScoringWeights, TeamStrength } from "../types.js";

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
  FHA: "半場讓球主客和",
  FHC: "球隊半場開出角球大細",
  FHH: "球隊半場入球大細",
  FHL: "球隊半場入球大細",
  FLA: "球隊入球大細",
  FLH: "球隊入球大細",
  FGS: "首名入球",
  FTS: "第一隊入球",
  HAD: "主客和",
  HDC: "讓球",
  HFT: "半全場",
  HHA: "半場主客和",
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
  const home = avg(fixture.lineup.home.map((p) => (p.fitness + p.recentForm) / 2));
  const away = avg(fixture.lineup.away.map((p) => (p.fitness + p.recentForm) / 2));
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

function marketName(option: MarketOption, fixture: Fixture): string {
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

function selectionDisplayName(option: MarketOption, fixture: Fixture): string {
  const baseName = option.selectionName.trim() || option.selectionCode.trim() || "選項";
  const rawCondition = option.lineCondition.trim();
  const normalizedCondition = rawCondition.replace(/^\[/, "").replace(/\]$/, "").trim();
  const teamContext = TEAM_MARKET_CONTEXT[option.oddsType];
  const contextPrefix = teamContext
    ? `${teamContext.side === "home" ? "主隊" : "客隊"} ${teamContext.period}`
    : "";

  if (!normalizedCondition || ["n/a", "na", "0", "0.0"].includes(normalizedCondition.toLowerCase())) {
    return contextPrefix ? `${contextPrefix}${baseName}` : baseName;
  }

  const unit = lineUnit(option.oddsType);
  const lineText = unit ? `${normalizedCondition}${unit}` : normalizedCondition;

  if (baseName === "大" || baseName === "細") {
    return contextPrefix ? `${contextPrefix}${baseName}（${lineText}）` : `${baseName}（${lineText}）`;
  }

  return contextPrefix ? `${contextPrefix}${baseName}（盤口 ${lineText}）` : `${baseName}（盤口 ${lineText}）`;
}

function scoreOption(
  baseConfidence: number,
  option: MarketOption,
  marketType: "fulltime" | "halftime" | "corners" | "goals" | "other"
): { modelProbability: number; edge: number; valueScore: number } {
  const pImplied = impliedProbability(option.currentOdds);
  const confidenceSignal = Math.max(-0.18, Math.min(0.24, baseConfidence * 0.22));
  const marketPressureBonus = option.currentOdds >= 2.0 ? 0.01 : 0;
  const phaseSignal = marketPhaseSignal(option, baseConfidence);
  const marketTypeBias = marketType === "halftime" ? 0.01 : marketType === "corners" ? 0.008 : marketType === "goals" ? 0.012 : 0;
  const pModel = Math.min(
    0.95,
    Math.max(0.02, pImplied + confidenceSignal + marketPressureBonus + phaseSignal + marketTypeBias + optionQualityBoost(option))
  );
  const edge = pModel - pImplied;
  const valueScore = edge * option.currentOdds;
  return { modelProbability: pModel, edge, valueScore };
}

export function buildReason(fixture: Fixture, option: MarketOption, confidence: number, marketType: "fulltime" | "halftime" | "corners" | "goals" | "other") {
  const strengths: string[] = [];
  const risks: string[] = [];
  const watchpoints: string[] = [];
  const h2h = recentHeadToHeadSignal(fixture);
  const venue = venueFormSignal(fixture);
  const formCurve = recentFormCurve(fixture);
  const lineup = lineupScore(fixture);

  if (h2h > 0.01) {
    strengths.push("近期對賽有利，且主隊在對手面前表現更穩");
  } else if (h2h < -0.01) {
    risks.push("近期對賽不利，需留意對手反覆打破節奏");
  }

  if (venue > 0.01) {
    strengths.push("主隊主場形勢更強，場地作戰優勢明顯");
  } else if (venue < -0.01) {
    risks.push("客隊客場表現更穩，主場壓力較大");
  }

  if (Math.abs(formCurve) > 0.1) {
    strengths.push("最近 5 場主客隊 form 差距明顯，整體走勢支持這個方向");
  }

  if (lineup > 0.03) {
    strengths.push("陣容和體能層面優於對手，支撐本場勝出機會");
  } else if (lineup < -0.01) {
    risks.push("陣容和體能層面未佔優，需防止比賽節奏被對手帶走");
  }

  if (confidence >= 70) {
    strengths.push("模型信心已達高位，適合優先跟進");
  } else if (confidence >= 60) {
    strengths.push("模型信心屬中高位，屬於值得觀察的選項");
  } else {
    risks.push("模型信心偏弱，建議以觀察為主，避免過早下單");
  }

  if (!fixture.lineup.confirmed) {
    watchpoints.push("陣容若再有變動，建議重評後再決定是否跟進");
  }

  if (option.currentOdds >= 3.0) {
    watchpoints.push("賠率偏高，需留意波動與回報是否匹配");
  }

  if (marketType === "halftime") {
    watchpoints.push("半場市場節奏波動較大，建議把握轉換點而非盲目追高");
  } else if (marketType === "corners") {
    watchpoints.push("角球市場更容易受比賽節奏與臨場狀態影響");
  } else if (marketType === "goals") {
    watchpoints.push("大細市場需留意比賽進攻節奏與控球時間");
  }

  const marketLabel = marketType === "halftime" ? "半場市場" : marketType === "corners" ? "角球市場" : marketType === "goals" ? "大細市場" : "全場市場";
  return {
    strengths,
    risks,
    watchpoints,
    reason: `${marketLabel}：${strengths.length > 0 ? strengths.join("；") : "本場訊號較為平衡"}。${risks.length > 0 ? `風險點：${risks.join("；")}` : "風險點：尚未出現明顯反對訊號"}。${watchpoints.length > 0 ? `觀察重點：${watchpoints.join("；")}` : "觀察重點：賽事節奏與陣容變化"}`
  };
}

export function scoreFixture(
  fixture: Fixture,
  weightsInput?: Partial<ScoringWeights>,
  thresholdsInput?: Partial<RecommendationThresholds>
): Recommendation {
  const thresholds = normalizeRecommendationThresholds(thresholdsInput);
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

  const latestOdds = fixture.oddsHistory[fixture.oddsHistory.length - 1];
  const eligibleOptions = fixture.marketOptions.filter((o) => o.currentOdds >= thresholds.minRecommendedOdds);

  const bestOption =
    eligibleOptions
      .map((option) => ({ option, ...scoreOption(baseConfidence, option, marketFamily(option)) }))
      .sort((a, b) => b.modelProbability - a.modelProbability)[0] ?? null;

  const fallbackOdds = Number(latestOdds.homeWin.toFixed(2));
  const fallbackProbability = Math.min(0.9, Math.max(0.05, 0.5 + baseConfidence));
  const fallbackEdge = fallbackProbability - impliedProbability(fallbackOdds);
  const fallbackValueScore = fallbackEdge * fallbackOdds;

  const selectedOdds = bestOption ? bestOption.option.currentOdds : fallbackOdds;
  const selectedProbability = bestOption ? bestOption.modelProbability : fallbackProbability;
  const selectedEdge = bestOption ? bestOption.edge : fallbackEdge;
  const selectedValueScore = bestOption ? bestOption.valueScore : fallbackValueScore;
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
  const halfHomeExpectedGoals = clamp(homeExpectedGoals * 0.46 + Math.max(0, momentum) * 0.2, 0.05, 2.6);
  const halfAwayExpectedGoals = clamp(awayExpectedGoals * 0.46 + Math.max(0, -momentum) * 0.2, 0.05, 2.6);
  const fullTimeScorePrediction = scorelineFromExpectedGoals(homeExpectedGoals, awayExpectedGoals);
  const halfTimeScorePrediction = scorelineFromExpectedGoals(halfHomeExpectedGoals, halfAwayExpectedGoals);
  const selectedMarket = bestOption ? marketName(bestOption.option, fixture) : "主客和";
  const selectedName = bestOption ? selectionDisplayName(bestOption.option, fixture) : "主勝";
  const confidence = Number((selectedProbability * 100).toFixed(1));
  const reasonSections = bestOption ? buildReason(fixture, bestOption.option, confidence, marketFamily(bestOption.option)) : null;
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
    halfTimeScorePrediction,
    fullTimeScorePrediction,
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
    .filter((r) => r.currentOdds >= thresholds.minRecommendedOdds)
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
    .filter((r) => r.currentOdds >= thresholds.minRecommendedOdds)
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
