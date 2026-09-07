import { describe, expect, it } from "vitest";
import type { HistoricalFeatureRow } from "./historicalFeatureService.js";
import {
  evaluateHistoricalWalkForward,
  summarizeHistoricalPredictions
} from "./historicalBenchmarkService.js";

function row(index: number, season: string): HistoricalFeatureRow {
  const result = (["home", "draw", "away"] as const)[index % 3];
  const homeGoals = result === "home" ? 2 : result === "draw" ? 1 : 0;
  const awayGoals = result === "away" ? 2 : result === "draw" ? 1 : 0;
  const market = {
    provider: "test",
    decimalHome: 2.4,
    decimalDraw: 3.2,
    decimalAway: 3.1,
    home: 0.4,
    draw: 0.3,
    away: 0.3,
    overround: 1.05,
    over25: 0.5,
    under25: 0.5
  };
  const metrics = {
    matches: 5,
    pointsPerMatch: result === "home" ? 2 : 1,
    goalsFor: result === "home" ? 1.8 : 1,
    goalsAgainst: result === "away" ? 1.8 : 1,
    shotsMatches: 5,
    shotsFor: result === "home" ? 14 : 10,
    shotsAgainst: 9,
    shotsOnTargetFor: result === "home" ? 6 : 3,
    shotsOnTargetAgainst: 3,
    cornerMatches: 5,
    cornersFor: result === "home" ? 6 : 4,
    cornersAgainst: 4
  };
  return {
    key: `${season}-${index}`,
    source: "football-data.co.uk",
    division: "E0",
    league: "Premier League",
    season,
    kickoffAt: `${season.slice(0, 4)}-08-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
    homeTeam: `Home ${index}`,
    awayTeam: `Away ${index}`,
    samples: { league: 100, homeTeam: 10, awayTeam: 10, homeVenue: 5, awayVenue: 5 },
    rolling: {
      league: { matches: 100, homeGoals: 1.5, awayGoals: 1.2, homeShots: 12, awayShots: 10, homeCorners: 5.5, awayCorners: 4.5 },
      home: { recent5: metrics, recent10: metrics, home10: metrics },
      away: { recent5: { ...metrics, pointsPerMatch: 1 }, recent10: metrics, away10: metrics }
    },
    strengths: {
      homeAttack: 1.1,
      homeDefence: 0.9,
      awayAttack: 0.9,
      awayDefence: 1.1,
      expectedHomeGoals: result === "home" ? 2 : 1,
      expectedAwayGoals: result === "away" ? 2 : 1,
      eligible: true
    },
    odds: {
      opening: market,
      closing: market,
      movement: { homeProbability: 0, drawProbability: 0, awayProbability: 0, over25Probability: 0 }
    },
    target: { homeGoals, awayGoals, result, totalGoals: homeGoals + awayGoals }
  };
}

describe("historical walk-forward benchmark", () => {
  it("calculates RPS, calibration, hit rate and flat-stake ROI", () => {
    const metrics = summarizeHistoricalPredictions([
      { probabilities: { home: 0.8, draw: 0.1, away: 0.1 }, actual: "home", odds: { home: 2, draw: 4, away: 4 } },
      { probabilities: { home: 0.1, draw: 0.2, away: 0.7 }, actual: "away", odds: { home: 2, draw: 4, away: 2 } }
    ], { minOdds: 2, minExpectedValue: 0 });

    expect(metrics.predictions).toBe(2);
    expect(metrics.hitRate).toBe(1);
    expect(metrics.bets).toBe(2);
    expect(metrics.roi).toBe(1);
    expect(metrics.meanRps).toBeGreaterThan(0);
    expect(metrics.ece).toBeCloseTo(0.25, 6);
  });

  it("reports deterministic ROI uncertainty and chronological maximum drawdown", () => {
    const observations = Array.from({ length: 40 }, (_, index) => ({
      probabilities: { home: 0.8, draw: 0.1, away: 0.1 },
      actual: index < 20 ? "away" as const : "home" as const,
      odds: { home: 2, draw: 4, away: 4 },
      kickoffAt: `2025-${String(Math.floor(index / 4) + 1).padStart(2, "0")}-01T12:00:00.000Z`
    }));

    const first = summarizeHistoricalPredictions(observations, { minOdds: 2, minExpectedValue: 0 });
    const second = summarizeHistoricalPredictions(observations, { minOdds: 2, minExpectedValue: 0 });

    expect(first.roiCi95).not.toBeNull();
    expect(first.roiCi95).toEqual(second.roiCi95);
    expect(first.maxDrawdown).toBe(20);
  });

  it("uses only earlier seasons to train each ML fold", () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, index) => row(index, "2021-22")),
      ...Array.from({ length: 6 }, (_, index) => row(index, "2022-23")),
      ...Array.from({ length: 6 }, (_, index) => row(index, "2023-24"))
    ];
    const report = evaluateHistoricalWalkForward(rows, {
      minTrainingRows: 3,
      epochs: 2,
      thresholdCandidates: [0.02, 0.08],
      thresholdMinBets: 1
    });

    expect(report.folds.map((fold) => fold.testSeason)).toEqual(["2022-23", "2023-24"]);
    expect(report.folds[0].trainSeasons).toEqual(["2021-22"]);
    expect(report.folds[1].trainSeasons).toEqual(["2021-22", "2022-23"]);
    expect(report.evaluatedRows).toBe(12);
    expect(report.trainingOnlyRows).toBe(6);
    expect(report.aggregate.opening_market.predictions).toBe(12);
    expect(report.aggregate.closing_market.predictions).toBe(12);
    expect(report.aggregate.closing_market.bets).toBe(0);
    expect(report.folds.every((fold) => fold.thresholdSelection.closing_market.active === false)).toBe(true);
    expect(report.aggregate.dixon_coles_challenger.predictions).toBe(12);
    expect(report.challengerPolicy).toMatchObject({ mode: "shadow", productionEnabled: false });
    expect(report.folds[0].dixonColesLeagueParameters["Premier League"].trainingRows).toBe(6);
    expect(report.folds[0].dixonColesLeagueParameters["Premier League"].fittedThrough < rows[6].kickoffAt).toBe(true);
    expect(report.aggregate.ml_logistic.predictions).toBe(12);
    expect([0.02, 0.08, null]).toContain(report.folds[0].thresholdSelection.ml_logistic.selected);
    expect(report.folds[0].thresholdSelection.ml_logistic.validationRows).toBeGreaterThan(0);
    expect(report.breakdowns.bySeason["2022-23"].poisson?.predictions).toBe(6);
    expect(report.breakdowns.byLeague["Premier League"].current_model?.predictions).toBe(12);
    expect(Object.keys(report.breakdowns.bySelectedOdds).length).toBeGreaterThan(0);
  });
});