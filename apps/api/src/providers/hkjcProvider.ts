import type { DailyFixtureProvider } from "./provider.js";
import type { Fixture, TeamStrength } from "../types.js";

const HKJC_HOME_URL = "https://bet.hkjc.com/ch/football/home";

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseKickoff(day: string, time: string): string {
  const [dd, mm, yyyy] = day.split("/");
  return `${yyyy}-${mm}-${dd}T${time}:00+08:00`;
}

function estimateStrengthFromOdds(odds: number): TeamStrength {
  if (odds <= 1.55) return "elite";
  if (odds <= 2.1) return "strong";
  if (odds <= 3.0) return "average";
  return "weak";
}

function estimateRecentPoints(odds: number): number {
  if (odds <= 1.5) return 13;
  if (odds <= 2.0) return 10;
  if (odds <= 3.0) return 8;
  return 5;
}

function extractRows(rawHtml: string): Fixture[] {
  const text = cleanText(rawHtml.replace(/<[^>]+>/g, " "));

  const rowRegex =
    /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})\s+(FB\d{4})\s+([^\d]{2,40}?)\s+([^\d]{2,40}?)\s+(?:[A-Z0-9]{2,4}\s+)?(\d+\.\d{2})\s+(\d+\.\d{2})\s+(\d+\.\d{2})/g;

  const fixtures: Fixture[] = [];

  for (const match of text.matchAll(rowRegex)) {
    const [, day, time, matchCode, homeRaw, awayRaw, homeWinRaw, drawRaw, awayWinRaw] = match;
    const homeWin = Number(homeWinRaw);
    const draw = Number(drawRaw);
    const awayWin = Number(awayWinRaw);
    const homeTeam = cleanText(homeRaw);
    const awayTeam = cleanText(awayRaw);

    if (!homeTeam || !awayTeam || Number.isNaN(homeWin) || Number.isNaN(draw) || Number.isNaN(awayWin)) {
      continue;
    }

    fixtures.push({
      id: matchCode,
      league: "HKJC Football",
      kickoffAt: parseKickoff(day, time),
      homeTeam,
      awayTeam,
      homeStrength: estimateStrengthFromOdds(homeWin),
      awayStrength: estimateStrengthFromOdds(awayWin),
      homeRecentPoints: estimateRecentPoints(homeWin),
      awayRecentPoints: estimateRecentPoints(awayWin),
      expertSentiment: Math.max(0.05, Math.min(0.95, 1 / homeWin)),
      lineup: {
        confirmed: false,
        updatedAt: new Date().toISOString(),
        home: [],
        away: []
      },
      oddsHistory: [
        {
          at: new Date().toISOString(),
          homeWin,
          draw,
          awayWin
        }
      ],
      marketOptions: [
        {
          oddsType: "HAD",
          oddsTypeName: "主客和",
          selectionCode: "HADH",
          selectionName: "主勝",
          lineCondition: "N/A",
          currentOdds: homeWin,
          inplay: false,
          poolStatus: "Selling",
          combinationStatus: "Selling",
          updatedAt: new Date().toISOString()
        },
        {
          oddsType: "HAD",
          oddsTypeName: "主客和",
          selectionCode: "HADX",
          selectionName: "和局",
          lineCondition: "N/A",
          currentOdds: draw,
          inplay: false,
          poolStatus: "Selling",
          combinationStatus: "Selling",
          updatedAt: new Date().toISOString()
        },
        {
          oddsType: "HAD",
          oddsTypeName: "主客和",
          selectionCode: "HADA",
          selectionName: "客勝",
          lineCondition: "N/A",
          currentOdds: awayWin,
          inplay: false,
          poolStatus: "Selling",
          combinationStatus: "Selling",
          updatedAt: new Date().toISOString()
        }
      ]
    });
  }

  return fixtures;
}

export class HkjcProvider implements DailyFixtureProvider {
  constructor(private readonly sourceUrl = HKJC_HOME_URL) {}

  async fetchTodayFixtures(): Promise<Fixture[]> {
    const response = await fetch(this.sourceUrl, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "accept-language": "zh-HK,zh;q=0.9,en;q=0.8"
      }
    });

    if (!response.ok) {
      throw new Error(`HKJC fetch failed with status ${response.status}`);
    }

    const html = await response.text();
    const fixtures = extractRows(html);

    if (fixtures.length === 0) {
      throw new Error(
        "HKJC page returned no parseable fixtures. This source may require dynamic rendering or authorized API access."
      );
    }

    return fixtures;
  }

  async refreshLineups(fixtures: Fixture[]): Promise<Fixture[]> {
    const now = Date.now();
    const updatedAt = new Date().toISOString();

    return fixtures.map((fixture) => {
      const minutesToKickoff = (new Date(fixture.kickoffAt).getTime() - now) / 60000;
      return {
        ...fixture,
        lineup: {
          ...fixture.lineup,
          confirmed: minutesToKickoff <= 25 && minutesToKickoff >= 0,
          updatedAt
        }
      };
    });
  }
}
