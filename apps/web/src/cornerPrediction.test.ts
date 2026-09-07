import { describe, expect, it } from "vitest";
import { calculateCornerPrediction, type CornerPredictionFixture } from "./cornerPrediction";

const NOW = Date.parse("2026-08-22T03:00:00.000Z");

function liveFixture(overrides: Partial<CornerPredictionFixture> = {}): CornerPredictionFixture {
  return {
    kickoffAt: "2026-08-22T01:45:00.000Z",
    status: "SECONDHALF",
    finalScore: { home: 1, away: 0 },
    finalCorners: { home: 2, away: 1, total: 3 },
    homeAverageCorners: 5.2,
    awayAverageCorners: 4.4,
    cornerHistorySampleSize: { home: 5, away: 5 },
    homeStrength: "strong",
    awayStrength: "average",
    homeRecentPoints: 9,
    awayRecentPoints: 6,
    marketOptions: [{
      oddsType: "CHL",
      selectionName: "大",
      lineCondition: "[9.5/10.0]",
      currentOdds: 1.9,
      inplay: true,
      poolStatus: "SELLINGSTARTED",
      combinationStatus: "AVAILABLE"
    }, {
      oddsType: "CHL",
      selectionName: "細",
      lineCondition: "[9.5/10.0]",
      currentOdds: 1.9,
      inplay: true,
      poolStatus: "SELLINGSTARTED",
      combinationStatus: "AVAILABLE"
    }],
    ...overrides
  };
}

