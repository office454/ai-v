import type { Fixture } from "../types.js";

const HKJC_GRAPHQL_ENDPOINT = "https://info.cld.hkjc.com/graphql/base/";
const HKJC_REFERER = "https://bet.hkjc.com/ch/football/results";

type HkjcResultsQueryOptions = {
  startDate?: string | null;
  endDate?: string | null;
  startIndex?: number | null;
  endIndex?: number | null;
  teamId?: string | null;
};

export type HkjcResultDetail = {
  fixtureId: string;
  halfTimeScore?: {
    home: number;
    away: number;
  };
  finalScore?: {
    home: number;
    away: number;
  };
  finalCorners?: {
    home: number;
    away: number;
    total: number;
  };
};

function normalizeDateInput(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }

  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    return null;
  }

  const date = new Date(ms);
  const yyyy = date.getUTCFullYear();
  const mm = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getUTCDate()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const MATCH_RESULTS_QUERY = `
  query matchResults($startDate: String, $endDate: String, $startIndex: Int, $endIndex: Int, $teamId: String) {
    timeOffset {
      fb
    }
    matchNumByDate(startDate: $startDate, endDate: $endDate, teamId: $teamId) {
      total
    }
    matches: matchResult(startDate: $startDate, endDate: $endDate, startIndex: $startIndex, endIndex: $endIndex, teamId: $teamId) {
      id
      status
      frontEndId
      matchDayOfWeek
      matchNumber
      matchDate
      kickOffTime
      sequence
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
        code
        name_en
        name_ch
      }
      results {
        homeResult
        awayResult
        ttlCornerResult
        resultConfirmType
        payoutConfirmed
        stageId
        resultType
        sequence
      }
      poolInfo {
        payoutRefundPools
        refundPools
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
    }
  }
`;

// Keep this query shape aligned with the HKJC results page implementation.
const MATCH_RESULT_DETAILS_QUERY = `
  query matchResultDetails($matchId: String, , $fbOddsTypes: [FBOddsType]! ) {
    matches: matchResult(matchId: $matchId) {
      id
      foPools(fbOddsTypes: $fbOddsTypes, resultOnly: true) {
        id
        status
        oddsType
        instNo
        name_ch
        name_en
        lines(resultOnly: true) {
          combinations {
            str
            status
            winOrd
            selections {
              selId
              str
              name_ch
              name_en
            }
          }
        }
      }
      additionalResults {
        resSetId
        results {
          awayResult
          homeResult
          ttlCornerResult
          mask
          payoutConfirmed
          resultConfirmType
          resultType
          sequence
          stageId
        }
      }
    }
  }
`;

const DETAIL_QUERY_ODDS_TYPES = [
  "HAD",
  "HDC",
  "HIL",
  "CHL",
  "CHD",
  "CHH",
  "CHA",
  "FCH",
  "FHC",
  "CFH",
  "CFA",
  "NTS",
  "OOE",
  "TTG"
] as const;

