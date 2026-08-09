import path from "node:path";
import { promises as fs } from "node:fs";
import { JSONFilePreset } from "lowdb/node";
import type {
  BlindspotMetric,
  BlindspotReport,
  Fixture,
  LearningFeedback,
  LearningHistoryRecord,
  LearningHistoryStatus,
  LearningSnapshot,
  PredictedSide,
  Recommendation
} from "../types.js";

type LearningDb = {
  pending: LearningFeedback[];
  settled: LearningFeedback[];
};

type CorrectionProfile = {
  marketPenalty: Record<string, number>;
  oddsBucketPenalty: Record<string, number>;
  confidenceBucketPenalty: Record<string, number>;
  sidePenalty: Record<PredictedSide, number>;
};

function toMetric(records: LearningFeedback[]): BlindspotMetric {
  const sample = records.length;
  const wins = records.filter((r) => r.result === "win").length;
  const losses = sample - wins;
  const hitRate = sample === 0 ? 0 : Number((wins / sample).toFixed(4));
  return { sample, wins, losses, hitRate };
}

function clampPenalty(value: number): number {
  return Math.max(0, Math.min(0.15, Number(value.toFixed(4))));
}

function buildPenaltyMap(source: Record<string, BlindspotMetric>, minSamples = 6): Record<string, number> {
  const penalties: Record<string, number> = {};
  for (const [key, metric] of Object.entries(source)) {
    if (metric.sample < minSamples) {
      continue;
    }

    if (metric.hitRate >= 0.5) {
      continue;
    }

    penalties[key] = clampPenalty((0.5 - metric.hitRate) * 0.35);
  }
  return penalties;
}

function isFixtureSettled(fixture: Fixture): boolean {
  const status = (fixture.status ?? "").toLowerCase();
  const hasFinishedStatus = ["ft", "finished", "result", "ended", "closed"].some((token) =>
    status.includes(token)
  );

  if (hasFinishedStatus) {
    return true;
  }

  const kickoffMs = new Date(fixture.kickoffAt).getTime();
  const minutesFromKickoff = (Date.now() - kickoffMs) / 60000;
  const hasSellingOption = fixture.marketOptions.some((option) => {
    const poolStatus = option.poolStatus.toLowerCase();
    const combinationStatus = option.combinationStatus.toLowerCase();
    return poolStatus.includes("sell") && combinationStatus.includes("sell");
  });

  return minutesFromKickoff > 130 && !hasSellingOption;
}

function isMissingMatchName(record: Pick<LearningFeedback, "fixtureId" | "match">): boolean {
  const match = record.match?.trim();
  if (!match) {
    return true;
  }

  return match === record.fixtureId || match === "場次資訊載入中";
}

function normalizeNameToken(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function fixtureMatchKey(fixture: Pick<Fixture, "homeTeam" | "awayTeam">): string {
  return `${normalizeNameToken(fixture.homeTeam)}|${normalizeNameToken(fixture.awayTeam)}`;
}

function matchTextKey(match: string | undefined): string | null {
  const raw = (match ?? "").trim();
  if (!raw) {
    return null;
  }

  const segments = raw
    .split(/\s+(?:vs\.?|v\.?|對)\s+/i)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (segments.length < 2) {
    return null;
  }

  return `${normalizeNameToken(segments[0])}|${normalizeNameToken(segments[1])}`;
}

function dateKeyFromIso(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return null;
  }

  return new Date(ms).toISOString().slice(0, 10);
}

function hongKongDateKeyFromIso(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(ms));

  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function recommendationTeamsKey(
  rec: Pick<Recommendation, "homeTeam" | "awayTeam" | "homeTeamEn" | "awayTeamEn" | "match" | "matchKey">
): string | null {
  if (rec.matchKey?.trim()) {
    return rec.matchKey.trim().toLowerCase();
  }

  if (rec.homeTeamEn?.trim() && rec.awayTeamEn?.trim()) {
    return `${normalizeNameToken(rec.homeTeamEn)}|${normalizeNameToken(rec.awayTeamEn)}`;
  }

  if (rec.homeTeam?.trim() && rec.awayTeam?.trim()) {
    return `${normalizeNameToken(rec.homeTeam)}|${normalizeNameToken(rec.awayTeam)}`;
  }

  return matchTextKey(rec.match);
}

