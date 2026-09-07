import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { Fixture } from "../types.js";

export type OddsCheckpoint = "24h" | "6h" | "1h" | "close";

type OddsApiOutcome = { name: string; price: number };
type OddsApiMarket = { key: string; outcomes: OddsApiOutcome[] };
type OddsApiBookmaker = { key: string; title: string; last_update: string; markets: OddsApiMarket[] };
type OddsApiEvent = {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
};

export type CrossBookmakerSnapshot = {
  key: string;
  fixtureId: string;
  checkpoint: OddsCheckpoint;
  scheduledAt: string;
  capturedAt: string;
  kickoffAt: string;
  league: string;
  sportKey: string;
  homeTeam: string;
  awayTeam: string;
  eventId: string;
  bookmakers: OddsApiBookmaker[];
};

type CheckpointState = {
  key: string;
  fixtureId: string;
  checkpoint: OddsCheckpoint;
  scheduledAt: string;
  status: "captured" | "missed" | "unmatched";
  recordedAt: string;
  detail?: string;
};

type SnapshotDatabase = {
  checkpoints: CheckpointState[];
  snapshots: CrossBookmakerSnapshot[];
  quota: { remaining?: number; used?: number; lastRequestAt?: string };
};

export type OddsSnapshotStatus = {
  enabled: boolean;
  configured: boolean;
  schedule: Array<{ checkpoint: OddsCheckpoint; minutesBeforeKickoff: number; graceMinutes: number }>;
  snapshotCount: number;
  checkpointCount: number;
  quota: SnapshotDatabase["quota"];
  lastCapturedAt?: string;
};

type FetchLike = typeof fetch;

export type OddsSnapshotServiceOptions = {
  apiKey: string;
  storePath: string;
  enabled?: boolean;
  baseUrl?: string;
  regions?: string;
  leagueMap?: Record<string, string>;
  fetchImpl?: FetchLike;
  now?: () => Date;
};

const CHECKPOINTS: Array<{ name: OddsCheckpoint; offsetMinutes: number; graceMinutes: number }> = [
  { name: "24h", offsetMinutes: 24 * 60, graceMinutes: 30 },
  { name: "6h", offsetMinutes: 6 * 60, graceMinutes: 30 },
  { name: "1h", offsetMinutes: 60, graceMinutes: 15 },
  { name: "close", offsetMinutes: 10, graceMinutes: 10 }
];

const DEFAULT_LEAGUE_MAP: Record<string, string> = {
  "premier league": "soccer_epl",
  "english premier league": "soccer_epl",
  "英格蘭超級聯賽": "soccer_epl",
  "英超": "soccer_epl",
  "efl championship": "soccer_efl_champ",
  "english championship": "soccer_efl_champ",
  "英格蘭冠軍聯賽": "soccer_efl_champ",
  "英冠": "soccer_efl_champ",
  "la liga": "soccer_spain_la_liga",
  "西班牙甲組聯賽": "soccer_spain_la_liga",
  "西甲": "soccer_spain_la_liga",
  "serie a": "soccer_italy_serie_a",
  "意大利甲組聯賽": "soccer_italy_serie_a",
  "意甲": "soccer_italy_serie_a",
  bundesliga: "soccer_germany_bundesliga",
  "德國甲組聯賽": "soccer_germany_bundesliga",
  "德甲": "soccer_germany_bundesliga",
  "ligue 1": "soccer_france_ligue_one",
  "法國甲組聯賽": "soccer_france_ligue_one",
  "法甲": "soccer_france_ligue_one",
  eredivisie: "soccer_netherlands_eredivisie",
  "荷蘭甲組聯賽": "soccer_netherlands_eredivisie",
  "荷甲": "soccer_netherlands_eredivisie",
  "primeira liga": "soccer_portugal_primeira_liga",
  "葡萄牙超級聯賽": "soccer_portugal_primeira_liga",
  "葡超": "soccer_portugal_primeira_liga",
  "scottish premiership": "soccer_spl",
  "蘇格蘭超級聯賽": "soccer_spl",
  "蘇超": "soccer_spl"
};

