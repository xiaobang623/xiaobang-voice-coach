import { useState } from "react";
import {
  getCefrLevel,
  getLevelContext,
  getLevelIndex,
  LEVEL_SYSTEM,
} from "../config/levels";
import type { CefrLevel } from "../config/levels";
import type { UserLevel } from "../types";
import { Card } from "./ui/Card";

function formatLevelList(levels: typeof LEVEL_SYSTEM): string {
  if (levels.length === 0) {
    return "没有更前面的等级";
  }
  return levels.map((level) => `${level.code} ${level.shortLabel}`).join("、");
}

export function LevelPath({
  level,
  className = "",
}: {
  level: CefrLevel;
  className?: string;
}) {
  const currentIndex = getLevelIndex(level);

  return (
    <div className={`relative ${className}`} aria-label={`当前等级是 ${level}`}>
      <div className="absolute left-[7%] right-[7%] top-[18px] h-px bg-border" aria-hidden="true" />
      <div className="relative grid grid-cols-6 gap-1">
        {LEVEL_SYSTEM.map((item, index) => {
          const isCurrent = index === currentIndex;
          const isBefore = index < currentIndex;
          return (
            <div key={item.code} className="flex flex-col items-center text-center">
              <div
                className={[
                  "flex h-9 w-9 items-center justify-center rounded-full border text-[12px] font-bold transition-colors",
                  isCurrent
                    ? "border-text bg-text text-bg shadow-card"
                    : isBefore
                      ? "border-border-strong bg-surface-muted text-text-secondary"
                      : "border-border bg-surface text-text-muted",
                ].join(" ")}
                aria-current={isCurrent ? "step" : undefined}
              >
                {item.code}
              </div>
              <div
                className={[
                  "mt-2 text-[11px] font-semibold",
                  isCurrent ? "text-text" : "text-text-muted",
                ].join(" ")}
              >
                {item.shortLabel}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function LevelSystemCard({
  userLevel,
  title = "等级路径",
  note,
  defaultExpanded = false,
  className = "",
}: {
  userLevel: UserLevel | null | undefined;
  title?: string;
  note?: string;
  defaultExpanded?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const level = getCefrLevel(userLevel);
  const { current, previous, next } = getLevelContext(level);
  const nextLevel = next[0] ?? null;

  return (
    <Card variant="default" className={`p-5 ${className}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="section-title !mb-0">{title}</div>
          <p className="mt-2 text-[13px] leading-[1.6] text-text-secondary">
            当前是 <strong className="font-semibold text-text">{current.code} {current.shortLabel}</strong>：
            {current.ability}
          </p>
          <p className="mt-1 text-[13px] leading-[1.6] text-text-muted">
            下一步：{nextLevel ? `向 ${nextLevel.code} ${nextLevel.shortLabel} 迈进，${current.nextFocus}` : current.nextFocus}
          </p>
        </div>
        {note ? (
          <div className="shrink-0 rounded-full bg-surface-muted px-3 py-1 text-[11.5px] font-semibold text-text-muted">
            {note}
          </div>
        ) : null}
      </div>

      <LevelPath level={level} className="mt-5" />

      <div className="mt-5 grid gap-2 text-[12.5px] leading-[1.55] sm:grid-cols-2">
        <div className="rounded-[14px] bg-surface-muted px-3.5 py-3 text-text-secondary">
          <span className="font-semibold text-text">之前：</span>
          {previous.length > 0 ? formatLevelList(previous) : "已经是第一个等级"}
        </div>
        <div className="rounded-[14px] bg-surface-muted px-3.5 py-3 text-text-secondary">
          <span className="font-semibold text-text">之后：</span>
          {next.length > 0 ? formatLevelList(next) : "已经到达最高等级"}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-text"
        aria-expanded={expanded}
      >
        {expanded ? "收起全部等级说明" : "查看全部等级说明"}
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {expanded ? (
        <div className="mt-4 overflow-hidden rounded-[16px] border border-border">
          {LEVEL_SYSTEM.map((item) => {
            const isCurrent = item.code === current.code;
            return (
              <div
                key={item.code}
                className={[
                  "border-b border-border-subtle px-4 py-3 last:border-b-0",
                  isCurrent ? "bg-spark-soft/45" : "bg-surface",
                ].join(" ")}
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-[15px] font-bold text-text">{item.code}</span>
                  <span className="text-[13px] font-semibold text-text-secondary">{item.shortLabel}</span>
                  {isCurrent ? (
                    <span className="rounded-full bg-text px-2 py-0.5 text-[10.5px] font-semibold text-bg">
                      当前
                    </span>
                  ) : null}
                </div>
                <p className="mt-1.5 text-[12.5px] leading-[1.6] text-text-secondary">{item.ability}</p>
                <p className="mt-1 text-[12px] leading-[1.6] text-text-muted">{item.typical}</p>
              </div>
            );
          })}
        </div>
      ) : null}
    </Card>
  );
}
