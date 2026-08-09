import { existsSync, readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { JSONFilePreset } from "lowdb/node";
import { summarizeBacktest } from "../engine/backtest.js";
import type { BacktestRecord, BacktestSummary } from "../types.js";

type BacktestDb = {
  records: BacktestRecord[];
};

type FocusedTrainingMarketKey = "asian_handicap" | "match_result" | "goals_over_under";

type FocusedMarketHitRatePoint = {
  date: string;
  sample: number;
  wins: number;
  hitRate: number;
};

type FocusedMarketHitRateStats = {
  key: FocusedTrainingMarketKey;
  label: string;
  totalSample: number;
  recentSample: number;
  recentHitRate: number;
  trend: FocusedMarketHitRatePoint[];
};

const FOCUSED_MARKET_LABELS: Record<FocusedTrainingMarketKey, string> = {
  asian_handicap: "亞洲盤讓球盤",
  match_result: "主客和",
  goals_over_under: "入球大小"
};

function hkDateKey(iso: string): string | null {
  const ms = Date.parse(iso);
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

function recentHongKongDates(days: number): string[] {
  const count = Math.max(1, days);
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const parts = formatter.formatToParts(date);
    const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? "00";
    keys.push(`${pick("year")}-${pick("month")}-${pick("day")}`);
  }

  return keys;
}

function normalizeResult(value: string): "win" | "loss" {
  return value.toLowerCase() === "win" ? "win" : "loss";
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export class BacktestStore {
  private readonly dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? path.resolve(process.cwd(), "apps/api/data/backtest-db.json");
  }

  private async getDb() {
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
    return JSONFilePreset<BacktestDb>(this.dbPath, { records: [] });
  }

  async listRecords(): Promise<BacktestRecord[]> {
    const db = await this.getDb();
    return db.data.records;
  }

  async addRecords(records: BacktestRecord[]): Promise<BacktestSummary> {
    const db = await this.getDb();
    db.data.records.push(...records);
    await db.write();
    return summarizeBacktest(db.data.records);
  }

  async addSourceRecords(records: BacktestRecord[]): Promise<number> {
    const db = await this.getDb();
    const existing = new Set(db.data.records.map((record) => `${record.fixtureId}|${record.market}|${record.source}`));

    let added = 0;
    for (const record of records) {
      const key = `${record.fixtureId}|${record.market}|${record.source}`;
      if (existing.has(key)) {
        continue;
      }
      db.data.records.push(record);
      existing.add(key);
      added += 1;
    }

    if (added > 0) {
      await db.write();
    }

    return added;
  }

  async addAutoRecords(records: BacktestRecord[]): Promise<number> {
    const autoRecords = records.map((record) => ({ ...record, source: "auto" as const }));
    return this.addSourceRecords(autoRecords);
  }

  async addPracticeRecords(records: BacktestRecord[]): Promise<number> {
    const practiceRecords = records.map((record) => ({ ...record, source: "practice" as const }));
    return this.addSourceRecords(practiceRecords);
  }

  async replaceFromCsv(filePath: string): Promise<BacktestSummary> {
    if (!existsSync(filePath)) {
      throw new Error(`CSV file not found: ${filePath}`);
    }

    const rawCsv = readFileSync(filePath, "utf-8");
    const parsed = parse(rawCsv, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    }) as Record<string, string>[];

    const records: BacktestRecord[] = parsed.map((row, index) => {
      const fixtureId = row.fixtureId ?? `row-${index + 1}`;
      const market = (row.market as "homeWin" | "draw" | "awayWin") ?? "homeWin";
      const odds = toNumber(row.odds, 1.8);
      const modelProbability = toNumber(row.modelProbability, 0.5);
      const stake = toNumber(row.stake, 1);
      const result = normalizeResult(row.result ?? "loss");
      const placedAt = row.placedAt ?? new Date().toISOString();

      return {
        fixtureId,
        market,
        odds,
        modelProbability,
        stake,
        result,
        placedAt,
        source: "csv"
      };
    });

    const db = await this.getDb();
    db.data.records = records;
    await db.write();
    return summarizeBacktest(records);
  }

  async summary(): Promise<BacktestSummary> {
    const records = await this.listRecords();
    return summarizeBacktest(records);
  }

  async autoTrainingStats(recentLimit = 20): Promise<{ totalAutoRecords: number; recentHitRate: number; recentSample: number }> {
    const records = await this.listRecords();
    const backgroundRecords = records.filter((record) => record.source === "auto" || record.source === "practice");
    const recent = backgroundRecords.slice(-Math.max(1, recentLimit));
    const wins = recent.filter((record) => record.result === "win").length;

    return {
      totalAutoRecords: backgroundRecords.length,
      recentSample: recent.length,
      recentHitRate: recent.length === 0 ? 0 : Number((wins / recent.length).toFixed(4))
    };
  }

  async sourceStats(
    source: BacktestRecord["source"],
    recentLimit = 20
  ): Promise<{ totalRecords: number; recentHitRate: number; recentSample: number }> {
    const records = await this.listRecords();
    const filteredRecords = records.filter((record) => record.source === source);
    const recent = filteredRecords.slice(-Math.max(1, recentLimit));
    const wins = recent.filter((record) => record.result === "win").length;

    return {
      totalRecords: filteredRecords.length,
      recentSample: recent.length,
      recentHitRate: recent.length === 0 ? 0 : Number((wins / recent.length).toFixed(4))
    };
  }

  async listBackgroundTrainingRecords(options?: {
    source?: "all" | "auto" | "practice";
    limit?: number;
  }): Promise<BacktestRecord[]> {
    const source = options?.source ?? "all";
    const limit = Math.max(1, options?.limit ?? 200);
    const records = await this.listRecords();

    const filtered = records.filter((record) => {
      if (source === "all") {
        return record.source === "auto" || record.source === "practice";
      }

      return record.source === source;
    });

    return [...filtered]
      .sort((left, right) => Date.parse(right.placedAt) - Date.parse(left.placedAt))
      .slice(0, limit);
  }

  async focusedMarketHitRateTrend(options?: {
    source?: "all" | "auto" | "practice";
    recentLimit?: number;
    trendDays?: number;
  }): Promise<{
    generatedAt: string;
    source: "all" | "auto" | "practice";
    recentLimit: number;
    trendDays: number;
    markets: FocusedMarketHitRateStats[];
  }> {
    const source = options?.source ?? "all";
    const recentLimit = Math.max(1, options?.recentLimit ?? 20);
    const trendDays = Math.max(1, options?.trendDays ?? 14);
    const allRecords = await this.listRecords();

    const backgroundRecords = allRecords.filter((record) => {
      const isBackground = record.source === "auto" || record.source === "practice";
      if (!isBackground) {
        return false;
      }

      if (source === "all") {
        return true;
      }

      return record.source === source;
    });

    const marketKeys = Object.keys(FOCUSED_MARKET_LABELS) as FocusedTrainingMarketKey[];
    const trendDateKeys = recentHongKongDates(trendDays);

    const markets = marketKeys.map((marketKey): FocusedMarketHitRateStats => {
      const marketRecords = backgroundRecords
        .filter((record) => record.trainingMarket === marketKey)
        .sort((left, right) => Date.parse(left.placedAt) - Date.parse(right.placedAt));

      const recent = marketRecords.slice(-recentLimit);
      const recentWins = recent.filter((record) => record.result === "win").length;

      const trend = trendDateKeys.map((dateKey): FocusedMarketHitRatePoint => {
        const dayRecords = marketRecords.filter((record) => hkDateKey(record.placedAt) === dateKey);
        const wins = dayRecords.filter((record) => record.result === "win").length;
        const sample = dayRecords.length;

        return {
          date: dateKey,
          sample,
          wins,
          hitRate: sample === 0 ? 0 : Number((wins / sample).toFixed(4))
        };
      });

      return {
        key: marketKey,
        label: FOCUSED_MARKET_LABELS[marketKey],
        totalSample: marketRecords.length,
        recentSample: recent.length,
        recentHitRate: recent.length === 0 ? 0 : Number((recentWins / recent.length).toFixed(4)),
        trend
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      source,
      recentLimit,
      trendDays,
      markets
    };
  }
}
