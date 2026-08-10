import { z } from "zod";
import type {
  BacktestSummary,
  DataSourceHealth,
  Fixture,
  ModelAssistantInsight,
  PracticeCycleProgress,
  Recommendation,
  ScoringWeights
} from "../types.js";
import type { ExternalEnrichmentSignals } from "./externalEnrichmentService.js";

type AssistantReviewContext = {
  dataSource: DataSourceHealth;
  practice: PracticeCycleProgress | null;
  backtestSummary: BacktestSummary;
  autoTraining: {
    lastCycleAdded: number;
    totalAutoRecords: number;
    recentHitRate: number;
    recentSample: number;
    updatedAt: string;
  };
  learning: {
    pendingCount: number;
    settledCount: number;
    correction: {
      marketPenalty: Record<string, number>;
      oddsBucketPenalty: Record<string, number>;
      confidenceBucketPenalty: Record<string, number>;
      sidePenalty: Record<string, number>;
    };
  };
  thresholds: {
    minRecommendedOdds: number;
    highOddsThreshold: number;
    highOddsMinEdgeScore: number;
    highOddsMinValueScore: number;
  };
  weights: ScoringWeights;
  recommendations: Recommendation[];
  hybridSignals?: HybridAiSignals;
  externalEnrichment?: ExternalEnrichmentSignals;
};

type AssistantOptions = {
  apiKey?: string;
  model?: string;
  fallbackModels?: string[];
  temperature?: number;
  referer?: string;
  title?: string;
};

export type HybridAiSignals = {
  semanticObservations: string[];
  eventSensitivity: string[];
  hybridCalibration: string[];
  confidenceAnchors: string[];
};

export type RecommendationConsensusResult = {
  reviewMode: "openrouter" | "local_fallback";
  model: string;
  summary: string;
  recommendations: Recommendation[];
  rejectedRecommendations: Recommendation[];
  dataIssues: string[];
  consensusNotes: Record<string, string>;
};

type OpenRouterSuccessPayload = {
  choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
};

type OpenRouterAttemptResult =
  | {
      ok: true;
      model: string;
      content: string;
    }
  | {
      ok: false;
      model: string;
      status: number;
      rawResponse?: string;
    };

const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";
const DEFAULT_OPENROUTER_FALLBACK_MODELS = ["openai/gpt-4o"];
const DEFAULT_OPENROUTER_FREE_MODELS = [
  "tencent/hy3:free",
  "poolside/laguna-xs-2.1:free",
  "cohere/north-mini-code:free",
  "google/gemma-4-26b-a4b-it:free"
];

function buildCandidateModels(primaryModel: string, configuredFallbacks: string[]): string[] {
  return [primaryModel, ...configuredFallbacks, ...DEFAULT_OPENROUTER_FREE_MODELS].filter(
    (model, index, values) => model.length > 0 && values.indexOf(model) === index
  );
}

const assistantResponseSchema = z
  .object({
    summary: z.string().min(1),
    keyFindings: z.array(z.string().min(1)).default([]),
    dataIssues: z.array(z.string().min(1)).default([]),
    actionItems: z.array(z.string().min(1)).default([]),
    suggestedWeights: z
      .object({
        strengthGap: z.number().min(0).optional(),
        recentForm: z.number().min(0).optional(),
        lineupFitness: z.number().min(0).optional(),
        expertSentiment: z.number().min(0).optional(),
        oddsMomentum: z.number().min(0).optional()
      })
      .partial()
      .optional(),
    suggestedThresholds: z
      .object({
        minRecommendedOdds: z.number().min(1.01).optional(),
        highOddsThreshold: z.number().min(1.01).optional(),
        highOddsMinEdgeScore: z.number().min(0).optional(),
        highOddsMinValueScore: z.number().min(0).optional()
      })
      .partial()
      .optional(),
    confidence: z.number().min(0).max(1).default(0.5)
  })
  .strict();

const recommendationConsensusSchema = z
  .object({
    summary: z.string().min(1),
    finalPicks: z
      .array(
        z
          .object({
            fixtureId: z.string().min(1),
            market: z.string().min(1),
            selectionName: z.string().min(1),
            consensusNote: z.string().min(1)
          })
          .strict()
      )
      .default([]),
    rejectedPicks: z
      .array(
        z
          .object({
            fixtureId: z.string().min(1),
            market: z.string().min(1),
            selectionName: z.string().min(1),
            rejectionNote: z.string().min(1)
          })
          .strict()
      )
      .default([]),
    dataIssues: z.array(z.string().min(1)).default([])
  })
  .strict();

