import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import type { Request } from "express";
import { z } from "zod";
import type { DailyFixtureProvider } from "./providers/provider.js";
import { MockProvider } from "./providers/mockProvider.js";
import { HkjcProvider } from "./providers/hkjcProvider.js";
import { HkjcGraphqlProvider } from "./providers/hkjcGraphqlProvider.js";
import { HkjcSnapshotProvider } from "./providers/hkjcSnapshotProvider.js";
import { TheSportsDbProvider } from "./providers/theSportsDbProvider.js";
import { AnalysisService } from "./services/analysisService.js";
import { BacktestStore } from "./services/backtestStore.js";
import { LearningStore } from "./services/learningStore.js";
import { getAssistantInsight, getAutoTrainingProgress, getPracticeProgress, registerJobs, triggerPracticeCycle } from "./services/scheduler.js";
import type { PersistedCalibrationProfiles } from "./services/autoTrainingService.js";
import { getAdaptiveGateSnapshot } from "./services/autoTrainingService.js";
import { evaluateWalkForwardMetrics } from "./services/walkForwardService.js";
import { buildHighWaterRecommendationSnapshot, type DriftLevel } from "./services/highWaterRecommendationService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../../../");

dotenv.config({ path: path.resolve(workspaceRoot, ".env") });

const STRICT_MIN_RECOMMENDED_ODDS = 2.0;
const DEFAULT_ENRICHMENT_NEWS_WHITELIST =
  "fifa.com,uefa.com,the-afc.com,premierleague.com,bundesliga.com,laliga.com,ligue1.com,bbc.com,skysports.com,espn.com";
const DEFAULT_ENRICHMENT_INJURY_WHITELIST =
  "premierinjuries.com,physioroom.com,transfermarkt.com,fifa.com,uefa.com,bbc.com,skysports.com,espn.com";

const envSchema = z.object({
  API_PORT: z.coerce.number().default(Number(process.env.PORT ?? 8787)),
  CORS_ORIGIN: z.string().default("http://localhost:5180"),
  CORS_ADDITIONAL_ORIGINS: z.string().default("http://localhost:5173"),
  CORS_ORIGIN_REGEX: z.string().default(""),
  DATA_PROVIDER: z.enum(["mock", "hkjc", "hkjc_graphql", "hkjc_snapshot", "thesportsdb"]).default("hkjc_graphql"),
  HKJC_SOURCE_URL: z.string().url().default("https://bet.hkjc.com/ch/football/home"),
  HKJC_GRAPHQL_ENDPOINT: z.string().url().default("https://info.cld.hkjc.com/graphql/base/"),
  HKJC_GRAPHQL_REFERER: z.string().url().default("https://bet.hkjc.com/ch/football/home"),
  HKJC_QUERY_VERSION: z.string().default("manual-v1"),
  HKJC_GRAPHQL_QUERY: z.string().default(""),
  HKJC_GRAPHQL_VARIABLES_JSON: z.string().default("{}"),
  HKJC_SNAPSHOT_PATH: z.string().default(path.resolve(workspaceRoot, "apps/api/data/hkjc-snapshot.json")),
  HKJC_MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().min(3000).default(3000),
  THESPORTSDB_BASE_URL: z.string().url().default("https://www.thesportsdb.com/api/v1/json"),
  THESPORTSDB_API_KEY: z.string().default("123"),
  THESPORTSDB_LEAGUE_IDS: z.string().default("4328,4335,4332"),
  THESPORTSDB_MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().min(0).default(1200),
  PRACTICE_ENABLED: z.coerce.boolean().default(true),
  PRACTICE_SCHEDULE: z.string().default("0 */3 * * *"),
  PRACTICE_TIMEZONE: z.string().default("Asia/Hong_Kong"),
  PRACTICE_INCLUDE_THESPORTSDB: z.coerce.boolean().default(true),
  PRACTICE_MAIN_LEARNING_DB_PATH: z.string().default(path.resolve(workspaceRoot, "apps/api/data/practice-main-learning-db.json")),
  PRACTICE_THESPORTSDB_LEARNING_DB_PATH: z.string().default(
    path.resolve(workspaceRoot, "apps/api/data/practice-thesportsdb-learning-db.json")
  ),
  OPENROUTER_ENABLED: z.coerce.boolean().default(true),
  OPENROUTER_API_KEY: z.string().default(""),
  OPENROUTER_MODEL: z.string().default("openai/gpt-4o"),
  OPENROUTER_FALLBACK_MODELS: z.string().default(""),
  OPENROUTER_RECOMMENDATION_CONSENSUS_ENABLED: z.coerce.boolean().default(true),
  OPENROUTER_RECOMMENDATION_CONSENSUS_CANDIDATE_LIMIT: z.coerce.number().int().min(5).max(20).default(8),
  OPENROUTER_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  OPENROUTER_REFERER: z.string().default("http://localhost:5173"),
  OPENROUTER_TITLE: z.string().default("HK Football Value Picks Dashboard"),
  OPENROUTER_AUTO_APPLY: z.coerce.boolean().default(false),
  OPENROUTER_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.75),
  ENRICHMENT_ENABLED: z.coerce.boolean().default(true),
  ENRICHMENT_MAX_RECOMMENDATIONS: z.coerce.number().int().min(1).max(5).default(3),
  ENRICHMENT_NEWS_SOURCE_WHITELIST: z.string().default(DEFAULT_ENRICHMENT_NEWS_WHITELIST),
  ENRICHMENT_INJURY_SOURCE_WHITELIST: z.string().default(DEFAULT_ENRICHMENT_INJURY_WHITELIST),
  PRACTICE_TRIGGER_ALLOW_LOCALHOST: z.coerce.boolean().default(true),
  PRACTICE_TRIGGER_TOKEN: z.string().default(""),
  AUTO_TRAINING_ENABLED: z.coerce.boolean().default(true),
  MIN_RECOMMENDED_ODDS: z.coerce.number().min(STRICT_MIN_RECOMMENDED_ODDS).default(STRICT_MIN_RECOMMENDED_ODDS),
  HIGH_ODDS_THRESHOLD: z.coerce.number().min(1.01).default(2.2),
  HIGH_ODDS_MIN_EDGE_SCORE: z.coerce.number().min(0).default(2.2),
  HIGH_ODDS_MIN_VALUE_SCORE: z.coerce.number().min(0).default(0.07),
  TRAINING_CANDIDATE_RATIO: z.coerce.number().min(0.05).max(1).default(0.35),
  BACKTEST_DB_PATH: z.string().default(path.resolve(workspaceRoot, "apps/api/data/backtest-db.json")),
  LEARNING_DB_PATH: z.string().default(path.resolve(workspaceRoot, "apps/api/data/learning-db.json")),
  MODEL_SETTINGS_PATH: z.string().default(path.resolve(workspaceRoot, "apps/api/data/model-settings.json"))
});

