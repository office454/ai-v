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
    diagnostics?: {
      summary: string;
      weakestMarket: string | null;
      weakestMarketHitRate: number | null;
      weakestMarketSample: number | null;
      actionItems: string[];
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
  ollamaEnabled?: boolean;
  ollamaBaseUrl?: string;
  ollamaApiKey?: string;
  ollamaModel?: string;
  ollamaFallbackModels?: string[];
  providerTimeoutMs?: number;
  temperature?: number;
  referer?: string;
  title?: string;
  requireRecommendation?: boolean;
  fixtureContext?: Fixture;
};

type AssistantProvider = "ollama" | "openrouter";

type ProviderCandidate = {
  provider: AssistantProvider;
  apiKey?: string;
  model: string;
};

export type HybridAiSignals = {
  semanticObservations: string[];
  eventSensitivity: string[];
  hybridCalibration: string[];
  confidenceAnchors: string[];
};

export type RecommendationConsensusSummarySection = {
  title: string;
  items: string[];
};

export type RecommendationConsensusResult = {
  reviewMode: "ollama" | "openrouter" | "local_fallback";
  model: string;
  summary: string;
  summarySections: RecommendationConsensusSummarySection[];
  recommendations: Recommendation[];
  rejectedRecommendations: Recommendation[];
  dataIssues: string[];
  consensusNotes: Record<string, string>;
  discussion?: {
    localAnalysis: string;
    ollamaAnalysis: string;
    jointDecision: string;
    latestInfoAt: string;
  };
};

type ChatCompletionSuccessPayload = {
  message?: { content?: string | Array<{ text?: string }> };
  choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
};

function normalizeJsonText(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return "";
  }

  const fencedMatch = trimmed.match(/^```(?:json)?\s*(\{[\s\S]*\})\s*```$/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const plainJsonMatch = trimmed.match(/^\{[\s\S]*\}$/);
  if (plainJsonMatch) {
    return plainJsonMatch[0].trim();
  }

  return trimmed;
}

type ProviderAttemptResult =
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
const DEFAULT_OLLAMA_MODEL = "qwen2.5-coder:14b";
const DEFAULT_OPENROUTER_FREE_MODELS = [
  "openrouter/free",
  "inclusionai/ling-3.0-flash-fin:free",
  "poolside/laguna-xs-2.1:free",
  "cohere/north-mini-code:free",
  "google/gemma-4-31b-it:free"
];

const CHINESE_CHARACTER_PATTERN = /[\u3400-\u9fff]/;

function allUserFacingTextIsChinese(values: string[]): boolean {
  return values.every((value) => CHINESE_CHARACTER_PATTERN.test(value));
}

function openRouterFailureMessage(model: string, status: number): string {
  if (status === 0) {
    return `OpenRouter ${model} 連線失敗`;
  }
  if (status === 402) {
    return `OpenRouter ${model} 帳戶額度不足（HTTP 402）`;
  }
  if (status === 429) {
    return `OpenRouter ${model} 免費日額或速率已達上限（HTTP 429）`;
  }
  if (status === 404) {
    return `OpenRouter ${model} 模型目前不可用（HTTP 404）`;
  }
  return `OpenRouter ${model} 請求失敗（HTTP ${status}）`;
}

function ollamaFailureMessage(model: string, status: number): string {
  if (status === 0) {
    return `Ollama ${model} 本機服務連線失敗`;
  }
  if (status === 404) {
    return `Ollama ${model} 尚未下載或模型不存在（HTTP 404）`;
  }
  return `Ollama ${model} 請求失敗（HTTP ${status}）`;
}

function buildAutoApplySuggestion(context: AssistantReviewContext): {
  suggestedWeights?: Partial<ScoringWeights>;
  suggestedThresholds?: {
    minRecommendedOdds?: number;
    highOddsThreshold?: number;
    highOddsMinEdgeScore?: number;
    highOddsMinValueScore?: number;
  };
  confidence: number;
} {
  const diagnostics = context.learning.diagnostics;
  if (!diagnostics?.weakestMarket) {
    return { confidence: 0.45 };
  }

  const weakHitRate = diagnostics.weakestMarketHitRate ?? 0.4;
  const weakSample = diagnostics.weakestMarketSample ?? 0;
  const weightShift = Math.min(0.12, Math.max(0.03, (0.5 - weakHitRate) * 0.35));
  const confidence = weakHitRate < 0.5 ? 0.82 : 0.68;

  return {
    suggestedWeights: {
      oddsMomentum: Math.max(0.02, (context.weights.oddsMomentum ?? 0.1) - weightShift),
      recentForm: Math.min(0.35, (context.weights.recentForm ?? 0.18) + weightShift * 0.45),
      expertSentiment: Math.min(0.3, (context.weights.expertSentiment ?? 0.12) + weightShift * 0.3),
      strengthGap: Math.min(0.4, (context.weights.strengthGap ?? 0.3) + weightShift * 0.2)
    },
    suggestedThresholds: {
      minRecommendedOdds: Number(
        Math.min(2.4, (context.thresholds.minRecommendedOdds ?? 1.4) + (weakSample < 10 ? 0.08 : 0.04)).toFixed(2)
      ),
      highOddsThreshold: Number(
        Math.min(3.4, (context.thresholds.highOddsThreshold ?? 2.2) + (weakSample < 10 ? 0.12 : 0.06)).toFixed(2)
      ),
      highOddsMinEdgeScore: Number(
        Math.min(6.0, (context.thresholds.highOddsMinEdgeScore ?? 2.2) + 0.4).toFixed(2)
      ),
      highOddsMinValueScore: Number(
        Math.min(0.25, (context.thresholds.highOddsMinValueScore ?? 0.07) + 0.01).toFixed(3)
      )
    },
    confidence
  };
}

