import type { LiveAttackingMetrics, LiveMetricPair, LivePressureMetrics, MatchLineup } from "../types.js";
import type { EspnLiveDetail } from "./espnLiveDataService.js";

const DEFAULT_BASE_URL = "https://soccer.highlightly.net";
const CACHE_TTL_MS = 60_000;

type HighlightlyTeam = { id?: number; name?: string };
type HighlightlyState = {
  description?: string;
  status?: string;
  minute?: number | string;
  clock?: number | string;
  score?: unknown;
};
type HighlightlyMatch = {
  id?: number;
  date?: string;
  homeTeam?: HighlightlyTeam;
  awayTeam?: HighlightlyTeam;
  league?: { name?: string };
  state?: HighlightlyState;
  events?: unknown[];
  statistics?: unknown[];
};
type HighlightlyLookupInput = {
  fixtureId: string;
  kickoffAt?: string;
  homeTeamEn?: string;
  awayTeamEn?: string;
};
type HighlightlyMatchPayload = HighlightlyMatch[] | { data?: HighlightlyMatch[] };
type HighlightlyRequestOptions = {
  apiKey?: string;
  baseUrl?: string;
};
type CacheEntry = { expiresAt: number; value: Promise<unknown> };

const responseCache = new Map<string, CacheEntry>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  return Array.isArray(record?.data) ? record.data : [];
}

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
  const match = String(value ?? "").match(/\d+(?:\.\d+)?/);
  const parsed = Number(match?.[0]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseMinute(state: HighlightlyState | undefined): number | null {
  const minute = parseNonNegative(state?.minute ?? state?.clock);
  return minute !== null && Number.isInteger(minute) && minute >= 1 && minute <= 130 ? minute : null;
}

function parseScore(value: unknown): { home: number; away: number } | undefined {
  if (typeof value === "string") {
    const values = value.match(/\d+/g)?.map(Number) ?? [];
    return values.length >= 2 ? { home: values[0], away: values[1] } : undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  const home = parseNonNegative(record.home ?? record.homeTeam ?? record.local);
  const away = parseNonNegative(record.away ?? record.awayTeam ?? record.visitor);
  return home !== null && away !== null ? { home, away } : undefined;
}

function nestedScore(state: HighlightlyState | undefined, keys: string[]): { home: number; away: number } | undefined {
  let value: unknown = state?.score;
  for (const key of keys) value = asRecord(value)?.[key];
  return parseScore(value);
}

function statisticName(value: unknown): string {
  const record = asRecord(value);
  return String(record?.name ?? record?.type ?? record?.title ?? record?.key ?? "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function statisticNumber(value: unknown): number | null {
  const record = asRecord(value);
  return parseNonNegative(record?.value ?? record?.displayValue ?? record?.display ?? record?.total);
}

function teamStatistics(payload: unknown, team: HighlightlyTeam | undefined): unknown[] {
  const targetName = normalizeName(team?.name);
  const entry = asArray(payload).find((item) => {
    const record = asRecord(item);
    const entryTeam = asRecord(record?.team);
    return (team?.id !== undefined && Number(entryTeam?.id) === team.id)
      || namesMatch(normalizeName(String(entryTeam?.name ?? "")), targetName);
  });
  const record = asRecord(entry);
  return asArray(record?.statistics ?? record?.stats);
}

function statisticPair(payload: unknown, homeTeam: HighlightlyTeam | undefined, awayTeam: HighlightlyTeam | undefined, aliases: string[]): LiveMetricPair | undefined {
  const wanted = new Set(aliases.map((alias) => alias.replace(/[^a-z0-9]/gi, "").toLowerCase()));
  const find = (team: HighlightlyTeam | undefined) => {
    const statistic = teamStatistics(payload, team).find((item) => wanted.has(statisticName(item)));
    return statisticNumber(statistic);
  };
  const home = find(homeTeam);
  const away = find(awayTeam);
  return home !== null && away !== null ? { home, away } : undefined;
}

function eventTeamMatches(event: unknown, team: HighlightlyTeam | undefined): boolean {
  const eventTeam = asRecord(asRecord(event)?.team);
  return (team?.id !== undefined && Number(eventTeam?.id) === team.id)
    || namesMatch(normalizeName(String(eventTeam?.name ?? "")), normalizeName(team?.name));
}

function eventPair(eventsPayload: unknown, homeTeam: HighlightlyTeam | undefined, awayTeam: HighlightlyTeam | undefined, type: RegExp): LiveMetricPair | undefined {
  const matched = asArray(eventsPayload).filter((event) => type.test(String(asRecord(event)?.type ?? "")));
  const sided = matched.filter((event) => eventTeamMatches(event, homeTeam) || eventTeamMatches(event, awayTeam));
  if (sided.length === 0) return undefined;
  return {
    home: sided.filter((event) => eventTeamMatches(event, homeTeam)).length,
    away: sided.filter((event) => eventTeamMatches(event, awayTeam)).length
  };
}

function mapPlayer(value: unknown): { name: string; role: string } | null {
  const record = asRecord(value);
  const player = asRecord(record?.player) ?? record;
  const name = String(player?.name ?? player?.fullName ?? "").trim();
  if (!name) return null;
  const position = String(record?.position ?? player?.position ?? "").toLowerCase();
  const role = /goalkeeper|keeper|\bgk\b/.test(position) ? "GK"
    : /defender|back|\bdf\b/.test(position) ? "DF"
      : /midfield|\bmf\b/.test(position) ? "MF"
        : /forward|striker|winger|\bfw\b/.test(position) ? "FW" : "Unknown";
  return { name, role };
}

function lineupPlayers(value: unknown): Array<{ name: string; role: string }> {
  const team = asRecord(value);
  const rows = asArray(team?.initialLineup ?? team?.lineup ?? team?.starters).flatMap((row) => {
    if (Array.isArray(row)) return row;
    const record = asRecord(row);
    return Array.isArray(record?.players) ? record.players : [row];
  });
  return rows.map(mapPlayer).filter((player): player is { name: string; role: string } => player !== null);
}

function mapLineup(payload: unknown): MatchLineup | undefined {
  const record = asRecord(payload);
  const home = lineupPlayers(record?.homeTeam ?? record?.home);
  const away = lineupPlayers(record?.awayTeam ?? record?.away);
  return home.length > 0 && away.length > 0 ? {
    confirmed: true,
    updatedAt: new Date().toISOString(),
    home,
    away
  } : undefined;
}

export function findHighlightlyMatch(input: HighlightlyLookupInput, payload: HighlightlyMatchPayload): HighlightlyMatch | null {
  const targetHome = normalizeName(input.homeTeamEn);
  const targetAway = normalizeName(input.awayTeamEn);
  const targetKickoff = Date.parse(input.kickoffAt ?? "");
  if (!targetHome || !targetAway || !Number.isFinite(targetKickoff)) return null;

  const candidates = asArray(payload).filter((value): value is HighlightlyMatch => !!asRecord(value))
    .filter((match) => {
      const kickoff = Date.parse(match.date ?? "");
      return namesMatch(normalizeName(match.homeTeam?.name), targetHome)
        && namesMatch(normalizeName(match.awayTeam?.name), targetAway)
        && Number.isFinite(kickoff)
        && Math.abs(kickoff - targetKickoff) <= 18 * 60 * 60_000;
    })
    .sort((left, right) => Math.abs(Date.parse(left.date ?? "") - targetKickoff) - Math.abs(Date.parse(right.date ?? "") - targetKickoff));
  return candidates[0]?.id ? candidates[0] : null;
}

export function mapHighlightlyDetail(
  input: HighlightlyLookupInput,
  match: HighlightlyMatch,
  statisticsPayload: unknown = match.statistics,
  eventsPayload: unknown = match.events,
  lineupPayload?: unknown
): EspnLiveDetail {
  const finalScore = nestedScore(match.state, ["current"])
    ?? nestedScore(match.state, ["fullTime"])
    ?? parseScore(match.state?.score);
  const halfTimeScore = nestedScore(match.state, ["halfTime"])
    ?? nestedScore(match.state, ["halftime"]);
  const corners = statisticPair(statisticsPayload, match.homeTeam, match.awayTeam, ["corners", "corner kicks"]);
  const attackingMetrics: LiveAttackingMetrics = {
    source: "Highlightly",
    possession: statisticPair(statisticsPayload, match.homeTeam, match.awayTeam, ["possession", "ball possession"]),
    dangerousAttacks: statisticPair(statisticsPayload, match.homeTeam, match.awayTeam, ["dangerous attacks"]),
    finalThirdEntries: statisticPair(statisticsPayload, match.homeTeam, match.awayTeam, ["final third entries", "entries into final third"]),
    crosses: statisticPair(statisticsPayload, match.homeTeam, match.awayTeam, ["crosses", "total crosses"]),
    accurateCrosses: statisticPair(statisticsPayload, match.homeTeam, match.awayTeam, ["accurate crosses", "successful crosses"])
  };
  const pressureMetrics: LivePressureMetrics = {
    source: "Highlightly",
    yellowCards: eventPair(eventsPayload, match.homeTeam, match.awayTeam, /^yellow card$/i),
    redCards: eventPair(eventsPayload, match.homeTeam, match.awayTeam, /^(red card|second yellow card)$/i),
    substitutions: eventPair(eventsPayload, match.homeTeam, match.awayTeam, /^substitution$/i)
  };
  const status = match.state?.description ?? match.state?.status;
  const isLive = /first half|second half|half time|extra time|penalties|in progress|live/i.test(status ?? "");
  const hasAttackingMetrics = Object.entries(attackingMetrics).some(([key, value]) => key !== "source" && value !== undefined);
  const hasPressureMetrics = Object.entries(pressureMetrics).some(([key, value]) => key !== "source" && value !== undefined);

  return {
    fixtureId: input.fixtureId,
    kickoffAt: match.date,
    league: match.league?.name,
    homeTeam: match.homeTeam?.name,
    awayTeam: match.awayTeam?.name,
    status,
    liveMinute: isLive ? parseMinute(match.state) ?? undefined : undefined,
    finalScore,
    halfTimeScore,
    finalCorners: corners ? { ...corners, total: corners.home + corners.away } : undefined,
    liveAttackingMetrics: hasAttackingMetrics ? attackingMetrics : undefined,
    livePressureMetrics: hasPressureMetrics ? pressureMetrics : undefined,
    lineup: mapLineup(lineupPayload)
  };
}

function dateKey(value: string, dayOffset = 0): string {
  const timestamp = Date.parse(value) + dayOffset * 86_400_000;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : "";
}

async function requestJson(pathname: string, options: HighlightlyRequestOptions, query?: Record<string, string>): Promise<unknown> {
  const apiKey = options.apiKey?.trim() || process.env.HIGHLIGHTLY_API_KEY?.trim();
  if (!apiKey) throw new Error("HIGHLIGHTLY_API_KEY is required");
  const baseUrl = options.baseUrl?.trim() || process.env.HIGHLIGHTLY_API_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const url = new URL(pathname, baseUrl);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  const cacheKey = url.toString();
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = fetch(url, {
    signal: AbortSignal.timeout(8_000),
    headers: {
      accept: "application/json",
      "x-rapidapi-key": apiKey,
      ...(url.hostname.endsWith("rapidapi.com") ? { "x-rapidapi-host": url.hostname } : {})
    }
  }).then(async (response) => {
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Highlightly request failed with status ${response.status} (${url.pathname})`);
    return response.json() as Promise<unknown>;
  });
  responseCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  value.catch(() => responseCache.delete(cacheKey));
  return value;
}

export async function fetchHighlightlyLiveDataByMatchInfo(
  input: HighlightlyLookupInput,
  options: HighlightlyRequestOptions = {}
): Promise<EspnLiveDetail | null> {
  if (!input.kickoffAt || !input.homeTeamEn || !input.awayTeamEn) return null;
  if (!(options.apiKey?.trim() || process.env.HIGHLIGHTLY_API_KEY?.trim())) return null;

  for (const offset of [0, -1, 1]) {
    const date = dateKey(input.kickoffAt, offset);
    if (!date) continue;
    const payload = await requestJson("/matches", options, {
      date,
      timezone: "Asia/Hong_Kong",
      homeTeamName: input.homeTeamEn,
      awayTeamName: input.awayTeamEn,
      limit: "100"
    });
    const match = findHighlightlyMatch(input, payload as HighlightlyMatchPayload);
    if (!match?.id) continue;
    const responses = await Promise.allSettled([
      requestJson(`/matches/${match.id}`, options),
      requestJson(`/statistics/${match.id}`, options),
      requestJson(`/events/${match.id}`, options),
      requestJson(`/lineups/${match.id}`, options)
    ]);
    const [detailPayload, statistics, events, lineup] = responses.map((response) =>
      response.status === "fulfilled" ? response.value : null
    );
    const detail = asArray(detailPayload)[0] as HighlightlyMatch | undefined
      ?? asRecord(detailPayload) as HighlightlyMatch | null
      ?? match;
    return mapHighlightlyDetail(input, detail, statistics, events, lineup);
  }
  return null;
}