function feedbackTeamsKey(
  feedback: Pick<LearningFeedback, "homeTeam" | "awayTeam" | "homeTeamEn" | "awayTeamEn" | "match" | "matchKey">
): string | null {
  if (feedback.matchKey?.trim()) {
    return feedback.matchKey.trim().toLowerCase();
  }

  if (feedback.homeTeamEn?.trim() && feedback.awayTeamEn?.trim()) {
    return `${normalizeNameToken(feedback.homeTeamEn)}|${normalizeNameToken(feedback.awayTeamEn)}`;
  }

  if (feedback.homeTeam?.trim() && feedback.awayTeam?.trim()) {
    return `${normalizeNameToken(feedback.homeTeam)}|${normalizeNameToken(feedback.awayTeam)}`;
  }

  return matchTextKey(feedback.match);
}

function fixtureMatchDayKey(fixture: Pick<Fixture, "homeTeam" | "awayTeam" | "kickoffAt">): string | null {
  const teamsKey = fixtureMatchKey(fixture);
  const dayKey = dateKeyFromIso(fixture.kickoffAt);
  if (!dayKey) {
    return null;
  }

  return `${teamsKey}|${dayKey}`;
}

function feedbackMatchDayKey(
  feedback: Pick<LearningFeedback, "homeTeam" | "awayTeam" | "match" | "matchKey" | "kickoffAt">
): string | null {
  const teamsKey = feedbackTeamsKey(feedback);
  const dayKey = dateKeyFromIso(feedback.kickoffAt);
  if (!teamsKey || !dayKey) {
    return null;
  }

  return `${teamsKey}|${dayKey}`;
}

function closestKickoffFixture(fixtures: Fixture[], kickoffAt?: string): Fixture {
  if (fixtures.length === 1 || !kickoffAt) {
    return fixtures[0];
  }

  const target = Date.parse(kickoffAt);
  if (!Number.isFinite(target)) {
    return fixtures[0];
  }

  return fixtures.reduce((best, current) => {
    const bestMs = Date.parse(best.kickoffAt);
    const currentMs = Date.parse(current.kickoffAt);
    const bestDelta = Number.isFinite(bestMs) ? Math.abs(bestMs - target) : Number.POSITIVE_INFINITY;
    const currentDelta = Number.isFinite(currentMs) ? Math.abs(currentMs - target) : Number.POSITIVE_INFINITY;
    return currentDelta < bestDelta ? current : best;
  });
}

type FixtureMatchSource = "fixtureId" | "matchDay" | "match";

function findFixtureForFeedback(
  pending: LearningFeedback,
  byFixtureId: Map<string, Fixture>,
  byMatchKey: Map<string, Fixture>,
  byMatchDayKey: Map<string, Fixture[]>
): { fixture: Fixture | null; matchedBy?: FixtureMatchSource } {
  const byIdFixture = byFixtureId.get(pending.fixtureId);
  if (byIdFixture) {
    return { fixture: byIdFixture, matchedBy: "fixtureId" };
  }

  const dayKey = feedbackMatchDayKey(pending);
  if (dayKey) {
    const dayCandidates = byMatchDayKey.get(dayKey) ?? [];
    if (dayCandidates.length > 0) {
      const leagueFiltered = pending.league
        ? dayCandidates.filter((fixture) => fixture.league.trim().toLowerCase() === pending.league?.trim().toLowerCase())
        : dayCandidates;
      const picked = closestKickoffFixture(leagueFiltered.length > 0 ? leagueFiltered : dayCandidates, pending.kickoffAt);
      return { fixture: picked, matchedBy: "matchDay" };
    }
  }

  const byNameFixture = byMatchKey.get(feedbackTeamsKey(pending) ?? "");
  if (byNameFixture) {
    return { fixture: byNameFixture, matchedBy: "match" };
  }

  return { fixture: null };
}

function oddsBucket(odds: number): string {
  if (odds < 2) return "1.40-1.99";
  if (odds < 3) return "2.00-2.99";
  if (odds < 5) return "3.00-4.99";
  return "5.00+";
}

function confidenceBucket(confidence: number): string {
  if (confidence < 55) return "50-54";
  if (confidence < 60) return "55-59";
  if (confidence < 65) return "60-64";
  if (confidence < 70) return "65-69";
  return "70+";
}

