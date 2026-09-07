import type { LiveAttackingMetrics, LiveMetricPair, LivePressureMetrics } from "../types.js";
import type { EspnLiveDetail } from "./espnLiveDataService.js";

const FOTMOB_BASE_URL = "https://www.fotmob.com/api/data";
const CACHE_TTL_MS = 60_000;

type FotMobTeam = {
  name?: string;
  longName?: string;
  score?: number;
};

type FotMobStatus = {
  utcTime?: string;
  started?: boolean;
  finished?: boolean;
  cancelled?: boolean;
  ongoing?: boolean;
  scoreStr?: string;
  reason?: { short?: string; long?: string };
  liveTime?: { short?: string; long?: string };
};

type FotMobMatch = {
  id?: number;
  time?: string;
  home?: FotMobTeam;
  away?: FotMobTeam;
  status?: FotMobStatus;
};

type FotMobMatchesResponse = {
  leagues?: Array<{ matches?: FotMobMatch[] }>;
};

type FotMobStat = {
  key?: string;
  title?: string;
  stats?: unknown[];
};

type FotMobDetailResponse = {
  general?: {
    matchTimeUTCDate?: string;
    leagueName?: string;
    homeTeam?: { name?: string };
    awayTeam?: { name?: string };
  };
  header?: {
    status?: FotMobStatus;
    teams?: FotMobTeam[];
  };
  content?: {
    stats?: {
      Periods?: Record<string, { stats?: Array<{ stats?: FotMobStat[] }> }>;
    };
    matchFacts?: {
      events?: {
        events?: Array<{
          type?: string;
          halfStrShort?: string;
          homeScore?: number;
          awayScore?: number;
          isHome?: boolean;
          card?: string;
        }>;
      };
    };
    lineup?: {
      homeTeam?: { starters?: FotMobLineupPlayer[] };
      awayTeam?: { starters?: FotMobLineupPlayer[] };
    };
  };
};

type FotMobLineupPlayer = {
  name?: string;
  positionId?: number;
  usualPlayingPositionId?: number;
};

export type FotMobLookupInput = {
  fixtureId: string;
  kickoffAt?: string;
  homeTeamEn?: string;
  awayTeamEn?: string;
};

type CacheEntry<T> = { expiresAt: number; value: Promise<T> };
const matchesCache = new Map<string, CacheEntry<FotMobMatchesResponse>>();
const detailCache = new Map<number, CacheEntry<FotMobDetailResponse>>();

function normalizeName(value: string | undefined): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .replace(/^(fc|cf|ac|sc|afc)/, "")
    .replace(/(fc|cf|ac|sc|afc|women|wfc|u23|u21|ii|reserves?)$/g, "");
}

function namesMatch(left: string, right: string): boolean {
  if (!left || !right) return false;
  return left === right || (Math.min(left.length, right.length) >= 5 && (left.includes(right) || right.includes(left)));
}

function parseNonNegative(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseLiveMinute(status: FotMobStatus | undefined): number | null {
  const value = status?.liveTime?.short || status?.liveTime?.long;
  const minute = Number(String(value ?? "").match(/^\d{1,3}/)?.[0]);
  return Number.isInteger(minute) && minute >= 1 && minute <= 130 ? minute : null;
}

function dateKey(value: string, offset: number): string {
  const timestamp = Date.parse(value) + offset * 86_400_000;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10).replaceAll("-", "") : "";
}

function findCorners(detail: FotMobDetailResponse, period: "All" | "FirstHalf"): { home: number; away: number; total: number } | undefined {
  const groups = detail.content?.stats?.Periods?.[period]?.stats ?? [];
  const cornerStat = groups.flatMap((group) => group.stats ?? []).find((stat) =>
    stat.key?.toLowerCase() === "corners" || stat.title?.toLowerCase() === "corners"
  );
  const home = parseNonNegative(cornerStat?.stats?.[0]);
  const away = parseNonNegative(cornerStat?.stats?.[1]);
  return home !== null && away !== null ? { home, away, total: home + away } : undefined;
}

