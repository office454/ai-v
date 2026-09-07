import { describe, expect, it } from "vitest";
import { findHighlightlyMatch, mapHighlightlyDetail } from "./highlightlyLiveDataService.js";

const input = {
  fixtureId: "hkjc-1",
  kickoffAt: "2026-09-07T12:00:00.000Z",
  homeTeamEn: "Manchester United",
  awayTeamEn: "Liverpool FC"
};

const match = {
  id: 101,
  date: "2026-09-07T12:00:00.000Z",
  homeTeam: { id: 1, name: "Manchester United FC" },
  awayTeam: { id: 2, name: "Liverpool" },
  league: { name: "Premier League" },
  state: {
    description: "Second half",
    minute: "67",
    score: { current: { home: 1, away: 0 }, halfTime: { home: 0, away: 0 } }
  }
};

describe("Highlightly live-data mapping", () => {
  it("matches exact sides and kickoff without accepting a reversed fixture", () => {
    const reversed = { ...match, id: 102, homeTeam: match.awayTeam, awayTeam: match.homeTeam };
    expect(findHighlightlyMatch(input, { data: [reversed, match] })).toEqual(match);
    expect(findHighlightlyMatch(input, { data: [reversed] })).toBeNull();
    expect(findHighlightlyMatch(input, { data: [{ ...match, date: "2026-09-08T12:01:00.000Z" }] })).toBeNull();
  });

  it("maps scores, official minute, bilateral statistics, events and lineups", () => {
    const statistics = [{
      team: match.homeTeam,
      statistics: [
        { name: "Corner Kicks", value: 6 },
        { name: "Ball Possession", value: "58%" },
        { name: "Total Crosses", value: 18 }
      ]
    }, {
      team: match.awayTeam,
      statistics: [
        { name: "Corner Kicks", value: 3 },
        { name: "Ball Possession", value: "42%" },
        { name: "Total Crosses", value: 11 }
      ]
    }];
    const events = [
      { team: match.homeTeam, type: "Yellow Card" },
      { team: match.awayTeam, type: "Red Card" },
      { team: match.homeTeam, type: "Substitution" },
      { type: "Yellow Card" }
    ];
    const lineup = {
      homeTeam: { initialLineup: [{ player: { name: "Home Keeper" }, position: "Goalkeeper" }] },
      awayTeam: { initialLineup: [{ player: { name: "Away Forward" }, position: "Forward" }] }
    };

    expect(mapHighlightlyDetail(input, match, statistics, events, lineup)).toMatchObject({
      fixtureId: "hkjc-1",
      league: "Premier League",
      status: "Second half",
      liveMinute: 67,
      finalScore: { home: 1, away: 0 },
      halfTimeScore: { home: 0, away: 0 },
      finalCorners: { home: 6, away: 3, total: 9 },
      liveAttackingMetrics: {
        source: "Highlightly",
        possession: { home: 58, away: 42 },
        crosses: { home: 18, away: 11 }
      },
      livePressureMetrics: {
        source: "Highlightly",
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

  it("does not create a bilateral metric when either team value is missing", () => {
    const statistics = [{ team: match.homeTeam, statistics: [{ name: "Dangerous Attacks", value: 30 }] }];
    const detail = mapHighlightlyDetail(input, match, statistics, [], undefined);
    expect(detail.liveAttackingMetrics).toBeUndefined();
    expect(detail.livePressureMetrics).toBeUndefined();
  });
});