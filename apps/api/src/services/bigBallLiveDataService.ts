import {
  BigBallSportsClient,
  type CanonicalEvent,
  type CanonicalMatch,
  type CanonicalPlayer,
  type CanonicalScore,
  type CanonicalStat,
  type Match
} from "@bigballsdata/sdk";
import type { LiveAttackingMetrics, LiveMetricPair, LivePressureMetrics, MatchLineup } from "../types.js";
import type { EspnLiveDetail } from "./espnLiveDataService.js";

const DEFAULT_BASE_URL = "https://api.bigballsdata.com";

export type BigBallLookupInput = {
  fixtureId: string;
  kickoffAt?: string;
  homeTeamEn?: string;
  awayTeamEn?: string;
};

type BigBallClient = Pick<BigBallSportsClient, "matches">;
type MatchWithCore = Match & Partial<CanonicalMatch>;

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asCanonicalMatches(value: unknown): CanonicalMatch[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CanonicalMatch => {
    const record = asRecord(item);
    return typeof record?.id === "string"
      && typeof record?.start_time === "string"
      && !!asRecord(record?.home)
      && !!asRecord(record?.away);
  });
}

function matchCandidates(payload: unknown): CanonicalMatch[] {
  if (!Array.isArray(payload)) return [];
  const direct = asCanonicalMatches(payload);
  const historical = payload.flatMap((item) => {
    const record = asRecord(item);
    const envelope = asRecord(record?.historical);
    return asCanonicalMatches(envelope?.value);
  });
  return [...direct, ...historical];
}

export function findBigBallMatch(input: BigBallLookupInput, payload: unknown): CanonicalMatch | null {
  const targetHome = normalizeName(input.homeTeamEn);
  const targetAway = normalizeName(input.awayTeamEn);
  const targetKickoff = Date.parse(input.kickoffAt ?? "");
  if (!targetHome || !targetAway || !Number.isFinite(targetKickoff)) return null;

  const candidates = matchCandidates(payload)
    .filter((match) => namesMatch(normalizeName(match.home.team_name), targetHome)
      && namesMatch(normalizeName(match.away.team_name), targetAway)
      && Number.isFinite(Date.parse(match.start_time))
      && Math.abs(Date.parse(match.start_time) - targetKickoff) <= 18 * 60 * 60_000)
    .sort((left, right) => Math.abs(Date.parse(left.start_time) - targetKickoff) - Math.abs(Date.parse(right.start_time) - targetKickoff));
  return candidates[0] ?? null;
}

function fieldValue<T>(detail: MatchWithCore, field: keyof Match): readonly T[] {
  const envelope = detail[field];
  if (!envelope || !Array.isArray(envelope.value)) return [];
  return envelope.value as readonly T[];
}

function metricPair(stats: readonly CanonicalStat[], match: CanonicalMatch, metric: CanonicalStat["metric"]): LiveMetricPair | undefined {
  const home = stats.find((stat) => stat.team_id === match.home.team_id && stat.metric === metric)?.value;
  const away = stats.find((stat) => stat.team_id === match.away.team_id && stat.metric === metric)?.value;
  return Number.isFinite(home) && Number.isFinite(away) ? { home: home!, away: away! } : undefined;
}

function eventPair(events: readonly CanonicalEvent[], match: CanonicalMatch, types: CanonicalEvent["type"][]): LiveMetricPair | undefined {
  const matching = events.filter((event) => types.includes(event.type));
  const sided = matching.filter((event) => event.team_id === match.home.team_id || event.team_id === match.away.team_id);
  if (sided.length === 0) return undefined;
  return {
    home: sided.filter((event) => event.team_id === match.home.team_id).length,
    away: sided.filter((event) => event.team_id === match.away.team_id).length
  };
}

function playerRole(position: string | undefined): string {
  const value = String(position ?? "").toLowerCase();
  if (/goalkeeper|keeper|\bgk\b/.test(value)) return "GK";
  if (/defender|back|\bdf\b/.test(value)) return "DF";
  if (/midfield|\bmf\b/.test(value)) return "MF";
  if (/forward|striker|winger|\bfw\b/.test(value)) return "FW";
  return "Unknown";
}