function buildLocalInsight(context: AssistantReviewContext, model: string): ModelAssistantInsight {
  const practiceSourceCount = context.practice?.sourceCount ?? 0;
  const practiceAdded = context.practice?.totalAutoRecordsAdded ?? 0;
  const hasLearningPenalty = Object.keys(context.learning.correction.marketPenalty).length > 0;
  const semanticObservations = context.hybridSignals?.semanticObservations ?? [];
  const eventSensitivity = context.hybridSignals?.eventSensitivity ?? [];
  const hybridCalibration = context.hybridSignals?.hybridCalibration ?? [];
  const externalNews = context.externalEnrichment?.news ?? [];
  const externalInjuries = context.externalEnrichment?.injuries ?? [];
  const externalWeather = context.externalEnrichment?.weather ?? [];
  const summary = [
    `本輪練習來源 ${practiceSourceCount} 個，新增訓練記錄 ${practiceAdded} 筆。`,
    `自動訓練近期命中率 ${Math.round(context.autoTraining.recentHitRate * 100)}%。`,
    hasLearningPenalty ? "已存在明確盲點修正，可持續收斂高風險市場。" : "目前盲點資料仍少，先保守微調。"
  ].join(" ");

  const keyFindings = [
    `主資料源為 ${context.dataSource.provider}，目前有 ${context.dataSource.fixtureCount} 場可用賽事。`,
    `近期 auto 訓練樣本 ${context.autoTraining.recentSample} 筆，命中率 ${Math.round(context.autoTraining.recentHitRate * 100)}%。`,
    `高 odds 門檻為 ${context.thresholds.highOddsThreshold}，最低推薦 odds 為 ${context.thresholds.minRecommendedOdds}。`,
    `高水二審 EV 門檻：edge >= ${context.thresholds.highOddsMinEdgeScore}% 且 valueScore >= ${context.thresholds.highOddsMinValueScore.toFixed(3)}。`,
    ...semanticObservations.slice(0, 2),
    ...eventSensitivity.slice(0, 2),
    ...hybridCalibration.slice(0, 2),
    ...externalNews.slice(0, 2),
    ...externalInjuries.slice(0, 2),
    ...externalWeather.slice(0, 2)
  ];

  const actionItems = [
    "優先追蹤近 20 筆錯誤最多的市場與賠率區間。",
    "維持小幅調整，避免因單日練習資料過少而過度修正。",
    practiceAdded > 0 ? "將本輪練習資料納入後續盲點分析。" : "等待下一輪練習資料再作進一步修正。"
  ];

  if (semanticObservations.length > 0) {
    actionItems.unshift("先用語義與戰術信號核對高分候選，再決定是否放大權重。");
  }

  if (externalNews.length > 0 || externalInjuries.length > 0 || externalWeather.length > 0) {
    actionItems.unshift("把外部新聞、傷停與天氣信號一併納入決策，再做最後校準。");
  }

  const enrichment = context.externalEnrichment
    ? {
        news: context.externalEnrichment.news,
        injuries: context.externalEnrichment.injuries,
        weather: context.externalEnrichment.weather,
        issues: context.externalEnrichment.issues,
        sourcePolicy: context.externalEnrichment.sourcePolicy
      }
    : undefined;

  return {
    runAt: new Date().toISOString(),
    reviewMode: "local_fallback",
    model,
    summary,
    keyFindings,
    dataIssues: context.dataSource.lastError ? [context.dataSource.lastError] : [],
    actionItems,
    enrichment,
    suggestedWeights: hasLearningPenalty
      ? {
          oddsMomentum: Math.max(0, context.weights.oddsMomentum - 0.03)
        }
      : undefined,
    suggestedThresholds: undefined,
    confidence: 0.45,
    applied: false,
    sourceLabels: context.practice?.sources.map((source) => source.label) ?? [],
    rawResponse: undefined
  };
}

async function requestOpenRouterInsight(
  model: string,
  prompt: string,
  options: AssistantOptions,
  apiKey: string
): Promise<OpenRouterAttemptResult> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": options.referer?.trim() || "http://localhost:5173",
      "X-Title": options.title?.trim() || "HK Football Value Picks Dashboard",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: options.temperature ?? 0.2,
      messages: [
        {
          role: "system",
          content: "你是嚴格輸出 JSON 的模型審查助手。"
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    return {
      ok: false,
      model,
      status: response.status,
      rawResponse: await response.text().catch(() => undefined)
    };
  }

  const payload = (await response.json()) as OpenRouterSuccessPayload;
  const messageContent = payload.choices?.[0]?.message?.content;
  const content = Array.isArray(messageContent)
    ? messageContent.map((part) => part.text ?? "").join("").trim()
    : (messageContent ?? "").trim();

  return {
    ok: true,
    model,
    content
  };
}

