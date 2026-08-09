const THE_SPORTS_DB_BASE_URL = "https://www.thesportsdb.com/api/v1/json";
const THE_SPORTS_DB_API_KEY = process.env.THESPORTSDB_API_KEY?.trim() || "123";

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
  intHomeHalfScore?: string | number | null;
  intAwayHalfScore?: string | number | null;
};

type SportsDbSearchResponse = {
  event?: SportsDbEvent[];
};

type SportsDbDayResponse = {
  events?: SportsDbEvent[];
};

export type TheSportsDbResultDetail = {
  fixtureId: string;
  kickoffAt?: string;
  league?: string;
  homeTeam?: string;
  awayTeam?: string;
  halfTimeScore?: {
    home: number;
    away: number;
  };
  finalScore?: {
    home: number;
    away: number;
  };
};

type MatchLookupInput = {
  fixtureId: string;
  kickoffAt?: string;
  homeTeamEn?: string;
  awayTeamEn?: string;
  match?: string;
};

function parseNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIsoDate(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return null;
  }

  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = `${d.getUTCMonth() + 1}`.padStart(2, "0");
  const dd = `${d.getUTCDate()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseKickoff(event: SportsDbEvent): string | null {
  if (event.strTimestamp) {
    const ts = Date.parse(event.strTimestamp);
    if (Number.isFinite(ts)) {
      return new Date(ts).toISOString();
    }
  }

  if (event.dateEvent) {
    const fallback = Date.parse(`${event.dateEvent}T${event.strTime?.trim() || "00:00:00"}Z`);
    if (Number.isFinite(fallback)) {
      return new Date(fallback).toISOString();
    }
  }

  return null;
}

function normalizeName(value: string | undefined): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "")
    .replace(/^(fc|cf|ac|sc|fk|ifk|bk)/, "")
    .replace(/(fc|cf|ac|sc|fk|ifk|bk|women|wfc|u23|u21|ii|reserves?)$/g, "")
    .trim();
}

function nameSimilarity(left: string, right: string): number {
  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  if (left.includes(right) || right.includes(left)) {
    return 0.82;
  }

  const leftTokens = new Set(left.match(/[a-z0-9]{2,}/g) ?? []);
  const rightTokens = new Set(right.match(/[a-z0-9]{2,}/g) ?? []);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let common = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      common += 1;
    }
  }

  const overlap = common / Math.max(leftTokens.size, rightTokens.size, 1);
  return overlap >= 0.45 ? overlap : 0;
}

function addDaysIsoDate(isoDate: string, days: number): string {
  const base = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(base)) {
    return isoDate;
  }

  const next = new Date(base + days * 86400000);
  const yyyy = next.getUTCFullYear();
  const mm = `${next.getUTCMonth() + 1}`.padStart(2, "0");
  const dd = `${next.getUTCDate()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toEnglishTeamName(value: string | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }

  const hasLatin = /[a-z]/i.test(raw);
  if (!hasLatin) {
    return "";
  }

  return raw;
}

function splitMatchText(match: string | undefined): { home?: string; away?: string } {
  const raw = String(match ?? "").trim();
  if (!raw) {
    return {};
  }

  const separators = [" vs ", " VS ", " v ", " @ ", "-", "對", "对"];
  for (const separator of separators) {
    const index = raw.indexOf(separator);
    if (index > 0) {
      const home = raw.slice(0, index).trim();
      const away = raw.slice(index + separator.length).trim();
      if (home && away) {
        return { home, away };
      }
    }
  }

  return {};
}

function eventMatchScore(event: SportsDbEvent, target: { home: string; away: string; date?: string | null }): number {
  const eventHome = normalizeName(event.strHomeTeam);
  const eventAway = normalizeName(event.strAwayTeam);
  if (!eventHome || !eventAway) {
    return -1;
  }

  const direct = (nameSimilarity(eventHome, target.home) + nameSimilarity(eventAway, target.away)) / 2;
  const swapped = (nameSimilarity(eventHome, target.away) + nameSimilarity(eventAway, target.home)) / 2;
  const bestTeamScore = Math.max(direct, swapped * 0.9);

  if (bestTeamScore < 0.6) {
    return -1;
  }

  let score = 1.8 + bestTeamScore * 1.7;
  if (target.date) {
    const eventDate = toIsoDate(parseKickoff(event) ?? event.dateEvent ?? undefined);
    if (eventDate === target.date) {
      score += 2;
    } else if (eventDate === addDaysIsoDate(target.date, -1) || eventDate === addDaysIsoDate(target.date, 1)) {
      score += 1;
    }
  }

  return score;
}

