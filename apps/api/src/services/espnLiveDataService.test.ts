import { describe, expect, it } from "vitest";
import { mapEspnEventToLiveDetail } from "./espnLiveDataService.js";

const input = {
  fixtureId: "hkjc-1",
  kickoffAt: "2026-08-25T18:00:00.000Z",
  homeTeamEn: "Cardiff City",
  awayTeamEn: "Norwich City"
};

const liveEvent = {
  id: "espn-1",
  date: "2026-08-25T18:00:00.000Z",
  competitions: [{
    status: {
      displayClock: "67'",
      type: { state: "in", completed: false, description: "Second Half" }
    },
    competitors: [{
      homeAway: "home",
      score: "1",
      team: { displayName: "Cardiff City" },
      statistics: [{ name: "cornerKicks", displayValue: "4" }]
    }, {
      homeAway: "away",
      score: "2",
      team: { displayName: "Norwich City" },
      statistics: [{ name: "cornerKicks", displayValue: "6" }]
    }]
  }]
};

describe("mapEspnEventToLiveDetail", () => {
  it("maps a precisely matched live event minute, score and corners", () => {
    expect(mapEspnEventToLiveDetail(input, liveEvent)).toMatchObject({
      fixtureId: "hkjc-1",
      liveMinute: 67,
      finalScore: { home: 1, away: 2 },
      finalCorners: { home: 4, away: 6, total: 10 }
    });
  });

  it("does not treat a scheduled display clock as a live minute", () => {
    const detail = mapEspnEventToLiveDetail(input, {
      ...liveEvent,
      competitions: [{
        ...liveEvent.competitions[0],
        status: { displayClock: "0'", type: { state: "pre", completed: false, description: "Scheduled" } }
      }]
    });

    expect(detail?.liveMinute).toBeUndefined();
  });

  it("rejects reversed teams and distant kickoff times", () => {
    expect(mapEspnEventToLiveDetail({ ...input, homeTeamEn: "Norwich City", awayTeamEn: "Cardiff City" }, liveEvent)).toBeNull();
    expect(mapEspnEventToLiveDetail({ ...input, kickoffAt: "2026-08-27T18:00:00.000Z" }, liveEvent)).toBeNull();
  });
});
