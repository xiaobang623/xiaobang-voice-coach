import type { TopicOption } from "../types";
import type { CorrectionType, UserLevel } from "../types";
import { CHAT_TOPICS } from "../config/chatTopics";
import { getCefrLevel } from "../config/levels";
import { TOPIC_ICON, TOPIC_TAG } from "../config/topics";
import xiaobangIdle from "../assets/xiaobang/xiaobang-idle.png";
import { Card } from "./ui/Card";
import { CircleMicIcon } from "./ui/icons";

export interface TopicSelectorProps {
  onSelectTopic: (topicId: string) => void;
  onFreeTalk: () => void;
  showGuestHint?: boolean;
  onGoToAccount?: () => void;
  onGoToRecord?: () => void;
  practiceInsight?: PracticeInsight | null;
  insightLoading?: boolean;
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
  onSelect,
}: {
  topic: TopicOption;
  index: number;
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
          <span className={`flex h-11 w-11 items-center justify-center rounded-[12px] ${tag.tint}`}>
            {Icon ? <Icon className="h-4.5 w-4.5" /> : null}
          </span>
          <div>
            <h3 className="text-[17px] font-semibold tracking-tight text-text">{topic.title}</h3>
            <p className="mt-1.5 text-[13px] leading-[1.45] text-text-muted">{topic.description}</p>
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
}: TopicSelectorProps) {
  const hasInsight = Boolean(practiceInsight && practiceInsight.sessionCount7d > 0);
  const levelLabel = practiceInsight?.latestUserLevel
    ? getCefrLevel(practiceInsight.latestUserLevel)
    : "--";

  return (
    <section className="animate-fade-up pb-2">
      <div className="home-shell mx-auto w-full max-w-[980px]">
        <div className="flex items-start justify-between gap-4 py-1 pb-7 md:pt-2">
          <div>
            <p className="eyebrow">早上好</p>
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
          <div className="relative flex items-center justify-between">
            <div className="eyebrow !text-[rgba(244,243,240,0.5)]">开始练习</div>
            <div className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-[rgba(244,243,240,0.28)]">
              <CircleMicIcon className="h-5 w-5 text-ink-on-canvas" />
            </div>
          </div>
          <h2 className="relative mt-9 text-[clamp(28px,3vw,34px)] font-semibold tracking-tight text-ink-on-canvas md:mt-[54px]">
            开始对话
          </h2>
          <p className="relative mt-2.5 max-w-[46ch] text-[15px] leading-relaxed text-[rgba(244,243,240,0.6)]">
            从熟悉的话题开始，AI 全程不打断，说完再一起复盘
          </p>
        </button>

        <div className="flex flex-col gap-9 pt-6">
          <div>
            <div className="section-title">选择场景</div>
            <div className="grid grid-cols-2 gap-3 min-[900px]:grid-cols-4">
              {CHAT_TOPICS.map((topic, index) => (
                <TopicCard
                  key={topic.id}
                  topic={topic}
                  index={index}
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
                  登录后查看你的近 7 天练习次数、总时长、当前水平和高频问题。
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
                      <div className="mt-0.5 text-[11.5px] text-text-muted">练习次数</div>
                    </div>
                    <div>
                      <div className="text-[22px] font-bold tracking-tight text-text">
                        {formatInsightDuration(practiceInsight.durationSeconds7d)}
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-text-muted">总时长</div>
                    </div>
                    <div>
                      <div className="text-[22px] font-bold tracking-tight text-spark">{levelLabel}</div>
                      <div className="mt-0.5 text-[11.5px] text-text-muted">当前水平</div>
                    </div>
                  </div>
                  <div className="mt-3.5 border-t border-border pt-3.5 text-[13px] leading-[1.55] text-text-secondary">
                    {practiceInsight.topMistakeType ? (
                      <>
                        本周高频问题：
                        <strong className="font-semibold text-text">
                          {MISTAKE_LABEL[practiceInsight.topMistakeType]}
                        </strong>
                        。近 7 天相关建议出现 {practiceInsight.topMistakeCount} 次，下次练习可以刻意留意。
                      </>
                    ) : (
                      "近 7 天暂未发现重复出现的表达问题，继续保持开口频率。"
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
