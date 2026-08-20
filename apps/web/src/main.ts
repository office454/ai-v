type RecommendationReasonSections = {
  strengths: string[];
  risks: string[];
  watchpoints: string[];
};

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

type Recommendation = {
  fixtureId: string;
  match: string;
  kickoffAt: string;
  league?: string;
  homeTeam?: string;
  awayTeam?: string;
  matchKey?: string;
  sourceProvider?: string;
  market: string;
  selectionName: string;
  currentOdds: number;
  confidence: number;
  edgeScore: number;
  valueScore: number;
  recommendationGroup: "focus" | "highOdds";
  halfTimeScorePrediction: string;
  fullTimeScorePrediction: string;
  scorePredictionAlternatives?: string[];
  correctScoreConfidence?: string;
  highOddsProfile?: {
    tier: "A" | "B" | "C";
    suggestedStakePct: number;
    evPct: number;
    aiConsensusNote?: string;
    rationale: string[];
  };
  reason: string;
  reasonSections?: RecommendationReasonSections;
  lastUpdatedAt: string;
};

type Snapshot = {
  fixtures: Fixture[];
  recommendations: Recommendation[];
  recommendationShortlist: Recommendation[];
  consensusApprovedRecommendations: Recommendation[];
  consensusRejectedRecommendations: Recommendation[];
  lineupRecheckInsights: LineupRecheckInsight[];
  consensusReport: {
    reviewMode: AssistantReviewMode;
    model: string;
    summary: string;
    candidateCount: number;
    approvedCount: number;
    rejectedCount: number;
    dataIssues: string[];
  } | null;
  topFiveRecommendations: Recommendation[];
  highOddsValueRecommendations: Recommendation[];
  thresholds: {
    minRecommendedOdds: number;
    highOddsThreshold: number;
    highOddsMinEdgeScore: number;
    highOddsMinValueScore: number;
  };
  generatedAt: string;
  learning: LearningSnapshot | null;
};

type LineupRecheckInsight = {
  fixtureId: string;
  match: string;
  kickoffAt: string;
  checkedAt: string;
  lineupConfirmedBefore: boolean;
  lineupConfirmedAfter: boolean;
  beforeConfidence?: number;
  afterConfidence?: number;
  confidenceDelta?: number;
  trend: "up" | "down" | "flat" | "dropped";
  stillRecommended: boolean;
  droppedFromRecommendation: boolean;
  becameHighConfidence: boolean;
  note: string;
};

type BlindspotMetric = {
  sample: number;
  wins: number;
  losses: number;
  hitRate: number;
};

type LearningRecord = {
  result?: "win" | "loss";
};

type LearningSnapshot = {
  generatedAt: string;
  pendingCount: number;
  settledCount: number;
  recent: LearningRecord[];
  blindspots: {
    byMarket: Record<string, BlindspotMetric>;
  };
  correction: {
    marketPenalty: Record<string, number>;
    oddsBucketPenalty: Record<string, number>;
    confidenceBucketPenalty: Record<string, number>;
    sidePenalty: Record<"home" | "draw" | "away", number>;
  };
  diagnostics?: {
    summary: string;
    weakestMarket: string | null;
    weakestMarketHitRate: number | null;
    weakestMarketSample: number | null;
    actionItems: string[];
  };
};

type AutoTrainingProgress = {
  lastCycleAdded: number;
  lastCycleGateBlocked: number;
  lastCycleGateReplenished: number;
  totalAutoRecords: number;
  recentHitRate: number;
  recentSample: number;
  updatedAt: string;
};

type AssistantReviewMode = "openrouter" | "local_fallback";

type ModelAssistantInsight = {
  runAt: string;
  reviewMode: AssistantReviewMode;
  model: string;
  summary: string;
  keyFindings: string[];
  dataIssues: string[];
  actionItems: string[];
  enrichment?: {
    news: string[];
    injuries: string[];
    weather: string[];
    issues: string[];
    sourcePolicy?: {
      enabled: boolean;
      maxRecommendations: number;
      newsWhitelist: string[];
      injuryWhitelist: string[];
    };
  };
  suggestedWeights?: Partial<{
    strengthGap: number;
    recentForm: number;
    lineupFitness: number;
    expertSentiment: number;
    oddsMomentum: number;
  }>;
  suggestedThresholds?: Partial<{
    minRecommendedOdds: number;
    highOddsThreshold: number;
    highOddsMinEdgeScore: number;
    highOddsMinValueScore: number;
  }>;
  confidence: number;
  applied: boolean;
  sourceLabels: string[];
};

type PracticeApiResponse = {
  practice?: {
    assistantSummary?: ModelAssistantInsight;
  };
  assistant?: ModelAssistantInsight | null;
  assistantConfig?: {
    provider: "openrouter";
    enabled: boolean;
    model: string;
    hasApiKey: boolean;
    autoApply: boolean;
    minConfidence: number;
    enrichment?: {
      enabled: boolean;
      maxRecommendations: number;
      newsWhitelist: string[];
      injuryWhitelist: string[];
    };
  };
};

type TrainingSelectionSettings = {
  candidateRatio: number;
};

type WalkForwardMetrics = {
  generatedAt: string;
  totalSettled: number;
  evaluated: number;
  warmup: number;
  lookback: number;
  window: number;
  step: number;
  meanRps: number;
  ece: number;
  trend: Array<{
    at: string;
    sample: number;
    hitRate: number;
    meanRps: number;
    ece: number;
  }>;
};

type TrainingGateStatus = {
  generatedAt: string;
  drift: {
    active: boolean;
    severity: "none" | "mild" | "severe";
    candidateRatioFactor: number;
  };
  calibrationUpdatedAt?: string;
  markets: Record<
    "asian_handicap" | "match_result" | "goals_over_under",
    {
      recentHitRate: number;
      recentSample: number;
      totalSample: number;
      calibration: {
        count: number;
        avgPredicted: number;
        avgObserved: number;
        scale: number;
      };
      thresholds: {
        minConfidence: number;
        minEdgeScore: number;
        minValueScore: number;
        minProbabilityEdge: number;
        maxOdds: number;
      };
    }
  >;
};

type HighWaterMarket = "correct_score" | "half_full_time";

type HighWaterCandidate = {
  fixtureId: string;
  match: string;
  kickoffAt: string;
  league?: string;
  marketType: HighWaterMarket;
  market: string;
  selectionName: string;
  currentOdds: number;
  impliedProbability: number;
  modelProbability: number;
  confidence: number;
  edgePct: number;
  evPct: number;
  driftLevel: "none" | "mild" | "severe";
  thresholdLabel: string;
  score: number;
  rationale: string[];
};

type HighWaterSnapshot = {
  generatedAt: string;
  drift: {
    level: "none" | "mild" | "severe";
    candidateRatioFactor: number;
  };
  thresholds: Record<
    HighWaterMarket,
    {
      market: HighWaterMarket;
      label: string;
      minOdds: number;
      minEdgePct: number;
      minEvPct: number;
      minConfidence: number;
    }
  >;
  topCandidates: HighWaterCandidate[];
  byMarket: Record<HighWaterMarket, HighWaterCandidate[]>;
};

let latestSnapshotState: Snapshot | null = null;
let latestPracticeInsight: ModelAssistantInsight | null = null;
let latestAssistantConfig: PracticeApiResponse["assistantConfig"] | undefined;
let latestHighWaterSnapshot: HighWaterSnapshot | null = null;

type LearningHistoryStatus = "pending" | "settled";

type LearningHistoryRecord = {
  key: string;
  fixtureId: string;
  match: string;
  kickoffAt?: string;
  matchDateHk?: string;
  league?: string;
  halfTimeScore?: {
    home: number;
    away: number;
  };
  finalScore?: {
    home: number;
    away: number;
  };
  finalCorners?: {
    home: number;
    away: number;
    total: number;
  };
  homeTeam?: string;
  awayTeam?: string;
  matchKey?: string;
  sourceProvider?: string;
  market: string;
  selectionName: string;
  currentOdds: number;
  confidence: number;
  edgeScore: number;
  predictedSide: "home" | "draw" | "away";
  actualSide?: "home" | "draw" | "away";
  result?: "win" | "loss";
  status: LearningHistoryStatus;
  pendingReason?: string;
  createdAt: string;
  settledAt?: string;
};

type LearningBackfillResponse = {
  result: {
    pendingBefore: number;
    pendingAfter: number;
    settledNow: number;
    backfillCandidates: number;
    backfillFetched: number;
    pendingDiagnostics?: Array<{
      reasonCode?: string;
      reason?: string;
    }>;
  };
  learning: LearningSnapshot;
};

type LearningHistoryResponse = {
  records: LearningHistoryRecord[];
  markets: string[];
  total: number;
};

type BacktestTrainingRecord = {
  fixtureId: string;
  market: "homeWin" | "draw" | "awayWin";
  odds: number;
  modelProbability: number;
  stake: number;
  result: "win" | "loss";
  placedAt: string;
  source: "auto" | "practice" | "api" | "csv";
};

type BacktestTrainingHistoryResponse = {
  records: BacktestTrainingRecord[];
  total: number;
  source: "all" | "auto" | "practice";
};

