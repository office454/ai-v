type Strength = "elite" | "strong" | "average" | "weak";

type CornerMarketOption = {
  oddsType: string;
  selectionName: string;
  lineCondition: string;
  currentOdds: number;
  inplay: boolean;
  poolStatus: string;
  combinationStatus: string;
};

type LiveMetricPair = { home: number; away: number };

export type CornerPredictionFixture = {
  league?: string;
  kickoffAt: string;
  status?: string;
  finalScore?: { home: number; away: number };
  finalCorners?: { home: number; away: number; total: number };
  homeAverageCorners?: number;
  awayAverageCorners?: number;
  cornerHistorySampleSize?: { home: number; away: number };
  liveDataSources?: string[];
  liveDataFallbackNote?: string;
  liveMinute?: number;
  liveMinuteSource?: string;
  liveAttackingMetrics?: {
    source: "ESPN" | "FotMob";
    possession?: LiveMetricPair;
    dangerousAttacks?: LiveMetricPair;
    finalThirdEntries?: LiveMetricPair;
    crosses?: LiveMetricPair;
    accurateCrosses?: LiveMetricPair;
  };
  livePressureMetrics?: {
    source: "ESPN" | "FotMob";
    yellowCards?: LiveMetricPair;
    redCards?: LiveMetricPair;
    substitutions?: LiveMetricPair;
  };
  homeStrength?: Strength;
  awayStrength?: Strength;
  homeRecentPoints?: number;
  awayRecentPoints?: number;
  homeVenueForm?: number;
  awayVenueForm?: number;
  recentHeadToHead?: Array<{ homeGoals: number; awayGoals: number }>;
  lineup?: {
    confirmed?: boolean;
    home?: Array<{ role?: string; fitness?: number; recentForm?: number }>;
    away?: Array<{ role?: string; fitness?: number; recentForm?: number }>;
  };
  marketOptions?: CornerMarketOption[];
};

export type CornerPrediction = {
  home: number;
  away: number;
  expectedTotal: number;
  confidence: number;
  elapsedMinute: number | null;
  marketLine: number | null;
  overProbability: number | null;
  underProbability: number | null;
  basis: string[];
};

const STRENGTH_SCORE: Record<Strength, number> = { elite: 1, strong: 0.6, average: 0, weak: -0.6 };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function poissonCdf(lambda: number, maximum: number): number {
  let probability = Math.exp(-lambda);
  let cumulative = probability;
  for (let value = 1; value <= maximum; value += 1) {
    probability *= lambda / value;
    cumulative += probability;
  }
  return clamp(cumulative, 0, 1);
}

function negativeBinomialCdf(mean: number, dispersion: number, maximum: number): number {
  if (maximum < 0) return 0;
  const shape = 1 / Math.max(0.000001, dispersion);
  const successProbability = shape / (shape + Math.max(0.001, mean));
  let probability = Math.pow(successProbability, shape);
  let cumulative = probability;
  for (let value = 0; value < maximum; value += 1) {
    probability *= ((value + shape) / (value + 1)) * (1 - successProbability);
    cumulative += probability;
  }
  return clamp(cumulative, 0, 1);
}

function leagueCornerDispersion(league: string | undefined): number | null {
  const calibrated: Record<string, number> = {
    "scottish premiership": 0.0179,
    "蘇格蘭超級聯賽": 0.0179,
    "efl championship": 0.0134,
    "英格蘭冠軍聯賽": 0.0134,
    "ligue 1": 0.0172,
    "法國甲組聯賽": 0.0172,
    "primeira liga": 0.0223,
    "葡萄牙超級聯賽": 0.0223,
    eredivisie: 0.0137,
    "荷蘭甲組聯賽": 0.0137,
    bundesliga: 0.014,
    "德國甲組聯賽": 0.014,
    "premier league": 0.0109,
    "英格蘭超級聯賽": 0.0109,
    "la liga": 0.0146,
    "西班牙甲組聯賽": 0.0146,
    "serie a": 0.024,
    "意大利甲組聯賽": 0.024
  };
  return calibrated[String(league ?? "").trim().toLowerCase()] ?? null;
}

