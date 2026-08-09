import type { DailyFixtureProvider } from "./provider.js";
import type { Fixture, TeamStrength } from "../types.js";

type SportsDbEvent = {
  idEvent?: string;
  strTimestamp?: string;
  dateEvent?: string;
  strTime?: string;
  strLeague?: string;
  strHomeTeam?: string;
  strAwayTeam?: string;
  intHomeScore?: string | number | null;
  intAwayScore?: string | number | null;
};

type SportsDbResponse = {
  events?: SportsDbEvent[];
};

type TeamFormRecord = {
  at: number;
  points: number;
};

const DEFAULT_BASE_URL = "https://www.thesportsdb.com/api/v1/json";
const DEFAULT_API_KEY = "123";
const DEFAULT_LEAGUE_IDS = [4328, 4335, 4332];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseScore(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseKickoff(event: SportsDbEvent): string {
  if (event.strTimestamp) {
    const ts = new Date(event.strTimestamp);
    if (!Number.isNaN(ts.getTime())) {
      return ts.toISOString();
    }
  }

  if (event.dateEvent) {
    const time = event.strTime?.trim() || "00:00:00";
    const fallback = new Date(`${event.dateEvent}T${time}Z`);
    if (!Number.isNaN(fallback.getTime())) {
      return fallback.toISOString();
    }
  }

  return new Date().toISOString();
}

function strengthFromProbability(probability: number): TeamStrength {
  if (probability >= 0.55) return "elite";
  if (probability >= 0.48) return "strong";
  if (probability >= 0.38) return "average";
  return "weak";
}

function toRecentPoints(score: number): number {
  return Math.round(clamp(score, 0, 15));
}

function normalizeProbabilities(home: number, draw: number, away: number): { home: number; draw: number; away: number } {
  const sum = home + draw + away;
  if (sum <= 0) {
    return { home: 0.45, draw: 0.25, away: 0.3 };
  }
  return {
    home: home / sum,
    draw: draw / sum,
    away: away / sum
  };
}

function probabilitiesFromForm(homeRecent: number, awayRecent: number): { home: number; draw: number; away: number } {
  const diff = (homeRecent - awayRecent) / 15;
  const home = clamp(0.4 + diff * 0.25, 0.2, 0.7);
  const draw = clamp(0.24 - Math.abs(diff) * 0.08, 0.16, 0.33);
  const away = clamp(1 - home - draw, 0.14, 0.6);
  return normalizeProbabilities(home, draw, away);
}

function decimalOdds(probability: number): number {
  return Number((1 / Math.max(probability, 0.05)).toFixed(2));
}

function formPoints(records: TeamFormRecord[]): number {
  const recent = [...records].sort((a, b) => b.at - a.at).slice(0, 5);
  const points = recent.reduce((sum, record) => sum + record.points, 0);
  const normalized = (points / Math.max(recent.length, 1)) * 3;
  return toRecentPoints(normalized);
}

function mapStatus(homeScore: number | null, awayScore: number | null, kickoffAt: string): string {
  if (homeScore !== null && awayScore !== null) {
    return "FT";
  }

  const kickoffMs = new Date(kickoffAt).getTime();
  if (!Number.isFinite(kickoffMs)) {
    return "NS";
  }

  return kickoffMs <= Date.now() ? "LIVE" : "NS";
}

function eventKey(event: SportsDbEvent): string {
  const id = String(event.idEvent ?? "").trim();
  if (id) {
    return id;
  }

  const home = String(event.strHomeTeam ?? "").trim();
  const away = String(event.strAwayTeam ?? "").trim();
  return `${home}|${away}|${parseKickoff(event)}`;
}

export class TheSportsDbProvider implements DailyFixtureProvider {
  constructor(
    private readonly apiKey = DEFAULT_API_KEY,
    private readonly leagueIds: number[] = DEFAULT_LEAGUE_IDS,
    private readonly baseUrl = DEFAULT_BASE_URL,
    private readonly minIntervalMs = 1200
  ) {}

  private async request(endpoint: string, leagueId: number): Promise<SportsDbEvent[]> {
    const url = `${this.baseUrl}/${this.apiKey}/${endpoint}?id=${leagueId}`;
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
      }
    });

    if (!response.ok) {
      throw new Error(`TheSportsDB request failed: ${response.status} (${endpoint}, league ${leagueId})`);
    }

    const payload = (await response.json()) as SportsDbResponse;
    return payload.events ?? [];
  }

  private async sleepBetweenCalls(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, this.minIntervalMs));
  }

  async fetchTodayFixtures(): Promise<Fixture[]> {
    const allEvents: SportsDbEvent[] = [];
    const teamHistory = new Map<string, TeamFormRecord[]>();

    for (const leagueId of this.leagueIds) {
      const [nextEvents, pastEvents] = await Promise.all([
        this.request("eventsnextleague.php", leagueId),
        this.request("eventspastleague.php", leagueId)
      ]);

      allEvents.push(...nextEvents, ...pastEvents);

      for (const event of pastEvents) {
        const home = String(event.strHomeTeam ?? "").trim();
        const away = String(event.strAwayTeam ?? "").trim();
        const homeScore = parseScore(event.intHomeScore);
        const awayScore = parseScore(event.intAwayScore);
        const at = new Date(parseKickoff(event)).getTime();

        if (!home || !away || homeScore === null || awayScore === null || !Number.isFinite(at)) {
          continue;
        }

        const homePoints = homeScore > awayScore ? 3 : homeScore === awayScore ? 1 : 0;
        const awayPoints = awayScore > homeScore ? 3 : homeScore === awayScore ? 1 : 0;

        (teamHistory.get(home) ?? teamHistory.set(home, []).get(home)!).push({ at, points: homePoints });
        (teamHistory.get(away) ?? teamHistory.set(away, []).get(away)!).push({ at, points: awayPoints });
      }

      await this.sleepBetweenCalls();
    }

    const dedup = new Map<string, SportsDbEvent>();
    for (const event of allEvents) {
      const key = eventKey(event);
      if (!key) continue;
      dedup.set(key, event);
    }

    const fixtures: Fixture[] = [];

    for (const event of dedup.values()) {
      const id = String(event.idEvent ?? "").trim();
      const homeTeam = String(event.strHomeTeam ?? "").trim();
      const awayTeam = String(event.strAwayTeam ?? "").trim();

      if (!id || !homeTeam || !awayTeam) {
        continue;
      }

      const kickoffAt = parseKickoff(event);
      const league = String(event.strLeague ?? "TheSportsDB Soccer").trim() || "TheSportsDB Soccer";
      const homeRecent = formPoints(teamHistory.get(homeTeam) ?? []);
      const awayRecent = formPoints(teamHistory.get(awayTeam) ?? []);

      const probs = probabilitiesFromForm(homeRecent, awayRecent);
      const homeOdds = decimalOdds(probs.home);
      const drawOdds = decimalOdds(probs.draw);
      const awayOdds = decimalOdds(probs.away);

      const homeScore = parseScore(event.intHomeScore);
      const awayScore = parseScore(event.intAwayScore);
      const status = mapStatus(homeScore, awayScore, kickoffAt);
      const isSelling = status === "NS";

      fixtures.push({
        id,
        league,
        kickoffAt,
        status,
        finalScore:
          homeScore !== null && awayScore !== null
            ? {
                home: homeScore,
                away: awayScore
              }
            : undefined,
        homeTeam,
        awayTeam,
        homeStrength: strengthFromProbability(probs.home),
        awayStrength: strengthFromProbability(probs.away),
        homeRecentPoints: homeRecent,
        awayRecentPoints: awayRecent,
        expertSentiment: clamp(probs.home, 0.05, 0.95),
        lineup: {
          confirmed: false,
          updatedAt: new Date().toISOString(),
          home: [],
          away: []
        },
        oddsHistory: [
          {
            at: new Date().toISOString(),
            homeWin: homeOdds,
            draw: drawOdds,
            awayWin: awayOdds
          }
        ],
        marketOptions: [
          {
            oddsType: "HAD",
            oddsTypeName: "主客和",
            selectionCode: "HADH",
            selectionName: "主勝",
            lineCondition: "N/A",
            currentOdds: homeOdds,
            inplay: status === "LIVE",
            poolStatus: isSelling ? "Selling" : "Closed",
            combinationStatus: isSelling ? "Selling" : "Closed",
            updatedAt: new Date().toISOString()
          },
          {
            oddsType: "HAD",
            oddsTypeName: "主客和",
            selectionCode: "HADX",
            selectionName: "和局",
            lineCondition: "N/A",
            currentOdds: drawOdds,
            inplay: status === "LIVE",
            poolStatus: isSelling ? "Selling" : "Closed",
            combinationStatus: isSelling ? "Selling" : "Closed",
            updatedAt: new Date().toISOString()
          },
          {
            oddsType: "HAD",
            oddsTypeName: "主客和",
            selectionCode: "HADA",
            selectionName: "客勝",
            lineCondition: "N/A",
            currentOdds: awayOdds,
            inplay: status === "LIVE",
            poolStatus: isSelling ? "Selling" : "Closed",
            combinationStatus: isSelling ? "Selling" : "Closed",
            updatedAt: new Date().toISOString()
          }
        ]
      });
    }

    if (fixtures.length === 0) {
      throw new Error("TheSportsDB returned no usable soccer events.");
    }

    return fixtures;
  }

  async fetchFixturesByIds(fixtureIds: string[]): Promise<Fixture[]> {
    const wanted = new Set(fixtureIds.map((id) => String(id).trim()).filter((id) => id.length > 0));
    if (wanted.size === 0) {
      return [];
    }

    const fixtures = await this.fetchTodayFixtures();
    return fixtures.filter((fixture) => wanted.has(fixture.id));
  }

  async refreshLineups(fixtures: Fixture[]): Promise<Fixture[]> {
    const refreshedAt = new Date().toISOString();
    const now = Date.now();

    return fixtures.map((fixture) => {
      const minutesToKickoff = Math.max(0, Math.floor((new Date(fixture.kickoffAt).getTime() - now) / 60000));
      return {
        ...fixture,
        lineup: {
          ...fixture.lineup,
          confirmed: minutesToKickoff <= 25,
          updatedAt: refreshedAt
        }
      };
    });
  }
}