type DataSourceHealth = {
  provider: string;
  queryVersion?: string;
  ok: boolean;
  hasCurrentOdds: boolean;
  fixtureCount: number;
  optionsCount: number;
  lastCheckedAt: string;
  lastSuccessfulAt?: string;
  lastError?: string;
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const STRICT_MIN_RECOMMENDED_ODDS = 2.0;
const DEFAULT_HIGH_ODDS_THRESHOLD = 2.2;
const DEFAULT_HIGH_ODDS_MIN_EDGE_SCORE = 2.2;
const DEFAULT_HIGH_ODDS_MIN_VALUE_SCORE = 0.07;
const SETTLE_BACKFILL_TIMEOUT_MS = 45000;

function apiUrl(path: string): string {
  if (!API_BASE_URL) {
    return path;
  }

  return `${API_BASE_URL}${path}`;
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("App root not found");
}

app.innerHTML = `
  <main class="shell">
    <section class="hero">
      <p class="kicker">HK Football Value Radar</p>
      <h1>今日推介</h1>
      <div class="actions">
        <button id="refresh">立即重算（含陣容）</button>
        <button id="viewFixtureAnalysis" type="button" class="secondary">今日賽事分析</button>
      </div>
      <form id="thresholdForm" class="threshold-form">
        <label>
          低賠過濾線
          <input id="minOdds" type="number" min="2.00" step="0.01" />
        </label>
        <label>
          高風險回報門檻
          <input id="highOdds" type="number" min="1.01" step="0.01" />
        </label>
        <label>
          高水最小 edge (%)
          <input id="highOddsMinEdge" type="number" min="0" step="0.1" />
        </label>
        <label>
          高水最小 valueScore
          <input id="highOddsMinValue" type="number" min="0" step="0.001" />
        </label>
        <label>
          訓練候選比例（0.05 - 1.00）
          <input id="trainingCandidateRatio" type="number" min="0.05" max="1" step="0.01" />
        </label>
        <button type="submit">儲存門檻</button>
      </form>
      <p id="meta">載入中...</p>
      <p id="dataSourceStatus" class="data-source-status">資料源自檢中...</p>
      <p id="autoTrainingHeadline" class="hero-training-summary">背景訓練進度讀取中...</p>
      <p id="assistantModeStatus" class="assistant-mode-status">AI 審查模式讀取中...</p>
      <section id="assistantEnrichmentPanel" class="assistant-enrichment-panel" aria-live="polite">
        <p class="assistant-enrichment-empty">外部訊號整合中...</p>
      </section>
      <p id="lineupRecheckStatus" class="lineup-recheck-status">開賽前 25 分鐘陣容重評監控中...</p>
    </section>
    <section>
      <h2>是日Top 5</h2>
      <div id="topFiveCards" class="cards top-five"></div>
    </section>
    <section class="learning-summary" aria-live="polite">
      <h2>模型學習摘要</h2>
      <div class="learning-actions">
        <button id="settleBackfill" type="button">立即補結算</button>
        <button id="viewLearningHistory" type="button">查看歷史記錄</button>
        <p id="settleBackfillStatus" class="learning-action-status">可手動補結算已完場推介</p>
      </div>
      <div class="learning-grid">
        <article class="learning-card">
          <p class="learning-label">最近 20 場命中率</p>
          <p id="learningRecentHitRate" class="learning-value">-</p>
        </article>
        <article class="learning-card">
          <p class="learning-label">最大盲點玩法</p>
          <p id="learningBiggestBlindspot" class="learning-value">-</p>
        </article>
        <article class="learning-card">
          <p class="learning-label">當前修正強度</p>
          <p id="learningCorrectionStrength" class="learning-value">-</p>
        </article>
        <article class="learning-card">
          <p class="learning-label">最近一次背景訓練新增</p>
          <p id="autoTrainingLastAdded" class="learning-value">-</p>
        </article>
        <article class="learning-card">
          <p class="learning-label">總 auto 記錄數</p>
          <p id="autoTrainingTotal" class="learning-value">-</p>
        </article>
        <article class="learning-card">
          <p class="learning-label">最近 auto 命中率</p>
          <p id="autoTrainingHitRate" class="learning-value">-</p>
        </article>
      </div>
      <div class="walk-forward-panel">
        <div class="walk-forward-headline">
          <p class="learning-label">Walk-forward（RPS / ECE）</p>
          <p id="walkForwardMeta" class="walk-forward-meta">讀取中...</p>
        </div>
        <div class="walk-forward-grid">
          <article class="learning-card">
            <p class="learning-label">Mean RPS（越低越好）</p>
            <p id="walkForwardRps" class="learning-value">-</p>
          </article>
          <article class="learning-card">
            <p class="learning-label">ECE（越低越好）</p>
            <p id="walkForwardEce" class="learning-value">-</p>
          </article>
          <article class="learning-card">
            <p class="learning-label">已評估樣本</p>
            <p id="walkForwardEvaluated" class="learning-value">-</p>
          </article>
        </div>
        <div id="walkForwardTrend" class="walk-forward-trend"></div>
      </div>
      <div class="gate-monitor-panel">
        <div class="walk-forward-headline">
          <p class="learning-label">Dynamic Gate Monitor</p>
          <p id="gateMonitorMeta" class="walk-forward-meta">讀取中...</p>
        </div>
        <p id="gateMonitorDrift" class="gate-monitor-drift">drift 檢查中...</p>
        <div id="gateMarketCards" class="gate-market-cards"></div>
      </div>
      <p id="learningStatus" class="learning-status">正在讀取學習資料...</p>
    </section>
  </main>
  <section id="learningHistoryPage" class="learning-history-page hidden" aria-live="polite">
    <header class="history-header">
      <h2>模型學習歷史記錄</h2>
      <button id="backToDashboard" type="button">返回主頁</button>
    </header>
    <div class="history-toolbar">
      <div class="history-tabs" role="tablist" aria-label="歷史記錄模式">
        <button id="historyLearningTab" type="button" class="history-tab active">推介結算記錄</button>
        <button id="historyTrainingTab" type="button" class="history-tab">背景訓練記錄</button>
      </div>
      <label id="historyMarketFilterWrap">
        投注項目分類
        <select id="historyMarketFilter">
          <option value="all">全部</option>
        </select>
      </label>
      <label id="historyDateFilterWrap">
        推介日期
        <input id="historyDateFilter" type="date" />
      </label>
      <label id="historyTrainingFilterWrap" class="hidden">
        訓練來源
        <select id="historyTrainingFilter">
          <option value="all">全部（auto + practice）</option>
          <option value="auto">auto</option>
          <option value="practice">practice</option>
        </select>
      </label>
    </div>
    <p id="historyMeta" class="history-meta">讀取中...</p>
    <div id="historyList" class="history-list"></div>
  </section>
  <section id="recommendationDetailPage" class="detail-page hidden" aria-live="polite">
    <header class="detail-header">
      <div>
        <p class="detail-kicker">Pick Intelligence View</p>
        <h2 id="detailTitle">推介詳情</h2>
        <p id="detailSubtitle" class="detail-subtitle">讀取中...</p>
      </div>
      <div class="detail-actions">
        <button id="detailAddOdds" type="button">加入計算機</button>
        <button id="backToDashboardFromDetail" type="button" class="subtle">返回主頁</button>
      </div>
    </header>
    <div class="detail-metrics-grid">
      <article class="detail-metric-card">
        <p class="detail-metric-label">玩法</p>
        <p id="detailMarket" class="detail-metric-value">-</p>
      </article>
      <article class="detail-metric-card">
        <p class="detail-metric-label">選項</p>
        <p id="detailSelection" class="detail-metric-value">-</p>
      </article>
      <article class="detail-metric-card">
        <p class="detail-metric-label">即時賠率</p>
        <p id="detailOdds" class="detail-metric-value">-</p>
      </article>
      <article class="detail-metric-card">
        <p class="detail-metric-label">信心 / 優勢值</p>
        <p id="detailConfidenceEdge" class="detail-metric-value">-</p>
      </article>
    </div>
    <article class="detail-reason-card">
      <p class="detail-metric-label">模型與 AI 討論結論</p>
      <p id="detailReason" class="detail-reason">-</p>
    </article>
    <section class="decision-panel" aria-live="polite">
      <div class="decision-panel-header">
        <div>
          <p class="decision-kicker">Decision</p>
          <h2>決策摘要</h2>
        </div>
        <p id="decisionModeBadge" class="decision-mode-badge">模式讀取中...</p>
      </div>

      <div class="decision-inline-strip">
        <div class="decision-inline-item">
          <span class="decision-inline-label">模式</span>
          <strong id="decisionModeTitle">讀取中...</strong>
        </div>
        <div class="decision-inline-item">
          <span class="decision-inline-label">輸出</span>
          <strong id="decisionOutputSource">讀取中...</strong>
        </div>
        <div class="decision-inline-item">
          <span class="decision-inline-label">候選</span>
          <strong><span id="decisionModelCount">0</span> / <span id="decisionKeepCount">0</span></strong>
        </div>
      </div>

      <div class="decision-inline-summary">
        <p id="decisionConsensusSummary">正在讀取共識摘要...</p>
      </div>

      <div class="decision-inline-status">
        <span class="status-dot"></span>
        <p id="decisionModeDescription">正在讀取模型與 AI 協作狀態...</p>
      </div>

      <div class="decision-inline-lane-grid">
        <article class="decision-lane lane-model">
          <div class="decision-lane-header">
            <p class="decision-lane-label">模型 shortlist</p>
            <span id="decisionModelCountInline" class="decision-count">0</span>
          </div>
          <div id="decisionModelList" class="decision-list compact"></div>
        </article>
        <article class="decision-lane lane-keep">
          <div class="decision-lane-header">
            <p class="decision-lane-label">AI 保留</p>
            <span id="decisionKeepCountInline" class="decision-count">0</span>
          </div>
          <div id="decisionKeepList" class="decision-list compact"></div>
        </article>
        <article class="decision-lane lane-reject">
          <div class="decision-lane-header">
            <p class="decision-lane-label">AI 拒絕</p>
            <span id="decisionRejectCount" class="decision-count">0</span>
          </div>
          <div id="decisionRejectReasons" class="decision-detail-list compact"></div>
        </article>
      </div>
    </section>
  </section>
  <section id="fixtureAnalysisPage" class="fixture-analysis-page hidden" aria-live="polite">
    <header class="detail-header">
      <div>
        <p class="detail-kicker">Fixture Intelligence</p>
        <h2>今日可投注賽事</h2>
      </div>
      <div class="detail-actions">
        <button id="backToDashboardFromFixtures" type="button" class="subtle">返回主頁</button>
      </div>
    </header>
    <div class="fixture-analysis-layout">
      <aside id="fixtureListPanel" class="fixture-list-panel"></aside>
      <main id="fixtureAnalysisPanel" class="fixture-analysis-panel">
        <p class="fixture-empty">請選擇一場賽事進行獨立分析。</p>
      </main>
    </div>
  </section>
  <aside class="floating-calculator" aria-label="投注計算機">
    <div class="calculator-header">
      <h2>投注計算機</h2>
      <button id="calcToggle" type="button" class="calc-toggle">展開</button>
    </div>
    <div class="calculator-panel">
      <div class="calculator-grid">
        <label>
            過關方式
            <select id="calcSystem"></select>
        </label>
        <label>
            選項數
            <input id="calcLegs" type="number" min="0" max="8" value="0" readonly />
        </label>
        <label>
          每注金額 (HKD)
          <input id="calcStake" type="number" min="1" step="1" value="100" />
        </label>
      </div>
      <div id="oddsRows" class="odds-rows"></div>
      <div class="calculator-actions">
        <button id="calcReset" type="button">重設</button>
        <button id="calcClearOdds" type="button">清空已加入賠率</button>
      </div>
      <dl class="calc-result">
          <div><dt>過關總注數</dt><dd id="calcCombinedOdds">-</dd></div>
          <div><dt>總投注額</dt><dd id="calcTotalStake">-</dd></div>
          <div><dt>全中最高派彩</dt><dd id="calcPayout">-</dd></div>
          <div><dt>全中最高純利</dt><dd id="calcProfit">-</dd></div>
        <div><dt>損益平衡命中率</dt><dd id="calcBreakeven">-</dd></div>
      </dl>
        <p id="calcHint" class="calc-hint">請選擇過關方式並輸入所有賠率。</p>
    </div>
  </aside>
`;

const topFiveCards = document.querySelector<HTMLDivElement>("#topFiveCards");
const highOddsCards = document.querySelector<HTMLDivElement>("#highOddsCards");
const meta = document.querySelector<HTMLParagraphElement>("#meta");
const dataSourceStatus = document.querySelector<HTMLParagraphElement>("#dataSourceStatus");
const refreshBtn = document.querySelector<HTMLButtonElement>("#refresh");
const thresholdForm = document.querySelector<HTMLFormElement>("#thresholdForm");
const minOddsInput = document.querySelector<HTMLInputElement>("#minOdds");
const highOddsInput = document.querySelector<HTMLInputElement>("#highOdds");
const highOddsMinEdgeInput = document.querySelector<HTMLInputElement>("#highOddsMinEdge");
const highOddsMinValueInput = document.querySelector<HTMLInputElement>("#highOddsMinValue");
const trainingCandidateRatioInput = document.querySelector<HTMLInputElement>("#trainingCandidateRatio");
const calcSystem = document.querySelector<HTMLSelectElement>("#calcSystem");
const calcLegs = document.querySelector<HTMLInputElement>("#calcLegs");
const calcStake = document.querySelector<HTMLInputElement>("#calcStake");
const calculatorShell = document.querySelector<HTMLElement>(".floating-calculator");
const calcToggle = document.querySelector<HTMLButtonElement>("#calcToggle");
const oddsRows = document.querySelector<HTMLDivElement>("#oddsRows");
const calcReset = document.querySelector<HTMLButtonElement>("#calcReset");
const calcClearOdds = document.querySelector<HTMLButtonElement>("#calcClearOdds");
const calcCombinedOdds = document.querySelector<HTMLSpanElement>("#calcCombinedOdds");
const calcTotalStake = document.querySelector<HTMLSpanElement>("#calcTotalStake");
const calcPayout = document.querySelector<HTMLSpanElement>("#calcPayout");
const calcProfit = document.querySelector<HTMLSpanElement>("#calcProfit");
const calcBreakeven = document.querySelector<HTMLSpanElement>("#calcBreakeven");
const calcHint = document.querySelector<HTMLParagraphElement>("#calcHint");
const learningRecentHitRate = document.querySelector<HTMLParagraphElement>("#learningRecentHitRate");
const learningBiggestBlindspot = document.querySelector<HTMLParagraphElement>("#learningBiggestBlindspot");
const learningCorrectionStrength = document.querySelector<HTMLParagraphElement>("#learningCorrectionStrength");
const settleBackfillBtn = document.querySelector<HTMLButtonElement>("#settleBackfill");
const viewLearningHistoryBtn = document.querySelector<HTMLButtonElement>("#viewLearningHistory");
const settleBackfillStatus = document.querySelector<HTMLParagraphElement>("#settleBackfillStatus");
const autoTrainingLastAdded = document.querySelector<HTMLParagraphElement>("#autoTrainingLastAdded");
const autoTrainingTotal = document.querySelector<HTMLParagraphElement>("#autoTrainingTotal");
const autoTrainingHitRate = document.querySelector<HTMLParagraphElement>("#autoTrainingHitRate");
const autoTrainingHeadline = document.querySelector<HTMLParagraphElement>("#autoTrainingHeadline");
const walkForwardMeta = document.querySelector<HTMLParagraphElement>("#walkForwardMeta");
const walkForwardRps = document.querySelector<HTMLParagraphElement>("#walkForwardRps");
const walkForwardEce = document.querySelector<HTMLParagraphElement>("#walkForwardEce");
const walkForwardEvaluated = document.querySelector<HTMLParagraphElement>("#walkForwardEvaluated");
const walkForwardTrend = document.querySelector<HTMLDivElement>("#walkForwardTrend");
const gateMonitorMeta = document.querySelector<HTMLParagraphElement>("#gateMonitorMeta");
const gateMonitorDrift = document.querySelector<HTMLParagraphElement>("#gateMonitorDrift");
const gateMarketCards = document.querySelector<HTMLDivElement>("#gateMarketCards");
const assistantModeStatus = document.querySelector<HTMLParagraphElement>("#assistantModeStatus");
const assistantEnrichmentPanel = document.querySelector<HTMLDivElement>("#assistantEnrichmentPanel");
const lineupRecheckStatus = document.querySelector<HTMLParagraphElement>("#lineupRecheckStatus");
const decisionModeBadge = document.querySelector<HTMLParagraphElement>("#decisionModeBadge");
const decisionModeTitle = document.querySelector<HTMLParagraphElement>("#decisionModeTitle");
const decisionOutputSource = document.querySelector<HTMLParagraphElement>("#decisionOutputSource");
const decisionModeDescription = document.querySelector<HTMLParagraphElement>("#decisionModeDescription");
const decisionConsensusSummary = document.querySelector<HTMLParagraphElement>("#decisionConsensusSummary");
const decisionRejectReasons = document.querySelector<HTMLDivElement>("#decisionRejectReasons");
const decisionModelCount = document.querySelector<HTMLSpanElement>("#decisionModelCount");
const decisionKeepCount = document.querySelector<HTMLSpanElement>("#decisionKeepCount");
const decisionModelCountInline = document.querySelector<HTMLSpanElement>("#decisionModelCountInline");
const decisionKeepCountInline = document.querySelector<HTMLSpanElement>("#decisionKeepCountInline");
const decisionRejectCount = document.querySelector<HTMLSpanElement>("#decisionRejectCount");
const decisionModelList = document.querySelector<HTMLDivElement>("#decisionModelList");
const decisionKeepList = document.querySelector<HTMLDivElement>("#decisionKeepList");
const decisionRejectList = document.querySelector<HTMLDivElement>("#decisionRejectList");
const learningStatus = document.querySelector<HTMLParagraphElement>("#learningStatus");
const dashboardPage = document.querySelector<HTMLElement>("main.shell");
const learningHistoryPage = document.querySelector<HTMLElement>("#learningHistoryPage");
const recommendationDetailPage = document.querySelector<HTMLElement>("#recommendationDetailPage");
const fixtureAnalysisPage = document.querySelector<HTMLElement>("#fixtureAnalysisPage");
const fixtureListPanel = document.querySelector<HTMLDivElement>("#fixtureListPanel");
const fixtureAnalysisPanel = document.querySelector<HTMLDivElement>("#fixtureAnalysisPanel");
const viewFixtureAnalysisBtn = document.querySelector<HTMLButtonElement>("#viewFixtureAnalysis");
const backToDashboardBtn = document.querySelector<HTMLButtonElement>("#backToDashboard");
const backToDashboardFromFixturesBtn = document.querySelector<HTMLButtonElement>("#backToDashboardFromFixtures");
const backToDashboardFromDetailBtn = document.querySelector<HTMLButtonElement>("#backToDashboardFromDetail");
const historyLearningTab = document.querySelector<HTMLButtonElement>("#historyLearningTab");
const historyTrainingTab = document.querySelector<HTMLButtonElement>("#historyTrainingTab");
const historyMarketFilterWrap = document.querySelector<HTMLLabelElement>("#historyMarketFilterWrap");
const historyDateFilterWrap = document.querySelector<HTMLLabelElement>("#historyDateFilterWrap");
const historyTrainingFilterWrap = document.querySelector<HTMLLabelElement>("#historyTrainingFilterWrap");
const historyMarketFilter = document.querySelector<HTMLSelectElement>("#historyMarketFilter");
const historyDateFilter = document.querySelector<HTMLInputElement>("#historyDateFilter");
const historyTrainingFilter = document.querySelector<HTMLSelectElement>("#historyTrainingFilter");
const historyMeta = document.querySelector<HTMLParagraphElement>("#historyMeta");
const historyList = document.querySelector<HTMLDivElement>("#historyList");
const detailTitle = document.querySelector<HTMLHeadingElement>("#detailTitle");
const detailSubtitle = document.querySelector<HTMLParagraphElement>("#detailSubtitle");
const detailMarket = document.querySelector<HTMLParagraphElement>("#detailMarket");
const detailSelection = document.querySelector<HTMLParagraphElement>("#detailSelection");
const detailOdds = document.querySelector<HTMLParagraphElement>("#detailOdds");
const detailConfidenceEdge = document.querySelector<HTMLParagraphElement>("#detailConfidenceEdge");
const detailReason = document.querySelector<HTMLParagraphElement>("#detailReason");
const detailAddOddsBtn = document.querySelector<HTMLButtonElement>("#detailAddOdds");
let optionPickKeys: Array<string | null> = [];
let activeDetailPickKey: string | null = null;
let selectedFixtureId = "";
let historyDatasetMode: "learning" | "background" = "learning";

type AppView = "dashboard" | "history" | "detail" | "fixtures";

type AppRouteState = {
  appView: AppView;
  pickKey?: string;
};

function sideLabel(side: "home" | "draw" | "away" | undefined): string {
  if (side === "home") return "主隊";
  if (side === "away") return "客隊";
  if (side === "draw") return "和局";
  return "-";
}

function isOverUnderMarket(market: string): boolean {
  return market.includes("入球大細") || market.includes("總入球") || market.includes("大小") || market.includes("角球");
}

function overUnderDirectionLabel(record: LearningHistoryRecord): "大" | "細" | null {
  const explicit = overUnderPickFromSelection(record.selectionName);
  if (explicit === "over") {
    return "大";
  }
  if (explicit === "under") {
    return "細";
  }

  if (record.predictedSide === "home") {
    return "大";
  }
  if (record.predictedSide === "away") {
    return "細";
  }

  return null;
}

function normalizedOverUnderSelectionLabel(record: LearningHistoryRecord): string {
  const direction = overUnderDirectionLabel(record);
  if (!direction) {
    return record.selectionName;
  }

  const isLegacyHomeHalfTeamTotal = record.market === "球隊入球大細";
  const side = isLegacyHomeHalfTeamTotal ? "home" : selectionTeamSide(record.selectionName);
  const sidePrefix = side === "home" ? "主隊 " : side === "away" ? "客隊 " : "";
  const phasePrefix = record.market.includes("半場") || isLegacyHomeHalfTeamTotal ? "半場" : "";
  const rawLine = marketLineLabel(record);
  const normalizedLine = rawLine.replace(/^盤口\s*/u, "");

  if (normalizedLine && normalizedLine !== "無明確盤口") {
    return `${sidePrefix}${phasePrefix}${direction}（${normalizedLine}）`;
  }

  return `${sidePrefix}${phasePrefix}${direction}`;
}

function selectionDisplayLabel(record: LearningHistoryRecord): string {
  if (isOverUnderMarket(record.market)) {
    return normalizedOverUnderSelectionLabel(record);
  }

  return record.selectionName;
}

function predictionLabel(record: LearningHistoryRecord): string {
  const selectionText = record.selectionName.replace(/\s+/g, "");
  const isOverUnder = isOverUnderMarket(record.market);

  if (record.market.includes("入球單雙")) {
    if (selectionText.includes("單") && !selectionText.includes("雙")) {
      return "單";
    }
    if (selectionText.includes("雙") && !selectionText.includes("單")) {
      return "雙";
    }
  }

  if (isOverUnder) {
    if (selectionText.includes("大") && !selectionText.includes("細")) {
      return "大";
    }
    if (selectionText.includes("細") && !selectionText.includes("大")) {
      return "細";
    }

    const fallback = overUnderDirectionLabel(record);
    if (fallback) {
      return fallback;
    }
  }

  return sideLabel(record.predictedSide);
}

function resultLabel(result: "win" | "loss" | undefined, status: LearningHistoryStatus): string {
  if (status === "pending") return "待結算";
  if (result === "win") return "命中";
  if (result === "loss") return "失手";
  return "已結算";
}

function extractLineValueFromText(...parts: string[]): number | null {
  for (const part of parts) {
    const match = part.match(/-?\d+(?:\.\d+)?/);
    if (!match) {
      continue;
    }

    const value = Number(match[0]);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function overUnderPickFromSelection(selectionName: string): "over" | "under" | null {
  const text = selectionName.replace(/\s+/g, "");
  if (text.includes("大") && !text.includes("細")) {
    return "over";
  }
  if (text.includes("細") && !text.includes("大")) {
    return "under";
  }
  return null;
}

function selectionTeamSide(selectionName: string): "home" | "away" | null {
  const text = selectionName.replace(/\s+/g, "");
  const hasHome = text.includes("主隊") || text.includes("主勝");
  const hasAway = text.includes("客隊") || text.includes("客勝");
  if (hasHome && !hasAway) {
    return "home";
  }
  if (hasAway && !hasHome) {
    return "away";
  }
  return null;
}

function derivedOutcome(record: LearningHistoryRecord): "win" | "loss" | undefined {
  if (record.status !== "settled") {
    return record.result;
  }

  const isLegacyHomeHalfTeamTotal = record.market === "球隊入球大細";
  const isHalfTime = record.market.includes("半場") || isLegacyHomeHalfTeamTotal;
  const score = isHalfTime ? record.halfTimeScore : record.finalScore;
  if (isHalfTime && !score) {
    return undefined;
  }

  if (record.market.includes("入球單雙") && score) {
    const total = score.home + score.away;
    const actual = total % 2 === 1 ? "home" : "away";
    return actual === record.predictedSide ? "win" : "loss";
  }

  const isOverUnderMarket =
    record.market.includes("入球大細") ||
    record.market.includes("總入球") ||
    record.market.includes("大小") ||
    record.market.includes("角球");
  if (isOverUnderMarket) {
    const line = extractLineValueFromText(record.selectionName, record.market);
    const pick = overUnderPickFromSelection(record.selectionName);
    if (line === null || !pick) {
      return record.result;
    }

    let metric: number | null = null;
    if (record.market.includes("角球")) {
      if (!record.finalCorners) {
        return record.result;
      }
      const side = selectionTeamSide(record.selectionName);
      metric = side === "home" ? record.finalCorners.home : side === "away" ? record.finalCorners.away : record.finalCorners.total;
    } else {
      if (!score) {
        return record.result;
      }
      const side = isLegacyHomeHalfTeamTotal ? "home" : selectionTeamSide(record.selectionName);
      metric = side === "home" ? score.home : side === "away" ? score.away : score.home + score.away;
    }

    if (metric > line) {
      return record.predictedSide === "home" ? "win" : "loss";
    }

    if (metric < line) {
      return record.predictedSide === "away" ? "win" : "loss";
    }
  }

  return record.result;
}

function marketCategoryLabel(market: string): string {
  if (market.includes("角球")) {
    return "角球";
  }

  if (market.includes("讓球")) {
    return "讓球";
  }

  if (market.includes("入球大細") || market.includes("大小") || market.includes("總入球")) {
    return "大小";
  }

  if (market.includes("主客和")) {
    return "主客和";
  }

  return market;
}

function prettyMarketLabel(market: string): string {
  const normalized = market.trim();

  if (normalized.includes("球隊半場開出角球大細") || normalized.includes("球隊半場角球大細")) {
    return "球隊半場角球大細（主/客隊半場角球大小）";
  }

  if (normalized.includes("半場開出角球讓球") || normalized.includes("開出角球讓球")) {
    return "球隊半場角球讓球（主/客隊半場角球讓球）";
  }

  if (normalized.includes("球隊開出角球大細") || normalized.includes("開出角球大細")) {
    return "球隊全場角球大細（主/客隊全場角球大小）";
  }

  if (normalized.includes("球隊入球大細") || normalized.includes("主隊半場入球大細") || normalized.includes("客隊半場入球大細")) {
    return "球隊半場入球大細（主/客隊半場入球大小）";
  }

  if (normalized.includes("球隊半場入球大細")) {
    return "球隊半場入球大細（主/客隊半場入球大小）";
  }

  if (normalized.includes("半場讓球") || normalized.includes("讓球")) {
    return "球隊半場讓球（主/客隊半場讓球）";
  }

  if (normalized.includes("半場入球大細") || normalized.includes("入球大細")) {
    return "球隊半場入球大細（主/客隊半場入球大小）";
  }

  return normalized;
}

function learningMarketDisplayLabel(market: string): string {
  return prettyMarketLabel(market === "球隊入球大細" ? "主隊半場入球大細" : market);
}

function marketLineLabel(record: LearningHistoryRecord): string {
  const lineMatch = record.selectionName.match(/（([^）]+)）/);
  if (lineMatch?.[1]) {
    return lineMatch[1].replace(/^盤口\s*/u, "");
  }

  if (record.market.includes("主客和")) {
    return record.selectionName;
  }

  if (record.selectionName.includes("盤口")) {
    return record.selectionName;
  }

  return "無明確盤口";
}

function resultDetailLabel(record: LearningHistoryRecord): string {
  if (record.status === "pending") {
    return "待結算";
  }

  if (record.market.includes("角球")) {
    const corners = record.finalCorners;
    if (corners) {
      return `${corners.home} : ${corners.away}`;
    }
  }

  const useHalfTimeScore = record.market.includes("半場") || record.market === "球隊入球大細";
  const score = useHalfTimeScore ? record.halfTimeScore : record.finalScore;

  if (record.market.includes("入球單雙") && score) {
    const totalGoals = score.home + score.away;
    return `${totalGoals}`;
  }

  if (score) {
    if (useHalfTimeScore) {
      return `半場 ${score.home} : ${score.away}`;
    }

    return `${score.home} : ${score.away}`;
  }

  if (record.result === "win") {
    return "已結算（命中，未取到比分）";
  }

  if (record.result === "loss") {
    return "已結算（失手，未取到比分）";
  }

  return "已結算（未取到比分）";
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-HK", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function trainingMarketLabel(market: BacktestTrainingRecord["market"]): string {
  if (market === "homeWin") {
    return "主勝";
  }

  if (market === "awayWin") {
    return "客勝";
  }

  return "和局";
}

function updateHistoryToolbarMode(): void {
  const isLearning = historyDatasetMode === "learning";
  historyLearningTab?.classList.toggle("active", isLearning);
  historyTrainingTab?.classList.toggle("active", !isLearning);
  historyMarketFilterWrap?.classList.toggle("hidden", !isLearning);
  historyDateFilterWrap?.classList.toggle("hidden", !isLearning);
  historyTrainingFilterWrap?.classList.toggle("hidden", isLearning);
}

function insightByFixture(insights: LineupRecheckInsight[]): Map<string, LineupRecheckInsight> {
  const map = new Map<string, LineupRecheckInsight>();
  for (const insight of insights) {
    if (!map.has(insight.fixtureId)) {
      map.set(insight.fixtureId, insight);
    }
  }

  return map;
}

function renderLineupRecheckStatus(insights: LineupRecheckInsight[]): void {
  if (!lineupRecheckStatus) {
    return;
  }

  if (insights.length === 0) {
    lineupRecheckStatus.classList.remove("warning");
    lineupRecheckStatus.textContent = "開賽前 25 分鐘陣容重評監控中...";
    return;
  }

  const dropped = insights.filter((insight) => insight.droppedFromRecommendation).slice(0, 3);
  if (dropped.length > 0) {
    lineupRecheckStatus.classList.add("warning");
    lineupRecheckStatus.textContent = `特別提示：${dropped.map((insight) => insight.match).join("、")} 重評後已移出最終推介。`;
    return;
  }

  lineupRecheckStatus.classList.remove("warning");
  const latest = insights[0];
  lineupRecheckStatus.textContent = `陣容重評：${latest.match}｜${latest.note}`;
}

function renderReasonMarkup(pick: Recommendation): string {
  const sections = pick.reasonSections;
  if (!sections) {
    return `<p class="reason">${pick.reason}</p>`;
  }

  const renderList = (items: string[]) => {
    if (items.length === 0) {
      return "<li>暫時沒有額外觀察點</li>";
    }
    return items.map((item) => `<li>${item}</li>`).join("");
  };

  return `
    <div class="reason-structured">
      <div class="reason-block">
        <strong>強弱點</strong>
        <ul>${renderList(sections.strengths)}</ul>
      </div>
      <div class="reason-block">
        <strong>風險點</strong>
        <ul>${renderList(sections.risks)}</ul>
      </div>
      <div class="reason-block">
        <strong>觀察重點</strong>
        <ul>${renderList(sections.watchpoints)}</ul>
      </div>
    </div>
  `;
}

function formatScorelinePrediction(label: string, prediction: string | null | undefined): string {
  const value = typeof prediction === "string" ? prediction.trim() : "";
  return `${label} ${value.length > 0 ? value : "-"}`;
}

function formatAlternateScorePredictions(predictions: string[] | undefined): string {
  const usable = (predictions ?? []).map((value) => value.trim()).filter((value) => value.length > 0).slice(0, 2);
  return usable.length > 0 ? usable.join(" / ") : "-";
}

function renderAlternateScoreChips(predictions: string[] | undefined): string {
  const usable = (predictions ?? []).map((value) => value.trim()).filter((value) => value.length > 0).slice(0, 2);
  if (usable.length === 0) {
    return '<span class="score-pill score-pill-muted">#2 / #3 -</span>';
  }

  return usable
    .map((value, index) => `<span class="score-pill score-pill-muted">#${index + 2} ${value}</span>`)
    .join("");
}

function correctScoreConfidenceClass(confidence: string | undefined): string {
  const label = confidence ?? "模型弱信號";
  if (label.includes("強信號")) {
    return "score-pill-signal-strong";
  }
  if (label.includes("中信號")) {
    return "score-pill-signal-medium";
  }
  return "score-pill-signal-weak";
}

function formatRecommendationSelection(market: string, selectionName: string): string {
  const normalizedSelection = selectionName.trim();
  if (!normalizedSelection) {
    return "-";
  }

  const marketText = market.replace(/\s+/g, "");
  const selectionText = normalizedSelection.replace(/\s+/g, "");
  const isGoalsLikeMarket =
    marketText.includes("入球大細") ||
    marketText.includes("總入球") ||
    marketText.includes("大小") ||
    marketText.includes("單雙");

  if (!isGoalsLikeMarket) {
    return normalizedSelection;
  }

  if (selectionText.includes("大") || selectionText.includes("細") || selectionText.includes("單") || selectionText.includes("雙")) {
    return normalizedSelection;
  }

  return normalizedSelection.replace(/（盤口\s*/u, "（");
}

function formatSelectionOptionMarkup(selectionText: string): string {
  const normalized = selectionText.trim();
  if (!normalized) {
    return '<span class="pick-selection-main">-</span>';
  }

  const splitAt = normalized.indexOf("（");
  if (splitAt <= 0) {
    return `<span class="pick-selection-main">${escapeHtml(normalized)}</span>`;
  }

  const main = normalized.slice(0, splitAt).trim();
  const line = normalized.slice(splitAt).trim();
  return `<span class="pick-selection-main">${escapeHtml(main)}</span><span class="pick-selection-line">${escapeHtml(line)}</span>`;
}

function classifyMarketLabels(market: string): { typeLabel: string; summaryLabel: string } {
  const normalized = market.replace(/\s+/g, "");

  if (normalized.includes("波膽")) {
    return { typeLabel: "波膽", summaryLabel: "精準比分" };
  }
  if (normalized.includes("半全場")) {
    return { typeLabel: "半全場", summaryLabel: "半全場組合" };
  }
  if (normalized.includes("主客和") || normalized.includes("勝和負")) {
    return { typeLabel: "主客和", summaryLabel: "90分勝和負" };
  }
  if (normalized.includes("讓球")) {
    const isHalf = normalized.includes("半場");
    return { typeLabel: "讓球", summaryLabel: isHalf ? "半場讓球盤" : "全場讓球盤" };
  }
  if (normalized.includes("角球")) {
    const isHalf = normalized.includes("半場");
    return { typeLabel: "角球", summaryLabel: isHalf ? "半場角球盤" : "全場角球盤" };
  }
  if (normalized.includes("單雙")) {
    return { typeLabel: "單雙", summaryLabel: "總入球單雙" };
  }
  if (normalized.includes("入球大細") || normalized.includes("總入球") || normalized.includes("大小")) {
    const isHalf = normalized.includes("半場");
    return { typeLabel: "大小", summaryLabel: isHalf ? "半場大小盤" : "全場大小盤" };
  }
  if (normalized.includes("入球球員") || normalized.includes("第一隊入球") || normalized.includes("任何時間入球")) {
    return { typeLabel: "入球球員", summaryLabel: "球員入球盤" };
  }
  if (normalized.includes("晉級")) {
    return { typeLabel: "晉級", summaryLabel: "晉級盤" };
  }

  const fallback = market.trim();
  return {
    typeLabel: fallback.length > 0 ? fallback : "未分類",
    summaryLabel: fallback.length > 0 ? fallback : "未分類玩法"
  };
}

function renderCards(
  list: Recommendation[],
  ranked = false,
  insightMap: Map<string, LineupRecheckInsight> = new Map<string, LineupRecheckInsight>()
): string {
  if (list.length === 0) {
    return '<article class="card"><p class="reason">暫時沒有符合條件的推介。</p></article>';
  }

  return list
    .map(
      (pick, index) => {
        const pickKey = encodeURIComponent(`${pick.fixtureId}|${pick.market}|${pick.selectionName}`);
        const insight = insightMap.get(pick.fixtureId);
        const highOddsMeta = pick.highOddsProfile
          ? `<div class="score-banner">
              <span class="score-pill">風險層級 ${pick.highOddsProfile.tier}</span>
              <span class="score-pill score-pill-muted">建議注碼 ${pick.highOddsProfile.suggestedStakePct.toFixed(2)}%</span>
              <span class="score-pill score-pill-muted">EV ${pick.highOddsProfile.evPct.toFixed(2)}%</span>
            </div>`
          : "";
        const highOddsNote = pick.highOddsProfile?.aiConsensusNote
          ? `<p class="reason">AI 二審：${pick.highOddsProfile.aiConsensusNote}</p>`
          : "";
        const confidenceDelta = insight?.confidenceDelta;
        const confidenceDeltaLabel =
          typeof confidenceDelta === "number" && confidenceDelta !== 0
            ? `<span class="confidence-delta ${confidenceDelta > 0 ? "up" : "down"}">${confidenceDelta > 0 ? "▲" : "▼"} ${Math.abs(confidenceDelta).toFixed(1)}%</span>`
            : "";
        const confidenceSurgeClass = insight?.becameHighConfidence ? "card-confidence-surge" : "";
        const selectionLabel = formatRecommendationSelection(pick.market, pick.selectionName);
        const selectionMarkup = formatSelectionOptionMarkup(selectionLabel);
        const primaryScoreLabel = `主預測 ${pick.fullTimeScorePrediction}`;
        const correctScoreConfidence = pick.correctScoreConfidence ?? "模型弱信號";
        const confidenceClass = correctScoreConfidenceClass(correctScoreConfidence);
        const marketLabels = classifyMarketLabels(pick.market);
        const marketTypeLabel = marketLabels.typeLabel;
        const playSummary = marketLabels.summaryLabel;
        return `
      <article class="card recommendation-card ${confidenceSurgeClass}" role="button" tabindex="0" data-odds="${pick.currentOdds.toFixed(2)}" data-pick-key="${pickKey}">
        ${ranked ? `<p class="rank-badge">#${index + 1}</p>` : ""}
        <h3>${pick.match}</h3>
        <p class="kickoff">開賽：${formatTime(pick.kickoffAt)}</p>
        <div class="pick-highlight-row compact">
          <div class="pick-highlight compact-block">
            <span class="pick-highlight-label">市場類型</span>
            <span class="pick-highlight-value">${marketTypeLabel}</span>
          </div>
          <div class="pick-highlight compact-block">
            <span class="pick-highlight-label">玩法說明</span>
            <span class="pick-highlight-value">${playSummary}</span>
          </div>
          <div class="pick-highlight compact-block pick-highlight-emphasis">
            <span class="pick-highlight-label">推介選項</span>
            <span class="pick-highlight-value pick-selection-value">${selectionMarkup}</span>
          </div>
        </div>
        <div class="score-banner">
          <span class="score-pill">推薦分數 ${pick.confidence}%</span>
          <span class="score-pill score-pill-muted">值搏率 ${pick.valueScore}</span>
        </div>
        <div class="score-banner">
          <span class="score-pill score-pill-muted">${primaryScoreLabel}</span>
          ${renderAlternateScoreChips(pick.scorePredictionAlternatives)}
          <span class="score-pill ${confidenceClass}">波膽市場信心 ${correctScoreConfidence}</span>
        </div>
        ${highOddsMeta}
        <dl>
          <div><dt>即時賠率</dt><dd>${pick.currentOdds}</dd></div>
          <div><dt>信心</dt><dd>${pick.confidence}% ${confidenceDeltaLabel}</dd></div>
            <div><dt>優勢值</dt><dd>${pick.edgeScore}%</dd></div>
          <div><dt>值搏率</dt><dd>${pick.valueScore}</dd></div>
        </dl>
        ${renderReasonMarkup(pick)}
        ${highOddsNote}
        ${insight ? `<p class="lineup-recheck-note ${insight.trend === "up" ? "up" : insight.trend === "down" ? "down" : ""}">${insight.note}</p>` : ""}
        <div class="card-actions">
          <p class="tap-hint">點擊卡片可查看詳情流程圖</p>
          <button type="button" class="add-odds-btn" data-add-odds="1" data-odds="${pick.currentOdds.toFixed(2)}" data-pick-key="${pickKey}">加入計算機</button>
        </div>
      </article>
    `;
      }
    )
    .join("");
}

function driftLevelLabel(level: "none" | "mild" | "severe"): string {
  if (level === "severe") {
    return "高";
  }
  if (level === "mild") {
    return "中";
  }
  return "低";
}

function highWaterMarketLabel(marketType: HighWaterMarket): string {
  return marketType === "correct_score" ? "波膽" : "半全場";
}

function renderHighWaterCards(snapshot: HighWaterSnapshot | null): string {
  if (!snapshot || snapshot.topCandidates.length === 0) {
    return '<article class="card"><p class="reason">暫時沒有符合高水門檻的波膽或半全場候選。</p></article>';
  }

  return snapshot.topCandidates
    .map((pick, index) => {
      const pickKey = encodeURIComponent(`highwater|${pick.fixtureId}|${pick.market}|${pick.selectionName}`);
      const marketLabels = classifyMarketLabels(pick.market);
      const selectionMarkup = formatSelectionOptionMarkup(pick.selectionName);
      return `
      <article class="card high-water-card" data-drift-level="${pick.driftLevel}">
        <p class="rank-badge">#${index + 1} ${highWaterMarketLabel(pick.marketType)}</p>
        <h3>${pick.match}</h3>
        <p class="kickoff">開賽：${formatTime(pick.kickoffAt)}</p>
        <div class="score-banner">
          <span class="score-pill">EV ${pick.evPct.toFixed(2)}%</span>
          <span class="score-pill score-pill-muted">edge ${pick.edgePct.toFixed(2)}%</span>
          <span class="score-pill score-pill-drift">drift ${driftLevelLabel(pick.driftLevel)}</span>
        </div>
        <div class="pick-highlight-row compact">
          <div class="pick-highlight compact-block">
            <span class="pick-highlight-label">市場類型</span>
            <span class="pick-highlight-value">${marketLabels.typeLabel}</span>
          </div>
          <div class="pick-highlight compact-block">
            <span class="pick-highlight-label">玩法說明</span>
            <span class="pick-highlight-value">${marketLabels.summaryLabel}</span>
          </div>
          <div class="pick-highlight compact-block pick-highlight-emphasis">
            <span class="pick-highlight-label">推介選項</span>
            <span class="pick-highlight-value pick-selection-value">${selectionMarkup}</span>
          </div>
        </div>
        <dl>
          <div><dt>即時賠率</dt><dd>${pick.currentOdds.toFixed(2)}</dd></div>
          <div><dt>模型機率</dt><dd>${pick.modelProbability.toFixed(2)}%</dd></div>
          <div><dt>市場機率</dt><dd>${pick.impliedProbability.toFixed(2)}%</dd></div>
          <div><dt>信心分</dt><dd>${pick.confidence.toFixed(1)}%</dd></div>
        </dl>
        <p class="reason">${pick.rationale.join("；")}</p>
        <div class="card-actions">
          <p class="tap-hint">高水門檻：${pick.thresholdLabel}</p>
          <button type="button" class="add-odds-btn" data-add-odds="1" data-odds="${pick.currentOdds.toFixed(2)}" data-pick-key="${pickKey}">加入計算機</button>
        </div>
      </article>
    `;
    })
    .join("");
}

function recommendationKey(recommendation: Recommendation): string {
  return `${recommendation.fixtureId}|${recommendation.market}|${recommendation.selectionName}`;
}

function formatMoney(amount: number): string {
  return `HK$ ${amount.toFixed(2)}`;
}

function selectedLegs(): number {
  const fallback = 0;
  const value = Number(calcLegs?.value ?? fallback);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(8, Math.floor(value)));
}

type PassSystem = {
  lines: number;
  comboSizes: number[];
};

const PASS_SYSTEMS_BY_LEGS: Record<number, PassSystem[]> = {
  2: [
    { lines: 1, comboSizes: [2] },
    { lines: 3, comboSizes: [1, 2] }
  ],
  3: [
    { lines: 1, comboSizes: [3] },
    { lines: 3, comboSizes: [2] },
    { lines: 4, comboSizes: [1, 3] },
    { lines: 6, comboSizes: [1, 2] },
    { lines: 7, comboSizes: [1, 2, 3] }
  ],
  4: [
    { lines: 1, comboSizes: [4] },
    { lines: 4, comboSizes: [3] },
    { lines: 5, comboSizes: [3, 4] },
    { lines: 6, comboSizes: [2] },
    { lines: 10, comboSizes: [1, 2] },
    { lines: 11, comboSizes: [1, 2, 4] },
    { lines: 14, comboSizes: [1, 2, 3] },
    { lines: 15, comboSizes: [1, 2, 3, 4] }
  ],
  5: [
    { lines: 1, comboSizes: [5] },
    { lines: 5, comboSizes: [4] },
    { lines: 6, comboSizes: [4, 5] },
    { lines: 10, comboSizes: [2] },
    { lines: 15, comboSizes: [1, 2] },
    { lines: 16, comboSizes: [1, 2, 5] },
    { lines: 20, comboSizes: [2, 3] },
    { lines: 25, comboSizes: [1, 2, 3] },
    { lines: 26, comboSizes: [1, 2, 3, 5] },
    { lines: 30, comboSizes: [1, 2, 3, 4] },
    { lines: 31, comboSizes: [1, 2, 3, 4, 5] }
  ],
  6: [
    { lines: 1, comboSizes: [6] },
    { lines: 6, comboSizes: [5] },
    { lines: 7, comboSizes: [5, 6] },
    { lines: 15, comboSizes: [2] },
    { lines: 20, comboSizes: [3] },
    { lines: 21, comboSizes: [3, 6] },
    { lines: 22, comboSizes: [2, 5, 6] },
    { lines: 35, comboSizes: [2, 3] },
    { lines: 41, comboSizes: [2, 3, 5] },
    { lines: 42, comboSizes: [2, 3, 5, 6] },
    { lines: 50, comboSizes: [2, 3, 4] },
    { lines: 56, comboSizes: [1, 2, 3, 4] },
    { lines: 57, comboSizes: [1, 2, 3, 4, 6] },
    { lines: 62, comboSizes: [1, 2, 3, 4, 5] },
    { lines: 63, comboSizes: [1, 2, 3, 4, 5, 6] }
  ],
  7: [
    { lines: 1, comboSizes: [7] },
    { lines: 7, comboSizes: [6] },
    { lines: 8, comboSizes: [6, 7] },
    { lines: 21, comboSizes: [2] },
    { lines: 35, comboSizes: [3] },
    { lines: 120, comboSizes: [1, 2, 3, 4, 5, 7] },
    { lines: 127, comboSizes: [1, 2, 3, 4, 5, 6, 7] }
  ],
  8: [
    { lines: 1, comboSizes: [8] },
    { lines: 8, comboSizes: [7] },
    { lines: 9, comboSizes: [7, 8] },
    { lines: 28, comboSizes: [2] },
    { lines: 56, comboSizes: [3] },
    { lines: 70, comboSizes: [4] },
    { lines: 247, comboSizes: [2, 3, 4, 5, 6, 7, 8] },
    { lines: 255, comboSizes: [1, 2, 3, 4, 5, 6, 7, 8] }
  ]
};

function combinationCount(n: number, r: number): number {
  if (r < 0 || r > n) return 0;
  if (r === 0 || r === n) return 1;
  let numerator = 1;
  let denominator = 1;
  for (let i = 1; i <= r; i += 1) {
    numerator *= n - (r - i);
    denominator *= i;
  }
  return Math.round(numerator / denominator);
}

function selectedPassSystem(legs: number): PassSystem {
  const normalizedLegs = Math.max(2, legs);
  const systems = PASS_SYSTEMS_BY_LEGS[normalizedLegs] ?? PASS_SYSTEMS_BY_LEGS[2];
  const value = Number(calcSystem?.value ?? systems[0].lines);
  return systems.find((system) => system.lines === value) ?? systems[0];
}

function updateSystemOptions(legs: number): void {
  if (!calcSystem) return;
  const normalizedLegs = Math.max(2, legs);
  const previous = calcSystem.value;
  const systems = PASS_SYSTEMS_BY_LEGS[normalizedLegs] ?? PASS_SYSTEMS_BY_LEGS[2];
  const options = systems.map((system) => `<option value="${system.lines}">${normalizedLegs}串${system.lines}</option>`);
  calcSystem.innerHTML = options.join("");
  calcSystem.disabled = legs < 2;

  if (previous && options.some((option) => option.includes(`value=\"${previous}\"`))) {
    calcSystem.value = previous;
  }
}

function readOddsInputRawValues(): string[] {
  if (!oddsRows) return [];
  return Array.from(oddsRows.querySelectorAll<HTMLInputElement>(".calc-odds")).map((input) => input.value.trim());
}

function normalizePickKeys(seedKeys: Array<string | null>, legs: number): Array<string | null> {
  const trimmed = seedKeys.slice(0, legs);
  while (trimmed.length < legs) {
    trimmed.push(null);
  }
  return trimmed;
}

function syncLegsDisplay(legs: number): void {
  if (!calcLegs) return;
  calcLegs.value = String(Math.max(0, Math.min(8, legs)));
}

function renderOddsInputs(legs: number, seedValues: string[] = [], seedKeys: Array<string | null> = []): void {
  if (!oddsRows) return;
  const safeLegs = Math.max(0, Math.min(8, legs));
  syncLegsDisplay(safeLegs);
  updateSystemOptions(safeLegs);
  optionPickKeys = normalizePickKeys(seedKeys, safeLegs);

  const rows = Array.from({ length: safeLegs }, (_, index) => {
    const inputId = `calcOdds${index + 1}`;
    const value = seedValues[index] ?? "";
    return `
      <label>
        <span class="odds-row-title">賠率 ${index + 1}</span>
        <div class="odds-input-row">
          <input id="${inputId}" class="calc-odds" type="number" min="1.01" step="0.01" placeholder="例如 1.85" value="${value}" />
          <button class="delete-odds" type="button" data-index="${index}">刪除</button>
        </div>
      </label>
    `;
  }).join("");

  oddsRows.innerHTML = rows;
  oddsRows.querySelectorAll<HTMLInputElement>(".calc-odds").forEach((input) => {
    input.addEventListener("input", () => {
      computeCalculator();
    });
  });

  oddsRows.querySelectorAll<HTMLButtonElement>(".delete-odds").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index ?? "-1");
      if (!Number.isFinite(index) || index < 0) return;
      const values = readOddsInputRawValues();
      values.splice(index, 1);
        const keys = [...optionPickKeys];
        keys.splice(index, 1);
        renderOddsInputs(values.length, values, keys);
      computeCalculator();
      if (calcHint) {
        calcHint.textContent = "已刪除一個選項。";
      }
    });
  });
}

