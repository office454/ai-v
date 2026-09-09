import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Fixture, Recommendation, ScoringWeights } from "../types.js";
import { LearningStore } from "./learningStore.js";

function sampleRecommendation(fixtureId: string, market = "主客和", selectionName = "主勝"): Recommendation {
  return {
    fixtureId,
    match: "主隊 vs 客隊",
    kickoffAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    league: "test",
    homeTeam: "主隊",
    awayTeam: "客隊",
    matchKey: "主隊|客隊",
    sourceProvider: "hkjc_graphql",
    market,
    selectionName,
    currentOdds: 2.2,
    confidence: 68,
    edgeScore: 6.5,
    valueScore: 0.23,
    recommendationGroup: "focus",
    halfTimeScorePrediction: "0-0",
    fullTimeScorePrediction: "2-1",
    reason: "test",
    lastUpdatedAt: new Date().toISOString()
  };
}

function sampleFixture(fixtureId: string, homeScore: number, awayScore: number): Fixture {
  return {
    id: fixtureId,
    league: "test",
    kickoffAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    status: "FT",
    finalScore: {
      home: homeScore,
      away: awayScore
    },
    finalCorners: {
      home: 6,
      away: 4,
      total: 10
    },
    homeTeam: "主隊",
    awayTeam: "客隊",
    homeStrength: "strong",
    awayStrength: "average",
    homeRecentPoints: 10,
    awayRecentPoints: 8,
    expertSentiment: 0.6,
    lineup: {
      confirmed: true,
      updatedAt: new Date().toISOString(),
      home: [],
      away: []
    },
    oddsHistory: [
      {
        at: new Date().toISOString(),
        homeWin: 1.9,
        draw: 3.4,
        awayWin: 4.1
      }
    ],
    marketOptions: [
      {
        oddsType: "HAD",
        oddsTypeName: "主客和",
        selectionCode: "HADH",
        selectionName: "主勝",
        lineCondition: "N/A",
        currentOdds: 1.9,
        inplay: false,
        poolStatus: "Closed",
        combinationStatus: "Closed",
        updatedAt: new Date().toISOString()
      }
    ]
  };
}

function sampleCornerFixture(
  fixtureId: string,
  homeScore: number,
  awayScore: number,
  homeCorners: number,
  awayCorners: number
): Fixture {
  return {
    ...sampleFixture(fixtureId, homeScore, awayScore),
    finalCorners: {
      home: homeCorners,
      away: awayCorners,
      total: homeCorners + awayCorners
    }
  };
}

