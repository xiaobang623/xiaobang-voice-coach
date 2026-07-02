import { useState } from "react";
import type { Correction, CorrectionType, ReportJSON, UserLevel } from "../types";

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
    <div className="rounded-3xl bg-[#F5F1ED] p-5 text-center shadow-sm">
      <p className="text-2xl font-semibold text-[#3D3D3D]">{value}</p>
      <p className="mt-1 text-xs text-[#A89B8C]">{label}</p>
    </div>
  );
}

function CorrectionCard({ correction }: { correction: Correction }) {
  const [expanded, setExpanded] = useState(false);
  const severity = correction.severity ?? "important";

  return (
    <button
      type="button"
      onClick={() => setExpanded((value) => !value)}
      className="w-full rounded-3xl bg-[#F5F1ED] p-5 text-left shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[#E8D5C4] px-2.5 py-0.5 text-xs text-[#7C6B5D]">
          {SEVERITY_LABEL[severity]}
        </span>
        {(correction.frequency ?? 1) > 1 ? (
          <span className="text-xs text-[#A89B8C]">出现了 {correction.frequency} 次</span>
        ) : null}
      </div>
      <p className="mt-3 text-sm text-[#8A7B6A] line-through decoration-[#C4998A]/60">
        <span className="mr-1.5">❌</span>
        {correction.original}
      </p>
      <p className="mt-1.5 text-[15px] font-medium text-[#3D3D3D]">
        <span className="mr-1.5">✅</span>
        {correction.corrected}
      </p>
      {expanded ? (
        <div className="mt-3 border-t border-[#E8D5C4] pt-3 text-sm leading-relaxed text-[#7C6B5D]">
          <p>{correction.explanation}</p>
          {correction.example ? (
            <p className="mt-2 text-[#A89B8C]">例：{correction.example}</p>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-[#B5A997]">点一下看说明</p>
      )}
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

  return (
    <section className="space-y-8 py-6">
      <header>
        <h2 className="text-xl font-medium text-[#3D3D3D]">今天聊得不错 ☕</h2>
        <p className="mt-1 text-sm text-[#A89B8C]">
          这次对话大概是
          <span className="mx-1 font-medium text-[#7C6B5D]">
            {USER_LEVEL_LABEL[report.userLevel]}
          </span>
          水平，下面是可以提升的地方
        </p>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="聊天时长" value={formatDuration(report.durationSeconds)} />
        <StatCard label="说了多少词" value={wordCount != null ? String(wordCount) : "—"} />
        <StatCard label="说了几句话" value={sentenceCount != null ? String(sentenceCount) : "—"} />
      </div>

      {grouped.length > 0 ? (
        <div className="space-y-6">
          {grouped.map((section) => (
            <div key={section.type}>
              <h3 className="text-base font-medium text-[#7C6B5D]">
                {section.meta.emoji} {section.meta.label}
              </h3>
              <p className="mt-0.5 text-xs text-[#A89B8C]">{section.meta.description}</p>
              <ul className="mt-3 space-y-3">
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
        <p className="rounded-3xl bg-[#F5F1ED] p-5 text-center text-sm text-[#A89B8C] shadow-sm">
          这次没什么要改的，说得挺自然的 🎉
        </p>
      )}
    </section>
  );
}
