import { describe, expect, it } from "vitest";
import type { HistoricalFeatureRow } from "./historicalFeatureService.js";
import { fitDixonColesModel, predictDixonColes } from "./dixonColesService.js";

function match(index: number, homeGoals: number, awayGoals: number): HistoricalFeatureRow {
  return {
    key: String(index), source: "football-data.co.uk", division: "E0", league: "Test League", season: "2024-25",
    kickoffAt: `2025-01-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`, homeTeam: index % 2 ? "Alpha" : "Beta", awayTeam: index % 2 ? "Beta" : "Alpha",
    samples: { league: 30, homeTeam: 10, awayTeam: 10, homeVenue: 5, awayVenue: 5 },
    rolling: {} as HistoricalFeatureRow["rolling"],
    strengths: { homeAttack: 1, homeDefence: 1, awayAttack: 1, awayDefence: 1, expectedHomeGoals: 1.2, expectedAwayGoals: 1, eligible: true },
    odds: { opening: null, closing: null, movement: { homeProbability: null, drawProbability: null, awayProbability: null, over25Probability: null } },
    target: { homeGoals, awayGoals, result: homeGoals > awayGoals ? "home" : homeGoals < awayGoals ? "away" : "draw", totalGoals: homeGoals + awayGoals }
  };
}

describe("time-decayed Dixon-Coles model", () => {
  it("fits league-specific low-score parameters and normalized probabilities", () => {
    const rows = Array.from({ length: 20 }, (_, index) => match(index, index % 3 === 0 ? 1 : 0, 0));
    const model = fitDixonColesModel(rows, { epochs: 20, halfLifeDays: 180 });
    const parameters = model.leagues["Test League"];
    const probabilities = predictDixonColes(model, rows[0]);

    expect(parameters.trainingRows).toBe(20);
    expect(parameters.halfLifeDays).toBe(180);
    expect(parameters.rho).not.toBe(0);
    expect(Object.keys(parameters.teamParameters)).toEqual(["Alpha", "Beta"]);
    expect(probabilities.home + probabilities.draw + probabilities.away).toBeCloseTo(1, 10);
  });
});