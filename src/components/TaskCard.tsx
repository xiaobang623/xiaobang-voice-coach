import type { TaskScenario } from "../types";
import { TASK_CATEGORY_TAG } from "../config/topics";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { TargetIcon } from "./ui/icons";

export interface TaskCardProps {
  scenario: TaskScenario;
  onStart: () => void;
}

export function TaskCard({ scenario, onStart }: TaskCardProps) {
  const tag = TASK_CATEGORY_TAG[scenario.category];

  return (
    <Card
      variant="ghost"
      className="animate-fade-up border border-accent-soft/80 bg-surface-raised/80 p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tag.tint}`}>
          {tag.label}
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-text-muted">
          <TargetIcon className="h-3.5 w-3.5" />
          {scenario.goals.length} 个目标
        </span>
      </div>
      <p className="font-display mt-3 text-lg font-medium text-text">{scenario.title}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{scenario.description}</p>

      <ol className="mt-5 space-y-3">
        {scenario.goals.map((goal, index) => (
          <li key={goal.id} className="flex items-start gap-3 text-sm text-text-secondary">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
              {index + 1}
            </span>
            <span className="leading-relaxed">{goal.desc}</span>
          </li>
        ))}
      </ol>

      {scenario.openingHint ? (
        <p className="mt-5 rounded-xl bg-bg-warm/60 px-3.5 py-2.5 text-xs leading-relaxed text-text-secondary">
          {scenario.openingHint}
        </p>
      ) : null}

      <Button variant="primary" size="md" fullWidth className="mt-5" onClick={onStart}>
        开始闯关
      </Button>
    </Card>
  );
}
