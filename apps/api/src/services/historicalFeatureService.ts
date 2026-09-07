import type { HistoricalMatch, HistoricalOddsSnapshot } from "./historicalDataService.js";

export type RollingTeamMetrics = {
  matches: number;
  pointsPerMatch: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  shotsMatches: number;
  shotsFor: number | null;
  shotsAgainst: number | null;
  shotsOnTargetFor: number | null;
  shotsOnTargetAgainst: number | null;
  cornerMatches: number;
  cornersFor: number | null;
  cornersAgainst: number | null;
};

export type LeagueBaseline = {
  matches: number;
  homeGoals: number | null;
  awayGoals: number | null;
  homeShots: number | null;
  awayShots: number | null;
  homeCorners: number | null;
  awayCorners: number | null;
};

type NormalizedOdds = {
  provider: string;
  decimalHome: number;
  decimalDraw: number;
  decimalAway: number;
  home: number;
  draw: number;
  away: number;
  overround: number;
  over25: number | null;
  under25: number | null;
};

export type HistoricalFeatureRow = {
  key: string;
  source: HistoricalMatch["source"];
  division: string;
  league: string;
  season: string;
  kickoffAt: string;
  homeTeam: string;
  awayTeam: string;
  samples: {
    league: number;
    homeTeam: number;
    awayTeam: number;
    homeVenue: number;
    awayVenue: number;
  };
  rolling: {
    league: LeagueBaseline;
    home: {
      recent5: RollingTeamMetrics;
      recent10: RollingTeamMetrics;
      home10: RollingTeamMetrics;
    };
    away: {
      recent5: RollingTeamMetrics;
      recent10: RollingTeamMetrics;
      away10: RollingTeamMetrics;
    };
  };
  strengths: {
    homeAttack: number | null;
    homeDefence: number | null;
    awayAttack: number | null;
    awayDefence: number | null;
    expectedHomeGoals: number | null;
    expectedAwayGoals: number | null;
    eligible: boolean;
  };
  odds: {
    opening: NormalizedOdds | null;
    closing: NormalizedOdds | null;
    movement: {
      homeProbability: number | null;
      drawProbability: number | null;
      awayProbability: number | null;
      over25Probability: number | null;
    };
  };
  target: {
    homeGoals: number;
    awayGoals: number;
    result: "home" | "draw" | "away";
    totalGoals: number;
  };
};

export type HistoricalFeatureOptions = {
  leagueWindow?: number;
  strengthWindow?: number;
  priorMatches?: number;
  minLeagueMatches?: number;
  minVenueMatches?: number;
};

type TeamAppearance = {
  venue: "home" | "away";
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  shotsFor?: number;
  shotsAgainst?: number;
  shotsOnTargetFor?: number;
  shotsOnTargetAgainst?: number;
  cornersFor?: number;
  cornersAgainst?: number;
};

function mean(values: Array<number | undefined>): number | null {
  const available = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  return available.length === 0 ? null : available.reduce((sum, value) => sum + value, 0) / available.length;
}

function round(value: number | null): number | null {
  return value === null ? null : Number(value.toFixed(6));
}

function summarizeTeam(history: TeamAppearance[], window: number): RollingTeamMetrics {
  const recent = history.slice(-window);
  const shotsMatches = recent.filter((match) => match.shotsFor !== undefined && match.shotsAgainst !== undefined).length;
  const cornerMatches = recent.filter((match) => match.cornersFor !== undefined && match.cornersAgainst !== undefined).length;

  return {
    matches: recent.length,
    pointsPerMatch: round(mean(recent.map((match) => match.points))),
    goalsFor: round(mean(recent.map((match) => match.goalsFor))),
    goalsAgainst: round(mean(recent.map((match) => match.goalsAgainst))),
    shotsMatches,
    shotsFor: round(mean(recent.map((match) => match.shotsFor))),
    shotsAgainst: round(mean(recent.map((match) => match.shotsAgainst))),
    shotsOnTargetFor: round(mean(recent.map((match) => match.shotsOnTargetFor))),
    shotsOnTargetAgainst: round(mean(recent.map((match) => match.shotsOnTargetAgainst))),
    cornerMatches,
    cornersFor: round(mean(recent.map((match) => match.cornersFor))),
    cornersAgainst: round(mean(recent.map((match) => match.cornersAgainst)))
  };
}

