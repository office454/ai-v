import { defineRailway, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const data = volume("ai-v-volume", {
    region: "ams",
    sizeMB: 5000,
  });
  const ai_v = service("ai v", {
    env: {
      AUTO_TRAINING_LEARNING_DB_PATH: preserve(),
      BACKTEST_DB_PATH: preserve(),
      BIGBALL_API_BASE_URL: preserve(),
      BIGBALL_API_KEY: preserve(),
      CORS_ORIGIN: preserve(),
      CORS_ORIGIN_REGEX: preserve(),
      DATA_PROVIDER: preserve(),
      HIGHLIGHTLY_API_BASE_URL: preserve(),
      HIGHLIGHTLY_API_KEY: preserve(),
      HKJC_GRAPHQL_ENDPOINT: preserve(),
      HKJC_GRAPHQL_QUERY: preserve(),
      HKJC_GRAPHQL_REFERER: preserve(),
      HKJC_GRAPHQL_VARIABLES_JSON: preserve(),
      HKJC_QUERY_VERSION: preserve(),
      LEARNING_DB_PATH: preserve(),
      MODEL_SETTINGS_PATH: preserve(),
      NIXPACKS_NODE_VERSION: preserve(),
      NPM_CONFIG_ENGINE_STRICT: preserve(),
      ODDS_SNAPSHOT_DB_PATH: preserve(),
      OPENROUTER_API_KEY: preserve(),
      OPENROUTER_FALLBACK_MODELS: preserve(),
      OPENROUTER_MODEL: preserve(),
      PERSISTENT_DATA_DIR: preserve(),
      PRACTICE_TRIGGER_ALLOW_LOCALHOST: preserve(),
      PRACTICE_TRIGGER_TOKEN: preserve(),
      THE_ODDS_API_ENABLED: preserve(),
      THE_ODDS_API_KEY: preserve(),
    },
    healthcheck: "/api/health",
    volumeMounts: {
      "/data": data,
    },
  });
  return project("ai v", {
    resources: [ai_v, data],
  });
});
