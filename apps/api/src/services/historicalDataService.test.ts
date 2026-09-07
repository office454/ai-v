import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  mergeHistoricalMatches,
  parseFootballDataCsv,
  type HistoricalMatchDb
} from "./historicalDataService.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Football-Data historical import", () => {
  const csv = [
    "Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HTHG,HTAG,HTR,HS,AS,HST,AST,HC,AC,HY,AY,HR,AR,B365H,B365D,B365A,B365CH,B365CD,B365CA,B365>2.5,B365<2.5",
    "E0,16/08/2025,12:30,Liverpool,Bournemouth,4,2,H,2,1,H,19,10,10,3,6,7,1,2,0,0,1.40,5.20,7.50,1.33,5.50,8.00,1.80,2.00"
  ].join("\n");

  it("normalizes results, match statistics and bookmaker odds", () => {
    const [record] = parseFootballDataCsv(csv, { league: "Premier League", season: "2025-26" });

    expect(record.kickoffAt).toBe("2025-08-16T12:30:00.000Z");
    expect(record.fullTime).toEqual({ home: 4, away: 2, result: "H" });
    expect(record.shots).toEqual({ home: 19, away: 10, homeOnTarget: 10, awayOnTarget: 3 });
    expect(record.corners).toEqual({ home: 6, away: 7 });
    expect(record.odds?.opening).toMatchObject({
      home: 1.4,
      draw: 5.2,
      away: 7.5,
      over25: 1.8,
      under25: 2,
      provider: "Bet365"
    });
    expect(record.odds?.closing).toMatchObject({
      home: 1.33,
      draw: 5.5,
      away: 8,
      provider: "Bet365 closing"
    });
  });

  it("merges repeat imports by a deterministic fixture key", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "aiv-history-"));
    tempDirectories.push(directory);
    const outputPath = path.join(directory, "football-data.json");
    const records = parseFootballDataCsv(csv, { league: "Premier League", season: "2025-26" });

    expect(await mergeHistoricalMatches(outputPath, records)).toMatchObject({ added: 1, updated: 0, total: 1 });
    expect(await mergeHistoricalMatches(outputPath, records)).toMatchObject({ added: 0, updated: 1, total: 1 });

    const stored = JSON.parse(await readFile(outputPath, "utf8")) as HistoricalMatchDb;
    expect(stored.records).toHaveLength(1);
    expect(stored.records[0].source).toBe("football-data.co.uk");
  });

  it("rejects rows without a settled full-time score", () => {
    const incomplete = "Div,Date,HomeTeam,AwayTeam,FTHG,FTAG\nE0,16/08/2025,A,B,,";

    expect(() => parseFootballDataCsv(incomplete, { league: "Premier League", season: "2025-26" }))
      .toThrow("missing or invalid FTHG");
  });
});