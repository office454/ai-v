import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Fixture } from "../types.js";
import { OddsSnapshotService } from "./oddsSnapshotService.js";

function fixture(kickoffAt: string): Fixture {
  return {
    id: "match-1", league: "Premier League", kickoffAt, homeTeam: "Liverpool", awayTeam: "Arsenal", homeTeamEn: "Liverpool", awayTeamEn: "Arsenal",
    homeStrength: "elite", awayStrength: "elite", homeRecentPoints: 12, awayRecentPoints: 11, expertSentiment: 0.5,
    lineup: { confirmed: false, updatedAt: kickoffAt, home: [], away: [] }, oddsHistory: [], marketOptions: []
  };
}

describe("OddsSnapshotService", () => {
  it("captures a due checkpoint once and batches through the league endpoint", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "odds-snapshot-"));
    const storePath = path.join(directory, "snapshots.json");
    const now = new Date("2026-09-07T12:00:00.000Z");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{
      id: "odds-event-1", sport_key: "soccer_epl", commence_time: "2026-09-08T12:00:00.000Z", home_team: "Liverpool", away_team: "Arsenal",
      bookmakers: [{ key: "book", title: "Book", last_update: now.toISOString(), markets: [{ key: "h2h", outcomes: [{ name: "Liverpool", price: 2.1 }] }] }]
    }]), { status: 200, headers: { "x-requests-remaining": "499", "x-requests-used": "1" } }));
    const service = new OddsSnapshotService({ apiKey: "test-key", storePath, now: () => now, fetchImpl });

    await service.run([fixture("2026-09-08T12:00:00.000Z")]);
    await service.run([fixture("2026-09-08T12:00:00.000Z")]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await service.status()).toMatchObject({ snapshotCount: 1, checkpointCount: 1, quota: { remaining: 499, used: 1 } });
    expect((await service.snapshots("match-1"))[0].checkpoint).toBe("24h");
  });

  it("does not request without a configured key and records missed checkpoints without fabrication", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "odds-snapshot-"));
    const storePath = path.join(directory, "snapshots.json");
    const fetchImpl = vi.fn();
    const disabled = new OddsSnapshotService({ apiKey: "", storePath, fetchImpl });
    await disabled.run([fixture("2026-09-08T12:00:00.000Z")]);
    expect(fetchImpl).not.toHaveBeenCalled();

    const now = new Date("2026-09-07T13:00:00.000Z");
    const service = new OddsSnapshotService({ apiKey: "test-key", storePath, now: () => now, fetchImpl });
    await service.run([fixture("2026-09-08T12:00:00.000Z")]);
    expect(fetchImpl).not.toHaveBeenCalled();
    const stored = JSON.parse(await readFile(storePath, "utf8")) as { checkpoints: Array<{ checkpoint: string; status: string }> };
    expect(stored.checkpoints).toContainEqual(expect.objectContaining({ checkpoint: "24h", status: "missed" }));
  });
});