function summarizeLeague(history: HistoricalMatch[], window: number): LeagueBaseline {
  const recent = history.slice(-window);
  return {
    matches: recent.length,
    homeGoals: round(mean(recent.map((match) => match.fullTime.home))),
    awayGoals: round(mean(recent.map((match) => match.fullTime.away))),
    homeShots: round(mean(recent.map((match) => match.shots?.home))),
    awayShots: round(mean(recent.map((match) => match.shots?.away))),
    homeCorners: round(mean(recent.map((match) => match.corners?.home))),
    awayCorners: round(mean(recent.map((match) => match.corners?.away)))
  };
}

function normalizedOdds(snapshot: HistoricalOddsSnapshot | undefined): NormalizedOdds | null {
  if (!snapshot) {
    return null;
  }
  const rawHome = 1 / snapshot.home;
  const rawDraw = 1 / snapshot.draw;
  const rawAway = 1 / snapshot.away;
  const overround = rawHome + rawDraw + rawAway;
  const totalsOverround = snapshot.over25 && snapshot.under25
    ? 1 / snapshot.over25 + 1 / snapshot.under25
    : null;

  return {
    provider: snapshot.provider,
    decimalHome: snapshot.home,
    decimalDraw: snapshot.draw,
    decimalAway: snapshot.away,
    home: round(rawHome / overround)!,
    draw: round(rawDraw / overround)!,
    away: round(rawAway / overround)!,
    overround: round(overround)!,
    over25: totalsOverround ? round((1 / snapshot.over25!) / totalsOverround) : null,
    under25: totalsOverround ? round((1 / snapshot.under25!) / totalsOverround) : null
  };
}

function difference(closing: number | null | undefined, opening: number | null | undefined): number | null {
  return closing === null || closing === undefined || opening === null || opening === undefined
    ? null
    : round(closing - opening);
}

function smoothedRate(
  observed: number | null,
  sample: number,
  baseline: number,
  priorMatches: number
): number {
  return ((observed ?? baseline) * sample + baseline * priorMatches) / (sample + priorMatches);
}

function teamKey(league: string, team: string): string {
  return `${league.trim().toLowerCase()}|${team.trim().toLowerCase()}`;
}

function target(match: HistoricalMatch): HistoricalFeatureRow["target"] {
  const { home, away } = match.fullTime;
  return {
    homeGoals: home,
    awayGoals: away,
    result: home > away ? "home" : home < away ? "away" : "draw",
    totalGoals: home + away
  };
}

