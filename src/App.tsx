import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppNavBar } from "./components/AppNavBar";
import { BottomTabBar, type MainTab } from "./components/BottomTabBar";
import { ExpressionPracticeSummaryScreen } from "./components/ExpressionPracticeSummaryScreen";
import { MeView } from "./components/MeView";
import { ReportScreen } from "./components/ReportScreen";
import { TopicSelector, type PracticeInsight } from "./components/TopicSelector";
import { VoiceSession } from "./components/VoiceSession";
import {
  buildTranscriptFromMessages,
  countUserSpeechStats,
  generateExpressionPracticeSummary,
  generateReport,
} from "./core/report";
import { extractMemory } from "./core/memory";
import {
  applyTrackedExpressionReuse,
  preserveTrackedExpressionReuse,
} from "./core/trackedExpressionReuse";
import { resolveUsageActor, logApiUsage } from "./core/usageLog";
import { setAnalyticsContext, trackEvent, trackEventOnce } from "./core/analytics";
import { useVoiceSession } from "./hooks/useVoiceSession";
import { useVoiceProfile } from "./hooks/useVoiceProfile";
import { useOpeningDirections } from "./hooks/useOpeningDirections";
import { useAuth } from "./hooks/useAuth";
import { useUserPreferences } from "./hooks/useUserPreferences";
import { pickVoiceType, showsVoicePicker } from "./config/voices";
import {
  loadUserMemory,
  loadGrowthPageData,
  persistGuestSessionReport,
  persistSessionReport,
  upsertUserMemory,
} from "./core/storage";
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
  buildExpressionPracticeSystemPrompt,
  buildSystemPrompt,
  buildTaskSystemPrompt,
} from "./config/session";
import type {
  ExpressionPracticeContext,
  ExpressionPracticeSummary,
  GrowthNewExpression,
  GrowthPageData,
  MemorySummary,
  ReportJSON,
  PracticeMode,
  ReportReusedExpression,
  SessionSettings,
  TaskScenario,
  UserMemory,
} from "./types";

type PracticeScreen = "topics" | "chat" | "report" | "expressionSummary";

