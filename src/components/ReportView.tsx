import { useState } from "react";
import type {
  Correction,
  CorrectionType,
  ReportGrowth,
  ReportJSON,
  TaskGoal,
  TaskGoalStatus,
} from "../types";
import { getCefrLevel, getLevelInfo } from "../config/levels";
import { Badge } from "./ui/Badge";
import { Card } from "./ui/Card";
import { LevelSystemCard } from "./LevelSystem";
import {
  CheckCircleIcon,
  CollocationIcon,
  EmptyCircleIcon,
  GrammarIcon,
  HalfCircleIcon,
  NaturalnessIcon,
  StructureIcon,
  VocabularyIcon,
} from "./ui/icons";

export interface ReportViewProps {
  report: ReportJSON | null;
  wordCount?: number;
  sentenceCount?: number;
  taskGoals?: TaskGoal[];
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) {
    return `${rest} 秒`;
  }
  return rest === 0 ? `${minutes} 分钟` : `${minutes} 分 ${rest} 秒`;
}

const DIMENSION_META: Record<
  CorrectionType,
  { label: string; Icon: typeof GrammarIcon; description: string }
> = {
  grammar: { label: "语法", Icon: GrammarIcon, description: "时态、搭配、冠词等语法问题" },
  collocation: { label: "搭配", Icon: CollocationIcon, description: "词语组合不够地道" },
  vocabulary: { label: "用词", Icon: VocabularyIcon, description: "可以选更准确的词" },
  naturalness: {
    label: "地道表达",
    Icon: NaturalnessIcon,
    description: "语法没错，但母语者会换种说法",
  },
  structure: { label: "句式结构", Icon: StructureIcon, description: "句子组织和衔接可以更好" },
};

const SEVERITY_LABEL = {
  critical: "重要",
  important: "建议改",
  minor: "小优化",
} as const;

const DIMENSION_ORDER: CorrectionType[] = [
  "grammar",
  "collocation",
  "vocabulary",
  "naturalness",
  "structure",
];

const TASK_STATUS_META: Record<
  TaskGoalStatus,
  { Icon: typeof CheckCircleIcon; label: string; tone: string }
> = {
  done: { Icon: CheckCircleIcon, label: "达成", tone: "text-success" },
  partial: { Icon: HalfCircleIcon, label: "部分达成", tone: "text-warning" },
  missed: { Icon: EmptyCircleIcon, label: "未达成", tone: "text-text-muted" },
};

