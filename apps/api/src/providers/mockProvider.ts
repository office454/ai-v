import type { DailyFixtureProvider } from "./provider.js";
import type { Fixture } from "../types.js";

const now = Date.now();

function sampleFixture(id: string, homeTeam: string, awayTeam: string, minsToKickoff: number): Fixture {
  const kickoff = new Date(now + minsToKickoff * 60 * 1000).toISOString();
  return {
    id,
    league: "World Club Friendly",
    kickoffAt: kickoff,
    homeTeam,
    awayTeam,
    homeStrength: "strong",
    awayStrength: "average",
    homeRecentPoints: 11,
    awayRecentPoints: 7,
    expertSentiment: 0.62,
    lineup: {
      confirmed: minsToKickoff <= 25,
      updatedAt: new Date(now).toISOString(),
      home: [
        { name: `${homeTeam} Striker`, role: "FW", fitness: 85, recentForm: 78 },
        { name: `${homeTeam} Midfielder`, role: "MF", fitness: 80, recentForm: 73 }
      ],
      away: [
        { name: `${awayTeam} Striker`, role: "FW", fitness: 76, recentForm: 68 },
        { name: `${awayTeam} Defender`, role: "DF", fitness: 81, recentForm: 71 }
      ]
    },
    oddsHistory: [
      { at: new Date(now - 4 * 60 * 60 * 1000).toISOString(), homeWin: 1.89, draw: 3.4, awayWin: 4.2 },
      { at: new Date(now - 2 * 60 * 60 * 1000).toISOString(), homeWin: 1.83, draw: 3.5, awayWin: 4.35 },
      { at: new Date(now).toISOString(), homeWin: 1.78, draw: 3.55, awayWin: 4.5 }
    ],
    marketOptions: [
      {
        oddsType: "HAD",
        oddsTypeName: "主客和",
        selectionCode: "HADH",
        selectionName: "主勝",
        lineCondition: "N/A",
        currentOdds: 1.78,
        inplay: false,
        poolStatus: "Selling",
        combinationStatus: "Selling",
        updatedAt: new Date(now).toISOString()
      },
      {
        oddsType: "HAD",
        oddsTypeName: "主客和",
        selectionCode: "HADX",
        selectionName: "和局",
        lineCondition: "N/A",
        currentOdds: 3.55,
        inplay: false,
        poolStatus: "Selling",
        combinationStatus: "Selling",
        updatedAt: new Date(now).toISOString()
      },
      {
        oddsType: "OOE",
        oddsTypeName: "入球單雙",
        selectionCode: "OOEO",
        selectionName: "單",
        lineCondition: "N/A",
        currentOdds: 1.96,
        inplay: false,
        poolStatus: "Selling",
        combinationStatus: "Selling",
        updatedAt: new Date(now).toISOString()
      },
      {
        oddsType: "TTG",
        oddsTypeName: "總入球",
        selectionCode: "TTG2",
        selectionName: "2球",
        lineCondition: "N/A",
        currentOdds: 4.8,
        inplay: false,
        poolStatus: "Selling",
        combinationStatus: "Selling",
        updatedAt: new Date(now).toISOString()
      }
    ]
  };
}

export class MockProvider implements DailyFixtureProvider {
  async fetchTodayFixtures(): Promise<Fixture[]> {
    return [
      sampleFixture("m1", "Harbor United", "Kowloon City", 120),
      sampleFixture("m2", "Shatin Athletic", "Island Rangers", 32),
      sampleFixture("m3", "Victoria FC", "NT Warriors", 18)
    ];
  }

  async refreshLineups(fixtures: Fixture[]): Promise<Fixture[]> {
    const refreshedAt = new Date().toISOString();
    return fixtures.map((fixture) => {
      const minutesToKickoff = Math.max(
        0,
        Math.floor((new Date(fixture.kickoffAt).getTime() - Date.now()) / 60000)
      );
      const confirmed = minutesToKickoff <= 25;
      return {
        ...fixture,
        lineup: {
          ...fixture.lineup,
          confirmed,
          updatedAt: refreshedAt
        }
      };
    });
  }
}
