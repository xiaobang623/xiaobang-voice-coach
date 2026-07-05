import { useState } from "react";
import type { Correction, CorrectionType, ReportJSON, UserLevel } from "../types";
import { Badge } from "./ui/Badge";
import { Card } from "./ui/Card";

export interface ReportViewProps {
  report: ReportJSON | null;
  wordCount?: number;
  sentenceCount?: number;
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
  { label: string; emoji: string; description: string }
> = {
  grammar: { label: "语法", emoji: "📝", description: "时态、搭配、冠词等语法问题" },
  collocation: { label: "搭配", emoji: "🔗", description: "词语组合不够地道" },
  vocabulary: { label: "用词", emoji: "📚", description: "可以选更准确的词" },
  naturalness: { label: "地道表达", emoji: "🌟", description: "语法没错，但母语者会换种说法" },
  structure: { label: "句式结构", emoji: "🏗️", description: "句子组织和衔接可以更好" },
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card variant="ghost" className="p-4 text-center">
      <p className="text-2xl font-medium text-text">{value}</p>
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
        <p className="mt-2 text-lg font-medium leading-snug text-text">
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

export function ReportView({ report, wordCount, sentenceCount }: ReportViewProps) {
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
        <p className="text-xs text-text-muted">本次复盘</p>
        <h2 className="mt-2 text-2xl font-medium text-text">今天聊得不错</h2>
        <p className="mt-2 text-sm text-text-muted">
          这次对话大概是
          <span className="mx-1 font-medium text-text-secondary">
            {USER_LEVEL_LABEL[report.userLevel]}
          </span>
          水平
        </p>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="聊天时长" value={formatDuration(report.durationSeconds)} />
        <StatCard label="说了多少词" value={wordCount != null ? String(wordCount) : "—"} />
        <StatCard label="说了几句话" value={sentenceCount != null ? String(sentenceCount) : "—"} />
      </div>

      {topCorrection ? (
        <Card variant="inset" className="border-l-4 border-l-accent p-5">
          <p className="text-xs text-accent">今日最值得改</p>
          <p className="mt-3 text-sm text-text-muted line-through decoration-accent-muted/70">
            {topCorrection.original}
          </p>
          <p className="mt-2 text-xl font-medium text-text">
            {topCorrection.corrected}
          </p>
        </Card>
      ) : null}

      {grouped.length > 0 ? (
        <div className="space-y-8">
          {grouped.map((section) => (
            <div key={section.type}>
              <h3 className="text-base font-medium text-text-secondary">
                {section.meta.emoji} {section.meta.label}
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
          这次没什么要改的，说得挺自然的
        </Card>
      )}
    </section>
  );
}
