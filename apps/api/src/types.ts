export type TeamStrength = "elite" | "strong" | "average" | "weak";

export interface LineupPlayer {
  name: string;
  role: string;
  fitness: number;
  recentForm: number;
}

export interface MatchLineup {
  confirmed: boolean;
  updatedAt: string;
  home: LineupPlayer[];
  away: LineupPlayer[];
}

export interface MarketOddsPoint {
  at: string;
  homeWin: number;
  draw: number;
  awayWin: number;
}

export interface MarketOption {
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
}

export interface Fixture {
  id: string;
  league: string;
  kickoffAt: string;
  status?: string;
  homeTeamEn?: string;
  awayTeamEn?: string;
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
  homeTeam: string;
  awayTeam: string;
  homeStrength: TeamStrength;
  awayStrength: TeamStrength;
  homeRecentPoints: number;
  awayRecentPoints: number;
  expertSentiment: number;
  lineup: MatchLineup;
  oddsHistory: MarketOddsPoint[];
  marketOptions: MarketOption[];
  recentHeadToHead?: Array<{
    homeGoals: number;
    awayGoals: number;
    result?: "home" | "draw" | "away";
    venue?: "home" | "away";
  }>;
  homeVenueForm?: number;
  awayVenueForm?: number;
}

export interface RecommendationReasonSections {
  strengths: string[];
  risks: string[];
  watchpoints: string[];
}

export interface Recommendation {
  fixtureId: string;
  match: string;
  kickoffAt: string;
  matchDateHk?: string;
  league?: string;
  homeTeam?: string;
  awayTeam?: string;
  homeTeamEn?: string;
  awayTeamEn?: string;
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
}

export interface LineupRecheckInsight {
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
}

export type PredictedSide = "home" | "draw" | "away";

export interface LearningFeedback {
  key: string;
  fixtureId: string;
  match?: string;
  kickoffAt?: string;
  matchDateHk?: string;
  league?: string;
  homeTeam?: string;
  awayTeam?: string;
  homeTeamEn?: string;
  awayTeamEn?: string;
  matchKey?: string;
  sourceProvider?: string;
  market: string;
  selectionName: string;
  currentOdds: number;
  confidence: number;
  edgeScore: number;
  predictedSide: PredictedSide;
  createdAt: string;
  settledAt?: string;
  actualSide?: PredictedSide;
  result?: BacktestResult;
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
}

export interface BlindspotMetric {
  sample: number;
  wins: number;
  losses: number;
  hitRate: number;
}

export interface BlindspotReport {
  byMarket: Record<string, BlindspotMetric>;
  byOddsBucket: Record<string, BlindspotMetric>;
  byConfidenceBucket: Record<string, BlindspotMetric>;
  byPredictedSide: Record<PredictedSide, BlindspotMetric>;
}

export interface LearningSnapshot {
  generatedAt: string;
  pendingCount: number;
  settledCount: number;
  recent: LearningFeedback[];
  blindspots: BlindspotReport;
  correction: {
    marketPenalty: Record<string, number>;
    oddsBucketPenalty: Record<string, number>;
    confidenceBucketPenalty: Record<string, number>;
    sidePenalty: Record<PredictedSide, number>;
  };
}

export type LearningHistoryStatus = "pending" | "settled";

export interface LearningHistoryRecord {
  key: string;
  fixtureId: string;
  match: string;
  kickoffAt?: string;
  matchDateHk?: string;
  league?: string;
  homeTeamEn?: string;
  awayTeamEn?: string;
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
  predictedSide: PredictedSide;
  actualSide?: PredictedSide;
  result?: BacktestResult;
  status: LearningHistoryStatus;
  pendingReason?: string;
  createdAt: string;
  settledAt?: string;
}

export interface DataSourceHealth {
  provider: string;
  queryVersion?: string;
  ok: boolean;
  hasCurrentOdds: boolean;
  fixtureCount: number;
  optionsCount: number;
  lastCheckedAt: string;
  lastSuccessfulAt?: string;
  lastError?: string;
}

export interface ScoringWeights {
  strengthGap: number;
  recentForm: number;
  lineupFitness: number;
  expertSentiment: number;
  oddsMomentum: number;
}

export type BacktestResult = "win" | "loss";

export interface BacktestRecord {
  fixtureId: string;
  market: "homeWin" | "draw" | "awayWin";
  trainingMarket?: "asian_handicap" | "match_result" | "goals_over_under";
  odds: number;
  modelProbability: number;
  stake: number;
  result: BacktestResult;
  placedAt: string;
  source: "csv" | "api" | "auto" | "practice";
}

export interface BacktestSummary {
  totalBets: number;
  wins: number;
  losses: number;
  hitRate: number;
  totalStake: number;
  totalReturn: number;
  profit: number;
  roi: number;
  avgEdge: number;
}

export interface AutoTrainingProgress {
  lastCycleAdded: number;
  totalAutoRecords: number;
  recentHitRate: number;
  recentSample: number;
  updatedAt: string;
}

export interface PracticeSourceProgress {
  label: string;
  provider: string;
  queryVersion?: string;
  fixtureCount: number;
  autoRecordsAdded: number;
  completedAt: string;
  error?: string;
}

export interface PracticeCycleProgress {
  runAt: string;
  sourceCount: number;
  totalAutoRecordsAdded: number;
  sources: PracticeSourceProgress[];
  backtestSummary: BacktestSummary;
  assistantSummary?: ModelAssistantInsight;
  updatedAt: string;
}

export type AssistantReviewMode = "openrouter" | "local_fallback";

export interface RecommendationConsensusReport {
  reviewMode: AssistantReviewMode;
  model: string;
  summary: string;
  candidateCount: number;
  approvedCount: number;
  rejectedCount: number;
  dataIssues: string[];
}

export interface ModelAssistantInsight {
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
  suggestedWeights?: Partial<ScoringWeights>;
  suggestedThresholds?: {
    minRecommendedOdds?: number;
    highOddsThreshold?: number;
    highOddsMinEdgeScore?: number;
    highOddsMinValueScore?: number;
  };
  confidence: number;
  applied: boolean;
  sourceLabels: string[];
  rawResponse?: string;
}