function resetCalculator(): void {
  if (calcStake) calcStake.value = "100";
  renderOddsInputs(0, [], []);
  computeCalculator();
}

function readOddsInputs(): number[] {
  if (!oddsRows) return [];
  return Array.from(oddsRows.querySelectorAll<HTMLInputElement>(".calc-odds"))
    .map((input) => Number(input.value))
    .filter((value) => Number.isFinite(value));
}

function combinationProducts(odds: number[], r: number): number[] {
  const result: number[] = [];

  const walk = (start: number, depth: number, product: number): void => {
    if (depth === r) {
      result.push(product);
      return;
    }

    for (let i = start; i <= odds.length - (r - depth); i += 1) {
      walk(i + 1, depth + 1, product * odds[i]);
    }
  };

  walk(0, 0, 1);
  return result;
}

function computeCalculator(): void {
  if (!calcCombinedOdds || !calcTotalStake || !calcPayout || !calcProfit || !calcBreakeven || !calcHint) return;

  const stake = Number(calcStake?.value ?? "0");
  const odds = readOddsInputs();
  const legs = selectedLegs();

  if (legs < 2) {
    calcHint.textContent = "請先加入至少 2 個選項賠率。";
    calcCombinedOdds.textContent = "-";
    calcTotalStake.textContent = "-";
    calcPayout.textContent = "-";
    calcProfit.textContent = "-";
    calcBreakeven.textContent = "-";
    return;
  }

  const passSystem = selectedPassSystem(legs);
  const systemSizes = passSystem.comboSizes;

  if (!Number.isFinite(stake) || stake <= 0) {
    calcHint.textContent = "請輸入有效注額。";
    calcCombinedOdds.textContent = "-";
    calcTotalStake.textContent = "-";
    calcPayout.textContent = "-";
    calcProfit.textContent = "-";
    calcBreakeven.textContent = "-";
    return;
  }

  if (odds.length < legs || odds.some((value) => value < 1.01)) {
    calcHint.textContent = "請輸入所有賠率（每項需大於或等於 1.01）。";
    calcCombinedOdds.textContent = "-";
    calcTotalStake.textContent = "-";
    calcPayout.textContent = "-";
    calcProfit.textContent = "-";
    calcBreakeven.textContent = "-";
    return;
  }

  const payouts = systemSizes.flatMap((r) => combinationProducts(odds.slice(0, legs), r).map((oddsProduct) => oddsProduct * stake));
  const totalLines = payouts.length;
  const totalStake = totalLines * stake;
  const maxPayout = payouts.reduce((sum, value) => sum + value, 0);
  const maxProfit = maxPayout - totalStake;
  const returnPerDollar = maxPayout / Math.max(totalStake, 1e-6);
  const breakeven = (1 / Math.max(returnPerDollar, 1e-6)) * 100;

  calcCombinedOdds.textContent = String(totalLines);
  calcTotalStake.textContent = formatMoney(totalStake);
  calcPayout.textContent = formatMoney(maxPayout);
  calcProfit.textContent = formatMoney(maxProfit);
  calcBreakeven.textContent = `${breakeven.toFixed(2)}%`;
  calcHint.textContent = `${legs}串${passSystem.lines} 計算完成。`;
}

