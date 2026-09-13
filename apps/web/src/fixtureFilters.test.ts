import { describe, expect, it } from 'vitest';
import { isValidFixtureForTodayWindow } from './fixtureFilters';

describe('isValidFixtureForTodayWindow', () => {
  it('rejects fixtures without usable betting markets', () => {
    const now = new Date();
    const kickoff = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();

    expect(
      isValidFixtureForTodayWindow({
        id: 'bad-match',
        kickoffAt: kickoff,
        league: 'International',
        homeTeam: 'Alpha',
        awayTeam: 'Beta',
        marketOptions: []
      })
    ).toBe(false);
  });

  it('accepts fixtures that are upcoming and have at least one active odds market', () => {
    const now = new Date();
    const kickoff = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();

    expect(
      isValidFixtureForTodayWindow({
        id: 'good-match',
        kickoffAt: kickoff,
        league: 'Premier League',
        homeTeam: 'Liverpool',
        awayTeam: 'Arsenal',
        marketOptions: [
          {
            oddsType: 'HAD',
            oddsTypeName: '主客和',
            selectionCode: 'HADH',
            selectionName: '主勝',
            lineCondition: 'N/A',
            currentOdds: 2.05,
            inplay: false,
            poolStatus: 'Open',
            combinationStatus: 'Open',
            updatedAt: new Date().toISOString()
          }
        ]
      })
    ).toBe(true);
  });
});
