import { describe, expect, it } from "vitest";
import { MockProvider } from "../providers/mockProvider.js";
import {
  isHighOddsRecommendation,
  normalizeWeights,
  pickTopRecommendationsWithWeights,
  scoreFixture
} from "./scoring.js";

describe("pickTopRecommendations", () => {
  it("returns sorted positive value picks", async () => {
    const provider = new MockProvider();
    const fixtures = await provider.fetchTodayFixtures();
    const picks = pickTopRecommendationsWithWeights(fixtures, {}, fixtures.length);

    expect(picks.length).toBeGreaterThan(0);
    expect(picks.every((p) => p.currentOdds >= 1.4)).toBe(true);
    expect(picks.every((p) => p.selectionName.length > 0)).toBe(true);
    expect(picks[0].valueScore).toBeGreaterThanOrEqual(picks[picks.length - 1].valueScore);
  });

  it("normalizes custom weights", () => {
    const normalized = normalizeWeights({ strengthGap: 2, recentForm: 2, lineupFitness: 2 });
    const sum =
      normalized.strengthGap +
      normalized.recentForm +
      normalized.lineupFitness +
      normalized.expertSentiment +
      normalized.oddsMomentum;

    expect(sum).toBeCloseTo(1, 10);
  });

  it("boosts confidence when lineup is confirmed and market odds shorten", () => {
    const fixture = {
      id: "fx-boost",
      league: "測試聯賽",
      kickoffAt: new Date().toISOString(),
      homeTeam: "A隊",
      awayTeam: "B隊",
      homeStrength: "strong" as const,
      awayStrength: "average" as const,
      homeRecentPoints: 10,
      awayRecentPoints: 4,
      expertSentiment: 0.2,
      lineup: {
        confirmed: true,
        updatedAt: new Date().toISOString(),
        home: [{ name: "前鋒", role: "ST", fitness: 84, recentForm: 82 }],
        away: [{ name: "後衛", role: "DF", fitness: 70, recentForm: 72 }]
      },
      oddsHistory: [
        { at: "t0", homeWin: 3.6, draw: 3.7, awayWin: 4.0 },
        { at: "t1", homeWin: 2.8, draw: 3.2, awayWin: 3.5 }
      ],
      marketOptions: [
        {
          oddsType: "HDC",
          oddsTypeName: "讓球",
          selectionCode: "H",
          selectionName: "主勝",
          lineCondition: "-0.5",
          currentOdds: 2.05,
          inplay: false,
          poolStatus: "Sell",
          combinationStatus: "Sell",
          updatedAt: new Date().toISOString()
        }
      ]
    };

    const confirmedRecommendation = scoreFixture(fixture as any, {}, { minRecommendedOdds: 1.4, highOddsThreshold: 2.2 });
    const unconfirmedRecommendation = scoreFixture(
      {
        ...fixture,
        lineup: { ...fixture.lineup, confirmed: false }
      } as any,
      {},
      { minRecommendedOdds: 1.4, highOddsThreshold: 2.2 }
    );

    expect(confirmedRecommendation.confidence).toBeGreaterThan(unconfirmedRecommendation.confidence);
  });

  it("weights recent head-to-head and home-away form advantage", () => {
    const baseFixture = {
      id: "fx-h2h",
      league: "測試聯賽",
      kickoffAt: new Date().toISOString(),
      homeTeam: "A隊",
      awayTeam: "B隊",
      homeStrength: "strong" as const,
      awayStrength: "weak" as const,
      homeRecentPoints: 8,
      awayRecentPoints: 2,
      expertSentiment: 0.2,
      lineup: {
        confirmed: true,
        updatedAt: new Date().toISOString(),
        home: [{ name: "前鋒", role: "ST", fitness: 90, recentForm: 88 }],
        away: [{ name: "後衛", role: "DF", fitness: 65, recentForm: 60 }]
      },
      oddsHistory: [
        { at: "t0", homeWin: 2.7, draw: 3.2, awayWin: 4.0 },
        { at: "t1", homeWin: 2.3, draw: 3.0, awayWin: 3.6 }
      ],
      marketOptions: [
        {
          oddsType: "HDC",
          oddsTypeName: "讓球",
          selectionCode: "H",
          selectionName: "主勝",
          lineCondition: "-0.5",
          currentOdds: 2.05,
          inplay: false,
          poolStatus: "Sell",
          combinationStatus: "Sell",
          updatedAt: new Date().toISOString()
        }
      ]
    };

    const positiveEdge = scoreFixture(
      {
        ...baseFixture,
        recentHeadToHead: [{ homeGoals: 3, awayGoals: 0, result: "home" as const, venue: "home" as const }],
        homeVenueForm: 0.12,
        awayVenueForm: -0.08
      } as any,
      {},
      { minRecommendedOdds: 1.4, highOddsThreshold: 2.2 }
    );
    const negativeEdge = scoreFixture(
      {
        ...baseFixture,
        recentHeadToHead: [{ homeGoals: 0, awayGoals: 2, result: "away" as const, venue: "away" as const }],
        homeVenueForm: -0.1,
        awayVenueForm: 0.12
      } as any,
      {},
      { minRecommendedOdds: 1.4, highOddsThreshold: 2.2 }
    );

    expect(positiveEdge.confidence).toBeGreaterThan(negativeEdge.confidence);
  });

  it("uses distinct signal handling for half-time markets", () => {
    const fixture = {
      id: "fx-half",
      league: "測試聯賽",
      kickoffAt: new Date().toISOString(),
      homeTeam: "A隊",
      awayTeam: "B隊",
      homeStrength: "strong" as const,
      awayStrength: "average" as const,
      homeRecentPoints: 8,
      awayRecentPoints: 5,
      expertSentiment: 0.2,
      lineup: {
        confirmed: true,
        updatedAt: new Date().toISOString(),
        home: [{ name: "前鋒", role: "ST", fitness: 88, recentForm: 86 }],
        away: [{ name: "後衛", role: "DF", fitness: 74, recentForm: 72 }]
      },
      oddsHistory: [
        { at: "t0", homeWin: 3.0, draw: 3.1, awayWin: 3.3 },
        { at: "t1", homeWin: 2.3, draw: 2.7, awayWin: 3.0 }
      ],
      marketOptions: [
        {
          oddsType: "HDC",
          oddsTypeName: "讓球",
          selectionCode: "H",
          selectionName: "主勝",
          lineCondition: "-0.5",
          currentOdds: 2.05,
          inplay: false,
          poolStatus: "Sell",
          combinationStatus: "Sell",
          updatedAt: new Date().toISOString()
        },
        {
          oddsType: "EHL",
          oddsTypeName: "半場入球大細",
          selectionCode: "O",
          selectionName: "大",
          lineCondition: "2.5",
          currentOdds: 2.1,
          inplay: false,
          poolStatus: "Sell",
          combinationStatus: "Sell",
          updatedAt: new Date().toISOString()
        }
      ]
    };

    const fullTimeRecommendation = scoreFixture(
      {
        ...fixture,
        marketOptions: fixture.marketOptions.filter((option: any) => option.oddsType === "HDC")
      } as any,
      {},
      { minRecommendedOdds: 1.4, highOddsThreshold: 2.2 }
    );
    const halfTimeRecommendation = scoreFixture(
      {
        ...fixture,
        marketOptions: fixture.marketOptions.filter((option: any) => option.oddsType === "EHL")
      } as any,
      {},
      { minRecommendedOdds: 1.4, highOddsThreshold: 2.2 }
    );

    expect(halfTimeRecommendation.confidence).toBeGreaterThan(fullTimeRecommendation.confidence);
  });

  it("generates a richer reason narrative for recommendations", () => {
    const recommendation = scoreFixture(
      {
        id: "fx-reason",
        league: "測試聯賽",
        kickoffAt: new Date().toISOString(),
        homeTeam: "A隊",
        awayTeam: "B隊",
        homeStrength: "strong" as const,
        awayStrength: "average" as const,
        homeRecentPoints: 10,
        awayRecentPoints: 4,
        expertSentiment: 0.2,
        lineup: {
          confirmed: true,
          updatedAt: new Date().toISOString(),
          home: [{ name: "前鋒", role: "ST", fitness: 86, recentForm: 84 }],
          away: [{ name: "後衛", role: "DF", fitness: 74, recentForm: 70 }]
        },
        oddsHistory: [
          { at: "t0", homeWin: 2.8, draw: 3.1, awayWin: 3.6 },
          { at: "t1", homeWin: 2.4, draw: 2.9, awayWin: 3.2 }
        ],
        marketOptions: [
          {
            oddsType: "HDC",
            oddsTypeName: "讓球",
            selectionCode: "H",
            selectionName: "主勝",
            lineCondition: "-0.5",
            currentOdds: 2.05,
            inplay: false,
            poolStatus: "Sell",
            combinationStatus: "Sell",
            updatedAt: new Date().toISOString()
          }
        ],
        recentHeadToHead: [{ homeGoals: 2, awayGoals: 0, result: "home", venue: "home" }],
        homeVenueForm: 0.1,
        awayVenueForm: -0.05
      } as any,
      {},
      { minRecommendedOdds: 1.4, highOddsThreshold: 2.2 }
    );

    expect(recommendation.reason).toContain("全場市場");
    expect(recommendation.reason).toContain("近期對賽有利");
  });

  it("classifies highOdds as high odds and worth trying", () => {
    expect(
      isHighOddsRecommendation(
        {
          fixtureId: "fx-1",
          match: "A vs B",
          kickoffAt: new Date().toISOString(),
          market: "主客和",
          selectionName: "主勝",
          currentOdds: 1.41,
          confidence: 78.9,
          edgeScore: 9.4,
          valueScore: 0.132,
          recommendationGroup: "focus",
          halfTimeScorePrediction: "0-0",
          fullTimeScorePrediction: "1-0",
          reason: "test",
          lastUpdatedAt: new Date().toISOString()
        },
        {
          minRecommendedOdds: 1.4,
          highOddsThreshold: 2.2
        }
      )
    ).toBe(false);

    expect(
      isHighOddsRecommendation(
        {
          fixtureId: "fx-2",
          match: "A vs B",
          kickoffAt: new Date().toISOString(),
          market: "主客和",
          selectionName: "主勝",
          currentOdds: 2.35,
          confidence: 52,
          edgeScore: 3.2,
          valueScore: 0.09,
          recommendationGroup: "highOdds",
          halfTimeScorePrediction: "1-0",
          fullTimeScorePrediction: "2-1",
          reason: "test",
          lastUpdatedAt: new Date().toISOString()
        },
        {
          minRecommendedOdds: 1.4,
          highOddsThreshold: 2.2
        }
      )
    ).toBe(true);

    expect(
      isHighOddsRecommendation(
        {
          fixtureId: "fx-3",
          match: "A vs B",
          kickoffAt: new Date().toISOString(),
          market: "主客和",
          selectionName: "主勝",
          currentOdds: 2.35,
          confidence: 66,
          edgeScore: -0.8,
          valueScore: -0.03,
          recommendationGroup: "highOdds",
          halfTimeScorePrediction: "0-1",
          fullTimeScorePrediction: "0-2",
          reason: "test",
          lastUpdatedAt: new Date().toISOString()
        },
        {
          minRecommendedOdds: 1.4,
          highOddsThreshold: 2.2
        }
      )
    ).toBe(false);
  });
});
