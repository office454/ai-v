import path from "node:path";
import { promises as fs } from "node:fs";
import type { DailyFixtureProvider } from "../providers/provider.js";
import {
  DEFAULT_RECOMMENDATION_THRESHOLDS,
  DEFAULT_WEIGHTS,
  type RecommendationThresholds,
  normalizeRecommendationThresholds,
  normalizeWeights,
  pickTopRecommendationsWithWeights
} from "../engine/scoring.js";
import type {
  DataSourceHealth,
  Fixture,
  LineupRecheckInsight,
  LearningHistoryRecord,
  LearningHistoryStatus,
  LearningSnapshot,
  Recommendation,
  RecommendationConsensusReport,
  ScoringWeights
} from "../types.js";
import { LearningStore } from "./learningStore.js";
import type { PendingSettlementDiagnosis } from "./learningStore.js";
import { buildConsensusSummarySections, reviewRecommendationsForConsensus } from "./assistantReviewService.js";
import { HkjcGraphqlProvider } from "../providers/hkjcGraphqlProvider.js";
import {
  fetchHkjcResultDetailByFixtureId,
  fetchHkjcResultFixtures,
  fetchHkjcResultFixturesWithOptions,
  type HkjcResultDetail
} from "./hkjcResultsService.js";
import { fetchTheSportsDbResultByMatchInfo, type TheSportsDbResultDetail } from "./theSportsDbResultsService.js";
import { fetchEspnLiveDataByMatchInfo, type EspnLiveDetail } from "./espnLiveDataService.js";
import { fetchFotMobLiveDataByMatchInfo } from "./fotMobLiveDataService.js";
import { fetchHighlightlyLiveDataByMatchInfo } from "./highlightlyLiveDataService.js";
import { fetchBigBallLiveDataByMatchInfo } from "./bigBallLiveDataService.js";

type LocalLearningDbRecord = Pick<
  LearningHistoryRecord,
  | "fixtureId"
  | "match"
  | "kickoffAt"
  | "matchDateHk"
  | "league"
  | "homeTeam"
  | "awayTeam"
  | "homeTeamEn"
  | "awayTeamEn"
  | "halfTimeScore"
  | "finalScore"
  | "finalCorners"
>;

type LocalSnapshotFixture = {
  fixtureId: string;
  kickoffAt?: string;
  league?: string;
  homeTeam?: string;
  awayTeam?: string;
  homeTeamEn?: string;
  awayTeamEn?: string;
};

async function loadLocalLearningFallbackByFixtureId(): Promise<Map<string, LocalLearningDbRecord>> {
  const map = new Map<string, LocalLearningDbRecord>();
  const root = process.cwd();
  const candidates = [
    process.env.PRACTICE_MAIN_LEARNING_DB_PATH,
    process.env.PRACTICE_THESPORTSDB_LEARNING_DB_PATH,
    path.resolve(root, "apps/api/data/practice-main-learning-db.json"),
    path.resolve(root, "apps/api/data/practice-thesportsdb-learning-db.json"),
    path.resolve(root, "data/practice-main-learning-db.json"),
    path.resolve(root, "data/practice-thesportsdb-learning-db.json")
  ].filter((item): item is string => !!item && item.trim().length > 0);

  for (const filePath of candidates) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as {
        pending?: LocalLearningDbRecord[];
        settled?: LocalLearningDbRecord[];
      };
      const all = [...(parsed.pending ?? []), ...(parsed.settled ?? [])];

      for (const item of all) {
        if (!item.fixtureId) {
          continue;
        }

        const existing = map.get(item.fixtureId);
        if (!existing) {
          map.set(item.fixtureId, item);
          continue;
        }

        map.set(item.fixtureId, {
          fixtureId: item.fixtureId,
          match: existing.match || item.match,
          kickoffAt: existing.kickoffAt || item.kickoffAt,
          matchDateHk: existing.matchDateHk || item.matchDateHk,
          league: existing.league || item.league,
          homeTeam: existing.homeTeam || item.homeTeam,
          awayTeam: existing.awayTeam || item.awayTeam,
          homeTeamEn: existing.homeTeamEn || item.homeTeamEn,
          awayTeamEn: existing.awayTeamEn || item.awayTeamEn,
          halfTimeScore: existing.halfTimeScore || item.halfTimeScore,
          finalScore: existing.finalScore || item.finalScore,
          finalCorners: existing.finalCorners || item.finalCorners
        });
      }
    } catch {
      // Ignore missing/unreadable optional fallback files.
    }
  }

  return map;
}

function collectSnapshotFixtures(node: unknown, target: LocalSnapshotFixture[]): void {
  if (!node || typeof node !== "object") {
    return;
  }

  const obj = node as Record<string, unknown>;
  const maybeId = typeof obj.id === "string" ? obj.id : undefined;
  const maybeKickoff = typeof obj.kickOffTime === "string" ? obj.kickOffTime : undefined;
  const home = obj.homeTeam as Record<string, unknown> | undefined;
  const away = obj.awayTeam as Record<string, unknown> | undefined;
  const tournament = obj.tournament as Record<string, unknown> | undefined;

  if (maybeId && maybeKickoff && home && away) {
    target.push({
      fixtureId: maybeId,
      kickoffAt: maybeKickoff,
      league:
        (typeof tournament?.name_ch === "string" ? tournament.name_ch : undefined)
        || (typeof tournament?.name_en === "string" ? tournament.name_en : undefined),
      homeTeam: typeof home.name_ch === "string" ? home.name_ch : undefined,
      awayTeam: typeof away.name_ch === "string" ? away.name_ch : undefined,
      homeTeamEn: typeof home.name_en === "string" ? home.name_en : undefined,
      awayTeamEn: typeof away.name_en === "string" ? away.name_en : undefined
    });
  }

  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectSnapshotFixtures(item, target);
      }
      continue;
    }

    collectSnapshotFixtures(value, target);
  }
}

async function loadLocalSnapshotFallbackByFixtureId(): Promise<Map<string, LocalSnapshotFixture>> {
  const map = new Map<string, LocalSnapshotFixture>();
  const root = process.cwd();
  const candidates = [
    process.env.HKJC_SNAPSHOT_PATH,
    path.resolve(root, "apps/api/data/hkjc-snapshot-complete.json"),
    path.resolve(root, "apps/api/data/hkjc-snapshot-devtools.json"),
    path.resolve(root, "apps/api/data/hkjc-snapshot.json"),
    path.resolve(root, "data/hkjc-snapshot-complete.json"),
    path.resolve(root, "data/hkjc-snapshot-devtools.json"),
    path.resolve(root, "data/hkjc-snapshot.json")
  ].filter((item): item is string => !!item && item.trim().length > 0);

  for (const filePath of candidates) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const fixtures: LocalSnapshotFixture[] = [];
      collectSnapshotFixtures(parsed, fixtures);

      for (const fixture of fixtures) {
        const existing = map.get(fixture.fixtureId);
        if (!existing) {
          map.set(fixture.fixtureId, fixture);
          continue;
        }

        map.set(fixture.fixtureId, {
          fixtureId: fixture.fixtureId,
          kickoffAt: existing.kickoffAt || fixture.kickoffAt,
          league: existing.league || fixture.league,
          homeTeam: existing.homeTeam || fixture.homeTeam,
          awayTeam: existing.awayTeam || fixture.awayTeam,
          homeTeamEn: existing.homeTeamEn || fixture.homeTeamEn,
          awayTeamEn: existing.awayTeamEn || fixture.awayTeamEn
        });
      }
    } catch {
      // Ignore optional snapshot files that do not exist.
    }
  }

  return map;
}

function hongKongDateFromIso(value: string | undefined): string | null {
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

function normalizeNameToken(value: string | undefined): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "")
    .replace(/^(fc|cf|ac|sc)/, "")
    .replace(/(fc|cf|ac|sc)$/g, "")
    .trim();
}

function sameDayTeamSimilarity(
  record: Pick<LearningHistoryRecord, "homeTeam" | "awayTeam" | "homeTeamEn" | "awayTeamEn" | "kickoffAt">,
  fixture: Pick<Fixture, "homeTeam" | "awayTeam" | "homeTeamEn" | "awayTeamEn" | "kickoffAt">
): number {
  const recordDay = hongKongDateFromIso(record.kickoffAt);
  const fixtureDay = hongKongDateFromIso(fixture.kickoffAt);
  if (!recordDay || !fixtureDay || recordDay !== fixtureDay) {
    return -1;
  }

  const recHome = normalizeNameToken(record.homeTeamEn || record.homeTeam);
  const recAway = normalizeNameToken(record.awayTeamEn || record.awayTeam);
  const fixHome = normalizeNameToken(fixture.homeTeamEn || fixture.homeTeam);
  const fixAway = normalizeNameToken(fixture.awayTeamEn || fixture.awayTeam);
  if (!recHome || !recAway || !fixHome || !fixAway) {
    return -1;
  }

  if (recHome === fixHome && recAway === fixAway) {
    return 4;
  }

  const recJoin = `${recHome}|${recAway}`;
  const fixJoin = `${fixHome}|${fixAway}`;
  if (recJoin === fixJoin) {
    return 4;
  }

  const partialHome = recHome.includes(fixHome) || fixHome.includes(recHome);
  const partialAway = recAway.includes(fixAway) || fixAway.includes(recAway);
  if (partialHome && partialAway) {
    return 3;
  }

  return -1;
}

