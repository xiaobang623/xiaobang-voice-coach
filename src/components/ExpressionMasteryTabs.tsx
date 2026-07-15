import { useMemo, useState } from "react";
import type { TrackedExpression } from "../types";
import {
  groupTrackedExpressionsByStatus,
  MASTERY_TABS,
  type MasteryStatus,
} from "../core/trackedExpressionMastery";
import { Card } from "./ui/Card";

export interface ExpressionMasteryTabsProps {
  trackedExpressions: TrackedExpression[];
}

function shouldShowOriginal(expression: TrackedExpression): boolean {
  const original = expression.originalText.trim();
  return Boolean(original) && original !== expression.targetText.trim();
}

export function ExpressionMasteryTabs({ trackedExpressions }: ExpressionMasteryTabsProps) {
  const [activeStatus, setActiveStatus] = useState<MasteryStatus>("unmastered");
  const groups = useMemo(
    () => groupTrackedExpressionsByStatus(trackedExpressions),
    [trackedExpressions],
  );
  const activeTab = MASTERY_TABS.find((tab) => tab.status === activeStatus) ?? MASTERY_TABS[0];
  const activeItems = groups[activeTab.status];

  return (
    <Card variant="default" className="p-0">
      <div className="px-4 pt-4">
        <div className="grid grid-cols-3 rounded-full bg-bg-warm p-[3px]">
          {MASTERY_TABS.map((tab) => {
            const selected = tab.status === activeTab.status;
            return (
              <button
                key={tab.status}
                type="button"
                onClick={() => setActiveStatus(tab.status)}
                className={`rounded-full px-3 py-2 text-[12.5px] font-semibold tracking-tight transition-all duration-[160ms] ${
                  selected
                    ? "bg-accent text-surface shadow-card"
                    : "bg-transparent text-ink-faint hover:text-text"
                }`}
                aria-pressed={selected}
              >
                {tab.label} {groups[tab.status].length}
              </button>
            );
          })}
        </div>
      </div>

      {activeItems.length > 0 ? (
        <div className="mt-3 divide-y divide-border">
          {activeItems.map((expression) => (
            <div
              key={expression.id}
              className="flex items-center justify-between gap-4 px-5 py-3.5"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-bold leading-snug tracking-tight text-text">
                  {expression.targetText}
                </div>
                {shouldShowOriginal(expression) ? (
                  <div className="mt-1 text-[11.5px] leading-snug text-ink-faint">
                    你上次说的：{expression.originalText.trim()}
                  </div>
                ) : null}
              </div>
              {activeTab.status === "reviewing" ? (
                <div className="shrink-0 text-[12px] font-semibold text-ink-faint">
                  {expression.reuseCount} / 2 次
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="px-5 py-8 text-center text-[13px] text-ink-faint">
          {activeTab.emptyText}
        </div>
      )}
    </Card>
  );
}
