import type { Fixture } from "../types.js";

export interface DailyFixtureProvider {
  fetchTodayFixtures(): Promise<Fixture[]>;
  refreshLineups(fixtures: Fixture[]): Promise<Fixture[]>;
  fetchFixturesByIds?(fixtureIds: string[]): Promise<Fixture[]>;
}
