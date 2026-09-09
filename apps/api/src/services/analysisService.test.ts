import { describe, expect, it } from "vitest";
import type { Fixture } from "../types.js";
import {
  buildFotMobSettlementCandidates,
  isFixtureFinishedForRecommendations,
  isFixturePreMatchForTopFive,
  mergeExternalFixtureFallback,
  mergeSportsDbFixtureFallback,
  needsSportsDbLiveFallback,
  settlementResultDateRange
} from "./analysisService.js";
import { parseSportsDbLiveMinute } from "./theSportsDbResultsService.js";

const liveFixture: Fixture = {
  id: "50071181",
  league: "墨西哥超級聯賽",
  kickoffAt: "2026-08-22T09:00:00.000+08:00",
  status: "SECONDHALF",
  homeTeam: "利昂",
  awayTeam: "蒙特雷",
  homeStrength: "average",
  awayStrength: "strong",
  homeRecentPoints: 5,
  awayRecentPoints: 8,
  expertSentiment: 0,
  lineup: { confirmed: false, updatedAt: "2026-08-22T10:28:43.539+08:00", home: [], away: [] },
  oddsHistory: [],
  marketOptions: [{
    oddsType: "HAD",
    oddsTypeName: "",
    selectionCode: "H",
    selectionName: "主隊勝",
    lineCondition: "0.0",
    currentOdds: 1.74,
    inplay: true,
    poolStatus: "SELLINGSTARTED",
    combinationStatus: "AVAILABLE",
    updatedAt: "2026-08-22T10:28:43.539+08:00"
  }]
};

describe("isFixtureFinishedForRecommendations", () => {
  it("keeps an HKJC second-half fixture with available in-play odds eligible", () => {
    expect(isFixtureFinishedForRecommendations(liveFixture, Date.parse("2026-08-22T10:30:00+08:00"))).toBe(false);
  });

  it("excludes a fixture explicitly marked as finished", () => {
    expect(isFixtureFinishedForRecommendations({ ...liveFixture, status: "FINISHED" }, Date.parse("2026-08-22T12:00:00+08:00"))).toBe(true);
  });
});

describe("settlementResultDateRange", () => {
  it("covers the full pending retention window using Hong Kong date keys", () => {
    expect(settlementResultDateRange("2026-09-09")).toEqual({
      startDate: "20260902",
      endDate: "20260909"
    });
  });
});

describe("buildFotMobSettlementCandidates", () => {
  const pendingRecord = {
    key: "fixture-1::HAD::H",
    fixtureId: "fixture-1",
    match: "主隊 vs 客隊",
    kickoffAt: "2026-09-08T20:00:00+08:00",
    league: "測試聯賽",
    homeTeam: "主隊",
    awayTeam: "客隊",
    homeTeamEn: "Home FC",
    awayTeamEn: "Away FC",
    market: "讓球",
    selectionName: "主隊",
    currentOdds: 2,
    confidence: 0.7,
    edgeScore: 0.1,
    predictedSide: "home" as const,
    status: "pending" as const,
    createdAt: "2026-09-08T12:00:00.000Z"
  };

  it("creates one lookup fixture from duplicate pending records outside the current fixture pool", () => {
    const candidates = buildFotMobSettlementCandidates(
      [pendingRecord, { ...pendingRecord, key: "fixture-1::HAD::A", selectionName: "客隊" }],
      [],
      Date.parse("2026-09-09T00:00:00+08:00")
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: "fixture-1",
      kickoffAt: pendingRecord.kickoffAt,
      homeTeamEn: "Home FC",
      awayTeamEn: "Away FC",
      marketOptions: []
    });
  });

  it("preserves the current HKJC fixture and enriches only missing English team names", () => {
    const currentFixture = { ...liveFixture, id: "fixture-1", homeTeamEn: undefined, awayTeamEn: undefined };
    const [candidate] = buildFotMobSettlementCandidates(
      [pendingRecord],
      [currentFixture],
      Date.parse("2026-09-09T00:00:00+08:00")
    );

    expect(candidate.marketOptions).toBe(currentFixture.marketOptions);
    expect(candidate.homeTeamEn).toBe("Home FC");
    expect(candidate.awayTeamEn).toBe("Away FC");
  });

  it("uses current HKJC fixture metadata when the pending record does not contain it", () => {
    const currentFixture = {
      ...liveFixture,
      id: "fixture-1",
      homeTeamEn: "Current Home FC",
      awayTeamEn: "Current Away FC"
    };
    const [candidate] = buildFotMobSettlementCandidates(
      [{ ...pendingRecord, kickoffAt: undefined, homeTeamEn: undefined, awayTeamEn: undefined }],
      [currentFixture],
      Date.parse("2026-09-09T00:00:00+08:00")
    );

    expect(candidate).toBeDefined();
    expect(candidate.kickoffAt).toBe(currentFixture.kickoffAt);
    expect(candidate.homeTeamEn).toBe("Current Home FC");
    expect(candidate.awayTeamEn).toBe("Current Away FC");
  });

  it("excludes fixtures that have not been underway for two hours", () => {
    const candidates = buildFotMobSettlementCandidates(
      [pendingRecord],
      [],
      Date.parse("2026-09-08T21:59:59+08:00")
    );

    expect(candidates).toEqual([]);
  });
});