describe("LearningStore", () => {
  it("rejects mock recommendations and removes existing mock fixtures", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");

    try {
      const mockRecommendation = {
        ...sampleRecommendation("m1"),
        match: "Harbor United vs Kowloon City",
        sourceProvider: "mock"
      };
      const store = new LearningStore(dbPath);
      await store.registerRecommendations([mockRecommendation]);
      expect((await store.getHistory({ limit: 10 })).some((record) => record.fixtureId === "m1")).toBe(false);

      await store.registerRecommendations([{ ...mockRecommendation, sourceProvider: "hkjc_graphql" }]);
      expect((await store.getHistory({ limit: 10 })).some((record) => record.fixtureId === "m1")).toBe(true);
      expect(await store.removeMockRecommendations()).toBe(1);
      expect((await store.getHistory({ limit: 10 })).some((record) => record.fixtureId === "m1")).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("stores recommendations and settles finished fixtures", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");

    try {
      const store = new LearningStore(dbPath);
      await store.registerRecommendations([sampleRecommendation("fx-1")]);
      const afterRegister = await store.getSnapshot();
      expect(afterRegister.pendingCount).toBe(1);
      const settled = await store.settleFromFixtures([sampleFixture("fx-1", 2, 1)]);

      expect(settled).toBe(1);

      const snapshot = await store.getSnapshot();
      expect(snapshot.pendingCount).toBe(0);
      expect(snapshot.settledCount).toBe(1);
      expect(snapshot.blindspots.byMarket["主客和"].wins).toBe(1);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("settles HKJC ended statuses but keeps voided matches pending", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");

    try {
      const store = new LearningStore(dbPath);
      await store.registerRecommendations([
        sampleRecommendation("fx-ended"),
        sampleRecommendation("fx-voided")
      ]);

      const settled = await store.settleFromFixtures([
        { ...sampleFixture("fx-ended", 2, 1), status: "INPLAYMATCHENDED" },
        { ...sampleFixture("fx-voided", 1, 0), status: "RESULTVOIDED" }
      ]);

      expect(settled).toBe(1);
      expect((await store.getSnapshot()).pendingCount).toBe(1);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("builds blindspot penalty and adjusts recommendations", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");

    try {
      const store = new LearningStore(dbPath);

      const recs = Array.from({ length: 8 }, (_, i) => sampleRecommendation(`fx-loss-${i + 1}`));
      await store.registerRecommendations(recs);
      const afterRegister = await store.getSnapshot();
      expect(afterRegister.pendingCount).toBe(8);

      const fixtures = recs.map((rec) => sampleFixture(rec.fixtureId, 0, 1));
      const settled = await store.settleFromFixtures(fixtures);
      expect(settled).toBe(8);

      const snapshot = await store.getSnapshot();
      expect(snapshot.correction.marketPenalty["主客和"]).toBeGreaterThan(0);

      const [adjusted] = store.adjustRecommendations([sampleRecommendation("fx-next")]);
      expect(adjusted.confidence).toBeLessThan(68);
      expect(adjusted.valueScore).toBeLessThan(0.23);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("builds a self-learning diagnostic summary for weak markets", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");

    try {
      const store = new LearningStore(dbPath);
      const recs = Array.from({ length: 8 }, (_, i) => sampleRecommendation(`fx-diagnostic-${i + 1}`));

      await store.registerRecommendations(recs);
      await store.settleFromFixtures(recs.map((rec) => sampleFixture(rec.fixtureId, 0, 1)));

      const snapshot = await store.getSnapshot();
      expect(snapshot.diagnostics).toBeDefined();
      expect(snapshot.diagnostics.summary).toContain("盲點");
      expect(snapshot.diagnostics.weakestMarket).not.toBeNull();
      expect(snapshot.diagnostics.actionItems.length).toBeGreaterThan(0);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("tracks weekly, rolling, overall, and assistant model changes", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");
    const weights: ScoringWeights = {
      strengthGap: 0.3,
      recentForm: 0.18,
      lineupFitness: 0.18,
      expertSentiment: 0.12,
      oddsMomentum: 0.1
    };
    const thresholds = {
      minRecommendedOdds: 2,
      highOddsThreshold: 3.4,
      highOddsMinEdgeScore: 6,
      highOddsMinValueScore: 0.25
    };

    try {
      const store = new LearningStore(dbPath);
      await store.registerRecommendations([
        sampleRecommendation("fx-trend-win"),
        sampleRecommendation("fx-trend-loss")
      ]);
      await store.settleFromFixtures([
        sampleFixture("fx-trend-win", 2, 1),
        sampleFixture("fx-trend-loss", 0, 1)
      ]);

      const event = await store.recordAssistantChange({
        before: { weights, thresholds },
        after: {
          weights: { ...weights, recentForm: 0.2 },
          thresholds: { ...thresholds, highOddsMinEdgeScore: 6.2 }
        },
        reason: "改善近期弱勢市場",
        confidence: 0.82
      });
      const duplicate = await store.recordAssistantChange({
        before: { weights, thresholds },
        after: { weights, thresholds },
        reason: "沒有變更",
        confidence: 0.9
      });
      const snapshot = await store.getSnapshot(
        { ...weights, recentForm: 0.2 },
        { ...thresholds, highOddsMinEdgeScore: 6.2 }
      );

      expect(snapshot.overallMetrics).toMatchObject({ sample: 2, wins: 1, losses: 1, hitRate: 0.5 });
      expect(snapshot.rolling4WeekMetrics.sample).toBe(2);
      expect(snapshot.weeklySnapshots[0]?.metrics.sample).toBe(2);
      expect(snapshot.weeklySnapshots[0]?.version).toBe("v2");
      expect(event?.before.version).toBe("v1");
      expect(event?.after.version).toBe("v2");
      expect(snapshot.changeEvents).toHaveLength(1);
      expect(duplicate).toBeNull();
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("settles non-1X2 corner and size markets", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");

    try {
      const store = new LearningStore(dbPath);

      await store.registerRecommendations([
        sampleRecommendation("fx-corner", "主隊全場角球大細", "主隊 全場大（7.5角球）"),
        sampleRecommendation("fx-goal", "入球大細", "大（2.5球）")
      ]);

      const settled = await store.settleFromFixtures([
        sampleCornerFixture("fx-corner", 1, 0, 8, 3),
        sampleFixture("fx-goal", 3, 1)
      ]);

      expect(settled).toBe(2);

      const snapshot = await store.getSnapshot();
      expect(snapshot.settledCount).toBe(2);

      const history = await store.getHistory({ limit: 10 });
      const goalRecord = history.find((item) => item.fixtureId === "fx-goal");
      expect(goalRecord?.result).toBe("win");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("settles half-time markets when half-time score is available", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");

    try {
      const store = new LearningStore(dbPath);

      await store.registerRecommendations([sampleRecommendation("fx-ht", "半場主客和", "主隊勝")]);

      const settled = await store.settleFromFixtures([
        {
          ...sampleFixture("fx-ht", 2, 2),
          halfTimeScore: {
            home: 1,
            away: 0
          }
        }
      ]);

      expect(settled).toBe(1);

      const snapshot = await store.getSnapshot();
      expect(snapshot.pendingCount).toBe(0);
      expect(snapshot.settledCount).toBe(1);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("applies a half-time handicap only to the selected team", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");

    try {
      const store = new LearningStore(dbPath);
      await store.registerRecommendations([
        sampleRecommendation("fx-home-handicap", "半場讓球", "主隊勝（盤口 -1.0球）"),
        sampleRecommendation("fx-away-handicap", "半場讓球", "客隊勝（盤口 +1.0球）")
      ]);

      const fixture = {
        ...sampleFixture("fx-home-handicap", 2, 0),
        halfTimeScore: { home: 2, away: 0 }
      };
      const awayFixture = {
        ...sampleFixture("fx-away-handicap", 2, 0),
        halfTimeScore: { home: 2, away: 0 }
      };

      expect(await store.settleFromFixtures([fixture, awayFixture])).toBe(2);
      const history = await store.getHistory({ status: "settled", limit: 10 });
      expect(history.find((item) => item.fixtureId === "fx-home-handicap")?.result).toBe("win");
      expect(history.find((item) => item.fixtureId === "fx-away-handicap")?.result).toBe("loss");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not settle a closed market from an in-progress score after 130 minutes", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");

    try {
      const store = new LearningStore(dbPath);
      await store.registerRecommendations([
        sampleRecommendation("fx-still-live", "讓球", "主隊勝（盤口 -0.5/-1.0）")
      ]);

      const fixture = sampleFixture("fx-still-live", 2, 0);
      fixture.status = "SECONDHALF";
      fixture.kickoffAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

      expect(await store.settleFromFixtures([fixture])).toBe(0);
      const snapshot = await store.getSnapshot();
      expect(snapshot.pendingCount).toBe(1);
      expect(snapshot.settledCount).toBe(0);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("settles half-time corner handicaps from half-time corners", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");

    try {
      const store = new LearningStore(dbPath);
      await store.registerRecommendations([
        sampleRecommendation("fx-ht-corners", "球隊半場開出角球讓球", "主隊勝（盤口 -0.5）")
      ]);

      const settled = await store.settleFromFixtures([{
        ...sampleCornerFixture("fx-ht-corners", 2, 0, 2, 10),
        halfTimeScore: { home: 2, away: 0 },
        halfTimeCorners: { home: 1, away: 4, total: 5 }
      }]);

      expect(settled).toBe(1);
      const [record] = await store.getHistory({ status: "settled", limit: 10 });
      expect(record?.result).toBe("loss");
      expect(record?.halfTimeCorners).toEqual({ home: 1, away: 4, total: 5 });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("repairs and settles a legacy away-team half-time corner under", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");

    try {
      const store = new LearningStore(dbPath);
      await store.registerRecommendations([
        sampleRecommendation("fx-away-corner-under", "球隊半場開出角球大細", "客隊勝（盤口 -1.5）")
      ]);

      expect(await store.settleFromFixtures([{
        ...sampleCornerFixture("fx-away-corner-under", 1, 1, 9, 2),
        halfTimeCorners: { home: 5, away: 0, total: 5 }
      }])).toBe(1);

      const [record] = await store.getHistory({ status: "settled", limit: 10 });
      expect(record).toMatchObject({
        market: "客隊半場角球大細",
        selectionName: "客隊 半場細（1.5角球）",
        predictedSide: "away",
        actualSide: "away",
        result: "win"
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("settles over-under and team totals against the scoped goal count", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");

    try {
      const store = new LearningStore(dbPath);
      await store.registerRecommendations([
        sampleRecommendation("fx-total-under", "入球大細", "細（1.5/2.0球）"),
        sampleRecommendation("fx-away-ht-over", "客隊半場入球大細", "客隊 半場大（0.5球）"),
        sampleRecommendation("fx-home-under", "主隊全場入球大細", "主隊 全場細（0.5球）"),
        sampleRecommendation("fx-legacy-home-ht-under", "球隊入球大細", "細（0.5球）")
      ]);

      const settled = await store.settleFromFixtures([
        sampleFixture("fx-total-under", 0, 1),
        {
          ...sampleFixture("fx-away-ht-over", 2, 0),
          halfTimeScore: { home: 2, away: 0 }
        },
        sampleFixture("fx-home-under", 2, 2),
        {
          ...sampleFixture("fx-legacy-home-ht-under", 2, 2),
          halfTimeScore: { home: 0, away: 0 }
        }
      ]);

      expect(settled).toBe(4);
      const history = await store.getHistory({ limit: 10 });
      expect(history.find((item) => item.fixtureId === "fx-total-under")?.result).toBe("win");
      expect(history.find((item) => item.fixtureId === "fx-away-ht-over")?.result).toBe("loss");
      expect(history.find((item) => item.fixtureId === "fx-home-under")?.result).toBe("loss");
      expect(history.find((item) => item.fixtureId === "fx-legacy-home-ht-under")?.result).toBe("win");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("repairs persisted totals and three-way handicap labels", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");

    try {
      const data = {
          pending: [],
          settled: [
            {
              key: "fx-repair|球隊入球大細|細（0.5球）",
              fixtureId: "fx-repair",
              match: "主隊 vs 客隊",
              market: "球隊入球大細",
              selectionName: "細（0.5球）",
              currentOdds: 2.3,
              confidence: 68,
              edgeScore: 6.5,
              predictedSide: "away",
              actualSide: "home",
              result: "loss",
              createdAt: new Date().toISOString(),
              settledAt: new Date().toISOString(),
              halfTimeScore: { home: 0, away: 0 },
              finalScore: { home: 2, away: 2 }
            },
            {
              key: "fx-three-way|讓球主客和|客隊勝（盤口 +2.0）",
              fixtureId: "fx-three-way",
              match: "主隊 vs 客隊",
              market: "讓球主客和",
              selectionName: "客隊勝（盤口 +2.0）",
              currentOdds: 40,
              confidence: 83.3,
              edgeScore: 80.82,
              predictedSide: "away",
              actualSide: "draw",
              result: "loss",
              createdAt: new Date().toISOString(),
              settledAt: new Date().toISOString(),
              finalScore: { home: 2, away: 2 }
            }
          ]
        };

      const store = new LearningStore(dbPath);
      (store as unknown as {
        dbPromise: Promise<{ data: typeof data; write: () => Promise<void> }>;
      }).dbPromise = Promise.resolve({ data, write: async () => undefined });
      const records = await store.getHistory({ status: "settled", limit: 10 });
      const total = records.find((record) => record.fixtureId === "fx-repair");
      expect(total?.market).toBe("主隊半場入球大細");
      expect(total?.selectionName).toBe("主隊 半場細（0.5球）");
      expect(total?.actualSide).toBe("away");
      expect(total?.result).toBe("win");

      const handicap = records.find((record) => record.fixtureId === "fx-three-way");
      expect(handicap?.selectionName).toBe("客隊勝（主隊盤口 +2.0）");
      expect(handicap?.actualSide).toBe("home");
      expect(handicap?.result).toBe("loss");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps half-time markets pending when half-time score is missing", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");

    try {
      const store = new LearningStore(dbPath);

      await store.registerRecommendations([sampleRecommendation("fx-ht-missing", "球隊半場入球大細", "客隊 大（0.5球）")]);

      const settled = await store.settleFromFixtures([
        {
          ...sampleFixture("fx-ht-missing", 2, 1),
          halfTimeScore: undefined
        }
      ]);

      expect(settled).toBe(0);

      const snapshot = await store.getSnapshot();
      expect(snapshot.pendingCount).toBe(1);
      expect(snapshot.settledCount).toBe(0);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("backfills persisted match names from fixtures", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");

    try {
      const store = new LearningStore(dbPath);
      (store as unknown as { dbPromise: Promise<{ data: { pending: Array<Record<string, unknown>>; settled: Array<Record<string, unknown>> }; write: () => Promise<void> }> }).dbPromise = Promise.resolve({
        data: {
          pending: [
            {
              key: "fx-name|主客和|主勝",
              fixtureId: "fx-name",
              market: "主客和",
              selectionName: "主勝",
              currentOdds: 2.2,
              confidence: 68,
              edgeScore: 6.5,
              predictedSide: "home",
              createdAt: new Date().toISOString()
            }
          ],
          settled: []
        },
        write: async () => undefined
      });

      const updated = await store.backfillMatchNames([
        {
          ...sampleFixture("fx-name", 2, 1),
          homeTeam: "港會",
          awayTeam: "傑志"
        }
      ]);

      expect(updated).toBe(1);

      const records = await store.getHistory({ limit: 10 });
      expect(records[0]?.match).toBe("港會 vs 傑志");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("settles by preserved match context when fixture id changes", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");

    try {
      const store = new LearningStore(dbPath);
      const kickoffAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
      await store.registerRecommendations([
        {
          ...sampleRecommendation("old-fixture-id"),
          kickoffAt,
          league: "test",
          homeTeam: "主隊",
          awayTeam: "客隊"
        }
      ]);

      const settled = await store.settleFromFixtures([
        {
          ...sampleFixture("new-fixture-id", 2, 1),
          kickoffAt,
          league: "test",
          homeTeam: "主隊",
          awayTeam: "客隊"
        }
      ]);

      expect(settled).toBe(1);

      const snapshot = await store.getSnapshot();
      expect(snapshot.pendingCount).toBe(0);
      expect(snapshot.settledCount).toBe(1);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not re-register recommendations that are already settled", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");

    try {
      const store = new LearningStore(dbPath);
      const recommendation = sampleRecommendation("fx-once");

      await store.registerRecommendations([recommendation]);
      await store.settleFromFixtures([sampleFixture("fx-once", 2, 1)]);

      await store.registerRecommendations([recommendation]);
      const snapshot = await store.getSnapshot();

      expect(snapshot.pendingCount).toBe(0);
      expect(snapshot.settledCount).toBe(1);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps only the latest recommendation when a fixture changes market or direction", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");

    try {
      const store = new LearningStore(dbPath);
      const older = {
        ...sampleRecommendation("fx-changing", "半場讓球", "客隊勝（盤口 0.0/+0.5球）"),
        lastUpdatedAt: "2026-09-08T04:01:00.000Z"
      };
      const newer = {
        ...sampleRecommendation("fx-changing", "半場主客和", "主隊勝"),
        lastUpdatedAt: "2026-09-08T18:01:00.000Z"
      };

      await store.registerRecommendations([older]);
      await store.registerRecommendations([newer]);

      const history = await store.getHistory({ limit: 10 });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        fixtureId: "fx-changing",
        market: "半場主客和",
        selectionName: "主隊勝",
        predictedSide: "home"
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("repairs existing settled history to one latest recommendation per fixture", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");

    try {
      const store = new LearningStore(dbPath);
      const older = {
        ...sampleRecommendation("fx-history", "半場讓球", "客隊勝（盤口 0.0/+0.5球）"),
        lastUpdatedAt: "2026-09-08T04:01:00.000Z"
      };
      const newer = {
        ...sampleRecommendation("fx-history", "半場主客和", "主隊勝"),
        lastUpdatedAt: "2026-09-08T18:01:00.000Z"
      };
      await store.registerRecommendations([older, newer]);
      await store.settleFromFixtures([{
        ...sampleFixture("fx-history", 2, 0),
        halfTimeScore: { home: 1, away: 0 }
      }]);

      const history = await store.getHistory({ limit: 10 });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        fixtureId: "fx-history",
        market: "半場主客和",
        selectionName: "主隊勝",
        status: "settled"
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns deduplicated history records by key and prefers settled entries", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");

    try {
      const store = new LearningStore(dbPath);
      const now = Date.now();
      const key = "fx-dup|主客和|主勝";
      const createdAt = new Date(now - 2 * 60 * 60 * 1000).toISOString();
      const settledAtOld = new Date(now - 60 * 60 * 1000).toISOString();
      const settledAtNew = new Date(now - 30 * 60 * 1000).toISOString();

      const data = {
        pending: [
          {
            key,
            fixtureId: "fx-dup",
            match: "主隊 vs 客隊",
            market: "主客和",
            selectionName: "主勝",
            currentOdds: 2.2,
            confidence: 68,
            edgeScore: 6.5,
            predictedSide: "home",
            createdAt
          }
        ],
        settled: [
          {
            key,
            fixtureId: "fx-dup",
            match: "主隊 vs 客隊",
            market: "主客和",
            selectionName: "主勝",
            currentOdds: 2.3,
            confidence: 69,
            edgeScore: 6.8,
            predictedSide: "home",
            actualSide: "home",
            result: "win",
            createdAt,
            settledAt: settledAtOld
          },
          {
            key,
            fixtureId: "fx-dup",
            match: "主隊 vs 客隊",
            market: "主客和",
            selectionName: "主勝",
            currentOdds: 2.4,
            confidence: 70,
            edgeScore: 7,
            predictedSide: "home",
            actualSide: "home",
            result: "win",
            createdAt,
            settledAt: settledAtNew
          }
        ]
      };

      (store as unknown as {
        dbPromise: Promise<{ data: typeof data; write: () => Promise<void> }>;
      }).dbPromise = Promise.resolve({ data, write: async () => undefined });

      const history = await store.getHistory({ limit: 10 });
      expect(history).toHaveLength(1);
      expect(history[0]?.status).toBe("settled");
      expect(history[0]?.currentOdds).toBe(2.4);
      expect(history[0]?.settledAt).toBe(settledAtNew);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("orders history by kickoff time from newest to oldest", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");

    try {
      const store = new LearningStore(dbPath);
      const older = sampleRecommendation("fx-older");
      older.kickoffAt = "2026-09-02T20:00:00.000Z";
      older.lastUpdatedAt = "2026-09-03T12:00:00.000Z";
      const newer = sampleRecommendation("fx-newer");
      newer.kickoffAt = "2026-09-03T20:00:00.000Z";
      newer.lastUpdatedAt = "2026-09-03T01:00:00.000Z";

      await store.registerRecommendations([older, newer]);

      const history = await store.getHistory({ limit: 10 });
      expect(history.map((record) => record.fixtureId)).toEqual(["fx-newer", "fx-older"]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns a requested history page while preserving the filtered total", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "learning-store-"));
    const dbPath = path.join(tempRoot, "learning.json");

    try {
      const store = new LearningStore(dbPath);
      const recommendations = Array.from({ length: 45 }, (_, index) => ({
        ...sampleRecommendation(`fx-page-${index + 1}`),
        kickoffAt: new Date(Date.now() - index * 60_000).toISOString()
      }));
      await store.registerRecommendations(recommendations);

      const secondPage = await store.getHistory({ limit: 20, page: 2 });
      expect(secondPage).toHaveLength(20);
      expect(secondPage[0]?.fixtureId).toBe("fx-page-21");
      expect(await store.countHistory()).toBe(45);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