function clearAddedOdds(): void {
  renderOddsInputs(0, [], []);
  computeCalculator();
  if (calcHint) {
    calcHint.textContent = "已清空所有已加入賠率。";
  }
}

function addOddsToCalculator(odds: number, pickKey: string): void {
  if (!Number.isFinite(odds) || odds < 1.01) {
    return;
  }

  if (pickKey) {
    const duplicateIndex = optionPickKeys.findIndex((key) => key === pickKey);
    if (duplicateIndex >= 0) {
      if (calcHint) {
        calcHint.textContent = `此推介已加入（第 ${duplicateIndex + 1} 項），已避免重複加入。`;
      }
      return;
    }
  }

  const oddsText = odds.toFixed(2);
  const currentValues = readOddsInputRawValues();
  const currentKeys = [...optionPickKeys];

  if (currentValues.length < 8) {
    const nextValues = [...currentValues, oddsText];
    const nextKeys = [...currentKeys, pickKey || null];
    renderOddsInputs(nextValues.length, nextValues, nextKeys);
    computeCalculator();
    if (calcHint) {
      calcHint.textContent = `已加入賠率 ${oddsText}，選項數目前為 ${nextValues.length}`;
    }
    return;
  }

  const replacedValues = [...currentValues];
  replacedValues[replacedValues.length - 1] = oddsText;
  const replacedKeys = [...currentKeys];
  replacedKeys[replacedKeys.length - 1] = pickKey || null;
  renderOddsInputs(replacedValues.length, replacedValues, replacedKeys);
  computeCalculator();
  if (calcHint) {
    calcHint.textContent = `已滿 8 個選項，已以賠率 ${oddsText} 覆蓋最後一項`;
  }
}

