type MarketOption = {
  oddsType: string;
  oddsTypeName: string;
  selectionCode: string;
  selectionName: string;
  lineCondition: string;
  currentOdds: number;
  inplay: boolean;
  poolStatus: string;
  combinationStatus: string;
  updatedAt: string;
};

type Fixture = {
  id: string;
  league: string;
  kickoffAt: string;
  status?: string;
  homeTeam: string;
  awayTeam: string;
  marketOptions?: MarketOption[];
};

function isLiveFixture(fixture: Fixture): boolean {
  const rawStatus = (fixture.status ?? "").trim().toLowerCase();
  const liveTokens = [
    "live",
    "in_play",
    "inplay",
    "playing",
    "running",
    "active",
    "進行",
    "上半場",
    "下半場",
    "半場",
    "開賽",
    "開場",
    "first half",
    "second half"
  ];

  if (liveTokens.some((token) => rawStatus.includes(token))) {
    return true;
  }

  return (fixture.marketOptions ?? []).some((option) => option.inplay === true);
}

function isFinishedFixture(fixture: Fixture): boolean {
  const rawStatus = (fixture.status ?? "").trim().toLowerCase();
  const finishedTokens = [
    "finished",
    "fulltime",
    "ft",
    "ended",
    "complete",
    "completed",
    "result",
    "closed",
    "postponed",
    "cancelled",
    "abandoned",
    "suspended"
  ];

  if (isLiveFixture(fixture)) {
    return false;
  }

  if (finishedTokens.some((token) => rawStatus.includes(token))) {
    return true;
  }

  const kickoff = Date.parse(fixture.kickoffAt);
  if (!Number.isFinite(kickoff)) {
    return false;
  }

  return kickoff < Date.now() && !isLiveFixture(fixture);
}

function getHongKongDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
}

export function hasUsableBettingMarket(fixture: Fixture): boolean {
  const options = (fixture.marketOptions ?? []).filter((option) => Number(option.currentOdds) > 1);
  return options.length > 0;
}

export function isValidFixtureForTodayWindow(fixture: Fixture): boolean {
  if (isFinishedFixture(fixture) || !hasUsableBettingMarket(fixture)) {
    return false;
  }

  if (isLiveFixture(fixture)) {
    return true;
  }

  const kickoff = Date.parse(fixture.kickoffAt);
  if (!Number.isFinite(kickoff)) {
    return false;
  }

  const now = new Date();
  const kickoffDateKey = getHongKongDateKey(new Date(kickoff));
  const todayDateKey = getHongKongDateKey(now);
  const nextDayDateKey = getHongKongDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  if (kickoffDateKey !== todayDateKey && kickoffDateKey !== nextDayDateKey) {
    return false;
  }

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const nextDayNine = new Date(todayStart);
  nextDayNine.setDate(todayStart.getDate() + 1);
  nextDayNine.setHours(9, 0, 0, 0);

  return kickoff >= todayStart.getTime() && kickoff < nextDayNine.getTime() && kickoff > now.getTime();
}
