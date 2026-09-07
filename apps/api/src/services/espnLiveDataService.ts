import type { LiveAttackingMetrics, MatchLineup } from "../types.js";
import type { TheSportsDbResultDetail } from "./theSportsDbResultsService.js";

const ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard";

type EspnCompetitor = {
  homeAway?: string;
  score?: string | number;
  team?: {
    displayName?: string;
    shortDisplayName?: string;
    name?: string;
  };
  statistics?: Array<{
    name?: string;
    displayValue?: string;
    value?: number;
  }>;
};

type EspnEvent = {
  id?: string;
  date?: string;
  name?: string;
  competitions?: Array<{
    competitors?: EspnCompetitor[];
    status?: {
      displayClock?: string;
      type?: {
        state?: string;
        completed?: boolean;
        description?: string;
        detail?: string;
      };
    };
  }>;
};

type EspnScoreboardResponse = {
  events?: EspnEvent[];
};

type EspnLookupInput = {
  fixtureId: string;
  kickoffAt?: string;
  homeTeamEn?: string;
  awayTeamEn?: string;
};

export type EspnLiveDetail = TheSportsDbResultDetail & {
  finalCorners?: {
    home: number;
    away: number;
    total: number;
  };
  lineup?: MatchLineup;
  liveAttackingMetrics?: LiveAttackingMetrics;
};

function normalizeName(value: string | undefined): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .replace(/^(fc|cf|ac|sc)/, "")
    .replace(/(fc|cf|ac|sc|women|wfc|u23|u21|ii|reserves?)$/g, "");
}

function namesMatch(left: string, right: string): boolean {
  if (!left || !right) return false;
  return left === right || (Math.min(left.length, right.length) >= 5 && (left.includes(right) || right.includes(left)));
}

function parseNumber(value: string | number | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseClock(value: string | undefined): number | null {
  const normalized = String(value ?? "").trim();
  const stoppage = normalized.match(/^(\d{1,3})\s*\+\s*(\d{1,2})/);
  const minute = stoppage ? Number(stoppage[1]) + Number(stoppage[2]) : Number(normalized.match(/^\d{1,3}/)?.[0]);
  return Number.isInteger(minute) && minute >= 1 && minute <= 130 ? minute : null;
}

function cornerCount(competitor: EspnCompetitor | undefined): number | null {
  const statistic = competitor?.statistics?.find((item) => /^(cornerkicks|corners|woncorners)$/i.test(item.name ?? ""));
  return parseNumber(statistic?.value ?? statistic?.displayValue);
}

function statisticValue(competitor: EspnCompetitor | undefined, names: RegExp): number | null {
  const statistic = competitor?.statistics?.find((item) => names.test(item.name ?? ""));
  const raw = statistic?.value ?? String(statistic?.displayValue ?? "").match(/\d+(?:\.\d+)?/)?.[0];
  return parseNumber(raw);
}

function attackingMetrics(home: EspnCompetitor | undefined, away: EspnCompetitor | undefined): LiveAttackingMetrics | undefined {
  const pair = (names: RegExp) => {
    const homeValue = statisticValue(home, names);
    const awayValue = statisticValue(away, names);
    return homeValue !== null && awayValue !== null ? { home: homeValue, away: awayValue } : undefined;
  };
  const metrics: LiveAttackingMetrics = {
    source: "ESPN",
    possession: pair(/^(possession|possessionpct|possessionpercentage)$/i),
    dangerousAttacks: pair(/^dangerousattacks$/i),
    finalThirdEntries: pair(/^(finalthirdentries|entriesfinalthird)$/i),
    crosses: pair(/^(crosses|totalcrosses)$/i),
    accurateCrosses: pair(/^(accuratecrosses|crossesaccurate)$/i)
  };
  return Object.keys(metrics).length > 1 ? metrics : undefined;
}

function dateKey(value: string, dayOffset = 0): string {
  const timestamp = Date.parse(value) + dayOffset * 86_400_000;
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toISOString().slice(0, 10).replaceAll("-", "");
}

export function mapEspnEventToLiveDetail(input: EspnLookupInput, event: EspnEvent): EspnLiveDetail | null {
  const competition = event.competitions?.[0];
  const home = competition?.competitors?.find((item) => item.homeAway === "home");
  const away = competition?.competitors?.find((item) => item.homeAway === "away");
  const eventHome = normalizeName(home?.team?.displayName || home?.team?.shortDisplayName || home?.team?.name);
  const eventAway = normalizeName(away?.team?.displayName || away?.team?.shortDisplayName || away?.team?.name);
  const targetHome = normalizeName(input.homeTeamEn);
  const targetAway = normalizeName(input.awayTeamEn);

  if (!namesMatch(eventHome, targetHome) || !namesMatch(eventAway, targetAway)) return null;

  const targetKickoff = Date.parse(input.kickoffAt ?? "");
  const eventKickoff = Date.parse(event.date ?? "");
  if (Number.isFinite(targetKickoff) && Number.isFinite(eventKickoff) && Math.abs(targetKickoff - eventKickoff) > 18 * 60 * 60_000) {
    return null;
  }

  const homeScore = parseNumber(home?.score);
  const awayScore = parseNumber(away?.score);
  const homeCorners = cornerCount(home);
  const awayCorners = cornerCount(away);
  const status = competition?.status?.type?.description || competition?.status?.type?.detail;
  const liveMinute = competition?.status?.type?.state === "in" ? parseClock(competition.status.displayClock) : null;

  return {
    fixtureId: input.fixtureId,
    kickoffAt: event.date,
    homeTeam: home?.team?.displayName,
    awayTeam: away?.team?.displayName,
    status,
    liveMinute: liveMinute ?? undefined,
    finalScore: homeScore !== null && awayScore !== null ? { home: homeScore, away: awayScore } : undefined,
    finalCorners: homeCorners !== null && awayCorners !== null
      ? { home: homeCorners, away: awayCorners, total: homeCorners + awayCorners }
      : undefined,
    liveAttackingMetrics: attackingMetrics(home, away)
  };
}

async function fetchScoreboard(date: string): Promise<EspnEvent[]> {
  const response = await fetch(`${ESPN_SCOREBOARD_URL}?dates=${date}&limit=1000`, {
    signal: AbortSignal.timeout(5_000),
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0" }
  });
  if (!response.ok) throw new Error(`ESPN scoreboard failed with status ${response.status}`);
  return ((await response.json()) as EspnScoreboardResponse).events ?? [];
}

export async function fetchEspnLiveDataByMatchInfo(input: EspnLookupInput): Promise<EspnLiveDetail | null> {
  if (!input.kickoffAt || !input.homeTeamEn || !input.awayTeamEn) return null;

  for (const offset of [0, -1, 1]) {
    const date = dateKey(input.kickoffAt, offset);
    if (!date) continue;
    const events = await fetchScoreboard(date);
    for (const event of events) {
      const detail = mapEspnEventToLiveDetail(input, event);
      if (detail) return detail;
    }
  }
  return null;
}
