import type { DailyFixtureProvider } from "./provider.js";
import type { Fixture, MarketOption, TeamStrength } from "../types.js";

const DEFAULT_ENDPOINT = "https://info.cld.hkjc.com/graphql/base/";
const DEFAULT_REFERER = "https://bet.hkjc.com/ch/football/home";
const MATCH_IDS_BATCH_SIZE = 15;
const FOOTBALL_ODDS_TYPES_BATCH_SIZE = 4;
const DEFAULT_FOOTBALL_ODDS_TYPES = ["HAD", "HDC", "HIL", "CRS"] as const;
const DEPRECATED_FOOTBALL_ODDS_TYPES = new Set(["EHA", "EDC", "EHL", "ECH", "ECS", "ETG", "ENT", "ECD", "EHH"]);
const NETWORK_RETRY_MAX_ATTEMPTS = 3;
const NETWORK_RETRY_BASE_DELAY_MS = 1200;
const MATCH_ID_DISCOVERY_QUERY = `
  query allMatchList {
    timeOffset {
      fb
    }
    matches: matchList {
      id
      frontEndId
      matchDate
      kickOffTime
      status
      updateAt
      sequence
      esIndicatorEnabled
      homeTeam {
        id
        name_en
        name_ch
      }
      awayTeam {
        id
        name_en
        name_ch
      }
      tournament {
        id
        frontEndId
        nameProfileId
        sequence
        isInteractiveServiceAvailable
        code
        name_en
        name_ch
      }
      isInteractiveServiceAvailable
      inplayDelay
      venue {
        code
        name_en
        name_ch
      }
      tvChannels {
        code
        name_en
        name_ch
      }
      liveEvents {
        id
        code
      }
      featureStartTime
      featureMatchSequence
      poolInfo {
        normalPools
        inplayPools
        sellingPools
        ntsInfo
        entInfo
        definedPools
        ngsInfo {
          str
          name_en
          name_ch
          instNo
        }
        agsInfo {
          str
          name_en
          name_ch
        }
      }
      runningResult {
        homeScore
        awayScore
        corner
        homeCorner
        awayCorner
      }
      runningResultExtra {
        homeScore
        awayScore
        corner
        homeCorner
        awayCorner
      }
      adminOperation {
        remark {
          typ
        }
      }
    }
  }
`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function strengthFromOdds(odds: number): TeamStrength {
  if (odds <= 1.55) return "elite";
  if (odds <= 2.1) return "strong";
  if (odds <= 3.0) return "average";
  return "weak";
}

function recentPointsFromOdds(odds: number): number {
  if (odds <= 1.5) return 13;
  if (odds <= 2.0) return 10;
  if (odds <= 3.0) return 8;
  return 5;
}

function extractMarketOptions(match: Record<string, unknown>): MarketOption[] {
  const pools = (match.foPools as unknown[]) ?? [];
  const options: MarketOption[] = [];

  for (const poolRaw of pools) {
    const pool = (poolRaw as Record<string, unknown>) ?? {};
    const oddsType = String(pool.oddsType ?? "").trim();
    const oddsTypeName = String(pool.name_ch ?? pool.name_en ?? oddsType).trim();
    const inplay = Boolean(pool.inplay ?? false);
    const poolStatus = String(pool.status ?? "").trim();
    const poolUpdatedAt = String(pool.updateAt ?? new Date().toISOString()).trim();
    const lines = (pool.lines as unknown[]) ?? [];

    for (const lineRaw of lines) {
      const line = (lineRaw as Record<string, unknown>) ?? {};
      const lineCondition = String(line.condition ?? "N/A").trim() || "N/A";
      const combinations = (line.combinations as unknown[]) ?? [];

      for (const comboRaw of combinations) {
        const combo = (comboRaw as Record<string, unknown>) ?? {};
        const currentOdds = Number(combo.currentOdds);
        if (!Number.isFinite(currentOdds) || currentOdds <= 0) {
          continue;
        }

        const selectionCode = String(combo.str ?? "").trim();
        const combinationStatus = String(combo.status ?? poolStatus).trim();
        const selections = (combo.selections as unknown[]) ?? [];

        if (selections.length === 0) {
          options.push({
            oddsType,
            oddsTypeName,
            selectionCode,
            selectionName: selectionCode || "選項",
            lineCondition,
            currentOdds: Number(currentOdds.toFixed(2)),
            inplay,
            poolStatus,
            combinationStatus,
            updatedAt: poolUpdatedAt
          });
          continue;
        }

        for (const selectionRaw of selections) {
          const selection = (selectionRaw as Record<string, unknown>) ?? {};
          const selectionName = String(selection.name_ch ?? selection.name_en ?? selectionCode).trim();

          options.push({
            oddsType,
            oddsTypeName,
            selectionCode,
            selectionName: selectionName || selectionCode || "選項",
            lineCondition,
            currentOdds: Number(currentOdds.toFixed(2)),
            inplay,
            poolStatus,
            combinationStatus,
            updatedAt: poolUpdatedAt
          });
        }
      }
    }
  }

  return options;
}

