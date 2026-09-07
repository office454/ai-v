import { describe, expect, it } from "vitest";
import { MockProvider } from "../providers/mockProvider.js";
import {
  isHighOddsRecommendation,
  normalizeWeights,
  pickTopRecommendationsWithWeights,
  poissonOutcomeProbabilities,
  scoreFixtureHADProbabilities,
  scoreFixture
} from "./scoring.js";

describe("poissonOutcomeProbabilities", () => {
  it("returns a normalized symmetric distribution for equal expected goals", () => {
    const probabilities = poissonOutcomeProbabilities(1.35, 1.35);

    expect(probabilities.home + probabilities.draw + probabilities.away).toBeCloseTo(1, 10);
    expect(probabilities.home).toBeCloseTo(probabilities.away, 10);
    expect(probabilities.draw).toBeGreaterThan(0.2);
  });

  it("moves probability toward the team with the stronger scoring expectation", () => {
    const homeFavored = poissonOutcomeProbabilities(2.1, 0.7);
    const awayFavored = poissonOutcomeProbabilities(0.7, 2.1);

    expect(homeFavored.home).toBeGreaterThan(0.65);
    expect(homeFavored.home).toBeCloseTo(awayFavored.away, 10);
  });
});

describe("scoreFixtureHADProbabilities", () => {
  it("returns the same normalized production distribution regardless of HAD option order", () => {
    const fixture = {
      id: "fx-had-vector",
      league: "測試聯賽",
      kickoffAt: "2025-08-01T12:00:00.000Z",
      homeTeam: "A",
      awayTeam: "B",
      homeStrength: "strong" as const,
      awayStrength: "average" as const,
      homeRecentPoints: 10,
      awayRecentPoints: 5,
      expertSentiment: 0.5,
      lineup: { confirmed: false, updatedAt: "2025-08-01T10:00:00.000Z", home: [], away: [] },
      oddsHistory: [{ at: "open", homeWin: 2, draw: 3.4, awayWin: 4 }],
      marketOptions: [
        { oddsType: "HAD", oddsTypeName: "主客和", selectionCode: "H", selectionName: "主隊勝", lineCondition: "n/a", currentOdds: 2, inplay: false, poolStatus: "Sell", combinationStatus: "Sell", updatedAt: "now" },
        { oddsType: "HAD", oddsTypeName: "主客和", selectionCode: "D", selectionName: "和局", lineCondition: "n/a", currentOdds: 3.4, inplay: false, poolStatus: "Sell", combinationStatus: "Sell", updatedAt: "now" },
        { oddsType: "HAD", oddsTypeName: "主客和", selectionCode: "A", selectionName: "客隊勝", lineCondition: "n/a", currentOdds: 4, inplay: false, poolStatus: "Sell", combinationStatus: "Sell", updatedAt: "now" }
      ]
    };

    const original = scoreFixtureHADProbabilities(fixture);
    const reversed = scoreFixtureHADProbabilities({ ...fixture, marketOptions: [...fixture.marketOptions].reverse() });

    expect(original.home + original.draw + original.away).toBeCloseTo(1, 10);
    expect(reversed).toEqual(original);
    expect(original.home).toBeGreaterThan(original.away);
  });
});

