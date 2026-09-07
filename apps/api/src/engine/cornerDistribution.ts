export type CountDistribution = "poisson" | "negative-binomial";

export interface GammaPoissonUpdate {
  distribution: "negative-binomial";
  expectedRemaining: number;
  dispersion: number;
  posteriorShape: number;
  posteriorRate: number;
}

export interface LeagueCornerDispersion {
  dispersion: number;
  matches: number;
  source: "football-data.co.uk";
}

const LEAGUE_CORNER_DISPERSION: Record<string, LeagueCornerDispersion> = {
  "scottish premiership": { dispersion: 0.0179, matches: 1140, source: "football-data.co.uk" },
  "蘇格蘭超級聯賽": { dispersion: 0.0179, matches: 1140, source: "football-data.co.uk" },
  "efl championship": { dispersion: 0.0134, matches: 2760, source: "football-data.co.uk" },
  "英格蘭冠軍聯賽": { dispersion: 0.0134, matches: 2760, source: "football-data.co.uk" },
  "ligue 1": { dispersion: 0.0172, matches: 1678, source: "football-data.co.uk" },
  "法國甲組聯賽": { dispersion: 0.0172, matches: 1678, source: "football-data.co.uk" },
  "primeira liga": { dispersion: 0.0223, matches: 1530, source: "football-data.co.uk" },
  "葡萄牙超級聯賽": { dispersion: 0.0223, matches: 1530, source: "football-data.co.uk" },
  eredivisie: { dispersion: 0.0137, matches: 1530, source: "football-data.co.uk" },
  "荷蘭甲組聯賽": { dispersion: 0.0137, matches: 1530, source: "football-data.co.uk" },
  bundesliga: { dispersion: 0.014, matches: 1529, source: "football-data.co.uk" },
  "德國甲組聯賽": { dispersion: 0.014, matches: 1529, source: "football-data.co.uk" },
  "premier league": { dispersion: 0.0109, matches: 1900, source: "football-data.co.uk" },
  "英格蘭超級聯賽": { dispersion: 0.0109, matches: 1900, source: "football-data.co.uk" },
  "la liga": { dispersion: 0.0146, matches: 1900, source: "football-data.co.uk" },
  "西班牙甲組聯賽": { dispersion: 0.0146, matches: 1900, source: "football-data.co.uk" },
  "serie a": { dispersion: 0.024, matches: 1900, source: "football-data.co.uk" },
  "意大利甲組聯賽": { dispersion: 0.024, matches: 1900, source: "football-data.co.uk" }
};

export function leagueCornerDispersion(league: string): LeagueCornerDispersion | null {
  return LEAGUE_CORNER_DISPERSION[league.trim().toLowerCase()] ?? null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function poissonCdf(mean: number, maximum: number): number {
  if (maximum < 0) return 0;
  const safeMean = Math.max(0.001, mean);
  let probability = Math.exp(-safeMean);
  let cumulative = probability;
  for (let value = 1; value <= maximum; value += 1) {
    probability *= safeMean / value;
    cumulative += probability;
  }
  return clamp(cumulative, 0, 1);
}

function negativeBinomialCdf(mean: number, dispersion: number, maximum: number): number {
  if (maximum < 0) return 0;
  const safeMean = Math.max(0.001, mean);
  const safeDispersion = Math.max(0.000001, dispersion);
  const shape = 1 / safeDispersion;
  const successProbability = shape / (shape + safeMean);
  let probability = Math.pow(successProbability, shape);
  let cumulative = probability;
  for (let value = 0; value < maximum; value += 1) {
    probability *= ((value + shape) / (value + 1)) * (1 - successProbability);
    cumulative += probability;
  }
  return clamp(cumulative, 0, 1);
}

export function countOverUnderProbability(input: {
  expectedAdditional: number;
  currentCount: number;
  line: number;
  direction: "over" | "under";
  dispersion?: number;
}): number {
  const maximumUnderAddition = Math.floor(input.line) - input.currentCount;
  const underProbability = input.dispersion && input.dispersion > 0
    ? negativeBinomialCdf(input.expectedAdditional, input.dispersion, maximumUnderAddition)
    : poissonCdf(input.expectedAdditional, maximumUnderAddition);
  const selectedProbability = input.direction === "over" ? 1 - underProbability : underProbability;
  return clamp(selectedProbability, 0.001, 0.999);
}

export function gammaPoissonLiveUpdate(input: {
  baselineFullPeriodMean: number;
  elapsedMinutes: number;
  observedCount: number;
  remainingMinutes: number;
  periodMinutes: number;
  priorExposureMinutes?: number;
}): GammaPoissonUpdate {
  const periodMinutes = Math.max(1, input.periodMinutes);
  const elapsedMinutes = clamp(input.elapsedMinutes, 0, periodMinutes);
  const remainingMinutes = clamp(input.remainingMinutes, 0, periodMinutes);
  const priorExposureMinutes = clamp(input.priorExposureMinutes ?? periodMinutes, 1, periodMinutes * 4);
  const baselineRate = Math.max(0.001, input.baselineFullPeriodMean / periodMinutes);
  const priorShape = baselineRate * priorExposureMinutes;
  const posteriorShape = priorShape + Math.max(0, input.observedCount);
  const posteriorRate = priorExposureMinutes + elapsedMinutes;
  const expectedRemaining = posteriorShape * (remainingMinutes / posteriorRate);

  return {
    distribution: "negative-binomial",
    expectedRemaining,
    dispersion: 1 / posteriorShape,
    posteriorShape,
    posteriorRate
  };
}