import { describe, expect, it } from "vitest";
import { findFotMobMatch, mapFotMobDetail } from "./fotMobLiveDataService.js";

const input = {
  fixtureId: "hkjc-1",
  kickoffAt: "2026-09-03T02:00:00.000Z",
  homeTeamEn: "Vancouver Whitecaps FC",
  awayTeamEn: "CF Montreal"
};

describe("FotMob live-data mapping", () => {
  it("matches the same teams and kickoff without accepting a reversed fixture", () => {
    const matched = findFotMobMatch(input, {
      leagues: [{ matches: [{
        id: 101,
        home: { name: "Vancouver Whitecaps" },
        away: { name: "CF Montréal" },
        status: { utcTime: "2026-09-03T02:00:00.000Z" }
      }, {
        id: 102,
        home: { name: "CF Montréal" },
        away: { name: "Vancouver Whitecaps" },
        status: { utcTime: "2026-09-03T02:00:00.000Z" }
      }] }]
    });

    expect(matched?.id).toBe(101);
  });

  it("maps official minute, scores, half-time score and corners", () => {
    const detail = mapFotMobDetail(input, {
      general: {
        leagueName: "Canadian Championship",
        homeTeam: { name: "Vancouver Whitecaps" },
        awayTeam: { name: "CF Montréal" }
      },
      header: {
        status: {
          utcTime: "2026-09-03T02:00:00.000Z",
          started: true,
          ongoing: true,
          liveTime: { short: "63’", long: "62:50" }
        },
        teams: [{ name: "Vancouver Whitecaps", score: 0 }, { name: "CF Montréal", score: 1 }]
      },
      content: {
        stats: {
          Periods: {
            All: { stats: [{ stats: [{ key: "corners", title: "Corners", stats: [6, 1] }] }] },
            FirstHalf: { stats: [{ stats: [{ key: "corners", title: "Corners", stats: [3, 1] }] }] }
          }
        },
        matchFacts: {
          events: { events: [{ type: "Half", halfStrShort: "HT", homeScore: 0, awayScore: 1 }] }
        }
      }
    });

    expect(detail).toMatchObject({
      fixtureId: "hkjc-1",
      status: "LIVE",
      liveMinute: 63,
      halfTimeScore: { home: 0, away: 1 },
      finalScore: { home: 0, away: 1 },
      finalCorners: { home: 6, away: 1, total: 7 }
    });
  });

  it("maps a completed match as finished for settlement", () => {
    expect(mapFotMobDetail(input, {
      header: {
        status: { finished: true, scoreStr: "2 - 1" },
        teams: [{ name: "Vancouver Whitecaps", score: 2 }, { name: "CF Montréal", score: 1 }]
      }
    })).toMatchObject({ status: "FINISHED", finalScore: { home: 2, away: 1 } });
  });

  it("maps confirmed starters only when both team lineups are present", () => {
    const detail = mapFotMobDetail(input, {
      content: {
        lineup: {
          homeTeam: { starters: [{ name: "Home Keeper", positionId: 11, usualPlayingPositionId: 3 }] },
          awayTeam: { starters: [{ name: "Away Forward", positionId: 73 }] }
        }
      }
    });

    expect(detail.lineup).toMatchObject({
      confirmed: true,
      home: [{ name: "Home Keeper", role: "GK", fitness: 75, recentForm: 75 }],
      away: [{ name: "Away Forward", role: "FW", fitness: 75, recentForm: 75 }]
    });
  });
});