describe("pickTopRecommendations", () => {
  it("ranks equal-priced HAD selections by the Poisson outcome distribution", () => {
    const recommendation = scoreFixture({
      id: "fx-poisson-had",
      league: "測試聯賽",
      kickoffAt: new Date().toISOString(),
      homeTeam: "強隊",
      awayTeam: "弱隊",
      homeStrength: "elite",
      awayStrength: "weak",
      homeRecentPoints: 13,
      awayRecentPoints: 2,
      expertSentiment: 0.2,
      lineup: { confirmed: false, updatedAt: new Date().toISOString(), home: [], away: [] },
      oddsHistory: [{ at: "t0", homeWin: 3, draw: 3, awayWin: 3 }],
      marketOptions: [
        {
          oddsType: "HAD",
          oddsTypeName: "主客和",
          selectionCode: "A",
          selectionName: "客隊勝",
          lineCondition: "n/a",
          currentOdds: 3,
          inplay: false,
          poolStatus: "Sell",
          combinationStatus: "Sell",
          updatedAt: new Date().toISOString()
        },
        {
          oddsType: "HAD",
          oddsTypeName: "主客和",
          selectionCode: "D",
          selectionName: "和局",
          lineCondition: "n/a",
          currentOdds: 3,
          inplay: false,
          poolStatus: "Sell",
          combinationStatus: "Sell",
          updatedAt: new Date().toISOString()
        },
        {
          oddsType: "HAD",
          oddsTypeName: "主客和",
          selectionCode: "H",
          selectionName: "主隊勝",
          lineCondition: "n/a",
          currentOdds: 3,
          inplay: false,
          poolStatus: "Sell",
          combinationStatus: "Sell",
          updatedAt: new Date().toISOString()
        }
      ]
    }, {}, { minRecommendedOdds: 1.4, highOddsThreshold: 2.2 });

    expect(recommendation.selectionName).toBe("主隊勝");
  });

  it("returns sorted positive value picks", async () => {
    const provider = new MockProvider();
    const fixtures = await provider.fetchTodayFixtures();
    const picks = pickTopRecommendationsWithWeights(fixtures, {}, fixtures.length);

    expect(picks.length).toBeGreaterThan(0);
    expect(picks.every((p) => p.currentOdds >= 1.4)).toBe(true);
    expect(picks.every((p) => p.selectionName.length > 0)).toBe(true);
    expect(picks[0].valueScore).toBeGreaterThanOrEqual(picks[picks.length - 1].valueScore);
  });

  it("does not recommend an unparsed same-game accumulator even at extreme odds", async () => {
    const provider = new MockProvider();
    const [fixture] = await provider.fetchTodayFixtures();
    const recommendation = scoreFixture({
      ...fixture,
      marketOptions: [{
        oddsType: "SGA",
        oddsTypeName: "同場過關",
        selectionCode: "COMBO",
        selectionName: "客隊半場勝[3:0] & 客隊全場勝[5:1]",
        lineCondition: "0.0",
        currentOdds: 90,
        inplay: false,
        poolStatus: "SELLINGSTARTED",
        combinationStatus: "AVAILABLE",
        updatedAt: new Date().toISOString()
      }, {
        oddsType: "CRS",
        oddsTypeName: "波膽",
        selectionCode: "03:03",
        selectionName: "3:3",
        lineCondition: "0.0",
        currentOdds: 2.1,
        inplay: false,
        poolStatus: "SELLINGSTARTED",
        combinationStatus: "AVAILABLE",
        updatedAt: new Date().toISOString()
      }]
    }, {}, { minRecommendedOdds: 1.4, highOddsThreshold: 2.2 });

    expect(recommendation.market).toBe("波膽");
    expect(recommendation.selectionName).toBe("3:3");
    expect(recommendation.currentOdds).toBe(2.1);
    expect(recommendation.fullTimeScorePrediction).toBe("3-3");
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

  it("labels half-time handicap picks as handicap markets instead of team-goals markets", () => {
    const recommendation = scoreFixture(
      {
        id: "fx-goals-label",
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
            oddsType: "FHH",
            oddsTypeName: "半場讓球",
            selectionCode: "H",
            selectionName: "主隊勝",
            lineCondition: "0.0/-0.5",
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
            lineCondition: "1.5",
            currentOdds: 2.1,
            inplay: false,
            poolStatus: "Sell",
            combinationStatus: "Sell",
            updatedAt: new Date().toISOString()
          }
        ]
      } as any,
      {},
      { minRecommendedOdds: 1.4, highOddsThreshold: 2.2 }
    );

    expect(recommendation.market).toBe("半場讓球");
    expect(recommendation.selectionName).toBe("主隊勝（盤口 0.0/-0.5球）");
  });

  it("labels FLH picks as home-team half-time goal totals", () => {
    const recommendation = scoreFixture(
      {
        id: "fx-flh-label",
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
          home: [],
          away: []
        },
        oddsHistory: [{ at: "t0", homeWin: 2.4, draw: 3.1, awayWin: 3.6 }],
        marketOptions: [
          {
            oddsType: "FLH",
            oddsTypeName: "",
            selectionCode: "U",
            selectionName: "細",
            lineCondition: "0.5",
            currentOdds: 2.3,
            inplay: false,
            poolStatus: "Sell",
            combinationStatus: "Sell",
            updatedAt: new Date().toISOString()
          }
        ]
      } as any,
      {},
      { minRecommendedOdds: 1.4, highOddsThreshold: 2.2 }
    );

    expect(recommendation.market).toBe("主隊半場入球大細");
    expect(recommendation.selectionName).toBe("主隊 半場細（0.5）");
  });

  it("keeps half-time over/under scoreline predictions consistent with selected line", () => {
    const recommendation = scoreFixture(
      {
        id: "fx-halftime-ou",
        league: "測試聯賽",
        kickoffAt: new Date().toISOString(),
        homeTeam: "A隊",
        awayTeam: "B隊",
        homeStrength: "strong" as const,
        awayStrength: "strong" as const,
        homeRecentPoints: 7,
        awayRecentPoints: 7,
        expertSentiment: 0,
        lineup: {
          confirmed: true,
          updatedAt: new Date().toISOString(),
          home: [{ name: "前鋒", role: "ST", fitness: 75, recentForm: 72 }],
          away: [{ name: "後衛", role: "DF", fitness: 74, recentForm: 73 }]
        },
        oddsHistory: [
          { at: "t0", homeWin: 2.9, draw: 3.0, awayWin: 3.0 },
          { at: "t1", homeWin: 2.6, draw: 2.9, awayWin: 2.9 }
        ],
        marketOptions: [
          {
            oddsType: "EHL",
            oddsTypeName: "半場入球大細",
            selectionCode: "O",
            selectionName: "大",
            lineCondition: "1.5",
            currentOdds: 2.02,
            inplay: false,
            poolStatus: "Sell",
            combinationStatus: "Sell",
            updatedAt: new Date().toISOString()
          }
        ]
      } as any,
      {
        strengthGap: 0.05,
        recentForm: 0.05,
        lineupFitness: 0.05,
        expertSentiment: 0.05,
        oddsMomentum: 0.8
      },
      { minRecommendedOdds: 1.4, highOddsThreshold: 2.2 }
    );

    const [home, away] = recommendation.halfTimeScorePrediction
      .split("-")
      .map((value) => Number(value));
    expect(Number.isFinite(home)).toBe(true);
    expect(Number.isFinite(away)).toBe(true);
    expect(home + away).toBeGreaterThan(1.5);
  });

  it("never predicts full-time goals lower than half-time goals for either team", () => {
    const recommendation = scoreFixture(
      {
        id: "fx-cumulative-score",
        league: "測試聯賽",
        kickoffAt: new Date().toISOString(),
        homeTeam: "A隊",
        awayTeam: "B隊",
        homeStrength: "strong" as const,
        awayStrength: "average" as const,
        homeRecentPoints: 9,
        awayRecentPoints: 6,
        expertSentiment: 0.1,
        lineup: {
          confirmed: true,
          updatedAt: new Date().toISOString(),
          home: [{ name: "前鋒", role: "ST", fitness: 84, recentForm: 82 }],
          away: [{ name: "中場", role: "MF", fitness: 80, recentForm: 79 }]
        },
        oddsHistory: [
          { at: "t0", homeWin: 2.8, draw: 3.0, awayWin: 3.1 },
          { at: "t1", homeWin: 2.4, draw: 2.9, awayWin: 3.0 }
        ],
        marketOptions: [
          {
            oddsType: "EHL",
            oddsTypeName: "半場入球大細",
            selectionCode: "O",
            selectionName: "大",
            lineCondition: "1.5/2.0",
            currentOdds: 2.13,
            inplay: false,
            poolStatus: "Sell",
            combinationStatus: "Sell",
            updatedAt: new Date().toISOString()
          }
        ]
      } as any,
      {},
      { minRecommendedOdds: 1.4, highOddsThreshold: 2.2 }
    );

    const [halfHome, halfAway] = recommendation.halfTimeScorePrediction
      .split("-")
      .map((value) => Number(value));
    const [fullHome, fullAway] = recommendation.fullTimeScorePrediction
      .split("-")
      .map((value) => Number(value));

    expect(fullHome).toBeGreaterThanOrEqual(halfHome);
    expect(fullAway).toBeGreaterThanOrEqual(halfAway);
  });

  it("does not recommend a breached half-time under or predict below a live 1-1 score", () => {
    const recommendation = scoreFixture(
      {
        id: "fx-live-first-half-1-1",
        league: "測試聯賽",
        kickoffAt: new Date(Date.now() - 30 * 60_000).toISOString(),
        status: "FIRSTHALF",
        halfTimeScore: { home: 1, away: 1 },
        finalScore: { home: 1, away: 1 },
        homeTeam: "A隊",
        awayTeam: "B隊",
        homeStrength: "strong" as const,
        awayStrength: "average" as const,
        homeRecentPoints: 10,
        awayRecentPoints: 5,
        expertSentiment: 0.1,
        lineup: {
          confirmed: false,
          updatedAt: new Date().toISOString(),
          home: [],
          away: []
        },
        oddsHistory: [
          { at: "t0", homeWin: 1.8, draw: 3.2, awayWin: 4.1 },
          { at: "t1", homeWin: 1.53, draw: 3.6, awayWin: 5.2 }
        ],
        marketOptions: [
          {
            oddsType: "EHL",
            oddsTypeName: "半場入球大細",
            selectionCode: "U",
            selectionName: "細",
            lineCondition: "1.5/2.0",
            currentOdds: 2.1,
            inplay: true,
            poolStatus: "Sell",
            combinationStatus: "Sell",
            updatedAt: new Date().toISOString()
          },
          {
            oddsType: "HAD",
            oddsTypeName: "主客和",
            selectionCode: "H",
            selectionName: "主隊勝",
            lineCondition: "n/a",
            currentOdds: 1.53,
            inplay: true,
            poolStatus: "Sell",
            combinationStatus: "Sell",
            updatedAt: new Date().toISOString()
          }
        ]
      } as any,
      {},
      { minRecommendedOdds: 1.4, highOddsThreshold: 2.2 }
    );

    expect(recommendation.market).not.toBe("半場入球大細");
    expect(recommendation.selectionName).not.toContain("細");
    const [halfHome, halfAway] = recommendation.halfTimeScorePrediction.split("-").map(Number);
    const [fullHome, fullAway] = recommendation.fullTimeScorePrediction.split("-").map(Number);
    expect(halfHome).toBeGreaterThanOrEqual(1);
    expect(halfAway).toBeGreaterThanOrEqual(1);
    expect(fullHome).toBeGreaterThanOrEqual(1);
    expect(fullAway).toBeGreaterThanOrEqual(1);
  });

  it("does not recommend any half-time market after the first half closes", () => {
    for (const status of ["FIRSTHALFCOMPLETED", "SECONDHALF"]) {
      const recommendation = scoreFixture(
      {
        id: `fx-live-${status}`,
        league: "測試聯賽",
        kickoffAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        status,
        halfTimeScore: { home: 1, away: 1 },
        finalScore: { home: 1, away: 1 },
        homeTeam: "A隊",
        awayTeam: "B隊",
        homeStrength: "strong" as const,
        awayStrength: "average" as const,
        homeRecentPoints: 10,
        awayRecentPoints: 5,
        expertSentiment: 0.1,
        lineup: { confirmed: false, updatedAt: new Date().toISOString(), home: [], away: [] },
        oddsHistory: [
          { at: "t0", homeWin: 1.8, draw: 3.2, awayWin: 4.1 },
          { at: "t1", homeWin: 1.53, draw: 3.6, awayWin: 5.2 }
        ],
        marketOptions: [
          {
            oddsType: "EHL",
            oddsTypeName: "半場入球大細",
            selectionCode: "O",
            selectionName: "大",
            lineCondition: "2.5",
            currentOdds: 2.2,
            inplay: true,
            poolStatus: "Sell",
            combinationStatus: "Sell",
            updatedAt: new Date().toISOString()
          },
          {
            oddsType: "HAD",
            oddsTypeName: "主客和",
            selectionCode: "H",
            selectionName: "主隊勝",
            lineCondition: "n/a",
            currentOdds: 1.53,
            inplay: true,
            poolStatus: "Sell",
            combinationStatus: "Sell",
            updatedAt: new Date().toISOString()
          }
        ]
      } as any,
      {},
      { minRecommendedOdds: 1.4, highOddsThreshold: 2.2 }
    );

      expect(recommendation.market).not.toContain("半場");
      expect(recommendation.fullTimeScorePrediction).toMatch(/^[1-5]-[1-5]$/);
    }
  });

  it("does not recommend an away-team corner under after the live count breaches the line", () => {
    const recommendation = scoreFixture(
      {
        id: "fx-live-away-corners-10",
        league: "測試聯賽",
        kickoffAt: new Date(Date.now() - 35 * 60_000).toISOString(),
        status: "FIRSTHALF",
        finalScore: { home: 1, away: 5 },
        finalCorners: { home: 3, away: 10, total: 13 },
        homeTeam: "A隊",
        awayTeam: "B隊",
        homeStrength: "weak" as const,
        awayStrength: "strong" as const,
        homeRecentPoints: 3,
        awayRecentPoints: 12,
        expertSentiment: 0.1,
        lineup: { confirmed: false, updatedAt: new Date().toISOString(), home: [], away: [] },
        oddsHistory: [
          { at: "t0", homeWin: 12, draw: 7, awayWin: 1.2 },
          { at: "t1", homeWin: 50, draw: 20, awayWin: 1.01 }
        ],
        marketOptions: [
          {
            oddsType: "CHA",
            oddsTypeName: "客隊角球大細",
            selectionCode: "U",
            selectionName: "細",
            lineCondition: "8.5",
            currentOdds: 1.4,
            inplay: true,
            poolStatus: "Sell",
            combinationStatus: "Sell",
            updatedAt: new Date().toISOString()
          },
          {
            oddsType: "HAD",
            oddsTypeName: "主客和",
            selectionCode: "A",
            selectionName: "客隊勝",
            lineCondition: "n/a",
            currentOdds: 50,
            inplay: true,
            poolStatus: "Sell",
            combinationStatus: "Sell",
            updatedAt: new Date().toISOString()
          }
        ]
      } as any,
      {},
      { minRecommendedOdds: 1.4, highOddsThreshold: 2.2 }
    );

    expect(recommendation.market).not.toBe("客隊全場角球大細");
    expect(recommendation.selectionName).not.toBe("客隊 全場細（8.5球）");
  });

  it("prices a live corner handicap from the corner score instead of the football score", () => {
    const recommendation = scoreFixture(
      {
        id: "fx-live-corner-handicap",
        league: "測試聯賽",
        kickoffAt: new Date(Date.now() - 45 * 60_000).toISOString(),
        status: "FIRSTHALFCOMPLETED",
        liveMinute: 45,
        liveMinuteSource: "ESPN",
        finalScore: { home: 2, away: 0 },
        finalCorners: { home: 1, away: 6, total: 7 },
        homeTeam: "A隊",
        awayTeam: "B隊",
        homeStrength: "strong" as const,
        awayStrength: "average" as const,
        homeRecentPoints: 10,
        awayRecentPoints: 5,
        expertSentiment: 0.1,
        lineup: { confirmed: false, updatedAt: new Date().toISOString(), home: [], away: [] },
        oddsHistory: [
          { at: "t0", homeWin: 1.8, draw: 3.2, awayWin: 4.1 },
          { at: "t1", homeWin: 1.53, draw: 3.6, awayWin: 5.2 }
        ],
        marketOptions: [
          { oddsType: "CHD", oddsTypeName: "開出角球讓球", selectionCode: "H", selectionName: "主隊勝", lineCondition: "-1.5", currentOdds: 2.15, inplay: true, poolStatus: "Sell", combinationStatus: "Sell", updatedAt: new Date().toISOString() },
          { oddsType: "CHD", oddsTypeName: "開出角球讓球", selectionCode: "A", selectionName: "客隊勝", lineCondition: "-1.5", currentOdds: 1.62, inplay: true, poolStatus: "Sell", combinationStatus: "Sell", updatedAt: new Date().toISOString() }
        ]
      } as any,
      {},
      { minRecommendedOdds: 1.4, highOddsThreshold: 2.2 }
    );

    expect(recommendation.selectionName).toContain("客隊");
    expect(recommendation.reason).toContain("目前角球 1:6");
    expect(recommendation.reason).not.toContain("比分 2:0");
  });

  it("substantially downgrades a late home handicap when the home team trails 1-5", () => {
    const baseFixture = {
      id: "fx-live-score-repricing",
      league: "測試聯賽",
      homeTeam: "A隊",
      awayTeam: "B隊",
      homeStrength: "strong" as const,
      awayStrength: "average" as const,
      homeRecentPoints: 10,
      awayRecentPoints: 5,
      expertSentiment: 0.1,
      lineup: { confirmed: false, updatedAt: new Date().toISOString(), home: [], away: [] },
      oddsHistory: [
        { at: "t0", homeWin: 2.2, draw: 3.2, awayWin: 3.4 },
        { at: "t1", homeWin: 2.12, draw: 3.3, awayWin: 3.5 }
      ],
      marketOptions: [{
        oddsType: "HDC",
        oddsTypeName: "讓球",
        selectionCode: "H",
        selectionName: "主隊勝",
        lineCondition: "+1.0",
        currentOdds: 2.12,
        inplay: true,
        poolStatus: "Sell",
        combinationStatus: "Sell",
        updatedAt: new Date().toISOString()
      }]
    };
    const preevent = scoreFixture({ ...baseFixture, kickoffAt: new Date(Date.now() + 60 * 60_000).toISOString(), status: "PREEVENT" } as any);
    const liveFixture = {
      ...baseFixture,
      kickoffAt: new Date(Date.now() - 88 * 60_000).toISOString(),
      status: "FIRSTHALF",
      finalScore: { home: 1, away: 5 }
    } as any;
    const live = scoreFixture(liveFixture);
    const livePicks = pickTopRecommendationsWithWeights([liveFixture], {}, 1);

    expect(live.confidence).toBeLessThan(preevent.confidence - 30);
    expect(live.edgeScore).toBeLessThan(0);
    expect(livePicks).toHaveLength(0);
    expect(live.reason).toContain("上半場進行中（HKJC 及外部資料庫未提供官方分鐘）");
    expect(live.reason).toContain("比分 1:5");
    expect(live.reason).not.toContain("第 95 分鐘");
    expect(live.reason).not.toContain("走勢支持 主隊方向");
  });

  it("converts an HKJC home handicap into the away selection perspective", () => {
    const recommendation = scoreFixture({
      id: "fx-live-away-handicap",
      league: "測試聯賽",
      kickoffAt: new Date(Date.now() - 61 * 60_000).toISOString(),
      status: "SECONDHALF",
      liveMinute: 61,
      liveMinuteSource: "ESPN",
      finalScore: { home: 1, away: 3 },
      homeTeam: "A隊",
      awayTeam: "B隊",
      homeStrength: "average" as const,
      awayStrength: "strong" as const,
      homeRecentPoints: 5,
      awayRecentPoints: 13,
      expertSentiment: -0.1,
      lineup: { confirmed: false, updatedAt: new Date().toISOString(), home: [], away: [] },
      oddsHistory: [{ at: "t0", homeWin: 30, draw: 8, awayWin: 1.02 }],
      marketOptions: [{
        oddsType: "HDC",
        oddsTypeName: "讓球",
        selectionCode: "A",
        selectionName: "客隊勝",
        lineCondition: "+2.0",
        currentOdds: 2.03,
        inplay: true,
        poolStatus: "Sell",
        combinationStatus: "Sell",
        updatedAt: new Date().toISOString()
      }]
    } as any);

    expect(recommendation.selectionName).toBe("客隊勝（盤口 -2.0）");
    expect(recommendation.reason).toContain("讓球 -2");
    expect(recommendation.reason).not.toContain("盤口 +2.0");
    expect(recommendation.confidence).toBeLessThan(70);
  });

  it("requires an official minute before applying live corner pace", () => {
    const recommendationAt = (status: "FIRSTHALF" | "SECONDHALF", liveMinute?: number) => scoreFixture({
      id: `fx-corner-pace-${status}`,
      league: "測試聯賽",
      kickoffAt: new Date(Date.now() - 4 * 60 * 60_000).toISOString(),
      status,
      liveMinute,
      liveMinuteSource: liveMinute ? "TheSportsDB" : undefined,
      finalScore: { home: 0, away: 0 },
      finalCorners: { home: 2, away: 8, total: 10 },
      liveAttackingMetrics: liveMinute ? {
        source: "FotMob",
        possession: { home: 42, away: 58 },
        finalThirdEntries: { home: 18, away: 41 },
        accurateCrosses: { home: 2, away: 9 }
      } : undefined,
      homeTeam: "A隊",
      awayTeam: "B隊",
      homeStrength: "average" as const,
      awayStrength: "average" as const,
      homeRecentPoints: 7,
      awayRecentPoints: 7,
      expertSentiment: 0,
      lineup: { confirmed: false, updatedAt: new Date().toISOString(), home: [], away: [] },
      oddsHistory: [{ at: "t0", homeWin: 2.8, draw: 3.1, awayWin: 2.8 }],
      marketOptions: [{
        oddsType: "CHA",
        oddsTypeName: "客隊角球大細",
        selectionCode: "O",
        selectionName: "大",
        lineCondition: "8.5",
        currentOdds: 2,
        inplay: true,
        poolStatus: "Sell",
        combinationStatus: "Sell",
        updatedAt: new Date().toISOString()
      }]
    } as any);
    const firstHalf = recommendationAt("FIRSTHALF");
    const secondHalf = recommendationAt("SECONDHALF");
    const sourcedMinute = recommendationAt("SECONDHALF", 67);

    expect(firstHalf.confidence).toBe(secondHalf.confidence);
    expect(firstHalf.reason).toContain("上半場進行中（HKJC 及外部資料庫未提供官方分鐘）");
    expect(firstHalf.reason).toContain("未採用角球速度及剩餘時間推算");
    expect(secondHalf.reason).toContain("下半場進行中（HKJC 及外部資料庫未提供官方分鐘）");
    expect(secondHalf.reason).toContain("未採用角球速度及剩餘時間推算");
    expect(secondHalf.reason).not.toMatch(/第 \d+ 分鐘/);
    expect(sourcedMinute.reason).toContain("比賽第 67'（TheSportsDB）");
    expect(sourcedMinute.reason).toContain("按TheSportsDB提供分鐘計算角球速度");
    expect(sourcedMinute.reason).toContain("FotMob 即時進攻份額調整");
    expect(sourcedMinute.reason).toContain("Poisson");
    expect(sourcedMinute.reason).not.toContain("未提供官方分鐘");
  });

  it("keeps half-time draw selections consistent with half-time score prediction", () => {
    const recommendation = scoreFixture(
      {
        id: "fx-halftime-draw",
        league: "測試聯賽",
        kickoffAt: new Date().toISOString(),
        homeTeam: "A隊",
        awayTeam: "B隊",
        homeStrength: "strong" as const,
        awayStrength: "average" as const,
        homeRecentPoints: 10,
        awayRecentPoints: 6,
        expertSentiment: 0.1,
        lineup: {
          confirmed: true,
          updatedAt: new Date().toISOString(),
          home: [{ name: "前鋒", role: "ST", fitness: 84, recentForm: 83 }],
          away: [{ name: "中場", role: "MF", fitness: 82, recentForm: 81 }]
        },
        oddsHistory: [
          { at: "t0", homeWin: 2.2, draw: 2.0, awayWin: 3.4 },
          { at: "t1", homeWin: 2.4, draw: 1.95, awayWin: 3.6 }
        ],
        marketOptions: [
          {
            oddsType: "EDC",
            oddsTypeName: "半場主客和",
            selectionCode: "D",
            selectionName: "和",
            lineCondition: "n/a",
            currentOdds: 1.98,
            inplay: false,
            poolStatus: "Sell",
            combinationStatus: "Sell",
            updatedAt: new Date().toISOString()
          }
        ]
      } as any,
      {},
      { minRecommendedOdds: 1.4, highOddsThreshold: 2.2 }
    );

    const [home, away] = recommendation.halfTimeScorePrediction
      .split("-")
      .map((value) => Number(value));
    expect(home).toBe(away);
  });

  it("keeps full-time away-win selections consistent with full-time score prediction", () => {
    const recommendation = scoreFixture(
      {
        id: "fx-fulltime-away",
        league: "測試聯賽",
        kickoffAt: new Date().toISOString(),
        homeTeam: "A隊",
        awayTeam: "B隊",
        homeStrength: "strong" as const,
        awayStrength: "weak" as const,
        homeRecentPoints: 12,
        awayRecentPoints: 4,
        expertSentiment: 0.2,
        lineup: {
          confirmed: true,
          updatedAt: new Date().toISOString(),
          home: [{ name: "前鋒", role: "ST", fitness: 88, recentForm: 86 }],
          away: [{ name: "後衛", role: "DF", fitness: 72, recentForm: 70 }]
        },
        oddsHistory: [
          { at: "t0", homeWin: 1.8, draw: 3.2, awayWin: 2.05 },
          { at: "t1", homeWin: 1.85, draw: 3.25, awayWin: 2.0 }
        ],
        marketOptions: [
          {
            oddsType: "HDC",
            oddsTypeName: "主客和",
            selectionCode: "A",
            selectionName: "客勝",
            lineCondition: "n/a",
            currentOdds: 2.0,
            inplay: false,
            poolStatus: "Sell",
            combinationStatus: "Sell",
            updatedAt: new Date().toISOString()
          }
        ]
      } as any,
      {},
      { minRecommendedOdds: 1.4, highOddsThreshold: 2.2 }
    );

    const [home, away] = recommendation.fullTimeScorePrediction
      .split("-")
      .map((value) => Number(value));
    expect(away).toBeGreaterThan(home);
  });

  it("uses full-time correct score market when CRS odds provide a stronger exact-score signal", () => {
    const recommendation = scoreFixture(
      {
        id: "fx-crs-signal",
        league: "測試聯賽",
        kickoffAt: new Date().toISOString(),
        homeTeam: "A隊",
        awayTeam: "B隊",
        homeStrength: "strong" as const,
        awayStrength: "average" as const,
        homeRecentPoints: 9,
        awayRecentPoints: 5,
        expertSentiment: 0.12,
        lineup: {
          confirmed: true,
          updatedAt: new Date().toISOString(),
          home: [{ name: "前鋒", role: "ST", fitness: 85, recentForm: 83 }],
          away: [{ name: "後衛", role: "DF", fitness: 77, recentForm: 75 }]
        },
        oddsHistory: [
          { at: "t0", homeWin: 2.15, draw: 3.25, awayWin: 3.4 },
          { at: "t1", homeWin: 2.08, draw: 3.3, awayWin: 3.55 }
        ],
        marketOptions: [
          {
            oddsType: "HDC",
            oddsTypeName: "主客和",
            selectionCode: "H",
            selectionName: "主勝",
            lineCondition: "n/a",
            currentOdds: 2.08,
            inplay: false,
            poolStatus: "Sell",
            combinationStatus: "Sell",
            updatedAt: new Date().toISOString()
          },
          {
            oddsType: "CRS",
            oddsTypeName: "波膽",
            selectionCode: "10",
            selectionName: "1:0",
            lineCondition: "0.0",
            currentOdds: 8.2,
            inplay: false,
            poolStatus: "Sell",
            combinationStatus: "Sell",
            updatedAt: new Date().toISOString()
          },
          {
            oddsType: "CRS",
            oddsTypeName: "波膽",
            selectionCode: "21",
            selectionName: "2:1",
            lineCondition: "0.0",
            currentOdds: 5.6,
            inplay: false,
            poolStatus: "Sell",
            combinationStatus: "Sell",
            updatedAt: new Date().toISOString()
          },
          {
            oddsType: "CRS",
            oddsTypeName: "波膽",
            selectionCode: "11",
            selectionName: "1:1",
            lineCondition: "0.0",
            currentOdds: 7.9,
            inplay: false,
            poolStatus: "Sell",
            combinationStatus: "Sell",
            updatedAt: new Date().toISOString()
          }
        ]
      } as any,
      {},
      { minRecommendedOdds: 1.4, highOddsThreshold: 2.2 }
    );

    expect(recommendation.fullTimeScorePrediction).toBe("2-1");
    expect(recommendation.scorePredictionAlternatives).toHaveLength(2);
    expect(recommendation.scorePredictionAlternatives).toContain("1-0");
    expect(recommendation.correctScoreConfidence).toBe("市場中信號");
  });

  it("uses half-time correct score market when ECS odds provide a stronger exact-score signal", () => {
    const recommendation = scoreFixture(
      {
        id: "fx-ecs-signal",
        league: "測試聯賽",
        kickoffAt: new Date().toISOString(),
        homeTeam: "A隊",
        awayTeam: "B隊",
        homeStrength: "average" as const,
        awayStrength: "average" as const,
        homeRecentPoints: 6,
        awayRecentPoints: 6,
        expertSentiment: 0,
        lineup: {
          confirmed: true,
          updatedAt: new Date().toISOString(),
          home: [{ name: "前鋒", role: "ST", fitness: 80, recentForm: 79 }],
          away: [{ name: "中場", role: "MF", fitness: 80, recentForm: 78 }]
        },
        oddsHistory: [
          { at: "t0", homeWin: 2.7, draw: 2.6, awayWin: 2.8 },
          { at: "t1", homeWin: 2.75, draw: 2.55, awayWin: 2.85 }
        ],
        marketOptions: [
          {
            oddsType: "EDC",
            oddsTypeName: "半場主客和",
            selectionCode: "D",
            selectionName: "和",
            lineCondition: "n/a",
            currentOdds: 2.1,
            inplay: false,
            poolStatus: "Sell",
            combinationStatus: "Sell",
            updatedAt: new Date().toISOString()
          },
          {
            oddsType: "ECS",
            oddsTypeName: "半場波膽",
            selectionCode: "00",
            selectionName: "0:0",
            lineCondition: "0.0",
            currentOdds: 2.4,
            inplay: false,
            poolStatus: "Sell",
            combinationStatus: "Sell",
            updatedAt: new Date().toISOString()
          },
          {
            oddsType: "ECS",
            oddsTypeName: "半場波膽",
            selectionCode: "11",
            selectionName: "1:1",
            lineCondition: "0.0",
            currentOdds: 7.5,
            inplay: false,
            poolStatus: "Sell",
            combinationStatus: "Sell",
            updatedAt: new Date().toISOString()
          }
        ]
      } as any,
      {},
      { minRecommendedOdds: 1.4, highOddsThreshold: 2.2 }
    );

    expect(recommendation.halfTimeScorePrediction).toBe("0-0");
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
