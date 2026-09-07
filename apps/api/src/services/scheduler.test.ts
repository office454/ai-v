import { describe, expect, it } from "vitest";
import { autoApplicableThresholds } from "./scheduler.js";

describe("autoApplicableThresholds", () => {
  it("keeps the user-controlled minimum odds out of scheduled AI updates", () => {
    expect(autoApplicableThresholds({
      minRecommendedOdds: 2.4,
      highOddsThreshold: 3.4,
      highOddsMinEdgeScore: 6,
      highOddsMinValueScore: 0.25
    })).toEqual({
      highOddsThreshold: 3.4,
      highOddsMinEdgeScore: 6,
      highOddsMinValueScore: 0.25
    });
  });
});