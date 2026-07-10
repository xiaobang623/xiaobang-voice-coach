import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppNavBar } from "./components/AppNavBar";
import { BottomTabBar, type MainTab } from "./components/BottomTabBar";
import { MeView } from "./components/MeView";
import { TopicSelector, type PracticeInsight } from "./components/TopicSelector";
import { VoiceSession } from "./components/VoiceSession";
import {
  buildTranscriptFromMessages,
  countUserSpeechStats,
  generateReport,
} from "./core/report";
import { extractMemory } from "./core/memory";
import { resolveUsageActor, logApiUsage } from "./core/usageLog";
import { useVoiceSession } from "./hooks/useVoiceSession";
import { useVoiceProfile } from "./hooks/useVoiceProfile";
import { useAuth } from "./hooks/useAuth";
import { useUserPreferences } from "./hooks/useUserPreferences";
import { pickVoiceType, showsVoicePicker } from "./config/voices";
import { loadUserMemory, loadGrowthPageData, persistGuestSessionReport, persistSessionReport, upsertUserMemory } from "./core/storage";
import {
  GROWTH_CACHE_STALE_MS,
  growthCacheAgeMs,
  readGrowthCache,
  writeGrowthCache,
} from "./core/growthCache";
import { CHAT_TOPICS } from "./config/chatTopics";
import { findTaskScenario } from "./config/taskScenarios";
import { scenarioLabel } from "./config/topics";
import {
  buildSystemPrompt,
  buildTaskSystemPrompt,
} from "./config/session";
import type { GrowthPageData, MemorySummary, ReportJSON, SessionSettings, TaskScenario } from "./types";

type PracticeScreen = "topics" | "chat";

