import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BottomTabBar, type MainTab } from "./components/BottomTabBar";
import { MeView } from "./components/MeView";
import { TopicSelector } from "./components/TopicSelector";
import { VoiceSession } from "./components/VoiceSession";
import {
  buildTranscriptFromMessages,
  countUserSpeechStats,
  generateReport,
} from "./core/report";
import { extractMemory } from "./core/memory";
import { resolveUsageActor } from "./core/usageLog";
import { useVoiceSession } from "./hooks/useVoiceSession";
import { useAuth } from "./hooks/useAuth";
import { useUserPreferences } from "./hooks/useUserPreferences";
import { loadUserMemory, loadGrowthPageData, persistSessionReport, upsertUserMemory } from "./core/storage";
import {
  GROWTH_CACHE_STALE_MS,
  growthCacheAgeMs,
  writeGrowthCache,
} from "./core/growthCache";
import {
  buildSystemPrompt,
} from "./config/session";
import type { MemorySummary, ReportJSON, SessionSettings, TopicOption } from "./types";

const TOPICS: TopicOption[] = [
  {
    id: "daily",
    title: "今天过得怎么样",
    description: "从日常小事聊起，最放松的开场",
    openingHint: "小榜会先问你今天过得怎么样，比如 How has your day been?",
    promptSeed:
      "start by asking the user how their day has been and gently keep the small talk going.",
  },
  {
    id: "travel",
    title: "想去的地方",
    description: "聊聊旅行计划，或者印象最深的一次出行",
    openingHint: "小榜会问你下次想去哪，或者最难忘的一次旅行",
    promptSeed:
      "start by asking where the user would love to travel next, or their most memorable trip.",
  },
  {
    id: "food",
    title: "吃点什么好",
    description: "推荐一家店、一道菜，或者自己做饭的故事",
    openingHint: "小榜会问你最爱吃什么、常去哪家店，或者会不会自己做饭",
    promptSeed:
      "start by asking the user about food they love — a favorite dish, restaurant, or cooking they do.",
  },
  {
    id: "work",
    title: "工作与生活",
    description: "最近在忙什么，有什么想吐槽或分享的",
    openingHint: "小榜会问你最近在忙什么、工作节奏怎么样",
    promptSeed:
      "start by asking what the user has been busy with at work lately and how they feel about it.",
  },
];

type PracticeScreen = "topics" | "chat";