function toKickoffIso(matchDate: unknown, kickOffTime: unknown): string {
  const dateRaw = String(matchDate ?? "").trim();
  const timeRaw = String(kickOffTime ?? "").trim();

  if (timeRaw.includes("T")) {
    const parsed = Date.parse(timeRaw);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  const date = dateRaw.replace(/-/g, "");

  if (!/^\d{8}$/.test(date) || !/^\d{2}:\d{2}$/.test(timeRaw)) {
    return new Date().toISOString();
  }

  const yyyy = date.slice(0, 4);
  const mm = date.slice(4, 6);
  const dd = date.slice(6, 8);
  return `${yyyy}-${mm}-${dd}T${timeRaw}:00+08:00`;
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isFinishedStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return ["ft", "finished", "result", "ended", "closed"].some((token) => normalized.includes(token));
}

function pickFinalResult(results: unknown): Record<string, unknown> | null {
  const items = Array.isArray(results) ? results : [];
  const preferred = items.filter((item): item is Record<string, unknown> => {
    if (typeof item !== "object" || item === null) {
      return false;
    }

    return numberOrNull(item.resultType) === 1 && numberOrNull(item.homeResult) !== null && numberOrNull(item.awayResult) !== null;
  });
  const candidates = (preferred.length > 0 ? preferred : items)
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .filter((item) => numberOrNull(item.homeResult) !== null && numberOrNull(item.awayResult) !== null)
    .sort((left, right) => {
      const leftStage = numberOrNull(left.stageId) ?? -1;
      const rightStage = numberOrNull(right.stageId) ?? -1;
      if (leftStage !== rightStage) {
        return leftStage - rightStage;
      }

      const leftSequence = numberOrNull(left.sequence) ?? -1;
      const rightSequence = numberOrNull(right.sequence) ?? -1;
      return leftSequence - rightSequence;
    });

  return candidates.at(-1) ?? null;
}

function pickHalfTimeResult(results: unknown): Record<string, unknown> | null {
  const items = Array.isArray(results) ? results : [];
  const candidates = items
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .filter((item) => numberOrNull(item.resultType) === 1)
    .filter((item) => numberOrNull(item.stageId) === 3)
    .filter((item) => numberOrNull(item.homeResult) !== null && numberOrNull(item.awayResult) !== null)
    .sort((left, right) => {
      const leftSequence = numberOrNull(left.sequence) ?? -1;
      const rightSequence = numberOrNull(right.sequence) ?? -1;
      return leftSequence - rightSequence;
    });

  return candidates.at(-1) ?? null;
}

function pickFinalCornerResult(results: unknown): Record<string, unknown> | null {
  const items = Array.isArray(results) ? results : [];
  const candidates = items
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .filter((item) => numberOrNull(item.resultType) === 2)
    .filter((item) => numberOrNull(item.homeResult) !== null && numberOrNull(item.awayResult) !== null)
    .sort((left, right) => {
      const leftStage = numberOrNull(left.stageId) ?? -1;
      const rightStage = numberOrNull(right.stageId) ?? -1;
      if (leftStage !== rightStage) {
        return leftStage - rightStage;
      }

      const leftSequence = numberOrNull(left.sequence) ?? -1;
      const rightSequence = numberOrNull(right.sequence) ?? -1;
      return leftSequence - rightSequence;
    });

  return candidates.at(-1) ?? null;
}

function pickHalfTimeFromAdditionalResults(results: unknown): Record<string, unknown> | null {
  const items = Array.isArray(results) ? results : [];
  const candidates = items
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .filter((item) => !item.mask)
    .filter((item) => numberOrNull(item.resultType) === 1)
    .filter((item) => numberOrNull(item.stageId) === 3)
    .filter((item) => numberOrNull(item.homeResult) !== null && numberOrNull(item.awayResult) !== null)
    .sort((left, right) => (numberOrNull(left.sequence) ?? -1) - (numberOrNull(right.sequence) ?? -1));

  return candidates.at(-1) ?? null;
}

function pickFinalScoreFromAdditionalResults(results: unknown): Record<string, unknown> | null {
  const items = Array.isArray(results) ? results : [];
  const candidates = items
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .filter((item) => !item.mask)
    .filter((item) => numberOrNull(item.resultType) === 1)
    .filter((item) => numberOrNull(item.homeResult) !== null && numberOrNull(item.awayResult) !== null)
    .sort((left, right) => {
      const leftStage = numberOrNull(left.stageId) ?? -1;
      const rightStage = numberOrNull(right.stageId) ?? -1;
      if (leftStage !== rightStage) {
        return leftStage - rightStage;
      }

      return (numberOrNull(left.sequence) ?? -1) - (numberOrNull(right.sequence) ?? -1);
    });

  return candidates.at(-1) ?? null;
}

function pickFinalCornerFromAdditionalResults(results: unknown): Record<string, unknown> | null {
  const items = Array.isArray(results) ? results : [];
  const candidates = items
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .filter((item) => !item.mask)
    .filter((item) => numberOrNull(item.resultType) === 2)
    .filter((item) => numberOrNull(item.homeResult) !== null && numberOrNull(item.awayResult) !== null)
    .sort((left, right) => {
      const leftStage = numberOrNull(left.stageId) ?? -1;
      const rightStage = numberOrNull(right.stageId) ?? -1;
      if (leftStage !== rightStage) {
        return leftStage - rightStage;
      }

      return (numberOrNull(left.sequence) ?? -1) - (numberOrNull(right.sequence) ?? -1);
    });

  return candidates.at(-1) ?? null;
}

export async function fetchHkjcResultFixtures(): Promise<Fixture[]> {
  return fetchHkjcResultFixturesWithOptions();
}

export async function fetchHkjcResultFixturesWithOptions(options: HkjcResultsQueryOptions = {}): Promise<Fixture[]> {
  const startDate = normalizeDateInput(options.startDate);
  const endDate = normalizeDateInput(options.endDate);
  const response = await fetch(HKJC_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "accept-language": "zh-HK,zh;q=0.9,en;q=0.8",
      referer: HKJC_REFERER,
      origin: "https://bet.hkjc.com"
    },
    body: JSON.stringify({
      query: MATCH_RESULTS_QUERY,
      variables: {
        variables: {
          startDate,
          endDate,
          startIndex: options.startIndex ?? null,
          endIndex: options.endIndex ?? null,
          teamId: options.teamId ?? null
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`HKJC matchResult query failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: {
      matches?: Array<Record<string, unknown>>;
    };
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors?.length) {
    const message = payload.errors.map((error) => error.message ?? "Unknown GraphQL error").join(" | ");
    throw new Error(`HKJC matchResult query returned errors: ${message}`);
  }

  const matches = payload.data?.matches ?? [];
  const fixtures: Fixture[] = [];

  for (const match of matches) {
    const id = String(match.id ?? "").trim();
    const homeTeamEn = String((match.homeTeam as Record<string, unknown> | undefined)?.name_en ?? "").trim() || undefined;
    const awayTeamEn = String((match.awayTeam as Record<string, unknown> | undefined)?.name_en ?? "").trim() || undefined;
    const homeTeam = String((match.homeTeam as Record<string, unknown> | undefined)?.name_ch ?? homeTeamEn ?? "").trim();
    const awayTeam = String((match.awayTeam as Record<string, unknown> | undefined)?.name_ch ?? awayTeamEn ?? "").trim();
    const tournament = (match.tournament as Record<string, unknown> | undefined) ?? {};
    const league = String(tournament.name_ch ?? tournament.name_en ?? "HKJC Football").trim() || "HKJC Football";
    const status = String(match.status ?? "").trim() || "FT";
    if (!isFinishedStatus(status)) {
      continue;
    }

    const finalResult = pickFinalResult(match.results);
    const homeGoals = numberOrNull(finalResult?.homeResult);
    const awayGoals = numberOrNull(finalResult?.awayResult);
    const halfTimeResult = pickHalfTimeResult(match.results);
    const halfHomeGoals = numberOrNull(halfTimeResult?.homeResult);
    const halfAwayGoals = numberOrNull(halfTimeResult?.awayResult);
    const finalCornerResult = pickFinalCornerResult(match.results);
    const homeCorners = numberOrNull(finalCornerResult?.homeResult);
    const awayCorners = numberOrNull(finalCornerResult?.awayResult);
    const totalCornersRaw = numberOrNull(finalCornerResult?.ttlCornerResult);
    const totalCorners =
      totalCornersRaw !== null && totalCornersRaw >= 0
        ? totalCornersRaw
        : homeCorners !== null && awayCorners !== null
          ? homeCorners + awayCorners
          : null;
    if (!id || !homeTeam || !awayTeam || homeGoals === null || awayGoals === null) {
      continue;
    }

    fixtures.push({
      id,
      league,
      kickoffAt: toKickoffIso(match.matchDate, match.kickOffTime),
      status,
      homeTeamEn,
      awayTeamEn,
      halfTimeScore:
        halfHomeGoals !== null && halfAwayGoals !== null
          ? {
              home: halfHomeGoals,
              away: halfAwayGoals
            }
          : undefined,
      finalScore: {
        home: homeGoals,
        away: awayGoals
      },
      finalCorners:
        homeCorners !== null && awayCorners !== null && totalCorners !== null
          ? {
              home: homeCorners,
              away: awayCorners,
              total: totalCorners
            }
          : undefined,
      homeTeam,
      awayTeam,
      homeStrength: "average",
      awayStrength: "average",
      homeRecentPoints: 0,
      awayRecentPoints: 0,
      expertSentiment: 0.5,
      lineup: {
        confirmed: true,
        updatedAt: new Date().toISOString(),
        home: [],
        away: []
      },
      oddsHistory: [],
      marketOptions: []
    });
  }

  return fixtures;
}

export async function fetchHkjcResultDetailByFixtureId(fixtureId: string): Promise<HkjcResultDetail | null> {
  const matchId = String(fixtureId ?? "").trim();
  if (!matchId) {
    return null;
  }

  const response = await fetch(HKJC_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "accept-language": "zh-HK,zh;q=0.9,en;q=0.8",
      referer: HKJC_REFERER,
      origin: "https://bet.hkjc.com"
    },
    body: JSON.stringify({
      query: MATCH_RESULT_DETAILS_QUERY,
      variables: {
        matchId,
        fbOddsTypes: [...DETAIL_QUERY_ODDS_TYPES]
      }
    })
  });

  if (!response.ok) {
    throw new Error(`HKJC matchResultDetails query failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: {
      matches?: Array<Record<string, unknown>>;
    };
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors?.length) {
    const message = payload.errors.map((error) => error.message ?? "Unknown GraphQL error").join(" | ");
    throw new Error(`HKJC matchResultDetails query returned errors: ${message}`);
  }

  const match = payload.data?.matches?.[0];
  if (!match) {
    return null;
  }

  const resultSets = Array.isArray(match.additionalResults)
    ? match.additionalResults
    : [];
  const allResults = resultSets.flatMap((set) => (Array.isArray((set as Record<string, unknown>).results) ? (set as Record<string, unknown>).results as unknown[] : []));

  const halfTime = pickHalfTimeFromAdditionalResults(allResults);
  const final = pickFinalScoreFromAdditionalResults(allResults);
  const corners = pickFinalCornerFromAdditionalResults(allResults);

  const halfHome = numberOrNull(halfTime?.homeResult);
  const halfAway = numberOrNull(halfTime?.awayResult);
  const finalHome = numberOrNull(final?.homeResult);
  const finalAway = numberOrNull(final?.awayResult);
  const cornerHome = numberOrNull(corners?.homeResult);
  const cornerAway = numberOrNull(corners?.awayResult);
  const cornerTotalRaw = numberOrNull(corners?.ttlCornerResult);
  const cornerTotal =
    cornerTotalRaw !== null && cornerTotalRaw >= 0
      ? cornerTotalRaw
      : cornerHome !== null && cornerAway !== null
        ? cornerHome + cornerAway
        : null;

  return {
    fixtureId: matchId,
    halfTimeScore:
      halfHome !== null && halfAway !== null
        ? {
            home: halfHome,
            away: halfAway
          }
        : undefined,
    finalScore:
      finalHome !== null && finalAway !== null
        ? {
            home: finalHome,
            away: finalAway
          }
        : undefined,
    finalCorners:
      cornerHome !== null && cornerAway !== null && cornerTotal !== null
        ? {
            home: cornerHome,
            away: cornerAway,
            total: cornerTotal
          }
        : undefined
  };
}
