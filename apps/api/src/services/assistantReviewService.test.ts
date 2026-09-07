import { describe, expect, it, vi } from "vitest";
import type { Recommendation } from "../types.js";
import { buildConsensusSummarySections, reviewRecommendationsForConsensus } from "./assistantReviewService.js";

const sampleRecommendation = (overrides: Partial<Recommendation> = {}): Recommendation => ({
  fixtureId: "fx-1",
  match: "A vs B",
  kickoffAt: "2026-07-16T12:00:00.000Z",
  league: "Test League",
  market: "讓球",
  selectionName: "主隊勝",
  currentOdds: 2.2,
  confidence: 68,
  edgeScore: 6.2,
  valueScore: 0.12,
  recommendationGroup: "focus",
  halfTimeScorePrediction: "0-0",
  fullTimeScorePrediction: "1-0",
  correctScoreConfidence: "低",
  reason: "基礎模型判斷有效",
  lastUpdatedAt: "2026-07-16T12:00:00.000Z",
  ...overrides
});

describe("reviewRecommendationsForConsensus", () => {
  it("keeps local model shortlist separate from AI approvals when OpenRouter is unavailable", async () => {
    const recommendation = sampleRecommendation();
    const result = await reviewRecommendationsForConsensus([recommendation], { apiKey: "" });

    expect(result.reviewMode).toBe("local_fallback");
    expect(result.recommendations).toEqual([]);
    expect(result.rejectedRecommendations).toEqual([]);
    expect(result.summary).toContain("未啟用 AI 共識審查");
  });

  it("records explicit AI consensus and rejection notes when OpenRouter succeeds", async () => {
    const retainedRecommendation = sampleRecommendation({
      fixtureId: "fx-1",
      market: "讓球",
      selectionName: "主隊勝"
    });
    const rejectedRecommendation = sampleRecommendation({
      fixtureId: "fx-2",
      match: "C vs D",
      market: "總入球",
      selectionName: "2.5 上",
      currentOdds: 2.7,
      fullTimeScorePrediction: "2-1"
    });
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "AI 已完成二次審查。主隊保留，總入球被拒絕，風險集中在高水項目，雙方分歧來自事件節奏。",
              finalPicks: [
                {
                  fixtureId: "fx-1",
                  market: "讓球",
                  selectionName: "主隊勝",
                  consensusNote: "主隊近期狀態與盤口價值更穩，值得保留。"
                }
              ],
              rejectedPicks: [
                {
                  fixtureId: "fx-2",
                  market: "總入球",
                  selectionName: "2.5 上",
                  rejectionNote: "事件節奏不穩，風險過大。"
                }
              ],
              dataIssues: []
            })
          }
        }]
      })
    }) as typeof fetch;

    try {
      const result = await reviewRecommendationsForConsensus([retainedRecommendation, rejectedRecommendation], {
        apiKey: "test-key",
        model: "openai/gpt-4o-mini",
        fallbackModels: []
      });

      expect(result.reviewMode).toBe("openrouter");
      expect(result.recommendations[0].aiConsensusNote).toBe("主隊近期狀態與盤口價值更穩，值得保留。");
      expect(result.recommendations[0].reason).toContain("AI 共識：");
      expect(result.rejectedRecommendations[0].aiRejectionNote).toBe("事件節奏不穩，風險過大。");
      expect(result.rejectedRecommendations[0].fixtureId).toBe("fx-2");
      expect(result.summarySections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ title: "保留項目" }),
          expect.objectContaining({ title: "拒絕項目" }),
          expect.objectContaining({ title: "高水風險" }),
          expect.objectContaining({ title: "分歧焦點" })
        ])
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("buildConsensusSummarySections", () => {
  it("segments an English OpenRouter summary into all consensus sections", () => {
    const sections = buildConsensusSummarySections(
      "After evaluating all recommendations through hybrid reasoning and high-water second review, 5 of 8 candidates passed consensus. Rejected picks had insufficient edge/value scores or unresolved event risks. All matches show sensitivity to half-time market volatility and lineup changes."
    );

    expect(sections.map((section) => section.title)).toEqual([
      "保留項目",
      "拒絕項目",
      "高水風險",
      "分歧焦點"
    ]);
    expect(sections.every((section) => section.items.length > 0)).toBe(true);
  });
});
