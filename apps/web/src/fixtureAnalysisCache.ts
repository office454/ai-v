export type StoredFixtureAnalysis = {
  fixtureId: string;
  updatedAt: string;
  elapsedSeconds: number;
  hasClearPrediction: boolean;
  modelStrength: number;
  cornerConfidence: number;
  scoreConfidence: number;
  prediction: {
    scoreline: string;
    homeCorners: number;
    awayCorners: number;
    cornerConfidence: number;
    summary: string;
  };
};

const STORAGE_KEY = "ai-v.fixture-analysis.v1";
const MAX_STORED_FIXTURES = 50;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStoredFixtureAnalysis(value: unknown): value is StoredFixtureAnalysis {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StoredFixtureAnalysis>;
  const prediction = record.prediction;
  return typeof record.fixtureId === "string"
    && typeof record.updatedAt === "string"
    && isFiniteNumber(record.elapsedSeconds)
    && typeof record.hasClearPrediction === "boolean"
    && isFiniteNumber(record.modelStrength)
    && isFiniteNumber(record.cornerConfidence)
    && isFiniteNumber(record.scoreConfidence)
    && !!prediction
    && typeof prediction.scoreline === "string"
    && isFiniteNumber(prediction.homeCorners)
    && isFiniteNumber(prediction.awayCorners)
    && isFiniteNumber(prediction.cornerConfidence)
    && typeof prediction.summary === "string";
}

function readCache(storage: Storage): Record<string, StoredFixtureAnalysis> {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, StoredFixtureAnalysis] => isStoredFixtureAnalysis(entry[1]))
    );
  } catch {
    return {};
  }
}

export function loadFixtureAnalysis(storage: Storage, fixtureId: string): StoredFixtureAnalysis | null {
  return readCache(storage)[fixtureId] ?? null;
}

export function saveFixtureAnalysis(storage: Storage, analysis: StoredFixtureAnalysis): void {
  try {
    const entries = Object.values({
      ...readCache(storage),
      [analysis.fixtureId]: analysis
    })
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, MAX_STORED_FIXTURES);
    storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries.map((entry) => [entry.fixtureId, entry]))));
  } catch {
    // Storage may be unavailable in private browsing or blocked contexts.
  }
}