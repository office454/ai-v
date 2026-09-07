import { describe, expect, it } from "vitest";
import type { HistoricalMatch } from "./historicalDataService.js";
import { buildLeakageSafeHistoricalFeatures } from "./historicalFeatureService.js";

function match(
  key: string,
  kickoffAt: string,
  homeTeam: string,
  awayTeam: string,
  homeGoals: number,
  awayGoals: number
): HistoricalMatch {
  return {
    key,
    source: "football-data.co.uk",
    division: "E0",
    league: "Premier League",
    season: "2025-26",
    kickoffAt,
    homeTeam,
    awayTeam,
    fullTime: { home: homeGoals, away: awayGoals },
    shots: { home: homeGoals + 10, away: awayGoals + 8, homeOnTarget: homeGoals + 3, awayOnTarget: awayGoals + 2 },
    corners: { home: homeGoals + 4, away: awayGoals + 3 }
  };
}

describe("buildLeakageSafeHistoricalFeatures", () => {
  it("uses only matches completed before the current kickoff", () => {
    const first = match("first", "2025-08-01T12:00:00.000Z", "A", "B", 2, 0);
    const current = match("current", "2025-08-08T12:00:00.000Z", "A", "C", 0, 4);
    const changedCurrent = match("current", "2025-08-08T12:00:00.000Z", "A", "C", 9, 9);

    const originalFeatures = buildLeakageSafeHistoricalFeatures([first, current]);
    const changedFeatures = buildLeakageSafeHistoricalFeatures([first, changedCurrent]);
    const { target: originalTarget, ...originalCurrent } = originalFeatures[1];
    const { target: changedTarget, ...changedCurrentFeature } = changedFeatures[1];

    expect(originalCurrent).toEqual(changedCurrentFeature);
    expect(originalTarget).not.toEqual(changedTarget);
    expect(originalCurrent.rolling.home.recent5.pointsPerMatch).toBe(3);
    expect(originalCurrent.rolling.home.recent5.goalsFor).toBe(2);
    expect(originalCurrent.rolling.home.recent5.shotsFor).toBe(12);
    expect(originalCurrent.rolling.home.recent5.cornersFor).toBe(6);
  });

  it("does not let simultaneous fixtures update one another", () => {
    const kickoffAt = "2025-08-01T14:00:00.000Z";
    const features = buildLeakageSafeHistoricalFeatures([
      match("one", kickoffAt, "A", "B", 3, 0),
      match("two", kickoffAt, "C", "D", 1, 1)
    ]);

    expect(features[0].samples.league).toBe(0);
    expect(features[1].samples.league).toBe(0);
  });

  it("derives de-vigged pre-match odds movement without using the result", () => {
    const fixture = match("odds", "2025-08-01T12:00:00.000Z", "A", "B", 1, 0);
    fixture.odds = {
      opening: { home: 2, draw: 4, away: 4, over25: 2, under25: 2, provider: "open" },
      closing: { home: 1.5, draw: 6, away: 6, over25: 1.8, under25: 2.2, provider: "close" }
    };

    const [feature] = buildLeakageSafeHistoricalFeatures([fixture]);

    expect(feature.odds.opening?.home).toBe(0.5);
    expect(feature.odds.opening?.decimalHome).toBe(2);
    expect(feature.odds.closing?.home).toBeCloseTo(2 / 3, 6);
    expect(feature.odds.closing?.decimalAway).toBe(6);
    expect(feature.odds.movement.homeProbability).toBeCloseTo(1 / 6, 5);
    expect(feature.odds.movement.awayProbability).toBeLessThan(0);
  });

  it("gates Poisson expectations until league and venue samples are sufficient", () => {
    const records: HistoricalMatch[] = [];
    for (let week = 0; week < 4; week += 1) {
      records.push(match(`ab-${week}`, `2025-08-${String(week + 1).padStart(2, "0")}T12:00:00.000Z`, "A", "B", 2, 1));
      records.push(match(`cd-${week}`, `2025-08-${String(week + 1).padStart(2, "0")}T15:00:00.000Z`, "C", "D", 1, 1));
    }
    records.push(match("eligible", "2025-08-10T12:00:00.000Z", "A", "B", 0, 0));

    const features = buildLeakageSafeHistoricalFeatures(records, {
      minLeagueMatches: 4,
      minVenueMatches: 3,
      priorMatches: 3
    });
    const eligible = features.find((feature) => feature.key === "eligible")!;

    expect(features[0].strengths.expectedHomeGoals).toBeNull();
    expect(eligible.strengths.eligible).toBe(true);
    expect(eligible.strengths.expectedHomeGoals).toBeGreaterThan(0);
    expect(eligible.samples.league).toBe(8);
  });
});