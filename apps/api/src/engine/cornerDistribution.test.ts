import { describe, expect, it } from "vitest";
import {
  countOverUnderProbability,
  gammaPoissonLiveUpdate,
  leagueCornerDispersion
} from "./cornerDistribution.js";

describe("corner count distributions", () => {
  it("keeps over and under probabilities normalized", () => {
    const over = countOverUnderProbability({
      expectedAdditional: 10,
      currentCount: 0,
      line: 9.5,
      direction: "over",
      dispersion: 0.02
    });
    const under = countOverUnderProbability({
      expectedAdditional: 10,
      currentCount: 0,
      line: 9.5,
      direction: "under",
      dispersion: 0.02
    });

    expect(over + under).toBeCloseTo(1, 10);
  });

  it("assigns more probability to a high-count tail when corners are overdispersed", () => {
    const poisson = countOverUnderProbability({
      expectedAdditional: 10,
      currentCount: 0,
      line: 14.5,
      direction: "over"
    });
    const negativeBinomial = countOverUnderProbability({
      expectedAdditional: 10,
      currentCount: 0,
      line: 14.5,
      direction: "over",
      dispersion: 0.02
    });

    expect(negativeBinomial).toBeGreaterThan(poisson);
  });

  it("updates the remaining rate from observed corners without treating a quiet start as permanent", () => {
    const quiet = gammaPoissonLiveUpdate({
      baselineFullPeriodMean: 10,
      elapsedMinutes: 20,
      observedCount: 0,
      remainingMinutes: 75,
      periodMinutes: 95
    });
    const active = gammaPoissonLiveUpdate({
      baselineFullPeriodMean: 10,
      elapsedMinutes: 20,
      observedCount: 5,
      remainingMinutes: 75,
      periodMinutes: 95
    });

    expect(quiet.expectedRemaining).toBeGreaterThan(0);
    expect(quiet.expectedRemaining).toBeLessThan(10 * 75 / 95);
    expect(active.expectedRemaining).toBeGreaterThan(quiet.expectedRemaining);
    expect(active.dispersion).toBeGreaterThan(0);
  });

  it("only returns dispersion for an explicitly calibrated league mapping", () => {
    expect(leagueCornerDispersion("意大利甲組聯賽")).toMatchObject({ dispersion: 0.024, matches: 1900 });
    expect(leagueCornerDispersion("未校準聯賽")).toBeNull();
  });
});