function buildCandidateModels(primaryModel: string, configuredFallbacks: string[]): string[] {
  return [primaryModel, ...configuredFallbacks, ...DEFAULT_OPENROUTER_FREE_MODELS].filter(
    (model, index, values) => model.length > 0 && values.indexOf(model) === index
  );
}

function buildProviderCandidates(options: AssistantOptions): ProviderCandidate[] {
  const candidates: ProviderCandidate[] = [];
  if (options.ollamaEnabled) {
    const ollamaApiKey = options.ollamaApiKey?.trim();
    const ollamaModels = [
      options.ollamaModel?.trim() || DEFAULT_OLLAMA_MODEL,
      ...(options.ollamaFallbackModels ?? []).map((model) => model.trim()).filter(Boolean)
    ].filter((model, index, models) => model.length > 0 && models.indexOf(model) === index);
    for (const model of ollamaModels) {
      candidates.push({ provider: "ollama", apiKey: ollamaApiKey || undefined, model });
    }
  }

  const openRouterApiKey = options.apiKey?.trim();
  if (openRouterApiKey) {
    const primaryModel = options.model?.trim() || DEFAULT_OPENROUTER_MODEL;
    const fallbackModels = (options.fallbackModels ?? []).map((model) => model.trim()).filter(Boolean);
    for (const model of buildCandidateModels(primaryModel, fallbackModels)) {
      candidates.push({ provider: "openrouter", apiKey: openRouterApiKey, model });
    }
  }

  return candidates;
}

function normalizeConfidence(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim();
  const numericValue = Number(normalized);
  if (Number.isFinite(numericValue)) return numericValue;
  if (["高", "偏高", "高信心"].includes(normalized)) return 0.8;
  if (["中", "中等", "普通", "中度"].includes(normalized)) return 0.5;
  if (["低", "偏低", "低信心"].includes(normalized)) return 0.3;
  return value;
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
    confidence: z.preprocess(normalizeConfidence, z.number().min(0).max(1).default(0.5))
  })
  .strict();

const recommendationConsensusSchema = z
  .object({
    summary: z.string().min(1),
    ollamaAnalysis: z.string().min(1).optional(),
    jointDecision: z.string().min(1).optional(),
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

const assistantResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "keyFindings", "dataIssues", "actionItems", "confidence"],
  properties: {
    summary: { type: "string" },
    keyFindings: { type: "array", items: { type: "string" } },
    dataIssues: { type: "array", items: { type: "string" } },
    actionItems: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
};

const recommendationConsensusJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "finalPicks", "rejectedPicks", "dataIssues"],
  properties: {
    summary: { type: "string" },
    ollamaAnalysis: { type: "string" },
    jointDecision: { type: "string" },
    finalPicks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fixtureId", "market", "selectionName", "consensusNote"],
        properties: {
          fixtureId: { type: "string" },
          market: { type: "string" },
          selectionName: { type: "string" },
          consensusNote: { type: "string" }
        }
      }
    },
    rejectedPicks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fixtureId", "market", "selectionName", "rejectionNote"],
        properties: {
          fixtureId: { type: "string" },
          market: { type: "string" },
          selectionName: { type: "string" },
          rejectionNote: { type: "string" }
        }
      }
    },
    dataIssues: { type: "array", items: { type: "string" } }
  }
};

function localFixtureAnalysis(recommendation: Recommendation): string {
  return `主分析模型選出「${recommendation.market}／${recommendation.selectionName}」，賠率 ${recommendation.currentOdds.toFixed(2)}、信心 ${recommendation.confidence.toFixed(1)}%、優勢值 ${recommendation.edgeScore.toFixed(2)}%、值搏率 ${recommendation.valueScore.toFixed(3)}。${recommendation.reason}`;
}

