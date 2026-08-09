import type { Fixture, Recommendation } from "../types.js";

export type ExternalEnrichmentSignals = {
  news: string[];
  injuries: string[];
  weather: string[];
  issues: string[];
  sourcePolicy: {
    enabled: boolean;
    maxRecommendations: number;
    newsWhitelist: string[];
    injuryWhitelist: string[];
  };
};

type SnapshotLike = {
  fixtures: Fixture[];
  recommendations: Recommendation[];
};

type WeatherSummary = {
  label: string;
  temperatureC?: number;
  precipitationProbability?: number;
  windSpeedKph?: number;
};

const ENRICHMENT_TIMEOUT_MS = 4500;
const DEFAULT_MAX_RECOMMENDATIONS = 3;
const DEFAULT_NEWS_WHITELIST = [
  "fifa.com",
  "uefa.com",
  "the-afc.com",
  "premierleague.com",
  "bundesliga.com",
  "laliga.com",
  "ligue1.com",
  "bbc.com",
  "skysports.com",
  "espn.com"
];
const DEFAULT_INJURY_WHITELIST = [
  "premierinjuries.com",
  "physioroom.com",
  "transfermarkt.com",
  "fifa.com",
  "uefa.com",
  "bbc.com",
  "skysports.com",
  "espn.com"
];

function trimText(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function recommendationKey(recommendation: Recommendation): string {
  return `${recommendation.fixtureId}::${recommendation.market}::${recommendation.selectionName}`;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  return fallback;
}

function parseIntInRange(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function parseDomainWhitelist(value: string | undefined, fallback: string[]): string[] {
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  const parsed = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0)
    .map((item) => item.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*/, ""));

  return parsed.length > 0 ? [...new Set(parsed)] : fallback;
}

function sourceFilterClause(domains: string[]): string {
  if (domains.length === 0) {
    return "";
  }

  return ` (${domains.map((domain) => `site:${domain}`).join(" OR ")})`;
}

function topRecommendations(snapshot: SnapshotLike, limit = 3): Recommendation[] {
  return [...snapshot.recommendations]
    .sort((left, right) => right.confidence - left.confidence || right.edgeScore - left.edgeScore || right.valueScore - left.valueScore)
    .slice(0, limit);
}

function fixtureLabel(fixture: Fixture): string {
  return trimText(fixture.homeTeamEn || fixture.homeTeam) || fixture.homeTeam;
}

function buildSearchQuery(fixture: Fixture, suffix: string): string {
  const team = fixtureLabel(fixture);
  return `${team} football ${suffix}`.trim();
}

async function fetchWithTimeout(url: string, timeoutMs = ENRICHMENT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal, headers: { "user-agent": "Mozilla/5.0" } });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRssTitles(url: string, limit = 3): Promise<string[]> {
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      return [];
    }

    const xml = await response.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, limit);
    return items
      .map((match) => {
        const title = match[1].match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i);
        const pubDate = match[1].match(/<pubDate>(.*?)<\/pubDate>/i)?.[1];
        const text = trimText(title?.[1] ?? title?.[2]);
        if (!text) {
          return null;
        }

        return pubDate ? `${text}（${new Date(pubDate).toLocaleDateString("en-GB", { month: "2-digit", day: "2-digit" })}）` : text;
      })
      .filter((value): value is string => !!value);
  } catch {
    return [];
  }
}

async function fetchWeatherSummary(fixture: Fixture): Promise<WeatherSummary | null> {
  const teamName = fixtureLabel(fixture);
  const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(teamName)}&count=1&language=en&format=json`;

  try {
    const geocodeResponse = await fetchWithTimeout(geocodeUrl);
    if (!geocodeResponse.ok) {
      return null;
    }

    const geocode = (await geocodeResponse.json()) as {
      results?: Array<{ latitude: number; longitude: number; name: string; country?: string }>; 
    };
    const location = geocode.results?.[0];
    if (!location) {
      return null;
    }

    const kickoff = new Date(fixture.kickoffAt);
    const kickoffHour = `${kickoff.getUTCHours()}`.padStart(2, "0");
    const kickoffDate = kickoff.toISOString().slice(0, 10);
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&hourly=temperature_2m,precipitation_probability,wind_speed_10m,weather_code&timezone=auto&start_date=${kickoffDate}&end_date=${kickoffDate}`;

    const forecastResponse = await fetchWithTimeout(forecastUrl);
    if (!forecastResponse.ok) {
      return null;
    }

    const forecast = (await forecastResponse.json()) as {
      hourly?: {
        time?: string[];
        temperature_2m?: number[];
        precipitation_probability?: number[];
        wind_speed_10m?: number[];
        weather_code?: number[];
      };
    };

    const hourly = forecast.hourly;
    if (!hourly?.time || hourly.time.length === 0) {
      return null;
    }

    const index = hourly.time.findIndex((value) => value.includes(`${kickoffDate}T${kickoffHour}:`));
    const resolvedIndex = index >= 0 ? index : 0;

    return {
      label: `${location.name}${location.country ? `, ${location.country}` : ""}`,
      temperatureC: hourly.temperature_2m?.[resolvedIndex],
      precipitationProbability: hourly.precipitation_probability?.[resolvedIndex],
      windSpeedKph: hourly.wind_speed_10m?.[resolvedIndex]
    };
  } catch {
    return null;
  }
}