function App() {
  const { isConfigured, isAnonymous, userId } = useAuth();
  const { preferences, setVoiceType, setSpeedRatio, setShowSubtitle } = useUserPreferences();
  const [mainTab, setMainTab] = useState<MainTab>("practice");
  const [practiceScreen, setPracticeScreen] = useState<PracticeScreen>("topics");
  const voice = useVoiceSession();
  const [report, setReport] = useState<ReportJSON | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [userMemory, setUserMemory] = useState<MemorySummary | null>(null);
  const sessionIdRef = useRef(crypto.randomUUID());

  const [topicId, setTopicId] = useState<string | null>(null);
  const [accountDeepLink, setAccountDeepLink] = useState(0);

  const inChat = practiceScreen === "chat";

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
      return;
    }

    const cacheAge = growthCacheAgeMs(userId);
    if (cacheAge !== null && cacheAge < GROWTH_CACHE_STALE_MS) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const data = await loadGrowthPageData();
      if (!cancelled && data) {
        writeGrowthCache(userId, data);
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

  const sessionSettings = useMemo<SessionSettings>(() => {
    const topic = TOPICS.find((t) => t.id === topicId);
    return {
      voiceType: preferences.voiceType,
      speedRatio: preferences.speedRatio,
      systemPrompt: buildSystemPrompt(topic?.promptSeed, userMemory),
    };
  }, [preferences.voiceType, preferences.speedRatio, topicId, userMemory]);

  const usageActor = useMemo(() => resolveUsageActor({ userId }), [userId]);

  const getVoiceDurationSeconds = useCallback(() => {
    if (!voice.conversationStartedAt) {
      return 0;
    }
    return Math.max(1, Math.floor((Date.now() - voice.conversationStartedAt) / 1000));
  }, [voice.conversationStartedAt]);

  const handleSelectTopic = useCallback((selectedTopicId: string) => {
    setTopicId(selectedTopicId);
    setPracticeScreen("chat");
  }, []);

  const handleFreeTalk = useCallback(() => {
    setTopicId(null);
    setPracticeScreen("chat");
  }, []);

  const handleExitChat = useCallback(() => {
    voice.clearConversation();
    setReport(null);
    setReportError(null);
    sessionIdRef.current = crypto.randomUUID();
    setPracticeScreen("topics");
  }, [voice]);

  const handleEndAndReport = useCallback(async () => {
    const transcript = buildTranscriptFromMessages(voice.messages);
    const durationSeconds = getVoiceDurationSeconds();
    voice.stop();

    if (!transcript.trim()) {
      setReportError("这次还没聊到什么内容，多说几句再结束吧～");
      return;
    }

    setReportLoading(true);
    setReportError(null);

    try {
      const nextReport = await generateReport({
        sessionId: sessionIdRef.current,
        transcript,
        durationSeconds: durationSeconds || 1,
        userId: usageActor.userId ?? undefined,
        guestId: usageActor.guestId ?? undefined,
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
      }
    } catch (error) {
      setReportError(error instanceof Error ? error.message : String(error));
    } finally {
      setReportLoading(false);
    }
  }, [voice, topicId, isAnonymous, userMemory, usageActor, getVoiceDurationSeconds]);

  const sessionLabel = useMemo(() => {
    if (!topicId) {
      return "自由畅聊";
    }
    return TOPICS.find((t) => t.id === topicId)?.title ?? "自由畅聊";
  }, [topicId]);

  const activeTopic = useMemo(
    () => (topicId ? (TOPICS.find((t) => t.id === topicId) ?? null) : null),
    [topicId],
  );

  const handleMainTabChange = useCallback((tab: MainTab) => {
    if (inChat) {
      return;
    }
    setMainTab(tab);
  }, [inChat]);

  const handleGoToAccount = useCallback(() => {
    setMainTab("me");
    setAccountDeepLink((count) => count + 1);
  }, []);

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="sticky top-0 z-30 border-b border-border-subtle/70 bg-bg/90 backdrop-blur-xl">
        <div className="page-shell flex items-center gap-3 py-4">
          {inChat ? (
            <>
              <button
                type="button"
                onClick={handleExitChat}
                className="flex shrink-0 items-center gap-0.5 rounded-full px-2 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-warm/70 hover:text-text"
              >
                ← 返回
              </button>
              <p className="min-w-0 flex-1 truncate text-center text-sm font-medium text-text">
                {sessionLabel}
              </p>
              <span className="w-14 shrink-0" aria-hidden="true" />
            </>
          ) : (
            <div className="flex items-baseline gap-2">
              <h1 className="text-lg font-semibold text-text">小榜</h1>
              <span className="text-sm text-text-muted">陪你说英语</span>
            </div>
          )}
        </div>
      </header>

      <main className={`page-shell ${inChat ? "pb-6 pt-1" : "pb-28 pt-2"}`}>
        {mainTab === "practice" && practiceScreen === "topics" ? (
          <>
            {isConfigured && isAnonymous ? (
              <div className="mb-5 rounded-2xl border border-border-subtle bg-surface px-4 py-3.5">
                <p className="text-sm text-text-secondary">游客模式 · 可直接开聊</p>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">
                  练习记录和成长记忆需要登录后才会保存
                </p>
                <button
                  type="button"
                  onClick={handleGoToAccount}
                  className="mt-3 w-full rounded-full border border-accent/30 bg-accent/10 px-4 py-2.5 text-sm font-medium text-accent transition-colors hover:bg-accent/15"
                >
                  登录 / 注册
                </button>
              </div>
            ) : null}
            <TopicSelector
              topics={TOPICS}
              onSelectTopic={handleSelectTopic}
              onFreeTalk={handleFreeTalk}
            />
          </>
        ) : null}

        {mainTab === "practice" && practiceScreen === "chat" ? (
          <VoiceSession
            voice={voice}
            settings={sessionSettings}
            sessionLabel={sessionLabel}
            activeTopic={activeTopic}
            appSessionId={sessionIdRef.current}
            usageUserId={usageActor.userId}
            usageGuestId={usageActor.guestId}
            voiceType={preferences.voiceType}
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

        {mainTab === "me" ? <MeView accountDeepLink={accountDeepLink} /> : null}
      </main>

      {!inChat ? <BottomTabBar active={mainTab} onChange={handleMainTabChange} /> : null}
    </div>
  );
}

export default App;