function emptyDatabase(): SnapshotDatabase {
  return { checkpoints: [], snapshots: [], quota: {} };
}

function normalized(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/\b(fc|afc|cf|sc)\b/g, "").replace(/[^\p{L}\p{N}]+/gu, "").trim();
}

function checkpointKey(fixture: Fixture, checkpoint: OddsCheckpoint): string {
  return `${fixture.id}::${fixture.kickoffAt}::${checkpoint}`;
}

function numericHeader(response: Response, name: string): number | undefined {
  const value = response.headers.get(name);
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function teamCandidates(fixture: Fixture, side: "home" | "away"): string[] {
  const localized = side === "home" ? fixture.homeTeam : fixture.awayTeam;
  const english = side === "home" ? fixture.homeTeamEn : fixture.awayTeamEn;
  return [localized, english].filter((value): value is string => Boolean(value?.trim())).map(normalized);
}

function matchesTeam(apiName: string, candidates: string[]): boolean {
  const api = normalized(apiName);
  return candidates.some((candidate) => api === candidate || (api.length >= 6 && candidate.length >= 6 && (api.includes(candidate) || candidate.includes(api))));
}

function matchEvent(fixture: Fixture, events: OddsApiEvent[]): OddsApiEvent | undefined {
  const home = teamCandidates(fixture, "home");
  const away = teamCandidates(fixture, "away");
  const kickoff = Date.parse(fixture.kickoffAt);
  return events.find((event) =>
    Math.abs(Date.parse(event.commence_time) - kickoff) <= 3 * 60 * 60 * 1000
      && matchesTeam(event.home_team, home)
      && matchesTeam(event.away_team, away)
  );
}

export class OddsSnapshotService {
  private database: SnapshotDatabase | null = null;
  private readonly enabled: boolean;
  private readonly leagueMap: Record<string, string>;
  private running = false;

  constructor(private readonly options: OddsSnapshotServiceOptions) {
    this.enabled = options.enabled ?? true;
    this.leagueMap = Object.fromEntries(
      Object.entries({ ...DEFAULT_LEAGUE_MAP, ...(options.leagueMap ?? {}) }).map(([league, sport]) => [league.trim().toLowerCase(), sport])
    );
  }

  private async load(): Promise<SnapshotDatabase> {
    if (this.database) return this.database;
    try {
      this.database = JSON.parse(await readFile(this.options.storePath, "utf8")) as SnapshotDatabase;
    } catch {
      this.database = emptyDatabase();
    }
    return this.database;
  }

  private async save(database: SnapshotDatabase): Promise<void> {
    await mkdir(path.dirname(this.options.storePath), { recursive: true });
    await writeFile(this.options.storePath, `${JSON.stringify(database, null, 2)}\n`, "utf8");
  }

  private sportKey(fixture: Fixture): string | undefined {
    return this.leagueMap[fixture.league.trim().toLowerCase()];
  }

  async run(fixtures: Fixture[]): Promise<void> {
    if (!this.enabled || !this.options.apiKey.trim() || this.running) return;
    this.running = true;
    try {
      const database = await this.load();
      const now = (this.options.now ?? (() => new Date()))();
      const nowMs = now.getTime();
      const recorded = new Set(database.checkpoints.map((item) => item.key));
      const due = new Map<string, Array<{ fixture: Fixture; checkpoint: typeof CHECKPOINTS[number]; scheduledAt: Date }>>();
      let stateChanged = false;

      for (const fixture of fixtures) {
        const kickoffMs = Date.parse(fixture.kickoffAt);
        if (!Number.isFinite(kickoffMs) || kickoffMs <= nowMs) continue;
        const sportKey = this.sportKey(fixture);
        if (!sportKey) continue;
        for (const checkpoint of CHECKPOINTS) {
          const key = checkpointKey(fixture, checkpoint.name);
          if (recorded.has(key)) continue;
          const scheduledAt = new Date(kickoffMs - checkpoint.offsetMinutes * 60_000);
          const elapsedMinutes = (nowMs - scheduledAt.getTime()) / 60_000;
          if (elapsedMinutes < 0) continue;
          if (elapsedMinutes > checkpoint.graceMinutes) {
            database.checkpoints.push({ key, fixtureId: fixture.id, checkpoint: checkpoint.name, scheduledAt: scheduledAt.toISOString(), status: "missed", recordedAt: now.toISOString() });
            recorded.add(key);
            stateChanged = true;
            continue;
          }
          due.set(sportKey, [...(due.get(sportKey) ?? []), { fixture, checkpoint, scheduledAt }]);
        }
      }

      for (const [sportKey, entries] of due) {
        const url = new URL(`${this.options.baseUrl ?? "https://api.the-odds-api.com/v4"}/sports/${sportKey}/odds`);
        url.searchParams.set("apiKey", this.options.apiKey);
        url.searchParams.set("regions", this.options.regions ?? "uk,eu");
        url.searchParams.set("markets", "h2h");
        url.searchParams.set("oddsFormat", "decimal");
        url.searchParams.set("dateFormat", "iso");
        const response = await (this.options.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(8_000) });
        if (!response.ok) throw new Error(`The Odds API ${sportKey} failed with status ${response.status}`);
        const events = await response.json() as OddsApiEvent[];
        database.quota = {
          remaining: numericHeader(response, "x-requests-remaining"),
          used: numericHeader(response, "x-requests-used"),
          lastRequestAt: now.toISOString()
        };
        for (const entry of entries) {
          const key = checkpointKey(entry.fixture, entry.checkpoint.name);
          const event = matchEvent(entry.fixture, events);
          if (!event) {
            database.checkpoints.push({ key, fixtureId: entry.fixture.id, checkpoint: entry.checkpoint.name, scheduledAt: entry.scheduledAt.toISOString(), status: "unmatched", recordedAt: now.toISOString(), detail: `No ${sportKey} event matched fixture` });
          } else {
            database.snapshots.push({
              key, fixtureId: entry.fixture.id, checkpoint: entry.checkpoint.name, scheduledAt: entry.scheduledAt.toISOString(), capturedAt: now.toISOString(), kickoffAt: entry.fixture.kickoffAt,
              league: entry.fixture.league, sportKey, homeTeam: entry.fixture.homeTeam, awayTeam: entry.fixture.awayTeam, eventId: event.id, bookmakers: event.bookmakers
            });
            database.checkpoints.push({ key, fixtureId: entry.fixture.id, checkpoint: entry.checkpoint.name, scheduledAt: entry.scheduledAt.toISOString(), status: "captured", recordedAt: now.toISOString() });
          }
          recorded.add(key);
          stateChanged = true;
        }
      }
      if (stateChanged || due.size > 0) await this.save(database);
    } finally {
      this.running = false;
    }
  }

  async status(): Promise<OddsSnapshotStatus> {
    const database = await this.load();
    return {
      enabled: this.enabled,
      configured: Boolean(this.options.apiKey.trim()),
      schedule: CHECKPOINTS.map((checkpoint) => ({
        checkpoint: checkpoint.name,
        minutesBeforeKickoff: checkpoint.offsetMinutes,
        graceMinutes: checkpoint.graceMinutes
      })),
      snapshotCount: database.snapshots.length,
      checkpointCount: database.checkpoints.length,
      quota: database.quota,
      lastCapturedAt: database.snapshots.at(-1)?.capturedAt
    };
  }

  async snapshots(fixtureId?: string, limit = 100): Promise<CrossBookmakerSnapshot[]> {
    const database = await this.load();
    const filtered = fixtureId ? database.snapshots.filter((item) => item.fixtureId === fixtureId) : database.snapshots;
    return filtered.slice(-Math.max(1, Math.min(1000, limit))).reverse();
  }
}