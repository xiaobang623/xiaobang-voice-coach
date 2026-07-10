import type { TopicOption } from "../types";
import { CHAT_TOPICS } from "../config/chatTopics";
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
        className="h-full min-h-[164px] p-4 transition-all duration-200 group-hover:-translate-y-1 group-hover:border-border-strong group-active:scale-[0.98]"
      >
        <div className="flex h-full flex-col justify-between gap-3">
          <span className={`flex h-11 w-11 items-center justify-center rounded-[12px] ${tag.tint}`}>
            {Icon ? <Icon className="h-4.5 w-4.5" /> : null}
          </span>
          <div>
            <h3 className="text-[17px] font-semibold tracking-tight text-text">{topic.title}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-text-muted">{topic.description}</p>
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
}: TopicSelectorProps) {
  return (
    <section className="animate-fade-up pb-2">
      <div className="home-shell mx-auto w-full max-w-[72rem]">
        <div className="flex items-start justify-between gap-4 py-1 pb-7 md:pt-2">
          <div>
            <p className="text-xs font-medium tracking-wide text-text-muted">早上好</p>
            <h1 className="mt-2 text-[clamp(30px,4vw,42px)] font-semibold tracking-tight text-text">
              准备好开口了吗
            </h1>
          </div>
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-muted">
            <img
              src={xiaobangIdle}
              alt=""
              className="h-full w-full object-cover object-[50%_30%] grayscale contrast-[0.92] brightness-[1.04]"
            />
          </div>
        </div>

        <Card
          variant="default"
          className="relative overflow-hidden p-7 shadow-[0_28px_56px_rgba(10,9,7,0.16)] md:min-h-[270px] md:p-10"
          style={{
            backgroundColor: "#1b1e22",
            color: "#faf9f6",
          }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(160px_160px_at_88%_-10%,rgba(166,129,63,0.32),transparent_70%)]" />
          <div className="relative flex flex-col gap-7 md:flex-row md:items-end md:justify-between">
            <div className="max-w-[46ch]">
              <div className="text-xs font-semibold tracking-[0.08em] uppercase" style={{ color: "rgba(250,249,246,0.6)" }}>
                开始练习
              </div>
              <h2 className="mt-12 text-[clamp(28px,3vw,34px)] font-semibold tracking-tight" style={{ color: "#faf9f6" }}>
                开始对话
              </h2>
              <p className="mt-3 max-w-[46ch] text-[15px] leading-relaxed" style={{ color: "rgba(250,249,246,0.6)" }}>
                从熟悉的话题开始，AI 全程不打断，说完再一起复盘
              </p>
            </div>
            <button
              type="button"
              onClick={onFreeTalk}
              className="flex h-16 w-16 items-center justify-center rounded-full border border-white/20 bg-white/5 transition hover:bg-white/10 active:scale-95"
              style={{ color: "#faf9f6" }}
              aria-label="开始练习"
            >
              <CircleMicIcon className="h-6 w-6" />
            </button>
          </div>
        </Card>

        <div className="flex flex-col gap-9 pt-6">
          <div>
            <div className="section-title mb-3">选择场景</div>
            <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
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
            <Card variant="default" className="p-5 md:p-6">
              <div className="flex items-center justify-between gap-3">
                <div className="section-title !m-0">最近的练习洞察</div>
                <span className="eyebrow">近 7 天</span>
              </div>
              <div className="mt-4 flex items-end gap-6">
                <div>
                  <div className="text-[22px] font-bold tracking-tight text-text">4</div>
                  <div className="mt-1 text-[11px] text-text-muted">练习次数</div>
                </div>
                <div>
                  <div className="text-[22px] font-bold tracking-tight text-text">38分钟</div>
                  <div className="mt-1 text-[11px] text-text-muted">总时长</div>
                </div>
                <div>
                  <div className="text-[22px] font-bold tracking-tight text-spark">B2</div>
                  <div className="mt-1 text-[11px] text-text-muted">当前水平</div>
                </div>
              </div>
              <div className="mt-4 border-t border-border pt-4 text-[13.5px] leading-relaxed text-text-secondary">
                本周高频问题：<strong className="font-semibold text-text">过去时态的一致性</strong>。
                已在最近两次点评报告中重复出现，建议下次练习时刻意留意。
              </div>
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

            {showGuestHint && onGoToAccount ? (
              <button
                type="button"
                onClick={onGoToAccount}
                className="mt-1 inline-flex items-center justify-center rounded-[16px] border border-border bg-surface px-5 py-4 text-sm font-semibold text-text transition hover:border-border-strong"
              >
                登录后保存练习记录
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
