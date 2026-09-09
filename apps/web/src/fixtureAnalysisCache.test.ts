import { describe, expect, it } from "vitest";
import { loadFixtureAnalysis, saveFixtureAnalysis, type StoredFixtureAnalysis } from "./fixtureAnalysisCache";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); }
  };
}

function analysis(fixtureId: string, updatedAt = "2026-09-09T08:00:00.000Z"): StoredFixtureAnalysis {
  return {
    fixtureId,
    updatedAt,
    elapsedSeconds: 12,
    hasClearPrediction: true,
    modelStrength: 76,
    cornerConfidence: 68,
    scoreConfidence: 81,
    aiReview: {
      runAt: updatedAt,
      reviewMode: "ollama",
      model: "qwen3:4b",
      verdict: "approved",
      summary: "Ollama 已完成二次審查。",
      note: "同意模型推介。",
      localAnalysis: "本地模型認為主隊盤口較佳。",
      ollamaAnalysis: "Ollama 認為主隊近況較穩。",
      jointDecision: "雙方合選主隊勝。",
      latestInfoAt: updatedAt,
      dataIssues: []
    },
    prediction: {
      scoreline: "1-1",
      homeCorners: 5,
      awayCorners: 4,
      cornerConfidence: 68,
      summary: "上一次分析結果"
    }
  };
}

describe("fixtureAnalysisCache", () => {
  it("restores the last successful analysis for the same fixture", () => {
    const storage = memoryStorage();
    saveFixtureAnalysis(storage, analysis("fixture-1"));

    expect(loadFixtureAnalysis(storage, "fixture-1")).toEqual(analysis("fixture-1"));
    expect(loadFixtureAnalysis(storage, "fixture-2")).toBeNull();
  });

  it("ignores malformed persisted data", () => {
    const storage = memoryStorage();
    storage.setItem("ai-v.fixture-analysis.v1", "not-json");

    expect(loadFixtureAnalysis(storage, "fixture-1")).toBeNull();
  });

  it("retains only the 50 most recently updated fixtures", () => {
    const storage = memoryStorage();
    for (let index = 0; index < 51; index += 1) {
      saveFixtureAnalysis(storage, analysis(`fixture-${index}`, new Date(index * 1000).toISOString()));
    }

    expect(loadFixtureAnalysis(storage, "fixture-0")).toBeNull();
    expect(loadFixtureAnalysis(storage, "fixture-50")).not.toBeNull();
  });
});