function localFixtureContextAnalysis(fixture: Fixture): string {
  const score = fixture.finalScore ?? fixture.halfTimeScore;
  const scoreLabel = score ? `${score.home}:${score.away}` : "未有比分";
  const corners = fixture.finalCorners ?? fixture.halfTimeCorners;
  const cornerLabel = corners ? `${corners.home}:${corners.away}` : "未有角球數據";
  const marketOptions = fixture.marketOptions.filter((option) => option.currentOdds > 1);
  const marketSummary = marketOptions.length > 0
    ? `已讀取 ${marketOptions.length} 項 HKJC 有效賠率盤口，但沒有選出符合模型條件的方向`
    : "HKJC 本次回傳沒有有效賠率盤口";
  return `${fixture.homeTeam} 對 ${fixture.awayTeam}：${marketSummary}；目前比分 ${scoreLabel}、角球 ${cornerLabel}。本輪只作賽事觀察，不構成投注建議。`;
}

function compactFixtureContext(fixture: Fixture): Record<string, unknown> {
  return {
    fixtureId: fixture.id,
    match: `${fixture.homeTeam} vs ${fixture.awayTeam}`,
    league: fixture.league,
    kickoffAt: fixture.kickoffAt,
    status: fixture.status,
    liveMinute: fixture.liveMinute,
    halfTimeScore: fixture.halfTimeScore,
    finalScore: fixture.finalScore,
    halfTimeCorners: fixture.halfTimeCorners,
    finalCorners: fixture.finalCorners,
    recentPoints: { home: fixture.homeRecentPoints, away: fixture.awayRecentPoints },
    strength: { home: fixture.homeStrength, away: fixture.awayStrength },
    lineupConfirmed: fixture.lineup.confirmed,
    lineupUpdatedAt: fixture.lineup.updatedAt,
    liveDataSources: fixture.liveDataSources,
    liveAttackingMetrics: fixture.liveAttackingMetrics,
    livePressureMetrics: fixture.livePressureMetrics,
    marketOptions: fixture.marketOptions
      .filter((option) => option.currentOdds > 1)
      .slice(0, 12)
      .map((option) => ({
      oddsType: option.oddsType,
      market: option.oddsTypeName,
      selectionCode: option.selectionCode,
      selectionName: option.selectionName,
      lineCondition: option.lineCondition,
      currentOdds: option.currentOdds,
      inplay: option.inplay,
      poolStatus: option.poolStatus,
      combinationStatus: option.combinationStatus,
      lineStatus: option.lineStatus,
      updatedAt: option.updatedAt,
      observedAt: option.observedAt
    }))
  };
}

function compactRecommendationForAi(recommendation: Recommendation): Record<string, unknown> {
  return {
    fixtureId: recommendation.fixtureId,
    match: recommendation.match,
    market: recommendation.market,
    selectionName: recommendation.selectionName,
    currentOdds: recommendation.currentOdds,
    confidence: recommendation.confidence,
    edgeScore: recommendation.edgeScore,
    valueScore: recommendation.valueScore
  };
}

function compactAssistantContext(context: AssistantReviewContext): Record<string, unknown> {
  return {
    dataSource: {
      provider: context.dataSource.provider,
      fixtureCount: context.dataSource.fixtureCount,
      ok: context.dataSource.ok
    },
    backtestSummary: context.backtestSummary,
    autoTraining: context.autoTraining,
    learning: {
      pendingCount: context.learning.pendingCount,
      settledCount: context.learning.settledCount,
      diagnostics: context.learning.diagnostics
    },
    thresholds: context.thresholds,
    weights: context.weights,
    recommendations: context.recommendations.slice(0, 3).map(compactRecommendationForAi),
    hybridSignals: context.hybridSignals ? {
      semanticObservations: context.hybridSignals.semanticObservations.slice(0, 2),
      eventSensitivity: context.hybridSignals.eventSensitivity.slice(0, 2),
      hybridCalibration: context.hybridSignals.hybridCalibration.slice(0, 2),
      confidenceAnchors: context.hybridSignals.confidenceAnchors.slice(0, 2)
    } : undefined,
    externalEnrichment: context.externalEnrichment ? {
      news: context.externalEnrichment.news.slice(0, 2),
      injuries: context.externalEnrichment.injuries.slice(0, 2),
      weather: context.externalEnrichment.weather.slice(0, 2),
      issues: context.externalEnrichment.issues.slice(0, 2)
    } : undefined
  };
}

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
  const diagnostics = context.learning.diagnostics;
  const summary = [
    `本輪練習來源 ${practiceSourceCount} 個，新增訓練記錄 ${practiceAdded} 筆。`,
    `自動訓練近期命中率 ${Math.round(context.autoTraining.recentHitRate * 100)}%。`,
    diagnostics?.summary ?? (hasLearningPenalty ? "已存在明確盲點修正，可持續收斂高風險市場。" : "目前盲點資料仍少，先保守微調。")
  ].join(" ");

  const keyFindings = [
    `主資料源為 ${context.dataSource.provider}，目前有 ${context.dataSource.fixtureCount} 場可用賽事。`,
    `近期 auto 訓練樣本 ${context.autoTraining.recentSample} 筆，命中率 ${Math.round(context.autoTraining.recentHitRate * 100)}%。`,
    diagnostics?.weakestMarket
      ? `目前最弱市場是 ${diagnostics.weakestMarket}（命中 ${((diagnostics.weakestMarketHitRate ?? 0) * 100).toFixed(1)}%，樣本 ${diagnostics.weakestMarketSample ?? 0}）。`
      : "目前尚未識別出明顯盲點市場。",
    `高 odds 門檻為 ${context.thresholds.highOddsThreshold}，最低推薦 odds 為 ${context.thresholds.minRecommendedOdds}。`,
    `高水二審 EV 門檻：edge >= ${context.thresholds.highOddsMinEdgeScore}% 且 valueScore >= ${context.thresholds.highOddsMinValueScore.toFixed(3)}。`,
    ...(diagnostics?.actionItems ?? []).slice(0, 2),
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

  const autoApplySuggestion = buildAutoApplySuggestion(context);

  return {
    runAt: new Date().toISOString(),
    reviewMode: "local_fallback",
    model,
    summary,
    keyFindings,
    dataIssues: context.dataSource.lastError ? [context.dataSource.lastError] : [],
    actionItems,
    enrichment,
    suggestedWeights: autoApplySuggestion.suggestedWeights ?? (hasLearningPenalty
      ? {
          oddsMomentum: Math.max(0, context.weights.oddsMomentum - 0.03)
        }
      : undefined),
    suggestedThresholds: autoApplySuggestion.suggestedThresholds,
    confidence: autoApplySuggestion.confidence,
    applied: false,
    sourceLabels: context.practice?.sources.map((source) => source.label) ?? [],
    rawResponse: undefined
  };
}

