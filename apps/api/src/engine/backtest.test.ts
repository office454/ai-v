import { describe, expect, it } from "vitest";
import { summarizeBacktest } from "./backtest.js";

describe("summarizeBacktest", () => {
  it("calculates ROI and hit rate", () => {
    const summary = summarizeBacktest([
      {
        fixtureId: "FB1001",
        market: "homeWin",
        odds: 2,
        modelProbability: 0.58,
        stake: 100,
        result: "win",
        placedAt: "2026-07-13T10:00:00.000Z",
        source: "api"
      },
      {
        fixtureId: "FB1002",
        market: "homeWin",
        odds: 1.8,
        modelProbability: 0.56,
        stake: 100,
        result: "loss",
        placedAt: "2026-07-13T10:05:00.000Z",
        source: "api"
      }
    ]);

    expect(summary.totalBets).toBe(2);
    expect(summary.wins).toBe(1);
    expect(summary.hitRate).toBe(0.5);
    expect(summary.totalReturn).toBe(200);
    expect(summary.profit).toBe(0);
    expect(summary.roi).toBe(0);
  });
});
