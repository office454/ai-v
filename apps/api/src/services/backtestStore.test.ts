import { describe, expect, it } from "vitest";
import type { BacktestRecord } from "../types.js";
import { BacktestStore } from "./backtestStore.js";

function sampleRecord(
  fixtureId: string,
  overrides: Partial<BacktestRecord> = {}
): BacktestRecord {
  return {
    fixtureId,
    market: "homeWin",
    trainingMarket: "asian_handicap",
    odds: 1.9,
    modelProbability: 0.58,
    stake: 1,
    result: "win",
    placedAt: new Date().toISOString(),
    source: "auto",
    ...overrides
  };
}

describe("BacktestStore focusedMarketHitRateTrend", () => {
  it("returns separate recent hit-rate and trend for three focused markets", async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const records: BacktestRecord[] = [
      sampleRecord("f1", {
        trainingMarket: "asian_handicap",
        result: "win",
        placedAt: new Date(now - day).toISOString(),
        source: "auto"
      }),
      sampleRecord("f2", {
        trainingMarket: "asian_handicap",
        result: "loss",
        placedAt: new Date(now).toISOString(),
        source: "auto"
      }),
      sampleRecord("f3", {
        market: "draw",
        trainingMarket: "match_result",
        result: "win",
        placedAt: new Date(now).toISOString(),
        source: "practice"
      }),
      sampleRecord("f4", {
        market: "awayWin",
        trainingMarket: "goals_over_under",
        result: "loss",
        placedAt: new Date(now).toISOString(),
        source: "practice"
      })
    ];

    const store = new BacktestStore("/tmp/ignored.json");
    store.listRecords = async () => records;

    const metrics = await store.focusedMarketHitRateTrend({
      source: "all",
      recentLimit: 2,
      trendDays: 2
    });

    expect(metrics.markets).toHaveLength(3);

    const asian = metrics.markets.find((item) => item.key === "asian_handicap");
    const match = metrics.markets.find((item) => item.key === "match_result");
    const goals = metrics.markets.find((item) => item.key === "goals_over_under");

    expect(asian?.totalSample).toBe(2);
    expect(asian?.recentSample).toBe(2);
    expect(asian?.recentHitRate).toBe(0.5);
    expect(asian?.trend).toHaveLength(2);

    expect(match?.totalSample).toBe(1);
    expect(match?.recentHitRate).toBe(1);

    expect(goals?.totalSample).toBe(1);
    expect(goals?.recentHitRate).toBe(0);
  });

  it("applies source filter", async () => {
    const records: BacktestRecord[] = [
      sampleRecord("a1", { trainingMarket: "asian_handicap", source: "auto", result: "win" }),
      sampleRecord("p1", { trainingMarket: "asian_handicap", source: "practice", result: "loss" })
    ];

    const store = new BacktestStore("/tmp/ignored.json");
    store.listRecords = async () => records;

    const autoOnly = await store.focusedMarketHitRateTrend({ source: "auto", recentLimit: 10, trendDays: 1 });
    const asian = autoOnly.markets.find((item) => item.key === "asian_handicap");

    expect(asian?.totalSample).toBe(1);
    expect(asian?.recentHitRate).toBe(1);
  });
});