function mapLineup(players: readonly CanonicalPlayer[], match: CanonicalMatch): MatchLineup | undefined {
  const map = (teamId: string) => players
    .filter((player) => player.current_team_id === teamId)
    .map((player) => ({ name: player.display_name || player.full_name, role: playerRole(player.position) }))
    .filter((player) => player.name.trim().length > 0);
  const home = map(match.home.team_id);
  const away = map(match.away.team_id);
  return home.length > 0 && away.length > 0 ? {
    confirmed: true,
    updatedAt: new Date().toISOString(),
    home,
    away
  } : undefined;
}

export function mapBigBallDetail(input: BigBallLookupInput, match: CanonicalMatch, detail: MatchWithCore): EspnLiveDetail {
  const scores = fieldValue<CanonicalScore>(detail, "scores");
  const stats = fieldValue<CanonicalStat>(detail, "stats");
  const events = fieldValue<CanonicalEvent>(detail, "events");
  const players = fieldValue<CanonicalPlayer>(detail, "lineups");
  const score = scores.find((item) => item.match_id === match.id) ?? match.score;
  const halfTime = score?.period_scores?.find((period) => /half|1st/i.test(period.label) || period.period === 1);
  const corners = metricPair(stats, match, "corners");
  const possession = metricPair(stats, match, "possession_percent");
  const yellowCards = metricPair(stats, match, "cards_yellow") ?? eventPair(events, match, ["card_yellow"]);
  const redCards = metricPair(stats, match, "cards_red") ?? eventPair(events, match, ["card_red"]);
  const substitutions = eventPair(events, match, ["substitution"]);
  const attackingMetrics: LiveAttackingMetrics = { source: "BigBall", possession };
  const pressureMetrics: LivePressureMetrics = { source: "BigBall", yellowCards, redCards, substitutions };
  const isLive = score?.status === "in_progress" || match.status === "in_progress";

  return {
    fixtureId: input.fixtureId,
    kickoffAt: match.start_time,
    homeTeam: match.home.team_name,
    awayTeam: match.away.team_name,
    status: score?.status ?? match.status,
    liveMinute: isLive && score?.clock ? Math.max(1, Math.floor(score.clock.elapsed_seconds / 60)) : undefined,
    finalScore: score?.home !== null && score?.away !== null && score?.home !== undefined && score?.away !== undefined
      ? { home: score.home, away: score.away }
      : undefined,
    halfTimeScore: halfTime ? { home: halfTime.home, away: halfTime.away } : undefined,
    finalCorners: corners ? { ...corners, total: corners.home + corners.away } : undefined,
    liveAttackingMetrics: possession ? attackingMetrics : undefined,
    livePressureMetrics: yellowCards || redCards || substitutions ? pressureMetrics : undefined,
    lineup: mapLineup(players, match)
  };
}

function dateKey(value: string, dayOffset = 0): string {
  const timestamp = Date.parse(value) + dayOffset * 86_400_000;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : "";
}

export async function fetchBigBallLiveDataByMatchInfo(
  input: BigBallLookupInput,
  client?: BigBallClient
): Promise<EspnLiveDetail | null> {
  if (!input.kickoffAt || !input.homeTeamEn || !input.awayTeamEn) return null;
  const apiKey = process.env.BIGBALL_API_KEY?.trim();
  if (!client && !apiKey) return null;
  const sdk = client ?? new BigBallSportsClient(apiKey!, {
    baseUrl: process.env.BIGBALL_API_BASE_URL?.trim() || DEFAULT_BASE_URL,
    timeoutMs: 8_000
  });

  for (const offset of [0, -1, 1]) {
    const date = dateKey(input.kickoffAt, offset);
    if (!date) continue;
    const response = await sdk.matches.list({ sport: "football", date, limit: 100 });
    if (response.error) throw new Error(`BigBall matches.list failed: ${response.error.message}`);
    const match = findBigBallMatch(input, response.data);
    if (!match) continue;
    const detailResponse = await sdk.matches.get(match.id, ["scores", "stats", "events", "lineups"], "football");
    if (detailResponse.error) throw new Error(`BigBall matches.get failed: ${detailResponse.error.message}`);
    return mapBigBallDetail(input, match, detailResponse.data as MatchWithCore);
  }
  return null;
}