function normalizeSelectionText(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function extractLineValue(...parts: string[]): number | null {
  for (const part of parts) {
    const match = part.match(/-?\d+(?:\.\d+)?/);
    if (!match) {
      continue;
    }

    const value = Number(match[0]);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function selectionSide(text: string): "home" | "away" | null {
  const normalized = normalizeSelectionText(text);
  const hasHome = normalized.includes("主隊") || normalized.includes("主勝") || normalized.includes("home");
  const hasAway = normalized.includes("客隊") || normalized.includes("客勝") || normalized.includes("away");

  if (hasHome && !hasAway) {
    return "home";
  }

  if (hasAway && !hasHome) {
    return "away";
  }

  return null;
}

function fixtureMetrics(fixture: Fixture): {
  homeGoals: number | null;
  awayGoals: number | null;
  totalGoals: number | null;
  homeCorners: number | null;
  awayCorners: number | null;
  totalCorners: number | null;
} {
  const homeGoals = fixture.finalScore?.home ?? null;
  const awayGoals = fixture.finalScore?.away ?? null;
  const totalGoals = homeGoals !== null && awayGoals !== null ? homeGoals + awayGoals : null;
  const homeCorners = fixture.finalCorners?.home ?? null;
  const awayCorners = fixture.finalCorners?.away ?? null;
  const totalCorners = fixture.finalCorners?.total ?? (homeCorners !== null && awayCorners !== null ? homeCorners + awayCorners : null);

  return {
    homeGoals,
    awayGoals,
    totalGoals,
    homeCorners,
    awayCorners,
    totalCorners
  };
}

function predictSide(rec: Recommendation): PredictedSide | null {
  const text = normalizeSelectionText(`${rec.market} ${rec.selectionName}`);
  const selectionText = normalizeSelectionText(rec.selectionName);

  if (selectionText === "和" || selectionText.includes("和局") || selectionText.includes("draw") || /\b[xd]\b/.test(selectionText)) {
    return "draw";
  }

  if (selectionText.includes("大") && !selectionText.includes("細")) {
    return "home";
  }

  if (selectionText.includes("細") && !selectionText.includes("大")) {
    return "away";
  }

  if (selectionText.includes("單")) {
    return "home";
  }

  if (selectionText.includes("雙")) {
    return "away";
  }

  const side = selectionSide(text);
  if (side) {
    return side;
  }

  return null;
}

function resultSide(fixture: Fixture): PredictedSide | null {
  const score = fixture.finalScore;
  if (!score) {
    return null;
  }

  if (score.home > score.away) {
    return "home";
  }

  if (score.home < score.away) {
    return "away";
  }

  return "draw";
}

function overUnderPick(text: string): "over" | "under" | null {
  const normalized = normalizeSelectionText(text);

  if (normalized.includes("大") && !normalized.includes("細")) {
    return "over";
  }

  if (normalized.includes("細") && !normalized.includes("大")) {
    return "under";
  }

  return null;
}

function settleOverUnder(
  pick: "over" | "under" | null,
  metric: number | null,
  line: number | null
): PredictedSide | null {
  if (!pick || metric === null || line === null) {
    return null;
  }

  if (metric > line) {
    return pick === "under" ? "away" : "home";
  }

  if (metric < line) {
    return pick === "under" ? "home" : "away";
  }

  return "draw";
}

function settleHandicap(homeGoals: number | null, awayGoals: number | null, line: number | null): PredictedSide | null {
  if (homeGoals === null || awayGoals === null || line === null) {
    return null;
  }

  const homeAdjusted = homeGoals + line;
  const awayAdjusted = awayGoals - line;

  if (homeAdjusted > awayAdjusted) {
    return "home";
  }

  if (homeAdjusted < awayAdjusted) {
    return "away";
  }

  return "draw";
}

function actualSideFromFixture(
  rec: Pick<Recommendation, "market" | "selectionName">,
  fixture: Fixture
): PredictedSide | null {
  const text = normalizeSelectionText(`${rec.market} ${rec.selectionName}`);
  const selectionText = normalizeSelectionText(rec.selectionName);
  const metrics = fixtureMetrics(fixture);
  const useHalfTimeScore = text.includes("半場");
  const scopedHomeGoals = useHalfTimeScore ? (fixture.halfTimeScore?.home ?? null) : metrics.homeGoals;
  const scopedAwayGoals = useHalfTimeScore ? (fixture.halfTimeScore?.away ?? null) : metrics.awayGoals;
  const scopedTotalGoals =
    scopedHomeGoals !== null && scopedAwayGoals !== null ? scopedHomeGoals + scopedAwayGoals : null;

  if (text.includes("主客和")) {
    if (scopedHomeGoals === null || scopedAwayGoals === null) {
      return null;
    }

    if (scopedHomeGoals > scopedAwayGoals) {
      return "home";
    }

    if (scopedHomeGoals < scopedAwayGoals) {
      return "away";
    }

    return "draw";
  }

  if (text.includes("讓球")) {
    const line = extractLineValue(rec.selectionName, rec.market);
    return settleHandicap(scopedHomeGoals, scopedAwayGoals, line);
  }

  if (text.includes("單雙")) {
    if (scopedTotalGoals === null) {
      return null;
    }

    return scopedTotalGoals % 2 === 1 ? "home" : "away";
  }

  if (text.includes("兩隊皆入球")) {
    if (scopedHomeGoals === null || scopedAwayGoals === null) {
      return null;
    }

    return scopedHomeGoals > 0 && scopedAwayGoals > 0 ? "home" : "away";
  }

  if (text.includes("角球")) {
    const line = extractLineValue(rec.selectionName, rec.market);
    const side = selectionSide(text);
    const metric = side === "home" ? metrics.homeCorners : side === "away" ? metrics.awayCorners : metrics.totalCorners;
    return settleOverUnder(overUnderPick(selectionText), metric, line);
  }

  if (text.includes("總入球") || text.includes("入球大細")) {
    const line = extractLineValue(rec.selectionName, rec.market);
    const side = selectionSide(text);
    const metric = side === "home" ? scopedHomeGoals : side === "away" ? scopedAwayGoals : scopedTotalGoals;
    return settleOverUnder(overUnderPick(selectionText), metric, line);
  }

  if (text.includes("第一隊入球") || text.includes("首名入球")) {
    return null;
  }

  return resultSide(fixture);
}

type ActualSideMissingReason = "half_time_market" | "missing_final_score" | "missing_final_corners" | "unsupported_market";

function missingReasonToText(reason: ActualSideMissingReason): string {
  if (reason === "half_time_market") {
    return "半場玩法暫未納入自動結算";
  }

  if (reason === "missing_final_score") {
    return "場次已完場但無 finalScore 或可用結果欄位";
  }

  if (reason === "missing_final_corners") {
    return "場次已完場，但缺少角球賽果，無法結算角球玩法";
  }

  return "玩法暫未支援自動判定";
}

function diagnoseActualSideFromFixture(
  rec: Pick<Recommendation, "market" | "selectionName">,
  fixture: Fixture
): { actual: PredictedSide | null; reason: ActualSideMissingReason | null } {
  const text = normalizeSelectionText(`${rec.market} ${rec.selectionName}`);
  if (text.includes("半場") && (!fixture.halfTimeScore || fixture.halfTimeScore.home === undefined || fixture.halfTimeScore.away === undefined)) {
    return { actual: null, reason: "half_time_market" };
  }

  const actual = actualSideFromFixture(rec, fixture);
  if (actual) {
    return { actual, reason: null };
  }

  const metrics = fixtureMetrics(fixture);
  if (text.includes("角球") && (metrics.homeCorners === null || metrics.awayCorners === null) && metrics.totalCorners === null) {
    return { actual: null, reason: "missing_final_corners" };
  }

  const hasNoGoals = metrics.homeGoals === null || metrics.awayGoals === null;
  if (hasNoGoals) {
    return { actual: null, reason: "missing_final_score" };
  }

  return { actual: null, reason: "unsupported_market" };
}

export type PendingSettlementDiagnosisCode =
  | "no_fixture_match"
  | "fixture_not_finished"
  | "half_time_market"
  | "missing_final_score"
  | "missing_final_corners"
  | "unsupported_market";

export type PendingSettlementDiagnosis = {
  key: string;
  fixtureId: string;
  match: string;
  market: string;
  selectionName: string;
  createdAt: string;
  reasonCode: PendingSettlementDiagnosisCode;
  reason: string;
  matchedFixtureId?: string;
  matchedBy?: FixtureMatchSource;
};

export class LearningStore {
  private readonly dbPath: string;
  private dbPromise: ReturnType<typeof JSONFilePreset<LearningDb>> | null = null;
  private correction: CorrectionProfile = {
    marketPenalty: {},
    oddsBucketPenalty: {},
    confidenceBucketPenalty: {},
    sidePenalty: {
      home: 0,
      draw: 0,
      away: 0
    }
  };

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? path.resolve(process.cwd(), "apps/api/data/learning-db.json");
  }

  private async getDb() {
    if (!this.dbPromise) {
      await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
      this.dbPromise = JSONFilePreset<LearningDb>(this.dbPath, { pending: [], settled: [] });
    }

    return this.dbPromise;
  }

  private toFeedback(rec: Recommendation): LearningFeedback | null {
    const side = predictSide(rec);
    if (!side) {
      return null;
    }

    const key = `${rec.fixtureId}|${rec.market}|${rec.selectionName}`;
    return {
      key,
      fixtureId: rec.fixtureId,
      match: rec.match,
      kickoffAt: rec.kickoffAt,
      matchDateHk: rec.matchDateHk ?? hongKongDateKeyFromIso(rec.kickoffAt) ?? undefined,
      league: rec.league,
      homeTeam: rec.homeTeam,
      awayTeam: rec.awayTeam,
      homeTeamEn: rec.homeTeamEn,
      awayTeamEn: rec.awayTeamEn,
      matchKey: recommendationTeamsKey(rec) ?? undefined,
      sourceProvider: rec.sourceProvider,
      market: rec.market,
      selectionName: rec.selectionName,
      currentOdds: rec.currentOdds,
      confidence: rec.confidence,
      edgeScore: rec.edgeScore,
      predictedSide: side,
      createdAt: rec.lastUpdatedAt
    };
  }

  private matchName(fixtureId: string): string {
    const fixture = (this as LearningStore & { fixtures?: Fixture[] }).fixtures?.find((item) => item.id === fixtureId);
    if (!fixture) {
      return fixtureId || "場次資訊載入中";
    }

    return `${fixture.homeTeam} vs ${fixture.awayTeam}`;
  }

  async registerRecommendations(recommendations: Recommendation[]): Promise<void> {
    const db = await this.getDb();
    const existing = new Set(db.data.pending.map((item) => item.key));

    for (const rec of recommendations) {
      const feedback = this.toFeedback(rec);
      if (!feedback) {
        continue;
      }

      if (existing.has(feedback.key)) {
        continue;
      }

      db.data.pending.push(feedback);
      existing.add(feedback.key);
    }

    await db.write();
  }

  async syncPendingWithFinalRecommendations(
    recommendations: Recommendation[],
    fixtureIds: string[]
  ): Promise<number> {
    const db = await this.getDb();
    const scopedFixtureIds = new Set(fixtureIds.map((id) => id.trim()).filter((id) => id.length > 0));
    if (scopedFixtureIds.size === 0) {
      return 0;
    }

    const allowedKeys = new Set(
      recommendations.map((recommendation) => `${recommendation.fixtureId}|${recommendation.market}|${recommendation.selectionName}`)
    );

    const before = db.data.pending.length;
    db.data.pending = db.data.pending.filter((item) => {
      if (!scopedFixtureIds.has(item.fixtureId)) {
        return true;
      }

      return allowedKeys.has(item.key);
    });

    const removed = before - db.data.pending.length;
    if (removed > 0) {
      await db.write();
    }

    return removed;
  }

  async pendingFixtureIds(limit = 200): Promise<string[]> {
    const db = await this.getDb();
    const unique = new Set<string>();

    for (const item of db.data.pending) {
      if (!item.fixtureId) {
        continue;
      }
      unique.add(item.fixtureId);
      if (unique.size >= limit) {
        break;
      }
    }

    return [...unique];
  }

  async pendingFixtureIdsBeforeHongKongDate(cutoffIso: string, limit = 200): Promise<string[]> {
    const db = await this.getDb();
    const cutoffKey = hongKongDateKeyFromIso(cutoffIso);
    if (!cutoffKey) {
      return [];
    }

    const pending = [...db.data.pending]
      .filter((item) => {
        const itemKey = hongKongDateKeyFromIso(item.kickoffAt ?? item.createdAt);
        return itemKey !== null && itemKey < cutoffKey;
      })
      .sort((left, right) => {
        const leftMs = Date.parse(left.kickoffAt ?? left.createdAt ?? "");
        const rightMs = Date.parse(right.kickoffAt ?? right.createdAt ?? "");
        return leftMs - rightMs;
      });

    const unique = new Set<string>();
    for (const item of pending) {
      if (!item.fixtureId) {
        continue;
      }

      unique.add(item.fixtureId);
      if (unique.size >= limit) {
        break;
      }
    }

    return [...unique];
  }

  async deletePendingBeforeHongKongDate(cutoffIso: string): Promise<number> {
    const db = await this.getDb();
    const cutoffKey = hongKongDateKeyFromIso(cutoffIso);
    if (!cutoffKey) {
      return 0;
    }

    const before = db.data.pending.length;
    db.data.pending = db.data.pending.filter((item) => {
      const itemKey = hongKongDateKeyFromIso(item.kickoffAt ?? item.createdAt);
      if (!itemKey) {
        return true;
      }

      return itemKey >= cutoffKey;
    });

    const removed = before - db.data.pending.length;
    if (removed > 0) {
      await db.write();
    }

    return removed;
  }

  async fixtureIdsMissingMatchNames(limit = 500): Promise<string[]> {
    const db = await this.getDb();
    const unique = new Set<string>();

    for (const item of [...db.data.pending, ...db.data.settled]) {
      if (!item.fixtureId || !isMissingMatchName(item)) {
        continue;
      }

      unique.add(item.fixtureId);
      if (unique.size >= limit) {
        break;
      }
    }

    return [...unique];
  }

  async backfillMatchNames(fixtures: Fixture[]): Promise<number> {
    if (fixtures.length === 0) {
      return 0;
    }

    const db = await this.getDb();
    const names = new Map(
      fixtures
        .filter((fixture) => fixture.homeTeam && fixture.awayTeam)
        .map((fixture) => [fixture.id, `${fixture.homeTeam} vs ${fixture.awayTeam}`])
    );

    let updated = 0;
    const apply = (record: LearningFeedback): LearningFeedback => {
      if (!isMissingMatchName(record)) {
        return record;
      }

      const match = names.get(record.fixtureId);
      if (!match || record.match === match) {
        return record;
      }

      updated += 1;
      return {
        ...record,
        match
      };
    };

    db.data.pending = db.data.pending.map(apply);
    db.data.settled = db.data.settled.map(apply);

    if (updated > 0) {
      await db.write();
    }

    return updated;
  }

  async getHistory(options?: {
    market?: string;
    date?: string;
    status?: "all" | LearningHistoryStatus;
    limit?: number;
  }): Promise<LearningHistoryRecord[]> {
    const db = await this.getDb();
    const status = options?.status ?? "all";
    const market = options?.market?.trim();
    const date = options?.date?.trim();
    const limit = Math.max(1, options?.limit ?? 200);

    const pendingRecords: LearningHistoryRecord[] = db.data.pending.map((item) => ({
      key: item.key,
      fixtureId: item.fixtureId,
      match: item.match ?? this.matchName(item.fixtureId),
      kickoffAt: item.kickoffAt,
      matchDateHk: item.matchDateHk,
      league: item.league,
      homeTeam: item.homeTeam,
      awayTeam: item.awayTeam,
      homeTeamEn: item.homeTeamEn,
      awayTeamEn: item.awayTeamEn,
      matchKey: item.matchKey,
      sourceProvider: item.sourceProvider,
      market: item.market,
      selectionName: item.selectionName,
      currentOdds: item.currentOdds,
      confidence: item.confidence,
      edgeScore: item.edgeScore,
      predictedSide: item.predictedSide,
      status: "pending",
      createdAt: item.createdAt
    }));

    const settledRecords: LearningHistoryRecord[] = db.data.settled.map((item) => ({
      key: item.key,
      fixtureId: item.fixtureId,
      match: item.match ?? this.matchName(item.fixtureId),
      kickoffAt: item.kickoffAt,
      matchDateHk: item.matchDateHk,
      league: item.league,
      homeTeam: item.homeTeam,
      awayTeam: item.awayTeam,
      homeTeamEn: item.homeTeamEn,
      awayTeamEn: item.awayTeamEn,
      matchKey: item.matchKey,
      sourceProvider: item.sourceProvider,
      market: item.market,
      selectionName: item.selectionName,
      currentOdds: item.currentOdds,
      confidence: item.confidence,
      edgeScore: item.edgeScore,
      predictedSide: item.predictedSide,
      actualSide: item.actualSide,
      result: item.result,
      halfTimeScore: item.halfTimeScore,
      finalScore: item.finalScore,
      finalCorners: item.finalCorners,
      status: "settled",
      createdAt: item.createdAt,
      settledAt: item.settledAt
    }));

    const combined = [...pendingRecords, ...settledRecords]
      .filter((record) => {
        if (status !== "all" && record.status !== status) {
          return false;
        }

        if (market && record.market !== market) {
          return false;
        }

        if (date) {
          const recordDate =
            record.matchDateHk ||
            hongKongDateKeyFromIso(record.kickoffAt || record.createdAt) ||
            dateKeyFromIso(record.createdAt);
          if (recordDate !== date) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        const left = Date.parse(a.settledAt ?? a.createdAt);
        const right = Date.parse(b.settledAt ?? b.createdAt);
        return right - left;
      })
      .slice(0, limit);

    return combined;
  }

  async listMarkets(): Promise<string[]> {
    const db = await this.getDb();
    const markets = new Set<string>();

    for (const item of db.data.pending) {
      markets.add(item.market);
    }

    for (const item of db.data.settled) {
      markets.add(item.market);
    }

    return [...markets].sort((a, b) => a.localeCompare(b, "zh-HK"));
  }

  async applyHistoryEnrichment(records: LearningHistoryRecord[]): Promise<number> {
    const db = await this.getDb();
    const byKey = new Map(records.map((record) => [record.key, record]));
    let updated = 0;

    const enrich = (item: LearningFeedback): LearningFeedback => {
      const next = byKey.get(item.key);
      if (!next) {
        return item;
      }

      const enriched: LearningFeedback = {
        ...item,
        kickoffAt: item.kickoffAt || next.kickoffAt,
        matchDateHk: item.matchDateHk || next.matchDateHk,
        league: item.league || next.league,
        homeTeam: item.homeTeam || next.homeTeam,
        awayTeam: item.awayTeam || next.awayTeam,
        homeTeamEn: item.homeTeamEn || next.homeTeamEn,
        awayTeamEn: item.awayTeamEn || next.awayTeamEn,
        halfTimeScore: item.halfTimeScore || next.halfTimeScore,
        finalScore: item.finalScore || next.finalScore,
        finalCorners: item.finalCorners || next.finalCorners
      };

      if (JSON.stringify(enriched) !== JSON.stringify(item)) {
        updated += 1;
      }

      return enriched;
    };

    db.data.pending = db.data.pending.map(enrich);
    db.data.settled = db.data.settled.map(enrich);

    if (updated > 0) {
      await db.write();
    }

    return updated;
  }

  async settleFromFixtures(fixtures: Fixture[]): Promise<number> {
    const db = await this.getDb();
    const byFixtureId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
    const byMatchKey = new Map(fixtures.map((fixture) => [fixtureMatchKey(fixture), fixture]));
    const byMatchDayKey = new Map<string, Fixture[]>();
    for (const fixture of fixtures) {
      const dayKey = fixtureMatchDayKey(fixture);
      if (!dayKey) {
        continue;
      }

      const existing = byMatchDayKey.get(dayKey) ?? [];
      existing.push(fixture);
      byMatchDayKey.set(dayKey, existing);
    }
    const nextPending: LearningFeedback[] = [];
    let settledNow = 0;

    for (const pending of db.data.pending) {
      const fixture = findFixtureForFeedback(pending, byFixtureId, byMatchKey, byMatchDayKey).fixture;
      if (!fixture) {
        nextPending.push(pending);
        continue;
      }

      if (!isFixtureSettled(fixture)) {
        nextPending.push(pending);
        continue;
      }

      const actual = actualSideFromFixture(pending, fixture);
      if (!actual) {
        nextPending.push(pending);
        continue;
      }

      db.data.settled.push({
        ...pending,
        actualSide: actual,
        result: actual === pending.predictedSide ? "win" : "loss",
        halfTimeScore: fixture.halfTimeScore,
        finalScore: fixture.finalScore,
        finalCorners: fixture.finalCorners,
        settledAt: new Date().toISOString()
      });
      settledNow += 1;
    }

    db.data.pending = nextPending;
    this.recomputeCorrection(db.data.settled);
    await db.write();
    return settledNow;
  }

  async diagnosePending(fixtures: Fixture[], limit = 200): Promise<PendingSettlementDiagnosis[]> {
    const db = await this.getDb();
    const byFixtureId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
    const byMatchKey = new Map(fixtures.map((fixture) => [fixtureMatchKey(fixture), fixture]));
    const byMatchDayKey = new Map<string, Fixture[]>();
    for (const fixture of fixtures) {
      const dayKey = fixtureMatchDayKey(fixture);
      if (!dayKey) {
        continue;
      }

      const existing = byMatchDayKey.get(dayKey) ?? [];
      existing.push(fixture);
      byMatchDayKey.set(dayKey, existing);
    }
    const diagnostics: PendingSettlementDiagnosis[] = [];

    for (const pending of db.data.pending) {
      if (diagnostics.length >= limit) {
        break;
      }

      const matched = findFixtureForFeedback(pending, byFixtureId, byMatchKey, byMatchDayKey);
      const fixture = matched.fixture;

      if (!fixture) {
        diagnostics.push({
          key: pending.key,
          fixtureId: pending.fixtureId,
          match: pending.match ?? this.matchName(pending.fixtureId),
          market: pending.market,
          selectionName: pending.selectionName,
          createdAt: pending.createdAt,
          reasonCode: "no_fixture_match",
          reason: "找不到對應完場場次（fixtureId/場次名稱均未匹配）"
        });
        continue;
      }

      if (!isFixtureSettled(fixture)) {
        diagnostics.push({
          key: pending.key,
          fixtureId: pending.fixtureId,
          match: pending.match ?? this.matchName(pending.fixtureId),
          market: pending.market,
          selectionName: pending.selectionName,
          createdAt: pending.createdAt,
          reasonCode: "fixture_not_finished",
          reason: "找到場次但未完場或仍在開售",
          matchedFixtureId: fixture.id,
          matchedBy: matched.matchedBy
        });
        continue;
      }

      const diagnosed = diagnoseActualSideFromFixture(pending, fixture);
      if (!diagnosed.actual && diagnosed.reason) {
        diagnostics.push({
          key: pending.key,
          fixtureId: pending.fixtureId,
          match: pending.match ?? this.matchName(pending.fixtureId),
          market: pending.market,
          selectionName: pending.selectionName,
          createdAt: pending.createdAt,
          reasonCode: diagnosed.reason,
          reason: missingReasonToText(diagnosed.reason),
          matchedFixtureId: fixture.id,
          matchedBy: matched.matchedBy
        });
      }
    }

    return diagnostics;
  }

  private recomputeCorrection(settled: LearningFeedback[]): void {
    const report = this.buildBlindspotReport(settled);
    this.correction = {
      marketPenalty: buildPenaltyMap(report.byMarket, 6),
      oddsBucketPenalty: buildPenaltyMap(report.byOddsBucket, 6),
      confidenceBucketPenalty: buildPenaltyMap(report.byConfidenceBucket, 6),
      sidePenalty: {
        home: buildPenaltyMap({ home: report.byPredictedSide.home }, 8).home ?? 0,
        draw: buildPenaltyMap({ draw: report.byPredictedSide.draw }, 8).draw ?? 0,
        away: buildPenaltyMap({ away: report.byPredictedSide.away }, 8).away ?? 0
      }
    };
  }

  private buildBlindspotReport(settled: LearningFeedback[]): BlindspotReport {
    const byMarket: Record<string, LearningFeedback[]> = {};
    const byOddsBucket: Record<string, LearningFeedback[]> = {};
    const byConfidenceBucket: Record<string, LearningFeedback[]> = {};
    const byPredictedSide: Record<PredictedSide, LearningFeedback[]> = {
      home: [],
      draw: [],
      away: []
    };

    for (const item of settled) {
      (byMarket[item.market] ??= []).push(item);

      const oddsKey = oddsBucket(item.currentOdds);
      (byOddsBucket[oddsKey] ??= []).push(item);

      const confidenceKey = confidenceBucket(item.confidence);
      (byConfidenceBucket[confidenceKey] ??= []).push(item);

      byPredictedSide[item.predictedSide].push(item);
    }

    const mapMetrics = (input: Record<string, LearningFeedback[]>) =>
      Object.fromEntries(Object.entries(input).map(([key, records]) => [key, toMetric(records)]));

    return {
      byMarket: mapMetrics(byMarket),
      byOddsBucket: mapMetrics(byOddsBucket),
      byConfidenceBucket: mapMetrics(byConfidenceBucket),
      byPredictedSide: {
        home: toMetric(byPredictedSide.home),
        draw: toMetric(byPredictedSide.draw),
        away: toMetric(byPredictedSide.away)
      }
    };
  }

  private penaltyFor(rec: Recommendation): number {
    const side = predictSide(rec);
    if (!side) {
      return 0;
    }

    const marketPenalty = this.correction.marketPenalty[rec.market] ?? 0;
    const oddsPenalty = this.correction.oddsBucketPenalty[oddsBucket(rec.currentOdds)] ?? 0;
    const confidencePenalty = this.correction.confidenceBucketPenalty[confidenceBucket(rec.confidence)] ?? 0;
    const sidePenalty = this.correction.sidePenalty[side] ?? 0;

    return clampPenalty(marketPenalty + oddsPenalty + confidencePenalty + sidePenalty);
  }

  adjustRecommendations(recommendations: Recommendation[]): Recommendation[] {
    return recommendations
      .map((rec) => {
        const penalty = this.penaltyFor(rec);
        if (penalty <= 0) {
          return rec;
        }

        const adjustedConfidence = Number((rec.confidence * (1 - penalty)).toFixed(1));
        const adjustedEdge = Number((rec.edgeScore * (1 - penalty)).toFixed(2));
        const adjustedValue = Number((rec.valueScore * (1 - penalty)).toFixed(3));

        return {
          ...rec,
          confidence: adjustedConfidence,
          edgeScore: adjustedEdge,
          valueScore: adjustedValue,
          reason: `${rec.reason}；模型已按歷史盲點作${Number((penalty * 100).toFixed(1))}%風險折減`
        };
      })
      .sort((a, b) => b.valueScore - a.valueScore || b.confidence - a.confidence);
  }

  async getSnapshot(): Promise<LearningSnapshot> {
    const db = await this.getDb();
    this.recomputeCorrection(db.data.settled);
    const recent = [...db.data.settled].slice(-20).reverse();

    return {
      generatedAt: new Date().toISOString(),
      pendingCount: db.data.pending.length,
      settledCount: db.data.settled.length,
      recent,
      blindspots: this.buildBlindspotReport(db.data.settled),
      correction: this.correction
    };
  }
}