function recommendationKey(recommendation: Recommendation): string {
  return `${recommendation.fixtureId}::${recommendation.market}::${recommendation.selectionName}`;
}

function strengthScore(strength: Fixture["homeStrength"]): number {
  if (strength === "elite") return 4;
  if (strength === "strong") return 3;
  if (strength === "average") return 2;
  return 1;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averagePlayerMetric(players: Fixture["lineup"]["home"], key: "fitness" | "recentForm"): number {
  return average(players.map((player) => player[key]));
}

function marketSensitivityLabel(market: string): string {
  if (market.includes("半場")) {
    return "半場盤對第一顆入球、換人與節奏轉換特別敏感。";
  }

  if (market.includes("角球")) {
    return "角球盤更受壓迫強度、邊路推進與落後追分影響。";
  }

  if (market.includes("大小")) {
    return "入球大小盤主要看早段進球、節奏和雙方風格是否放大事件序列。";
  }

  if (market.includes("主客和")) {
    return "主客和更依賴基本面與臨場陣容，若陣容確認可提升統計模型可信度。";
  }

  return "此盤型對事件節奏有一定敏感度，需要同時看統計分數與戰術語境。";
}

export function buildHybridAiSignals(snapshot: { fixtures: Fixture[]; recommendations: Recommendation[] }): HybridAiSignals {
  const fixtureById = new Map(snapshot.fixtures.map((fixture) => [fixture.id, fixture]));
  const topRecommendations = [...snapshot.recommendations]
    .sort((left, right) => right.confidence - left.confidence || right.edgeScore - left.edgeScore || right.valueScore - left.valueScore)
    .slice(0, 3);

  const semanticObservations: string[] = [];
  const eventSensitivity: string[] = [];
  const hybridCalibration: string[] = [];
  const confidenceAnchors: string[] = [];

  for (const recommendation of topRecommendations) {
    const fixture = fixtureById.get(recommendation.fixtureId);
    if (!fixture) {
      continue;
    }

    const strengthGap = strengthScore(fixture.homeStrength) - strengthScore(fixture.awayStrength);
    const recentFormGap = fixture.homeRecentPoints - fixture.awayRecentPoints;
    const homeFitness = averagePlayerMetric(fixture.lineup.home, "fitness");
    const awayFitness = averagePlayerMetric(fixture.lineup.away, "fitness");
    const lineupFitnessGap = homeFitness - awayFitness;
    const oddsHistory = fixture.oddsHistory;
    const firstOdds = oddsHistory[0];
    const lastOdds = oddsHistory[oddsHistory.length - 1];
    const oddsDrift = firstOdds && lastOdds ? lastOdds.homeWin - firstOdds.homeWin : 0;
    const oddsVolatility = oddsHistory.length > 1
      ? Math.max(
          ...oddsHistory.map((point) => point.homeWin),
          ...oddsHistory.map((point) => point.draw),
          ...oddsHistory.map((point) => point.awayWin)
        ) -
        Math.min(
          ...oddsHistory.map((point) => point.homeWin),
          ...oddsHistory.map((point) => point.draw),
          ...oddsHistory.map((point) => point.awayWin)
        )
      : 0;

    semanticObservations.push(
      `${recommendation.match}｜${recommendation.market}／${recommendation.selectionName}：強弱差 ${strengthGap > 0 ? `主隊領先 ${strengthGap}` : strengthGap < 0 ? `客隊領先 ${Math.abs(strengthGap)}` : "平衡"}，近況差 ${recentFormGap > 0 ? `主隊優勢 ${recentFormGap}` : recentFormGap < 0 ? `客隊優勢 ${Math.abs(recentFormGap)}` : "接近"}，陣容體能差 ${lineupFitnessGap.toFixed(1)}。`
    );

    eventSensitivity.push(
      `${recommendation.match}｜${recommendation.market}：${marketSensitivityLabel(recommendation.market)} 陣容${fixture.lineup.confirmed ? "已確認" : "未確認"}，事件敏感度 ${fixture.lineup.confirmed ? "中" : "高"}。`
    );

    hybridCalibration.push(
      `${recommendation.match}｜統計分數 ${recommendation.confidence}%、優勢值 ${recommendation.edgeScore.toFixed(2)}%、值搏率 ${recommendation.valueScore.toFixed(3)}；賠率波動 ${oddsVolatility.toFixed(2)}，可用作混合校準信號。`
    );

    confidenceAnchors.push(
      `${recommendation.match}｜賠率由 ${firstOdds?.homeWin?.toFixed(2) ?? "-"} / ${firstOdds?.draw?.toFixed(2) ?? "-"} / ${firstOdds?.awayWin?.toFixed(2) ?? "-"} 走到 ${lastOdds?.homeWin?.toFixed(2) ?? "-"} / ${lastOdds?.draw?.toFixed(2) ?? "-"} / ${lastOdds?.awayWin?.toFixed(2) ?? "-"}，主賠 drift ${oddsDrift >= 0 ? "+" : ""}${oddsDrift.toFixed(2)}。`
    );
  }

  return {
    semanticObservations,
    eventSensitivity,
    hybridCalibration,
    confidenceAnchors
  };
}

export async function reviewRecommendationsForConsensus(
  recommendations: Recommendation[],
  options: AssistantOptions = {}
): Promise<RecommendationConsensusResult> {
  const primaryModel = options.model?.trim() || DEFAULT_OPENROUTER_MODEL;
  const fallbackModels = (options.fallbackModels ?? []).map((model) => model.trim()).filter((model) => model.length > 0);
  const candidateModels = buildCandidateModels(primaryModel, fallbackModels);
  const apiKey = options.apiKey?.trim();

  if (!apiKey || recommendations.length === 0) {
    const missingApiKeyIssue = !apiKey ? "OpenRouter consensus disabled: missing OPENROUTER_API_KEY." : undefined;
    return {
      reviewMode: "local_fallback",
      model: primaryModel,
      summary: "未啟用 AI 共識審查，保留模型主選結果。",
      recommendations,
      rejectedRecommendations: [],
      dataIssues: missingApiKeyIssue ? [missingApiKeyIssue] : [],
      consensusNotes: {}
    };
  }

  const prompt = [
    "你是投注模型的第二審查助手。以下 recommendations 已經是本地模型先挑出的 shortlist。",
    "你的工作：先判斷每一項是否真的值得推介；如有分歧，進行二次協調，最後只保留模型與 AI 都認同的結果。",
    "規則：",
    "1. 只能從提供的候選中選擇，不可新增候選。",
    "2. 只輸出 JSON，欄位包含 summary, finalPicks, rejectedPicks, dataIssues。",
    "3. finalPicks 每項包含 fixtureId, market, selectionName, consensusNote。",
    "4. rejectedPicks 每項包含 fixtureId, market, selectionName, rejectionNote。",
    "5. 如果候選值得保留，consensusNote 要說明雙方最終認同的理由；如果沒有值得保留的，finalPicks 可以為空。",
    "6. 先閱讀 hybridSignals，從語義、事件敏感度、校準三個角度做混合式推理；若盤口對事件節奏非常敏感，請明確指出。",
    "7. 先閱讀 externalEnrichment，將外部新聞、傷停與天氣的突發變化併入判斷。",
    "8. 對於 currentOdds >= highOddsThreshold 的候選，請執行高水二審：必須同時檢查 edgeScore 與 valueScore 是否足夠，以及是否存在可解釋的事件風險緩衝；若不足請拒絕。",
    "9. 對於通過高水二審者，consensusNote 需包含一句高水結論（例如：高水可試/只宜小注/風險過高）。",
    `recommendations=${JSON.stringify(recommendations)}`
  ].join("\n");

  const attemptErrors: string[] = [];
  let lastRawResponse: string | undefined;

  for (const model of candidateModels) {
    const result = await requestOpenRouterInsight(model, prompt, options, apiKey);
    if (!result.ok) {
      attemptErrors.push(`OpenRouter ${model} failed with status ${result.status}`);
      lastRawResponse = result.rawResponse;
      continue;
    }

    try {
      const parsed = recommendationConsensusSchema.parse(JSON.parse(result.content));
      const byKey = new Map(recommendations.map((recommendation) => [recommendationKey(recommendation), recommendation]));
      const approvedKeys = new Set<string>();
      const consensusNotes: Record<string, string> = {};
      const approvedRecommendations = parsed.finalPicks
        .map((pick) => {
          const key = `${pick.fixtureId}::${pick.market}::${pick.selectionName}`;
          const recommendation = byKey.get(key);
          if (!recommendation) {
            return null;
          }

          approvedKeys.add(key);
          consensusNotes[key] = pick.consensusNote;

          return {
            ...recommendation,
            reason: `${recommendation.reason}｜AI 共識：${pick.consensusNote}`
          };
        })
        .filter((recommendation): recommendation is Recommendation => recommendation !== null);

      const rejectedByKey = new Map(
        parsed.rejectedPicks.map((pick) => [
          `${pick.fixtureId}::${pick.market}::${pick.selectionName}`,
          pick.rejectionNote
        ])
      );
      const rejectedRecommendations = recommendations
        .filter((recommendation) => !approvedKeys.has(recommendationKey(recommendation)))
        .map((recommendation) => {
          const key = recommendationKey(recommendation);
          const rejectionNote = rejectedByKey.get(key) ?? "AI 認為此候選風險或一致性不足，暫不建議推介。";
          return {
            ...recommendation,
            reason: `${recommendation.reason}｜AI 拒絕：${rejectionNote}`
          };
        });

      return {
        reviewMode: "openrouter",
        model,
        summary: parsed.summary,
        recommendations: approvedRecommendations,
        rejectedRecommendations,
        dataIssues: parsed.dataIssues,
        consensusNotes
      };
    } catch {
      attemptErrors.push(`OpenRouter ${model} returned non-JSON consensus content`);
      lastRawResponse = result.content;
    }
  }

  return {
    reviewMode: "local_fallback",
    model: primaryModel,
    summary: "AI 共識審查未能完成，保留模型主選結果。",
    recommendations,
    rejectedRecommendations: [],
    dataIssues:
      attemptErrors.length > 0 ? [`OpenRouter consensus fallback exhausted: ${attemptErrors.join(" | ")}`] : ["OpenRouter consensus fallback exhausted."].filter(Boolean),
    consensusNotes: {}
  };
}

export async function generateAssistantInsight(
  context: AssistantReviewContext,
  options: AssistantOptions = {}
): Promise<ModelAssistantInsight> {
  const primaryModel = options.model?.trim() || DEFAULT_OPENROUTER_MODEL;
  const fallbackModels = (options.fallbackModels ?? []).map((model) => model.trim()).filter((model) => model.length > 0);
  const candidateModels = buildCandidateModels(primaryModel, fallbackModels);
  const apiKey = options.apiKey?.trim();

  if (!apiKey) {
    return {
      ...buildLocalInsight(context, primaryModel),
      dataIssues: ["OpenRouter disabled: missing OPENROUTER_API_KEY."]
    };
  }

  const prompt = [
    "你是足球投注模型審查助手，請根據以下 JSON context 產生嚴格 JSON，不要加額外文字。",
    "要求：",
    "1. 以繁體中文回答。",
    "2. 只輸出 JSON，欄位包含 summary, keyFindings, dataIssues, actionItems, suggestedWeights, suggestedThresholds, confidence。",
    "3. suggestedWeights / suggestedThresholds 只可提供小幅調整。",
    "4. 如果資料不足，請保守建議，不要大幅改動。",
    "5. 先閱讀 hybridSignals，從語義、事件敏感度、校準三個角度做混合式推理。",
    "6. 先閱讀 externalEnrichment，把外部新聞、傷停與天氣納入同一個判斷流程。",
    `context=${JSON.stringify(context)}`
  ].join("\n");

  const attemptErrors: string[] = [];
  let lastRawResponse: string | undefined;

  for (const model of candidateModels) {
    const result = await requestOpenRouterInsight(model, prompt, options, apiKey);
    if (!result.ok) {
      attemptErrors.push(`OpenRouter ${model} failed with status ${result.status}`);
      lastRawResponse = result.rawResponse;
      continue;
    }

    try {
      const parsed = assistantResponseSchema.parse(JSON.parse(result.content));
      return {
        runAt: new Date().toISOString(),
        reviewMode: "openrouter",
        model: result.model,
        summary: parsed.summary,
        keyFindings: parsed.keyFindings,
        dataIssues: parsed.dataIssues,
        actionItems: parsed.actionItems,
        enrichment: context.externalEnrichment
          ? {
              news: context.externalEnrichment.news,
              injuries: context.externalEnrichment.injuries,
              weather: context.externalEnrichment.weather,
              issues: context.externalEnrichment.issues,
              sourcePolicy: context.externalEnrichment.sourcePolicy
            }
          : undefined,
        suggestedWeights: parsed.suggestedWeights,
        suggestedThresholds: parsed.suggestedThresholds,
        confidence: parsed.confidence,
        applied: false,
        sourceLabels: context.practice?.sources.map((source) => source.label) ?? [],
        rawResponse: result.content
      };
    } catch {
      attemptErrors.push(`OpenRouter ${model} returned non-JSON content`);
      lastRawResponse = result.content;
    }
  }

  return {
    ...buildLocalInsight(context, primaryModel),
    dataIssues:
      attemptErrors.length > 0 ? [`OpenRouter fallback chain exhausted: ${attemptErrors.join(" | ")}`] : ["OpenRouter fallback chain exhausted."],
    rawResponse: lastRawResponse
  };
}
