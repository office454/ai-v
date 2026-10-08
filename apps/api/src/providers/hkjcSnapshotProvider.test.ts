import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { scoreFixture } from "../engine/scoring.js";
import { HkjcGraphqlProvider, toHkjcFixture } from "./hkjcGraphqlProvider.js";
import { extractHkjcSnapshotMatches, HkjcSnapshotProvider } from "./hkjcSnapshotProvider.js";

function hadPool() {
  return {
    oddsType: "HAD",
    name_ch: "主客和",
    status: "Open",
    updateAt: "2026-07-14T12:00:00.000Z",
    lines: [
      {
        condition: "N/A",
        combinations: [
          {
            str: "HADH",
            currentOdds: 1.82,
            status: "Open",
            selections: [{ name_ch: "主勝" }]
          },
          {
            str: "HADX",
            currentOdds: 3.35,
            status: "Open",
            selections: [{ name_ch: "和" }]
          },
          {
            str: "HADA",
            currentOdds: 4.25,
            status: "Open",
            selections: [{ name_ch: "客勝" }]
          }
        ]
      }
    ]
  };
}

function hdcPool() {
  return {
    oddsType: "HDC",
    name_ch: "讓球",
    status: "Open",
    updateAt: "2026-07-14T12:00:00.000Z",
    lines: [
      {
        condition: "[0/-0.5]",
        combinations: [
          {
            str: "HDCH",
            currentOdds: 1.96,
            status: "Open",
            selections: [{ name_ch: "主" }]
          }
        ]
      }
    ]
  };
}

function payloadWithPools(pools: unknown[]) {
  return {
    data: {
      matches: [
        {
          id: "match-1",
          kickOffTime: "2026-07-14T19:30:00.000Z",
          status: "Open",
          tournamentNameChi: "英超",
          homeTeam: { name_ch: "主隊" },
          awayTeam: { name_ch: "客隊" },
          foPools: pools
        }
      ]
    }
  };
}

describe("HkjcSnapshotProvider", () => {
  it("uses the time a fresh GraphQL response was observed when live pool timestamps are missing", () => {
    const marketObservedAt = new Date().toISOString();
    const fixture = toHkjcFixture({
      id: "live-no-pool-timestamp",
      kickOffTime: new Date(Date.now() - 60 * 60_000).toISOString(),
      status: "SECONDHALF",
      homeTeam: { name_ch: "主隊" },
      awayTeam: { name_ch: "客隊" },
      foPools: [{
        oddsType: "HAD",
        name_ch: "主客和",
        inplay: true,
        status: "SELLINGSTARTED",
        lines: [{
          condition: "N/A",
          combinations: [
            { str: "HADH", currentOdds: 2, status: "AVAILABLE", selections: [{ name_ch: "主勝" }] },
            { str: "HADX", currentOdds: 3, status: "AVAILABLE", selections: [{ name_ch: "和" }] },
            { str: "HADA", currentOdds: 4, status: "AVAILABLE", selections: [{ name_ch: "客勝" }] }
          ]
        }]
      }]
    }, marketObservedAt);

    expect(fixture?.marketOptions).toHaveLength(3);
    expect(fixture?.marketOptions.every((option) => option.observedAt === marketObservedAt)).toBe(true);
    expect(fixture?.marketOptions.every((option) => option.updatedAt === "")).toBe(true);
    expect(scoreFixture(fixture!).reasonSections).toBeDefined();
  });

  it("scores a freshly fetched sellable HKJC market even when its source update time is old", async () => {
    const sourceUpdatedAt = new Date(Date.now() - 48 * 60_000).toISOString();
    const match = {
      ...payloadWithPools([{
        ...hadPool(),
        inplay: true,
        status: "SELLINGSTARTED",
        updateAt: sourceUpdatedAt,
        lines: hadPool().lines.map((line) => ({ ...line, status: "AVAILABLE" }))
      }]).data.matches[0],
      status: "FIRSTHALFCOMPLETED",
      runningResult: { homeScore: 0, awayScore: 0, corner: 10, homeCorner: 9, awayCorner: 1 }
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ data: { matches: [match] } }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const provider = new HkjcGraphqlProvider(undefined, undefined, "query matchList { matches { id foPools { updateAt } } }", {
        fbOddsTypes: ["HAD"]
      }, 0);
      const [fixture] = await provider.fetchFixturesByIds(["match-1"]);
      expect(fixture.marketOptions.every((option) => option.updatedAt === sourceUpdatedAt)).toBe(true);
      expect(fixture.marketOptions.every((option) => Number.isFinite(Date.parse(option.observedAt ?? "")))).toBe(true);
      expect(scoreFixture(fixture, {}, { minRecommendedOdds: 1.01 }).reasonSections).toBeDefined();

      const snapshotFixture = toHkjcFixture(match);
      expect(snapshotFixture?.marketOptions.every((option) => option.observedAt === undefined)).toBe(true);
      expect(scoreFixture(snapshotFixture!, {}, { minRecommendedOdds: 1.01 }).reasonSections).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("merges batch payloads for the same match", () => {
    const matches = extractHkjcSnapshotMatches([payloadWithPools([hadPool()]), payloadWithPools([hdcPool()])]);

    expect(matches).toHaveLength(1);
    expect((matches[0].foPools as unknown[] | undefined) ?? []).toHaveLength(2);
  });

  it("loads fixtures from a saved snapshot file", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "hkjc-snapshot-"));
    const snapshotPath = path.join(tempRoot, "snapshot.json");

    try {
      writeFileSync(snapshotPath, `${JSON.stringify([payloadWithPools([hadPool()]), payloadWithPools([hdcPool()])], null, 2)}\n`);

      const provider = new HkjcSnapshotProvider(snapshotPath);
      const fixtures = await provider.fetchTodayFixtures();

      expect(fixtures).toHaveLength(1);
      expect(fixtures[0].id).toBe("match-1");
      expect(fixtures[0].marketOptions.length).toBeGreaterThanOrEqual(4);
      expect(fixtures[0].oddsHistory[0]).toMatchObject({
        homeWin: 1.82,
        draw: 3.35,
        awayWin: 4.25
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});