function numberFromMatch(match: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = Number(match[key]);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return null;
}

function pickMarketOdds(match: Record<string, unknown>): { homeWin: number; draw: number; awayWin: number } | null {
  const pools = (match.foPools as unknown[]) ?? [];
  for (const poolRaw of pools) {
    const pool = poolRaw as Record<string, unknown>;
    const oddsType = String(pool.oddsType ?? "");
    if (oddsType !== "HAD" && oddsType !== "EHA") {
      continue;
    }

    const lines = (pool.lines as unknown[]) ?? [];
    const line = (lines[0] as Record<string, unknown>) ?? {};
    const combinations = (line.combinations as unknown[]) ?? [];

    const getOdds = (suffix: "H" | "X" | "A" | "D"): number | null => {
      const item = combinations.find((c) => {
        const str = String((c as Record<string, unknown>).str ?? "");
        return str.endsWith(suffix);
      }) as Record<string, unknown> | undefined;

      if (!item) return null;
      const value = Number(item.currentOdds);
      return Number.isFinite(value) ? value : null;
    };

    const homeWin = getOdds("H");
    const draw = getOdds("X") ?? getOdds("D");
    const awayWin = getOdds("A");

    if (homeWin && draw && awayWin) {
      return { homeWin, draw, awayWin };
    }
  }

  const homeWin = numberFromMatch(match, ["homeOdds", "hadHomeOdds", "oddsHome", "hOdds"]);
  const draw = numberFromMatch(match, ["drawOdds", "hadDrawOdds", "oddsDraw", "dOdds"]);
  const awayWin = numberFromMatch(match, ["awayOdds", "hadAwayOdds", "oddsAway", "aOdds"]);

  if (homeWin && draw && awayWin) {
    return { homeWin, draw, awayWin };
  }

  return null;
}