function gammaPoissonLiveUpdate(baselineTotal: number, elapsedMinute: number, currentTotal: number, remainingMinutes: number) {
  const priorExposureMinutes = 95;
  const priorShape = Math.max(0.001, baselineTotal / 95) * priorExposureMinutes;
  const posteriorShape = priorShape + currentTotal;
  return {
    expectedRemaining: posteriorShape * remainingMinutes / (priorExposureMinutes + elapsedMinute),
    dispersion: 1 / posteriorShape
  };
}

function totalMarketProbabilities(expectedAdditional: number, currentTotal: number, line: number | null, dispersion: number | null): {
  overProbability: number | null;
  underProbability: number | null;
} {
  if (line === null) return { overProbability: null, underProbability: null };
  const maximumUnderAddition = Math.floor(line) - currentTotal;
  const underProbability = dispersion !== null
    ? negativeBinomialCdf(expectedAdditional, dispersion, maximumUnderAddition)
    : poissonCdf(expectedAdditional, maximumUnderAddition);
  return {
    overProbability: 1 - underProbability,
    underProbability
  };
}

function parseLine(raw: string): number | null {
  const values = raw.match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) ?? [];
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function overUnderSide(selectionName: string): "over" | "under" | null {
  const normalized = selectionName.replace(/\s+/g, "").toLowerCase();
  if (normalized === "大" || normalized.includes("over")) return "over";
  if (normalized === "細" || normalized.includes("under")) return "under";
  return null;
}

type BalancedMarket = { line: number; overNoVig: number; expected: number; overOdds: number; underOdds: number };

function balancedOverUnderMarket(options: CornerMarketOption[] = [], oddsType: string): BalancedMarket | null {
  const byLine = new Map<number, Partial<Record<"over" | "under", number>>>();
  const minimumLine = oddsType === "CHL" ? 4 : 0.5;
  for (const option of options) {
    if (option.oddsType.toUpperCase() !== oddsType || option.currentOdds <= 1) continue;
    const line = parseLine(option.lineCondition);
    const side = overUnderSide(option.selectionName);
    if (line === null || line < minimumLine || line > 20 || !side) continue;
    const pair = byLine.get(line) ?? {};
    pair[side] = option.currentOdds;
    byLine.set(line, pair);
  }

  const candidates = [...byLine.entries()]
    .map(([line, pair]) => {
      if (!pair.over || !pair.under) return null;
      const overImplied = 1 / pair.over;
      const underImplied = 1 / pair.under;
      const overNoVig = overImplied / (overImplied + underImplied);
      return { line, overNoVig, balanceDistance: Math.abs(overNoVig - 0.5) };
    })
    .filter((candidate): candidate is { line: number; overNoVig: number; balanceDistance: number } => candidate !== null)
    .sort((left, right) => left.balanceDistance - right.balanceDistance || left.line - right.line);

  const selected = candidates[0];
  if (!selected) return null;
  return {
    line: selected.line,
    overNoVig: selected.overNoVig,
    expected: selected.line + clamp((selected.overNoVig - 0.5) * 2, -0.75, 0.75),
    overOdds: byLine.get(selected.line)?.over ?? 0,
    underOdds: byLine.get(selected.line)?.under ?? 0
  };
}

function fullTimeCornerMarket(options: CornerMarketOption[] = []): BalancedMarket | null {
  return balancedOverUnderMarket(options, "CHL");
}

export function fullTimeCornerLine(options: CornerMarketOption[] = []): number | null {
  return fullTimeCornerMarket(options)?.line ?? null;
}