function TaskResultsSection({
  report,
  taskGoals,
}: {
  report: ReportJSON;
  taskGoals: TaskGoal[];
}) {
  if (!report.taskResults?.length) {
    return null;
  }

  const goalDescById = Object.fromEntries(taskGoals.map((g) => [g.id, g.desc]));

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-medium text-text-secondary">任务完成度</h3>
        {report.taskScore ? (
          <span className="text-lg font-semibold tabular-nums text-accent-gold">{report.taskScore}</span>
        ) : null}
      </div>
      <ul className="mt-4 space-y-3">
        {report.taskResults.map((result) => {
          const meta = TASK_STATUS_META[result.status] ?? TASK_STATUS_META.missed;
          const desc = goalDescById[result.goalId] ?? result.goalId;
          return (
            <li key={result.goalId}>
              <Card variant="elevated" className="p-4">
                <div className="flex items-start gap-2.5">
                  <meta.Icon className={`mt-0.5 h-5 w-5 shrink-0 ${meta.tone}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text">{desc}</p>
                    <p className={`mt-1 text-xs font-medium ${meta.tone}`}>{meta.label}</p>
                    <p className="mt-2 text-xs leading-relaxed text-text-muted">{result.reason}</p>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card variant="ghost" className="p-4 text-center">
      <p className="text-2xl font-semibold tabular-nums text-text">{value}</p>
      <p className="mt-1 text-xs text-text-muted">{label}</p>
    </Card>
  );
}

function CorrectionCard({ correction }: { correction: Correction }) {
  const [expanded, setExpanded] = useState(false);
  const severity = correction.severity ?? "important";
  // redesign/session-review.html: "更好的表达" uses teal for the improved line
  const correctedTone =
    correction.type === "naturalness" || correction.type === "collocation"
      ? "text-accent-teal"
      : "text-text";

  return (
    <button
      type="button"
      onClick={() => setExpanded((value) => !value)}
      className="w-full text-left"
    >
      <Card
        variant="default"
        className="p-4 transition-colors duration-[160ms] hover:border-border-strong"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={severity === "critical" ? "accent" : "default"}>
            {SEVERITY_LABEL[severity]}
          </Badge>
          {(correction.frequency ?? 1) > 1 ? (
            <span className="text-xs text-text-muted">出现了 {correction.frequency} 次</span>
          ) : null}
        </div>
        <p className="mt-3 text-[13.5px] text-text-muted line-through decoration-border-strong">
          {correction.original}
        </p>
        <p className={`mt-1.5 text-[15px] font-semibold leading-snug ${correctedTone}`}>
          {correction.corrected}
        </p>
        <span className="mt-2.5 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-text-secondary">
          为什么这样更好
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          >
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        {expanded ? (
          <div className="mt-2 text-[13px] leading-[1.6] text-text-secondary">
            <p>{correction.explanation}</p>
            {correction.example ? (
              <p className="mt-2 text-text-muted">例：{correction.example}</p>
            ) : null}
          </div>
        ) : null}
      </Card>
    </button>
  );
}

function TodayFocusCard({ correction }: { correction: Correction }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card variant="inset" className="p-0">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="w-full p-5 text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="section-title !mb-0">今日重点</p>
          <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-text-secondary">
            {expanded ? "收起说明" : "查看说明"}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            >
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
        <p className="mt-3 text-sm text-text-muted line-through decoration-border-strong">
          {correction.original}
        </p>
        <p className="mt-1 text-[15px] font-semibold text-text">
          {correction.corrected}
        </p>
        {expanded ? (
          <div className="mt-3 rounded-[14px] bg-surface/70 p-3 text-[13px] leading-[1.6] text-text-secondary">
            <p>{correction.explanation}</p>
            {correction.example ? (
              <p className="mt-2 text-text-muted">例：{correction.example}</p>
            ) : null}
          </div>
        ) : null}
      </button>
    </Card>
  );
}

function GrowthSection({ growth }: { growth: ReportGrowth }) {
  const hasAny =
    growth.sayBetter.length > 0 || growth.newExpressions.length > 0 || growth.talkMore.length > 0;
  if (!hasAny) {
    return null;
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">口语提升包</p>
        <p className="mt-1 text-xs text-text-muted">
          {growth.topic
            ? `围绕「${growth.topic}」，这些内容能让你下次说得更多、更好`
            : "这些内容能让你下次说得更多、更好"}
        </p>
      </div>

      {growth.sayBetter.length > 0 ? (
        <div>
          <h3 className="text-[13px] font-semibold text-text-secondary">下次可以这样说</h3>
          <p className="mt-0.5 text-xs text-text-muted">你说得没错，但可以更丰富——试着升级这些句子</p>
          <ul className="mt-4 space-y-3">
            {growth.sayBetter.map((item, index) => (
              <li key={`say-better-${index}`}>
                <Card variant="default" className="p-4">
                  <p className="text-[13.5px] text-text-muted">你说的：{item.original}</p>
                  <p className="mt-1.5 text-[15px] font-semibold leading-snug text-accent-teal">
                    {item.upgraded}
                  </p>
                  {item.note ? (
                    <p className="mt-2 text-[13px] leading-[1.6] text-text-secondary">{item.note}</p>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {growth.newExpressions.length > 0 ? (
        <div>
          <h3 className="text-[13px] font-semibold text-text-secondary">值得记下的新表达</h3>
          <p className="mt-0.5 text-xs text-text-muted">跟这次话题直接相关的口语词块和句型</p>
          <ul className="mt-4 space-y-3">
            {growth.newExpressions.map((item, index) => (
              <li key={`new-expression-${index}`}>
                <Card variant="default" className="p-4">
                  <p className="text-[15px] font-semibold leading-snug text-text">{item.phrase}</p>
                  <p className="mt-1.5 text-[13px] leading-[1.6] text-text-secondary">{item.meaning}</p>
                  {item.example ? (
                    <p className="mt-2 text-[13px] leading-[1.6] text-text-muted">例：{item.example}</p>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {growth.talkMore.length > 0 ? (
        <div>
          <h3 className="text-[13px] font-semibold text-text-secondary">这个话题还能聊什么</h3>
          <p className="mt-0.5 text-xs text-text-muted">下次可以展开的角度，起手句直接照着说就行</p>
          <ul className="mt-4 space-y-3">
            {growth.talkMore.map((item, index) => (
              <li key={`talk-more-${index}`}>
                <Card variant="default" className="p-4">
                  <p className="text-[13.5px] font-medium text-text">{item.angle}</p>
                  <p className="mt-1.5 text-[14px] leading-snug text-accent-teal">“{item.starter}”</p>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ReportView({ report, wordCount, sentenceCount, taskGoals }: ReportViewProps) {
  if (!report) {
    return null;
  }

  const grouped = DIMENSION_ORDER.map((type) => ({
    type,
    meta: DIMENSION_META[type],
    items: report.corrections.filter((item) => item.type === type),
  })).filter((section) => section.items.length > 0);

  const topCorrection = report.corrections[0] ?? null;
  const currentLevel = getCefrLevel(report.userLevel);
  const currentLevelInfo = getLevelInfo(currentLevel);

  return (
    <section className="animate-fade-up space-y-7 py-2">
      <header>
        <p className="eyebrow">点评报告</p>
        <div className="mt-2.5 flex items-baseline gap-2.5">
          <h2 className="text-[clamp(34px,4vw,46px)] font-bold tracking-tight text-accent-gold">
            {currentLevel}
          </h2>
          <span className="text-sm font-semibold text-text-secondary">本次口语水平</span>
        </div>
        <p className="mt-2.5 max-w-[48ch] text-sm leading-relaxed text-text-secondary">
          {currentLevelInfo.shortLabel} · {currentLevelInfo.ability}
          <br />
          {report.corrections.length > 0
            ? `这次一共整理了 ${report.corrections.length} 条建议，先看「今日重点」，再逐条展开。`
            : "这次几乎没什么要改的，保持这个状态继续练。"}
        </p>
      </header>

      <LevelSystemCard
        userLevel={report.userLevel}
        title="这次等级在体系里的位置"
        note="本次练习估算"
      />

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="时长" value={formatDuration(report.durationSeconds)} />
        <StatCard label="词数" value={wordCount != null ? String(wordCount) : "—"} />
        <StatCard label="句数" value={sentenceCount != null ? String(sentenceCount) : "—"} />
      </div>

      {taskGoals && taskGoals.length > 0 ? (
        <TaskResultsSection report={report} taskGoals={taskGoals} />
      ) : null}

      {topCorrection ? <TodayFocusCard correction={topCorrection} /> : null}

      {report.growth ? <GrowthSection growth={report.growth} /> : null}

      {grouped.length > 0 ? (
        <div className="space-y-8">
          {grouped.map((section) => (
            <div key={section.type}>
              <h3 className="text-[13px] font-semibold text-text-secondary">{section.meta.label}</h3>
              <p className="mt-0.5 text-xs text-text-muted">{section.meta.description}</p>
              <ul className="mt-4 space-y-3">
                {section.items.map((correction, index) => (
                  <li key={`${section.type}-${index}`}>
                    <CorrectionCard correction={correction} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <Card variant="ghost" className="p-6 text-center text-sm text-text-muted">
          这次几乎没什么要改的，说得挺自然
        </Card>
      )}
    </section>
  );
}
