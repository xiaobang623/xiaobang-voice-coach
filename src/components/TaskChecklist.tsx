import { useState } from "react";
import type { TaskGoal } from "../types";
import { Card } from "./ui/Card";
import { TargetIcon } from "./ui/icons";

function ChevronIcon({ className, open }: { className?: string; open: boolean }) {
  return (
    <svg
      className={`${className ?? ""} transition-transform ${open ? "rotate-180" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export interface TaskChecklistProps {
  goals: TaskGoal[];
  title: string;
}

/** Static reminder of task goals during conversation — no real-time checkmarks. */
export function TaskChecklist({ goals, title }: TaskChecklistProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Card variant="ghost" className="relative z-10 mx-4 mt-3 border border-border-subtle/80 bg-surface/90 p-0">
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left"
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate text-xs font-medium text-text-secondary">
          <TargetIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
          {title}
        </span>
        <ChevronIcon className="h-4 w-4 shrink-0 text-text-muted" open={!collapsed} />
      </button>
      {!collapsed ? (
        <ol className="space-y-1.5 border-t border-border-subtle/60 px-3.5 py-2.5">
          {goals.map((goal, index) => (
            <li key={goal.id} className="flex items-start gap-2 text-xs text-text-muted">
              <span className="mt-0.5 shrink-0 text-text-muted/70">{index + 1}.</span>
              <span className="leading-relaxed">{goal.desc}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </Card>
  );
}