describe("calculateCornerPrediction", () => {
  it("reports attacking form when confirmed lineups include midfielders and forwards", () => {
    const prediction = calculateCornerPrediction(liveFixture({
      lineup: {
        confirmed: true,
        home: [{ role: "MF", fitness: 75, recentForm: 75 }],
        away: [{ role: "FW", fitness: 75, recentForm: 75 }]
      }
    }), NOW);

    expect(prediction.basis).toContain("攻擊組狀態 75:75");
    expect(prediction.basis.some((item) => item.includes("未有確認陣容"))).toBe(false);
  });

  it("does not derive live corner pace from a guessed second-half minute", () => {
    const prediction = calculateCornerPrediction(liveFixture(), NOW);

    expect(prediction.elapsedMinute).toBeNull();
    expect(prediction.marketLine).toBe(9.75);
    expect(prediction.home + prediction.away).toBeLessThanOrEqual(10);
    expect(prediction.basis).toEqual(expect.arrayContaining([
      "下半場進行中（HKJC 及外部資料庫未提供官方分鐘）",
      "目前實際角球 2:1",
      "歷史平均 5.2:4.4",
      "HKJC 全場角球盤 9.75"
    ]));
    expect(prediction.basis).toContain("未有官方分鐘，不計算角球速度；目前角球只用作下限及主客分布訊號");
    expect(prediction.basis.join(" ")).not.toContain("角球速度 0.04");
    expect(prediction.basis.join(" ")).not.toMatch(/賽事第 \d+ 分鐘/);
    expect(prediction.basis.some((item) => item.startsWith("近期狀態/強弱壓迫"))).toBe(true);
  });

  it("uses an externally sourced official minute instead of a phase estimate", () => {
    const prediction = calculateCornerPrediction(liveFixture({
      liveMinute: 67,
      liveMinuteSource: "TheSportsDB"
    }), NOW);

    expect(prediction.basis).toContain("比賽第 67'（TheSportsDB）");
    expect(prediction.basis.some((item) => item.startsWith("按 TheSportsDB 提供分鐘計算角球速度"))).toBe(true);
    expect(prediction.basis.join(" ")).not.toContain("未提供官方分鐘");
    expect(prediction.elapsedMinute).toBe(67);
    expect(prediction.basis.some((item) => item.startsWith("Gamma–Poisson 貝葉斯更新"))).toBe(true);
  });

  it("returns Poisson over and under probabilities for the HKJC corner line", () => {
    const prediction = calculateCornerPrediction(liveFixture({
      status: "PREEVENT",
      finalCorners: undefined
    }), NOW);

    expect(prediction.expectedTotal).toBeGreaterThan(0);
    expect(prediction.overProbability).not.toBeNull();
    expect(prediction.underProbability).not.toBeNull();
    expect((prediction.overProbability ?? 0) + (prediction.underProbability ?? 0)).toBeCloseTo(1, 10);
    expect(prediction.basis.some((item) => item.startsWith("Poisson 預期角球"))).toBe(true);
    expect(prediction.basis.some((item) => item.includes("公平賠率") && item.includes("EV"))).toBe(true);
  });

  it("uses a calibrated Negative Binomial distribution for a supported league", () => {
    const prediction = calculateCornerPrediction(liveFixture({
      league: "意大利甲組聯賽",
      status: "PREEVENT",
      finalCorners: undefined
    }), NOW);

    expect(prediction.basis.some((item) => item.startsWith("負二項 預期角球"))).toBe(true);
    expect(prediction.basis).toContain("採用歷史校準的聯賽過度離散參數 0.0240");
  });

  it("applies a bounded red-card pressure adjustment without inventing substitution roles", () => {
    const prediction = calculateCornerPrediction(liveFixture({
      livePressureMetrics: {
        source: "FotMob",
        redCards: { home: 0, away: 1 },
        substitutions: { home: 2, away: 3 }
      }
    }), NOW);

    expect(prediction.basis).toContain("FotMob 紅牌壓力修正主隊角球份額 +8%");
    expect(prediction.basis.join(" ")).not.toContain("高中鋒");
  });

  it("raises remaining corner expectation when the stronger team trails after half-time", () => {
    const common = {
      liveMinute: 67,
      liveMinuteSource: "FotMob",
      finalCorners: { home: 3, away: 3, total: 6 },
      homeStrength: "elite" as const,
      awayStrength: "weak" as const
    };
    const trailing = calculateCornerPrediction(liveFixture({
      ...common,
      finalScore: { home: 0, away: 1 }
    }), NOW);
    const level = calculateCornerPrediction(liveFixture({
      ...common,
      finalScore: { home: 1, away: 1 }
    }), NOW);

    expect(trailing.expectedTotal).toBeGreaterThan(level.expectedTotal);
    expect(trailing.basis).toContain("比賽狀態提高剩餘角球率 12%");
  });

  it("uses verified live attacking metrics as a bounded directional signal", () => {
    const prediction = calculateCornerPrediction(liveFixture({
      status: "FIRSTHALF",
      liveMinute: 30,
      liveMinuteSource: "FotMob",
      finalCorners: { home: 2, away: 2, total: 4 },
      homeStrength: "average",
      awayStrength: "average",
      homeRecentPoints: 7,
      awayRecentPoints: 7,
      liveAttackingMetrics: {
        source: "FotMob",
        possession: { home: 60, away: 40 },
        finalThirdEntries: { home: 48, away: 20 },
        accurateCrosses: { home: 9, away: 2 }
      }
    }), NOW);

    expect(prediction.home).toBeGreaterThan(prediction.away);
    expect(prediction.basis.some((item) => item.startsWith("FotMob 即時進攻份額"))).toBe(true);
  });

  it("reduces remaining corner expectation when the stronger team leads by two", () => {
    const common = {
      liveMinute: 67,
      liveMinuteSource: "FotMob",
      finalCorners: { home: 3, away: 3, total: 6 },
      homeStrength: "elite" as const,
      awayStrength: "weak" as const
    };
    const leading = calculateCornerPrediction(liveFixture({
      ...common,
      finalScore: { home: 2, away: 0 }
    }), NOW);
    const level = calculateCornerPrediction(liveFixture({
      ...common,
      finalScore: { home: 1, away: 1 }
    }), NOW);

    expect(leading.expectedTotal).toBeLessThan(level.expectedTotal);
    expect(leading.basis).toContain("比賽狀態降低剩餘角球率 10%");
  });

  it("never predicts fewer corners than have already occurred", () => {
    const prediction = calculateCornerPrediction(liveFixture({
      finalCorners: { home: 7, away: 5, total: 12 }
    }), NOW);

    expect(prediction.home).toBeGreaterThanOrEqual(7);
    expect(prediction.away).toBeGreaterThanOrEqual(5);
  });

  it("returns actual corners for a finished fixture", () => {
    const prediction = calculateCornerPrediction(liveFixture({
      status: "FINISHED",
      finalCorners: { home: 4, away: 3, total: 7 }
    }), NOW);

    expect(prediction).toMatchObject({ home: 4, away: 3, confidence: 100, elapsedMinute: null });
  });

  it("selects the balanced main line instead of the median alternate line", () => {
    const prediction = calculateCornerPrediction(liveFixture({
      status: "PREEVENT",
      finalCorners: undefined,
      homeAverageCorners: undefined,
      awayAverageCorners: undefined,
      cornerHistorySampleSize: undefined,
      marketOptions: [
        { oddsType: "CHL", selectionName: "大", lineCondition: "9.5", currentOdds: 1.87, inplay: false, poolStatus: "SELLINGSTARTED", combinationStatus: "AVAILABLE" },
        { oddsType: "CHL", selectionName: "細", lineCondition: "9.5", currentOdds: 1.83, inplay: false, poolStatus: "SELLINGSTARTED", combinationStatus: "AVAILABLE" },
        { oddsType: "CHL", selectionName: "大", lineCondition: "10.5", currentOdds: 2.33, inplay: false, poolStatus: "SELLINGSTARTED", combinationStatus: "AVAILABLE" },
        { oddsType: "CHL", selectionName: "細", lineCondition: "10.5", currentOdds: 1.53, inplay: false, poolStatus: "SELLINGSTARTED", combinationStatus: "AVAILABLE" },
        { oddsType: "CHL", selectionName: "大", lineCondition: "13.5", currentOdds: 4.75, inplay: false, poolStatus: "SELLINGSTARTED", combinationStatus: "AVAILABLE" },
        { oddsType: "CHL", selectionName: "細", lineCondition: "13.5", currentOdds: 1.13, inplay: false, poolStatus: "SELLINGSTARTED", combinationStatus: "AVAILABLE" }
      ]
    }), NOW);

    expect(prediction.marketLine).toBe(9.5);
    expect(prediction.home + prediction.away).toBe(9);
  });

  it("moves below a half-line when the no-vig market favors under", () => {
    const prediction = calculateCornerPrediction(liveFixture({
      status: "PREEVENT",
      finalCorners: undefined,
      homeAverageCorners: undefined,
      awayAverageCorners: undefined,
      cornerHistorySampleSize: undefined,
      marketOptions: [
        { oddsType: "CHL", selectionName: "大", lineCondition: "10.5", currentOdds: 2.17, inplay: false, poolStatus: "SELLINGSTARTED", combinationStatus: "AVAILABLE" },
        { oddsType: "CHL", selectionName: "細", lineCondition: "10.5", currentOdds: 1.61, inplay: false, poolStatus: "SELLINGSTARTED", combinationStatus: "AVAILABLE" },
        { oddsType: "CHL", selectionName: "大", lineCondition: "13.5", currentOdds: 4.3, inplay: false, poolStatus: "SELLINGSTARTED", combinationStatus: "AVAILABLE" },
        { oddsType: "CHL", selectionName: "細", lineCondition: "13.5", currentOdds: 1.16, inplay: false, poolStatus: "SELLINGSTARTED", combinationStatus: "AVAILABLE" }
      ]
    }), NOW);

    expect(prediction.marketLine).toBe(10.5);
    expect(prediction.home + prediction.away).toBe(10);
  });

  it("uses team corner lines as attacking-hotspot evidence", () => {
    const prediction = calculateCornerPrediction(liveFixture({
      status: "PREEVENT",
      finalCorners: undefined,
      homeAverageCorners: undefined,
      awayAverageCorners: undefined,
      cornerHistorySampleSize: undefined,
      homeStrength: "average",
      awayStrength: "average",
      homeRecentPoints: 7,
      awayRecentPoints: 7,
      marketOptions: [
        { oddsType: "CHL", selectionName: "大", lineCondition: "9.5", currentOdds: 1.85, inplay: false, poolStatus: "SELLINGSTARTED", combinationStatus: "AVAILABLE" },
        { oddsType: "CHL", selectionName: "細", lineCondition: "9.5", currentOdds: 1.85, inplay: false, poolStatus: "SELLINGSTARTED", combinationStatus: "AVAILABLE" },
        { oddsType: "CHH", selectionName: "大", lineCondition: "3.5", currentOdds: 1.85, inplay: false, poolStatus: "SELLINGSTARTED", combinationStatus: "AVAILABLE" },
        { oddsType: "CHH", selectionName: "細", lineCondition: "3.5", currentOdds: 1.85, inplay: false, poolStatus: "SELLINGSTARTED", combinationStatus: "AVAILABLE" },
        { oddsType: "CHA", selectionName: "大", lineCondition: "5.5", currentOdds: 1.85, inplay: false, poolStatus: "SELLINGSTARTED", combinationStatus: "AVAILABLE" },
        { oddsType: "CHA", selectionName: "細", lineCondition: "5.5", currentOdds: 1.85, inplay: false, poolStatus: "SELLINGSTARTED", combinationStatus: "AVAILABLE" }
      ]
    }), NOW);

    expect(prediction.away).toBeGreaterThan(prediction.home);
    expect(prediction.basis.some((item) => item.startsWith("主客角球份額代理（HKJC 球隊角球盤）"))).toBe(true);
  });

  it("raises the total for a more open tactical goal market", () => {
    const marketOptions = (goalLine: string): CornerPredictionFixture["marketOptions"] => [
      { oddsType: "CHL", selectionName: "大", lineCondition: "9.5", currentOdds: 1.85, inplay: false, poolStatus: "SELLINGSTARTED", combinationStatus: "AVAILABLE" },
      { oddsType: "CHL", selectionName: "細", lineCondition: "9.5", currentOdds: 1.85, inplay: false, poolStatus: "SELLINGSTARTED", combinationStatus: "AVAILABLE" },
      { oddsType: "HIL", selectionName: "大", lineCondition: goalLine, currentOdds: 1.85, inplay: false, poolStatus: "SELLINGSTARTED", combinationStatus: "AVAILABLE" },
      { oddsType: "HIL", selectionName: "細", lineCondition: goalLine, currentOdds: 1.85, inplay: false, poolStatus: "SELLINGSTARTED", combinationStatus: "AVAILABLE" }
    ];
    const common = {
      status: "PREEVENT",
      finalCorners: undefined,
      homeAverageCorners: undefined,
      awayAverageCorners: undefined,
      cornerHistorySampleSize: undefined
    };
    const open = calculateCornerPrediction(liveFixture({ ...common, marketOptions: marketOptions("3.5") }), NOW);
    const closed = calculateCornerPrediction(liveFixture({ ...common, marketOptions: marketOptions("1.5") }), NOW);

    expect(open.home + open.away).toBeGreaterThan(closed.home + closed.away);
    expect(open.basis.some((item) => item.includes("戰術開放度（入球盤 3.5）"))).toBe(true);
  });
});