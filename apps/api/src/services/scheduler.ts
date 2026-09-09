import cron from "node-cron";
import type { AnalysisService } from "./analysisService.js";
import type { BacktestStore } from "./backtestStore.js";
import { runAutoTrainingCycle } from "./autoTrainingService.js";
import type { PersistedCalibrationProfiles } from "./autoTrainingService.js";
import { buildHybridAiSignals, generateAssistantInsight } from "./assistantReviewService.js";
import { buildExternalEnrichment } from "./externalEnrichmentService.js";
import type { OddsSnapshotService } from "./oddsSnapshotService.js";
import type {
  AutoTrainingProgress,
  BacktestSummary,
  ModelAssistantInsight,
  PracticeCycleProgress,
  PracticeSourceProgress
} from "../types.js";

type SchedulerOptions = {
  autoTrainingEnabled?: boolean;
  autoTrainingService?: AnalysisService;
  practiceEnabled?: boolean;
  practiceSchedule?: string;
  practiceTimezone?: string;
  practiceSources?: Array<{
    label: string;
    service: AnalysisService;
  }>;
  assistant?: {
    enabled?: boolean;
    ollamaEnabled?: boolean;
    ollamaBaseUrl?: string;
    ollamaApiKey?: string;
    ollamaModel?: string;
    ollamaFallbackModels?: string[];
    apiKey?: string;
    model?: string;
    fallbackModels?: string[];
    temperature?: number;
    referer?: string;
    title?: string;
    autoApply?: boolean;
    minConfidence?: number;
  };
  trainingSelection?: {
    candidateRatio: number;
  };
  calibration?: {
    getProfiles: () => PersistedCalibrationProfiles | undefined;
    saveProfiles: (profiles: PersistedCalibrationProfiles) => Promise<void>;
  };
  oddsSnapshots?: OddsSnapshotService;
};

const MIN_BACKGROUND_ANALYSIS_INTERVAL_MS = 3 * 60 * 60 * 1000;

function emptyBacktestSummary(): BacktestSummary {
  return {
    totalBets: 0,
    wins: 0,
    losses: 0,
    hitRate: 0,
    totalStake: 0,
    totalReturn: 0,
    profit: 0,
    roi: 0,
    avgEdge: 0
  };
}

let latestAutoTrainingProgress: AutoTrainingProgress = {
  lastCycleAdded: 0,
  lastCycleGateBlocked: 0,
  lastCycleGateReplenished: 0,
  totalAutoRecords: 0,
  recentHitRate: 0,
  recentSample: 0,
  updatedAt: new Date().toISOString()
};

let latestPracticeProgress: PracticeCycleProgress = {
  runAt: new Date().toISOString(),
  sourceCount: 0,
  totalAutoRecordsAdded: 0,
  sources: [],
  backtestSummary: emptyBacktestSummary(),
  updatedAt: new Date().toISOString()
};

export function autoApplicableThresholds(
  suggested: NonNullable<ModelAssistantInsight["suggestedThresholds"]>
): NonNullable<ModelAssistantInsight["suggestedThresholds"]> {
  const adaptiveThresholds = { ...suggested };
  delete adaptiveThresholds.minRecommendedOdds;
  return adaptiveThresholds;
}

let latestAssistantInsight: ModelAssistantInsight | null = null;
let manualPracticeTrigger: (() => Promise<void>) | null = null;

export function getAutoTrainingProgress(): AutoTrainingProgress {
  return latestAutoTrainingProgress;
}

export function getPracticeProgress(): PracticeCycleProgress {
  return latestPracticeProgress;
}

export function getAssistantInsight(): ModelAssistantInsight | null {
  return latestAssistantInsight;
}

export async function triggerPracticeCycle(): Promise<void> {
  if (!manualPracticeTrigger) {
    throw new Error("Practice scheduler is not ready");
  }

  await manualPracticeTrigger();
}

