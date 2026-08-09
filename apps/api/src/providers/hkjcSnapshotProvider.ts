import { readFile } from "node:fs/promises";
import type { Fixture } from "../types.js";
import type { DailyFixtureProvider } from "./provider.js";
import { extractHkjcMatches, mergeHkjcMatches, toHkjcFixture } from "./hkjcGraphqlProvider.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecordArray(values: unknown[]): Array<Record<string, unknown>> {
  return values.filter(isRecord);
}

function mergeMatchGroups(groups: Array<Array<Record<string, unknown>>>): Array<Record<string, unknown>> {
  let merged: Array<Record<string, unknown>> = [];

  for (const group of groups) {
    merged = mergeHkjcMatches(merged, group);
  }

  return merged;
}

export function extractHkjcSnapshotMatches(snapshot: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(snapshot)) {
    const nestedGroups = snapshot
      .filter((item) => isRecord(item) || Array.isArray(item))
      .map((item) => extractHkjcSnapshotMatches(item));

    const mergedNested = mergeMatchGroups(nestedGroups);
    if (mergedNested.length > 0) {
      return mergedNested;
    }

    return asRecordArray(snapshot);
  }

  if (!isRecord(snapshot)) {
    return [];
  }

  if (Array.isArray(snapshot.matches)) {
    return asRecordArray(snapshot.matches);
  }

  if (Array.isArray(snapshot.responses)) {
    return mergeMatchGroups(snapshot.responses.map((item) => extractHkjcSnapshotMatches(item)));
  }

  if (Array.isArray(snapshot.payloads)) {
    return mergeMatchGroups(snapshot.payloads.map((item) => extractHkjcSnapshotMatches(item)));
  }

  if ("data" in snapshot) {
    return extractHkjcMatches(snapshot);
  }

  return [];
}

export class HkjcSnapshotProvider implements DailyFixtureProvider {
  constructor(private readonly snapshotPath: string) {}

  private async loadFixtures(): Promise<Fixture[]> {
    let parsed: unknown;

    try {
      const content = await readFile(this.snapshotPath, "utf8");
      parsed = JSON.parse(content) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown snapshot read error";
      throw new Error(`Failed to read HKJC snapshot file at ${this.snapshotPath}: ${message}`);
    }

    const matches = extractHkjcSnapshotMatches(parsed);
    if (matches.length === 0) {
      throw new Error(
        "HKJC snapshot contains no parseable matches. Supported shapes: GraphQL response, { matches: [...] }, or arrays of batch payloads."
      );
    }

    const fixtures = matches.map(toHkjcFixture).filter((item): item is Fixture => item !== null);
    if (fixtures.length === 0) {
      throw new Error(
        "HKJC snapshot parsed successfully but contains no usable odds data. Ensure the snapshot includes foPools/combinations currentOdds or HAD odds fields."
      );
    }

    return fixtures;
  }

  async fetchTodayFixtures(): Promise<Fixture[]> {
    return this.loadFixtures();
  }

  async fetchFixturesByIds(fixtureIds: string[]): Promise<Fixture[]> {
    const wanted = new Set(fixtureIds.map((id) => String(id).trim()).filter((id) => id.length > 0));
    if (wanted.size === 0) {
      return [];
    }

    const fixtures = await this.loadFixtures();
    return fixtures.filter((fixture) => wanted.has(fixture.id));
  }

  async refreshLineups(fixtures: Fixture[]): Promise<Fixture[]> {
    const refreshedAt = new Date().toISOString();
    const now = Date.now();

    return fixtures.map((fixture) => {
      const minutesToKickoff = Math.max(0, Math.floor((new Date(fixture.kickoffAt).getTime() - now) / 60000));
      return {
        ...fixture,
        lineup: {
          ...fixture.lineup,
          confirmed: minutesToKickoff <= 25,
          updatedAt: refreshedAt
        }
      };
    });
  }
}