function App() {
  const { isConfigured, isAnonymous, userId } = useAuth();
  const { preferences, setVoiceType, setSpeedRatio, setShowSubtitle } = useUserPreferences();
  const { voiceProfile, isLoading: voiceProfileLoading } = useVoiceProfile();
  const [mainTab, setMainTab] = useState<MainTab>("practice");
  const [practiceScreen, setPracticeScreen] = useState<PracticeScreen>("topics");
  const voice = useVoiceSession();
  const [report, setReport] = useState<ReportJSON | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [userMemory, setUserMemory] = useState<MemorySummary | null>(null);
  const [homeGrowthData, setHomeGrowthData] = useState<GrowthPageData | null>(null);
  const [homeInsightLoading, setHomeInsightLoading] = useState(false);
  const sessionIdRef = useRef(crypto.randomUUID());
  const doubaoLoggedSessionRef = useRef<string | null>(null);

  const [topicId, setTopicId] = useState<string | null>(null);
  const [accountDeepLink, setAccountDeepLink] = useState(0);
  const [recordDeepLink, setRecordDeepLink] = useState(0);
  const [accountReturnTab, setAccountReturnTab] = useState<MainTab | null>(null);

  const inChat = practiceScreen === "chat";

  useEffect(() => {
    if (mainTab !== "me" && accountReturnTab) {
      setAccountReturnTab(null);
    }
  }, [mainTab, accountReturnTab]);

  useEffect(() => {
    if (!isConfigured || isAnonymous) {
      setUserMemory(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      const memory = await loadUserMemory();
      if (!cancelled) {
        setUserMemory(memory);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isConfigured, isAnonymous]);

  useEffect(() => {
    if (!isConfigured || isAnonymous || !userId) {
      setHomeGrowthData(null);
      setHomeInsightLoading(false);
      return;
    }

    const cached = readGrowthCache(userId);
    if (cached) {
      setHomeGrowthData(cached);
    }

    const cacheAge = growthCacheAgeMs(userId);
    if (cached && cacheAge !== null && cacheAge < GROWTH_CACHE_STALE_MS) {
      return;
    }

    let cancelled = false;
    void (async () => {
      setHomeInsightLoading(!cached);
      const data = await loadGrowthPageData();
      if (!cancelled && data) {
        writeGrowthCache(userId, data);
        setHomeGrowthData(data);
      }
      if (!cancelled) {
        setHomeInsightLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isConfigured, isAnonymous, userId]);

  const speechStats = useMemo(
    () => countUserSpeechStats(voice.messages),
    [voice.messages],
  );

  const resolvedVoiceType = useMemo(
    () => pickVoiceType(preferences.voiceType, voiceProfile),
    [preferences.voiceType, voiceProfile],
  );

  useEffect(() => {
    if (voiceProfileLoading) {
      return;
    }
    const isSiliconFlow = voiceProfile.provider.startsWith("siliconflow-");
    if (isSiliconFlow && preferences.voiceType === "benjamin") {
      setVoiceType("diana");
      return;
    }
    // anna 曾是 SiliconFlow 默认音色；迁移到新的默认 diana
    if (isSiliconFlow && preferences.voiceType === "anna") {
      setVoiceType("diana");
      return;
    }
    if (resolvedVoiceType !== preferences.voiceType) {
      setVoiceType(resolvedVoiceType);
    }
  }, [voiceProfileLoading, voiceProfile.provider, preferences.voiceType, resolvedVoiceType, setVoiceType]);

  const sessionSettings = useMemo<SessionSettings>(() => {
    const taskScenario = topicId ? findTaskScenario(topicId) : undefined;
    if (taskScenario) {
      return {
        voiceType: resolvedVoiceType,
        speedRatio: preferences.speedRatio,
        systemPrompt: buildTaskSystemPrompt(taskScenario, userMemory),
      };
    }
    const topic = CHAT_TOPICS.find((t) => t.id === topicId);
    return {
      voiceType: resolvedVoiceType,
      speedRatio: preferences.speedRatio,
      systemPrompt: buildSystemPrompt(topic?.promptSeed, userMemory),
    };
  }, [resolvedVoiceType, preferences.speedRatio, topicId, userMemory]);

  const usageActor = useMemo(
    () => resolveUsageActor({ userId, isAnonymous }),
    [userId, isAnonymous],
  );

  const homePracticeInsight = useMemo<PracticeInsight | null>(() => {
    if (!homeGrowthData) {
      return null;
    }

    const sevenDaysAgo = Date.now() - 7 * 86_400_000;
    const recentHistory = homeGrowthData.history.filter(
      (item) => new Date(item.createdAt).getTime() >= sevenDaysAgo,
    );
    const topMistake = homeGrowthData.stats.frequentMistakes[0] ?? null;

    return {
      sessionCount7d: recentHistory.length,
      durationSeconds7d: recentHistory.reduce((sum, item) => sum + item.durationSeconds, 0),
      latestUserLevel: homeGrowthData.stats.latestUserLevel,
      topMistakeType: topMistake?.type ?? null,
      topMistakeCount: topMistake?.count ?? 0,
    };
  }, [homeGrowthData]);

  const getVoiceDurationSeconds = useCallback(() => {
    if (!voice.conversationStartedAt) {
      return 0;
    }
    return Math.max(1, Math.floor((Date.now() - voice.conversationStartedAt) / 1000));
  }, [voice.conversationStartedAt]);

  const logVoiceUsage = useCallback(async () => {
    const durationSeconds = getVoiceDurationSeconds();
    if (durationSeconds < 1) {
      return;
    }

    const sessionId = sessionIdRef.current;
    if (doubaoLoggedSessionRef.current === sessionId) {
      return;
    }
    doubaoLoggedSessionRef.current = sessionId;

    const backend = voice.activeBackend ?? "doubao";
    if (backend === "selfhosted") {
      // DeepSeek / SiliconFlow usage is logged by the self-hosted voice server on disconnect.
      return;
    }

    await logApiUsage({
      userId: usageActor.userId,
      guestId: usageActor.guestId,
      sessionId,
      apiProvider: "doubao",
      modelName: "volc.speech.dialog",
      durationSeconds,
    });
  }, [getVoiceDurationSeconds, usageActor.guestId, usageActor.userId, voice.activeBackend]);

  const handleSelectTopic = useCallback((selectedTopicId: string) => {
    setTopicId(selectedTopicId);
    setPracticeScreen("chat");
  }, []);

  const handleFreeTalk = useCallback(() => {
    setTopicId(null);
    setPracticeScreen("chat");
  }, []);

  const handleExitChat = useCallback(() => {
    void logVoiceUsage();
    voice.clearConversation();
    setReport(null);
    setReportError(null);
    sessionIdRef.current = crypto.randomUUID();
    doubaoLoggedSessionRef.current = null;
    setPracticeScreen("topics");
  }, [voice, logVoiceUsage]);

  const handleEndAndReport = useCallback(async () => {
    const transcript = buildTranscriptFromMessages(voice.messages);
    const durationSeconds = getVoiceDurationSeconds();
    await logVoiceUsage();
    voice.stop();

    if (!transcript.trim()) {
      setReportError("这次还没聊到什么内容，多说几句再结束吧～");
      return;
    }

    setReportLoading(true);
    setReportError(null);

    try {
      const taskScenario = topicId ? findTaskScenario(topicId) : undefined;
      const nextReport = await generateReport({
        sessionId: sessionIdRef.current,
        transcript,
        durationSeconds: durationSeconds || 1,
        userId: usageActor.userId ?? undefined,
        guestId: usageActor.guestId ?? undefined,
        taskGoals: taskScenario?.goals.map((g) => ({ id: g.id, desc: g.desc })),
      });
      setReport(nextReport);

      if (!isAnonymous) {
        await persistSessionReport({
          sessionId: sessionIdRef.current,
          topic: topicId,
          transcript,
          durationSeconds,
          report: nextReport,
        });

        if (userId) {
          const data = await loadGrowthPageData();
          if (data) {
            writeGrowthCache(userId, data);
            setHomeGrowthData(data);
          }
        }

        try {
          const nextMemory = await extractMemory({
            transcript,
            report: nextReport,
            previousSummary: userMemory,
            userId: usageActor.userId ?? undefined,
            guestId: usageActor.guestId ?? undefined,
            sessionId: sessionIdRef.current,
          });
          await upsertUserMemory(nextMemory);
          setUserMemory(nextMemory);
        } catch (memoryError) {
          console.warn(
            "[memory] extraction failed:",
            memoryError instanceof Error ? memoryError.message : memoryError,
          );
        }
      } else if (usageActor.guestId) {
        await persistGuestSessionReport({
          sessionId: sessionIdRef.current,
          guestId: usageActor.guestId,
          topic: topicId,
          transcript,
          durationSeconds,
          report: nextReport,
        });
      }
    } catch (error) {
      setReportError(error instanceof Error ? error.message : String(error));
    } finally {
      setReportLoading(false);
    }
  }, [voice, topicId, isAnonymous, userMemory, usageActor, userId, getVoiceDurationSeconds, logVoiceUsage]);

  const sessionLabel = useMemo(() => scenarioLabel(topicId), [topicId]);

  const activeTopic = useMemo(
    () => (topicId ? (CHAT_TOPICS.find((t) => t.id === topicId) ?? null) : null),
    [topicId],
  );

  const activeTask = useMemo<TaskScenario | null>(
    () => (topicId ? (findTaskScenario(topicId) ?? null) : null),
    [topicId],
  );

  const handleMainTabChange = useCallback((tab: MainTab) => {
    if (inChat) {
      return;
    }
    setMainTab(tab);
  }, [inChat]);

  const handleGoToRecord = useCallback(() => {
    setMainTab("me");
    setRecordDeepLink((count) => count + 1);
  }, []);

  const handleRecordDeepLinkConsumed = useCallback(() => {
    setRecordDeepLink(0);
  }, []);

  const handleGoToAccount = useCallback(() => {
    setAccountReturnTab("practice");
    setMainTab("me");
    setAccountDeepLink((count) => count + 1);
  }, []);

  const handleAccountExit = useCallback(() => {
    const returnTab = accountReturnTab;
    setAccountReturnTab(null);
    setAccountDeepLink(0);
    if (returnTab) {
      setMainTab(returnTab);
    }
  }, [accountReturnTab]);

  const handleAccountDeepLinkConsumed = useCallback(() => {
    setAccountDeepLink(0);
  }, []);

  return (
    <div className={`app-shell flex min-h-dvh flex-col ${inChat ? "bg-bg-canvas text-ink-on-canvas" : "bg-bg text-text"}`}>
      {!inChat ? (
        <AppNavBar
          active={mainTab}
          onChange={handleMainTabChange}
          showLogin={isConfigured && isAnonymous}
          onLogin={handleGoToAccount}
        />
      ) : null}

      {inChat ? (
        <header className="app-top-bar sticky top-0 z-30 border-b border-white/10 bg-bg-canvas/90 backdrop-blur-xl">
          <div className="page-shell page-shell--flow flex items-center gap-3 py-3">
            <button
              type="button"
              onClick={handleExitChat}
              className="flex shrink-0 items-center gap-0.5 rounded-full px-2 py-1.5 text-sm text-ink-on-canvas-soft transition-colors hover:bg-white/10 hover:text-ink-on-canvas active:scale-95"
            >
              ← 返回
            </button>
            <p className="min-w-0 flex-1 truncate text-center text-sm font-medium text-ink-on-canvas">
              {sessionLabel}
            </p>
            <span className="w-14 shrink-0" aria-hidden="true" />
          </div>
        </header>
      ) : null}

      <main
        className={`page-shell flex flex-col ${
          inChat
            ? "min-h-0 flex-1 pb-2 pt-0 md:py-4"
            : "pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-0 md:pb-8 md:pt-2"
        }`}
      >
        {mainTab === "practice" && practiceScreen === "topics" ? (
          <TopicSelector
            onSelectTopic={handleSelectTopic}
            onFreeTalk={handleFreeTalk}
            showGuestHint={isConfigured && isAnonymous}
            onGoToAccount={handleGoToAccount}
            onGoToRecord={handleGoToRecord}
            practiceInsight={homePracticeInsight}
            insightLoading={homeInsightLoading}
          />
        ) : null}

        {mainTab === "practice" && practiceScreen === "chat" ? (
          <VoiceSession
            voice={voice}
            settings={sessionSettings}
            sessionLabel={sessionLabel}
            activeTopic={activeTopic}
            activeTask={activeTask}
            appSessionId={sessionIdRef.current}
            usageUserId={usageActor.userId}
            usageGuestId={usageActor.guestId}
            voiceType={resolvedVoiceType}
            voiceOptions={voiceProfile.voices}
            showVoicePicker={showsVoicePicker(voiceProfile)}
            onVoiceChange={setVoiceType}
            speedRatio={preferences.speedRatio}
            onSpeedChange={setSpeedRatio}
            showSubtitle={preferences.showSubtitle}
            onShowSubtitleChange={setShowSubtitle}
            report={report}
            reportLoading={reportLoading}
            reportError={reportError}
            wordCount={speechStats.wordCount}
            sentenceCount={speechStats.sentenceCount}
            onEndAndReport={() => void handleEndAndReport()}
          />
        ) : null}

        {mainTab === "me" ? (
          <MeView
            accountDeepLink={accountDeepLink}
            onAccountExit={accountReturnTab ? handleAccountExit : undefined}
            onAccountDeepLinkConsumed={handleAccountDeepLinkConsumed}
            recordDeepLink={recordDeepLink}
            onRecordDeepLinkConsumed={handleRecordDeepLinkConsumed}
          />
        ) : null}
      </main>

      {!inChat ? <BottomTabBar active={mainTab} onChange={handleMainTabChange} /> : null}
    </div>
  );
}

export default App;
