import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Fixture, Recommendation } from "../types.js";
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
});
