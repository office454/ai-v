import { describe, expect, it, vi } from "vitest";
import type { CanonicalMatch, Match } from "@bigballsdata/sdk";
import { fetchBigBallLiveDataByMatchInfo, findBigBallMatch, mapBigBallDetail } from "./bigBallLiveDataService.js";

const input = {
  fixtureId: "hkjc-1",
  kickoffAt: "2026-09-08T19:00:00.000Z",
  homeTeamEn: "Arsenal FC",
  awayTeamEn: "Liverpool"
};

const match: CanonicalMatch = {
  id: "bb_match_abcdefghij",
  sport: "football",
  league_id: "bb_league_abcdefghij",
  start_time: input.kickoffAt,
  status: "in_progress",
  home: { team_id: "bb_team_arsenal000", team_name: "Arsenal" },
  away: { team_id: "bb_team_liverpool0", team_name: "Liverpool FC" },
  updated_at: input.kickoffAt
};

function envelope<T>(value: T) {
  return { value, source: "official-league", via: "api" as const, confidence: 0.95, fetchedAt: input.kickoffAt, ttlSeconds: 60 };
}

describe("BigBall live-data mapping", () => {
  it("requires the same home and away sides within the kickoff tolerance", () => {
    const reversed = { ...match, id: "bb_match_reversed00", home: match.away, away: match.home };
    expect(findBigBallMatch(input, [reversed, match])).toEqual(match);
    expect(findBigBallMatch(input, [reversed])).toBeNull();
    expect(findBigBallMatch(input, [{ ...match, start_time: "2026-09-09T13:01:00.000Z" }])).toBeNull();
  });

  it("maps canonical scores, corners, pressure and team-attributed lineups", () => {
    const detail: Match = {
      scores: envelope([{
        match_id: match.id,
        home: 1,
        away: 0,
        status: "in_progress",
        period_scores: [{ period: 1, label: "1st Half", home: 0, away: 0 }],
        clock: { elapsed_seconds: 4020, period: 2 },
        updated_at: input.kickoffAt
      }]),
      stats: envelope([
        { match_id: match.id, team_id: match.home.team_id, metric: "corners", value: 6, unit: "count", updated_at: input.kickoffAt },
        { match_id: match.id, team_id: match.away.team_id, metric: "corners", value: 3, unit: "count", updated_at: input.kickoffAt },
        { match_id: match.id, team_id: match.home.team_id, metric: "possession_percent", value: 58, unit: "percent", updated_at: input.kickoffAt },
        { match_id: match.id, team_id: match.away.team_id, metric: "possession_percent", value: 42, unit: "percent", updated_at: input.kickoffAt }
      ]),
      events: envelope([
        { id: "bb_event_yellow000", match_id: match.id, sequence: 1, clock: { elapsed_seconds: 1200, period: 1 }, type: "card_yellow", team_id: match.home.team_id },
        { id: "bb_event_red000000", match_id: match.id, sequence: 2, clock: { elapsed_seconds: 3600, period: 2 }, type: "card_red", team_id: match.away.team_id },
        { id: "bb_event_sub000000", match_id: match.id, sequence: 3, clock: { elapsed_seconds: 3900, period: 2 }, type: "substitution", team_id: match.home.team_id }
      ]),
      lineups: envelope([
        { id: "bb_player_home0000", sport: "football", full_name: "Home Keeper", display_name: "Home Keeper", current_team_id: match.home.team_id, position: "Goalkeeper" },
        { id: "bb_player_away0000", sport: "football", full_name: "Away Forward", display_name: "Away Forward", current_team_id: match.away.team_id, position: "Forward" }
      ])
    };

    expect(mapBigBallDetail(input, match, detail)).toMatchObject({
      liveMinute: 67,
      finalScore: { home: 1, away: 0 },
      halfTimeScore: { home: 0, away: 0 },
      finalCorners: { home: 6, away: 3, total: 9 },
      liveAttackingMetrics: { source: "BigBall", possession: { home: 58, away: 42 } },
      livePressureMetrics: {
        source: "BigBall",
        yellowCards: { home: 1, away: 0 },
        redCards: { home: 0, away: 1 },
        substitutions: { home: 1, away: 0 }
      },
      lineup: {
        confirmed: true,
        home: [{ name: "Home Keeper", role: "GK" }],
        away: [{ name: "Away Forward", role: "FW" }]
      }
    });
  });

  it("uses the SDK list and detail methods without requesting odds", async () => {
    const list = vi.fn().mockResolvedValue({ data: [match], meta: {}, error: null });
    const get = vi.fn().mockResolvedValue({ data: {}, meta: {}, error: null });
    const detail = await fetchBigBallLiveDataByMatchInfo(input, { matches: { list, get } } as never);

    expect(detail?.fixtureId).toBe(input.fixtureId);
    expect(list).toHaveBeenCalledWith({ sport: "football", date: "2026-09-08", limit: 100 });
    expect(get).toHaveBeenCalledWith(match.id, ["scores", "stats", "events", "lineups"], "football");
  });
});