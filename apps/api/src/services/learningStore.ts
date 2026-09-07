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

const MOCK_FIXTURE_IDS = new Set(["m1", "m2", "m3"]);

function isMockFixtureRecord(record: Pick<LearningFeedback, "fixtureId">): boolean {
  return MOCK_FIXTURE_IDS.has(record.fixtureId);
}

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
  const status = (fixture.status ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  return /^(ft|aet|finished|result|ended|fulltime|complete|completed)$/.test(status)
    || /完場|已結束|賽事結束/.test(status);
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

function historySortTimestamp(record: LearningHistoryRecord): number {
  const parsed = Date.parse(record.settledAt ?? record.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function historyKickoffTimestamp(record: LearningHistoryRecord): number {
  const kickoff = Date.parse(record.kickoffAt ?? "");
  if (Number.isFinite(kickoff)) {
    return kickoff;
  }

  const created = Date.parse(record.createdAt);
  return Number.isFinite(created) ? created : 0;
}

function shouldReplaceHistoryRecord(current: LearningHistoryRecord, candidate: LearningHistoryRecord): boolean {
  if (current.status !== candidate.status) {
    // Prefer settled entry when the same key appears in both pending and settled.
    return candidate.status === "settled";
  }

  return historySortTimestamp(candidate) > historySortTimestamp(current);
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
    return "home";
  }

  if (metric < line) {
    return "away";
  }

  return "draw";
}

function settleHandicap(
  homeGoals: number | null,
  awayGoals: number | null,
  line: number | null,
  handicapSide: "home" | "away" | null
): PredictedSide | null {
  if (homeGoals === null || awayGoals === null || line === null) {
    return null;
  }

  const homeAdjusted = homeGoals + (handicapSide === "away" ? 0 : line);
  const awayAdjusted = awayGoals + (handicapSide === "away" ? line : 0);

  if (homeAdjusted > awayAdjusted) {
    return "home";
  }

  if (homeAdjusted < awayAdjusted) {
    return "away";
  }

  return "draw";
}

function normalizeLegacyTeamTotalRecord(record: LearningFeedback): boolean {
  const market = normalizeSelectionText(record.market);
  const selection = normalizeSelectionText(record.selectionName);
  if (!market.includes("大細") || (!market.includes("角球") && !market.includes("入球"))) {
    return false;
  }
  if ((selection.includes("大") && !selection.includes("細")) || (selection.includes("細") && !selection.includes("大"))) {
    return false;
  }

  const side = selectionSide(`${record.market} ${record.selectionName}`);
  if (!side) {
    return false;
  }

  const period = market.includes("半場") ? "半場" : "全場";
  const metric = market.includes("角球") ? "角球" : "入球";
  const direction = record.predictedSide === "home" ? "大" : record.predictedSide === "away" ? "細" : null;
  const rawLine = record.selectionName.match(/[+-]?\d+(?:\.\d+)?(?:\/[+-]?\d+(?:\.\d+)?)?/)?.[0];
  if (!direction || !rawLine) {
    return false;
  }

  const line = rawLine.replaceAll("-", "");
  record.market = `${side === "home" ? "主隊" : "客隊"}${period}${metric}大細`;
  record.selectionName = `${side === "home" ? "主隊" : "客隊"} ${period}${direction}（${line}${metric === "角球" ? "角球" : "球"}）`;
  return true;
}

function normalizeThreeWayHandicapLabel(record: LearningFeedback): boolean {
  if (!normalizeSelectionText(record.market).includes("讓球主客和") || record.selectionName.includes("主隊盤口")) {
    return false;
  }
  if (!record.selectionName.includes("盤口")) {
    return false;
  }

  record.selectionName = record.selectionName.replace("盤口", "主隊盤口");
  return true;
}

function actualSideFromFixture(
  rec: Pick<Recommendation, "market" | "selectionName">,
  fixture: Fixture
): PredictedSide | null {
  const text = normalizeSelectionText(`${rec.market} ${rec.selectionName}`);
  const selectionText = normalizeSelectionText(rec.selectionName);
  const metrics = fixtureMetrics(fixture);
  const isLegacyHomeHalfTeamTotal = normalizeSelectionText(rec.market) === "球隊入球大細";
  const useHalfTimeScore = text.includes("半場") || isLegacyHomeHalfTeamTotal;
  const scopedHomeGoals = useHalfTimeScore ? (fixture.halfTimeScore?.home ?? null) : metrics.homeGoals;
  const scopedAwayGoals = useHalfTimeScore ? (fixture.halfTimeScore?.away ?? null) : metrics.awayGoals;
  const scopedTotalGoals =
    scopedHomeGoals !== null && scopedAwayGoals !== null ? scopedHomeGoals + scopedAwayGoals : null;
  const scopedCorners = text.includes("半場") ? fixture.halfTimeCorners : fixture.finalCorners;

  if (text.includes("讓球主客和")) {
    const line = extractLineValue(rec.selectionName, rec.market);
    return settleHandicap(scopedHomeGoals, scopedAwayGoals, line, "home");
  }

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
    const handicapSide = selectionSide(selectionText);
    if (text.includes("角球")) {
      return settleHandicap(scopedCorners?.home ?? null, scopedCorners?.away ?? null, line, handicapSide);
    }
    return settleHandicap(scopedHomeGoals, scopedAwayGoals, line, handicapSide);
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
    const overUnder = overUnderPick(selectionText);
    if (side && !overUnder) {
      return settleHandicap(scopedCorners?.home ?? null, scopedCorners?.away ?? null, line, side);
    }
    const metric = side === "home" ? scopedCorners?.home ?? null : side === "away" ? scopedCorners?.away ?? null : scopedCorners?.total ?? null;
    return settleOverUnder(overUnder, metric, line);
  }

  if (text.includes("總入球") || text.includes("入球大細")) {
    const line = extractLineValue(rec.selectionName, rec.market);
    const side = isLegacyHomeHalfTeamTotal ? "home" : selectionSide(text);
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

    const db = await this.dbPromise;
    let repaired = false;

    for (const record of db.data.settled) {
      if (normalizeLegacyTeamTotalRecord(record)) {
        repaired = true;
      }
      if (normalizeThreeWayHandicapLabel(record)) {
        repaired = true;
      }
      const isLegacyHomeHalfTeamTotal = record.market === "球隊入球大細";
      const isOverUnder =
        record.market.includes("入球大細") ||
        record.market.includes("總入球") ||
        record.market.includes("大小") ||
        record.market.includes("角球");
      if (!isOverUnder && !record.market.includes("讓球")) {
        continue;
      }

      const actualSide = actualSideFromFixture(
        { market: record.market, selectionName: record.selectionName },
        {
          halfTimeScore: record.halfTimeScore,
          finalScore: record.finalScore,
          halfTimeCorners: record.halfTimeCorners,
          finalCorners: record.finalCorners
        } as Fixture
      );
      if (!actualSide) {
        continue;
      }

      const result = actualSide === record.predictedSide ? "win" : "loss";
      if (record.actualSide !== actualSide || record.result !== result) {
        record.actualSide = actualSide;
        record.result = result;
        repaired = true;
      }

      if (isLegacyHomeHalfTeamTotal) {
        record.market = "主隊半場入球大細";
        if (!selectionSide(record.selectionName)) {
          record.selectionName = `主隊 半場${record.selectionName}`;
        }
        repaired = true;
      }
    }

    if (repaired) {
      await db.write();
    }

    return db;
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
    const settled = new Set(db.data.settled.map((item) => item.key));

    for (const rec of recommendations) {
      if (rec.sourceProvider === "mock") {
        continue;
      }

      const feedback = this.toFeedback(rec);
      if (!feedback) {
        continue;
      }

      if (existing.has(feedback.key)) {
        continue;
      }

      if (settled.has(feedback.key)) {
        continue;
      }

      db.data.pending.push(feedback);
      existing.add(feedback.key);
    }

    await db.write();
  }

  async removeMockRecommendations(): Promise<number> {
    const db = await this.getDb();
    const before = db.data.pending.length + db.data.settled.length;
    db.data.pending = db.data.pending.filter((record) => !isMockFixtureRecord(record));
    db.data.settled = db.data.settled.filter((record) => !isMockFixtureRecord(record));
    let correctedSources = 0;

    for (const record of [...db.data.pending, ...db.data.settled]) {
      if (record.sourceProvider === "mock" && /^\d+$/.test(record.fixtureId)) {
        record.sourceProvider = "hkjc_graphql";
        correctedSources += 1;
      }
    }

    const removed = before - db.data.pending.length - db.data.settled.length;
    if (removed > 0 || correctedSources > 0) {
      await db.write();
    }
    return removed;
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
    page?: number;
  }): Promise<LearningHistoryRecord[]> {
    const db = await this.getDb();
    const status = options?.status ?? "all";
    const market = options?.market?.trim();
    const date = options?.date?.trim();
    const limit = Math.max(1, options?.limit ?? 200);
    const page = Math.max(1, options?.page ?? 1);

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
      halfTimeCorners: item.halfTimeCorners,
      finalCorners: item.finalCorners,
      status: "settled",
      createdAt: item.createdAt,
      settledAt: item.settledAt
    }));

    const filtered = [...pendingRecords, ...settledRecords]
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
      });

    const dedupedByKey = new Map<string, LearningHistoryRecord>();
    for (const record of filtered) {
      const existing = dedupedByKey.get(record.key);
      if (!existing || shouldReplaceHistoryRecord(existing, record)) {
        dedupedByKey.set(record.key, record);
      }
    }

    const combined = [...dedupedByKey.values()]
      .sort((a, b) =>
        historyKickoffTimestamp(b) - historyKickoffTimestamp(a)
        || historySortTimestamp(b) - historySortTimestamp(a)
        || a.key.localeCompare(b.key)
      )
      .slice((page - 1) * limit, page * limit);

    return combined;
  }

  async countHistory(options?: {
    market?: string;
    date?: string;
    status?: "all" | LearningHistoryStatus;
  }): Promise<number> {
    const records = await this.getHistory({ ...options, limit: Number.MAX_SAFE_INTEGER, page: 1 });
    return records.length;
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
        halfTimeCorners: item.halfTimeCorners || next.halfTimeCorners,
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
    const settledKeys = new Set(db.data.settled.map((item) => item.key));
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

      if (settledKeys.has(pending.key)) {
        continue;
      }

      db.data.settled.push({
        ...pending,
        actualSide: actual,
        result: actual === pending.predictedSide ? "win" : "loss",
        halfTimeScore: fixture.halfTimeScore,
        finalScore: fixture.finalScore,
        halfTimeCorners: fixture.halfTimeCorners,
        finalCorners: fixture.finalCorners,
        settledAt: new Date().toISOString()
      });
      settledKeys.add(pending.key);
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

  private buildSelfLearningDiagnostics(settled: LearningFeedback[]) {
    const report = this.buildBlindspotReport(settled);
    const byMarketEntries = Object.entries(report.byMarket).filter(([, metric]) => metric.sample >= 3);
    const weakestMarket = byMarketEntries.sort((a, b) => a[1].hitRate - b[1].hitRate || b[1].sample - a[1].sample)[0] ?? null;

    if (!weakestMarket) {
      return {
        summary: "目前樣本不足，系統正在快速累積學習資料，先保留探索樣本避免市場長期無法修正。",
        weakestMarket: null,
        weakestMarketHitRate: null,
        weakestMarketSample: null,
        actionItems: [
          "先讓每個重點市場累積至少 20–30 筆樣本，再判斷是否需要收緊門檻。",
          "保留探索樣本，避免新市場永久無訓練資料。"
        ]
      };
    }

    const [market, metric] = weakestMarket;
    const weakHitRate = Number((metric.hitRate * 100).toFixed(1));
    const actionItems = [
      `優先檢查 ${market} 的賠率段、聯賽分布與主客隊偏差，因為它是目前最弱的盲點。`,
      `已把 ${market} 納入自我修正管線，後續會提升該市場的 calibration 與門檻嚴格度。`
    ];

    if (metric.sample < 10) {
      actionItems.push("樣本尚少，先保留探測性訓練樣本，再判斷是否需要放大觀察窗。");
    } else {
      actionItems.push(`以 ${market} 為中心做錯誤聚類，優先檢查是否是聯賽、賠率區間或半場/全場方向偏差。`);
    }

    if (settled.length < 30) {
      actionItems.push("累積更多已結算樣本後再調整門檻，避免因小樣本造成過度修正。");
    }

    return {
      summary: `目前最弱市場是 ${market}（命中 ${weakHitRate}%；樣本 ${metric.sample}），屬於明顯盲點聚類，系統已納入自我修正流程。`,
      weakestMarket: market,
      weakestMarketHitRate: metric.hitRate,
      weakestMarketSample: metric.sample,
      actionItems
    };
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
      correction: this.correction,
      diagnostics: this.buildSelfLearningDiagnostics(db.data.settled)
    };
  }
}