type AppEnv = z.infer<typeof envSchema>;

function failEnvValidation(messages: string[]): never {
  const details = messages.map((message) => `- ${message}`).join("\n");
  throw new Error(
    `Invalid .env configuration for API startup.\n\n${details}\n\nPlease update ${path.resolve(
      workspaceRoot,
      ".env"
    )} and restart.`
  );
}

function validateProviderEnv(config: AppEnv): void {
  const errors: string[] = [];

  const corsOrigins = [config.CORS_ORIGIN, ...config.CORS_ADDITIONAL_ORIGINS.split(",")]
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  for (const origin of corsOrigins) {
    if (origin === "*") {
      continue;
    }

    try {
      const parsed = new URL(origin);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        errors.push(`Invalid CORS origin protocol: ${origin}. Use http or https.`);
      }
    } catch {
      errors.push(`Invalid CORS origin URL: ${origin}`);
    }
  }

  if (config.CORS_ORIGIN_REGEX.trim()) {
    try {
      new RegExp(config.CORS_ORIGIN_REGEX);
    } catch {
      errors.push("CORS_ORIGIN_REGEX is not a valid regular expression.");
    }
  }

  if (config.DATA_PROVIDER === "hkjc_graphql") {
    if (!config.HKJC_GRAPHQL_QUERY.trim()) {
      errors.push("HKJC_GRAPHQL_QUERY is required when DATA_PROVIDER=hkjc_graphql.");
    }

    try {
      const parsed = JSON.parse(config.HKJC_GRAPHQL_VARIABLES_JSON);
      if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
        errors.push("HKJC_GRAPHQL_VARIABLES_JSON must be a JSON object string, for example {}.");
      }
    } catch {
      errors.push("HKJC_GRAPHQL_VARIABLES_JSON is not valid JSON.");
    }

    if (config.HKJC_MIN_REQUEST_INTERVAL_MS < 3000) {
      errors.push("HKJC_MIN_REQUEST_INTERVAL_MS must be >= 3000 to keep request frequency low.");
    }
  }

  if (config.DATA_PROVIDER === "hkjc" && !config.HKJC_SOURCE_URL.trim()) {
    errors.push("HKJC_SOURCE_URL is required when DATA_PROVIDER=hkjc.");
  }

  if (config.DATA_PROVIDER === "hkjc_snapshot" && !config.HKJC_SNAPSHOT_PATH.trim()) {
    errors.push("HKJC_SNAPSHOT_PATH is required when DATA_PROVIDER=hkjc_snapshot.");
  }

  if (config.DATA_PROVIDER === "thesportsdb") {
    const apiKey = config.THESPORTSDB_API_KEY.trim();
    if (!apiKey) {
      errors.push("THESPORTSDB_API_KEY is required when DATA_PROVIDER=thesportsdb.");
    }

    const leagueIds = config.THESPORTSDB_LEAGUE_IDS
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value));

    if (leagueIds.length === 0) {
      errors.push("THESPORTSDB_LEAGUE_IDS must contain at least one numeric league id.");
    }
  }

  if (config.HIGH_ODDS_THRESHOLD < config.MIN_RECOMMENDED_ODDS) {
    errors.push("HIGH_ODDS_THRESHOLD must be greater than or equal to MIN_RECOMMENDED_ODDS.");
  }

  if (config.MIN_RECOMMENDED_ODDS < STRICT_MIN_RECOMMENDED_ODDS) {
    errors.push(`MIN_RECOMMENDED_ODDS must be >= ${STRICT_MIN_RECOMMENDED_ODDS.toFixed(2)} to keep low-odds filtering strict.`);
  }

  if (errors.length > 0) {
    failEnvValidation(errors);
  }
}