describe("isFixturePreMatchForTopFive", () => {
  const nowMs = Date.parse("2026-08-22T10:30:00+08:00");

  it("accepts only a future fixture with pre-match markets", () => {
    expect(isFixturePreMatchForTopFive({
      ...liveFixture,
      kickoffAt: "2026-08-22T12:00:00+08:00",
      status: "PREEVENT",
      marketOptions: liveFixture.marketOptions.map((option) => ({ ...option, inplay: false }))
    }, nowMs)).toBe(true);
  });

  it("rejects live fixtures even when they have a focused recommendation", () => {
    expect(isFixturePreMatchForTopFive(liveFixture, nowMs)).toBe(false);
  });

  it("accepts a future pre-event fixture carrying HKJC in-play-capable markets", () => {
    expect(isFixturePreMatchForTopFive({
      ...liveFixture,
      kickoffAt: "2026-08-22T12:00:00+08:00",
      status: "PREEVENT"
    }, nowMs)).toBe(true);
  });

  it("rejects stale pre-event fixtures after kickoff", () => {
    expect(isFixturePreMatchForTopFive({ ...liveFixture, status: "PREEVENT" }, nowMs)).toBe(false);
  });
});

describe("TheSportsDB focused-fixture fallback", () => {
  it("requests fallback when a live HKJC fixture is missing live fields", () => {
    expect(needsSportsDbLiveFallback(liveFixture)).toBe(true);
    expect(needsSportsDbLiveFallback({
      ...liveFixture,
      halfTimeScore: { home: 0, away: 0 },
      finalScore: { home: 1, away: 0 },
      finalCorners: { home: 4, away: 1, total: 5 },
      liveMinute: 67,
      liveMinuteSource: "TheSportsDB"
    })).toBe(false);
  });

  it("fills only missing fields and preserves the HKJC fixture identity and markets", () => {
    const merged = mergeSportsDbFixtureFallback(liveFixture, {
      fixtureId: liveFixture.id,
      status: "2H",
      liveMinute: 67,
      halfTimeScore: { home: 0, away: 0 },
      finalScore: { home: 1, away: 0 }
    });

    expect(merged.id).toBe(liveFixture.id);
    expect(merged.marketOptions).toBe(liveFixture.marketOptions);
    expect(merged.status).toBe("SECONDHALF");
    expect(merged.finalScore).toEqual({ home: 1, away: 0 });
    expect(merged.halfTimeScore).toEqual({ home: 0, away: 0 });
    expect(merged.liveMinute).toBe(67);
    expect(merged.liveMinuteSource).toBe("TheSportsDB");
    expect(merged.liveDataSources).toEqual(["hkjc", "thesportsdb"]);
    expect(merged.liveDataFallbackNote).toContain("即時比分、半場比分、賽事分鐘（67'）");
  });

  it("accepts an explicit external finished status over a stale HKJC status", () => {
    const merged = mergeExternalFixtureFallback({ ...liveFixture, status: "PREEVENT" }, {
      fixtureId: liveFixture.id,
      status: "FINISHED",
      finalScore: { home: 1, away: 1 },
      finalCorners: { home: 9, away: 2, total: 11 }
    }, "FotMob");

    expect(merged.status).toBe("FINISHED");
    expect(merged.id).toBe(liveFixture.id);
    expect(merged.marketOptions).toEqual(liveFixture.marketOptions);
  });

  it("replaces a provisional score when an external source explicitly confirms full time", () => {
    const merged = mergeExternalFixtureFallback({
      ...liveFixture,
      status: "PREEVENT",
      finalScore: { home: 0, away: 0 }
    }, {
      fixtureId: liveFixture.id,
      status: "Full Time",
      finalScore: { home: 2, away: 1 },
      finalCorners: { home: 7, away: 4, total: 11 }
    }, "ESPN");

    expect(merged.status).toBe("Full Time");
    expect(merged.finalScore).toEqual({ home: 2, away: 1 });
    expect(merged.finalCorners).toEqual({ home: 7, away: 4, total: 11 });
  });

  it("merges Highlightly fields without replacing HKJC identity or markets", () => {
    const merged = mergeExternalFixtureFallback(liveFixture, {
      fixtureId: liveFixture.id,
      status: "Second half",
      liveMinute: 68,
      finalScore: { home: 1, away: 0 },
      finalCorners: { home: 6, away: 3, total: 9 },
      liveAttackingMetrics: {
        source: "Highlightly",
        possession: { home: 58, away: 42 }
      }
    }, "Highlightly");

    expect(merged.id).toBe(liveFixture.id);
    expect(merged.marketOptions).toBe(liveFixture.marketOptions);
    expect(merged.liveMinute).toBe(68);
    expect(merged.liveMinuteSource).toBe("Highlightly");
    expect(merged.finalCorners).toEqual({ home: 6, away: 3, total: 9 });
    expect(merged.liveDataSources).toEqual(["hkjc", "highlightly"]);
  });

  it("does not overwrite HKJC values and records a no-additional-data cross-check", () => {
    const completeFixture = {
      ...liveFixture,
      halfTimeScore: { home: 1, away: 0 },
      finalScore: { home: 2, away: 0 }
    };
    const merged = mergeSportsDbFixtureFallback(completeFixture, {
      fixtureId: liveFixture.id,
      halfTimeScore: { home: 0, away: 1 },
      finalScore: { home: 0, away: 2 }
    });

    expect(merged.finalScore).toEqual({ home: 2, away: 0 });
    expect(merged.halfTimeScore).toEqual({ home: 1, away: 0 });
    expect(merged.liveDataSources).toEqual(["hkjc", "thesportsdb"]);
    expect(merged.liveDataFallbackNote).toContain("未提供額外可補欄位");
  });

  it("accepts only explicit numeric SportsDB progress as a sourced minute", () => {
    expect(parseSportsDbLiveMinute("67'")).toBe(67);
    expect(parseSportsDbLiveMinute("90+4 min")).toBe(94);
    expect(parseSportsDbLiveMinute("2H")).toBeNull();
    expect(parseSportsDbLiveMinute("FT")).toBeNull();
    expect(parseSportsDbLiveMinute("155'")).toBeNull();
  });
});