export function needsSportsDbLiveFallback(fixture: Fixture): boolean {
  const status = (fixture.status ?? "").replace(/[^a-z0-9\u4e00-\u9fa5]/gi, "").toLowerCase();
  const isLive = /live|inplay|playing|firsthalf|secondhalf|halftime|進行|上半場|下半場|半場/.test(status)
    || fixture.marketOptions.some((option) => option.inplay);
  if (!isLive) return false;

  return !fixture.finalScore || !fixture.halfTimeScore || !fixture.finalCorners || !fixture.liveMinute;
}

export function mergeExternalFixtureFallback(
  fixture: Fixture,
  detail: TheSportsDbResultDetail | EspnLiveDetail,
  source: "TheSportsDB" | "ESPN" | "FotMob" | "Highlightly" | "BigBall"
): Fixture {
  const filledFields: string[] = [];
  if (!fixture.finalScore && detail.finalScore) filledFields.push("即時比分");
  if (!fixture.halfTimeScore && detail.halfTimeScore) filledFields.push("半場比分");
  if (!fixture.status && detail.status) filledFields.push("賽事狀態");
  if (!fixture.liveMinute && detail.liveMinute) filledFields.push(`賽事分鐘（${detail.liveMinute}'）`);
  const externalCorners = "finalCorners" in detail ? detail.finalCorners : undefined;
  const externalLineup = "lineup" in detail ? detail.lineup : undefined;
  const externalAttackingMetrics = "liveAttackingMetrics" in detail ? detail.liveAttackingMetrics : undefined;
  const externalPressureMetrics = "livePressureMetrics" in detail ? detail.livePressureMetrics : undefined;
  if (!fixture.finalCorners && externalCorners) filledFields.push("即時角球");
  if (!fixture.lineup.confirmed && externalLineup?.confirmed) filledFields.push("確認陣容");
  if (!fixture.liveAttackingMetrics && externalAttackingMetrics) filledFields.push("即時進攻指標");
  if (!fixture.livePressureMetrics && externalPressureMetrics) filledFields.push("卡牌及換人");
  const sourceKey = source.toLowerCase();
  const liveDataSources = [...new Set([...(fixture.liveDataSources ?? ["hkjc"]), sourceKey])];
  const externalStatus = String(detail.status ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  const externalFinished = /^(ft|aet|finished|result|ended|fulltime|complete|completed)$/.test(externalStatus);

  return {
    ...fixture,
    status: externalFinished ? detail.status : fixture.status || detail.status,
    finalScore: fixture.finalScore ?? detail.finalScore,
    halfTimeScore: fixture.halfTimeScore ?? detail.halfTimeScore,
    finalCorners: fixture.finalCorners ?? externalCorners,
    lineup: fixture.lineup.confirmed ? fixture.lineup : externalLineup ?? fixture.lineup,
    liveMinute: fixture.liveMinute ?? detail.liveMinute,
    liveMinuteSource: fixture.liveMinuteSource ?? (detail.liveMinute ? source : undefined),
    liveAttackingMetrics: fixture.liveAttackingMetrics ?? externalAttackingMetrics,
    livePressureMetrics: fixture.livePressureMetrics ?? externalPressureMetrics,
    liveDataSources,
    liveDataFallbackNote: filledFields.length > 0
      ? `HKJC 即時資料不完整；${source} 已補充${filledFields.join("、")}。`
      : `HKJC 即時資料不完整；${source} 已完成交叉核對，但未提供額外可補欄位。`
  };
}

export function mergeSportsDbFixtureFallback(fixture: Fixture, detail: TheSportsDbResultDetail): Fixture {
  return mergeExternalFixtureFallback(fixture, detail, "TheSportsDB");
}

type RecommendationConsensusOptions = {
  enabled?: boolean;
  ollamaEnabled?: boolean;
  ollamaBaseUrl?: string;
  ollamaApiKey?: string;
  ollamaModel?: string;
  ollamaFallbackModels?: string[];
  apiKey?: string;
  model?: string;
  candidateLimit?: number;
  fallbackModels?: string[];
  temperature?: number;
  referer?: string;
  title?: string;
};

function recommendationConsensusKey(recommendation: Recommendation): string {
  return `${recommendation.fixtureId}::${recommendation.market}::${recommendation.selectionName}`;
}

type SettlementBackfillResult = {
  pendingBefore: number;
  pendingAfter: number;
  settledNow: number;
  backfillCandidates: number;
  backfillFetched: number;
  purgedBeforeToday: number;
  pendingDiagnostics: PendingSettlementDiagnosis[];
};

type SettlementBackfillOptions = {
  quick?: boolean;
};

const PENDING_HISTORY_RETENTION_DAYS = 7;

function shiftIsoDateKey(isoDate: string, days: number): string {
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

export function settlementResultDateRange(todayHk: string): { startDate: string; endDate: string } {
  return {
    startDate: shiftIsoDateKey(todayHk, -PENDING_HISTORY_RETENTION_DAYS).replaceAll("-", ""),
    endDate: todayHk.replaceAll("-", "")
  };
}

export function isFixtureFinishedForRecommendations(fixture: Fixture, nowMs: number): boolean {
  const kickoffMs = new Date(fixture.kickoffAt).getTime();
  if (!Number.isFinite(kickoffMs) || kickoffMs > nowMs) {
    return false;
  }

  const status = (fixture.status ?? "").trim().toLowerCase();
  if (/finished|fulltime|full_time|ended|result|取消|腰斬|完場|結束/.test(status)) {
    return true;
  }
  if (/live|in.?play|playing|running|active|firsthalf|secondhalf|half.?time|進行|上半場|下半場|半場/.test(status)) {
    return false;
  }

  const hasAvailableOption = fixture.marketOptions.some((option) => {
    const poolStatus = option.poolStatus.toLowerCase();
    const combinationStatus = option.combinationStatus.toLowerCase();
    const poolOpen = poolStatus.includes("sell") || poolStatus.includes("open");
    const combinationOpen =
      combinationStatus.includes("avail") || combinationStatus.includes("sell") || combinationStatus.includes("open");
    return option.inplay || (poolOpen && combinationOpen);
  });

  return !hasAvailableOption;
}

export function isFixturePreMatchForTopFive(fixture: Fixture, nowMs: number): boolean {
  const status = String(fixture.status ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  if (/live|inplay|playing|running|active|firsthalf|secondhalf|halftime|finished|fulltime|ended|進行|上半場|下半場|半場|完場|已結束/.test(status)) {
    return false;
  }

  const kickoffMs = Date.parse(fixture.kickoffAt);
  return Number.isFinite(kickoffMs) && kickoffMs > nowMs;
}

export class AnalysisService {
  private static readonly DASHBOARD_TOP_LIMIT = 5;
  private static readonly CANDIDATE_POOL_CAP = 80;

  private fixtures: Fixture[] = [];
  private fixtureFocusRecommendationById = new Map<string, Recommendation>();
  private recommendationShortlist: Recommendation[] = [];
  private recommendations: Recommendation[] = [];
  private highOddsValueRecommendations: Recommendation[] = [];
  private consensusApprovedRecommendations: Recommendation[] = [];
  private consensusRejectedRecommendations: Recommendation[] = [];
  private consensusReport: RecommendationConsensusReport | null = null;
  private weights: ScoringWeights = DEFAULT_WEIGHTS;
  private thresholds: RecommendationThresholds = DEFAULT_RECOMMENDATION_THRESHOLDS;
  private learningSnapshot: LearningSnapshot | null = null;
  private dataSourceHealth: DataSourceHealth;
  private readonly configuredProvider: string;
  private lineupRecheckInsights: LineupRecheckInsight[] = [];

  private dashboardRecommendationByFixture(recommendations: Recommendation[]): Map<string, Recommendation> {
    const byFixture = new Map<string, Recommendation>();
    for (const recommendation of recommendations) {
      if (!byFixture.has(recommendation.fixtureId)) {
        byFixture.set(recommendation.fixtureId, recommendation);
      }
    }

    return byFixture;
  }

  private buildFixtureFocusRecommendation(fixture: Fixture): Recommendation | null {
    const strict = pickTopRecommendationsWithWeights([fixture], this.weights, 1, this.thresholds);
    const candidates = strict.length > 0
      ? strict
      : pickTopRecommendationsWithWeights([fixture], this.weights, 1, {
          ...this.thresholds,
          minRecommendedOdds: 1.01
        });
    return this.learningStore.adjustRecommendations(candidates)[0] ?? null;
  }

  private updateFixtureFocusRecommendation(fixture: Fixture | null): void {
    if (!fixture) {
      return;
    }

    const recommendation = this.buildFixtureFocusRecommendation(fixture);
    if (recommendation) {
      this.fixtureFocusRecommendationById.set(fixture.id, recommendation);
    } else {
      this.fixtureFocusRecommendationById.delete(fixture.id);
    }
  }

  private buildHighOddsProfile(recommendation: Recommendation, aiConsensusNote?: string): NonNullable<Recommendation["highOddsProfile"]> {
    const evPct = recommendation.valueScore * 100;
    const tier: "A" | "B" | "C" =
      recommendation.confidence >= 74 && recommendation.edgeScore >= 5.5 && recommendation.valueScore >= 0.16
        ? "A"
        : recommendation.confidence >= 66 && recommendation.edgeScore >= 3.5 && recommendation.valueScore >= 0.1
          ? "B"
          : "C";

    const baseStakeByTier = tier === "A" ? 1.8 : tier === "B" ? 1.1 : 0.7;
    const oddsRiskPenalty = recommendation.currentOdds >= 7 ? 0.4 : recommendation.currentOdds >= 5 ? 0.25 : 0.1;
    const evBoost = Math.min(0.7, Math.max(0, evPct * 0.05));
    const suggestedStakePct = Math.max(0.4, Math.min(2.5, Number((baseStakeByTier - oddsRiskPenalty + evBoost).toFixed(2))));

    const rationale = [
      `EV ${evPct.toFixed(2)}%（由值搏率換算）`,
      `信心 ${recommendation.confidence.toFixed(1)}%，edge ${recommendation.edgeScore.toFixed(2)}%`,
      `高賠倍率 ${recommendation.currentOdds.toFixed(2)} 已反映注碼折減`
    ];

    return {
      tier,
      suggestedStakePct,
      evPct: Number(evPct.toFixed(2)),
      aiConsensusNote,
      rationale
    };
  }

  private currentDashboardRecommendations(): Recommendation[] {
    return [...this.recommendations, ...this.highOddsValueRecommendations];
  }

  private appendLineupRecheckInsights(insights: LineupRecheckInsight[]): void {
    if (insights.length === 0) {
      return;
    }

    const byFixture = new Map<string, LineupRecheckInsight>();
    for (const existing of this.lineupRecheckInsights) {
      byFixture.set(existing.fixtureId, existing);
    }

    for (const insight of insights) {
      byFixture.set(insight.fixtureId, insight);
    }

    this.lineupRecheckInsights = [...byFixture.values()]
      .sort((left, right) => Date.parse(right.checkedAt) - Date.parse(left.checkedAt))
      .slice(0, 80);
  }

  private mergeFixtures(nextFixtures: Fixture[]): void {
    const merged = new Map(this.fixtures.map((fixture) => [fixture.id, fixture]));
    for (const fixture of nextFixtures) {
      merged.set(fixture.id, fixture);
    }
    this.fixtures = [...merged.values()];
  }

  private hydrateRecommendationContext(recommendations: Recommendation[]): Recommendation[] {
    if (recommendations.length === 0 || this.fixtures.length === 0) {
      return recommendations;
    }

    const fixtureById = new Map(this.fixtures.map((fixture) => [fixture.id, fixture]));
    return recommendations.map((recommendation) => {
      const fixture = fixtureById.get(recommendation.fixtureId);
      if (!fixture) {
        return {
          ...recommendation,
          sourceProvider: recommendation.sourceProvider ?? this.dataSourceHealth.provider
        };
      }

      return {
        ...recommendation,
        kickoffAt: recommendation.kickoffAt || fixture.kickoffAt,
        matchDateHk: recommendation.matchDateHk || hongKongDateFromIso(recommendation.kickoffAt || fixture.kickoffAt) || undefined,
        league: recommendation.league || fixture.league,
        homeTeam: recommendation.homeTeam || fixture.homeTeam,
        awayTeam: recommendation.awayTeam || fixture.awayTeam,
        homeTeamEn: recommendation.homeTeamEn || fixture.homeTeamEn,
        awayTeamEn: recommendation.awayTeamEn || fixture.awayTeamEn,
        matchKey:
          recommendation.matchKey ||
          `${fixture.homeTeam.replace(/\s+/g, "").toLowerCase()}|${fixture.awayTeam.replace(/\s+/g, "").toLowerCase()}`,
        sourceProvider: recommendation.sourceProvider ?? this.dataSourceHealth.provider
      };
    });
  }

  private async backfillLearningMatchNames(primaryFixtures: Fixture[]): Promise<void> {
    const fetchByIds = this.provider.fetchFixturesByIds?.bind(this.provider);
    await this.learningStore.backfillMatchNames(primaryFixtures);

    if (!fetchByIds) {
      return;
    }

    const missingFixtureIds = await this.learningStore.fixtureIdsMissingMatchNames(500);
    if (missingFixtureIds.length === 0) {
      return;
    }

    const lookedUp = await fetchByIds(missingFixtureIds);
    if (lookedUp.length === 0) {
      return;
    }

    this.mergeFixtures(lookedUp);
    await this.learningStore.backfillMatchNames(lookedUp);
  }

  private async settleWithBackfill(
    primaryFixtures: Fixture[],
    options: SettlementBackfillOptions = {}
  ): Promise<SettlementBackfillResult> {
    const quickMode = options.quick ?? false;
    const before = await this.learningStore.getSnapshot(this.weights, this.thresholds);
    try {
      await this.backfillLearningMatchNames(primaryFixtures);
    } catch (error) {
      console.warn("[settlement] Match-name backfill failed; keeping primary fixtures.", error);
    }
    let settledNow = await this.learningStore.settleFromFixtures(primaryFixtures);

    const hkParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Hong_Kong",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const part = (type: string): string => hkParts.find((item) => item.type === type)?.value ?? "00";
    const todayHk = `${part("year")}-${part("month")}-${part("day")}`;

    const oldPendingFixtureIds = await this.learningStore.pendingFixtureIdsBeforeHongKongDate(todayHk, 200);
    let backfillFetched = 0;

    const fetchByIds = this.provider.fetchFixturesByIds?.bind(this.provider);

    if (oldPendingFixtureIds.length > 0 && fetchByIds) {
      try {
        const lookedUp = await fetchByIds(oldPendingFixtureIds);
        backfillFetched = lookedUp.length;

        if (lookedUp.length > 0) {
          settledNow += await this.learningStore.settleFromFixtures(lookedUp);
          this.mergeFixtures(lookedUp);
          await this.learningStore.backfillMatchNames(lookedUp);
        }
      } catch (error) {
        console.warn("[settlement] Provider backfill failed; keeping primary fixtures.", error);
      }
    }

    // Snapshot mode may not carry final scores. Use HKJC GraphQL by-id lookup as settlement fallback.
    const pendingAfterLookup = await this.learningStore.pendingFixtureIds(200);
    if (!quickMode && pendingAfterLookup.length > 0) {
      try {
        const graphqlQuery = process.env.HKJC_GRAPHQL_QUERY?.trim();
        if (graphqlQuery) {
          const graphqlVariables = JSON.parse(process.env.HKJC_GRAPHQL_VARIABLES_JSON ?? "{}") as Record<string, unknown>;
          const graphqlProvider = new HkjcGraphqlProvider(
            process.env.HKJC_GRAPHQL_ENDPOINT ?? "https://info.cld.hkjc.com/graphql/base/",
            process.env.HKJC_GRAPHQL_REFERER ?? "https://bet.hkjc.com/ch/football/home",
            graphqlQuery,
            graphqlVariables,
            3000
          );

          const lookedUpFromGraphql = await graphqlProvider.fetchFixturesByIds(pendingAfterLookup);
          backfillFetched += lookedUpFromGraphql.length;

          if (lookedUpFromGraphql.length > 0) {
            settledNow += await this.learningStore.settleFromFixtures(lookedUpFromGraphql);
            this.mergeFixtures(lookedUpFromGraphql);
            await this.learningStore.backfillMatchNames(lookedUpFromGraphql);
          }

          // If ID lookups still miss, search finished fixtures from the last 3 days
          // and settle by match-name fallback in LearningStore.
          const pendingAfterIdLookup = await this.learningStore.pendingFixtureIds(200);
          if (pendingAfterIdLookup.length > 0) {
            const resultDateRange = settlementResultDateRange(todayHk);

            const recentResultProvider = new HkjcGraphqlProvider(
              process.env.HKJC_GRAPHQL_ENDPOINT ?? "https://info.cld.hkjc.com/graphql/base/",
              process.env.HKJC_GRAPHQL_REFERER ?? "https://bet.hkjc.com/ch/football/home",
              graphqlQuery,
              {
                ...graphqlVariables,
                ...resultDateRange,
                showAllMatch: true,
                inplayOnly: false,
                featuredMatchesOnly: false,
                matchIds: null,
                frontEndIds: null,
                earlySettlementOnly: false
              },
              3000
            );

            const recentFixtures = await recentResultProvider.fetchTodayFixtures();
            const recentWithScore = recentFixtures.filter((fixture) => !!fixture.finalScore);
            if (recentWithScore.length > 0) {
              settledNow += await this.learningStore.settleFromFixtures(recentWithScore);
              this.mergeFixtures(recentWithScore);
              await this.learningStore.backfillMatchNames(recentWithScore);
            }
          }
        }
      } catch (error) {
        console.warn("[settlement] HKJC GraphQL fallback failed.", error);
      }
    }

    // If snapshot/GraphQL backfill still misses final scores, fallback to the HKJC results page feed.
    const pendingAfterGraphql = await this.learningStore.pendingFixtureIds(200);
    if (!quickMode && pendingAfterGraphql.length > 0) {
      try {
        const resultFixtures = await fetchHkjcResultFixtures();
        const lookedUpFromSettlement = resultFixtures.filter(
          (fixture) => pendingAfterGraphql.includes(fixture.id) || !!fixture.finalScore
        );
        backfillFetched += lookedUpFromSettlement.length;

        if (lookedUpFromSettlement.length > 0) {
          settledNow += await this.learningStore.settleFromFixtures(lookedUpFromSettlement);
          this.mergeFixtures(lookedUpFromSettlement);
          await this.learningStore.backfillMatchNames(lookedUpFromSettlement);
        }
      } catch (error) {
        console.warn("[settlement] HKJC results-page fallback failed.", error);
      }
    }

    // HKJC can retain a stale pre-event/live status after publishing final scores.
    // Cross-check the same fixture on FotMob so only an explicit finished status can unlock settlement.
    const pendingAfterHkjcResults = new Set(await this.learningStore.pendingFixtureIds(200));
    if (!quickMode && pendingAfterHkjcResults.size > 0) {
      const fotMobCandidates = this.fixtures.filter((fixture) =>
        pendingAfterHkjcResults.has(fixture.id)
        && !!fixture.kickoffAt
        && !!fixture.homeTeamEn
        && !!fixture.awayTeamEn
      );

      const fotMobLookups = await Promise.allSettled(fotMobCandidates.map(async (fixture) => {
        const detail = await fetchFotMobLiveDataByMatchInfo({
          fixtureId: fixture.id,
          kickoffAt: fixture.kickoffAt,
          homeTeamEn: fixture.homeTeamEn,
          awayTeamEn: fixture.awayTeamEn
        });
        return detail ? mergeExternalFixtureFallback(fixture, detail, "FotMob") : null;
      }));
      const fotMobFixtures = fotMobLookups
        .filter((result): result is PromiseFulfilledResult<Fixture | null> => result.status === "fulfilled")
        .map((result) => result.value)
        .filter((fixture): fixture is Fixture => !!fixture);

      if (fotMobFixtures.length > 0) {
        backfillFetched += fotMobFixtures.length;
        settledNow += await this.learningStore.settleFromFixtures(fotMobFixtures);
        this.mergeFixtures(fotMobFixtures);
      }
    }

    const purgeBeforeDate = shiftIsoDateKey(todayHk, -PENDING_HISTORY_RETENTION_DAYS);
    const purgedBeforeToday = await this.learningStore.deletePendingBeforeHongKongDate(purgeBeforeDate);
    const after = await this.learningStore.getSnapshot(this.weights, this.thresholds);
    const pendingDiagnostics = await this.learningStore.diagnosePending(this.fixtures, 200);
    const pendingFixtureIds = await this.learningStore.pendingFixtureIds(200);
    return {
      pendingBefore: before.pendingCount,
      pendingAfter: after.pendingCount,
      settledNow,
      backfillCandidates: pendingFixtureIds.length,
      backfillFetched,
      purgedBeforeToday,
      pendingDiagnostics
    };
  }

  constructor(
    private readonly provider: DailyFixtureProvider,
    weights?: Partial<ScoringWeights>,
    thresholds?: Partial<RecommendationThresholds>,
    private readonly learningStore: LearningStore = new LearningStore(),
    sourceInfo?: { provider?: string; queryVersion?: string },
    private readonly recommendationConsensusOptions: RecommendationConsensusOptions = {}
  ) {
    this.weights = normalizeWeights(weights);
    this.thresholds = normalizeRecommendationThresholds(thresholds);
    this.configuredProvider = sourceInfo?.provider ?? "unknown";
    this.dataSourceHealth = {
      provider: this.configuredProvider,
      queryVersion: sourceInfo?.queryVersion,
      ok: false,
      hasCurrentOdds: false,
      fixtureCount: 0,
      optionsCount: 0,
      lastCheckedAt: new Date().toISOString()
    };
  }

  private markRefreshSuccess(fixtures: Fixture[]): void {
    const optionsCount = fixtures.reduce((sum, fixture) => sum + fixture.marketOptions.length, 0);
    const hasCurrentOdds = fixtures.some((fixture) =>
      fixture.marketOptions.some((option) => Number.isFinite(option.currentOdds) && option.currentOdds > 1)
    );
    const now = new Date().toISOString();
    this.dataSourceHealth = {
      ...this.dataSourceHealth,
      provider: this.configuredProvider,
      ok: fixtures.length > 0 && hasCurrentOdds,
      hasCurrentOdds,
      fixtureCount: fixtures.length,
      optionsCount,
      lastCheckedAt: now,
      lastSuccessfulAt: fixtures.length > 0 && hasCurrentOdds ? now : this.dataSourceHealth.lastSuccessfulAt,
      lastError: fixtures.length > 0 && hasCurrentOdds ? undefined : "No usable current odds returned"
    };
  }

  private markRefreshFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : "Unknown provider refresh error";
    this.dataSourceHealth = {
      ...this.dataSourceHealth,
      ok: false,
      hasCurrentOdds: false,
      fixtureCount: 0,
      optionsCount: 0,
      lastCheckedAt: new Date().toISOString(),
      lastError: message
    };
  }

  private isFixtureFinished(fixture: Fixture, nowMs: number): boolean {
    return isFixtureFinishedForRecommendations(fixture, nowMs);
  }

  private toHongKongDateKey(inputMs: number): string {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Hong_Kong",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false
    }).formatToParts(new Date(inputMs));

    const pick = (type: string): number => {
      const value = parts.find((part) => part.type === type)?.value ?? "0";
      return Number(value);
    };

    const year = pick("year");
    const month = pick("month");
    const day = pick("day");
    const hour = pick("hour");

    // Betting day rolls over at 08:00 Hong Kong time.
    const dayStartUtc = Date.UTC(year, month - 1, day) - (hour < 8 ? 86400000 : 0);
    const bettingDate = new Date(dayStartUtc);
    const y = bettingDate.getUTCFullYear();
    const m = String(bettingDate.getUTCMonth() + 1).padStart(2, "0");
    const d = String(bettingDate.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  private isFixtureToday(fixture: Fixture, nowMs: number): boolean {
    const kickoffMs = new Date(fixture.kickoffAt).getTime();
    if (!Number.isFinite(kickoffMs)) {
      return false;
    }

    return this.toHongKongDateKey(kickoffMs) === this.toHongKongDateKey(nowMs);
  }

  private async recomputeRecommendations(): Promise<void> {
    const nowMs = Date.now();
    const eligibleFixtures = this.fixtures.filter(
      (fixture) => this.isFixtureToday(fixture, nowMs) && !this.isFixtureFinished(fixture, nowMs)
    );
    const candidatePoolLimit = Math.min(
      AnalysisService.CANDIDATE_POOL_CAP,
      Math.max(AnalysisService.DASHBOARD_TOP_LIMIT, eligibleFixtures.length * 4)
    );

    const rankedByValueRaw = pickTopRecommendationsWithWeights(
      eligibleFixtures,
      this.weights,
      candidatePoolLimit,
      this.thresholds
    );
    const relaxedRankedByValueRaw =
      rankedByValueRaw.length > 0
        ? rankedByValueRaw
        : pickTopRecommendationsWithWeights(
            eligibleFixtures,
            this.weights,
            candidatePoolLimit,
            {
              ...this.thresholds,
              minRecommendedOdds: 1.01
            }
          );
    const rankedByValue = this.learningStore.adjustRecommendations(relaxedRankedByValueRaw);

    const modelOrderedRecommendations = [...rankedByValue]
      .sort(
        (a, b) =>
          b.confidence - a.confidence ||
          b.edgeScore - a.edgeScore ||
          b.valueScore - a.valueScore ||
          b.currentOdds - a.currentOdds
      );

    const consensusCandidateLimit = Math.max(
      AnalysisService.DASHBOARD_TOP_LIMIT,
      this.recommendationConsensusOptions.candidateLimit ?? 8
    );
    const consensusCandidates = modelOrderedRecommendations.slice(0, consensusCandidateLimit);
    this.recommendationShortlist = consensusCandidates;
    const consensusResult = this.recommendationConsensusOptions.enabled
      ? await reviewRecommendationsForConsensus(consensusCandidates, {
          ollamaEnabled: this.recommendationConsensusOptions.ollamaEnabled,
          ollamaBaseUrl: this.recommendationConsensusOptions.ollamaBaseUrl,
          ollamaApiKey: this.recommendationConsensusOptions.ollamaApiKey,
          ollamaModel: this.recommendationConsensusOptions.ollamaModel,
          ollamaFallbackModels: this.recommendationConsensusOptions.ollamaFallbackModels,
          apiKey: this.recommendationConsensusOptions.apiKey,
          model: this.recommendationConsensusOptions.model,
          fallbackModels: this.recommendationConsensusOptions.fallbackModels,
          temperature: this.recommendationConsensusOptions.temperature,
          referer: this.recommendationConsensusOptions.referer,
          title: this.recommendationConsensusOptions.title
        })
      : {
          recommendations: consensusCandidates,
          rejectedRecommendations: [],
          summary: "AI 共識審查未啟用，保留模型主選結果。",
          summarySections: buildConsensusSummarySections("AI 共識審查未啟用，保留模型主選結果。"),
          reviewMode: "local_fallback" as const,
          model: this.recommendationConsensusOptions.model ?? "openai/gpt-4o-mini",
          dataIssues: [],
          consensusNotes: {}
        };

    const shouldUseConsensusApprovals = consensusResult.reviewMode !== "local_fallback";
    const approvedKeys = new Set(
      consensusResult.recommendations.map((recommendation) =>
        `${recommendation.fixtureId}::${recommendation.market}::${recommendation.selectionName}`
      )
    );
    this.consensusApprovedRecommendations = shouldUseConsensusApprovals ? consensusResult.recommendations : [];
    this.consensusRejectedRecommendations = shouldUseConsensusApprovals
      ? consensusResult.rejectedRecommendations.length > 0
        ? consensusResult.rejectedRecommendations
        : consensusCandidates.filter(
            (recommendation) =>
              !approvedKeys.has(`${recommendation.fixtureId}::${recommendation.market}::${recommendation.selectionName}`)
          )
      : [];
    this.consensusReport = {
      reviewMode: consensusResult.reviewMode,
      model: consensusResult.model,
      summary: consensusResult.summary,
      summarySections: consensusResult.summarySections,
      candidateCount: consensusCandidates.length,
      approvedCount: this.consensusApprovedRecommendations.length,
      rejectedCount: this.consensusRejectedRecommendations.length,
      dataIssues: consensusResult.dataIssues
    };

    const useModelFallbackForDisplay =
      consensusResult.reviewMode !== "local_fallback" &&
      consensusResult.recommendations.length === 0 &&
      modelOrderedRecommendations.length > 0;

    if (useModelFallbackForDisplay && this.consensusReport) {
      this.consensusReport = {
        ...this.consensusReport,
        summary: `${consensusResult.summary} AI 本輪未保留候選，前台暫以模型 shortlist 顯示。`,
        summarySections: buildConsensusSummarySections(`${consensusResult.summary} AI 本輪未保留候選，前台暫以模型 shortlist 顯示。`)
      };
    }

    const consensusOrderedRecommendations =
      consensusResult.recommendations.length > 0 && !useModelFallbackForDisplay
        ? consensusResult.recommendations
        : modelOrderedRecommendations;

    this.recommendations = consensusOrderedRecommendations
      .slice(0, AnalysisService.DASHBOARD_TOP_LIMIT)
      .map((item) => {
        const key = recommendationConsensusKey(item);
        const aiConsensusNote = consensusResult.consensusNotes[key] ?? undefined;
        if (item.currentOdds < this.thresholds.highOddsThreshold) {
          return item;
        }
        return {
          ...item,
          highOddsProfile: this.buildHighOddsProfile(item, aiConsensusNote)
        };
      });

    this.highOddsValueRecommendations = [];

    const recommendationsForLearning = this.hydrateRecommendationContext([...this.recommendations]);

    // Keep recommendation history append-only so past daily picks remain reviewable.
    await this.learningStore.registerRecommendations(recommendationsForLearning);
    this.learningSnapshot = await this.learningStore.getSnapshot(this.weights, this.thresholds);
  }

  async refreshDailyFixtures(options: { quick?: boolean } = {}): Promise<void> {
    const quick = options.quick ?? true;

    try {
      this.fixtures = await this.provider.fetchTodayFixtures();
      this.fixtureFocusRecommendationById.clear();
      this.markRefreshSuccess(this.fixtures);
      try {
        await this.settleWithBackfill(this.fixtures, { quick });
      } catch (error) {
        console.warn("[settlement] Daily backfill failed; keeping primary fixtures.", error);
      }
      await this.recomputeRecommendations();
    } catch (error) {
      this.markRefreshFailure(error);
      throw error;
    }
  }

  async refreshFixtureFocus(fixtureId: string, options: { quick?: boolean } = {}): Promise<Fixture | null> {
    const quick = options.quick ?? true;

    try {
      const freshMatches = this.provider.fetchFixturesByIds
        ? await this.provider.fetchFixturesByIds([fixtureId])
        : await this.provider.fetchTodayFixtures();

      const merged = new Map(this.fixtures.map((fixture) => [fixture.id, fixture]));
      for (const fixture of freshMatches) {
        if (fixture.id === fixtureId) {
          merged.set(fixture.id, fixture);
        }
      }

      this.fixtures = [...merged.values()];
      this.markRefreshSuccess(this.fixtures);

      let updatedFixture = this.fixtures.find((fixture) => fixture.id === fixtureId) ?? null;
      if (updatedFixture) {
        if (needsSportsDbLiveFallback(updatedFixture)) {
          try {
            const sportsDbDetail = await fetchTheSportsDbResultByMatchInfo({
              fixtureId: updatedFixture.id,
              kickoffAt: updatedFixture.kickoffAt,
              homeTeamEn: updatedFixture.homeTeamEn,
              awayTeamEn: updatedFixture.awayTeamEn,
              match: `${updatedFixture.homeTeamEn || updatedFixture.homeTeam} vs ${updatedFixture.awayTeamEn || updatedFixture.awayTeam}`
            });
            if (sportsDbDetail) {
              updatedFixture = mergeSportsDbFixtureFallback(updatedFixture, sportsDbDetail);
            }
          } catch (error) {
            console.warn(`[fixture-focus] TheSportsDB fallback failed for fixture ${fixtureId}.`, error);
          }
        }
        if (!updatedFixture.lineup.confirmed || needsSportsDbLiveFallback(updatedFixture)) {
          try {
            const highlightlyDetail = await fetchHighlightlyLiveDataByMatchInfo({
              fixtureId: updatedFixture.id,
              kickoffAt: updatedFixture.kickoffAt,
              homeTeamEn: updatedFixture.homeTeamEn,
              awayTeamEn: updatedFixture.awayTeamEn
            });
            if (highlightlyDetail) {
              updatedFixture = mergeExternalFixtureFallback(updatedFixture, highlightlyDetail, "Highlightly");
            }
          } catch (error) {
            console.warn(`[fixture-focus] Highlightly fallback failed for fixture ${fixtureId}.`, error);
          }
        }
        if (!updatedFixture.lineup.confirmed || needsSportsDbLiveFallback(updatedFixture)) {
          try {
            const bigBallDetail = await fetchBigBallLiveDataByMatchInfo({
              fixtureId: updatedFixture.id,
              kickoffAt: updatedFixture.kickoffAt,
              homeTeamEn: updatedFixture.homeTeamEn,
              awayTeamEn: updatedFixture.awayTeamEn
            });
            if (bigBallDetail) {
              updatedFixture = mergeExternalFixtureFallback(updatedFixture, bigBallDetail, "BigBall");
            }
          } catch (error) {
            console.warn(`[fixture-focus] BigBall fallback failed for fixture ${fixtureId}.`, error);
          }
        }
        if (needsSportsDbLiveFallback(updatedFixture)) {
          try {
            const espnDetail = await fetchEspnLiveDataByMatchInfo({
              fixtureId: updatedFixture.id,
              kickoffAt: updatedFixture.kickoffAt,
              homeTeamEn: updatedFixture.homeTeamEn,
              awayTeamEn: updatedFixture.awayTeamEn
            });
            if (espnDetail) {
              updatedFixture = mergeExternalFixtureFallback(updatedFixture, espnDetail, "ESPN");
            }
          } catch (error) {
            console.warn(`[fixture-focus] ESPN fallback failed for fixture ${fixtureId}.`, error);
          }
        }
        if (!updatedFixture.lineup.confirmed || needsSportsDbLiveFallback(updatedFixture)) {
          try {
            const fotMobDetail = await fetchFotMobLiveDataByMatchInfo({
              fixtureId: updatedFixture.id,
              kickoffAt: updatedFixture.kickoffAt,
              homeTeamEn: updatedFixture.homeTeamEn,
              awayTeamEn: updatedFixture.awayTeamEn
            });
            if (fotMobDetail) {
              updatedFixture = mergeExternalFixtureFallback(updatedFixture, fotMobDetail, "FotMob");
            }
          } catch (error) {
            console.warn(`[fixture-focus] FotMob fallback failed for fixture ${fixtureId}.`, error);
          }
        }
        updatedFixture = await this.enrichFixtureCornerHistory(updatedFixture);
        this.fixtures = this.fixtures.map((fixture) => fixture.id === fixtureId ? updatedFixture as Fixture : fixture);
      }
      if (quick) {
        this.updateFixtureFocusRecommendation(updatedFixture);
        return updatedFixture;
      }

      await this.settleWithBackfill(this.fixtures, { quick: false });
      await this.recomputeRecommendations();
      this.updateFixtureFocusRecommendation(updatedFixture);
      return updatedFixture;
    } catch (error) {
      this.markRefreshFailure(error);
      throw error;
    }
  }

  private async enrichFixtureCornerHistory(fixture: Fixture): Promise<Fixture> {
    const records = await this.learningStore.getHistory({ status: "settled", limit: 1000 });
    const homeNames = new Set([fixture.homeTeam, fixture.homeTeamEn].map(normalizeNameToken).filter(Boolean));
    const awayNames = new Set([fixture.awayTeam, fixture.awayTeamEn].map(normalizeNameToken).filter(Boolean));
    const homeCorners: number[] = [];
    const awayCorners: number[] = [];
    const homeFixtureIds = new Set<string>();
    const awayFixtureIds = new Set<string>();

    for (const record of records) {
      if (!record.finalCorners) continue;
      const recordHome = normalizeNameToken(record.homeTeamEn || record.homeTeam);
      const recordAway = normalizeNameToken(record.awayTeamEn || record.awayTeam);

      if (!homeFixtureIds.has(record.fixtureId) && (homeNames.has(recordHome) || homeNames.has(recordAway))) {
        homeCorners.push(homeNames.has(recordHome) ? record.finalCorners.home : record.finalCorners.away);
        homeFixtureIds.add(record.fixtureId);
      }
      if (!awayFixtureIds.has(record.fixtureId) && (awayNames.has(recordHome) || awayNames.has(recordAway))) {
        awayCorners.push(awayNames.has(recordHome) ? record.finalCorners.home : record.finalCorners.away);
        awayFixtureIds.add(record.fixtureId);
      }
    }

    const average = (values: number[]): number | undefined => values.length > 0
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : undefined;

    return {
      ...fixture,
      homeAverageCorners: average(homeCorners),
      awayAverageCorners: average(awayCorners),
      cornerHistorySampleSize: { home: homeCorners.length, away: awayCorners.length }
    };
  }

  async refreshFixturesForTraining(): Promise<void> {
    try {
      this.fixtures = await this.provider.fetchTodayFixtures();
      this.markRefreshSuccess(this.fixtures);
    } catch (error) {
      this.markRefreshFailure(error);
      throw error;
    }
  }

  async refreshLineupWindow(): Promise<void> {
    if (this.fixtures.length === 0) {
      await this.refreshDailyFixtures();
      return;
    }

    const now = Date.now();
    const beforeFixtureById = new Map(this.fixtures.map((fixture) => [fixture.id, fixture]));
    const beforeDashboardByFixture = this.dashboardRecommendationByFixture(this.currentDashboardRecommendations());
    const recheckFixtureIds = [...beforeDashboardByFixture.keys()].filter((fixtureId) => {
      const fixture = beforeFixtureById.get(fixtureId);
      if (!fixture || fixture.lineup.confirmed) {
        return false;
      }

      const diffMinutes = (new Date(fixture.kickoffAt).getTime() - now) / 60000;
      return diffMinutes >= 0 && diffMinutes <= 25;
    });

    try {
      this.fixtures = await this.provider.refreshLineups(this.fixtures);
      this.markRefreshSuccess(this.fixtures);
      await this.settleWithBackfill(this.fixtures);
      await this.recomputeRecommendations();

      if (recheckFixtureIds.length > 0) {
        const afterFixtureById = new Map(this.fixtures.map((fixture) => [fixture.id, fixture]));
        const afterDashboardByFixture = this.dashboardRecommendationByFixture(this.currentDashboardRecommendations());

        const insights: LineupRecheckInsight[] = recheckFixtureIds.map((fixtureId) => {
          const beforeFixture = beforeFixtureById.get(fixtureId);
          const afterFixture = afterFixtureById.get(fixtureId) ?? beforeFixture;
          const beforeRecommendation = beforeDashboardByFixture.get(fixtureId);
          const afterRecommendation = afterDashboardByFixture.get(fixtureId);
          const beforeConfidence = beforeRecommendation?.confidence;
          const afterConfidence = afterRecommendation?.confidence;
          const confidenceDelta =
            typeof beforeConfidence === "number" && typeof afterConfidence === "number"
              ? Number((afterConfidence - beforeConfidence).toFixed(1))
              : undefined;
          const droppedFromRecommendation = Boolean(beforeRecommendation && !afterRecommendation);
          const stillRecommended = Boolean(afterRecommendation);
          const becameHighConfidence = Boolean(
            afterRecommendation &&
              typeof confidenceDelta === "number" &&
              confidenceDelta > 0 &&
              afterRecommendation.confidence >= 80
          );

          let trend: LineupRecheckInsight["trend"] = "flat";
          if (droppedFromRecommendation) {
            trend = "dropped";
          } else if (typeof confidenceDelta === "number" && confidenceDelta > 0) {
            trend = "up";
          } else if (typeof confidenceDelta === "number" && confidenceDelta < 0) {
            trend = "down";
          }

          const baseMatch =
            afterRecommendation?.match ?? beforeRecommendation?.match ?? `${afterFixture?.homeTeam ?? ""} vs ${afterFixture?.awayTeam ?? ""}`.trim();
          const note = droppedFromRecommendation
            ? "陣容重評後，該推介已不再列入最終建議。"
            : trend === "up"
              ? `陣容重評後信心上升 ${Math.abs(confidenceDelta ?? 0).toFixed(1)}%。`
              : trend === "down"
                ? `陣容重評後信心下降 ${Math.abs(confidenceDelta ?? 0).toFixed(1)}%。`
                : "陣容重評後信心維持不變。";

          return {
            fixtureId,
            match: baseMatch,
            kickoffAt: afterFixture?.kickoffAt ?? beforeFixture?.kickoffAt ?? new Date().toISOString(),
            checkedAt: new Date().toISOString(),
            lineupConfirmedBefore: Boolean(beforeFixture?.lineup.confirmed),
            lineupConfirmedAfter: Boolean(afterFixture?.lineup.confirmed),
            beforeConfidence,
            afterConfidence,
            confidenceDelta,
            trend,
            stillRecommended,
            droppedFromRecommendation,
            becameHighConfidence,
            note
          };
        });

        this.appendLineupRecheckInsights(insights);
      }
    } catch (error) {
      this.markRefreshFailure(error);
      throw error;
    }
  }

  async settlePendingBackfill(options: SettlementBackfillOptions = {}): Promise<SettlementBackfillResult> {
    const result = await this.settleWithBackfill(this.fixtures, options);
    this.learningSnapshot = await this.learningStore.getSnapshot(this.weights, this.thresholds);
    return result;
  }

  async updateWeights(nextWeights: Partial<ScoringWeights>): Promise<ScoringWeights> {
    this.weights = normalizeWeights({ ...this.weights, ...nextWeights });
    await this.recomputeRecommendations();
    return this.weights;
  }

  getWeights(): ScoringWeights {
    return this.weights;
  }

  getThresholds(): RecommendationThresholds {
    return this.thresholds;
  }

  async updateThresholds(nextThresholds: Partial<RecommendationThresholds>): Promise<RecommendationThresholds> {
    this.thresholds = normalizeRecommendationThresholds({ ...this.thresholds, ...nextThresholds });
    await this.recomputeRecommendations();
    return this.thresholds;
  }

  async recordAssistantModelChange(input: {
    before: { weights: ScoringWeights; thresholds: RecommendationThresholds };
    reason: string;
    confidence: number;
  }): Promise<void> {
    await this.learningStore.recordAssistantChange({
      before: input.before,
      after: { weights: this.weights, thresholds: this.thresholds },
      reason: input.reason,
      confidence: input.confidence
    });
    this.learningSnapshot = await this.learningStore.getSnapshot(this.weights, this.thresholds);
  }

  async getLearningSnapshot(): Promise<LearningSnapshot> {
    this.learningSnapshot = await this.learningStore.getSnapshot(this.weights, this.thresholds);
    return this.learningSnapshot;
  }

  async removeMockLearningHistory(): Promise<number> {
    const removed = await this.learningStore.removeMockRecommendations();
    this.learningSnapshot = await this.learningStore.getSnapshot(this.weights, this.thresholds);
    return removed;
  }

  async getLearningHistory(options?: {
    market?: string;
    date?: string;
    status?: "all" | LearningHistoryStatus;
    limit?: number;
    page?: number;
  }): Promise<LearningHistoryRecord[]> {
    const records = await this.learningStore.getHistory(options);
    const [localFallbackByFixtureId, localSnapshotByFixtureId] = await Promise.all([
      loadLocalLearningFallbackByFixtureId(),
      loadLocalSnapshotFallbackByFixtureId()
    ]);
    const recordsWithLocalFallback = records.map((record) => {
      const fallback = localFallbackByFixtureId.get(record.fixtureId);
      const snapshotFallback = localSnapshotByFixtureId.get(record.fixtureId);
      if (!fallback) {
        if (!snapshotFallback) {
          return record;
        }

        return {
          ...record,
          match: record.match && record.match !== record.fixtureId
            ? record.match
            : (snapshotFallback.homeTeam && snapshotFallback.awayTeam
              ? `${snapshotFallback.homeTeam} vs ${snapshotFallback.awayTeam}`
              : record.match),
          kickoffAt: record.kickoffAt || snapshotFallback.kickoffAt,
          matchDateHk: record.matchDateHk || hongKongDateFromIso(record.kickoffAt || snapshotFallback.kickoffAt) || undefined,
          league: record.league || snapshotFallback.league,
          homeTeam: record.homeTeam || snapshotFallback.homeTeam,
          awayTeam: record.awayTeam || snapshotFallback.awayTeam,
          homeTeamEn: record.homeTeamEn || snapshotFallback.homeTeamEn,
          awayTeamEn: record.awayTeamEn || snapshotFallback.awayTeamEn
        };
      }

      return {
        ...record,
        match: record.match && record.match !== record.fixtureId ? record.match : fallback.match || record.match,
        kickoffAt: record.kickoffAt || fallback.kickoffAt,
        matchDateHk: record.matchDateHk || fallback.matchDateHk,
        league: record.league || fallback.league,
        homeTeam: record.homeTeam || fallback.homeTeam || snapshotFallback?.homeTeam,
        awayTeam: record.awayTeam || fallback.awayTeam || snapshotFallback?.awayTeam,
        homeTeamEn: record.homeTeamEn || fallback.homeTeamEn || snapshotFallback?.homeTeamEn,
        awayTeamEn: record.awayTeamEn || fallback.awayTeamEn || snapshotFallback?.awayTeamEn,
        halfTimeScore: record.halfTimeScore || fallback.halfTimeScore,
        finalScore: record.finalScore || fallback.finalScore,
        halfTimeCorners: record.halfTimeCorners,
        finalCorners: record.finalCorners || fallback.finalCorners
      };
    });

    const pendingReasonByKey = new Map<string, string>();
    const pendingRecords = recordsWithLocalFallback.filter((record) => record.status === "pending");
    if (pendingRecords.length > 0) {
      const diagnostics = await this.learningStore.diagnosePending(this.fixtures, Math.max(200, pendingRecords.length));
      for (const diagnostic of diagnostics) {
        pendingReasonByKey.set(diagnostic.key, diagnostic.reason);
      }
    }

    const settledWithoutResultData = recordsWithLocalFallback.filter(
      (record) =>
        record.status === "settled" &&
        (!record.finalScore
          || (record.market.includes("角球") && record.market.includes("半場") && !record.halfTimeCorners)
          || (record.market.includes("角球") && !record.market.includes("半場") && !record.finalCorners)
          || (record.market.includes("半場") && !record.market.includes("角球") && !record.halfTimeScore))
    );

    const fixturePoolById = new Map(this.fixtures.map((fixture) => [fixture.id, fixture]));
    if (settledWithoutResultData.length > 0) {
      try {
        const dateKeys = settledWithoutResultData
          .map((record) => hongKongDateFromIso(record.kickoffAt))
          .filter((date): date is string => !!date)
          .sort();

        const resultFixtures =
          dateKeys.length > 0
            ? await fetchHkjcResultFixturesWithOptions({
                startDate: dateKeys[0],
                endDate: dateKeys[dateKeys.length - 1]
              })
            : await fetchHkjcResultFixtures();

        for (const fixture of resultFixtures) {
          const existing = fixturePoolById.get(fixture.id);
          fixturePoolById.set(fixture.id, existing ? { ...existing, ...fixture } : fixture);
        }
      } catch (error) {
        console.warn("[history] HKJC results fallback enrichment failed.", error);
      }

      const detailByFixtureId = new Map<string, HkjcResultDetail>();
      const stillMissingFixtureIds = [...new Set(
        settledWithoutResultData
          .map((record) => {
            const fixture = fixturePoolById.get(record.fixtureId);
            const missingByMarket =
              !record.finalScore && !fixture?.finalScore
              || (record.market.includes("角球") && record.market.includes("半場") && !record.halfTimeCorners && !fixture?.halfTimeCorners)
              || (record.market.includes("角球") && !record.market.includes("半場") && !record.finalCorners && !fixture?.finalCorners)
              || (record.market.includes("半場") && !record.market.includes("角球") && !record.halfTimeScore && !fixture?.halfTimeScore);
            return missingByMarket ? record.fixtureId : undefined;
          })
          .filter((id): id is string => !!id)
      )];

      for (const fixtureId of stillMissingFixtureIds) {
        try {
          const detail = await fetchHkjcResultDetailByFixtureId(fixtureId);
          if (detail) {
            detailByFixtureId.set(fixtureId, detail);
          }
        } catch (error) {
          console.warn(`[history] HKJC matchResultDetails enrichment failed for fixture ${fixtureId}.`, error);
        }
      }

      for (const [fixtureId, detail] of detailByFixtureId.entries()) {
        const existing = fixturePoolById.get(fixtureId);
        if (!existing) {
          continue;
        }

        fixturePoolById.set(fixtureId, {
          ...existing,
          halfTimeScore: existing.halfTimeScore ?? detail.halfTimeScore,
          finalScore: existing.finalScore ?? detail.finalScore,
          halfTimeCorners: existing.halfTimeCorners ?? detail.halfTimeCorners,
          finalCorners: existing.finalCorners ?? detail.finalCorners
        });
      }

      const theSportsDbByFixtureId = new Map<string, TheSportsDbResultDetail>();
      const unresolvedByFixtureId = new Map<string, LearningHistoryRecord>();
      for (const record of settledWithoutResultData) {
        const fixture = fixturePoolById.get(record.fixtureId);
        const hasFinal = !!(record.finalScore || fixture?.finalScore);
        const hasHalfTime = !!(record.halfTimeScore || fixture?.halfTimeScore);
        const stillMissing = !hasFinal || (record.market.includes("半場") && !hasHalfTime);
        if (stillMissing && !unresolvedByFixtureId.has(record.fixtureId)) {
          unresolvedByFixtureId.set(record.fixtureId, record);
        }
      }

      // Old records may carry stale fixture IDs. Try same-day normalized name matching first.
      for (const [fixtureId, record] of unresolvedByFixtureId.entries()) {
        const sameDayCandidates = [...fixturePoolById.values()]
          .map((fixture) => ({ fixture, score: sameDayTeamSimilarity(record, fixture) }))
          .filter((entry) => entry.score >= 3)
          .sort((left, right) => right.score - left.score);

        const best = sameDayCandidates[0]?.fixture;
        if (!best) {
          continue;
        }

        const existing = fixturePoolById.get(fixtureId);
        fixturePoolById.set(fixtureId, {
          ...(existing ?? best),
          id: fixtureId,
          kickoffAt: existing?.kickoffAt || best.kickoffAt,
          league: existing?.league || best.league,
          homeTeam: existing?.homeTeam || best.homeTeam,
          awayTeam: existing?.awayTeam || best.awayTeam,
          homeTeamEn: existing?.homeTeamEn || best.homeTeamEn,
          awayTeamEn: existing?.awayTeamEn || best.awayTeamEn,
          halfTimeScore: existing?.halfTimeScore ?? best.halfTimeScore,
          finalScore: existing?.finalScore ?? best.finalScore,
          finalCorners: existing?.finalCorners ?? best.finalCorners,
          status: existing?.status || best.status,
          homeStrength: existing?.homeStrength ?? best.homeStrength,
          awayStrength: existing?.awayStrength ?? best.awayStrength,
          homeRecentPoints: existing?.homeRecentPoints ?? best.homeRecentPoints,
          awayRecentPoints: existing?.awayRecentPoints ?? best.awayRecentPoints,
          expertSentiment: existing?.expertSentiment ?? best.expertSentiment,
          lineup: existing?.lineup ?? best.lineup,
          oddsHistory: existing?.oddsHistory ?? best.oddsHistory,
          marketOptions: existing?.marketOptions ?? best.marketOptions
        });
      }

      for (const [fixtureId, record] of unresolvedByFixtureId.entries()) {
        const fixture = fixturePoolById.get(fixtureId);
        try {
          const detail = await fetchTheSportsDbResultByMatchInfo({
            fixtureId,
            kickoffAt: record.kickoffAt ?? fixture?.kickoffAt,
            homeTeamEn: record.homeTeamEn ?? fixture?.homeTeamEn,
            awayTeamEn: record.awayTeamEn ?? fixture?.awayTeamEn,
            match: record.match
          });
          if (detail) {
            theSportsDbByFixtureId.set(fixtureId, detail);
          }
        } catch (error) {
          console.warn(`[history] TheSportsDB enrichment failed for fixture ${fixtureId}.`, error);
        }
      }

      for (const [fixtureId, detail] of theSportsDbByFixtureId.entries()) {
        const existing = fixturePoolById.get(fixtureId);
        if (!existing) {
          continue;
        }

        fixturePoolById.set(fixtureId, {
          ...existing,
          kickoffAt: existing.kickoffAt || detail.kickoffAt || existing.kickoffAt,
          league: existing.league || detail.league || existing.league,
          homeTeam: existing.homeTeam || detail.homeTeam || existing.homeTeam,
          awayTeam: existing.awayTeam || detail.awayTeam || existing.awayTeam,
          halfTimeScore: existing.halfTimeScore ?? detail.halfTimeScore,
          finalScore: existing.finalScore ?? detail.finalScore
        });
      }
    }

    const fixturePool = [...fixturePoolById.values()];

    if (fixturePool.length === 0) {
      return recordsWithLocalFallback.map((record) => ({
        ...record,
        pendingReason: record.status === "pending" ? pendingReasonByKey.get(record.key) : record.pendingReason
      }));
    }

    const fixtureById = new Map(fixturePool.map((fixture) => [fixture.id, fixture]));
    const fixtureByTeamsKey = new Map(
      fixturePool.map((fixture) => [
        `${fixture.homeTeam.replace(/\s+/g, "").toLowerCase()}|${fixture.awayTeam.replace(/\s+/g, "").toLowerCase()}`,
        fixture
      ])
    );

    const bestSameDayFuzzyFixture = (record: LearningHistoryRecord): Fixture | undefined => {
      const candidates = fixturePool
        .map((fixture) => ({ fixture, score: sameDayTeamSimilarity(record, fixture) }))
        .filter((entry) => entry.score >= 0)
        .sort((left, right) => right.score - left.score);
      return candidates[0]?.fixture;
    };

    const mappedRecords = recordsWithLocalFallback.map((record) => {
      const teamsKey =
        record.matchKey?.trim().toLowerCase() ||
        (record.homeTeam?.trim() && record.awayTeam?.trim()
          ? `${record.homeTeam.replace(/\s+/g, "").toLowerCase()}|${record.awayTeam.replace(/\s+/g, "").toLowerCase()}`
          : undefined);
      const matchedFixture =
        fixtureById.get(record.fixtureId) ??
        (teamsKey ? fixtureByTeamsKey.get(teamsKey) : undefined) ??
        bestSameDayFuzzyFixture(record);

      return {
        ...record,
        pendingReason: record.status === "pending" ? pendingReasonByKey.get(record.key) : record.pendingReason,
        kickoffAt: record.kickoffAt || matchedFixture?.kickoffAt,
        matchDateHk: record.matchDateHk || hongKongDateFromIso(record.kickoffAt || matchedFixture?.kickoffAt) || undefined,
        league:
          matchedFixture?.league ||
          (record.league && record.league !== "HKJC Results" ? record.league : undefined),
        halfTimeScore: record.halfTimeScore || matchedFixture?.halfTimeScore,
        finalScore: record.finalScore || matchedFixture?.finalScore,
        halfTimeCorners: record.halfTimeCorners || matchedFixture?.halfTimeCorners,
        finalCorners: record.finalCorners || matchedFixture?.finalCorners,
        homeTeam: record.homeTeam || matchedFixture?.homeTeam,
        awayTeam: record.awayTeam || matchedFixture?.awayTeam,
        homeTeamEn: record.homeTeamEn || matchedFixture?.homeTeamEn,
        awayTeamEn: record.awayTeamEn || matchedFixture?.awayTeamEn,
        matchKey:
          record.matchKey ||
          (() => {
            const fixture = matchedFixture;
            if (!fixture) {
              return undefined;
            }

            return `${fixture.homeTeam.replace(/\s+/g, "").toLowerCase()}|${fixture.awayTeam
              .replace(/\s+/g, "")
              .toLowerCase()}`;
          })(),
        sourceProvider: record.sourceProvider || this.dataSourceHealth.provider,
        match:
          record.match && record.match !== record.fixtureId
            ? record.match
            : (() => {
                const fixture = matchedFixture;
                return fixture ? `${fixture.homeTeam} vs ${fixture.awayTeam}` : record.match;
              })()
      };
    });

    await this.learningStore.applyHistoryEnrichment(mappedRecords);
    return mappedRecords;
  }

  async getLearningMarkets(): Promise<string[]> {
    return this.learningStore.listMarkets();
  }

  async getLearningHistoryCount(options?: {
    market?: string;
    date?: string;
    status?: "all" | LearningHistoryStatus;
  }): Promise<number> {
    return this.learningStore.countHistory(options);
  }

  getDataSourceHealth(): DataSourceHealth {
    return this.dataSourceHealth;
  }

  getSnapshot(focusFixtureId?: string): {
    fixtures: Fixture[];
    fixtureFocusRecommendations: Recommendation[];
    recommendations: Recommendation[];
    recommendationShortlist: Recommendation[];
    consensusApprovedRecommendations: Recommendation[];
    consensusRejectedRecommendations: Recommendation[];
    consensusReport: RecommendationConsensusReport | null;
    lineupRecheckInsights: LineupRecheckInsight[];
    topFiveRecommendations: Recommendation[];
    highOddsValueRecommendations: Recommendation[];
    focusRecommendations: Recommendation[];
    highOddsRecommendations: Recommendation[];
    generatedAt: string;
    weights: ScoringWeights;
    thresholds: RecommendationThresholds;
    learning: LearningSnapshot | null;
  } {
    const fixtureById = new Map(this.fixtures.map((fixture) => [fixture.id, fixture]));
    const nowMs = Date.now();
    const topFiveRecommendations = this.recommendations
      .filter((recommendation) => {
        const fixture = fixtureById.get(recommendation.fixtureId);
        return fixture ? isFixturePreMatchForTopFive(fixture, nowMs) : false;
      })
      .slice(0, 5);
    const focusRecommendations = this.recommendations.filter((r) => r.recommendationGroup === "focus");
    const highOddsRecommendations = this.highOddsValueRecommendations;
    const fixtureFocusRecommendationById = new Map(this.fixtureFocusRecommendationById);
    if (focusFixtureId) {
      const focusFixture = this.fixtures.find((fixture) => fixture.id === focusFixtureId);
      if (focusFixture) {
        const focusRecommendation = this.buildFixtureFocusRecommendation(focusFixture);
        if (focusRecommendation) {
          fixtureFocusRecommendationById.set(focusFixtureId, focusRecommendation);
        }
      }
    }

    return {
      fixtures: this.fixtures,
      fixtureFocusRecommendations: [...fixtureFocusRecommendationById.values()],
      recommendations: this.recommendations,
      recommendationShortlist: this.recommendationShortlist,
      consensusApprovedRecommendations: this.consensusApprovedRecommendations,
      consensusRejectedRecommendations: this.consensusRejectedRecommendations,
      consensusReport: this.consensusReport,
      lineupRecheckInsights: this.lineupRecheckInsights,
      topFiveRecommendations,
      highOddsValueRecommendations: this.highOddsValueRecommendations,
      focusRecommendations,
      highOddsRecommendations,
      generatedAt: new Date().toISOString(),
      weights: this.weights,
      thresholds: this.thresholds,
      learning: this.learningSnapshot
    };
  }
}