function findRecommendationByKey(key: string, snapshot: Snapshot | null): Recommendation | null {
  if (!snapshot) {
    return null;
  }

  const pool = [
    ...snapshot.topFiveRecommendations,
    ...snapshot.highOddsValueRecommendations,
    ...snapshot.recommendationShortlist,
    ...snapshot.consensusApprovedRecommendations,
    ...snapshot.consensusRejectedRecommendations
  ];
  const found = pool.find((item) => recommendationKey(item) === key);
  return found ?? null;
}

function renderRecommendationDetail(pick: Recommendation | null): void {
  if (
    !detailTitle ||
    !detailSubtitle ||
    !detailMarket ||
    !detailSelection ||
    !detailOdds ||
    !detailConfidenceEdge ||
    !detailReason ||
    !detailAddOddsBtn
  ) {
    return;
  }

  if (!pick) {
    detailTitle.textContent = "推介詳情";
    detailSubtitle.textContent = "找不到該推介，請返回主頁重新選擇。";
    detailMarket.textContent = "-";
    detailSelection.textContent = "-";
    detailOdds.textContent = "-";
    detailConfidenceEdge.textContent = "-";
    detailReason.textContent = "-";
    detailAddOddsBtn.disabled = true;
    detailAddOddsBtn.dataset.pickKey = "";
    detailAddOddsBtn.dataset.odds = "";
    return;
  }

  detailTitle.textContent = pick.match;
  detailSubtitle.textContent = `開賽：${formatTime(pick.kickoffAt)}｜場次 ${pick.fixtureId}`;
  detailMarket.textContent = pick.market;
  detailSelection.textContent = formatRecommendationSelection(pick.market, pick.selectionName);
  detailOdds.textContent = pick.currentOdds.toFixed(2);
  const halfTimeLabel = formatScorelinePrediction("半場", pick.halfTimeScorePrediction);
  const fullTimeLabel = formatScorelinePrediction("全場", pick.fullTimeScorePrediction);
  const alternateScoreLabel = formatAlternateScorePredictions(pick.scorePredictionAlternatives);
  const correctScoreConfidence = pick.correctScoreConfidence ?? "模型弱信號";
  detailConfidenceEdge.textContent = pick.highOddsProfile
    ? `${pick.confidence}% / ${pick.edgeScore}%｜${halfTimeLabel}・${fullTimeLabel}｜次佳 ${alternateScoreLabel}｜${correctScoreConfidence}｜Tier ${pick.highOddsProfile.tier}｜建議注碼 ${pick.highOddsProfile.suggestedStakePct.toFixed(2)}%`
    : `${pick.confidence}% / ${pick.edgeScore}%｜${halfTimeLabel}・${fullTimeLabel}｜次佳 ${alternateScoreLabel}｜${correctScoreConfidence}`;
  detailReason.innerHTML = renderReasonMarkup(pick);
  detailAddOddsBtn.disabled = false;
  detailAddOddsBtn.dataset.pickKey = recommendationKey(pick);
  detailAddOddsBtn.dataset.odds = pick.currentOdds.toFixed(2);
}

function switchView(view: AppView): void {
  if (!dashboardPage || !learningHistoryPage || !recommendationDetailPage || !fixtureAnalysisPage) {
    return;
  }

  dashboardPage.classList.toggle("hidden", view !== "dashboard");
  learningHistoryPage.classList.toggle("hidden", view !== "history");
  recommendationDetailPage.classList.toggle("hidden", view !== "detail");
  fixtureAnalysisPage.classList.toggle("hidden", view !== "fixtures");

  if (view === "fixtures" && latestSnapshotState) {
    renderFixturePage();
  }
}

function parseRouteState(raw: unknown): AppRouteState | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const state = raw as Partial<AppRouteState>;
  if (
    state.appView !== "dashboard" &&
    state.appView !== "history" &&
    state.appView !== "detail" &&
    state.appView !== "fixtures"
  ) {
    return null;
  }

  if (state.appView === "detail" && (!state.pickKey || typeof state.pickKey !== "string")) {
    return null;
  }

  return {
    appView: state.appView,
    pickKey: state.pickKey
  };
}

function navigateToView(view: AppView, options: { pushHistory?: boolean; pickKey?: string } = {}): void {
  const { pushHistory = true, pickKey } = options;

  if (view === "detail") {
    const key = pickKey ?? activeDetailPickKey;
    if (!key) {
      return;
    }
    activeDetailPickKey = key;
    const pick = findRecommendationByKey(key, latestSnapshotState);
    renderRecommendationDetail(pick);
    renderDecisionFlow(latestSnapshotState, latestPracticeInsight, latestAssistantConfig, pick?.fixtureId);
    switchView("detail");
    const state: AppRouteState = { appView: "detail", pickKey: key };
    if (pushHistory) {
      window.history.pushState(state, "");
    } else {
      window.history.replaceState(state, "");
    }
    return;
  }

  if (view === "history") {
    switchView("history");
    updateHistoryToolbarMode();
    const loader = historyDatasetMode === "learning" ? fetchLearningHistory : fetchBackgroundTrainingHistory;
    void loader().catch(() => {
      if (historyMeta) {
        historyMeta.textContent = "讀取歷史記錄失敗，請稍後再試。";
      }
      if (historyDatasetMode === "learning") {
        renderLearningHistory([]);
      } else {
        renderBackgroundTrainingHistory([]);
      }
    });
  } else if (view === "fixtures") {
    switchView("fixtures");
    renderFixturePage();
  } else {
    switchView("dashboard");
  }

  const state: AppRouteState = { appView: view };
  if (pushHistory) {
    window.history.pushState(state, "");
  } else {
    window.history.replaceState(state, "");
  }
}

function restoreViewFromHistoryState(rawState: unknown): void {
  const routeState = parseRouteState(rawState);
  if (!routeState) {
    navigateToView("dashboard", { pushHistory: false });
    return;
  }

  if (routeState.appView === "detail") {
    navigateToView("detail", { pushHistory: false, pickKey: routeState.pickKey });
    return;
  }

  if (routeState.appView === "fixtures") {
    navigateToView("fixtures", { pushHistory: false });
    return;
  }

  navigateToView(routeState.appView, { pushHistory: false });
}

function openRecommendationDetail(pickKey: string): void {
  navigateToView("detail", { pushHistory: true, pickKey });
}

function bindRecommendationCardActions(container: HTMLDivElement | null): void {
  if (!container) return;

  const handleTarget = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof HTMLElement)) return null;
    return target.closest<HTMLElement>(".recommendation-card");
  };

  container.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const addButton = target.closest<HTMLButtonElement>(".add-odds-btn");
    if (addButton) {
      event.stopPropagation();
      const odds = Number(addButton.dataset.odds ?? "0");
      const pickKey = decodeURIComponent(addButton.dataset.pickKey ?? "");
      addOddsToCalculator(odds, pickKey);
      return;
    }

    const card = handleTarget(event.target);
    if (!card) return;
    const pickKey = decodeURIComponent(card.dataset.pickKey ?? "");
    if (!pickKey) return;
    openRecommendationDetail(pickKey);
  });

  container.addEventListener("keydown", (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") {
      return;
    }
    const card = handleTarget(keyboardEvent.target);
    if (!card) return;
    keyboardEvent.preventDefault();
    const pickKey = decodeURIComponent(card.dataset.pickKey ?? "");
    if (!pickKey) return;
    openRecommendationDetail(pickKey);
  });
}

function renderLearning(learning: LearningSnapshot | null): void {
  if (!learningRecentHitRate || !learningBiggestBlindspot || !learningCorrectionStrength || !learningStatus) {
    return;
  }

  if (!learning) {
    learningRecentHitRate.textContent = "-";
    learningBiggestBlindspot.textContent = "-";
    learningCorrectionStrength.textContent = "0%";
    learningStatus.textContent = "暫未有學習資料。";
    return;
  }

  const recent = learning.recent.slice(0, 20);
  const recentWins = recent.filter((record) => record.result === "win").length;
  const recentHitRate = recent.length === 0 ? 0 : (recentWins / recent.length) * 100;

  const blindspotEntries = Object.entries(learning.blindspots.byMarket).filter(([, metric]) => metric.sample >= 3);
  const largestBlindspot =
    blindspotEntries.sort((a, b) => a[1].hitRate - b[1].hitRate || b[1].sample - a[1].sample)[0] ?? null;

  const penalties = [
    ...Object.values(learning.correction.marketPenalty),
    ...Object.values(learning.correction.oddsBucketPenalty),
    ...Object.values(learning.correction.confidenceBucketPenalty),
    ...Object.values(learning.correction.sidePenalty)
  ].filter((value) => Number.isFinite(value) && value > 0);
  const maxPenalty = penalties.length === 0 ? 0 : Math.max(...penalties);
  const avgPenalty =
    penalties.length === 0 ? 0 : penalties.reduce((sum, value) => sum + value, 0) / Math.max(penalties.length, 1);

  learningRecentHitRate.textContent = `${recentHitRate.toFixed(1)}%（${recentWins}/${recent.length || 0}）`;

  if (!largestBlindspot) {
    learningBiggestBlindspot.textContent = "樣本不足";
  } else {
    const [market, metric] = largestBlindspot;
    learningBiggestBlindspot.textContent = `${market}（命中 ${(metric.hitRate * 100).toFixed(1)}%，樣本 ${metric.sample}）`;
  }

  learningCorrectionStrength.textContent = `平均 ${(avgPenalty * 100).toFixed(1)}% / 最大 ${(maxPenalty * 100).toFixed(1)}%`;

  if (learning.diagnostics?.summary) {
    learningStatus.textContent = learning.diagnostics.summary;
  } else {
    learningStatus.textContent = `已結算 ${learning.settledCount} 筆；待結算 ${learning.pendingCount} 筆。`;
  }
}

function renderAutoTraining(progress: AutoTrainingProgress | null): void {
  if (!autoTrainingLastAdded || !autoTrainingTotal || !autoTrainingHitRate || !autoTrainingHeadline) {
    return;
  }

  if (!progress) {
    autoTrainingLastAdded.textContent = "-";
    autoTrainingTotal.textContent = "-";
    autoTrainingHitRate.textContent = "-";
    autoTrainingHeadline.textContent = "背景訓練進度暫時不可用";
    return;
  }

  autoTrainingLastAdded.textContent = `${progress.lastCycleAdded} 筆`;
  autoTrainingTotal.textContent = `${progress.totalAutoRecords} 筆`;
  autoTrainingHitRate.textContent = `${(progress.recentHitRate * 100).toFixed(1)}%（${progress.recentSample} 場）`;
  const gateBlocked = Number.isFinite(progress.lastCycleGateBlocked) ? progress.lastCycleGateBlocked : 0;
  const gateReplenished = Number.isFinite(progress.lastCycleGateReplenished) ? progress.lastCycleGateReplenished : 0;
  const idleHint =
    progress.totalAutoRecords === 0
      ? "目前未有可訓練的已結算樣本，需等完場結算或手動補結算後才會累積。"
      : progress.recentSample === 0
        ? "最近區間暫時沒有新結算樣本。"
        : "";
  autoTrainingHeadline.textContent = `背景訓練：最近新增 ${progress.lastCycleAdded} 筆，累計 ${progress.totalAutoRecords} 筆，最近命中 ${(progress.recentHitRate * 100).toFixed(1)}%（${progress.recentSample} 場），更新於 ${formatTime(progress.updatedAt)}${idleHint ? `（${idleHint}）` : ""}`;
  autoTrainingHeadline.textContent += `｜gate 擋掉 ${gateBlocked} 筆／補回 ${gateReplenished} 筆`;
}

function renderDataSourceHealth(health: DataSourceHealth | null): void {
  if (!dataSourceStatus) {
    return;
  }

  if (!health) {
    dataSourceStatus.textContent = "資料源狀態：無法讀取";
    dataSourceStatus.classList.add("warning");
    return;
  }

  dataSourceStatus.classList.toggle("warning", !health.ok);
  const version = health.queryVersion ? `｜版本 ${health.queryVersion}` : "";
  const errorText = health.lastError ? `｜錯誤 ${health.lastError}` : "";
  dataSourceStatus.textContent = `資料源：${health.provider}${version}｜盤口 ${health.optionsCount}（賽事 ${health.fixtureCount}）｜狀態 ${health.ok ? "正常" : "異常"}${errorText}`;
}

function renderWalkForward(metrics: WalkForwardMetrics | null): void {
  if (!walkForwardMeta || !walkForwardRps || !walkForwardEce || !walkForwardEvaluated || !walkForwardTrend) {
    return;
  }

  if (!metrics) {
    walkForwardMeta.textContent = "暫時未能讀取 walk-forward 指標";
    walkForwardRps.textContent = "-";
    walkForwardEce.textContent = "-";
    walkForwardEvaluated.textContent = "-";
    walkForwardTrend.innerHTML = '<p class="history-empty">暫時沒有可視化資料。</p>';
    return;
  }

  walkForwardMeta.textContent = `更新：${formatTime(metrics.generatedAt)}｜settled ${metrics.totalSettled}｜warmup ${metrics.warmup}｜lookback ${metrics.lookback}`;
  walkForwardRps.textContent = metrics.meanRps.toFixed(5);
  walkForwardEce.textContent = metrics.ece.toFixed(5);
  walkForwardEvaluated.textContent = `${metrics.evaluated} 筆`;

  if (metrics.trend.length === 0) {
    walkForwardTrend.innerHTML = '<p class="history-empty">樣本仍不足，趨勢圖將在累積後顯示。</p>';
    return;
  }

  const points = metrics.trend;
  const minRps = Math.min(...points.map((item) => item.meanRps));
  const maxRps = Math.max(...points.map((item) => item.meanRps));
  const minEce = Math.min(...points.map((item) => item.ece));
  const maxEce = Math.max(...points.map((item) => item.ece));

  const xOf = (index: number): number => {
    if (points.length <= 1) return 0;
    return (index / (points.length - 1)) * 100;
  };

  const yOf = (value: number, min: number, max: number): number => {
    const span = Math.max(0.000001, max - min);
    return 100 - ((value - min) / span) * 100;
  };

  const rpsPath = points
    .map((point, index) => `${xOf(index).toFixed(2)},${yOf(point.meanRps, minRps, maxRps).toFixed(2)}`)
    .join(" ");
  const ecePath = points
    .map((point, index) => `${xOf(index).toFixed(2)},${yOf(point.ece, minEce, maxEce).toFixed(2)}`)
    .join(" ");

  const latest = points[points.length - 1];
  walkForwardTrend.innerHTML = `
    <div class="walk-forward-legend">
      <span class="legend-item legend-rps">RPS 趨勢</span>
      <span class="legend-item legend-ece">ECE 趨勢</span>
      <span class="legend-item">最新窗口命中率 ${(latest.hitRate * 100).toFixed(1)}%</span>
    </div>
    <svg class="walk-forward-svg" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="walk-forward trend">
      <polyline class="trend-line trend-rps" points="${rpsPath}" />
      <polyline class="trend-line trend-ece" points="${ecePath}" />
    </svg>
  `;
}

function trainingMarketDisplayName(key: "asian_handicap" | "match_result" | "goals_over_under"): string {
  if (key === "asian_handicap") return "亞洲盤讓球盤";
  if (key === "match_result") return "主客和";
  return "入球大小";
}

