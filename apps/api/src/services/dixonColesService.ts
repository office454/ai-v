import type { HistoricalFeatureRow } from "./historicalFeatureService.js";

type ProbabilityVector = { home: number; draw: number; away: number };
type TeamParameters = { attack: number; defence: number };

export type DixonColesLeagueParameters = {
  league: string;
  fittedThrough: string;
  trainingRows: number;
  teams: number;
  halfLifeDays: number;
  intercept: number;
  homeAdvantage: number;
  rho: number;
  teamParameters: Record<string, TeamParameters>;
};

export type DixonColesModel = {
  halfLifeDays: number;
  leagues: Record<string, DixonColesLeagueParameters>;
};

export type DixonColesFitOptions = {
  halfLifeDays?: number;
  epochs?: number;
  learningRate?: number;
  regularization?: number;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function poissonMass(goals: number, expectedGoals: number): number {
  let factorial = 1;
  for (let value = 2; value <= goals; value += 1) factorial *= value;
  return Math.exp(-expectedGoals) * expectedGoals ** goals / factorial;
}

function lowScoreAdjustment(homeGoals: number, awayGoals: number, homeExpected: number, awayExpected: number, rho: number): number {
  if (homeGoals === 0 && awayGoals === 0) return 1 - homeExpected * awayExpected * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + homeExpected * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + awayExpected * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

function expectedGoals(parameters: DixonColesLeagueParameters, homeTeam: string, awayTeam: string): [number, number] {
  const home = parameters.teamParameters[homeTeam] ?? { attack: 0, defence: 0 };
  const away = parameters.teamParameters[awayTeam] ?? { attack: 0, defence: 0 };
  return [
    clamp(Math.exp(parameters.intercept + parameters.homeAdvantage + home.attack + away.defence), 0.05, 6),
    clamp(Math.exp(parameters.intercept + away.attack + home.defence), 0.05, 6)
  ];
}

function fitLeague(rows: HistoricalFeatureRow[], options: Required<DixonColesFitOptions>): DixonColesLeagueParameters {
  const sorted = [...rows].sort((left, right) => left.kickoffAt.localeCompare(right.kickoffAt));
  const fittedThrough = sorted[sorted.length - 1].kickoffAt;
  const referenceTime = Date.parse(fittedThrough);
  const teams = [...new Set(sorted.flatMap((row) => [row.homeTeam, row.awayTeam]))].sort();
  const teamParameters = Object.fromEntries(teams.map((team) => [team, { attack: 0, defence: 0 }]));
  const homeGoalsMean = sorted.reduce((sum, row) => sum + row.target.homeGoals, 0) / sorted.length;
  const awayGoalsMean = sorted.reduce((sum, row) => sum + row.target.awayGoals, 0) / sorted.length;
  let intercept = Math.log(clamp(awayGoalsMean, 0.2, 4));
  let homeAdvantage = Math.log(clamp(homeGoalsMean / Math.max(0.2, awayGoalsMean), 0.7, 2));
  const weights = sorted.map((row) => {
    const ageDays = Math.max(0, (referenceTime - Date.parse(row.kickoffAt)) / 86_400_000);
    return Math.exp(-Math.LN2 * ageDays / options.halfLifeDays);
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const teamWeights = Object.fromEntries(teams.map((team) => [team, 0])) as Record<string, number>;
  for (let index = 0; index < sorted.length; index += 1) {
    teamWeights[sorted[index].homeTeam] += weights[index];
    teamWeights[sorted[index].awayTeam] += weights[index];
  }

  for (let epoch = 0; epoch < options.epochs; epoch += 1) {
    const attackGradients = Object.fromEntries(teams.map((team) => [team, 0])) as Record<string, number>;
    const defenceGradients = Object.fromEntries(teams.map((team) => [team, 0])) as Record<string, number>;
    let interceptGradient = 0;
    let homeGradient = 0;
    for (let index = 0; index < sorted.length; index += 1) {
      const row = sorted[index];
      const weight = weights[index];
      const parameters = {
        league: row.league,
        fittedThrough,
        trainingRows: sorted.length,
        teams: teams.length,
        halfLifeDays: options.halfLifeDays,
        intercept,
        homeAdvantage,
        rho: 0,
        teamParameters
      };
      const [homeExpected, awayExpected] = expectedGoals(parameters, row.homeTeam, row.awayTeam);
      const homeError = weight * (row.target.homeGoals - homeExpected);
      const awayError = weight * (row.target.awayGoals - awayExpected);
      attackGradients[row.homeTeam] += homeError;
      defenceGradients[row.awayTeam] += homeError;
      attackGradients[row.awayTeam] += awayError;
      defenceGradients[row.homeTeam] += awayError;
      interceptGradient += homeError + awayError;
      homeGradient += homeError;
    }
    const rate = options.learningRate / Math.sqrt(epoch + 1);
    intercept += rate * interceptGradient / totalWeight;
    homeAdvantage += rate * homeGradient / totalWeight;
    for (const team of teams) {
      const exposure = Math.max(1, teamWeights[team]);
      teamParameters[team].attack += rate * (
        attackGradients[team] / exposure - options.regularization * teamParameters[team].attack
      );
      teamParameters[team].defence += rate * (
        defenceGradients[team] / exposure - options.regularization * teamParameters[team].defence
      );
    }
    const attackMean = teams.reduce((sum, team) => sum + teamParameters[team].attack, 0) / teams.length;
    for (const team of teams) {
      teamParameters[team].attack -= attackMean;
      teamParameters[team].defence += attackMean;
    }
  }

  const baseParameters: DixonColesLeagueParameters = {
    league: sorted[0].league,
    fittedThrough,
    trainingRows: sorted.length,
    teams: teams.length,
    halfLifeDays: options.halfLifeDays,
    intercept,
    homeAdvantage,
    rho: 0,
    teamParameters
  };
  let bestRho = 0;
  let bestLikelihood = Number.NEGATIVE_INFINITY;
  for (let candidate = -0.15; candidate <= 0.150001; candidate += 0.005) {
    let likelihood = 0;
    for (let index = 0; index < sorted.length; index += 1) {
      const row = sorted[index];
      const [homeExpected, awayExpected] = expectedGoals(baseParameters, row.homeTeam, row.awayTeam);
      const adjustment = lowScoreAdjustment(
        row.target.homeGoals,
        row.target.awayGoals,
        homeExpected,
        awayExpected,
        candidate
      );
      likelihood += weights[index] * Math.log(Math.max(adjustment, 1e-9));
    }
    if (likelihood > bestLikelihood) {
      bestLikelihood = likelihood;
      bestRho = candidate;
    }
  }
  return { ...baseParameters, rho: Number(bestRho.toFixed(3)) };
}

export function fitDixonColesModel(rows: HistoricalFeatureRow[], fitOptions: DixonColesFitOptions = {}): DixonColesModel {
  const options: Required<DixonColesFitOptions> = {
    halfLifeDays: Math.max(30, fitOptions.halfLifeDays ?? 365),
    epochs: Math.max(1, fitOptions.epochs ?? 250),
    learningRate: fitOptions.learningRate ?? 0.08,
    regularization: fitOptions.regularization ?? 0.02
  };
  const grouped = new Map<string, HistoricalFeatureRow[]>();
  for (const row of rows) grouped.set(row.league, [...(grouped.get(row.league) ?? []), row]);
  return {
    halfLifeDays: options.halfLifeDays,
    leagues: Object.fromEntries([...grouped].map(([league, leagueRows]) => [league, fitLeague(leagueRows, options)]))
  };
}

export function predictDixonColes(model: DixonColesModel, row: HistoricalFeatureRow): ProbabilityVector {
  const parameters = model.leagues[row.league];
  if (!parameters) return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  const [homeExpected, awayExpected] = expectedGoals(parameters, row.homeTeam, row.awayTeam);
  const output = { home: 0, draw: 0, away: 0 };
  for (let homeGoals = 0; homeGoals <= 10; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 10; awayGoals += 1) {
      const probability = poissonMass(homeGoals, homeExpected)
        * poissonMass(awayGoals, awayExpected)
        * lowScoreAdjustment(homeGoals, awayGoals, homeExpected, awayExpected, parameters.rho);
      if (homeGoals > awayGoals) output.home += probability;
      else if (homeGoals === awayGoals) output.draw += probability;
      else output.away += probability;
    }
  }
  const total = output.home + output.draw + output.away;
  return { home: output.home / total, draw: output.draw / total, away: output.away / total };
}