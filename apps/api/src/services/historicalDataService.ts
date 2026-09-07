import { promises as fs } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";

export type HistoricalMatch = {
  key: string;
  source: "football-data.co.uk";
  division: string;
  league: string;
  season: string;
  kickoffAt: string;
  homeTeam: string;
  awayTeam: string;
  fullTime: { home: number; away: number; result?: string };
  halfTime?: { home: number; away: number; result?: string };
  shots?: { home: number; away: number; homeOnTarget?: number; awayOnTarget?: number };
  corners?: { home: number; away: number };
  cards?: { homeYellow?: number; awayYellow?: number; homeRed?: number; awayRed?: number };
  odds?: {
    opening?: HistoricalOddsSnapshot;
    closing?: HistoricalOddsSnapshot;
  };
};

export type HistoricalOddsSnapshot = {
  home: number;
  draw: number;
  away: number;
  over25?: number;
  under25?: number;
  provider: string;
};

export type HistoricalMatchDb = {
  version: 1;
  updatedAt: string;
  records: HistoricalMatch[];
};

export type FootballDataImportOptions = {
  league: string;
  season: string;
};

function requiredText(row: Record<string, string>, field: string, rowNumber: number): string {
  const value = row[field]?.trim();
  if (!value) {
    throw new Error(`Football-Data row ${rowNumber}: missing ${field}`);
  }
  return value;
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function requiredNumber(row: Record<string, string>, field: string, rowNumber: number): number {
  const value = optionalNumber(row[field]);
  if (value === undefined) {
    throw new Error(`Football-Data row ${rowNumber}: missing or invalid ${field}`);
  }
  return value;
}

function parseFootballDataDate(dateValue: string, timeValue: string | undefined, rowNumber: number): string {
  const match = dateValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) {
    throw new Error(`Football-Data row ${rowNumber}: unsupported Date ${dateValue}`);
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? (rawYear >= 70 ? 1900 + rawYear : 2000 + rawYear) : rawYear;
  const timeMatch = timeValue?.trim().match(/^(\d{1,2}):(\d{2})$/);
  const hour = timeMatch ? Number(timeMatch[1]) : 0;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    throw new Error(`Football-Data row ${rowNumber}: invalid Date/Time ${dateValue} ${timeValue ?? ""}`.trim());
  }

  return date.toISOString();
}

function optionalPair(home: number | undefined, away: number | undefined): { home: number; away: number } | undefined {
  return home === undefined || away === undefined ? undefined : { home, away };
}

function preferredOddsSnapshot(
  row: Record<string, string>,
  providers: ReadonlyArray<{ name: string; fields: readonly [string, string, string] }>,
  totalFields: readonly [string, string][]
): HistoricalOddsSnapshot | undefined {
  const total = totalFields
    .map(([overField, underField]) => ({
      over25: optionalNumber(row[overField]),
      under25: optionalNumber(row[underField])
    }))
    .find((candidate) => candidate.over25 !== undefined && candidate.under25 !== undefined);

  for (const provider of providers) {
    const [home, draw, away] = provider.fields.map((field) => optionalNumber(row[field]));
    if (home !== undefined && draw !== undefined && away !== undefined) {
      return {
        home,
        draw,
        away,
        ...total,
        provider: provider.name
      };
    }
  }

  return undefined;
}

function preferredOdds(row: Record<string, string>): HistoricalMatch["odds"] {
  const opening = preferredOddsSnapshot(
    row,
    [
      { name: "Pinnacle", fields: ["PSH", "PSD", "PSA"] },
      { name: "Bet365", fields: ["B365H", "B365D", "B365A"] },
      { name: "market average", fields: ["AvgH", "AvgD", "AvgA"] }
    ],
    [["P>2.5", "P<2.5"], ["B365>2.5", "B365<2.5"], ["Avg>2.5", "Avg<2.5"]]
  );
  const closing = preferredOddsSnapshot(
    row,
    [
      { name: "Pinnacle closing", fields: ["PSCH", "PSCD", "PSCA"] },
      { name: "Bet365 closing", fields: ["B365CH", "B365CD", "B365CA"] },
      { name: "market closing average", fields: ["AvgCH", "AvgCD", "AvgCA"] }
    ],
    [["PC>2.5", "PC<2.5"], ["B365C>2.5", "B365C<2.5"], ["AvgC>2.5", "AvgC<2.5"]]
  );

  return opening || closing ? { opening, closing } : undefined;
}

export function parseFootballDataCsv(csv: string, options: FootballDataImportOptions): HistoricalMatch[] {
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true
  }) as Record<string, string>[];

  return rows.map((row, index) => {
    const rowNumber = index + 2;
    const division = row.Div?.trim() || options.league;
    const kickoffAt = parseFootballDataDate(
      requiredText(row, "Date", rowNumber),
      row.Time,
      rowNumber
    );
    const homeTeam = requiredText(row, "HomeTeam", rowNumber);
    const awayTeam = requiredText(row, "AwayTeam", rowNumber);
    const halfTime = optionalPair(optionalNumber(row.HTHG), optionalNumber(row.HTAG));
    const shots = optionalPair(optionalNumber(row.HS), optionalNumber(row.AS));
    const corners = optionalPair(optionalNumber(row.HC), optionalNumber(row.AC));
    const key = [division, options.season, kickoffAt, homeTeam, awayTeam]
      .map((value) => value.trim().toLowerCase())
      .join("|");

    return {
      key,
      source: "football-data.co.uk",
      division,
      league: options.league,
      season: options.season,
      kickoffAt,
      homeTeam,
      awayTeam,
      fullTime: {
        home: requiredNumber(row, "FTHG", rowNumber),
        away: requiredNumber(row, "FTAG", rowNumber),
        result: row.FTR?.trim() || undefined
      },
      halfTime: halfTime ? { ...halfTime, result: row.HTR?.trim() || undefined } : undefined,
      shots: shots
        ? {
            ...shots,
            homeOnTarget: optionalNumber(row.HST),
            awayOnTarget: optionalNumber(row.AST)
          }
        : undefined,
      corners,
      cards: {
        homeYellow: optionalNumber(row.HY),
        awayYellow: optionalNumber(row.AY),
        homeRed: optionalNumber(row.HR),
        awayRed: optionalNumber(row.AR)
      },
      odds: preferredOdds(row)
    };
  });
}

export async function mergeHistoricalMatches(
  outputPath: string,
  incoming: HistoricalMatch[]
): Promise<{ added: number; updated: number; total: number }> {
  let existing: HistoricalMatchDb = { version: 1, updatedAt: new Date(0).toISOString(), records: [] };
  try {
    existing = JSON.parse(await fs.readFile(outputPath, "utf8")) as HistoricalMatchDb;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const records = new Map(existing.records.map((record) => [record.key, record]));
  let added = 0;
  let updated = 0;
  for (const record of incoming) {
    if (records.has(record.key)) {
      updated += 1;
    } else {
      added += 1;
    }
    records.set(record.key, record);
  }

  const db: HistoricalMatchDb = {
    version: 1,
    updatedAt: new Date().toISOString(),
    records: [...records.values()].sort((left, right) => left.kickoffAt.localeCompare(right.kickoffAt))
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  return { added, updated, total: db.records.length };
}