function driftSeverityLabel(severity: "none" | "mild" | "severe"): string {
  if (severity === "severe") return "嚴重";
  if (severity === "mild") return "輕微";
  return "正常";
}

function renderTrainingGateStatus(status: TrainingGateStatus | null): void {
  if (!gateMonitorMeta || !gateMonitorDrift || !gateMarketCards) {
    return;
  }

  if (!status) {
    gateMonitorMeta.textContent = "暫時未能讀取 gate 監控";
    gateMonitorDrift.textContent = "drift 資訊不可用";
    gateMonitorDrift.classList.remove("warning", "danger");
    gateMarketCards.innerHTML = '<article class="history-card"><p class="history-empty">暫時沒有門檻資料。</p></article>';
    return;
  }

  gateMonitorMeta.textContent = `更新：${formatTime(status.generatedAt)}｜calibration: ${status.calibrationUpdatedAt ? formatTime(status.calibrationUpdatedAt) : "尚未持久化"}`;

  const severityLabel = driftSeverityLabel(status.drift.severity);
  gateMonitorDrift.textContent = `Drift 等級：${severityLabel}｜active: ${status.drift.active ? "是" : "否"}｜candidateRatio 因子: x${status.drift.candidateRatioFactor.toFixed(2)}`;
  gateMonitorDrift.classList.toggle("warning", status.drift.severity === "mild");
  gateMonitorDrift.classList.toggle("danger", status.drift.severity === "severe");

  const keys: Array<"asian_handicap" | "match_result" | "goals_over_under"> = [
    "asian_handicap",
    "match_result",
    "goals_over_under"
  ];

  gateMarketCards.innerHTML = keys
    .map((key) => {
      const market = status.markets[key];
      return `
        <article class="learning-card gate-card">
          <p class="learning-label">${trainingMarketDisplayName(key)}</p>
          <p class="learning-value">命中 ${(market.recentHitRate * 100).toFixed(1)}%（${market.recentSample} / ${market.totalSample}）</p>
          <dl>
            <div><dt>minConfidence</dt><dd>${market.thresholds.minConfidence.toFixed(2)}%</dd></div>
            <div><dt>minEdgeScore</dt><dd>${market.thresholds.minEdgeScore.toFixed(2)}</dd></div>
            <div><dt>minValueScore</dt><dd>${market.thresholds.minValueScore.toFixed(4)}</dd></div>
            <div><dt>minProbEdge</dt><dd>${market.thresholds.minProbabilityEdge.toFixed(4)}</dd></div>
            <div><dt>maxOdds</dt><dd>${market.thresholds.maxOdds.toFixed(2)}</dd></div>
            <div><dt>calibScale</dt><dd>${market.calibration.scale.toFixed(4)}</dd></div>
          </dl>
        </article>
      `;
    })
    .join("");
}

function renderDecisionItems(
  container: HTMLDivElement | null,
  items: Recommendation[],
  emptyText: string,
  itemClassName = ""
): void {
  if (!container) {
    return;
  }

  if (items.length === 0) {
    container.innerHTML = `<p class="decision-empty">${emptyText}</p>`;
    return;
  }

  container.innerHTML = items
    .map(
      (item) => `
        <article class="decision-item ${itemClassName}">
          <div class="decision-item-top">
            <p class="decision-item-match">${item.match}</p>
            <p class="decision-item-market">${item.market}</p>
          </div>
          <p class="decision-item-selection">${item.selectionName}</p>
          <dl>
            <div><dt>賠率</dt><dd>${item.currentOdds.toFixed(2)}</dd></div>
            <div><dt>信心</dt><dd>${item.confidence}%</dd></div>
          </dl>
          <p class="decision-item-reason">${item.reason}</p>
        </article>
      `
    )
    .join("");
}

function renderDecisionReasons(container: HTMLDivElement | null, items: Recommendation[], emptyText: string): void {
  if (!container) {
    return;
  }

  if (items.length === 0) {
    container.innerHTML = `<p class="decision-empty">${emptyText}</p>`;
    return;
  }

  container.innerHTML = items
    .map(
      (item) => `
        <article class="decision-reason-item">
          <div class="decision-reason-top">
            <p class="decision-item-match">${item.match}</p>
            <p class="decision-item-market">${item.market}</p>
          </div>
          <p class="decision-item-selection">${item.selectionName}</p>
          <p class="decision-item-reason">${item.reason}</p>
        </article>
      `
    )
    .join("");
}