function App() {
  const { isConfigured, isAnonymous, isLoading: authLoading, userId } = useAuth();
  const { preferences, setVoiceType, setSpeedRatio, setShowSubtitle } = useUserPreferences();
  const { voiceProfile } = useVoiceProfile();
  const [mainTab, setMainTab] = useState<MainTab>("practice");
  const [practiceScreen, setPracticeScreen] = useState<PracticeScreen>("topics");
  const voice = useVoiceSession();
  const openingDirections = useOpeningDirections();
  const [report, setReport] = useState<ReportJSON | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("normal");
  const [expressionPracticeContext, setExpressionPracticeContext] =
    useState<ExpressionPracticeContext | null>(null);
  const [expressionSummary, setExpressionSummary] = useState<ExpressionPracticeSummary | null>(null);
  const [expressionSummaryLoading, setExpressionSummaryLoading] = useState(false);
  const [expressionSummaryError, setExpressionSummaryError] = useState<string | null>(null);
  const [userMemory, setUserMemory] = useState<UserMemory | null>(null);
  const [homeGrowthData, setHomeGrowthData] = useState<GrowthPageData | null>(null);
  const [homeInsightLoading, setHomeInsightLoading] = useState(false);
  const sessionIdRef = useRef(crypto.randomUUID());
  const doubaoLoggedSessionRef = useRef<string | null>(null);
  // 复盘生成的“代际”标记：用户中途退出后，旧一轮的异步结果不再回写 UI 状态
  const reportRunRef = useRef(0);

  const [topicId, setTopicId] = useState<string | null>(null);
  const [accountDeepLink, setAccountDeepLink] = useState(0);
  const [recordDeepLink, setRecordDeepLink] = useState(0);
  const [accountReturnTab, setAccountReturnTab] = useState<MainTab | null>(null);

  const inChat = practiceScreen === "chat";
  const inReport = practiceScreen === "report";
  const inExpressionSummary = practiceScreen === "expressionSummary";
  const inImmersiveFlow = inChat || inReport || inExpressionSummary;

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

  const sessionSettings = useMemo<SessionSettings>(() => {
    if (practiceMode === "expression_practice" && expressionPracticeContext) {
      return {
        voiceType: resolvedVoiceType,
        speedRatio: preferences.speedRatio,
        systemPrompt: buildExpressionPracticeSystemPrompt(expressionPracticeContext, userMemory),
      };
    }

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
  }, [
    resolvedVoiceType,
    preferences.speedRatio,
    practiceMode,
    expressionPracticeContext,
    topicId,
    userMemory,
  ]);

  const usageActor = useMemo(
    () => resolveUsageActor({ userId, isAnonymous }),
    [userId, isAnonymous],
  );

  // 事件表的 user_id 记录 Supabase auth uid（包含匿名 auth uid）。
  // 仅在 Supabase 未配置/无 auth uid 时退回本地 guestId，保证游客也可统计。
  const analyticsActor = useMemo(
    () => ({
      userId: userId ?? null,
      guestId: userId ? null : usageActor.guestId,
    }),
    [userId, usageActor.guestId],
  );

  useEffect(() => {
    setAnalyticsContext({
      userId: analyticsActor.userId,
      guestId: analyticsActor.guestId,
      sessionId: sessionIdRef.current,
    });
  }, [analyticsActor]);

  // 开口漏斗埋点：App 启动。等 auth 恢复完成再记，保证游客/登录身份归属稳定。
  useEffect(() => {
    if (authLoading) {
      return;
    }
    trackEventOnce("app_open", "app_open", {
      userId: analyticsActor.userId,
      guestId: analyticsActor.guestId,
    });
  }, [authLoading, analyticsActor]);

  // 开口漏斗埋点：复盘报告渲染成功。
  useEffect(() => {
    if (practiceScreen !== "report" || !report) {
      return;
    }
    const sessionId = sessionIdRef.current;
    trackEventOnce(`report_view:${sessionId}`, "report_view", {
      userId: analyticsActor.userId,
      guestId: analyticsActor.guestId,
      sessionId,
    });
  }, [practiceScreen, report, analyticsActor]);

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

  const handleSelectTopic = useCallback(
    (selectedTopicId: string) => {
      // Fire the AI direction prefetch right as the user picks the card, so it
      // has the whole "connecting" transition to resolve before the opening
      // guide card mounts. Task scenarios first (roleSetup doubles as the seed).
      const taskScenario = findTaskScenario(selectedTopicId);
      const topic = taskScenario ? undefined : CHAT_TOPICS.find((t) => t.id === selectedTopicId);
      const prefetchTarget = taskScenario
        ? {
            topicId: taskScenario.id,
            title: taskScenario.title,
            description: taskScenario.description,
            promptSeed: taskScenario.roleSetup,
          }
        : topic
          ? {
              topicId: topic.id,
              title: topic.title,
              description: topic.description,
              promptSeed: topic.promptSeed,
            }
          : null;
      openingDirections.prefetch(prefetchTarget, userMemory, {
        userId: usageActor.userId ?? undefined,
        guestId: usageActor.guestId ?? undefined,
        sessionId: sessionIdRef.current,
      });

      setPracticeMode("normal");
      setExpressionPracticeContext(null);
      setExpressionSummary(null);
      setExpressionSummaryError(null);
      setTopicId(selectedTopicId);
      setPracticeScreen("chat");
    },
    [openingDirections, userMemory, usageActor.userId, usageActor.guestId],
  );

  const handleFreeTalk = useCallback(() => {
    openingDirections.prefetch(
      {
        topicId: "free-talk",
        title: "自由畅聊",
        description: "没有固定场景，从用户真实生活、工作或最近感兴趣的事聊起",
        promptSeed: "Open with anything the learner genuinely wants to talk about today.",
      },
      userMemory,
      {
        userId: usageActor.userId ?? undefined,
        guestId: usageActor.guestId ?? undefined,
        sessionId: sessionIdRef.current,
      },
    );
    setPracticeMode("normal");
    setExpressionPracticeContext(null);
    setExpressionSummary(null);
    setExpressionSummaryError(null);
    setTopicId(null);
    setPracticeScreen("chat");
  }, [openingDirections, userMemory, usageActor.userId, usageActor.guestId]);

  const handleExitChat = useCallback(() => {
    reportRunRef.current += 1;
    void logVoiceUsage();
    voice.clearConversation();
    setReportError(null);
    setReportLoading(false);
    setExpressionSummary(null);
    setExpressionSummaryError(null);
    setExpressionSummaryLoading(false);
    sessionIdRef.current = crypto.randomUUID();
    setAnalyticsContext({ sessionId: sessionIdRef.current });
    doubaoLoggedSessionRef.current = null;
    openingDirections.reset();

    if (practiceMode === "expression_practice") {
      setPracticeMode("normal");
      setExpressionPracticeContext(null);
      setPracticeScreen(report ? "report" : "topics");
      return;
    }

    setReport(null);
    setPracticeScreen("topics");
  }, [voice, logVoiceUsage, openingDirections, practiceMode, report]);

  const handleExitAllPractice = useCallback(() => {
    reportRunRef.current += 1;
    void logVoiceUsage();
    voice.clearConversation();
    setReport(null);
    setReportError(null);
    setReportLoading(false);
    setPracticeMode("normal");
    setExpressionPracticeContext(null);
    setExpressionSummary(null);
    setExpressionSummaryError(null);
    setExpressionSummaryLoading(false);
    sessionIdRef.current = crypto.randomUUID();
    setAnalyticsContext({ sessionId: sessionIdRef.current });
    doubaoLoggedSessionRef.current = null;
    openingDirections.reset();
    setPracticeScreen("topics");
  }, [voice, logVoiceUsage, openingDirections]);

  const handleBackToSourceReport = useCallback(() => {
    reportRunRef.current += 1;
    void logVoiceUsage();
    voice.clearConversation();
    setPracticeMode("normal");
    setExpressionPracticeContext(null);
    setExpressionSummary(null);
    setExpressionSummaryError(null);
    setExpressionSummaryLoading(false);
    sessionIdRef.current = crypto.randomUUID();
    setAnalyticsContext({ sessionId: sessionIdRef.current });
    doubaoLoggedSessionRef.current = null;
    openingDirections.reset();
    setPracticeScreen(report ? "report" : "topics");
  }, [voice, logVoiceUsage, openingDirections, report]);

  const handleStartExpressionPractice = useCallback(
    (expressions: GrowthNewExpression[]) => {
      const targetExpressions: ExpressionPracticeContext["targetExpressions"] = expressions
        .slice(0, 3)
        .flatMap((item) => {
          const text = item.phrase?.trim();
          if (!text) {
            return [];
          }
          const meaning = item.meaning?.trim();
          const example = item.example?.trim();
          return [
            {
              text,
              ...(meaning ? { meaning } : {}),
              ...(example ? { example } : {}),
            },
          ];
        });

      if (targetExpressions.length === 0) {
        return;
      }

      reportRunRef.current += 1;
      voice.clearConversation();
      openingDirections.reset();
      const nextSessionId = crypto.randomUUID();
      sessionIdRef.current = nextSessionId;
      setAnalyticsContext({ sessionId: nextSessionId });
      doubaoLoggedSessionRef.current = null;
      const context: ExpressionPracticeContext = {
        sourceReportId: report?.sessionId,
        targetExpressions,
      };
      setPracticeMode("expression_practice");
      setExpressionPracticeContext(context);
      setExpressionSummary(null);
      setExpressionSummaryError(null);
      setExpressionSummaryLoading(false);
      setReportError(null);
      setReportLoading(false);
      setTopicId(null);
      setPracticeScreen("chat");

      trackEvent("repractice_start", {
        userId: analyticsActor.userId,
        guestId: analyticsActor.guestId,
        sessionId: nextSessionId,
        props: {
          expressionCount: targetExpressions.length,
        },
      });
    },
    [analyticsActor.guestId, analyticsActor.userId, openingDirections, report?.sessionId, voice],
  );

  const handleEndAndReport = useCallback(async () => {
    const transcript = buildTranscriptFromMessages(voice.messages);
    const durationSeconds = getVoiceDurationSeconds();
    await logVoiceUsage();
    voice.stop();

    if (practiceMode === "expression_practice") {
      const sessionId = sessionIdRef.current;
      const runId = ++reportRunRef.current;
      const isCurrentRun = () => reportRunRef.current === runId;
      setPracticeScreen("expressionSummary");
      setExpressionSummaryLoading(true);
      setExpressionSummaryError(null);
      setExpressionSummary(null);

      try {
        if (!expressionPracticeContext?.targetExpressions.length) {
          throw new Error("没有可复练的目标表达，请回到原报告重新进入。");
        }
        const summary = await generateExpressionPracticeSummary({
          sessionId,
          targetExpressions: expressionPracticeContext.targetExpressions,
          transcript,
          durationSeconds: durationSeconds || 1,
          userId: usageActor.userId ?? undefined,
          guestId: usageActor.guestId ?? undefined,
        });
        if (isCurrentRun()) {
          setExpressionSummary(summary);
        }
      } catch (error) {
        if (isCurrentRun()) {
          setExpressionSummaryError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (isCurrentRun()) {
          setExpressionSummaryLoading(false);
        }
      }
      return;
    }

    if (!transcript.trim()) {
      setReportError("这次还没聊到什么内容，多说几句再结束吧～");
      return;
    }

    // 复盘报告切到独立页面展示，不再挤在对话流里
    // 固定这一轮的 sessionId 和代际号：用户中途退出（sessionId 会重置）也不影响后台保存和 UI 状态
    const sessionId = sessionIdRef.current;
    const runId = ++reportRunRef.current;
    const isCurrentRun = () => reportRunRef.current === runId;

    // 开口漏斗埋点：用户主动结束会话（transcript 非空才算一次有效完成）。
    trackEventOnce(`session_complete:${sessionId}`, "session_complete", {
      userId: analyticsActor.userId,
      guestId: analyticsActor.guestId,
      sessionId,
      props: {
        durationSeconds: durationSeconds || 1,
        userTurns: speechStats.sentenceCount,
      },
    });

    setPracticeScreen("report");
    setReportLoading(true);
    setReportError(null);

    try {
      const taskScenario = topicId ? findTaskScenario(topicId) : undefined;
      const generatedReport = await generateReport({
        sessionId,
        transcript,
        durationSeconds: durationSeconds || 1,
        userId: usageActor.userId ?? undefined,
        guestId: usageActor.guestId ?? undefined,
        taskGoals: taskScenario?.goals.map((g) => ({ id: g.id, desc: g.desc })),
      });

      let reportForSession: ReportJSON = generatedReport;
      let memoryForExtraction: MemorySummary | null = userMemory?.summary ?? null;
      let reuseUpdatedMemory: MemorySummary | null = null;
      const reusedExpressions: ReportReusedExpression[] = [];

      if (!isAnonymous && userMemory) {
        try {
          const reuseResult = applyTrackedExpressionReuse(userMemory.summary, transcript);
          if (reuseResult.reusedExpressions.length > 0) {
            reuseUpdatedMemory = reuseResult.summary;
            memoryForExtraction = reuseResult.summary;
            reusedExpressions.push(...reuseResult.reusedExpressions);
            reportForSession = {
              ...generatedReport,
              reusedExpressions: reuseResult.reusedExpressions,
            };
          }
        } catch (reuseError) {
          console.warn(
            "[memory] tracked expression reuse matching failed:",
            reuseError instanceof Error ? reuseError.message : reuseError,
          );
        }
      }

      if (isCurrentRun()) {
        setReport(reportForSession);
      }

      if (!isAnonymous) {
        await persistSessionReport({
          sessionId,
          topic: topicId,
          transcript,
          durationSeconds,
          report: reportForSession,
        });

        if (userId) {
          const data = await loadGrowthPageData();
          if (data) {
            writeGrowthCache(userId, data);
            setHomeGrowthData(data);
          }
        }

        try {
          const extractedMemory = await extractMemory({
            transcript,
            report: reportForSession,
            previousSummary: memoryForExtraction,
            previousEntries: userMemory?.entries ?? [],
            userId: usageActor.userId ?? undefined,
            guestId: usageActor.guestId ?? undefined,
            sessionId,
          });
          const nextSummary = preserveTrackedExpressionReuse(
            extractedMemory.summary,
            reuseUpdatedMemory,
            reusedExpressions,
          );
          const nextMemory: UserMemory = {
            summary: nextSummary,
            entries: extractedMemory.entries,
          };
          await upsertUserMemory(nextMemory);
          setUserMemory(nextMemory);
        } catch (memoryError) {
          console.warn(
            "[memory] extraction failed:",
            memoryError instanceof Error ? memoryError.message : memoryError,
          );
          if (reuseUpdatedMemory) {
            const fallbackMemory: UserMemory = {
              summary: reuseUpdatedMemory,
              entries: userMemory?.entries ?? [],
            };
            await upsertUserMemory(fallbackMemory);
            setUserMemory(fallbackMemory);
          }
        }
      } else if (usageActor.guestId) {
        await persistGuestSessionReport({
          sessionId,
          guestId: usageActor.guestId,
          topic: topicId,
          transcript,
          durationSeconds,
          report: reportForSession,
        });
      }
    } catch (error) {
      if (isCurrentRun()) {
        setReportError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (isCurrentRun()) {
        setReportLoading(false);
      }
    }
  }, [
    voice,
    topicId,
    isAnonymous,
    userMemory,
    usageActor,
    analyticsActor,
    userId,
    getVoiceDurationSeconds,
    logVoiceUsage,
    practiceMode,
    expressionPracticeContext,
  ]);

  const sessionLabel = useMemo(
    () => (practiceMode === "expression_practice" ? "表达复练" : scenarioLabel(topicId)),
    [practiceMode, topicId],
  );

  const activeTopic = useMemo(
    () => (topicId ? (CHAT_TOPICS.find((t) => t.id === topicId) ?? null) : null),
    [topicId],
  );

  const activeTask = useMemo<TaskScenario | null>(
    () => (topicId ? (findTaskScenario(topicId) ?? null) : null),
    [topicId],
  );

  const handleMainTabChange = useCallback((tab: MainTab) => {
    if (inImmersiveFlow) {
      return;
    }
    setMainTab(tab);
  }, [inImmersiveFlow]);

  const handleBackToChat = useCallback(() => {
    setPracticeScreen("chat");
  }, []);

  const handleViewReport = useCallback(() => {
    setPracticeScreen("report");
  }, []);

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
    <div className={`app-shell flex ${inChat ? "h-dvh overflow-hidden" : "min-h-dvh"} flex-col ${
      inChat ? "bg-bg-canvas text-ink-on-canvas" : "bg-bg text-text"
    }`}>
      {!inImmersiveFlow ? (
        <AppNavBar
          active={mainTab}
          onChange={handleMainTabChange}
          showLogin={isConfigured && isAnonymous}
          onLogin={handleGoToAccount}
        />
      ) : null}

      {inReport ? (
        <header className="app-top-bar sticky top-0 z-30 border-b border-border-subtle bg-bg/90 backdrop-blur-xl">
          <div className="page-shell page-shell--flow flex items-center gap-3 py-3">
            {report ? (
              <button
                type="button"
                onClick={handleBackToChat}
                className="flex shrink-0 items-center gap-0.5 rounded-full px-2 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-warm hover:text-text active:scale-95"
              >
                ← 返回对话
              </button>
            ) : (
              <span className="w-20 shrink-0" aria-hidden="true" />
            )}
            <p className="min-w-0 flex-1 truncate text-center text-sm font-medium text-text">
              复盘报告
            </p>
            <button
              type="button"
              onClick={handleExitChat}
              className="w-14 shrink-0 rounded-full px-2 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-warm hover:text-text active:scale-95"
            >
              {report ? "完成" : "退出"}
            </button>
          </div>
        </header>
      ) : null}

      {inExpressionSummary ? (
        <header className="app-top-bar sticky top-0 z-30 border-b border-border-subtle bg-bg/90 backdrop-blur-xl">
          <div className="page-shell page-shell--flow flex items-center gap-3 py-3">
            <button
              type="button"
              onClick={handleBackToSourceReport}
              className="flex shrink-0 items-center gap-0.5 rounded-full px-2 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-warm hover:text-text active:scale-95"
            >
              ← 回报告
            </button>
            <p className="min-w-0 flex-1 truncate text-center text-sm font-medium text-text">
              复练小结
            </p>
            <button
              type="button"
              onClick={handleExitAllPractice}
              className="w-14 shrink-0 rounded-full px-2 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-warm hover:text-text active:scale-95"
            >
              完成
            </button>
          </div>
        </header>
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
            ? "h-full min-h-0 flex-1 overflow-hidden pb-2 pt-0 md:py-4"
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
            topicCounts={homeGrowthData?.topicCounts}
          />
        ) : null}

        {mainTab === "practice" && practiceScreen === "chat" ? (
          <VoiceSession
            voice={voice}
            settings={sessionSettings}
            sessionLabel={sessionLabel}
            practiceMode={practiceMode}
            expressionPracticeContext={expressionPracticeContext}
            activeTopic={practiceMode === "expression_practice" ? null : activeTopic}
            activeTask={practiceMode === "expression_practice" ? null : activeTask}
            aiDirections={openingDirections.directionsFor(topicId ?? "free-talk")}
            appSessionId={sessionIdRef.current}
            usageUserId={usageActor.userId}
            usageGuestId={usageActor.guestId}
            analyticsUserId={analyticsActor.userId}
            analyticsGuestId={analyticsActor.guestId}
            voiceType={resolvedVoiceType}
            voiceOptions={voiceProfile.voices}
            showVoicePicker={showsVoicePicker(voiceProfile)}
            onVoiceChange={setVoiceType}
            speedRatio={preferences.speedRatio}
            onSpeedChange={setSpeedRatio}
            showSubtitle={preferences.showSubtitle}
            onShowSubtitleChange={setShowSubtitle}
            report={practiceMode === "expression_practice" ? null : report}
            reportLoading={practiceMode === "expression_practice" ? expressionSummaryLoading : reportLoading}
            reportError={practiceMode === "expression_practice" ? null : reportError}
            onEndAndReport={() => void handleEndAndReport()}
            onViewReport={handleViewReport}
          />
        ) : null}

        {mainTab === "practice" && practiceScreen === "report" ? (
          <ReportScreen
            report={report}
            loading={reportLoading}
            error={reportError}
            wordCount={speechStats.wordCount}
            sentenceCount={speechStats.sentenceCount}
            taskGoals={activeTask?.goals}
            savedToHistory={isConfigured && !isAnonymous}
            onBackToChat={handleBackToChat}
            onExit={handleExitChat}
            onRepracticeExpressions={handleStartExpressionPractice}
          />
        ) : null}

        {mainTab === "practice" && practiceScreen === "expressionSummary" ? (
          <ExpressionPracticeSummaryScreen
            summary={expressionSummary}
            loading={expressionSummaryLoading}
            error={expressionSummaryError}
            onBackToReport={handleBackToSourceReport}
            onExit={handleExitAllPractice}
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

      {!inImmersiveFlow ? <BottomTabBar active={mainTab} onChange={handleMainTabChange} /> : null}
    </div>
  );
}

export default App;
