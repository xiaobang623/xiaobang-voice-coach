import { useEffect, useMemo, useState } from "react";
import type { TopicOption } from "../types";
import type { CorrectionType, UserLevel } from "../types";
import { CHAT_TOPICS } from "../config/chatTopics";
import { getCefrLevel } from "../config/levels";
import { getGreeting } from "../core/greeting";
import { TOPIC_ICON, TOPIC_TAG } from "../config/topics";
import { Badge } from "./ui/Badge";
import { Card } from "./ui/Card";
import { CircleMicIcon } from "./ui/icons";
import { Mascot } from "./ui/Mascot";

export interface TopicSelectorProps {
  onSelectTopic: (topicId: string) => void;
  onFreeTalk: () => void;
  showGuestHint?: boolean;
  onGoToAccount?: () => void;
  onGoToRecord?: () => void;
  practiceInsight?: PracticeInsight | null;
  insightLoading?: boolean;
  /**
   * How often each topic id appears in the user's session history (see
   * loadGrowthPageData's topicCounts). Used to sort cards by habit and tag the
   * most-practiced one "常聊". Absent/all-zero (guests, new accounts) keeps
   * the default CHAT_TOPICS order with no badge.
   */
  topicCounts?: Record<string, number>;
}

/**
 * Sort topics by descending session frequency, keeping ties in the original
 * CHAT_TOPICS order. Only the single highest-frequency topic (if any) gets
 * tagged "常聊" — a tie at 0 (guests/new accounts) tags nothing.
 */
function sortTopicsByFrequency(
  topics: TopicOption[],
  counts: Record<string, number> | undefined,
): { sorted: TopicOption[]; topTopicId: string | null } {
  if (!counts) {
    return { sorted: topics, topTopicId: null };
  }

  const sorted = topics
    .map((topic, index) => ({ topic, index, count: counts[topic.id] ?? 0 }))
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .map((entry) => entry.topic);

  const top = sorted[0];
  const topTopicId = top && (counts[top.id] ?? 0) > 0 ? top.id : null;

  return { sorted, topTopicId };
}

export interface PracticeInsight {
  sessionCount7d: number;
  durationSeconds7d: number;
  latestUserLevel: UserLevel | null;
  topMistakeType: CorrectionType | null;
  topMistakeCount: number;
}

const MISTAKE_LABEL: Record<CorrectionType, string> = {
  grammar: "语法准确性",
  collocation: "搭配和介词",
  vocabulary: "词汇选择",
  naturalness: "地道表达",
  structure: "句式结构",
};

function formatInsightDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}小时${rest}分` : `${hours}小时`;
}

function TopicCard({
  topic,
  index,
  isFrequent,
  onSelect,
}: {
  topic: TopicOption;
  index: number;
  isFrequent: boolean;
  onSelect: () => void;
}) {
  const tag = TOPIC_TAG[topic.id];
  const Icon = TOPIC_ICON[topic.id];

  return (
    <button
      type="button"
      onClick={onSelect}
      className="animate-fade-up group h-full w-full text-left"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <Card
        variant="default"
        className="h-full min-h-[164px] p-4 transition-[border-color,transform] duration-[160ms] ease-[cubic-bezier(0.4,0,0.2,1)] group-hover:border-border-strong group-active:scale-[0.98]"
      >
        <div className="flex h-full flex-col justify-between gap-2.5">
          <div className="flex items-start justify-between gap-2">
            <span className={`flex h-11 w-11 items-center justify-center rounded-[12px] ${tag.tint}`}>
              {Icon ? <Icon className="h-4.5 w-4.5" /> : null}
            </span>
            {isFrequent ? <Badge tone="accent">常聊</Badge> : null}
          </div>
          <div>
            <h3 className="text-[17px] font-semibold tracking-tight text-text">{topic.title}</h3>
            <p className="mt-1.5 text-[13px] leading-[1.45] text-text-secondary">{topic.description}</p>
          </div>
        </div>
      </Card>
    </button>
  );
}

export function TopicSelector({
  onSelectTopic,
  onFreeTalk,
  showGuestHint = false,
  onGoToAccount,
  onGoToRecord,
  practiceInsight,
  insightLoading = false,
  topicCounts,
}: TopicSelectorProps) {
  const [greeting, setGreeting] = useState(() => getGreeting());
  const hasInsight = Boolean(practiceInsight && practiceInsight.sessionCount7d > 0);
  const levelLabel = practiceInsight?.latestUserLevel
    ? getCefrLevel(practiceInsight.latestUserLevel)
    : "--";
  const { sorted: sortedTopics, topTopicId } = useMemo(
    () => sortTopicsByFrequency(CHAT_TOPICS, topicCounts),
    [topicCounts],
  );

  useEffect(() => {
    const refreshGreeting = () => setGreeting(getGreeting());
    refreshGreeting();
    const timer = window.setInterval(refreshGreeting, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="animate-fade-up pb-2">
      <div className="home-shell mx-auto w-full max-w-[980px]">
        <div className="flex items-start justify-between gap-4 py-1 pb-7 md:pt-2">
          <div>
            <p className="eyebrow">{greeting}</p>
            <h1 className="mt-2.5 text-[clamp(30px,4vw,42px)] font-semibold leading-[1.12] tracking-tight text-text">
              准备好开口了吗
            </h1>
          </div>
        </div>

        <button
          type="button"
          onClick={onFreeTalk}
          className="relative block w-full min-h-[230px] overflow-hidden rounded-[24px] bg-ink px-[clamp(28px,4vw,44px)] pb-[clamp(30px,4vw,42px)] pt-[clamp(34px,4vw,52px)] text-left md:min-h-[270px]"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(160px_160px_at_88%_-10%,rgba(166,129,63,0.32),transparent_70%)]" />
          <div className="pointer-events-none absolute -bottom-3 right-4 z-0 sm:right-7">
            <Mascot
              expression="happy"
              fullBody
              size={150}
              className="drop-shadow-[0_16px_28px_rgba(0,0,0,0.2)] sm:[transform:scale(1.1)]"
            />
          </div>
          <div className="relative flex items-center justify-between">
            <div className="eyebrow !text-ink-on-canvas/50">开始练习</div>
            <div className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-[rgba(244,243,240,0.28)]">
              <CircleMicIcon className="h-5 w-5 text-ink-on-canvas" />
            </div>
          </div>
          <h2 className="relative z-10 mt-9 max-w-[60%] text-[clamp(28px,3vw,34px)] font-semibold tracking-tight text-ink-on-canvas md:mt-[54px]">
            开始对话
          </h2>
          <p className="relative z-10 mt-2.5 max-w-[42ch] pr-20 text-[15px] leading-relaxed text-ink-on-canvas/60">
            从熟悉的话题开始，AI 全程不打断，说完再一起复盘
          </p>
        </button>

        <div className="flex flex-col gap-9 pt-6">
          <div>
            <div className="section-title">选择场景</div>
            <div className="grid grid-cols-2 gap-3 min-[900px]:grid-cols-4">
              {sortedTopics.map((topic, index) => (
                <TopicCard
                  key={topic.id}
                  topic={topic}
                  index={index}
                  isFrequent={topic.id === topTopicId}
                  onSelect={() => onSelectTopic(topic.id)}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <Card variant="default" className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="section-title !m-0">最近的练习洞察</div>
                <span className="eyebrow">近 7 天</span>
              </div>

              {showGuestHint ? (
                <div className="mt-3.5 rounded-[16px] bg-surface-muted px-4 py-3 text-[13px] leading-[1.55] text-text-secondary">
                  登录后查看你的近 7 天练习次数、总时长、当前水平和练习提醒。
                  {onGoToAccount ? (
                    <button
                      type="button"
                      onClick={onGoToAccount}
                      className="mt-3 inline-flex font-semibold text-text"
                    >
                      登录 / 注册
                    </button>
                  ) : null}
                </div>
              ) : insightLoading ? (
                <div className="mt-3.5 space-y-3">
                  <div className="h-8 w-48 animate-pulse rounded-full bg-surface-muted" />
                  <div className="h-14 animate-pulse rounded-[16px] bg-surface-muted" />
                </div>
              ) : hasInsight && practiceInsight ? (
                <>
                  <div className="mt-3.5 flex gap-[22px]">
                    <div>
                      <div className="text-[22px] font-bold tracking-tight text-text">
                        {practiceInsight.sessionCount7d}
                      </div>
                      <div className="mt-0.5 text-[12px] text-text-secondary">练习次数</div>
                    </div>
                    <div>
                      <div className="text-[22px] font-bold tracking-tight text-text">
                        {formatInsightDuration(practiceInsight.durationSeconds7d)}
                      </div>
                      <div className="mt-0.5 text-[12px] text-text-secondary">总时长</div>
                    </div>
                    <div>
                      <div className="text-[22px] font-bold tracking-tight text-spark">{levelLabel}</div>
                      <div className="mt-0.5 text-[12px] text-text-secondary">当前水平</div>
                    </div>
                  </div>
                  <div className="mt-3.5 border-t border-border pt-3.5 text-[13px] leading-[1.55] text-text-secondary">
                    {practiceInsight.topMistakeType ? (
                      <>
                        本周你已经开口 {practiceInsight.sessionCount7d} 次、共{" "}
                        {formatInsightDuration(practiceInsight.durationSeconds7d)}。想再稳一点，可以留意一下「
                        <strong className="font-semibold text-text">
                          {MISTAKE_LABEL[practiceInsight.topMistakeType]}
                        </strong>
                        」。
                      </>
                    ) : (
                      "近 7 天表达状态很稳，继续保持开口频率。"
                    )}
                  </div>
                </>
              ) : (
                <div className="mt-3.5 rounded-[16px] bg-surface-muted px-4 py-3 text-[13px] leading-[1.55] text-text-secondary">
                  完成一次练习并生成复盘后，这里会出现你的近 7 天练习洞察。
                </div>
              )}

              {onGoToRecord ? (
                <button
                  type="button"
                  onClick={onGoToRecord}
                  className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-text"
                >
                  查看完整档案
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              ) : null}
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}
