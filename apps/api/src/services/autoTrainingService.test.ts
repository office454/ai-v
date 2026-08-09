import { describe, expect, it } from "vitest";
import type { Fixture } from "../types.js";
import { toFocusedTrainingFixture } from "./autoTrainingService.js";

function sampleFixture(): Fixture {
  return {
    id: "fx-1",
    league: "Test",
    kickoffAt: "2026-07-16T12:00:00.000Z",
    homeTeam: "A",
    awayTeam: "B",
    homeStrength: "average",
    awayStrength: "average",
    homeRecentPoints: 8,
    awayRecentPoints: 7,
    expertSentiment: 0.1,
    lineup: {
      confirmed: true,
      updatedAt: "2026-07-16T10:00:00.000Z",
      home: [
        { name: "h1", role: "F", fitness: 80, recentForm: 75 },
        { name: "h2", role: "M", fitness: 78, recentForm: 70 }
      ],
      away: [
        { name: "a1", role: "F", fitness: 77, recentForm: 72 },
        { name: "a2", role: "M", fitness: 76, recentForm: 71 }
      ]
    },
    oddsHistory: [
      { at: "2026-07-16T09:00:00.000Z", homeWin: 1.9, draw: 3.2, awayWin: 3.8 },
      { at: "2026-07-16T11:00:00.000Z", homeWin: 1.88, draw: 3.25, awayWin: 3.9 }
    ],
    marketOptions: [
      {
        oddsType: "HDC",
        oddsTypeName: "讓球",
        selectionCode: "H",
        selectionName: "主隊勝",
        lineCondition: "-0.5",
        currentOdds: 1.86,
        inplay: false,
        poolStatus: "sell",
        combinationStatus: "sell",
        updatedAt: "2026-07-16T11:00:00.000Z"
      },
      {
        oddsType: "HIL",
        oddsTypeName: "入球大細",
        selectionCode: "O",
        selectionName: "大",
        lineCondition: "2.5",
        currentOdds: 1.9,
        inplay: false,
        poolStatus: "sell",
        combinationStatus: "sell",
        updatedAt: "2026-07-16T11:00:00.000Z"
      },
      {
        oddsType: "TTG",
        oddsTypeName: "總入球",
        selectionCode: "3+",
        selectionName: "3+",
        lineCondition: "",
        currentOdds: 1.95,
        inplay: false,
        poolStatus: "sell",
        combinationStatus: "sell",
        updatedAt: "2026-07-16T11:00:00.000Z"
      }
    ]
  };
}

describe("toFocusedTrainingFixture", () => {
  it("keeps only asian handicap, 1x2, and over-under options", () => {
    const focused = toFocusedTrainingFixture(sampleFixture(), 1.4);

    expect(focused).not.toBeNull();
    expect(focused?.marketOptions.map((option) => option.oddsType)).toEqual(["HDC", "HIL"]);
  });

  it("returns null when no focused market meets min odds", () => {
    const fixture = sampleFixture();
    fixture.marketOptions = fixture.marketOptions.map((option) => ({
      ...option,
      currentOdds: option.oddsType === "TTG" ? 1.95 : 1.3
    }));

    const focused = toFocusedTrainingFixture(fixture, 1.4);
    expect(focused).toBeNull();
  });
});