function weatherSummaryLabel(summary: WeatherSummary): string {
  const parts = [`${summary.label} 天氣預報`];
  if (typeof summary.temperatureC === "number") {
    parts.push(`氣溫 ${summary.temperatureC.toFixed(1)}°C`);
  }
  if (typeof summary.precipitationProbability === "number") {
    parts.push(`降雨機率 ${Math.round(summary.precipitationProbability)}%`);
  }
  if (typeof summary.windSpeedKph === "number") {
    parts.push(`風速 ${summary.windSpeedKph.toFixed(1)} km/h`);
  }
  return parts.join("｜");
}

export async function buildExternalEnrichment(snapshot: SnapshotLike): Promise<ExternalEnrichmentSignals> {
  const enabled = parseBool(process.env.ENRICHMENT_ENABLED, true);
  const maxRecommendations = parseIntInRange(
    process.env.ENRICHMENT_MAX_RECOMMENDATIONS,
    DEFAULT_MAX_RECOMMENDATIONS,
    1,
    5
  );
  const newsWhitelist = parseDomainWhitelist(process.env.ENRICHMENT_NEWS_SOURCE_WHITELIST, DEFAULT_NEWS_WHITELIST);
  const injuryWhitelist = parseDomainWhitelist(
    process.env.ENRICHMENT_INJURY_SOURCE_WHITELIST,
    DEFAULT_INJURY_WHITELIST
  );

  if (!enabled) {
    return {
      news: [],
      injuries: [],
      weather: [],
      issues: ["external enrichment disabled by ENRICHMENT_ENABLED"],
      sourcePolicy: {
        enabled,
        maxRecommendations,
        newsWhitelist,
        injuryWhitelist
      }
    };
  }

  const fixturesById = new Map(snapshot.fixtures.map((fixture) => [fixture.id, fixture]));
  const seeds = topRecommendations(snapshot, maxRecommendations);

  const news: string[] = [];
  const injuries: string[] = [];
  const weather: string[] = [];
  const issues: string[] = [];

  for (const recommendation of seeds) {
    const fixture = fixturesById.get(recommendation.fixtureId);
    if (!fixture) {
      continue;
    }

    const teamLabel = fixtureLabel(fixture);
    const newsQuery = `${buildSearchQuery(fixture, "news OR preview OR tactical")}${sourceFilterClause(newsWhitelist)}`;
    const injuryQuery = `${buildSearchQuery(fixture, "injury OR lineup OR suspension")}${sourceFilterClause(injuryWhitelist)}`;

    const [newsTitles, injuryTitles, weatherSummary] = await Promise.all([
      fetchRssTitles(`https://news.google.com/rss/search?q=${encodeURIComponent(newsQuery)}&hl=en-US&gl=US&ceid=US:en`, 2),
      fetchRssTitles(`https://news.google.com/rss/search?q=${encodeURIComponent(injuryQuery)}&hl=en-US&gl=US&ceid=US:en`, 2),
      fetchWeatherSummary(fixture)
    ]);

    if (newsTitles.length > 0) {
      news.push(`${recommendation.match}｜外部新聞：${newsTitles.join("；")}`);
    } else {
      issues.push(`${teamLabel} 未能抓到即時新聞 RSS`);
    }

    if (injuryTitles.length > 0) {
      injuries.push(`${recommendation.match}｜傷停/陣容：${injuryTitles.join("；")}`);
    } else {
      issues.push(`${teamLabel} 未能抓到傷停 / 陣容 RSS`);
    }

    if (weatherSummary) {
      weather.push(`${recommendation.match}｜${weatherSummaryLabel(weatherSummary)}`);
    } else {
      issues.push(`${teamLabel} 未能定位到天氣預報`);
    }
  }

  return {
    news,
    injuries,
    weather,
    issues,
    sourcePolicy: {
      enabled,
      maxRecommendations,
      newsWhitelist,
      injuryWhitelist
    }
  };
}