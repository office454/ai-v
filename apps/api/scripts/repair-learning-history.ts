import path from "node:path";
import { promises as fs } from "node:fs";
import { fetchHkjcResultDetailByFixtureId, fetchHkjcResultFixturesWithOptions } from "../src/services/hkjcResultsService.js";
import { fetchTheSportsDbResultByMatchInfo } from "../src/services/theSportsDbResultsService.js";

type Score = { home: number; away: number };
type Corners = { home: number; away: number; total: number };

type LearningRecord = {
  key: string;
  fixtureId: string;
  match?: string;
  kickoffAt?: string;
  matchDateHk?: string;
  league?: string;
  homeTeam?: string;
  awayTeam?: string;
  homeTeamEn?: string;
  awayTeamEn?: string;
  market: string;
  selectionName: string;
  halfTimeScore?: Score;
  finalScore?: Score;
  finalCorners?: Corners;
};

type LearningDb = {
  pending: LearningRecord[];
  settled: LearningRecord[];
};

type MatchCandidate = {
  fixture: any;
  score: number;
  reason: string;
};

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dryRun = !apply;

const WINDOW_DAYS = 3;
const KICKOFF_TOLERANCE_MIN = 18 * 60;
const MIN_MATCH_SCORE = 5.2;

function normalizeName(value: string | undefined): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "")
    .replace(/^(fc|cf|ac|sc)/, "")
    .replace(/(fc|cf|ac|sc)$/g, "")
    .trim();
}

function normalizeLeague(value: string | undefined): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "")
    .trim();
}