const envResult = envSchema.safeParse(process.env);
if (!envResult.success) {
  const issues = envResult.error.issues.map((issue) => {
    const key = issue.path.length > 0 ? issue.path.join(".") : "environment";
    return `${key}: ${issue.message}`;
  });
  failEnvValidation(issues);
}

const env = envResult.data;
validateProviderEnv(env);

const allowedOrigins = new Set(
  [env.CORS_ORIGIN, ...env.CORS_ADDITIONAL_ORIGINS.split(",")]
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
);
const corsOriginRegex = env.CORS_ORIGIN_REGEX.trim() ? new RegExp(env.CORS_ORIGIN_REGEX) : null;

function isAllowedVercelOrigin(origin: URL): boolean {
  return origin.protocol === "https:" && origin.hostname.toLowerCase().endsWith(".vercel.app");
}

function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  try {
    const parsedOrigin = new URL(origin);
    const hostname = parsedOrigin.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return true;
    }
  } catch {
    // Ignore URL parse errors and continue with explicit allow lists.
  }

  if (allowedOrigins.has("*")) {
    return true;
  }

  if (allowedOrigins.has(origin)) {
    return true;
  }

  try {
    if (isAllowedVercelOrigin(new URL(origin))) {
      return true;
    }
  } catch {
    // Ignore URL parse errors and continue with configured regex checks.
  }

  if (corsOriginRegex?.test(origin)) {
    return true;
  }

  return false;
}

function isLoopbackHost(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function isLoopbackIp(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "::1" || normalized === "127.0.0.1" || normalized === "::ffff:127.0.0.1";
}

function getTriggerTokenFromRequest(req: Request): string | null {
  const tokenHeader = req.header("x-practice-trigger-token")?.trim();
  if (tokenHeader) {
    return tokenHeader;
  }

  const auth = req.header("authorization")?.trim();
  if (!auth) {
    return null;
  }

  const [scheme, token] = auth.split(/\s+/, 2);
  if (scheme?.toLowerCase() === "bearer" && token?.trim()) {
    return token.trim();
  }

  return null;
}

function isAuthorizedPracticeTrigger(req: Request): boolean {
  const configuredToken = env.PRACTICE_TRIGGER_TOKEN.trim();
  const requestToken = getTriggerTokenFromRequest(req);

  if (configuredToken.length > 0 && requestToken === configuredToken) {
    return true;
  }

  if (!env.PRACTICE_TRIGGER_ALLOW_LOCALHOST) {
    return false;
  }

  const forwardedFor = req.header("x-forwarded-for")?.split(",")[0]?.trim();
  const forwardedHost = req.header("x-forwarded-host")?.trim();
  const hostHeader = req.header("host")?.split(":")[0]?.trim();
  const remoteAddress = req.socket.remoteAddress?.trim();
  const requestIp = req.ip?.trim();

  if (forwardedFor && !isLoopbackIp(forwardedFor)) {
    return false;
  }

  if (forwardedHost && !isLoopbackHost(forwardedHost.split(":")[0])) {
    return false;
  }

  return [requestIp, remoteAddress, hostHeader].some((value) => isLoopbackIp(value) || isLoopbackHost(value));
}

const app = express();
app.use((req, res, next) => {
  const requestOrigin = req.headers.origin;
  if (typeof requestOrigin === "string" && !isAllowedCorsOrigin(requestOrigin)) {
    res.status(403).json({
      error: "CORS origin denied",
      origin: requestOrigin,
      path: req.originalUrl
    });
    return;
  }

  next();
});

app.use(
  cors({
    origin(origin, callback) {
      callback(null, isAllowedCorsOrigin(origin));
    }
  })
);
app.use(express.json());

const weightsSchema = z
  .object({
    strengthGap: z.number().min(0).optional(),
    recentForm: z.number().min(0).optional(),
    lineupFitness: z.number().min(0).optional(),
    expertSentiment: z.number().min(0).optional(),
    oddsMomentum: z.number().min(0).optional()
  })
  .strict();

const thresholdsSchema = z
  .object({
    minRecommendedOdds: z.number().min(STRICT_MIN_RECOMMENDED_ODDS).optional(),
    highOddsThreshold: z.number().min(1.01).optional(),
    highOddsMinEdgeScore: z.number().min(0).optional(),
    highOddsMinValueScore: z.number().min(0).optional()
  })
  .strict();

const learningHistoryQuerySchema = z
  .object({
    market: z.string().trim().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    status: z.enum(["all", "pending", "settled"]).default("all"),
    limit: z.coerce.number().int().min(1).max(1000).default(200)
  })
  .strict();

const backtestTrainingHistoryQuerySchema = z
  .object({
    source: z.enum(["all", "auto", "practice"]).default("all"),
    limit: z.coerce.number().int().min(1).max(1000).default(200)
  })
  .strict();

const focusedMarketHitRateQuerySchema = z
  .object({
    source: z.enum(["all", "auto", "practice"]).default("all"),
    recentLimit: z.coerce.number().int().min(1).max(500).default(20),
    trendDays: z.coerce.number().int().min(1).max(90).default(14)
  })
  .strict();

const walkForwardQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(50).max(5000).default(1200),
    warmup: z.coerce.number().int().min(10).max(1500).default(120),
    lookback: z.coerce.number().int().min(20).max(2000).default(300),
    window: z.coerce.number().int().min(10).max(300).default(40),
    step: z.coerce.number().int().min(5).max(120).default(10)
  })
  .strict();

const highWaterQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(20).default(8)
  })
  .strict();

const trainingSelectionSchema = z
  .object({
    candidateRatio: z.number().min(0.05).max(1).optional()
  })
  .strict();

const persistedCalibrationProfilesSchema = z
  .object({
    updatedAt: z.string().datetime().optional(),
    markets: z
      .object({
        asian_handicap: z
          .object({
            count: z.number().int().min(0),
            avgPredicted: z.number().min(0).max(1),
            avgObserved: z.number().min(0).max(1),
            scale: z.number().min(0.2).max(2)
          })
          .optional(),
        match_result: z
          .object({
            count: z.number().int().min(0),
            avgPredicted: z.number().min(0).max(1),
            avgObserved: z.number().min(0).max(1),
            scale: z.number().min(0.2).max(2)
          })
          .optional(),
        goals_over_under: z
          .object({
            count: z.number().int().min(0),
            avgPredicted: z.number().min(0).max(1),
            avgObserved: z.number().min(0).max(1),
            scale: z.number().min(0.2).max(2)
          })
          .optional()
      })
      .optional()
  })
  .strict();

const persistedModelSettingsSchema = z
  .object({
    thresholds: thresholdsSchema.optional(),
    trainingSelection: trainingSelectionSchema.optional(),
    calibrationProfiles: persistedCalibrationProfilesSchema.optional()
  })
  .strict();

const manualBacktestRecordSchema = z
  .object({
    fixtureId: z.string().min(1),
    market: z.enum(["homeWin", "draw", "awayWin"]),
    odds: z.number().positive(),
    modelProbability: z.number().min(0).max(1),
    stake: z.number().positive(),
    result: z.enum(["win", "loss"]),
    placedAt: z.string().datetime().optional()
  })
  .strict();

const snapshotUploadSchema = z
  .object({
    snapshot: z.unknown(),
    snapshotFilePath: z.string().trim().min(1).optional(),
    activate: z.coerce.boolean().default(true),
    queryVersion: z.string().trim().min(1).optional()
  })
  .strict();