export function registerJobs(
  getService: () => AnalysisService,
  backtestStore: BacktestStore,
  options: SchedulerOptions = {}
): void {
  let lastBackgroundAnalysisAt = Date.now();
  let backgroundGuardRunning = false;
  const lineupRecheckWindowMinutes = 25;
  const lineupRecheckTriggeredFixtureIds = new Set<string>();
  const autoTrainingEnabled = options.autoTrainingEnabled ?? true;

  const trainingConsensusOptions = {
    enabled: options.assistant?.enabled ?? true,
    ollamaEnabled: options.assistant?.ollamaEnabled,
    ollamaBaseUrl: options.assistant?.ollamaBaseUrl,
    ollamaApiKey: options.assistant?.ollamaApiKey,
    ollamaModel: options.assistant?.ollamaModel,
    ollamaFallbackModels: options.assistant?.ollamaFallbackModels,
    apiKey: options.assistant?.apiKey,
    model: options.assistant?.model,
    fallbackModels: options.assistant?.fallbackModels,
    temperature: options.assistant?.temperature,
    referer: options.assistant?.referer,
    title: options.assistant?.title
  };

  const updateAutoTrainingProgress = async (cycle: {
    added: number;
    gateBlockedCount: number;
    gateReplenishedCount: number;
  }): Promise<void> => {
    const stats = await backtestStore.autoTrainingStats(20);
    latestAutoTrainingProgress = {
      lastCycleAdded: cycle.added,
      lastCycleGateBlocked: cycle.gateBlockedCount,
      lastCycleGateReplenished: cycle.gateReplenishedCount,
      totalAutoRecords: stats.totalAutoRecords,
      recentHitRate: stats.recentHitRate,
      recentSample: stats.recentSample,
      updatedAt: new Date().toISOString()
    };
  };

  const autoTrainingService = options.autoTrainingService ?? getService();

  const runAndUpdateAutoTraining = async (service: AnalysisService): Promise<void> => {
    console.log(`[auto-training][debug] refresh:start provider=${service.getDataSourceHealth().provider}`);
    await service.refreshFixturesForTraining();
    console.log(
      `[auto-training][debug] refresh:done provider=${service.getDataSourceHealth().provider} fixtures=${service.getDataSourceHealth().fixtureCount}`
    );
    const cycle = await runAutoTrainingCycle(service, backtestStore, {
      source: "auto",
      candidateRatio: options.trainingSelection?.candidateRatio,
      calibrationProfiles: options.calibration?.getProfiles(),
      onCalibrationProfilesUpdated: async (profiles) => {
        await options.calibration?.saveProfiles(profiles);
      }
    });
    await updateAutoTrainingProgress(cycle);

    if (cycle.added > 0) {
      console.log(`[auto-training] Added ${cycle.added} background training records.`);
    }
  };

  const runPracticeCycle = async (mainService: AnalysisService): Promise<void> => {
    if (!((options.practiceEnabled ?? true) && (options.practiceSources?.length ?? 0) > 0)) {
      return;
    }

    const practiceSources = options.practiceSources ?? [];
    const runAt = new Date().toISOString();
    const sourceReports: PracticeSourceProgress[] = [];
    let totalAdded = 0;
    let totalGateBlocked = 0;
    let totalGateReplenished = 0;

    for (const source of practiceSources) {
      try {
        await source.service.refreshDailyFixtures({ quick: false });
        const cycle = await runAutoTrainingCycle(source.service, backtestStore, {
          source: "practice",
          consensus: trainingConsensusOptions,
          candidateRatio: options.trainingSelection?.candidateRatio
        });
        totalAdded += cycle.added;
        totalGateBlocked += cycle.gateBlockedCount;
        totalGateReplenished += cycle.gateReplenishedCount;

        sourceReports.push({
          label: source.label,
          provider: source.service.getDataSourceHealth().provider,
          queryVersion: source.service.getDataSourceHealth().queryVersion,
          fixtureCount: source.service.getDataSourceHealth().fixtureCount,
          autoRecordsAdded: cycle.added,
          completedAt: new Date().toISOString()
        });
      } catch (error) {
        sourceReports.push({
          label: source.label,
          provider: source.service.getDataSourceHealth().provider,
          queryVersion: source.service.getDataSourceHealth().queryVersion,
          fixtureCount: source.service.getDataSourceHealth().fixtureCount,
          autoRecordsAdded: 0,
          completedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : "Unknown practice source error"
        });
      }
    }

    const backtestSummary = await backtestStore.summary();
    const learning = await mainService.getLearningSnapshot();
    const practiceProgress: PracticeCycleProgress = {
      runAt,
      sourceCount: practiceSources.length,
      totalAutoRecordsAdded: totalAdded,
      sources: sourceReports,
      backtestSummary,
      updatedAt: new Date().toISOString()
    };

    const assistant = options.assistant ?? {};
    if (assistant.enabled ?? true) {
      const snapshot = mainService.getSnapshot();
      const hybridSignals = buildHybridAiSignals({
        fixtures: snapshot.fixtures,
        recommendations: snapshot.recommendations
      });
      const externalEnrichment = await buildExternalEnrichment({
        fixtures: snapshot.fixtures,
        recommendations: snapshot.recommendations
      });

      const insight = await generateAssistantInsight(
        {
          dataSource: mainService.getDataSourceHealth(),
          practice: practiceProgress,
          backtestSummary,
          autoTraining: getAutoTrainingProgress(),
          learning: {
            pendingCount: learning.pendingCount,
            settledCount: learning.settledCount,
            correction: learning.correction,
            diagnostics: learning.diagnostics
          },
          thresholds: mainService.getThresholds(),
          weights: mainService.getWeights(),
          recommendations: snapshot.recommendations,
          hybridSignals,
          externalEnrichment
        },
        {
          ollamaEnabled: assistant.ollamaEnabled,
          ollamaBaseUrl: assistant.ollamaBaseUrl,
          ollamaApiKey: assistant.ollamaApiKey,
          ollamaModel: assistant.ollamaModel,
          ollamaFallbackModels: assistant.ollamaFallbackModels,
          apiKey: assistant.apiKey,
          model: assistant.model,
          fallbackModels: assistant.fallbackModels,
          temperature: assistant.temperature,
          referer: assistant.referer,
          title: assistant.title
        }
      );

      const minConfidence = assistant.minConfidence ?? 0.72;
      const shouldApply = assistant.autoApply ?? true;
      const canApply = shouldApply && insight.confidence >= minConfidence;

      if (canApply) {
        const before = {
          weights: { ...mainService.getWeights() },
          thresholds: { ...mainService.getThresholds() }
        };

        if (insight.suggestedWeights && Object.keys(insight.suggestedWeights).length > 0) {
          await mainService.updateWeights(insight.suggestedWeights);
        }

        if (insight.suggestedThresholds && Object.keys(insight.suggestedThresholds).length > 0) {
          const adaptiveThresholds = autoApplicableThresholds(insight.suggestedThresholds);
          insight.suggestedThresholds = adaptiveThresholds;
          if (Object.keys(adaptiveThresholds).length > 0) {
            await mainService.updateThresholds(adaptiveThresholds);
          }
        }

        await mainService.recordAssistantModelChange({
          before,
          reason: insight.summary,
          confidence: insight.confidence
        });
        insight.applied =
          JSON.stringify(before.weights) !== JSON.stringify(mainService.getWeights())
          || JSON.stringify(before.thresholds) !== JSON.stringify(mainService.getThresholds());
      }

      latestAssistantInsight = insight;
      practiceProgress.assistantSummary = insight;
    } else {
      latestAssistantInsight = null;
    }

    latestPracticeProgress = practiceProgress;
    await updateAutoTrainingProgress({
      added: totalAdded,
      gateBlockedCount: totalGateBlocked,
      gateReplenishedCount: totalGateReplenished
    });

    if (totalAdded > 0) {
      console.log(`[practice] Added ${totalAdded} records across ${practiceSources.length} sources.`);
    }

    lastBackgroundAnalysisAt = Date.now();
  };

  manualPracticeTrigger = async () => {
    await runPracticeCycle(getService());
  };

  const runBackgroundGuardCycle = async (): Promise<void> => {
    const elapsed = Date.now() - lastBackgroundAnalysisAt;
    if (elapsed < MIN_BACKGROUND_ANALYSIS_INTERVAL_MS || backgroundGuardRunning) {
      return;
    }

    backgroundGuardRunning = true;
    const service = getService();
    try {
      await service.refreshDailyFixtures();

      if (autoTrainingEnabled) {
        await runAndUpdateAutoTraining(autoTrainingService);
      }

      if ((options.practiceEnabled ?? true) && (options.practiceSources?.length ?? 0) > 0) {
        await runPracticeCycle(service);
      }

      lastBackgroundAnalysisAt = Date.now();
      console.log("[background-guard] Triggered minimum 3-hour analysis cycle.");
    } catch (error) {
      console.warn("[background-guard] Minimum analysis cycle failed.", error);
    } finally {
      backgroundGuardRunning = false;
    }
  };

  cron.schedule("*/30 * * * *", async () => {
    const service = getService();
    await service.refreshDailyFixtures();

    if (autoTrainingEnabled) {
      try {
        await runAndUpdateAutoTraining(autoTrainingService);
        lastBackgroundAnalysisAt = Date.now();
      } catch (error) {
        console.warn("[auto-training] Cycle failed.", error);
      }
    }

    try {
      await runBackgroundGuardCycle();
    } catch (error) {
      console.warn("[background-guard] Check failed.", error);
    }
  });

  cron.schedule(
    options.practiceSchedule ?? "25 3 * * *",
    async () => {
      const service = getService();
      try {
        await runPracticeCycle(service);
      } catch (error) {
        console.warn("[practice] Cycle failed.", error);
      }
    },
    {
      timezone: options.practiceTimezone ?? "Asia/Hong_Kong"
    }
  );

  cron.schedule("*/15 * * * *", async () => {
    try {
      await runBackgroundGuardCycle();
    } catch (error) {
      console.warn("[background-guard] Check failed.", error);
    }
  });

  cron.schedule("*/1 * * * *", async () => {
    const service = getService();
    const snapshot = service.getSnapshot();
    const now = Date.now();

    const dueLineupRecheckFixtureIds = snapshot.fixtures
      .filter((fixture) => {
        const diffMinutes = (new Date(fixture.kickoffAt).getTime() - now) / 60000;
        if (!(diffMinutes <= lineupRecheckWindowMinutes && diffMinutes >= 0)) {
          return false;
        }

        if (fixture.lineup.confirmed) {
          return false;
        }

        const isRecommended =
          snapshot.recommendations.some((recommendation) => recommendation.fixtureId === fixture.id)
          || snapshot.highOddsValueRecommendations.some((recommendation) => recommendation.fixtureId === fixture.id);
        return isRecommended;
      })
      .map((fixture) => fixture.id)
      .filter((fixtureId) => !lineupRecheckTriggeredFixtureIds.has(fixtureId));

    const shouldRunLineupRecheck = dueLineupRecheckFixtureIds.length > 0;

    const hasPreKickoffMatch = snapshot.fixtures.some((fixture) => {
      const diffMinutes = (new Date(fixture.kickoffAt).getTime() - now) / 60000;
      return diffMinutes <= lineupRecheckWindowMinutes && diffMinutes >= 0;
    });

    if (hasPreKickoffMatch && shouldRunLineupRecheck) {
      await service.refreshLineupWindow();
      for (const fixtureId of dueLineupRecheckFixtureIds) {
        lineupRecheckTriggeredFixtureIds.add(fixtureId);
      }

      if (autoTrainingEnabled) {
        try {
          await runAndUpdateAutoTraining(autoTrainingService);
        } catch (error) {
          console.warn("[auto-training] Cycle failed.", error);
        }
      }
    }

    for (const fixture of snapshot.fixtures) {
      const diffMinutes = (new Date(fixture.kickoffAt).getTime() - now) / 60000;
      if (diffMinutes < -30) {
        lineupRecheckTriggeredFixtureIds.delete(fixture.id);
      }
    }
  });

  cron.schedule("*/5 * * * *", async () => {
    if (!options.oddsSnapshots) return;
    try {
      const snapshot = getService().getSnapshot();
      const shortlistedFixtureIds = new Set(snapshot.recommendationShortlist.map((item) => item.fixtureId));
      await options.oddsSnapshots.run(snapshot.fixtures.filter((fixture) => shortlistedFixtureIds.has(fixture.id)));
    } catch (error) {
      console.warn("[odds-snapshots] Cycle failed.", error);
    }
  });

  if ((options.practiceEnabled ?? true) && (options.practiceSources?.length ?? 0) > 0) {
    void runPracticeCycle(getService()).catch((error) => {
      console.warn("[practice] Startup cycle failed.", error);
    });
  }

  if (autoTrainingEnabled) {
    void runAndUpdateAutoTraining(autoTrainingService).catch((error) => {
      console.warn("[auto-training] Startup cycle failed.", error);
    });
  }
}