function findMetric(detail: FotMobDetailResponse, aliases: string[]): LiveMetricPair | undefined {
  const normalizedAliases = new Set(aliases.map((value) => value.replace(/[^a-z0-9]/gi, "").toLowerCase()));
  const groups = detail.content?.stats?.Periods?.All?.stats ?? [];
  const metric = groups.flatMap((group) => group.stats ?? []).find((stat) => {
    const key = String(stat.key ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    const title = String(stat.title ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    return normalizedAliases.has(key) || normalizedAliases.has(title);
  });
  const home = parseNonNegative(String(metric?.stats?.[0] ?? "").match(/\d+(?:\.\d+)?/)?.[0]);
  const away = parseNonNegative(String(metric?.stats?.[1] ?? "").match(/\d+(?:\.\d+)?/)?.[0]);
  return home !== null && away !== null ? { home, away } : undefined;
}

function attackingMetrics(detail: FotMobDetailResponse): LiveAttackingMetrics | undefined {
  const metrics: LiveAttackingMetrics = {
    source: "FotMob",
    possession: findMetric(detail, ["ball possession", "possession"]),
    dangerousAttacks: findMetric(detail, ["dangerous attacks"]),
    finalThirdEntries: findMetric(detail, ["final third entries", "entries into final third"]),
    crosses: findMetric(detail, ["crosses", "total crosses"]),
    accurateCrosses: findMetric(detail, ["accurate crosses"])
  };
  return Object.keys(metrics).length > 1 ? metrics : undefined;
}

function pressureMetrics(detail: FotMobDetailResponse): LivePressureMetrics | undefined {
  const events = detail.content?.matchFacts?.events?.events ?? [];
  const countPair = (predicate: (event: (typeof events)[number]) => boolean): LiveMetricPair | undefined => {
    const matched = events.filter((event) => typeof event.isHome === "boolean" && predicate(event));
    if (matched.length === 0) return undefined;
    return {
      home: matched.filter((event) => event.isHome === true).length,
      away: matched.filter((event) => event.isHome === false).length
    };
  };
  const metrics: LivePressureMetrics = {
    source: "FotMob",
    yellowCards: countPair((event) => /card/i.test(event.type ?? "") && /yellow/i.test(event.card ?? "")),
    redCards: countPair((event) => /card/i.test(event.type ?? "") && /red/i.test(event.card ?? "")),
    substitutions: countPair((event) => /substitution/i.test(event.type ?? ""))
  };
  return Object.keys(metrics).length > 1 ? metrics : undefined;
}

function mapLineupRole(player: FotMobLineupPlayer): string {
  const position = player.positionId ?? player.usualPlayingPositionId ?? 0;
  if (position < 20) return "GK";
  if (position < 50) return "DF";
  if (position < 70) return "MF";
  return "FW";
}

function mapLineupPlayers(players: FotMobLineupPlayer[] | undefined) {
  return (players ?? [])
    .filter((player) => !!player.name?.trim())
    .map((player) => ({
      name: player.name!.trim(),
      role: mapLineupRole(player)
    }));
}

export function findFotMobMatch(input: FotMobLookupInput, payload: FotMobMatchesResponse): FotMobMatch | null {
  const targetHome = normalizeName(input.homeTeamEn);
  const targetAway = normalizeName(input.awayTeamEn);
  const targetKickoff = Date.parse(input.kickoffAt ?? "");
  if (!targetHome || !targetAway || !Number.isFinite(targetKickoff)) return null;

  const candidates = (payload.leagues ?? []).flatMap((league) => league.matches ?? [])
    .filter((match) => {
      const home = normalizeName(match.home?.longName || match.home?.name);
      const away = normalizeName(match.away?.longName || match.away?.name);
      const kickoff = Date.parse(match.status?.utcTime ?? "");
      return namesMatch(home, targetHome)
        && namesMatch(away, targetAway)
        && Number.isFinite(kickoff)
        && Math.abs(kickoff - targetKickoff) <= 18 * 60 * 60_000;
    })
    .sort((left, right) =>
      Math.abs(Date.parse(left.status?.utcTime ?? "") - targetKickoff)
      - Math.abs(Date.parse(right.status?.utcTime ?? "") - targetKickoff)
    );

  return candidates[0]?.id ? candidates[0] : null;
}

export function mapFotMobDetail(input: FotMobLookupInput, detail: FotMobDetailResponse): EspnLiveDetail {
  const status = detail.header?.status;
  const teams = detail.header?.teams ?? [];
  const homeScore = parseNonNegative(teams[0]?.score);
  const awayScore = parseNonNegative(teams[1]?.score);
  const halfTimeEvent = detail.content?.matchFacts?.events?.events?.find((event) =>
    event.type === "Half" && event.halfStrShort === "HT"
  );
  const halfHome = parseNonNegative(halfTimeEvent?.homeScore);
  const halfAway = parseNonNegative(halfTimeEvent?.awayScore);
  const homeLineup = mapLineupPlayers(detail.content?.lineup?.homeTeam?.starters);
  const awayLineup = mapLineupPlayers(detail.content?.lineup?.awayTeam?.starters);
  const mappedStatus = status?.cancelled
    ? "CANCELLED"
    : status?.finished
      ? "FINISHED"
      : status?.ongoing || status?.started
        ? status.reason?.long || status.reason?.short || "LIVE"
        : status?.reason?.long || status?.reason?.short;

  return {
    fixtureId: input.fixtureId,
    kickoffAt: status?.utcTime || detail.general?.matchTimeUTCDate,
    league: detail.general?.leagueName,
    homeTeam: teams[0]?.name || detail.general?.homeTeam?.name,
    awayTeam: teams[1]?.name || detail.general?.awayTeam?.name,
    status: mappedStatus,
    liveMinute: status?.ongoing ? parseLiveMinute(status) ?? undefined : undefined,
    halfTimeScore: halfHome !== null && halfAway !== null ? { home: halfHome, away: halfAway } : undefined,
    finalScore: homeScore !== null && awayScore !== null ? { home: homeScore, away: awayScore } : undefined,
    finalCorners: findCorners(detail, "All"),
    liveAttackingMetrics: attackingMetrics(detail),
    livePressureMetrics: pressureMetrics(detail),
    lineup: homeLineup.length > 0 && awayLineup.length > 0 ? {
      confirmed: true,
      updatedAt: new Date().toISOString(),
      home: homeLineup,
      away: awayLineup
    } : undefined
  };
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(6_000),
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 (compatible; HK-Football-Value-Radar/1.0)"
    }
  });
  if (!response.ok) throw new Error(`FotMob request failed with status ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error("FotMob returned a non-JSON response");
  return response.json() as Promise<T>;
}

function cached<T>(cache: Map<string | number, CacheEntry<T>>, key: string | number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) return existing.value;
  const value = load();
  cache.set(key, { expiresAt: now + CACHE_TTL_MS, value });
  value.catch(() => cache.delete(key));
  return value;
}

async function fetchMatches(date: string): Promise<FotMobMatchesResponse> {
  return cached(matchesCache, date, () => {
    const url = new URL(`${FOTMOB_BASE_URL}/matches`);
    url.searchParams.set("date", date);
    url.searchParams.set("timezone", "Asia/Hong_Kong");
    url.searchParams.set("ccode3", "HKG");
    return fetchJson<FotMobMatchesResponse>(url);
  });
}

async function fetchDetail(matchId: number): Promise<FotMobDetailResponse> {
  return cached(detailCache, matchId, () => {
    const url = new URL(`${FOTMOB_BASE_URL}/matchDetails`);
    url.searchParams.set("matchId", String(matchId));
    return fetchJson<FotMobDetailResponse>(url);
  });
}

export async function fetchFotMobLiveDataByMatchInfo(input: FotMobLookupInput): Promise<EspnLiveDetail | null> {
  if (!input.kickoffAt || !input.homeTeamEn || !input.awayTeamEn) return null;

  for (const offset of [0, -1, 1]) {
    const date = dateKey(input.kickoffAt, offset);
    if (!date) continue;
    const match = findFotMobMatch(input, await fetchMatches(date));
    if (match?.id) return mapFotMobDetail(input, await fetchDetail(match.id));
  }
  return null;
}