export function toHkjcFixture(match: Record<string, unknown>): Fixture | null {
  const id = String(match.id ?? match.matchId ?? "").trim();
  const homeTeamEn =
    String(
      match.homeTeamNameEn ??
        (match.homeTeam as Record<string, unknown> | undefined)?.name_en ??
        ""
    ).trim() || undefined;
  const awayTeamEn =
    String(
      match.awayTeamNameEn ??
        (match.awayTeam as Record<string, unknown> | undefined)?.name_en ??
        ""
    ).trim() || undefined;
  const homeTeam =
    String(
      match.homeTeamNameChi ??
        match.homeTeamNameEn ??
        (match.homeTeam as Record<string, unknown> | undefined)?.name_ch ??
        ""
    ).trim();
  const awayTeam =
    String(
      match.awayTeamNameChi ??
        match.awayTeamNameEn ??
        (match.awayTeam as Record<string, unknown> | undefined)?.name_ch ??
        ""
    ).trim();

  const kickoffAt =
    String(match.kickOffTime ?? match.matchDateTime ?? match.kickoffTime ?? new Date().toISOString()).trim();
  const tournament = (match.tournament as Record<string, unknown> | undefined) ?? {};
  const league = String(match.tournamentNameChi ?? match.tournamentNameEn ?? tournament.name_ch ?? tournament.name_en ?? "HKJC Football").trim();
  const status = String(match.status ?? "").trim() || undefined;

  if (!id || !homeTeam || !awayTeam) {
    return null;
  }

  const marketOptions = extractMarketOptions(match);
  const marketOdds = pickMarketOdds(match);
  if (!marketOdds) {
    return null;
  }

  const { homeWin, draw, awayWin } = marketOdds;
  const runningResult = (match.runningResult as Record<string, unknown> | undefined) ?? {};
  const runningResultExtra = (match.runningResultExtra as Record<string, unknown> | undefined) ?? {};
  const resultSummary = (match.results as Record<string, unknown> | undefined) ?? {};
  const finalHome = Number(runningResult.homeScore ?? resultSummary.homeResult);
  const finalAway = Number(runningResult.awayScore ?? resultSummary.awayResult);
  const finalScore =
    Number.isFinite(finalHome) && Number.isFinite(finalAway)
      ? {
          home: finalHome,
          away: finalAway
        }
      : undefined;
  const halfHome = Number(
    runningResult.homeHalfScore ??
      runningResult.homeHtScore ??
      runningResult.homeFirstHalfScore ??
      resultSummary.homeHalfResult ??
      resultSummary.homeHalfTimeResult ??
      resultSummary.htHomeResult
  );
  const halfAway = Number(
    runningResult.awayHalfScore ??
      runningResult.awayHtScore ??
      runningResult.awayFirstHalfScore ??
      resultSummary.awayHalfResult ??
      resultSummary.awayHalfTimeResult ??
      resultSummary.htAwayResult
  );
  const halfTimeScore =
    Number.isFinite(halfHome) && Number.isFinite(halfAway)
      ? {
          home: halfHome,
          away: halfAway
        }
      : undefined;
  const finalHomeCorners = Number((runningResult.homeCorner ?? runningResultExtra.homeCorner ?? resultSummary.homeCornerResult) as number);
  const finalAwayCorners = Number((runningResult.awayCorner ?? runningResultExtra.awayCorner ?? resultSummary.awayCornerResult) as number);
  const finalTotalCorners = Number((runningResult.corner ?? runningResultExtra.corner ?? resultSummary.ttlCornerResult) as number);
  const finalCorners =
    Number.isFinite(finalHomeCorners) && Number.isFinite(finalAwayCorners) && Number.isFinite(finalTotalCorners)
      ? {
          home: finalHomeCorners,
          away: finalAwayCorners,
          total: finalTotalCorners
        }
      : undefined;

  return {
    id,
    league,
    kickoffAt,
    status,
    halfTimeScore,
    finalScore,
    finalCorners,
    homeTeam,
    awayTeam,
    homeTeamEn,
    awayTeamEn,
    homeStrength: strengthFromOdds(homeWin),
    awayStrength: strengthFromOdds(awayWin),
    homeRecentPoints: recentPointsFromOdds(homeWin),
    awayRecentPoints: recentPointsFromOdds(awayWin),
    expertSentiment: Math.max(0.05, Math.min(0.95, 1 / homeWin)),
    lineup: {
      confirmed: false,
      updatedAt: new Date().toISOString(),
      home: [],
      away: []
    },
    oddsHistory: [
      {
        at: new Date().toISOString(),
        homeWin,
        draw,
        awayWin
      }
    ],
    marketOptions
  };
}

export class HkjcGraphqlProvider implements DailyFixtureProvider {
  private foPoolsCoverageWarned = false;

  constructor(
    private readonly endpoint = DEFAULT_ENDPOINT,
    private readonly referer = DEFAULT_REFERER,
    private readonly query = "",
    private readonly variables: Record<string, unknown> = {},
    private readonly minIntervalMs = 3000
  ) {}

