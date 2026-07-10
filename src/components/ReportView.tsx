import { useState } from "react";
import type { Correction, CorrectionType, ReportJSON, TaskGoal, TaskGoalStatus, UserLevel } from "../types";
import { Badge } from "./ui/Badge";
import { Card } from "./ui/Card";
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

const USER_LEVEL_LABEL: Record<UserLevel, string> = {
  beginner: "初级",
  intermediate: "中级",
  advanced: "高级",
};

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
          <span className="font-display text-lg tabular-nums text-accent">{report.taskScore}</span>
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
      <p className="font-display text-2xl tabular-nums text-text">{value}</p>
      <p className="mt-1 text-xs text-text-muted">{label}</p>
    </Card>
  );
}

function CorrectionCard({ correction }: { correction: Correction }) {
  const [expanded, setExpanded] = useState(false);
  const severity = correction.severity ?? "important";

  return (
    <button
      type="button"
      onClick={() => setExpanded((value) => !value)}
      className="w-full text-left"
    >
      <Card
        variant="elevated"
        className="p-5 transition-shadow hover:shadow-elevated"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={severity === "critical" ? "accent" : "default"}>
            {SEVERITY_LABEL[severity]}
          </Badge>
          {(correction.frequency ?? 1) > 1 ? (
            <span className="text-xs text-text-muted">出现了 {correction.frequency} 次</span>
          ) : null}
        </div>
        <p className="mt-4 text-sm text-text-muted line-through decoration-accent-muted/70">
          {correction.original}
        </p>
        <p className="font-display mt-2 text-lg leading-snug text-text">
          {correction.corrected}
        </p>
        {expanded ? (
          <div className="mt-4 border-t border-border-subtle pt-4 text-sm leading-relaxed text-text-secondary">
            <p>{correction.explanation}</p>
            {correction.example ? (
              <p className="mt-2 text-text-muted">例：{correction.example}</p>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-xs text-text-muted">点一下看说明</p>
        )}
      </Card>
    </button>
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

  return (
    <section className="animate-fade-up space-y-8 py-2">
      <header className="border-l-4 border-accent pl-4">
        <p className="text-xs tracking-wide text-text-muted">Session Review</p>
        <h2 className="font-display mt-2 text-[1.75rem] tracking-tight text-text">本次复盘</h2>
        <p className="mt-2 text-sm text-text-muted">
          这次对话大约是
          <span className="mx-1 font-medium text-text-secondary">
            {USER_LEVEL_LABEL[report.userLevel]}
          </span>
          水平
        </p>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="时长" value={formatDuration(report.durationSeconds)} />
        <StatCard label="词数" value={wordCount != null ? String(wordCount) : "—"} />
        <StatCard label="句数" value={sentenceCount != null ? String(sentenceCount) : "—"} />
      </div>

      {taskGoals && taskGoals.length > 0 ? (
        <TaskResultsSection report={report} taskGoals={taskGoals} />
      ) : null}

      {topCorrection ? (
        <Card variant="inset" className="border-l-4 border-l-accent p-5">
          <p className="text-xs tracking-wide text-accent">Most useful edit</p>
          <p className="mt-3 text-sm text-text-muted line-through decoration-accent-muted/70">
            {topCorrection.original}
          </p>
          <p className="font-display mt-2 text-xl text-text">
            {topCorrection.corrected}
          </p>
        </Card>
      ) : null}

      {grouped.length > 0 ? (
        <div className="space-y-8">
          {grouped.map((section) => (
            <div key={section.type}>
              <h3 className="flex items-center gap-1.5 text-base font-medium text-text-secondary">
                <section.meta.Icon className="h-4 w-4 text-accent" />
                {section.meta.label}
              </h3>
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
