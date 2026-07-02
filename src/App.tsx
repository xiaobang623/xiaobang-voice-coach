import { useCallback, useMemo, useRef, useState } from "react";
import { TopicSelector } from "./components/TopicSelector";
import { VoiceSession } from "./components/VoiceSession";
import {
  buildTranscriptFromMessages,
  countUserSpeechStats,
  generateReport,
} from "./core/report";
import { useVoiceSession } from "./hooks/useVoiceSession";
import type { ReportJSON, TopicOption } from "./types";

const TOPICS: TopicOption[] = [
  {
    id: "daily",
    title: "今天过得怎么样",
    description: "从日常小事聊起，最放松的开场",
  },
  {
    id: "travel",
    title: "想去的地方",
    description: "聊聊旅行计划，或者印象最深的一次出行",
  },
  {
    id: "food",
    title: "吃点什么好",
    description: "推荐一家店、一道菜，或者自己做饭的故事",
  },
  {
    id: "work",
    title: "工作与生活",
    description: "最近在忙什么，有什么想吐槽或分享的",
  },
];

function App() {
  const [view, setView] = useState<"topics" | "chat">("topics");
  const voice = useVoiceSession();
  const [report, setReport] = useState<ReportJSON | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const sessionIdRef = useRef(crypto.randomUUID());

  const speechStats = useMemo(
    () => countUserSpeechStats(voice.messages),
    [voice.messages],
  );

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
    } catch (error) {
      setReportError(error instanceof Error ? error.message : String(error));
    } finally {
      setReportLoading(false);
    }
  }, [voice]);

  return (
    <main className="min-h-screen bg-[#FAF8F3] text-[#3D3D3D]">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <header className="flex items-center justify-between">
          <h1 className="text-lg font-medium text-[#7C6B5D]">小榜 · 陪你说英语</h1>
          {view === "chat" ? (
            <button
              type="button"
              onClick={handleExitChat}
              className="text-sm text-[#A89B8C] transition-colors hover:text-[#7C6B5D]"
            >
              换个话题
            </button>
          ) : null}
        </header>

        {view === "topics" ? (
          <TopicSelector
            topics={TOPICS}
            onSelectTopic={() => setView("chat")}
            onFreeTalk={() => setView("chat")}
          />
        ) : (
          <VoiceSession
            voice={voice}
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