export function buildLeakageSafeHistoricalFeatures(
  matches: HistoricalMatch[],
  options: HistoricalFeatureOptions = {}
): HistoricalFeatureRow[] {
  const leagueWindow = Math.max(20, options.leagueWindow ?? 380);
  const strengthWindow = Math.max(3, options.strengthWindow ?? 10);
  const priorMatches = Math.max(1, options.priorMatches ?? 5);
  const minLeagueMatches = Math.max(1, options.minLeagueMatches ?? 20);
  const minVenueMatches = Math.max(1, options.minVenueMatches ?? 3);
  const sorted = [...matches].sort(
    (left, right) => left.kickoffAt.localeCompare(right.kickoffAt) || left.key.localeCompare(right.key)
  );
  const teamHistory = new Map<string, TeamAppearance[]>();
  const leagueHistory = new Map<string, HistoricalMatch[]>();
  const features: HistoricalFeatureRow[] = [];

  for (let index = 0; index < sorted.length;) {
    const kickoffAt = sorted[index].kickoffAt;
    let groupEnd = index + 1;
    while (groupEnd < sorted.length && sorted[groupEnd].kickoffAt === kickoffAt) {
      groupEnd += 1;
    }
    const kickoffGroup = sorted.slice(index, groupEnd);

    for (const match of kickoffGroup) {
      const homeHistory = teamHistory.get(teamKey(match.league, match.homeTeam)) ?? [];
      const awayHistory = teamHistory.get(teamKey(match.league, match.awayTeam)) ?? [];
      const homeVenueHistory = homeHistory.filter((appearance) => appearance.venue === "home");
      const awayVenueHistory = awayHistory.filter((appearance) => appearance.venue === "away");
      const priorLeagueMatches = leagueHistory.get(match.league) ?? [];
      const league = summarizeLeague(priorLeagueMatches, leagueWindow);
      const homeVenue = summarizeTeam(homeVenueHistory, strengthWindow);
      const awayVenue = summarizeTeam(awayVenueHistory, strengthWindow);
      const opening = normalizedOdds(match.odds?.opening);
      const closing = normalizedOdds(match.odds?.closing);
      const hasLeagueBaseline =
        league.matches >= minLeagueMatches && league.homeGoals !== null && league.awayGoals !== null;
      const homeAttack = hasLeagueBaseline
        ? smoothedRate(homeVenue.goalsFor, homeVenue.matches, league.homeGoals!, priorMatches) / league.homeGoals!
        : null;
      const homeDefence = hasLeagueBaseline
        ? smoothedRate(homeVenue.goalsAgainst, homeVenue.matches, league.awayGoals!, priorMatches) / league.awayGoals!
        : null;
      const awayAttack = hasLeagueBaseline
        ? smoothedRate(awayVenue.goalsFor, awayVenue.matches, league.awayGoals!, priorMatches) / league.awayGoals!
        : null;
      const awayDefence = hasLeagueBaseline
        ? smoothedRate(awayVenue.goalsAgainst, awayVenue.matches, league.homeGoals!, priorMatches) / league.homeGoals!
        : null;
      const eligible = hasLeagueBaseline
        && homeVenue.matches >= minVenueMatches
        && awayVenue.matches >= minVenueMatches;

      features.push({
        key: match.key,
        source: match.source,
        division: match.division,
        league: match.league,
        season: match.season,
        kickoffAt: match.kickoffAt,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        samples: {
          league: league.matches,
          homeTeam: homeHistory.length,
          awayTeam: awayHistory.length,
          homeVenue: homeVenue.matches,
          awayVenue: awayVenue.matches
        },
        rolling: {
          league,
          home: {
            recent5: summarizeTeam(homeHistory, 5),
            recent10: summarizeTeam(homeHistory, 10),
            home10: homeVenue
          },
          away: {
            recent5: summarizeTeam(awayHistory, 5),
            recent10: summarizeTeam(awayHistory, 10),
            away10: awayVenue
          }
        },
        strengths: {
          homeAttack: round(homeAttack),
          homeDefence: round(homeDefence),
          awayAttack: round(awayAttack),
          awayDefence: round(awayDefence),
          expectedHomeGoals: eligible ? round(league.homeGoals! * homeAttack! * awayDefence!) : null,
          expectedAwayGoals: eligible ? round(league.awayGoals! * awayAttack! * homeDefence!) : null,
          eligible
        },
        odds: {
          opening,
          closing,
          movement: {
            homeProbability: difference(closing?.home, opening?.home),
            drawProbability: difference(closing?.draw, opening?.draw),
            awayProbability: difference(closing?.away, opening?.away),
            over25Probability: difference(closing?.over25, opening?.over25)
          }
        },
        target: target(match)
      });
    }

    for (const match of kickoffGroup) {
      const homeKey = teamKey(match.league, match.homeTeam);
      const awayKey = teamKey(match.league, match.awayTeam);
      const homeAppearance: TeamAppearance = {
        venue: "home",
        points: match.fullTime.home > match.fullTime.away ? 3 : match.fullTime.home === match.fullTime.away ? 1 : 0,
        goalsFor: match.fullTime.home,
        goalsAgainst: match.fullTime.away,
        shotsFor: match.shots?.home,
        shotsAgainst: match.shots?.away,
        shotsOnTargetFor: match.shots?.homeOnTarget,
        shotsOnTargetAgainst: match.shots?.awayOnTarget,
        cornersFor: match.corners?.home,
        cornersAgainst: match.corners?.away
      };
      const awayAppearance: TeamAppearance = {
        venue: "away",
        points: match.fullTime.away > match.fullTime.home ? 3 : match.fullTime.away === match.fullTime.home ? 1 : 0,
        goalsFor: match.fullTime.away,
        goalsAgainst: match.fullTime.home,
        shotsFor: match.shots?.away,
        shotsAgainst: match.shots?.home,
        shotsOnTargetFor: match.shots?.awayOnTarget,
        shotsOnTargetAgainst: match.shots?.homeOnTarget,
        cornersFor: match.corners?.away,
        cornersAgainst: match.corners?.home
      };
      teamHistory.set(homeKey, [...(teamHistory.get(homeKey) ?? []), homeAppearance]);
      teamHistory.set(awayKey, [...(teamHistory.get(awayKey) ?? []), awayAppearance]);
      leagueHistory.set(match.league, [...(leagueHistory.get(match.league) ?? []), match]);
    }

    index = groupEnd;
  }

  return features;
}