async function persistSnapshot(snapshot: unknown): Promise<void> {
  await mkdir(path.dirname(env.HKJC_SNAPSHOT_PATH), { recursive: true });
  await writeFile(env.HKJC_SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

async function readPersistedModelSettings(): Promise<{
  thresholds?: {
    minRecommendedOdds: number;
    highOddsThreshold: number;
    highOddsMinEdgeScore: number;
    highOddsMinValueScore: number;
  };
  trainingSelection?: {
    candidateRatio: number;
  };
  calibrationProfiles?: PersistedCalibrationProfiles;
}> {
  try {
    const raw = await readFile(env.MODEL_SETTINGS_PATH, "utf8");
    const parsed = persistedModelSettingsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      console.warn("[model-settings] Invalid persisted settings, using env defaults.");
      return {};
    }

    const result: {
      thresholds?: {
        minRecommendedOdds: number;
        highOddsThreshold: number;
        highOddsMinEdgeScore: number;
        highOddsMinValueScore: number;
      };
      trainingSelection?: {
        candidateRatio: number;
      };
      calibrationProfiles?: PersistedCalibrationProfiles;
    } = {};

    const thresholds = parsed.data.thresholds;
    if (
      thresholds &&
      typeof thresholds.minRecommendedOdds === "number" &&
      typeof thresholds.highOddsThreshold === "number" &&
      thresholds.minRecommendedOdds >= STRICT_MIN_RECOMMENDED_ODDS &&
      thresholds.highOddsThreshold >= thresholds.minRecommendedOdds
    ) {
      result.thresholds = {
        minRecommendedOdds: thresholds.minRecommendedOdds,
        highOddsThreshold: thresholds.highOddsThreshold,
        highOddsMinEdgeScore:
          typeof thresholds.highOddsMinEdgeScore === "number"
            ? thresholds.highOddsMinEdgeScore
            : env.HIGH_ODDS_MIN_EDGE_SCORE,
        highOddsMinValueScore:
          typeof thresholds.highOddsMinValueScore === "number"
            ? thresholds.highOddsMinValueScore
            : env.HIGH_ODDS_MIN_VALUE_SCORE
      };
    } else if (thresholds) {
      console.warn(
        `[model-settings] Ignoring persisted thresholds below strict min odds floor (${STRICT_MIN_RECOMMENDED_ODDS.toFixed(2)}).`
      );
    }

    const trainingSelection = parsed.data.trainingSelection;
    if (trainingSelection && typeof trainingSelection.candidateRatio === "number") {
      result.trainingSelection = {
        candidateRatio: trainingSelection.candidateRatio
      };
    }

    const calibrationProfiles = parsed.data.calibrationProfiles;
    if (
      calibrationProfiles?.markets?.asian_handicap
      && calibrationProfiles.markets.match_result
      && calibrationProfiles.markets.goals_over_under
    ) {
      result.calibrationProfiles = {
        updatedAt: calibrationProfiles.updatedAt ?? new Date().toISOString(),
        markets: {
          asian_handicap: calibrationProfiles.markets.asian_handicap,
          match_result: calibrationProfiles.markets.match_result,
          goals_over_under: calibrationProfiles.markets.goals_over_under
        }
      };
    }

    return result;
  } catch (error) {
    const code = (error as { code?: string } | undefined)?.code;
    if (code === "ENOENT") {
      return {};
    }

    console.warn("[model-settings] Failed to read settings, using env defaults.", error);
    return {};
  }
}

async function persistModelSettings(payload: {
  thresholds?: {
    minRecommendedOdds: number;
    highOddsThreshold: number;
    highOddsMinEdgeScore: number;
    highOddsMinValueScore: number;
  };
  trainingSelection?: { candidateRatio: number };
  calibrationProfiles?: PersistedCalibrationProfiles;
}): Promise<void> {
  await mkdir(path.dirname(env.MODEL_SETTINGS_PATH), { recursive: true });
  await writeFile(env.MODEL_SETTINGS_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createProvider(): DailyFixtureProvider {
  if (env.DATA_PROVIDER === "hkjc_graphql") {
    const variables = JSON.parse(env.HKJC_GRAPHQL_VARIABLES_JSON) as Record<string, unknown>;

    return new HkjcGraphqlProvider(
      env.HKJC_GRAPHQL_ENDPOINT,
      env.HKJC_GRAPHQL_REFERER,
      env.HKJC_GRAPHQL_QUERY,
      variables,
      env.HKJC_MIN_REQUEST_INTERVAL_MS
    );
  }

  if (env.DATA_PROVIDER === "hkjc_snapshot") {
    return new HkjcSnapshotProvider(env.HKJC_SNAPSHOT_PATH);
  }

  if (env.DATA_PROVIDER === "hkjc") {
    return new HkjcProvider(env.HKJC_SOURCE_URL);
  }

  if (env.DATA_PROVIDER === "thesportsdb") {
    const leagueIds = env.THESPORTSDB_LEAGUE_IDS
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value));

    return new TheSportsDbProvider(
      env.THESPORTSDB_API_KEY,
      leagueIds,
      env.THESPORTSDB_BASE_URL,
      env.THESPORTSDB_MIN_REQUEST_INTERVAL_MS
    );
  }

  return new MockProvider();
}

function createAnalysisService(
  provider: DailyFixtureProvider,
  providerName: string,
  queryVersion?: string,
  learningDbPath: string = env.LEARNING_DB_PATH,
  consensusEnabled = false,
  thresholdsOverride?: {
    minRecommendedOdds: number;
    highOddsThreshold: number;
    highOddsMinEdgeScore: number;
    highOddsMinValueScore: number;
  }
): AnalysisService {
  return new AnalysisService(
    provider,
    undefined,
    thresholdsOverride ?? {
      minRecommendedOdds: env.MIN_RECOMMENDED_ODDS,
      highOddsThreshold: env.HIGH_ODDS_THRESHOLD,
      highOddsMinEdgeScore: env.HIGH_ODDS_MIN_EDGE_SCORE,
      highOddsMinValueScore: env.HIGH_ODDS_MIN_VALUE_SCORE
    },
    new LearningStore(learningDbPath),
    {
      provider: providerName,
      queryVersion
    },
    {
      enabled: consensusEnabled,
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL,
      fallbackModels: env.OPENROUTER_FALLBACK_MODELS.split(",").map((model) => model.trim()).filter((model) => model.length > 0),
      temperature: env.OPENROUTER_TEMPERATURE,
      referer: env.OPENROUTER_REFERER,
      title: env.OPENROUTER_TITLE,
      candidateLimit: env.OPENROUTER_RECOMMENDATION_CONSENSUS_CANDIDATE_LIMIT
    }
  );
}

const initialProviderName = env.DATA_PROVIDER;
const initialQueryVersion = ["hkjc_graphql", "hkjc_snapshot"].includes(env.DATA_PROVIDER)
  ? env.HKJC_QUERY_VERSION
  : undefined;
const persistedModelSettings = await readPersistedModelSettings();
const persistedThresholds = persistedModelSettings.thresholds;
let trainingSelectionSettings = {
  candidateRatio: persistedModelSettings.trainingSelection?.candidateRatio ?? env.TRAINING_CANDIDATE_RATIO
};
let calibrationProfilesSettings = persistedModelSettings.calibrationProfiles;

async function persistCurrentModelSettings(): Promise<void> {
  await persistModelSettings({
    thresholds: analysisService.getThresholds(),
    trainingSelection: trainingSelectionSettings,
    calibrationProfiles: calibrationProfilesSettings
  });
}

let analysisService = createAnalysisService(
  createProvider(),
  initialProviderName,
  initialQueryVersion,
  env.LEARNING_DB_PATH,
  env.OPENROUTER_RECOMMENDATION_CONSENSUS_ENABLED && (env.OPENROUTER_ENABLED || env.OPENROUTER_API_KEY.trim().length > 0),
  persistedThresholds
);
const backtestStore = new BacktestStore(env.BACKTEST_DB_PATH);

const practiceSources: Array<{ label: string; service: AnalysisService }> = [];

if (env.PRACTICE_ENABLED) {
  practiceSources.push({
    label: `${initialProviderName}-practice`,
    service: createAnalysisService(
      createProvider(),
      `${initialProviderName}-practice`,
      initialQueryVersion,
      env.PRACTICE_MAIN_LEARNING_DB_PATH
    )
  });

  if (env.PRACTICE_INCLUDE_THESPORTSDB) {
    const leagueIds = env.THESPORTSDB_LEAGUE_IDS
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isFinite(value));

    practiceSources.push({
      label: "thesportsdb-practice",
      service: createAnalysisService(
        new TheSportsDbProvider(
          env.THESPORTSDB_API_KEY,
          leagueIds,
          env.THESPORTSDB_BASE_URL,
          env.THESPORTSDB_MIN_REQUEST_INTERVAL_MS
        ),
        "thesportsdb-practice",
        undefined,
        env.PRACTICE_THESPORTSDB_LEARNING_DB_PATH
      )
    });
  }
}

