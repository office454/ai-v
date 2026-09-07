import { promises as fs } from "node:fs";
import path from "node:path";
import { mergeHistoricalMatches, parseFootballDataCsv } from "../src/services/historicalDataService.js";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function usage(): never {
  console.error([
    "Usage:",
    "  npm run import:football-data -- --file=<csv> --league=<name> --season=<yyyy-yy>",
    "",
    "Optional:",
    "  --output=<json>  Default: HISTORICAL_DB_PATH or apps/api/data/historical/football-data.json"
  ].join("\n"));
  process.exit(1);
}

async function main(): Promise<void> {
  const file = argument("file");
  const league = argument("league");
  const season = argument("season");
  if (!file || !league || !season) {
    usage();
  }

  const workspaceRoot = path.resolve(process.cwd(), "../..");
  const inputPath = path.resolve(workspaceRoot, file);
  const outputPath = path.resolve(
    workspaceRoot,
    argument("output") ?? process.env.HISTORICAL_DB_PATH ?? "apps/api/data/historical/football-data.json"
  );
  const csv = await fs.readFile(inputPath, "utf8");
  const records = parseFootballDataCsv(csv, { league, season });
  const result = await mergeHistoricalMatches(outputPath, records);

  console.log("[football-data] import complete", {
    input: inputPath,
    output: outputPath,
    parsed: records.length,
    ...result
  });
}

main().catch((error) => {
  console.error("[football-data] import failed", error instanceof Error ? error.message : error);
  process.exit(1);
});