async function fetchByQuery(query: string): Promise<SportsDbEvent[]> {
  const url = `${THE_SPORTS_DB_BASE_URL}/${THE_SPORTS_DB_API_KEY}/searchevents.php?e=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    }
  });

  if (!response.ok) {
    throw new Error(`TheSportsDB searchevents failed with status ${response.status}`);
  }

  const payload = (await response.json()) as SportsDbSearchResponse;
  return payload.event ?? [];
}

async function fetchByDate(date: string): Promise<SportsDbEvent[]> {
  const url = `${THE_SPORTS_DB_BASE_URL}/${THE_SPORTS_DB_API_KEY}/eventsday.php?d=${encodeURIComponent(date)}&s=Soccer`;
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    }
  });

  if (!response.ok) {
    throw new Error(`TheSportsDB eventsday failed with status ${response.status}`);
  }

  const payload = (await response.json()) as SportsDbDayResponse;
  return payload.events ?? [];
}

function toResultDetail(fixtureId: string, event: SportsDbEvent): TheSportsDbResultDetail {
  const finalHome = parseNumber(event.intHomeScore);
  const finalAway = parseNumber(event.intAwayScore);
  const halfHome = parseNumber(event.intHomeHalfScore);
  const halfAway = parseNumber(event.intAwayHalfScore);

  return {
    fixtureId,
    kickoffAt: parseKickoff(event) ?? undefined,
    league: String(event.strLeague ?? "").trim() || undefined,
    homeTeam: String(event.strHomeTeam ?? "").trim() || undefined,
    awayTeam: String(event.strAwayTeam ?? "").trim() || undefined,
    finalScore:
      finalHome !== null && finalAway !== null
        ? {
            home: finalHome,
            away: finalAway
          }
        : undefined,
    halfTimeScore:
      halfHome !== null && halfAway !== null
        ? {
            home: halfHome,
            away: halfAway
          }
        : undefined
  };
}

export async function fetchTheSportsDbResultByMatchInfo(input: MatchLookupInput): Promise<TheSportsDbResultDetail | null> {
  const homeFromMatch = splitMatchText(input.match).home;
  const awayFromMatch = splitMatchText(input.match).away;

  const home = toEnglishTeamName(input.homeTeamEn || homeFromMatch || "");
  const away = toEnglishTeamName(input.awayTeamEn || awayFromMatch || "");
  const normalizedHome = normalizeName(home);
  const normalizedAway = normalizeName(away);

  if (!normalizedHome || !normalizedAway) {
    return null;
  }

  const targetDate = toIsoDate(input.kickoffAt);
  const candidateQueries = [...new Set([`${home} vs ${away}`, `${home} v ${away}`, `${away} vs ${home}`])];

  const candidates: SportsDbEvent[] = [];
  for (const query of candidateQueries) {
    try {
      candidates.push(...(await fetchByQuery(query)));
    } catch (error) {
      console.warn(`[history] TheSportsDB searchevents lookup failed for query: ${query}.`, error);
    }
  }

  if (targetDate) {
    const candidateDates = [...new Set([targetDate, addDaysIsoDate(targetDate, -1), addDaysIsoDate(targetDate, 1)])];
    try {
      for (const date of candidateDates) {
        candidates.push(...(await fetchByDate(date)));
      }
    } catch (error) {
      console.warn(`[history] TheSportsDB eventsday lookup failed for date window: ${candidateDates.join(",")}.`, error);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const ranked = candidates
    .map((event) => ({ event, score: eventMatchScore(event, { home: normalizedHome, away: normalizedAway, date: targetDate }) }))
    .filter((entry) => entry.score >= 2.6)
    .sort((left, right) => right.score - left.score);

  if (ranked.length === 0) {
    return null;
  }

  const best = ranked[0]?.event;
  if (!best) {
    return null;
  }

  const detail = toResultDetail(input.fixtureId, best);
  if (!detail.finalScore && !detail.halfTimeScore) {
    return null;
  }

  return detail;
}