async function warmupInitialFixtures(): Promise<void> {
  try {
    await analysisService.refreshDailyFixtures();
  } catch (error) {
    console.warn("Primary provider failed.", error);

    if (env.DATA_PROVIDER === "hkjc_graphql") {
      try {
        console.warn("Falling back to HKJC HTML provider.");
        analysisService = createAnalysisService(
          new HkjcProvider(env.HKJC_SOURCE_URL),
          "hkjc",
          env.HKJC_QUERY_VERSION,
          env.LEARNING_DB_PATH,
          env.OPENROUTER_RECOMMENDATION_CONSENSUS_ENABLED && (env.OPENROUTER_ENABLED || env.OPENROUTER_API_KEY.trim().length > 0),
          persistedThresholds
        );
        await analysisService.refreshDailyFixtures();
      } catch (htmlError) {
        console.warn("HKJC HTML provider failed; fallback to mock provider.", htmlError);
        analysisService = createAnalysisService(
          new MockProvider(),
          "mock",
          env.HKJC_QUERY_VERSION,
          env.LEARNING_DB_PATH,
          env.OPENROUTER_RECOMMENDATION_CONSENSUS_ENABLED && (env.OPENROUTER_ENABLED || env.OPENROUTER_API_KEY.trim().length > 0),
          persistedThresholds
        );
        await analysisService.refreshDailyFixtures();
      }
    } else {
      console.warn("Fallback to mock provider.");
      analysisService = createAnalysisService(
        new MockProvider(),
        "mock",
        undefined,
        env.LEARNING_DB_PATH,
        env.OPENROUTER_RECOMMENDATION_CONSENSUS_ENABLED && (env.OPENROUTER_ENABLED || env.OPENROUTER_API_KEY.trim().length > 0),
        persistedThresholds
      );
      await analysisService.refreshDailyFixtures();
    }
  }

  const startupDataSource = analysisService.getDataSourceHealth();
  if (!startupDataSource.ok) {
    console.warn("[data-source] Startup self-check failed:", startupDataSource);
  }
}

void warmupInitialFixtures();

registerJobs(() => analysisService, backtestStore, {
  autoTrainingEnabled: env.AUTO_TRAINING_ENABLED,
  practiceEnabled: env.PRACTICE_ENABLED,
  practiceSchedule: env.PRACTICE_SCHEDULE,
  practiceTimezone: env.PRACTICE_TIMEZONE,
  practiceSources,
  trainingSelection: trainingSelectionSettings,
  calibration: {
    getProfiles: () => calibrationProfilesSettings,
    saveProfiles: async (profiles) => {
      calibrationProfilesSettings = profiles;
      await persistCurrentModelSettings();
    }
  },
  assistant: {
    enabled: env.OPENROUTER_ENABLED || env.OPENROUTER_API_KEY.trim().length > 0,
    apiKey: env.OPENROUTER_API_KEY,
    model: env.OPENROUTER_MODEL,
    fallbackModels: env.OPENROUTER_FALLBACK_MODELS.split(",").map((model) => model.trim()).filter((model) => model.length > 0),
    temperature: env.OPENROUTER_TEMPERATURE,
    referer: env.OPENROUTER_REFERER,
    title: env.OPENROUTER_TITLE,
    autoApply: env.OPENROUTER_AUTO_APPLY,
    minConfidence: env.OPENROUTER_MIN_CONFIDENCE
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, at: new Date().toISOString(), dataSource: analysisService.getDataSourceHealth() });
});