function matchPhase(fixture: CornerPredictionFixture): { label: string; elapsedMinute: number | null } | null {
  const status = (fixture.status ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (/finished|fulltime|ended|result/.test(status)) return { label: "賽事已完結", elapsedMinute: null };
  if (Number.isInteger(fixture.liveMinute) && fixture.liveMinute! >= 1 && fixture.liveMinute! <= 130) {
    return {
      label: `比賽第 ${fixture.liveMinute}'（${fixture.liveMinuteSource ?? "外部資料庫"}）`,
      elapsedMinute: fixture.liveMinute!
    };
  }
  if (/secondhalf|2ndhalf/.test(status)) return { label: "下半場進行中（HKJC 及外部資料庫未提供官方分鐘）", elapsedMinute: null };
  if (/halftime/.test(status)) return { label: "中場休息（HKJC 及外部資料庫未提供官方分鐘）", elapsedMinute: null };
  if (/firsthalf|1sthalf/.test(status)) return { label: "上半場進行中（HKJC 及外部資料庫未提供官方分鐘）", elapsedMinute: null };
  if (/live|inplay|playing|running/.test(status)) return { label: "比賽進行中（HKJC 及外部資料庫未提供官方分鐘）", elapsedMinute: null };
  return null;
}

function attackingLineupIndex(players: Array<{ role?: string; fitness?: number; recentForm?: number }> = []): number | null {
  const attackers = players.filter((player) =>
    /fw|mf|wing|striker|forward|attack|前鋒|中場|翼/i.test(player.role ?? "")
    && Number.isFinite(player.fitness)
    && Number.isFinite(player.recentForm)
  );
  if (attackers.length === 0) return null;
  return attackers.reduce((sum, player) => {
    const fitness = clamp(player.fitness! / 100, 0, 1);
    const form = clamp(player.recentForm! / 100, 0, 1);
    return sum + fitness * 0.45 + form * 0.55;
  }, 0) / attackers.length;
}

function liveAttackingHomeShare(fixture: CornerPredictionFixture): number | null {
  const metrics = fixture.liveAttackingMetrics;
  if (!metrics) return null;
  const signals = [
    { pair: metrics.dangerousAttacks, weight: 0.35 },
    { pair: metrics.finalThirdEntries, weight: 0.3 },
    { pair: metrics.crosses, weight: 0.2 },
    { pair: metrics.accurateCrosses, weight: 0.1 },
    { pair: metrics.possession, weight: 0.05 }
  ].filter((signal): signal is { pair: LiveMetricPair; weight: number } => {
    const total = (signal.pair?.home ?? 0) + (signal.pair?.away ?? 0);
    return !!signal.pair && total > 0;
  });
  if (signals.length === 0) return null;
  const weight = signals.reduce((sum, signal) => sum + signal.weight, 0);
  return signals.reduce((sum, signal) => {
    const total = signal.pair.home + signal.pair.away;
    return sum + (signal.pair.home / total) * signal.weight;
  }, 0) / weight;
}

function redCardHomeShareAdjustment(fixture: CornerPredictionFixture): number {
  const redCards = fixture.livePressureMetrics?.redCards;
  return redCards ? clamp((redCards.away - redCards.home) * 0.08, -0.08, 0.08) : 0;
}

export function calculateCornerPrediction(fixture: CornerPredictionFixture, _nowMs = Date.now()): CornerPrediction {
  const normalizedStatus = (fixture.status ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const phase = matchPhase(fixture);
  const elapsedMinute = phase?.elapsedMinute ?? null;
  const currentHome = Math.max(0, fixture.finalCorners?.home ?? 0);
  const currentAway = Math.max(0, fixture.finalCorners?.away ?? 0);
  const currentTotal = currentHome + currentAway;
  const cornerMarket = fullTimeCornerMarket(fixture.marketOptions);
  const homeCornerMarket = balancedOverUnderMarket(fixture.marketOptions, "CHH");
  const awayCornerMarket = balancedOverUnderMarket(fixture.marketOptions, "CHA");
  const goalMarket = balancedOverUnderMarket(fixture.marketOptions, "HIL");
  const marketLine = cornerMarket?.line ?? null;
  const marketExpectedTotal = cornerMarket?.expected ?? null;
  if (/finished|fulltime|ended|result/.test(normalizedStatus) && fixture.finalCorners) {
    return {
      home: currentHome,
      away: currentAway,
      expectedTotal: currentTotal,
      confidence: 100,
      elapsedMinute: null,
      marketLine,
      overProbability: null,
      underProbability: null,
      basis: ["賽事已完結", `實際角球 ${currentHome}:${currentAway}`]
    };
  }
  const historyHome = fixture.homeAverageCorners;
  const historyAway = fixture.awayAverageCorners;
  const hasHistory = Number.isFinite(historyHome) && Number.isFinite(historyAway);

  const strengthGap = (STRENGTH_SCORE[fixture.homeStrength ?? "average"] - STRENGTH_SCORE[fixture.awayStrength ?? "average"]);
  const formGap = ((fixture.homeRecentPoints ?? 7) - (fixture.awayRecentPoints ?? 7)) / 15;
  const venueGap = (fixture.homeVenueForm ?? 0) - (fixture.awayVenueForm ?? 0);
  const scoreGap = (fixture.finalScore?.home ?? 0) - (fixture.finalScore?.away ?? 0);
  const trailingShareAdjustment = elapsedMinute !== null && elapsedMinute >= 45
    ? scoreGap < 0 ? 0.1 : scoreGap > 0 ? -0.1 : 0
    : 0;
  const tacticalHomeShare = clamp(0.52 + strengthGap * 0.08 + formGap * 0.08 + venueGap * 0.06 + trailingShareAdjustment, 0.3, 0.7);

  const historicalTotal = hasHistory ? (historyHome as number) + (historyAway as number) : null;
  const teamMarketTotal = homeCornerMarket && awayCornerMarket ? homeCornerMarket.expected + awayCornerMarket.expected : null;
  const totalSignals = [
    marketExpectedTotal !== null ? { value: marketExpectedTotal, weight: 0.5 } : null,
    teamMarketTotal !== null ? { value: teamMarketTotal, weight: 0.3 } : null,
    historicalTotal !== null ? { value: historicalTotal, weight: 0.2 } : null
  ].filter((signal): signal is { value: number; weight: number } => signal !== null);
  const totalSignalWeight = totalSignals.reduce((sum, signal) => sum + signal.weight, 0);
  let baselineTotal = totalSignalWeight > 0
    ? totalSignals.reduce((sum, signal) => sum + signal.value * signal.weight, 0) / totalSignalWeight
    : 9.5;

  const goalOpennessAdjustment = goalMarket ? clamp((goalMarket.expected - 2.5) * 0.6, -0.75, 0.75) : 0;
  const headToHead = fixture.recentHeadToHead ?? [];
  const headToHeadGoals = headToHead.length > 0
    ? headToHead.reduce((sum, match) => sum + match.homeGoals + match.awayGoals, 0) / headToHead.length
    : null;
  const headToHeadAdjustment = headToHeadGoals !== null ? clamp((headToHeadGoals - 2.5) * 0.18, -0.35, 0.35) : 0;
  const homeAttackIndex = attackingLineupIndex(fixture.lineup?.home);
  const awayAttackIndex = attackingLineupIndex(fixture.lineup?.away);
  const lineupAdjustment = homeAttackIndex !== null && awayAttackIndex !== null
    ? clamp(((homeAttackIndex + awayAttackIndex) / 2 - 0.7) * 1.5, -0.35, 0.35)
    : 0;
  baselineTotal += goalOpennessAdjustment + headToHeadAdjustment + lineupAdjustment;

  const historyShare = hasHistory && historicalTotal && historicalTotal > 0 ? (historyHome as number) / historicalTotal : null;
  const teamMarketShare = homeCornerMarket && awayCornerMarket && teamMarketTotal
    ? homeCornerMarket.expected / teamMarketTotal
    : null;
  const shareSignals = [
    teamMarketShare !== null ? { value: teamMarketShare, weight: 0.5 } : null,
    historyShare !== null ? { value: historyShare, weight: 0.25 } : null,
    { value: tacticalHomeShare, weight: 0.25 }
  ].filter((signal): signal is { value: number; weight: number } => signal !== null);
  const shareWeight = shareSignals.reduce((sum, signal) => sum + signal.weight, 0);
  const baselineHomeShare = clamp(
    shareSignals.reduce((sum, signal) => sum + signal.value * signal.weight, 0) / shareWeight,
    0.25,
    0.75
  );

  let predictedTotal = baselineTotal;
  let homeShare = baselineHomeShare;
  const liveAttackHomeShare = liveAttackingHomeShare(fixture);
  let gameStateAdjustment = 0;
  let predictiveDispersion = leagueCornerDispersion(fixture.league);
  if (elapsedMinute !== null && elapsedMinute > 0) {
    const remainingMinutes = Math.max(0, 95 - elapsedMinute);
    const strongerTeamTrailing = (strengthGap > 0.2 && scoreGap < 0) || (strengthGap < -0.2 && scoreGap > 0);
    const strongerTeamLeadingByTwo = (strengthGap > 0.2 && scoreGap >= 2) || (strengthGap < -0.2 && scoreGap <= -2);
    gameStateAdjustment = elapsedMinute >= 45
      ? strongerTeamTrailing ? 0.12 : strongerTeamLeadingByTwo ? -0.1 : scoreGap !== 0 ? 0.04 : 0
      : 0;
    const bayesianUpdate = gammaPoissonLiveUpdate(baselineTotal, elapsedMinute, currentTotal, remainingMinutes);
    const expectedRemaining = bayesianUpdate.expectedRemaining * (1 + gameStateAdjustment);
    predictiveDispersion = bayesianUpdate.dispersion;
    predictedTotal = currentTotal + expectedRemaining;
    if (currentTotal > 0) {
      const liveShare = currentHome / currentTotal;
      const paceWeight = clamp((elapsedMinute / 95) * 0.6, 0.12, 0.6);
      homeShare = clamp(liveShare * paceWeight + baselineHomeShare * (1 - paceWeight), 0.25, 0.75);
    }
  } else if (currentTotal > 0) {
    const observedShareWeight = clamp(currentTotal / 20, 0.1, 0.35);
    homeShare = clamp(
      (currentHome / currentTotal) * observedShareWeight + baselineHomeShare * (1 - observedShareWeight),
      0.25,
      0.75
    );
  }
  if (liveAttackHomeShare !== null) {
    homeShare = clamp(homeShare * 0.75 + liveAttackHomeShare * 0.25, 0.25, 0.75);
  }
  const redCardAdjustment = redCardHomeShareAdjustment(fixture);
  homeShare = clamp(homeShare + redCardAdjustment, 0.25, 0.75);

  const maximumTotal = Math.max(currentTotal, 16);
  const expectedTotal = clamp(predictedTotal, currentTotal, maximumTotal);
  const roundedTotal = Math.round(expectedTotal);
  let home = Math.max(currentHome, Math.round(roundedTotal * homeShare));
  let away = Math.max(currentAway, roundedTotal - home);
  if (home + away > roundedTotal && currentTotal <= roundedTotal) {
    const excess = home + away - roundedTotal;
    if (home - currentHome >= away - currentAway) home -= excess;
    else away -= excess;
  }

  const historySamples = (fixture.cornerHistorySampleSize?.home ?? 0) + (fixture.cornerHistorySampleSize?.away ?? 0);
  const tacticalSignalCount = [teamMarketTotal, goalMarket, headToHeadGoals, homeAttackIndex, liveAttackHomeShare].filter((value) => value !== null).length;
  const confidence = Math.round(clamp(44 + (marketLine !== null ? 12 : 0) + tacticalSignalCount * 4 + Math.min(10, historySamples * 2) + (elapsedMinute !== null && currentTotal > 0 ? 14 : 0), 42, 90));
  const expectedAdditional = Math.max(0, expectedTotal - currentTotal);
  const { overProbability, underProbability } = totalMarketProbabilities(
    expectedAdditional,
    currentTotal,
    marketLine,
    predictiveDispersion
  );
  const distributionLabel = predictiveDispersion !== null ? "負二項" : "Poisson";
  const overFairOdds = overProbability ? 1 / overProbability : null;
  const overExpectedValue = overProbability && cornerMarket ? overProbability * cornerMarket.overOdds - 1 : null;
  const basis = [
    phase?.label ?? "賽前狀態",
    currentTotal > 0 ? `目前實際角球 ${currentHome}:${currentAway}` : "目前未有即場角球",
    elapsedMinute !== null && currentTotal > 0
      ? `按 ${fixture.liveMinuteSource ?? "外部資料庫"} 提供分鐘計算角球速度 ${(currentTotal / elapsedMinute).toFixed(2)} 球/分鐘`
      : currentTotal > 0
        ? "未有官方分鐘，不計算角球速度；目前角球只用作下限及主客分布訊號"
        : "即場速度待建立",
    hasHistory ? `歷史平均 ${(historyHome as number).toFixed(1)}:${(historyAway as number).toFixed(1)}` : "歷史樣本不足，以市場基準回歸",
    marketLine !== null ? `HKJC 全場角球盤 ${marketLine}` : "HKJC 角球盤暫缺",
    marketLine !== null && overProbability !== null
      ? `${distributionLabel} 預期角球 ${expectedTotal.toFixed(2)}，大 ${marketLine} 機率 ${Math.round(overProbability * 100)}%`
      : `${distributionLabel} 預期角球 ${expectedTotal.toFixed(2)}，角球盤不足未計算大細機率`,
    elapsedMinute !== null
      ? `Gamma–Poisson 貝葉斯更新：以賽前基準作先驗，結合第 ${elapsedMinute}' 時實際 ${currentTotal} 個角球`
      : predictiveDispersion !== null
        ? `採用歷史校準的聯賽過度離散參數 ${predictiveDispersion.toFixed(4)}`
        : "聯賽過度離散參數未校準，分布回退 Poisson",
    overFairOdds !== null && overExpectedValue !== null
      ? `大 ${marketLine} 公平賠率 ${overFairOdds.toFixed(2)}，HKJC ${cornerMarket?.overOdds.toFixed(2)}，EV ${overExpectedValue >= 0 ? "+" : ""}${(overExpectedValue * 100).toFixed(1)}%`
      : "角球盤雙邊價格不足，未計算公平賠率及 EV",
    teamMarketShare !== null
      ? `主客角球份額代理（HKJC 球隊角球盤）${Math.round(teamMarketShare * 100)}:${Math.round((1 - teamMarketShare) * 100)}`
      : "球隊角球盤不足，主客角球份額代理降權",
    goalMarket ? `戰術開放度（入球盤 ${goalMarket.line}）${goalOpennessAdjustment >= 0 ? "+" : ""}${goalOpennessAdjustment.toFixed(2)} 角球` : "入球盤不足，戰術開放度降權",
    `近期狀態/強弱壓迫 ${Math.round(tacticalHomeShare * 100)}:${Math.round((1 - tacticalHomeShare) * 100)}`,
    elapsedMinute !== null && elapsedMinute >= 45
      ? gameStateAdjustment > 0
        ? `比賽狀態提高剩餘角球率 ${Math.round(gameStateAdjustment * 100)}%`
        : gameStateAdjustment < 0
          ? `比賽狀態降低剩餘角球率 ${Math.round(Math.abs(gameStateAdjustment) * 100)}%`
          : "比賽狀態未觸發剩餘角球率調整"
      : "比賽狀態調整待下半場官方分鐘",
    liveAttackHomeShare !== null
      ? `${fixture.liveAttackingMetrics?.source ?? "外部資料庫"} 即時進攻份額 ${Math.round(liveAttackHomeShare * 100)}:${Math.round((1 - liveAttackHomeShare) * 100)}`
      : "未有完整即時進攻指標，不作進攻份額調整",
    redCardAdjustment !== 0
      ? `${fixture.livePressureMetrics?.source ?? "外部資料庫"} 紅牌壓力修正主隊角球份額 ${redCardAdjustment > 0 ? "+" : ""}${Math.round(redCardAdjustment * 100)}%`
      : "未有紅牌差，不作紅牌壓力修正；普通換人不推斷戰術角色",
    homeAttackIndex !== null && awayAttackIndex !== null
      ? `攻擊組狀態 ${Math.round(homeAttackIndex * 100)}:${Math.round(awayAttackIndex * 100)}`
      : fixture.lineup?.confirmed
        ? "陣容已確認，但缺少可用攻擊球員角色資料，不作狀態調整"
        : "未有確認陣容，攻擊球員狀態不計分",
    headToHeadGoals !== null ? `近績對碰平均入球 ${headToHeadGoals.toFixed(2)}` : "對碰樣本不足，不作調整"
  ];

  return { home, away, expectedTotal, confidence, elapsedMinute, marketLine, overProbability, underProbability, basis };
}