async function readOllamaStreamContent(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let content = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let newlineIndex = buffered.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffered.slice(0, newlineIndex).trim();
      buffered = buffered.slice(newlineIndex + 1);
      newlineIndex = buffered.indexOf("\n");
      if (!line) continue;
      try {
        const chunk = JSON.parse(line) as { message?: { content?: string }; error?: string };
        if (chunk.error) {
          throw new Error(chunk.error);
        }
        content += chunk.message?.content ?? "";
      } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
    }
  }

  return content.trim();
}

async function requestProviderInsight(
  candidate: ProviderCandidate,
  prompt: string,
  options: AssistantOptions,
  jsonSchema: Record<string, unknown>
): Promise<ProviderAttemptResult> {
  let response: Response;
  try {
    const isDeepSeekR1 = candidate.model.toLowerCase().startsWith("deepseek-r1");
    response = await fetch(candidate.provider === "ollama"
      ? `${(options.ollamaBaseUrl?.trim() || "http://127.0.0.1:11434").replace(/\/$/, "")}/api/chat`
      : "https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        ...(candidate.apiKey ? { Authorization: `Bearer ${candidate.apiKey}` } : {}),
        ...(candidate.provider === "openrouter" ? {
          "HTTP-Referer": options.referer?.trim() || "http://localhost:5173",
          "X-Title": options.title?.trim() || "HK Football Value Picks Dashboard"
        } : {}),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(
      candidate.provider === "ollama"
        ? {
            model: candidate.model,
            ...(!isDeepSeekR1 ? { think: false, format: "json" } : {}),
            stream: true,
            options: {
              temperature: options.temperature ?? 0.2,
              num_predict: options.requireRecommendation ? 240 : 640
              },
              messages: [
                {
                  role: "system",
                  content: "你是投注模型的第二審查助手。只輸出單一有效 JSON object，不可使用 Markdown code fence 或加入 JSON 以外文字。所有面向使用者的字串值必須使用繁體中文。"
                },
                {
                  role: "user",
                  content: prompt
                }
              ]
            }
          : {
              model: candidate.model,
              temperature: options.temperature ?? 0.2,
              messages: [
                {
                  role: "system",
                  content: "你是嚴格輸出 JSON 的模型審查助手。所有面向使用者的字串值必須使用繁體中文，不可用英文句子回答。"
                },
                {
                  role: "user",
                  content: prompt
                }
              ]
            }
        ),
        signal: AbortSignal.timeout(options.providerTimeoutMs ?? (options.requireRecommendation ? 45000 : (candidate.provider === "ollama" ? 170000 : 90000)))
    });
  } catch (error) {
    console.warn(
      `[assistant] ${candidate.provider} ${candidate.model} request failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return {
      ok: false,
      model: candidate.model,
      status: 0,
      rawResponse: error instanceof Error ? error.message : String(error)
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      model: candidate.model,
      status: response.status,
      rawResponse: await response.text().catch(() => undefined)
    };
  }

  if (candidate.provider === "ollama" && response.body) {
    return {
      ok: true,
      model: candidate.model,
      content: await readOllamaStreamContent(response.body)
    };
  }

  const payload = (await response.json()) as ChatCompletionSuccessPayload;
  const messageContent = payload.message?.content ?? payload.choices?.[0]?.message?.content;
  const content = Array.isArray(messageContent)
    ? messageContent.map((part) => part.text ?? "").join("").trim()
    : (messageContent ?? "").trim();

  return {
    ok: true,
    model: candidate.model,
    content
  };
}

function recommendationKey(recommendation: Recommendation): string {
  return `${recommendation.fixtureId}::${recommendation.market}::${recommendation.selectionName}`;
}

export function buildConsensusSummarySections(summary: string): RecommendationConsensusSummarySection[] {
  const sentenceParts = summary
    .split(/(?:[。；;!?]+|\.(?:\s+|$))/)
    .map((part) => part.trim())
    .filter(Boolean);

  const sections: RecommendationConsensusSummarySection[] = [
    { title: "保留項目", items: [] },
    { title: "拒絕項目", items: [] },
    { title: "高水風險", items: [] },
    { title: "分歧焦點", items: [] }
  ];

  for (const part of sentenceParts) {
    const lower = part.toLowerCase();
    const matchedFlags = new Set<string>();

    if (
      lower.includes("保留") ||
      lower.includes("值得保留") ||
      lower.includes("認同") ||
      /\b(retain(?:ed)?|approved?|final picks?|passed consensus)\b/.test(lower)
    ) {
      matchedFlags.add("保留項目");
    }
    if (
      lower.includes("拒絕") ||
      lower.includes("不建議") ||
      lower.includes("風險過大") ||
      /\b(reject(?:ed)?|declined?|insufficient|not recommended)\b/.test(lower)
    ) {
      matchedFlags.add("拒絕項目");
    }
    if (
      lower.includes("高水") ||
      lower.includes("風險") ||
      lower.includes("小注") ||
      lower.includes("只宜") ||
      /\b(high-water|risks?|volatil(?:e|ity)|small stake|event sensitivity)\b/.test(lower)
    ) {
      matchedFlags.add("高水風險");
    }
    if (
      lower.includes("分歧") ||
      lower.includes("事件節奏") ||
      lower.includes("差異") ||
      lower.includes("不一致") ||
      /\b(disagreement|divergen(?:ce|t)|conflict|differ(?:ence|ent)?|sensitivity)\b/.test(lower)
    ) {
      matchedFlags.add("分歧焦點");
    }

    if (matchedFlags.size === 0) {
      sections[0].items.push(part);
      continue;
    }

    for (const flag of matchedFlags) {
      const index = sections.findIndex((section) => section.title === flag);
      if (index >= 0) {
        sections[index].items.push(part);
      }
    }
  }

  return sections.map((section) => ({
    ...section,
    items: section.items.length > 0 ? section.items : [`本輪未識別${section.title}相關內容。`]
  }));
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
  return average(
    players
      .map((player) => player[key])
      .filter((value): value is number => Number.isFinite(value))
  );
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
  const providerCandidates = buildProviderCandidates(options);
  const primaryModel = providerCandidates[0]?.model ?? options.model?.trim() ?? DEFAULT_OPENROUTER_MODEL;
  const hasNoPickFixtureAnalysis = recommendations.length === 0
    && !!options.fixtureContext
    && !options.requireRecommendation;
  const localAnalysis = recommendations[0]
    ? localFixtureAnalysis(recommendations[0])
    : options.fixtureContext
      ? localFixtureContextAnalysis(options.fixtureContext)
      : "主分析模型未找到有效盤口候選。";
  const latestInfoAt = new Date().toISOString();

  if (providerCandidates.length === 0 || (recommendations.length === 0 && !hasNoPickFixtureAnalysis)) {
    const missingApiKeyIssue = providerCandidates.length === 0 ? "未啟用 OLLAMA 或未設定 OPENROUTER_API_KEY，AI 共識審查未啟用。" : undefined;
    const fallbackNote = hasNoPickFixtureAnalysis
      ? "目前沒有符合條件的 HKJC 推介，只作賽事觀察。"
      : "AI 服務暫時未能完成討論，未形成共同最終推介。";
    const fallbackSummary = providerCandidates.length === 0
      ? "未啟用 AI 共識審查，保留模型主選結果。"
      : fallbackNote;
    return {
      reviewMode: "local_fallback",
      model: primaryModel,
      summary: fallbackSummary,
      summarySections: buildConsensusSummarySections(fallbackSummary),
      recommendations: [],
      rejectedRecommendations: [],
      dataIssues: missingApiKeyIssue ? [missingApiKeyIssue] : [],
      consensusNotes: {},
      discussion: options.requireRecommendation || options.fixtureContext ? {
        localAnalysis,
        ollamaAnalysis: providerCandidates.length === 0
          ? "未啟用 AI 服務，未完成獨立分析。"
          : "Ollama 暫時未能回應，未完成獨立分析。",
        jointDecision: fallbackNote,
        latestInfoAt
      } : undefined
    };
  }

  const prompt = [
    hasNoPickFixtureAnalysis
      ? "你是足球賽事數據分析助手。系統模型本輪沒有建立符合條件的 HKJC 推介。"
      : "你是投注模型的 AI 協作助手。以下 recommendations 是系統模型按即時數據排名的 1 至 4 個候選。",
    hasNoPickFixtureAnalysis
      ? "你的工作：只根據 latestFixture 及系統分析說明賽事狀態、比分、角球和可用盤口；不可虛構或推薦投注項目，finalPicks 與 rejectedPicks 必須保持空陣列。"
      : options.requireRecommendation
      ? "你的工作：根據系統模型提供的即時數據與候選，選出其中勝出機會最大的唯一一項作為共同最終推介；不可拒絕全部候選。"
      : "你的工作：先判斷每一項是否真的值得推介；如有分歧，進行二次協調，最後只保留模型與 AI 都認同的結果。",
    "規則：",
    "1. 所有面向使用者的字串值必須使用繁體中文，不可輸出英文句子；球隊、聯賽與模型專有名稱可保留原文。",
    "2. 只能從提供的候選中選擇，不可新增候選。",
    "3. 只輸出 JSON，欄位包含 summary, finalPicks, rejectedPicks, dataIssues。",
    "4. finalPicks 每項包含 fixtureId, market, selectionName, consensusNote。",
    "5. rejectedPicks 每項包含 fixtureId, market, selectionName, rejectionNote。",
    "5a. 為確保即時回應，summary、ollamaAnalysis、jointDecision、consensusNote、rejectionNote、dataIssues 每個字串最多 40 個繁體中文字；每個陣列最多一項。",
    hasNoPickFixtureAnalysis
      ? "6. 沒有可供推薦的候選；finalPicks、rejectedPicks 必須為空陣列，jointDecision 必須清楚指出本輪沒有投注推介。"
      : options.requireRecommendation
      ? "6. finalPicks 必須剛好有一項，consensusNote 要說明選擇理由及風險；不得把唯一候選放入 rejectedPicks。另須輸出 ollamaAnalysis 與 jointDecision。"
      : "6. 如果候選值得保留，consensusNote 要說明雙方最終認同的理由；如果沒有值得保留的，finalPicks 可以為空。",
    "7. 先閱讀 hybridSignals，從語義、事件敏感度、校準三個角度做混合式推理；若盤口對事件節奏非常敏感，請明確指出。",
    "8. 先閱讀 externalEnrichment，將外部新聞、傷停與天氣的突發變化併入判斷。",
    "9. 對於 currentOdds >= highOddsThreshold 的候選，請執行高水二審：必須同時檢查 edgeScore 與 valueScore 是否足夠，以及是否存在可解釋的事件風險緩衝；若不足請拒絕。",
    "10. 對於通過高水二審者，consensusNote 需包含一句高水結論（例如：高水可試/只宜小注/風險過高）。",
    ...(options.fixtureContext ? [
      `latestFixture=${JSON.stringify(compactFixtureContext(options.fixtureContext))}`,
      `localModelAnalysis=${JSON.stringify(localAnalysis)}`,
      hasNoPickFixtureAnalysis
        ? "請以繁體中文撰寫 ollamaAnalysis 的賽事數據觀察，jointDecision 明確表示沒有符合條件的投注推介，不可自行挑選盤口。"
        : "請先獨立分析 latestFixture，再對照 localModelAnalysis；ollamaAnalysis 寫你的獨立判斷，jointDecision 寫雙方合選的唯一推介及主要風險。"
    ] : []),
    `recommendations=${JSON.stringify(recommendations.map(compactRecommendationForAi))}`,
    "現在只輸出一個 JSON object，不可複述 recommendations，不可加入其他欄位。格式：{\"summary\":\"繁體中文\",\"ollamaAnalysis\":\"繁體中文\",\"jointDecision\":\"繁體中文\",\"finalPicks\":[],\"rejectedPicks\":[],\"dataIssues\":[]}"
  ].join("\n");

  const attemptErrors: string[] = [];

  for (const candidate of providerCandidates) {
    const providerLabel = candidate.provider === "ollama" ? "Ollama" : "OpenRouter";
    const result = await requestProviderInsight(candidate, prompt, options, recommendationConsensusJsonSchema);
    if (!result.ok) {
      attemptErrors.push(candidate.provider === "openrouter"
        ? openRouterFailureMessage(candidate.model, result.status)
        : ollamaFailureMessage(candidate.model, result.status));
      continue;
    }

    try {
      const parsedContent = normalizeJsonText(result.content);
      const parsed = recommendationConsensusSchema.parse(JSON.parse(parsedContent));
      const userFacingText = [
        parsed.summary,
        ...(parsed.ollamaAnalysis ? [parsed.ollamaAnalysis] : []),
        ...(parsed.jointDecision ? [parsed.jointDecision] : []),
        ...parsed.finalPicks.map((pick) => pick.consensusNote),
        ...parsed.rejectedPicks.map((pick) => pick.rejectionNote),
        ...parsed.dataIssues
      ];
      if (!allUserFacingTextIsChinese(userFacingText)) {
        attemptErrors.push(`${providerLabel} ${candidate.model} 未使用繁體中文輸出`);
        continue;
      }
      const byKey = new Map(recommendations.map((recommendation) => [recommendationKey(recommendation), recommendation]));
      const approvedKeys = new Set<string>();
      const consensusNotes: Record<string, string> = {};
      const approvedRecommendations: Recommendation[] = [];
      let forcedBestAvailableSelection = false;
      for (const pick of parsed.finalPicks) {
        const key = `${pick.fixtureId}::${pick.market}::${pick.selectionName}`;
        const recommendation = byKey.get(key);
        if (!recommendation) {
          continue;
        }

        approvedKeys.add(key);
        consensusNotes[key] = pick.consensusNote;
        approvedRecommendations.push({
          ...recommendation,
          aiConsensusNote: pick.consensusNote,
          reason: `${recommendation.reason}｜AI 共識：${pick.consensusNote}`
        });
      }

      if (options.requireRecommendation && approvedRecommendations.length === 0) {
        const fallbackRecommendation = recommendations[0];
        const rejectedNote = parsed.rejectedPicks.find((pick) =>
          pick.fixtureId === fallbackRecommendation.fixtureId
          && pick.market === fallbackRecommendation.market
          && pick.selectionName === fallbackRecommendation.selectionName
        )?.rejectionNote;
        const selectionNote = rejectedNote
          ? `在現有候選中仍以此項最合適；需留意：${rejectedNote}`
          : "在現有 HKJC 盤口候選中，此項的模型綜合排名最高，建議保守注碼。";
        const key = recommendationKey(fallbackRecommendation);
        approvedKeys.add(key);
        consensusNotes[key] = selectionNote;
        approvedRecommendations.push({
          ...fallbackRecommendation,
          aiConsensusNote: selectionNote,
          reason: `${fallbackRecommendation.reason}｜AI 討論：${selectionNote}`
        });
        forcedBestAvailableSelection = true;
      }

      const rejectedByKey = new Map(
        parsed.rejectedPicks.map((pick) => [
          `${pick.fixtureId}::${pick.market}::${pick.selectionName}`,
          pick.rejectionNote
        ])
      );
      const rejectedRecommendations: Recommendation[] = recommendations
        .filter((recommendation) => !approvedKeys.has(recommendationKey(recommendation)))
        .map((recommendation) => {
          const key = recommendationKey(recommendation);
          const rejectionNote = rejectedByKey.get(key) ?? "AI 認為此候選風險或一致性不足，暫不建議推介。";
          return {
            ...recommendation,
            aiRejectionNote: rejectionNote,
            reason: `${recommendation.reason}｜AI 拒絕：${rejectionNote}`
          };
        });

      return {
        reviewMode: candidate.provider,
        model: candidate.model,
        summary: forcedBestAvailableSelection
          ? "AI 已完成討論，並從現有 HKJC 盤口候選中選出模型綜合排名最高的一項；相關疑慮已保留為風險提示。"
          : parsed.summary,
        summarySections: buildConsensusSummarySections(forcedBestAvailableSelection
          ? "AI 已完成討論，並從現有 HKJC 盤口候選中選出模型綜合排名最高的一項；相關疑慮已保留為風險提示。"
          : parsed.summary),
        recommendations: approvedRecommendations,
        rejectedRecommendations,
        dataIssues: parsed.dataIssues,
        consensusNotes,
        discussion: options.requireRecommendation || options.fixtureContext ? {
          localAnalysis,
          ollamaAnalysis: parsed.ollamaAnalysis ?? parsed.summary,
          jointDecision: hasNoPickFixtureAnalysis
            ? "目前沒有符合條件的 HKJC 推介，本輪只作賽事觀察，不構成投注建議。"
            : parsed.jointDecision ?? approvedRecommendations[0]?.aiConsensusNote ?? parsed.summary,
          latestInfoAt
        } : undefined
      };
    } catch {
      attemptErrors.push(`${providerLabel} ${candidate.model} 回傳內容不是有效的共識審查 JSON`);
    }
  }

  return {
    reviewMode: "local_fallback",
    model: primaryModel,
    summary: hasNoPickFixtureAnalysis
      ? "AI 賽事分析未能完成；本輪沒有符合條件的 HKJC 推介。"
      : options.requireRecommendation
        ? "Ollama 協作暫時未能完成，未形成共同最終推介。"
        : "AI 共識審查未能完成，保留模型主選結果。",
    summarySections: buildConsensusSummarySections(hasNoPickFixtureAnalysis
      ? "AI 賽事分析未能完成；本輪沒有符合條件的 HKJC 推介。"
      : options.requireRecommendation
        ? "Ollama 協作暫時未能完成，未形成共同最終推介。"
        : "AI 共識審查未能完成，保留模型主選結果。"),
    recommendations: [],
    rejectedRecommendations: [],
    dataIssues:
      attemptErrors.length > 0 ? [`AI 共識審查已嘗試所有服務：${attemptErrors.join("；")}`] : ["AI 共識審查未能取得有效結果。"],
    consensusNotes: {},
    discussion: options.requireRecommendation || options.fixtureContext ? {
      localAnalysis,
      ollamaAnalysis: "Ollama 暫時未能回應，未完成獨立分析。",
      jointDecision: hasNoPickFixtureAnalysis
        ? "目前沒有符合條件的 HKJC 推介，本輪只作賽事觀察，不構成投注建議。"
        : "Ollama 未完成共同決策，待服務恢復後請重新分析。",
      latestInfoAt
    } : undefined
  };
}

export async function generateAssistantInsight(
  context: AssistantReviewContext,
  options: AssistantOptions = {}
): Promise<ModelAssistantInsight> {
  const primaryModel = options.model?.trim() || DEFAULT_OPENROUTER_MODEL;
  const providerCandidates = buildProviderCandidates(options);

  if (providerCandidates.length === 0) {
    return {
      ...buildLocalInsight(context, primaryModel),
      dataIssues: ["未啟用 OLLAMA 或未設定 OPENROUTER_API_KEY，使用本地規則審查。"]
    };
  }

  const prompt = [
    "你是足球投注模型審查助手，請根據以下 JSON context 產生嚴格 JSON，不要加額外文字。",
    "要求：",
    "1. 所有面向使用者的字串值必須使用繁體中文，不可輸出英文句子；球隊、聯賽與模型專有名稱可保留原文。",
    "2. summary、keyFindings、dataIssues、actionItems 的每個非空字串都必須包含繁體中文，且最多 40 個繁體中文字；keyFindings、dataIssues、actionItems 每個陣列最多一項。",
    "3. 只輸出 JSON，欄位包含 summary, keyFindings, dataIssues, actionItems, suggestedWeights, suggestedThresholds, confidence。",
    "4. suggestedWeights / suggestedThresholds 只可提供小幅調整。",
    "5. 如果資料不足，請保守建議，不要大幅改動。",
    "6. 先閱讀 hybridSignals，從語義、事件敏感度、校準三個角度做混合式推理。",
    "7. 先閱讀 externalEnrichment，把外部新聞、傷停與天氣納入同一個判斷流程。",
    `context=${JSON.stringify(compactAssistantContext(context))}`,
    "現在只輸出一個 JSON object，不可複述 context，不可加入其他欄位。格式：{\"summary\":\"繁體中文\",\"keyFindings\":[\"繁體中文\"],\"dataIssues\":[],\"actionItems\":[\"繁體中文\"],\"confidence\":0.5}。confidence 必須是 0 至 1 的數字。"
  ].join("\n");

  const attemptErrors: string[] = [];
  let lastRawResponse: string | undefined;

  for (const candidate of providerCandidates) {
    const providerLabel = candidate.provider === "ollama" ? "Ollama" : "OpenRouter";
    const result = await requestProviderInsight(candidate, prompt, options, assistantResponseJsonSchema);
    if (!result.ok) {
      attemptErrors.push(candidate.provider === "openrouter"
        ? openRouterFailureMessage(candidate.model, result.status)
        : ollamaFailureMessage(candidate.model, result.status));
      lastRawResponse = result.rawResponse;
      continue;
    }

    try {
      const parsedContent = normalizeJsonText(result.content);
      const parsed = assistantResponseSchema.parse(JSON.parse(parsedContent));
      if (!allUserFacingTextIsChinese([
        parsed.summary,
        ...parsed.keyFindings,
        ...parsed.dataIssues,
        ...parsed.actionItems
      ])) {
        attemptErrors.push(`${providerLabel} ${candidate.model} 未使用繁體中文輸出`);
        lastRawResponse = result.content;
        continue;
      }
      return {
        runAt: new Date().toISOString(),
        reviewMode: candidate.provider,
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
    } catch (error) {
      const details = error instanceof z.ZodError
        ? error.issues.map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`).join("; ")
        : error instanceof Error ? error.message : String(error);
      console.warn(`[assistant] ${providerLabel} ${candidate.model} returned invalid review JSON (length ${result.content.length}): ${details}`);
      attemptErrors.push(`${providerLabel} ${candidate.model} 回傳內容不是有效的審查 JSON`);
      lastRawResponse = result.content;
    }
  }

  return {
    ...buildLocalInsight(context, primaryModel),
    dataIssues:
      attemptErrors.length > 0 ? [`AI 審查已嘗試所有服務：${attemptErrors.join("；")}`] : ["AI 審查未能取得有效結果。"],
    rawResponse: lastRawResponse
  };
}