app.get("/api/model/data-source", (_req, res) => {
  res.json({ dataSource: analysisService.getDataSourceHealth() });
});

app.post("/api/model/data-source/snapshot", async (req, res) => {
  const parsed = snapshotUploadSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    let snapshot = parsed.data.snapshot;
    if (snapshot === undefined && parsed.data.snapshotFilePath) {
      const content = await readFile(parsed.data.snapshotFilePath, "utf8");
      snapshot = JSON.parse(content) as unknown;
    }

    if (snapshot === undefined) {
      res.status(400).json({
        error: "Provide either snapshot or snapshotFilePath.",
        savedTo: env.HKJC_SNAPSHOT_PATH
      });
      return;
    }

    await persistSnapshot(snapshot);

    const nextQueryVersion = parsed.data.queryVersion ?? env.HKJC_QUERY_VERSION;
    const snapshotService = createAnalysisService(
      new HkjcSnapshotProvider(env.HKJC_SNAPSHOT_PATH),
      "hkjc_snapshot",
      nextQueryVersion
    );
    await snapshotService.refreshDailyFixtures();

    if (parsed.data.activate) {
      analysisService = snapshotService;
    }

    res.json({
      savedTo: env.HKJC_SNAPSHOT_PATH,
      activated: parsed.data.activate,
      dataSource: snapshotService.getDataSourceHealth(),
      recommendations: snapshotService.getSnapshot().recommendations.length,
      message: parsed.data.activate
        ? "HKJC snapshot provider activated for the current API process. Restart with DATA_PROVIDER=hkjc_snapshot to make it persistent."
        : "HKJC snapshot saved. Activate it later or restart with DATA_PROVIDER=hkjc_snapshot to make it the default source."
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown snapshot import error";
    res.status(400).json({ error: message, savedTo: env.HKJC_SNAPSHOT_PATH });
  }
});

app.get("/api/recommendations", async (_req, res) => {
  await analysisService.getLearningSnapshot();
  res.json(analysisService.getSnapshot());
});

app.get("/api/recommendations/high-water", async (req, res) => {
  const parsed = highWaterQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  await analysisService.getLearningSnapshot();
  const snapshot = analysisService.getSnapshot();
  const gate = await getAdaptiveGateSnapshot(backtestStore, calibrationProfilesSettings);
  const driftLevel = gate.snapshot.drift.severity as DriftLevel;
  const highWater = buildHighWaterRecommendationSnapshot(snapshot.fixtures, {
    limit: parsed.data.limit,
    driftLevel,
    candidateRatioFactor: gate.snapshot.drift.candidateRatioFactor
  });

  res.json(highWater);
});

app.post("/api/recommendations/refresh", async (_req, res) => {
  await analysisService.getLearningSnapshot();
  await analysisService.refreshLineupWindow();
  res.json(analysisService.getSnapshot());
});

app.get("/api/model/weights", (_req, res) => {
  res.json({ weights: analysisService.getWeights() });
});

app.put("/api/model/weights", async (req, res) => {
  const parsed = weightsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const weights = await analysisService.updateWeights(parsed.data);
  res.json({ weights });
});

app.get("/api/model/thresholds", (_req, res) => {
  res.json({ thresholds: analysisService.getThresholds() });
});

app.put("/api/model/thresholds", async (req, res) => {
  const parsed = thresholdsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const next = {
    ...analysisService.getThresholds(),
    ...parsed.data
  };

  if (next.highOddsThreshold < next.minRecommendedOdds) {
    res.status(400).json({
      error: "highOddsThreshold must be greater than or equal to minRecommendedOdds"
    });
    return;
  }

  const thresholds = await analysisService.updateThresholds(parsed.data);
  await persistCurrentModelSettings();
  res.json({ thresholds });
});

app.get("/api/model/training-selection", (_req, res) => {
  res.json({ trainingSelection: trainingSelectionSettings });
});

app.put("/api/model/training-selection", async (req, res) => {
  const parsed = trainingSelectionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  Object.assign(trainingSelectionSettings, parsed.data);
  await persistCurrentModelSettings();

  res.json({ trainingSelection: trainingSelectionSettings });
});

app.get("/api/model/calibration-profiles", (_req, res) => {
  res.json({
    calibrationProfiles: calibrationProfilesSettings ?? null
  });
});

app.get("/api/model/training-gate-status", async (_req, res) => {
  const { snapshot } = await getAdaptiveGateSnapshot(backtestStore, calibrationProfilesSettings);
  res.json(snapshot);
});

app.get("/api/model/learning", async (_req, res) => {
  const learning = await analysisService.getLearningSnapshot();
  res.json({ learning, dbPath: env.LEARNING_DB_PATH });
});

app.get("/api/model/learning/history", async (req, res) => {
  const parsed = learningHistoryQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const records = await analysisService.getLearningHistory(parsed.data);
  const markets = await analysisService.getLearningMarkets();
  res.json({ records, markets, total: records.length });
});

app.post("/api/model/learning/settle-backfill", async (_req, res) => {
  const result = await analysisService.settlePendingBackfill({ quick: true });
  const learning = analysisService.getSnapshot().learning ?? (await analysisService.getLearningSnapshot());

  // Refresh lineups asynchronously so settle-backfill can return quickly.
  void analysisService.refreshLineupWindow().catch((error) => {
    console.warn("[settle-backfill] async lineup refresh failed.", error);
  });

  res.json({ result, learning, dbPath: env.LEARNING_DB_PATH });
});

app.get("/api/model/auto-training", (_req, res) => {
  res.json({ progress: getAutoTrainingProgress() });
});

app.get("/api/model/practice", (_req, res) => {
  res.json({
    practice: getPracticeProgress(),
    assistant: getAssistantInsight(),
    assistantConfig: {
      provider: "openrouter",
      enabled: env.OPENROUTER_ENABLED,
      model: env.OPENROUTER_MODEL,
      fallbackModels: env.OPENROUTER_FALLBACK_MODELS.split(",").map((model) => model.trim()).filter((model) => model.length > 0),
      consensusEnabled: env.OPENROUTER_RECOMMENDATION_CONSENSUS_ENABLED,
      consensusCandidateLimit: env.OPENROUTER_RECOMMENDATION_CONSENSUS_CANDIDATE_LIMIT,
      hasApiKey: env.OPENROUTER_API_KEY.trim().length > 0,
      autoApply: env.OPENROUTER_AUTO_APPLY,
      minConfidence: env.OPENROUTER_MIN_CONFIDENCE,
      enrichment: {
        enabled: env.ENRICHMENT_ENABLED,
        maxRecommendations: env.ENRICHMENT_MAX_RECOMMENDATIONS,
        newsWhitelist: env.ENRICHMENT_NEWS_SOURCE_WHITELIST.split(",").map((domain) => domain.trim()).filter((domain) => domain.length > 0),
        injuryWhitelist: env.ENRICHMENT_INJURY_SOURCE_WHITELIST.split(",").map((domain) => domain.trim()).filter((domain) => domain.length > 0)
      }
    }
  });
});

app.post("/api/model/practice/trigger", async (req, res) => {
  if (!isAuthorizedPracticeTrigger(req)) {
    res.status(403).json({
      ok: false,
      error: "Forbidden",
      code: "PRACTICE_TRIGGER_FORBIDDEN"
    });
    return;
  }

  try {
    await triggerPracticeCycle();
    res.json({
      ok: true,
      practice: getPracticeProgress(),
      assistant: getAssistantInsight()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown practice trigger error";
    res.status(500).json({ ok: false, error: message });
  }
});

app.post("/api/backtest/csv", async (req, res) => {
  const payload = z
    .object({
      filePath: z.string().min(1)
    })
    .safeParse(req.body ?? {});

  if (!payload.success) {
    res.status(400).json({ error: payload.error.flatten() });
    return;
  }

  try {
    const summary = await backtestStore.replaceFromCsv(payload.data.filePath);
    res.json({ summary, dbPath: env.BACKTEST_DB_PATH });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown CSV import error";
    res.status(400).json({ error: message });
  }
});

app.post("/api/backtest/records", async (req, res) => {
  const payload = z
    .object({
      records: z.array(manualBacktestRecordSchema).min(1)
    })
    .safeParse(req.body ?? {});

  if (!payload.success) {
    res.status(400).json({ error: payload.error.flatten() });
    return;
  }

  const normalized = payload.data.records.map((r) => ({
    ...r,
    placedAt: r.placedAt ?? new Date().toISOString(),
    source: "api" as const
  }));

  const summary = await backtestStore.addRecords(normalized);
  res.json({ summary, added: normalized.length, dbPath: env.BACKTEST_DB_PATH });
});

app.get("/api/backtest/summary", async (_req, res) => {
  const summary = await backtestStore.summary();
  res.json({ summary, dbPath: env.BACKTEST_DB_PATH });
});

app.get("/api/backtest/training-records", async (req, res) => {
  const parsed = backtestTrainingHistoryQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const records = await backtestStore.listBackgroundTrainingRecords(parsed.data);
  res.json({ records, total: records.length, source: parsed.data.source });
});

app.get("/api/backtest/training-markets/hit-rate", async (req, res) => {
  const parsed = focusedMarketHitRateQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const metrics = await backtestStore.focusedMarketHitRateTrend(parsed.data);
  res.json(metrics);
});

app.get("/api/backtest/walk-forward", async (req, res) => {
  const parsed = walkForwardQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const records = await analysisService.getLearningHistory({
    status: "settled",
    limit: parsed.data.limit
  });
  const metrics = evaluateWalkForwardMetrics(records, {
    warmup: parsed.data.warmup,
    lookback: parsed.data.lookback,
    window: parsed.data.window,
    step: parsed.data.step
  });

  res.json(metrics);
});

app.listen(env.API_PORT, () => {
  console.log(`API listening on http://localhost:${env.API_PORT}`);
});
