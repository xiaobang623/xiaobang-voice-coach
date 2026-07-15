import type { TrackedExpression, TrackedExpressionStatus } from "../types";

export const MASTERY_TABS = [
  {
    status: "unmastered",
    label: "未掌握",
    emptyText: "太棒了，暂时没有未掌握的表达",
  },
  {
    status: "reviewing",
    label: "复习中",
    emptyText: "还没有正在复习的表达，用上一次学过的说法就会出现在这里",
  },
  {
    status: "mastered",
    label: "已掌握",
    emptyText: "还没有已掌握的表达，继续聊，说对两次就会出现在这里",
  },
] as const satisfies ReadonlyArray<{
  status: TrackedExpressionStatus;
  label: string;
  emptyText: string;
}>;

export type MasteryStatus = (typeof MASTERY_TABS)[number]["status"];

export type TrackedExpressionGroups = Record<MasteryStatus, TrackedExpression[]>;

function lastSeenTime(expression: TrackedExpression): number {
  const time = new Date(expression.lastSeenAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function sortTrackedExpressionsByLastSeen(
  expressions: TrackedExpression[],
): TrackedExpression[] {
  return [...expressions].sort((left, right) => {
    const diff = lastSeenTime(right) - lastSeenTime(left);
    if (diff !== 0) {
      return diff;
    }
    return left.targetText.localeCompare(right.targetText);
  });
}

export function groupTrackedExpressionsByStatus(
  expressions: TrackedExpression[],
): TrackedExpressionGroups {
  const groups: TrackedExpressionGroups = {
    unmastered: [],
    reviewing: [],
    mastered: [],
  };

  for (const expression of expressions) {
    if (expression.status in groups) {
      groups[expression.status].push(expression);
    }
  }

  return {
    unmastered: sortTrackedExpressionsByLastSeen(groups.unmastered),
    reviewing: sortTrackedExpressionsByLastSeen(groups.reviewing),
    mastered: sortTrackedExpressionsByLastSeen(groups.mastered),
  };
}