  private isRetryableNetworkError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return /(fetch failed|network|timeout|timed out|econnreset|enotfound|status 429|status 5\d\d)/i.test(message);
  }

  private async withNetworkRetry<T>(label: string, task: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= NETWORK_RETRY_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await task();
      } catch (error) {
        lastError = error;
        const shouldRetry = this.isRetryableNetworkError(error) && attempt < NETWORK_RETRY_MAX_ATTEMPTS;
        if (!shouldRetry) {
          throw error;
        }

        const backoffMs = Math.max(this.minIntervalMs, NETWORK_RETRY_BASE_DELAY_MS * attempt);
        const reason = error instanceof Error ? error.message : String(error ?? "unknown error");
        console.warn(`[HKJC GraphQL] ${label} failed (attempt ${attempt}/${NETWORK_RETRY_MAX_ATTEMPTS}): ${reason}`);
        await sleep(backoffMs);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`[HKJC GraphQL] ${label} failed after retries.`);
  }

  private async preflight(): Promise<void> {
    await this.withNetworkRetry("preflight", async () => {
      await fetch(this.endpoint, {
        method: "OPTIONS",
        headers: {
          origin: "https://bet.hkjc.com",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type"
        }
      });
    });
  }

  private async postGraphql(
    query: string,
    variables: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return this.withNetworkRetry("postGraphql", async () => {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "accept-language": "zh-HK,zh;q=0.9,en;q=0.8",
          referer: this.referer,
          origin: "https://bet.hkjc.com",
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
        },
        body: JSON.stringify({
          query,
          variables
        })
      });

      if (!response.ok) {
        throw new Error(`HKJC GraphQL request failed with status ${response.status}`);
      }

      return (await response.json()) as Record<string, unknown>;
    });
  }

  private configuredOddsTypes(): string[] {
    const rawOddsTypes = [
      ...(((this.variables.fbOddsTypes as string[] | undefined) ?? []) as string[]),
      ...(((this.variables.fbOddsTypesM as string[] | undefined) ?? []) as string[])
    ];

    const usable = uniqueStrings(rawOddsTypes).filter((oddsType) => !DEPRECATED_FOOTBALL_ODDS_TYPES.has(oddsType));
    return usable.length > 0 ? usable : [...DEFAULT_FOOTBALL_ODDS_TYPES];
  }

  private buildVariablesForOddsBatch(matchIds: string[], oddsTypes: string[]): Record<string, unknown> {
    return {
      ...this.variables,
      matchIds,
      // Force by-id backfill to include completed fixtures so settlement can obtain final scores.
      showAllMatch: true,
      earlySettlementOnly: false,
      inplayOnly: false,
      fbOddsTypes: oddsTypes,
      fbOddsTypesM: oddsTypes
    };
  }

  private mergeMatches(base: Array<Record<string, unknown>>, incoming: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    return mergeHkjcMatches(base, incoming);
  }

  private extractMatches(payload: Record<string, unknown>): Array<Record<string, unknown>> {
    return extractHkjcMatches(payload);
  }

  private hasUsableMatchIds(variables: Record<string, unknown>): boolean {
    const ids = variables.matchIds;
    return Array.isArray(ids) && ids.length > 0;
  }

  private async discoverMatchIds(): Promise<string[]> {
    const payload = await this.postGraphql(MATCH_ID_DISCOVERY_QUERY, {});
    if (payload.errors) {
      return [];
    }

    const matches = this.extractMatches(payload);
    return matches
      .map((match) => String(match.id ?? "").trim())
      .filter((id) => id.length > 0);
  }

  private async fetchDetailedMatchesByIds(matchIds: string[]): Promise<Array<Record<string, unknown>>> {
    if (matchIds.length === 0) {
      return [];
    }

    await this.preflight();

    const oddsTypes = this.configuredOddsTypes();
    const oddsTypeBatches: string[][] = [];
    for (let index = 0; index < oddsTypes.length; index += FOOTBALL_ODDS_TYPES_BATCH_SIZE) {
      oddsTypeBatches.push(oddsTypes.slice(index, index + FOOTBALL_ODDS_TYPES_BATCH_SIZE));
    }

    let allMatches: Array<Record<string, unknown>> = [];
    for (let index = 0; index < matchIds.length; index += MATCH_IDS_BATCH_SIZE) {
      const batch = matchIds.slice(index, index + MATCH_IDS_BATCH_SIZE);

      let mergedBatchMatches: Array<Record<string, unknown>> = [];
      for (const oddsTypeBatch of oddsTypeBatches) {
        const payload = await this.postGraphql(this.query, this.buildVariablesForOddsBatch(batch, oddsTypeBatch));
        if (payload.errors) {
          const messages = (payload.errors as Array<{ message?: string }>)
            .map((error) => error.message ?? "Unknown GraphQL error")
            .join(" | ");
          throw new Error(
            `HKJC GraphQL returned errors in detailed matchIds query for oddsTypes ${oddsTypeBatch.join(",")}: ${messages}`
          );
        }

        mergedBatchMatches = this.mergeMatches(mergedBatchMatches, this.extractMatches(payload));
      }

      allMatches = this.mergeMatches(allMatches, mergedBatchMatches);
    }

    return allMatches;
  }

  private async fetchDetailedMatchesWithDiscoveredIds(): Promise<Array<Record<string, unknown>>> {
    const ids = await this.discoverMatchIds();
    if (ids.length === 0) {
      throw new Error("HKJC GraphQL detailed query requires matchIds, but no ids could be discovered.");
    }

    return this.fetchDetailedMatchesByIds(ids);
  }

  async fetchTodayFixtures(): Promise<Fixture[]> {
    if (!this.query.trim()) {
      throw new Error(
        "HKJC GraphQL query is empty. Provide HKJC_GRAPHQL_QUERY from your own authorized browser observation."
      );
    }

    let matches: Array<Record<string, unknown>> = [];

    if (this.hasUsableMatchIds(this.variables)) {
      matches = await this.fetchDetailedMatchesByIds(this.variables.matchIds as string[]);
    } else {
      matches = await this.fetchDetailedMatchesWithDiscoveredIds();
    }

    if (matches.length === 0) {
      throw new Error("HKJC GraphQL returned no match array in data payload.");
    }

    let fixtures = matches.map(toHkjcFixture).filter((item): item is Fixture => item !== null);

    const hasUsableOptions = fixtures.some((fixture) => fixture.marketOptions.length > 0);
    const canRetryWithDiscoveredIds = !this.hasUsableMatchIds(this.variables);
    if (!hasUsableOptions && canRetryWithDiscoveredIds) {
      const detailedMatches = await this.fetchDetailedMatchesWithDiscoveredIds();
      fixtures = detailedMatches.map(toHkjcFixture).filter((item): item is Fixture => item !== null);
    }

    const hasQueryFoPools = this.query.includes("foPools");
    const hasParsedOptions = fixtures.some((fixture) => fixture.marketOptions.length > 0);
    if (!hasParsedOptions && !this.foPoolsCoverageWarned) {
      this.foPoolsCoverageWarned = true;
      const tip = hasQueryFoPools
        ? "Query includes foPools but no options were returned. This request may not be the detailed odds query."
        : "Current query does not include foPools. System is running in HAD fallback mode.";
      console.warn(`[HKJC GraphQL] ${tip}`);
    }

    if (fixtures.length === 0) {
      throw new Error(
        "HKJC GraphQL response has no usable odds data. Please use a detailed query that includes foPools/combinations currentOdds."
      );
    }

    await sleep(this.minIntervalMs);
    return fixtures;
  }

  async fetchFixturesByIds(fixtureIds: string[]): Promise<Fixture[]> {
    const wanted = new Set(fixtureIds.map((id) => String(id).trim()).filter((id) => id.length > 0));
    if (wanted.size === 0) {
      return [];
    }

    const matches = await this.fetchDetailedMatchesByIds([...wanted]);
    return matches
      .map(toHkjcFixture)
      .filter((item): item is Fixture => item !== null)
      .filter((fixture) => wanted.has(fixture.id));
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

export function mergeHkjcMatches(
  base: Array<Record<string, unknown>>,
  incoming: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>();

  for (const match of base) {
    const id = String(match.id ?? "").trim();
    if (!id) {
      continue;
    }
    merged.set(id, { ...match });
  }

  for (const match of incoming) {
    const id = String(match.id ?? "").trim();
    if (!id) {
      continue;
    }

    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, { ...match });
      continue;
    }

    const existingPools = (existing.foPools as unknown[]) ?? [];
    const nextPools = (match.foPools as unknown[]) ?? [];
    merged.set(id, {
      ...existing,
      ...match,
      foPools: [...existingPools, ...nextPools]
    });
  }

  return [...merged.values()];
}

export function extractHkjcMatches(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const data = (payload.data as Record<string, unknown> | undefined) ?? {};
  const candidateArrays = Object.values(data).filter(Array.isArray) as Array<Array<Record<string, unknown>>>;
  return candidateArrays.flat();
}