function activeDetailFixtureId(snapshot: Snapshot | null): string | undefined {
  if (!activeDetailPickKey) {
    return undefined;
  }

  return findRecommendationByKey(activeDetailPickKey, snapshot ?? latestSnapshotState)?.fixtureId;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderAssistantEnrichment(insight: ModelAssistantInsight | null, config?: PracticeApiResponse["assistantConfig"]): void {
  if (!assistantEnrichmentPanel) {
    return;
  }

  const weightLabels: Record<string, string> = {
    strengthGap: "強度差距",
    recentForm: "近期狀態",
    lineupFitness: "陣容適應度",
    expertSentiment: "專家信號",
    oddsMomentum: "賠率動向"
  };

  const thresholdLabels: Record<string, string> = {
    minRecommendedOdds: "最低推薦 odds",
    highOddsThreshold: "高賠門檻",
    highOddsMinEdgeScore: "高水最小 edge",
    highOddsMinValueScore: "高水最小 valueScore"
  };

  const buildSimpleSummary = (enrichment: ModelAssistantInsight["enrichment"]) => {
    const newsCount = enrichment?.news.length ?? 0;
    const injuryCount = enrichment?.injuries.length ?? 0;
    const weatherCount = enrichment?.weather.length ?? 0;
    const issueCount = enrichment?.issues.length ?? 0;

    const labels: string[] = [];
    if (newsCount > 0) labels.push("新聞");
    if (injuryCount > 0) labels.push("傷停");
    if (weatherCount > 0) labels.push("天氣");

    if (labels.length === 0 && issueCount === 0) {
      return "本輪未檢測到足夠外部訊號，僅用內部模型判斷。";
    }

    const signalText = labels.length > 0 ? `${labels.join("、")}訊號` : "外部訊號";
    const issueText = issueCount > 0 ? "仍有少量資料缺口" : "資料較完整";
    return `本輪 AI 以${signalText}作為輔助，${issueText}，並納入最新賽事背景與風險提示。`;
  };

  const buildAdjustmentList = (entries: Array<[string, number | undefined]>, labels: Record<string, string>) => {
    const validEntries = entries.filter(([, value]) => typeof value === "number" && Number.isFinite(value));
    if (validEntries.length === 0) {
      return "";
    }

    return `
      <div class="assistant-adjustment-grid">
        ${validEntries
          .map(([key, value]) => {
            const label = labels[key] ?? key;
            const formattedValue =
              key === "minRecommendedOdds" || key === "highOddsThreshold"
                ? Number(value).toFixed(2)
                : key === "highOddsMinValueScore"
                  ? Number(value).toFixed(3)
                  : Number(value).toFixed(2);
            return `
              <div class="assistant-adjustment-card">
                <span class="assistant-adjustment-key">${label}</span>
                <strong>${formattedValue}</strong>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  };

  const enrichment = insight?.enrichment;
  const findings = insight?.keyFindings ?? [];
  const actions = insight?.actionItems ?? [];
  const weightEntries = insight ? Object.entries(insight.suggestedWeights ?? {}) : [];
  const thresholdEntries = insight ? Object.entries(insight.suggestedThresholds ?? {}) : [];
  const summaryText = insight?.summary ?? (config?.enabled ? "AI 審查已啟動，等待最新輪次結果。" : "目前未啟用 AI 審查。");

  if (!enrichment && !insight) {
    const waitingText = config?.enabled
      ? "外部訊號整合中，僅顯示簡要狀態。"
      : "目前未啟用 AI 審查，外部訊號暫不可用。";
    assistantEnrichmentPanel.innerHTML = `
      <p class="assistant-enrichment-title">AI 外部訊號審查（最新一輪）</p>
      <p class="assistant-enrichment-empty">${waitingText}</p>
    `;
    return;
  }

  const signalSummary = enrichment ? buildSimpleSummary(enrichment) : "本輪未提供外部訊號摘要。";
  const adjustmentSummary =
    weightEntries.length > 0 || thresholdEntries.length > 0
      ? `本輪 AI 建議調整：${weightEntries.length > 0 ? `${weightEntries.length} 項權重` : ""}${weightEntries.length > 0 && thresholdEntries.length > 0 ? "、" : ""}${thresholdEntries.length > 0 ? `${thresholdEntries.length} 項門檻` : ""}`
      : "本輪沒有發現需要立即調整的權重或門檻。";

  assistantEnrichmentPanel.innerHTML = `
    <p class="assistant-enrichment-title">AI 外部訊號審查（最新一輪）</p>
    <p class="assistant-enrichment-empty">${signalSummary}</p>
    <div class="assistant-adjustment-panel">
      <div class="assistant-adjustment-header">
        <h3>AI 本輪修正結果</h3>
        <span class="assistant-confidence">信心 ${(insight?.confidence ?? 0) * 100}%</span>
      </div>
      <p class="assistant-adjustment-summary">${summaryText}</p>
      <p class="assistant-adjustment-summary subtle">${adjustmentSummary}</p>
      ${weightEntries.length > 0 ? `
        <div class="assistant-adjustment-block">
          <p class="assistant-adjustment-label">權重修正</p>
          ${buildAdjustmentList(weightEntries as Array<[string, number | undefined]>, weightLabels)}
        </div>
      ` : ""}
      ${thresholdEntries.length > 0 ? `
        <div class="assistant-adjustment-block">
          <p class="assistant-adjustment-label">門檻修正</p>
          ${buildAdjustmentList(thresholdEntries as Array<[string, number | undefined]>, thresholdLabels)}
        </div>
      ` : ""}
      ${findings.length > 0 ? `
        <div class="assistant-adjustment-block">
          <p class="assistant-adjustment-label">盲點與觀察</p>
          <ul class="assistant-adjustment-list">
            ${findings.slice(0, 4).map((item) => `<li>${item}</li>`).join("")}
          </ul>
        </div>
      ` : ""}
      ${actions.length > 0 ? `
        <div class="assistant-adjustment-block">
          <p class="assistant-adjustment-label">下一步行動</p>
          <ul class="assistant-adjustment-list">
            ${actions.slice(0, 3).map((item) => `<li>${item}</li>`).join("")}
          </ul>
        </div>
      ` : ""}
      ${insight ? `<p class="assistant-enrichment-note">狀態：${insight.applied ? "已自動套用" : "本輪建議已生成，等待達到自動套用門檻"}</p>` : ""}
    </div>
  `;
}

function renderAssistantMode(insight: ModelAssistantInsight | null, config?: PracticeApiResponse["assistantConfig"]): void {
  if (!assistantModeStatus) {
    return;
  }

  if (!insight) {
    if (config?.enabled && config.hasApiKey) {
      assistantModeStatus.classList.remove("fallback");
      assistantModeStatus.textContent = `AI 審查：目前使用 OpenRouter（${config.model}）`;
      renderAssistantEnrichment(null, config);
      return;
    }

    assistantModeStatus.classList.add("fallback");
    assistantModeStatus.textContent = "AI 審查：目前使用本地 fallback（尚未有最新審查結果）";
    renderAssistantEnrichment(null, config);
    return;
  }

  const isOpenRouter = insight.reviewMode === "openrouter";
  assistantModeStatus.classList.toggle("fallback", !isOpenRouter);
  if (isOpenRouter) {
    assistantModeStatus.textContent = `AI 審查：目前使用 OpenRouter（${insight.model}）`;
    renderAssistantEnrichment(insight, config);
    return;
  }

  const missingApiKey = config ? !config.hasApiKey : false;
  if (missingApiKey) {
    assistantModeStatus.textContent = "AI 審查：目前使用本地 fallback（未設定 OPENROUTER_API_KEY）";
    renderAssistantEnrichment(insight, config);
    return;
  }

  const hasUpstreamIssue = insight.dataIssues.some(
    (issue) =>
      issue.includes("OpenRouter request failed")
      || issue.includes("OpenRouter response could not be parsed")
      || issue.includes("OpenRouter fallback chain exhausted")
      || issue.includes("OpenRouter consensus fallback exhausted")
  );
  assistantModeStatus.textContent = hasUpstreamIssue
    ? "AI 審查：目前使用本地 fallback（OpenRouter 暫時不可用）"
    : "AI 審查：目前使用本地 fallback";
  renderAssistantEnrichment(insight, config);
}

function renderDecisionFlow(
  snapshot: Snapshot | null,
  insight: ModelAssistantInsight | null,
  config?: PracticeApiResponse["assistantConfig"],
  fixtureId?: string
): void {
  if (
    !decisionModeBadge ||
    !decisionModeTitle ||
    !decisionOutputSource ||
    !decisionModeDescription ||
    !decisionConsensusSummary ||
    !decisionRejectReasons ||
    !decisionModelCount ||
    !decisionKeepCount ||
    !decisionModelCountInline ||
    !decisionKeepCountInline ||
    !decisionRejectCount
  ) {
    return;
  }

  const shortlistSource = snapshot?.recommendationShortlist ?? [];
  const approvedSource = snapshot?.consensusApprovedRecommendations ?? [];
  const rejectedSource = snapshot?.consensusRejectedRecommendations ?? [];
  const shortlist = fixtureId
    ? shortlistSource.filter((recommendation) => recommendation.fixtureId === fixtureId)
    : shortlistSource;
  const approved = fixtureId
    ? approvedSource.filter((recommendation) => recommendation.fixtureId === fixtureId)
    : approvedSource;
  const rejected = fixtureId
    ? rejectedSource.filter((recommendation) => recommendation.fixtureId === fixtureId)
    : rejectedSource;
  const consensusReport = snapshot?.consensusReport;

  const hasOpenRouterConfigured = Boolean(config?.enabled && config?.hasApiKey);
  const autoApplyEnabled = Boolean(config?.autoApply);
  const lastRunApplied = Boolean(insight?.applied);
  const outputUsesOpenRouter = insight?.reviewMode === "openrouter";
  const outputSource = !insight
    ? hasOpenRouterConfigured
      ? `OpenRouter（${config?.model ?? "未指定模型"}）`
      : "本地 fallback"
    : outputUsesOpenRouter
      ? `OpenRouter（${insight.model}）`
      : insight.dataIssues.some((issue) => issue.includes("OpenRouter"))
        ? "本地 fallback（OpenRouter 暫不可用）"
        : "本地 fallback";

  let modeBadge = consensusReport?.reviewMode === "openrouter" ? "模型 + AI 共識" : "模型主選";
  let modeTitle = consensusReport?.reviewMode === "openrouter" ? "模型 shortlist / AI 共識審查" : "模型主選 / AI 只審查";
  let modeDescription = consensusReport?.reviewMode === "openrouter"
    ? "本地模型先挑 shortlist，再交給 AI 做二次審查；最後只保留雙方都認同的推介。"
    : "目前由本地 scoring engine 直接決定推介；AI 只提供審查、盲點分析和微調建議，不會自動改今日推薦。";

  if (hasOpenRouterConfigured && autoApplyEnabled) {
    modeBadge = lastRunApplied ? "已自動套用" : "AI 可自動套用";
    modeTitle = lastRunApplied ? "AI 建議已自動套用" : "模型主選 / AI 達標後自動套用";
    modeDescription = lastRunApplied
      ? `最近一次 AI 建議已成功套用到模型參數；只有當 AI 信心高於 ${(config?.minConfidence ?? 0) * 100}% 時才會自動改權重或門檻。`
      : `目前仍由模型主選，但已開啟 AI 自動套用；當 AI 信心高於 ${(config?.minConfidence ?? 0) * 100}% 時，建議會直接更新權重或門檻。`;
  } else if (!hasOpenRouterConfigured) {
    modeBadge = "本地審查";
    modeTitle = "模型主選 / 本地 fallback 審查";
    modeDescription = "目前沒有可用的 OpenRouter 雲端審查，系統仍會用本地 fallback 產生保守檢討，但不會自動改模型參數。";
  }

  decisionModeBadge.textContent = modeBadge;
  decisionModeTitle.textContent = modeTitle;
  decisionOutputSource.textContent = outputSource;
  decisionModeDescription.textContent = modeDescription;
  decisionConsensusSummary.textContent = consensusReport?.summary ?? "尚未載入共識摘要。";

  decisionModeBadge.classList.toggle("auto-apply", autoApplyEnabled);
  decisionModeBadge.classList.toggle("fallback", !hasOpenRouterConfigured);

  decisionModelCount.textContent = String(shortlist.length);
  decisionKeepCount.textContent = String(approved.length);
  decisionModelCountInline.textContent = String(shortlist.length);
  decisionKeepCountInline.textContent = String(approved.length);
  decisionRejectCount.textContent = String(rejected.length);

  renderDecisionItems(
    decisionModelList,
    shortlist,
    fixtureId
      ? consensusReport?.reviewMode === "openrouter"
        ? "該場次目前沒有模型 shortlist。"
        : "尚未載入該場次的模型 shortlist。"
      : consensusReport?.reviewMode === "openrouter"
        ? "目前沒有模型 shortlist。"
        : "尚未載入模型 shortlist。"
  );
  renderDecisionItems(
    decisionKeepList,
    approved,
    fixtureId
      ? consensusReport?.reviewMode === "openrouter"
        ? "AI 在此場次沒有保留任何候選。"
        : "尚未載入該場次 AI 保留結果。"
      : consensusReport?.reviewMode === "openrouter"
        ? "AI 這輪沒有保留任何候選。"
        : "尚未載入 AI 保留結果。",
    "decision-item-approved"
  );
  renderDecisionItems(
    decisionRejectList,
    rejected,
    fixtureId
      ? consensusReport?.reviewMode === "openrouter"
        ? "此場次沒有被 AI 拒絕的候選。"
        : "尚未載入該場次 AI 拒絕結果。"
      : consensusReport?.reviewMode === "openrouter"
        ? "這輪沒有被 AI 拒絕的候選。"
        : "尚未載入 AI 拒絕結果。"
  );
  renderDecisionReasons(
    decisionRejectReasons,
    rejected,
    fixtureId
      ? consensusReport?.reviewMode === "openrouter"
        ? "此場次沒有被 AI 拒絕的候選。"
        : "尚未載入該場次 AI 拒絕理由。"
      : consensusReport?.reviewMode === "openrouter"
        ? "這輪沒有被 AI 拒絕的候選。"
        : "尚未載入 AI 拒絕理由。"
  );

  if (consensusReport && fixtureId) {
    const fixtureSummary = shortlist.length === 0
      ? "該場次目前不在本輪 shortlist。"
      : `該場次 shortlist ${shortlist.length} 項，保留 ${approved.length} 項，拒絕 ${rejected.length} 項。`;
    decisionConsensusSummary.textContent = `${fixtureSummary} ${consensusReport.summary}`;
    decisionModeDescription.textContent = `${modeDescription} ${fixtureSummary}`;
    return;
  }

  if (consensusReport) {
    decisionModeDescription.textContent = `${modeDescription} 本輪 shortlist ${consensusReport.candidateCount} 項，保留 ${consensusReport.approvedCount} 項，拒絕 ${consensusReport.rejectedCount} 項。`;
  }
}

function getFixtureMarketRows(fixture: Fixture): Array<{ label: string; odds: number; market: string }> {
  return (fixture.marketOptions ?? [])
    .filter((option) => typeof option.currentOdds === "number" && option.currentOdds > 1)
    .slice(0, 8)
    .map((option) => ({
      label: option.selectionName || option.selectionCode || option.oddsTypeName || option.oddsType,
      odds: Number(option.currentOdds) || 1,
      market: option.oddsTypeName || option.oddsType || "盤口"
    }));
}

function fixtureSummaryForAi(fixture: Fixture, bestPick?: Recommendation | null): string {
  const summary = latestPracticeInsight?.summary ?? "本輪 AI 以模型信號與賠率價值為主軸做判斷。";
  if (!bestPick) {
    return `${summary} 目前這場關注重點在 ${fixture.homeTeam} vs ${fixture.awayTeam}，可先從賠率價值與盤口變動角度觀察。`;
  }

  return `${summary} 就 ${fixture.homeTeam} vs ${fixture.awayTeam} 而言，AI 目前最看好 ${bestPick.market}：${bestPick.selectionName}（賠率 ${bestPick.currentOdds.toFixed(2)}，信心 ${bestPick.confidence}%）。這個選項最符合當前價值與風險平衡。`;
}

function pickBestRecommendationForFixture(fixtureId: string): Recommendation | null {
  const snapshot = latestSnapshotState;
  if (!snapshot) return null;

  const candidates = snapshot.recommendations.filter((item) => item.fixtureId === fixtureId);
  if (candidates.length === 0) return null;

  return [...candidates].sort((left, right) => right.confidence - left.confidence || right.valueScore - left.valueScore)[0] ?? null;
}

function renderFixtureList(): void {
  if (!fixtureListPanel || !latestSnapshotState) {
    return;
  }

  const fixtures = [...latestSnapshotState.fixtures].sort((left, right) => Date.parse(left.kickoffAt) - Date.parse(right.kickoffAt));

  fixtureListPanel.innerHTML = fixtures
    .map((fixture) => {
      const selected = selectedFixtureId === fixture.id ? "selected" : "";
      const bestPick = pickBestRecommendationForFixture(fixture.id);
      const marketCount = (fixture.marketOptions ?? []).filter((option) => Number(option.currentOdds) > 1).length;
      return `
        <button type="button" class="fixture-list-item ${selected}" data-fixture-id="${fixture.id}">
          <div class="fixture-list-top">
            <span class="fixture-pill">${formatTime(fixture.kickoffAt)}</span>
            <span class="fixture-pill neutral">${marketCount} 個盤口</span>
          </div>
          <p class="fixture-list-match">${fixture.homeTeam} vs ${fixture.awayTeam}</p>
          <p class="fixture-list-meta">${fixture.league || "HKJC"}</p>
          <p class="fixture-list-pick">${bestPick ? `AI 候選：${bestPick.selectionName}（${bestPick.currentOdds.toFixed(2)}）` : "待模型判斷"}</p>
        </button>
      `;
    })
    .join("");

  fixtureListPanel.querySelectorAll<HTMLButtonElement>(".fixture-list-item").forEach((button) => {
    button.addEventListener("click", () => {
      const nextId = button.dataset.fixtureId ?? "";
      if (!nextId) return;
      selectedFixtureId = nextId;
      renderFixtureList();
      renderFixtureAnalysis();
    });
  });
}

function renderFixtureAnalysis(): void {
  if (!fixtureAnalysisPanel || !latestSnapshotState) {
    return;
  }

  const fixture = latestSnapshotState.fixtures.find((item) => item.id === selectedFixtureId) ?? latestSnapshotState.fixtures[0];
  if (!fixture) {
    fixtureAnalysisPanel.innerHTML = '<p class="fixture-empty">今日沒有可用賽事。</p>';
    return;
  }

  const bestPick = pickBestRecommendationForFixture(fixture.id);
  const marketRows = getFixtureMarketRows(fixture);
  const bestMarketRow = marketRows.length > 0 ? [...marketRows].sort((left, right) => right.odds - left.odds)[0] : null;
  const pickTitle = bestPick ? `${bestPick.selectionName}（${bestPick.market}）` : bestMarketRow ? `${bestMarketRow.label}（${bestMarketRow.market}）` : "等待模型判斷";
  const pickOdds = bestPick ? bestPick.currentOdds.toFixed(2) : bestMarketRow ? bestMarketRow.odds.toFixed(2) : "-";
  const pickReason = bestPick
    ? `模型建議優先 ${bestPick.selectionName}，信心 ${bestPick.confidence}%；${bestPick.reason}`
    : `目前尚未有單場推薦，先觀察 ${marketRows[0]?.label ?? "盤口選項"} 的價值與賠率動向。`;

  fixtureAnalysisPanel.innerHTML = `
    <article class="fixture-analysis-card">
      <div class="fixture-analysis-header">
        <div>
          <p class="detail-kicker">Match Focus</p>
          <h3>${fixture.homeTeam} vs ${fixture.awayTeam}</h3>
          <p class="detail-subtitle">${fixture.league || "HKJC"}｜${formatTime(fixture.kickoffAt)}</p>
        </div>
        <span class="fixture-result-pill">最優投注項目</span>
      </div>

      <div class="fixture-analysis-metrics">
        <div class="fixture-metric">
          <span>最優選項</span>
          <strong>${pickTitle}</strong>
        </div>
        <div class="fixture-metric">
          <span>賠率</span>
          <strong>${pickOdds}</strong>
        </div>
        <div class="fixture-metric">
          <span>備註</span>
          <strong>${bestPick ? `${bestPick.market}` : "盤口觀察"}</strong>
        </div>
      </div>

      <div class="fixture-ai-box">
        <p class="assistant-enrichment-title">AI 討論</p>
        <p>${fixtureSummaryForAi(fixture, bestPick)}</p>
      </div>

      <div class="fixture-ai-box">
        <p class="assistant-enrichment-title">本場判斷</p>
        <p>${pickReason}</p>
      </div>

      <div class="fixture-option-list">
        <div class="fixture-option-header">
          <h4>可投注盤口</h4>
          <span>${marketRows.length} 個盤口</span>
        </div>
        ${marketRows.length === 0 ? '<p class="fixture-empty">此場賽事目前沒有可用賠率盤口。</p>' : marketRows.map((row) => `
          <button type="button" class="fixture-option-row" data-fixture-id="${fixture.id}" data-odds="${row.odds}" data-option-label="${escapeHtml(row.label)}">
            <span>${row.market}</span>
            <strong>${row.label}</strong>
            <em>${row.odds.toFixed(2)}</em>
          </button>
        `).join('')}
      </div>
    </article>
  `;

  fixtureAnalysisPanel.querySelectorAll<HTMLButtonElement>(".fixture-option-row").forEach((button) => {
    button.addEventListener("click", () => {
      const odds = Number(button.dataset.odds ?? "0");
      const label = button.dataset.optionLabel ?? "";
      if (!odds || !label) return;
      addOddsToCalculator(odds, `${fixture.id}|${label}`);
    });
  });
}

function renderFixturePage(): void {
  renderFixtureList();
  renderFixtureAnalysis();
}

function renderLearningHistory(records: LearningHistoryRecord[]): void {
  if (!historyList) {
    return;
  }

  if (records.length === 0) {
    historyList.innerHTML = '<article class="history-card"><p class="history-empty">暫時沒有符合條件的歷史記錄。</p></article>';
    return;
  }

  historyList.innerHTML = records
    .map(
      (record) => `
      <article class="history-card ${record.status === "settled" && derivedOutcome(record) === "win" ? "history-card-hit" : record.status === "settled" ? "history-card-miss" : "history-card-pending"}">
        <div class="history-top">
          <p class="history-market">${learningMarketDisplayLabel(record.market)}</p>
          <p class="history-result ${record.status === "settled" && derivedOutcome(record) === "win" ? "hit" : "miss"}">${resultLabel(derivedOutcome(record), record.status)}</p>
        </div>
        <p class="history-selection">${selectionDisplayLabel(record)}</p>
        <div class="history-triptych" aria-label="玩法摘要">
          <div class="history-pill">
            <span class="history-pill-label">玩法分類</span>
            <span class="history-pill-value">${marketCategoryLabel(record.market)}</span>
          </div>
          <div class="history-pill">
            <span class="history-pill-label">盤口</span>
            <span class="history-pill-value">${marketLineLabel(record)}</span>
          </div>
          <div class="history-pill">
            <span class="history-pill-label">結果</span>
            <span class="history-pill-value">${resultDetailLabel(record)}</span>
          </div>
        </div>
        <dl>
          <div><dt>場次</dt><dd>${record.match ?? record.fixtureId ?? "場次資訊載入中"}</dd></div>
          <div><dt>聯賽</dt><dd>${record.league ?? "-"}</dd></div>
          <div><dt>開賽</dt><dd>${record.kickoffAt ? formatTime(record.kickoffAt) : "-"}</dd></div>
          <div><dt>賠率</dt><dd>${record.currentOdds.toFixed(2)}</dd></div>
          <div><dt>預測方向</dt><dd>${predictionLabel(record)}</dd></div>
          <div><dt>記錄狀態</dt><dd>${record.status === "pending" ? "等待賽果" : "已完成結算"}</dd></div>
          ${record.status === "pending" ? `<div><dt>未結算原因</dt><dd>${record.pendingReason ?? "等待可用賽果資料"}</dd></div>` : ""}
        </dl>
      </article>
    `
    )
    .join("");
}

function renderBackgroundTrainingHistory(records: BacktestTrainingRecord[]): void {
  if (!historyList) {
    return;
  }

  if (records.length === 0) {
    historyList.innerHTML = '<article class="history-card"><p class="history-empty">暫時沒有背景訓練記錄。</p></article>';
    return;
  }

  historyList.innerHTML = records
    .map(
      (record) => `
      <article class="history-card ${record.result === "win" ? "history-card-hit" : "history-card-miss"}">
        <div class="history-top">
          <p class="history-market">背景訓練｜${record.source}</p>
          <p class="history-result ${record.result === "win" ? "hit" : "miss"}">${record.result === "win" ? "命中" : "失手"}</p>
        </div>
        <p class="history-selection">${trainingMarketLabel(record.market)}</p>
        <div class="history-triptych" aria-label="背景訓練摘要">
          <div class="history-pill">
            <span class="history-pill-label">來源</span>
            <span class="history-pill-value">${record.source}</span>
          </div>
          <div class="history-pill">
            <span class="history-pill-label">模型機率</span>
            <span class="history-pill-value">${(record.modelProbability * 100).toFixed(1)}%</span>
          </div>
          <div class="history-pill">
            <span class="history-pill-label">訓練結果</span>
            <span class="history-pill-value">${record.result === "win" ? "命中" : "失手"}</span>
          </div>
        </div>
        <dl>
          <div><dt>fixtureId</dt><dd>${record.fixtureId}</dd></div>
          <div><dt>賠率</dt><dd>${record.odds.toFixed(2)}</dd></div>
          <div><dt>訓練投注額</dt><dd>${record.stake.toFixed(2)}</dd></div>
          <div><dt>記錄時間</dt><dd>${formatTime(record.placedAt)}</dd></div>
        </dl>
      </article>
    `
    )
    .join("");
}

async function fetchLearningHistory(): Promise<void> {
  if (!historyMeta || !historyMarketFilter || !historyDateFilter) {
    return;
  }

  historyMeta.textContent = "讀取中...";
  const market = historyMarketFilter.value;
  const date = historyDateFilter.value;
  const params = new URLSearchParams({ limit: "500" });
  if (market && market !== "all") {
    params.set("market", market);
  }
  if (date) {
    params.set("date", date);
  }

  const res = await fetch(apiUrl(`/api/model/learning/history?${params.toString()}`), { method: "GET" });
  if (!res.ok) {
    throw new Error(`Learning history fetch failed: ${res.status}`);
  }

  const data = (await res.json()) as LearningHistoryResponse;

  if (historyMarketFilter.options.length <= 1) {
    const selected = historyMarketFilter.value;
    historyMarketFilter.innerHTML = '<option value="all">全部</option>';
    data.markets.forEach((marketName) => {
      const option = document.createElement("option");
      option.value = marketName;
      option.textContent = marketName;
      historyMarketFilter.appendChild(option);
    });
    if (selected && selected !== "all" && data.markets.includes(selected)) {
      historyMarketFilter.value = selected;
    }
  }

  renderLearningHistory(data.records);
  const filters: string[] = [];
  if (market !== "all") {
    filters.push(market);
  }
  if (date) {
    filters.push(`日期 ${date}`);
  }
  historyMeta.textContent = `共 ${data.total} 筆${filters.length > 0 ? `（${filters.join("｜")}）` : ""}`;
}

async function fetchBackgroundTrainingHistory(): Promise<void> {
  if (!historyMeta || !historyTrainingFilter) {
    return;
  }

  historyMeta.textContent = "讀取中...";
  const source = historyTrainingFilter.value as "all" | "auto" | "practice";
  const params = new URLSearchParams({ limit: "500", source });
  const res = await fetch(apiUrl(`/api/backtest/training-records?${params.toString()}`), { method: "GET" });
  if (!res.ok) {
    throw new Error(`Training history fetch failed: ${res.status}`);
  }

  const data = (await res.json()) as BacktestTrainingHistoryResponse;
  renderBackgroundTrainingHistory(data.records);
  historyMeta.textContent = `共 ${data.total} 筆背景訓練記錄${source !== "all" ? `（${source}）` : ""}`;
}

function render(snapshot: Snapshot): void {
  if (!topFiveCards || !meta) return;

  latestSnapshotState = snapshot;

  if (!selectedFixtureId && snapshot.fixtures.length > 0) {
    selectedFixtureId = snapshot.fixtures[0].id;
  }

  meta.textContent = `最後更新：${formatTime(snapshot.generatedAt)}`;
  const thresholds = snapshot.thresholds;
  if (minOddsInput) {
    minOddsInput.value = Number.isFinite(thresholds.minRecommendedOdds)
      ? thresholds.minRecommendedOdds.toFixed(2)
      : STRICT_MIN_RECOMMENDED_ODDS.toFixed(2);
  }
  if (highOddsInput) {
    highOddsInput.value = Number.isFinite(thresholds.highOddsThreshold)
      ? thresholds.highOddsThreshold.toFixed(2)
      : DEFAULT_HIGH_ODDS_THRESHOLD.toFixed(2);
  }
  if (highOddsMinEdgeInput) {
    highOddsMinEdgeInput.value = Number.isFinite(thresholds.highOddsMinEdgeScore)
      ? thresholds.highOddsMinEdgeScore.toFixed(2)
      : DEFAULT_HIGH_ODDS_MIN_EDGE_SCORE.toFixed(2);
  }
  if (highOddsMinValueInput) {
    highOddsMinValueInput.value = Number.isFinite(thresholds.highOddsMinValueScore)
      ? thresholds.highOddsMinValueScore.toFixed(3)
      : DEFAULT_HIGH_ODDS_MIN_VALUE_SCORE.toFixed(3);
  }

  const currentTime = Date.now();
  const activeInsights = [...(snapshot.lineupRecheckInsights ?? [])]
    .filter((insight) => Date.parse(insight.kickoffAt) >= currentTime - 15 * 60000)
    .sort((left, right) => Date.parse(right.checkedAt) - Date.parse(left.checkedAt));
  const recheckInsightMap = insightByFixture(activeInsights);

  topFiveCards.innerHTML = renderCards(snapshot.topFiveRecommendations, true, recheckInsightMap);
  renderLineupRecheckStatus(activeInsights);
  renderLearning(snapshot.learning);
  renderDecisionFlow(snapshot, latestPracticeInsight, latestAssistantConfig, activeDetailFixtureId(snapshot));

  if (fixtureAnalysisPage && !fixtureAnalysisPage.classList.contains("hidden")) {
    renderFixturePage();
  }

  if (activeDetailPickKey) {
    renderRecommendationDetail(findRecommendationByKey(activeDetailPickKey, snapshot));
  }
}

async function fetchSnapshot(path: string, method: "GET" | "POST"): Promise<void> {
  const res = await fetch(apiUrl(path), { method });
  if (!res.ok) {
    throw new Error(`Snapshot fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as Snapshot;
  render(data);
}

async function fetchAutoTrainingProgress(): Promise<void> {
  const res = await fetch(apiUrl("/api/model/auto-training"), { method: "GET" });
  if (!res.ok) {
    throw new Error(`Auto-training fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as { progress: AutoTrainingProgress };
  renderAutoTraining(data.progress);
}

async function fetchDataSourceHealth(): Promise<void> {
  const res = await fetch(apiUrl("/api/model/data-source"), { method: "GET" });
  if (!res.ok) {
    throw new Error(`Data-source fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as { dataSource: DataSourceHealth };
  renderDataSourceHealth(data.dataSource);
}

async function fetchWalkForwardMetrics(): Promise<void> {
  const params = new URLSearchParams({
    limit: "1200",
    warmup: "10",
    lookback: "60",
    window: "10",
    step: "5"
  });
  const res = await fetch(apiUrl(`/api/backtest/walk-forward?${params.toString()}`), { method: "GET" });
  if (!res.ok) {
    throw new Error(`Walk-forward fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as WalkForwardMetrics;
  renderWalkForward(data);
}

async function fetchHighWaterCandidates(): Promise<void> {
  if (!highOddsCards) {
    return;
  }

  const params = new URLSearchParams({ limit: "8" });
  const res = await fetch(apiUrl(`/api/recommendations/high-water?${params.toString()}`), { method: "GET" });
  if (!res.ok) {
    throw new Error(`High-water fetch failed: ${res.status}`);
  }

  const data = (await res.json()) as HighWaterSnapshot;
  latestHighWaterSnapshot = data;
  highOddsCards.innerHTML = renderHighWaterCards(data);
}

async function fetchTrainingGateStatus(): Promise<void> {
  const res = await fetch(apiUrl("/api/model/training-gate-status"), { method: "GET" });
  if (!res.ok) {
    throw new Error(`Training gate status fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as TrainingGateStatus;
  renderTrainingGateStatus(data);
}

async function fetchPracticeStatus(): Promise<void> {
  const res = await fetch(apiUrl("/api/model/practice"), { method: "GET" });
  if (!res.ok) {
    throw new Error(`Practice fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as PracticeApiResponse;
  latestPracticeInsight = data.assistant ?? data.practice?.assistantSummary ?? null;
  latestAssistantConfig = data.assistantConfig;
  renderAssistantMode(latestPracticeInsight, latestAssistantConfig);
  renderDecisionFlow(
    latestSnapshotState,
    latestPracticeInsight,
    latestAssistantConfig,
    activeDetailFixtureId(latestSnapshotState)
  );
}

async function fetchTrainingSelectionSettings(): Promise<void> {
  const res = await fetch(apiUrl("/api/model/training-selection"), { method: "GET" });
  if (!res.ok) {
    throw new Error(`Training-selection fetch failed: ${res.status}`);
  }

  const data = (await res.json()) as { trainingSelection: TrainingSelectionSettings };
  if (trainingCandidateRatioInput) {
    trainingCandidateRatioInput.value = data.trainingSelection.candidateRatio.toFixed(2);
  }
}

async function settleLearningBackfill(): Promise<void> {
  if (!settleBackfillBtn || !settleBackfillStatus) {
    return;
  }

  settleBackfillBtn.disabled = true;
  settleBackfillStatus.textContent = "補結算進行中...";

  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), SETTLE_BACKFILL_TIMEOUT_MS);
    const res = await fetch(apiUrl("/api/model/learning/settle-backfill"), {
      method: "POST",
      signal: controller.signal
    });
    window.clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Settle-backfill failed: ${res.status}`);
    }

    const data = (await res.json()) as LearningBackfillResponse;
    renderLearning(data.learning);

    const reasonCount = new Map<string, number>();
    for (const item of data.result.pendingDiagnostics ?? []) {
      const reasonCode = item.reasonCode ?? "other";
      reasonCount.set(reasonCode, (reasonCount.get(reasonCode) ?? 0) + 1);
    }

    const reasonSummary = reasonCount.size > 0
      ? `；未結算主因：${Array.from(reasonCount.entries())
          .sort((left, right) => right[1] - left[1])
          .slice(0, 2)
          .map(([reasonCode, count]) => `${reasonCode} ${count} 筆`)
          .join("、")}`
      : "";

    settleBackfillStatus.textContent = `已補結算 ${data.result.settledNow} 筆（待結算 ${data.result.pendingAfter} 筆）${reasonSummary}`;

    if (historyDatasetMode === "learning") {
      await fetchLearningHistory();
    }
    await Promise.allSettled([
      fetchAutoTrainingProgress(),
      fetchWalkForwardMetrics(),
      fetchTrainingGateStatus()
    ]);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      settleBackfillStatus.textContent = "補結算逾時，請稍後再試";
      return;
    }
    settleBackfillStatus.textContent = "補結算失敗，請稍後再試";
  } finally {
    settleBackfillBtn.disabled = false;
  }
}

function setCalculatorCollapsed(collapsed: boolean): void {
  if (!calculatorShell || !calcToggle) return;
  calculatorShell.classList.toggle("collapsed", collapsed);
  calcToggle.textContent = collapsed ? "展開" : "縮小";
}

refreshBtn?.addEventListener("click", async () => {
  try {
    await fetchSnapshot("/api/recommendations/refresh", "POST");
    await fetchAutoTrainingProgress();
    await fetchDataSourceHealth();
    await fetchPracticeStatus();
    await fetchWalkForwardMetrics();
    await fetchTrainingGateStatus();
  } catch {
    if (meta) {
      meta.textContent = "刷新失敗，請稍後再試。";
    }
  }
});

thresholdForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const minRecommendedOdds = Number(minOddsInput?.value ?? "0");
  const highOddsThreshold = Number(highOddsInput?.value ?? "0");
  const highOddsMinEdgeScore = Number(highOddsMinEdgeInput?.value ?? "0");
  const highOddsMinValueScore = Number(highOddsMinValueInput?.value ?? "0");
  const candidateRatio = Number(trainingCandidateRatioInput?.value ?? "0");

  if (!meta) return;
  if (!Number.isFinite(minRecommendedOdds) || minRecommendedOdds < STRICT_MIN_RECOMMENDED_ODDS) {
    meta.textContent = `低賠過濾線需大於或等於 ${STRICT_MIN_RECOMMENDED_ODDS.toFixed(2)}，避免把 1.40-1.99 當穩膽`;
    return;
  }

  if (highOddsThreshold < minRecommendedOdds) {
    meta.textContent = "高賠率門檻不能低於低賠過濾線";
    return;
  }

  if (!Number.isFinite(highOddsMinEdgeScore) || highOddsMinEdgeScore < 0) {
    meta.textContent = "高水最小 edge 必須為 0 或以上";
    return;
  }

  if (!Number.isFinite(highOddsMinValueScore) || highOddsMinValueScore < 0) {
    meta.textContent = "高水最小 valueScore 必須為 0 或以上";
    return;
  }

  if (!Number.isFinite(candidateRatio) || candidateRatio < 0.05 || candidateRatio > 1) {
    meta.textContent = "訓練候選比例需介乎 0.05 至 1.00";
    return;
  }

  const [thresholdRes, trainingSelectionRes] = await Promise.all([
    fetch(apiUrl("/api/model/thresholds"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ minRecommendedOdds, highOddsThreshold, highOddsMinEdgeScore, highOddsMinValueScore })
    }),
    fetch(apiUrl("/api/model/training-selection"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidateRatio })
    })
  ]);

  if (!thresholdRes.ok || !trainingSelectionRes.ok) {
    const errRes = thresholdRes.ok ? trainingSelectionRes : thresholdRes;
    const err = (await errRes.json()) as { error?: string };
    meta.textContent = `儲存失敗：${err.error ?? "未知錯誤"}`;
    return;
  }

  await fetchSnapshot("/api/recommendations", "GET");
  await fetchTrainingSelectionSettings();
  await fetchAutoTrainingProgress();
  await fetchDataSourceHealth();
  await fetchPracticeStatus();
  await fetchTrainingGateStatus();
});

calcSystem?.addEventListener("change", () => {
  computeCalculator();
});

calcStake?.addEventListener("input", () => {
  computeCalculator();
});

calcReset?.addEventListener("click", () => {
  resetCalculator();
});

calcClearOdds?.addEventListener("click", () => {
  clearAddedOdds();
});

calcToggle?.addEventListener("click", () => {
  const collapsed = calculatorShell?.classList.contains("collapsed") ?? false;
  setCalculatorCollapsed(!collapsed);
});

settleBackfillBtn?.addEventListener("click", () => {
  void settleLearningBackfill();
});

viewLearningHistoryBtn?.addEventListener("click", () => {
  historyDatasetMode = "learning";
  updateHistoryToolbarMode();
  navigateToView("history", { pushHistory: true });
});

viewFixtureAnalysisBtn?.addEventListener("click", () => {
  if (!latestSnapshotState || latestSnapshotState.fixtures.length === 0) {
    if (meta) {
      meta.textContent = "今日沒有可用賽事資料，請稍後再試。";
    }
    return;
  }

  if (!selectedFixtureId) {
    selectedFixtureId = latestSnapshotState.fixtures[0].id;
  }
  navigateToView("fixtures", { pushHistory: true });
});

backToDashboardBtn?.addEventListener("click", () => {
  const routeState = parseRouteState(window.history.state);
  if (routeState && routeState.appView !== "dashboard") {
    window.history.back();
    return;
  }
  navigateToView("dashboard", { pushHistory: false });
});

backToDashboardFromDetailBtn?.addEventListener("click", () => {
  const routeState = parseRouteState(window.history.state);
  if (routeState && routeState.appView !== "dashboard") {
    window.history.back();
    return;
  }
  navigateToView("dashboard", { pushHistory: false });
});

backToDashboardFromFixturesBtn?.addEventListener("click", () => {
  const routeState = parseRouteState(window.history.state);
  if (routeState && routeState.appView !== "dashboard") {
    window.history.back();
    return;
  }
  navigateToView("dashboard", { pushHistory: false });
});

detailAddOddsBtn?.addEventListener("click", () => {
  const odds = Number(detailAddOddsBtn.dataset.odds ?? "0");
  const pickKey = detailAddOddsBtn.dataset.pickKey ?? "";
  if (!pickKey) {
    return;
  }
  addOddsToCalculator(odds, pickKey);
});

historyMarketFilter?.addEventListener("change", () => {
  if (historyDatasetMode !== "learning") {
    return;
  }

  void fetchLearningHistory().catch(() => {
    if (historyMeta) {
      historyMeta.textContent = "讀取歷史記錄失敗，請稍後再試。";
    }
    renderLearningHistory([]);
  });
});

historyDateFilter?.addEventListener("change", () => {
  if (historyDatasetMode !== "learning") {
    return;
  }

  void fetchLearningHistory().catch(() => {
    if (historyMeta) {
      historyMeta.textContent = "讀取歷史記錄失敗，請稍後再試。";
    }
    renderLearningHistory([]);
  });
});

historyTrainingFilter?.addEventListener("change", () => {
  if (historyDatasetMode !== "background") {
    return;
  }

  void fetchBackgroundTrainingHistory().catch(() => {
    if (historyMeta) {
      historyMeta.textContent = "讀取背景訓練記錄失敗，請稍後再試。";
    }
    renderBackgroundTrainingHistory([]);
  });
});

historyLearningTab?.addEventListener("click", () => {
  if (historyDatasetMode === "learning") {
    return;
  }

  historyDatasetMode = "learning";
  updateHistoryToolbarMode();
  void fetchLearningHistory().catch(() => {
    if (historyMeta) {
      historyMeta.textContent = "讀取歷史記錄失敗，請稍後再試。";
    }
    renderLearningHistory([]);
  });
});

historyTrainingTab?.addEventListener("click", () => {
  if (historyDatasetMode === "background") {
    return;
  }

  historyDatasetMode = "background";
  updateHistoryToolbarMode();
  void fetchBackgroundTrainingHistory().catch(() => {
    if (historyMeta) {
      historyMeta.textContent = "讀取背景訓練記錄失敗，請稍後再試。";
    }
    renderBackgroundTrainingHistory([]);
  });
});

bindRecommendationCardActions(topFiveCards);

window.addEventListener("popstate", (event) => {
  restoreViewFromHistoryState(event.state);
});

resetCalculator();

setCalculatorCollapsed(true);
updateHistoryToolbarMode();
navigateToView("dashboard", { pushHistory: false });

void Promise.all([
  fetchSnapshot("/api/recommendations", "GET"),
  fetchTrainingSelectionSettings(),
  fetchAutoTrainingProgress(),
  fetchPracticeStatus(),
  fetchWalkForwardMetrics(),
  fetchTrainingGateStatus()
]).catch(() => {
  if (meta) {
    meta.textContent = "載入資料失敗，請檢查 API 是否可連線。";
  }
  renderLearning(null);
  renderAutoTraining(null);
  renderDataSourceHealth(null);
  renderAssistantMode(null, undefined);
  renderDecisionFlow(null, null, undefined);
  renderWalkForward(null);
  renderTrainingGateStatus(null);
});

void fetchDataSourceHealth().catch(() => {
  renderDataSourceHealth(null);
});
