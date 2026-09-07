import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HistoricalMatchDb } from "../src/services/historicalDataService.js";
import { buildLeakageSafeHistoricalFeatures } from "../src/services/historicalFeatureService.js";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function positiveInteger(name: string, fallback: number): number {
  const raw = argument(name);
  const parsed = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = path.resolve(scriptDirectory, "../../..");
  const inputPath = path.resolve(
    workspaceRoot,
    argument("input") ?? process.env.HISTORICAL_DB_PATH ?? "apps/api/data/historical/football-data.json"
  );
  const outputPath = path.resolve(
    workspaceRoot,
    argument("output") ?? "apps/api/data/historical/football-data-features.jsonl"
  );
  const metaPath = `${outputPath}.meta.json`;
  const input = JSON.parse(await fs.readFile(inputPath, "utf8")) as HistoricalMatchDb;
  const options = {
    leagueWindow: positiveInteger("league-window", 380),
    strengthWindow: positiveInteger("strength-window", 10),
    priorMatches: positiveInteger("prior-matches", 5),
    minLeagueMatches: positiveInteger("min-league-matches", 20),
    minVenueMatches: positiveInteger("min-venue-matches", 3)
  };
  const features = buildLeakageSafeHistoricalFeatures(input.records, options);
  const eligible = features.filter((feature) => feature.strengths.eligible).length;
  const oddsMovement = features.filter(
    (feature) => feature.odds.movement.homeProbability !== null
  ).length;
  const shots = features.filter(
    (feature) => feature.rolling.home.recent5.shotsMatches > 0 && feature.rolling.away.recent5.shotsMatches > 0
  ).length;
  const corners = features.filter(
    (feature) => feature.rolling.home.recent5.cornerMatches > 0 && feature.rolling.away.recent5.cornerMatches > 0
  ).length;
  const metadata = {
    version: 1,
    generatedAt: new Date().toISOString(),
    leakagePolicy: "Features are calculated before the current kickoff group is added to history.",
    input: inputPath,
    output: outputPath,
    options,
    records: features.length,
    coverage: { eligiblePoisson: eligible, oddsMovement, rollingShots: shots, rollingCorners: corners }
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${features.map((feature) => JSON.stringify(feature)).join("\n")}\n`, "utf8");
  await fs.writeFile(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  console.log("[historical-features] build complete", metadata);
}

main().catch((error) => {
  console.error("[historical-features] build failed", error instanceof Error ? error.message : error);
  process.exit(1);
});