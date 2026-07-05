import { useCallback, useMemo, useRef, useState } from "react";
import { AccountModal } from "./components/AccountModal";
import { TopicSelector } from "./components/TopicSelector";
import { VoiceSession } from "./components/VoiceSession";
import {
  buildTranscriptFromMessages,
  countUserSpeechStats,
  generateReport,
} from "./core/report";
import { useVoiceSession } from "./hooks/useVoiceSession";
import { useAuth } from "./hooks/useAuth";
import { persistSessionReport } from "./core/storage";
import {
  buildSystemPrompt,
  DEFAULT_SPEED_RATIO,
  DEFAULT_VOICE_TYPE,
} from "./config/session";
import type { ReportJSON, SessionSettings, TopicOption } from "./types";

const TOPICS: TopicOption[] = [
  {
    id: "daily",
    title: "今天过得怎么样",
    description: "从日常小事聊起，最放松的开场",
    promptSeed:
      "start by asking the user how their day has been and gently keep the small talk going.",
  },
  {
    id: "travel",
    title: "想去的地方",
    description: "聊聊旅行计划，或者印象最深的一次出行",
    promptSeed:
      "start by asking where the user would love to travel next, or their most memorable trip.",
  },
  {
    id: "food",
    title: "吃点什么好",
    description: "推荐一家店、一道菜，或者自己做饭的故事",
    promptSeed:
      "start by asking the user about food they love — a favorite dish, restaurant, or cooking they do.",
  },
  {
    id: "work",
    title: "工作与生活",
    description: "最近在忙什么，有什么想吐槽或分享的",
    promptSeed:
      "start by asking what the user has been busy with at work lately and how they feel about it.",
  },
];

function App() {
  const { isConfigured, isAnonymous } = useAuth();
  const [view, setView] = useState<"topics" | "chat">("topics");
  const voice = useVoiceSession();
  const [report, setReport] = useState<ReportJSON | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const sessionIdRef = useRef(crypto.randomUUID());

  // Session personalization (voice / speed / topic).
  const [voiceType, setVoiceType] = useState(DEFAULT_VOICE_TYPE);
  const [speedRatio, setSpeedRatio] = useState(DEFAULT_SPEED_RATIO);
  const [topicId, setTopicId] = useState<string | null>(null);

  const speechStats = useMemo(
    () => countUserSpeechStats(voice.messages),
    [voice.messages],
  );

  const sessionSettings = useMemo<SessionSettings>(() => {
    const topic = TOPICS.find((t) => t.id === topicId);
    return {
      voiceType,
      speedRatio,
      systemPrompt: buildSystemPrompt(topic?.promptSeed),
    };
  }, [voiceType, speedRatio, topicId]);

  const handleSelectTopic = useCallback((selectedTopicId: string) => {
    setTopicId(selectedTopicId);
    setView("chat");
  }, []);

  const handleFreeTalk = useCallback(() => {
    setTopicId(null);
    setView("chat");
  }, []);

  const handleExitChat = useCallback(() => {
    voice.clearConversation();
    setReport(null);
    setReportError(null);
    sessionIdRef.current = crypto.randomUUID();
    setView("topics");
  }, [voice]);

  const handleEndAndReport = useCallback(async () => {
    const transcript = buildTranscriptFromMessages(voice.messages);
    voice.stop();

    if (!transcript.trim()) {
      setReportError("这次还没聊到什么内容，多说几句再结束吧～");
      return;
    }

    setReportLoading(true);
    setReportError(null);

    try {
      const durationSeconds = voice.conversationStartedAt
        ? Math.max(1, Math.floor((Date.now() - voice.conversationStartedAt) / 1000))
        : 1;

      const nextReport = await generateReport({
        sessionId: sessionIdRef.current,
        transcript,
        durationSeconds,
      });
      setReport(nextReport);

      // Persist in the background; storage failures must not block the UI.
      void persistSessionReport({
        sessionId: sessionIdRef.current,
        topic: topicId,
        transcript,
        durationSeconds,
        report: nextReport,
      });
    } catch (error) {
      setReportError(error instanceof Error ? error.message : String(error));
    } finally {
      setReportLoading(false);
    }
  }, [voice, topicId]);

  const sessionLabel = useMemo(() => {
    if (!topicId) {
      return "自由畅聊";
    }
    return TOPICS.find((t) => t.id === topicId)?.title ?? "自由畅聊";
  }, [topicId]);

  return (
    <main className="min-h-screen bg-[#FAF8F3] text-[#3D3D3D]">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <header className="flex items-center justify-between">
          <h1 className="text-lg font-medium text-[#7C6B5D]">小榜 · 陪你说英语</h1>
          <div className="flex items-center gap-4">
            <AccountModal />
            {view === "chat" ? (
              <button
                type="button"
                onClick={handleExitChat}
                className="text-sm text-[#A89B8C] transition-colors hover:text-[#7C6B5D]"
              >
                换个话题
              </button>
            ) : null}
          </div>
        </header>

        {view === "topics" && isConfigured && isAnonymous ? (
          <p className="mt-3 rounded-2xl bg-[#FFF9F3] px-4 py-2.5 text-xs leading-relaxed text-[#A89B8C]">
            当前为游客模式，练习记录和成长记忆不会保存到账号。注册后可跨设备找回。
          </p>
        ) : null}

        {view === "topics" ? (
          <TopicSelector
            topics={TOPICS}
            onSelectTopic={handleSelectTopic}
            onFreeTalk={handleFreeTalk}
          />
        ) : (
          <VoiceSession
            voice={voice}
            settings={sessionSettings}
            sessionLabel={sessionLabel}
            voiceType={voiceType}
            onVoiceChange={setVoiceType}
            speedRatio={speedRatio}
            onSpeedChange={setSpeedRatio}
            report={report}
            reportLoading={reportLoading}
            reportError={reportError}
            wordCount={speechStats.wordCount}
            sentenceCount={speechStats.sentenceCount}
            onEndAndReport={() => void handleEndAndReport()}
          />
        )}
      </div>
    </main>
  );
}

export default App;