function hkDateFromIso(value: string | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(ms));
  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function addDays(isoDate: string, days: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  const next = new Date(ms + days * 86400000);
  const yyyy = next.getUTCFullYear();
  const mm = `${next.getUTCMonth() + 1}`.padStart(2, "0");
  const dd = `${next.getUTCDate()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dateDistanceDays(left: string | null, right: string | null): number {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const l = Date.parse(`${left}T00:00:00Z`);
  const r = Date.parse(`${right}T00:00:00Z`);
  return Math.abs((l - r) / 86400000);
}

function kickoffDistanceMinutes(leftIso: string | undefined, rightIso: string | undefined): number {
  if (!leftIso || !rightIso) return Number.POSITIVE_INFINITY;
  const l = Date.parse(leftIso);
  const r = Date.parse(rightIso);
  if (!Number.isFinite(l) || !Number.isFinite(r)) return Number.POSITIVE_INFINITY;
  return Math.abs((l - r) / 60000);
}

function parseMatchTeams(match: string | undefined): { home?: string; away?: string } {
  const raw = String(match ?? "").trim();
  if (!raw) return {};
  const separators = [" vs ", " VS ", " v ", " @ ", "對", "对", "-"];
  for (const sep of separators) {
    const idx = raw.indexOf(sep);
    if (idx <= 0) continue;
    const home = raw.slice(0, idx).trim();
    const away = raw.slice(idx + sep.length).trim();
    if (home && away) {
      return { home, away };
    }
  }
  return {};
}

function leagueSimilarity(a: string | undefined, b: string | undefined): number {
  const left = normalizeLeague(a);
  const right = normalizeLeague(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.75;

  const leftSet = new Set(left.match(/[a-z0-9\u4e00-\u9fa5]{2,}/g) ?? []);
  const rightSet = new Set(right.match(/[a-z0-9\u4e00-\u9fa5]{2,}/g) ?? []);
  if (leftSet.size === 0 || rightSet.size === 0) return 0;
  let common = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) common += 1;
  }
  const denom = Math.max(leftSet.size, rightSet.size, 1);
  return common / denom;
}

function teamSimilarity(record: LearningRecord, fixture: any): number {
  const parsed = parseMatchTeams(record.match);
  const recHomeCandidates = [record.homeTeamEn, record.homeTeam, parsed.home].map(normalizeName).filter(Boolean);
  const recAwayCandidates = [record.awayTeamEn, record.awayTeam, parsed.away].map(normalizeName).filter(Boolean);
  const fixHomeCandidates = [fixture.homeTeamEn, fixture.homeTeam].map(normalizeName).filter(Boolean);
  const fixAwayCandidates = [fixture.awayTeamEn, fixture.awayTeam].map(normalizeName).filter(Boolean);

  if (recHomeCandidates.length === 0 || recAwayCandidates.length === 0 || fixHomeCandidates.length === 0 || fixAwayCandidates.length === 0) {
    return 0;
  }

  const bestPair = (left: string[], right: string[]): number => {
    let best = 0;
    for (const l of left) {
      for (const r of right) {
        if (l === r) {
          best = Math.max(best, 1);
          continue;
        }
        if (l.includes(r) || r.includes(l)) {
          best = Math.max(best, 0.7);
        }
      }
    }
    return best;
  };

  const direct = (bestPair(recHomeCandidates, fixHomeCandidates) + bestPair(recAwayCandidates, fixAwayCandidates)) / 2;
  const swapped = (bestPair(recHomeCandidates, fixAwayCandidates) + bestPair(recAwayCandidates, fixHomeCandidates)) / 2;
  return Math.max(direct, swapped * 0.8);
}

function needsResult(record: LearningRecord): boolean {
  if (!record.finalScore) {
    return true;
  }

  if (record.market.includes("半場") && !record.halfTimeScore) {
    return true;
  }

  if (record.market.includes("角球") && !record.finalCorners) {
    return true;
  }

  return false;
}

function scoreCandidate(record: LearningRecord, fixture: any): MatchCandidate {
  const recDate = record.matchDateHk || hkDateFromIso(record.kickoffAt);
  const fixDate = hkDateFromIso(fixture.kickoffAt);
  const dayDistance = dateDistanceDays(recDate, fixDate);
  const timeDistance = kickoffDistanceMinutes(record.kickoffAt, fixture.kickoffAt);
  const teamScore = teamSimilarity(record, fixture);
  const leagueScore = leagueSimilarity(record.league, fixture.league);

  let score = 0;
  const reasons: string[] = [];

  if (record.fixtureId && fixture.id === record.fixtureId) {
    score += 4;
    reasons.push("fixtureId exact");
  }

  if (dayDistance <= WINDOW_DAYS) {
    score += Math.max(0, 2 - dayDistance * 0.4);
    reasons.push(`day<=${WINDOW_DAYS} (${dayDistance.toFixed(1)})`);
  }

  if (Number.isFinite(timeDistance) && timeDistance <= KICKOFF_TOLERANCE_MIN) {
    score += Math.max(0, 1.8 - (timeDistance / KICKOFF_TOLERANCE_MIN) * 1.8);
    reasons.push(`kickoff<=${KICKOFF_TOLERANCE_MIN}m (${Math.round(timeDistance)}m)`);
  }

  score += teamScore * 4;
  if (teamScore > 0) {
    reasons.push(`team=${teamScore.toFixed(2)}`);
  }

  score += leagueScore * 1.5;
  if (leagueScore > 0) {
    reasons.push(`league=${leagueScore.toFixed(2)}`);
  }

  return {
    fixture,
    score,
    reason: reasons.join(", ")
  };
}

function applyFixture(record: LearningRecord, fixture: any): LearningRecord {
  const next: LearningRecord = {
    ...record,
    kickoffAt: record.kickoffAt || fixture.kickoffAt,
    matchDateHk: record.matchDateHk || hkDateFromIso(record.kickoffAt || fixture.kickoffAt) || undefined,
    league: record.league || fixture.league,
    homeTeam: record.homeTeam || fixture.homeTeam,
    awayTeam: record.awayTeam || fixture.awayTeam,
    homeTeamEn: record.homeTeamEn || fixture.homeTeamEn,
    awayTeamEn: record.awayTeamEn || fixture.awayTeamEn,
    finalScore: record.finalScore || fixture.finalScore,
    halfTimeScore: record.halfTimeScore || fixture.halfTimeScore,
    finalCorners: record.finalCorners || fixture.finalCorners
  };
  return next;
}

function mergeFromDetail(record: LearningRecord, detail: any | null): LearningRecord {
  if (!detail) return record;
  return {
    ...record,
    halfTimeScore: record.halfTimeScore || detail.halfTimeScore,
    finalScore: record.finalScore || detail.finalScore,
    finalCorners: record.finalCorners || detail.finalCorners
  };
}

function mergeFromSportsDb(record: LearningRecord, detail: any | null): LearningRecord {
  if (!detail) return record;
  return {
    ...record,
    kickoffAt: record.kickoffAt || detail.kickoffAt,
    matchDateHk: record.matchDateHk || hkDateFromIso(record.kickoffAt || detail.kickoffAt) || undefined,
    league: record.league || detail.league,
    homeTeamEn: record.homeTeamEn || detail.homeTeam,
    awayTeamEn: record.awayTeamEn || detail.awayTeam,
    finalScore: record.finalScore || detail.finalScore,
    halfTimeScore: record.halfTimeScore || detail.halfTimeScore
  };
}

async function run(): Promise<void> {
  const workspaceRoot = path.resolve(process.cwd(), "../..");
  const dbPath = path.resolve(workspaceRoot, "apps/api/data/learning-db.json");
  const raw = await fs.readFile(dbPath, "utf8");
  const db = JSON.parse(raw) as LearningDb;

  const all = [...db.pending, ...db.settled];
  const targets = all.filter((record) => needsResult(record) || !record.homeTeamEn || !record.awayTeamEn || !record.matchDateHk);

  if (targets.length === 0) {
    console.log("[repair-learning-history] nothing to repair");
    return;
  }

  const dateKeys = targets
    .map((record) => record.matchDateHk || hkDateFromIso(record.kickoffAt))
    .filter((date): date is string => !!date)
    .sort();

  let fixtures: any[] = [];
  if (dateKeys.length > 0) {
    const startDate = addDays(dateKeys[0], -WINDOW_DAYS);
    const endDate = addDays(dateKeys[dateKeys.length - 1], WINDOW_DAYS);

    const dayKeys: string[] = [];
    let cursor = startDate;
    while (Date.parse(`${cursor}T00:00:00Z`) <= Date.parse(`${endDate}T00:00:00Z`)) {
      dayKeys.push(cursor);
      cursor = addDays(cursor, 1);
    }

    const byId = new Map<string, any>();
    for (const day of dayKeys) {
      try {
        const daily = await fetchHkjcResultFixturesWithOptions({ startDate: day, endDate: day });
        for (const fixture of daily) {
          byId.set(fixture.id, fixture);
        }
      } catch (error) {
        console.warn(`[repair-learning-history] HKJC daily fetch failed for ${day}`, error);
      }
    }

    fixtures = [...byId.values()];
    console.log(
      `[repair-learning-history] loaded HKJC fixtures: ${fixtures.length} (daily sweep ${startDate}..${endDate}, days=${dayKeys.length})`
    );
  }

  const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const detailCache = new Map<string, any | null>();
  const sportsDbCache = new Map<string, any | null>();

  let touched = 0;
  let recoveredResultFields = 0;
  let recoveredMetaFields = 0;
  let hkjcDirectHits = 0;
  let hkjcFuzzyHits = 0;
  let sportsDbHits = 0;

  const applyToRecord = async (record: LearningRecord): Promise<LearningRecord> => {
    const beforeResultMissing = needsResult(record);
    const beforeMetaMissing = !record.homeTeamEn || !record.awayTeamEn || !record.matchDateHk;
    let next = { ...record };

    const exactFixture = fixtureById.get(record.fixtureId);
    if (exactFixture) {
      next = applyFixture(next, exactFixture);
      hkjcDirectHits += 1;
    }

    if (!exactFixture || needsResult(next) || !next.homeTeamEn || !next.awayTeamEn) {
      const recDate = next.matchDateHk || hkDateFromIso(next.kickoffAt);
      const candidates = fixtures
        .filter((fixture) => dateDistanceDays(recDate, hkDateFromIso(fixture.kickoffAt)) <= WINDOW_DAYS)
        .map((fixture) => scoreCandidate(next, fixture))
        .sort((a, b) => b.score - a.score);

      const best = candidates[0];
      if (best && best.score >= MIN_MATCH_SCORE) {
        next = applyFixture(next, best.fixture);
        hkjcFuzzyHits += 1;
      }
    }

    if (needsResult(next)) {
      const detailKey = next.fixtureId;
      if (!detailCache.has(detailKey)) {
        try {
          detailCache.set(detailKey, await fetchHkjcResultDetailByFixtureId(detailKey));
        } catch {
          detailCache.set(detailKey, null);
        }
      }
      next = mergeFromDetail(next, detailCache.get(detailKey));
    }

    if (needsResult(next)) {
      const sportsDbKey = `${next.fixtureId}|${next.matchDateHk || ""}|${next.homeTeamEn || ""}|${next.awayTeamEn || ""}`;
      if (!sportsDbCache.has(sportsDbKey)) {
        try {
          sportsDbCache.set(
            sportsDbKey,
            await fetchTheSportsDbResultByMatchInfo({
              fixtureId: next.fixtureId,
              kickoffAt: next.kickoffAt,
              homeTeamEn: next.homeTeamEn,
              awayTeamEn: next.awayTeamEn,
              match: next.match
            })
          );
        } catch {
          sportsDbCache.set(sportsDbKey, null);
        }
      }
      const before = next;
      next = mergeFromSportsDb(next, sportsDbCache.get(sportsDbKey));
      if (before !== next && !needsResult(next)) {
        sportsDbHits += 1;
      }
    }

    const afterResultMissing = needsResult(next);
    const afterMetaMissing = !next.homeTeamEn || !next.awayTeamEn || !next.matchDateHk;

    const changed = JSON.stringify(record) !== JSON.stringify(next);
    if (changed) {
      touched += 1;
    }
    if (beforeResultMissing && !afterResultMissing) {
      recoveredResultFields += 1;
    }
    if (beforeMetaMissing && !afterMetaMissing) {
      recoveredMetaFields += 1;
    }

    return next;
  };

  const nextPending: LearningRecord[] = [];
  for (const record of db.pending) {
    nextPending.push(await applyToRecord(record));
  }

  const nextSettled: LearningRecord[] = [];
  for (const record of db.settled) {
    nextSettled.push(await applyToRecord(record));
  }

  const nextDb: LearningDb = {
    pending: nextPending,
    settled: nextSettled
  };

  const unresolvedAfter = [...nextDb.pending, ...nextDb.settled].filter((record) => needsResult(record)).length;

  console.log("[repair-learning-history] summary", {
    mode: dryRun ? "dry-run" : "apply",
    targets: targets.length,
    touched,
    recoveredResultFields,
    recoveredMetaFields,
    unresolvedAfter,
    hkjcDirectHits,
    hkjcFuzzyHits,
    sportsDbHits
  });

  if (apply) {
    await fs.writeFile(dbPath, `${JSON.stringify(nextDb, null, 2)}\n`, "utf8");
    console.log(`[repair-learning-history] wrote ${dbPath}`);
  } else {
    console.log("[repair-learning-history] dry-run only; pass --apply to persist changes");
  }
}

run().catch((error) => {
  console.error("[repair-learning-history] failed", error);
  process.exit(1);
});
