import { CHAT_TOPICS } from "./chatTopics";
import { TASK_SCENARIOS } from "./taskScenarios";
import { BriefcaseIcon, PlaneIcon, SunIcon, UtensilsIcon } from "../components/ui/icons";

/** OpenDesign premium palette: scenario icons are uniformly neutral
 *  (redesign/styles.css .scenario-icon — bg surface-muted, color ink-soft). */
export const TOPIC_TAG: Record<string, { label: string; tint: string }> = {
  daily: { label: "日常", tint: "bg-surface-muted text-ink-soft" },
  travel: { label: "旅行", tint: "bg-surface-muted text-ink-soft" },
  food: { label: "美食", tint: "bg-surface-muted text-ink-soft" },
  work: { label: "工作", tint: "bg-surface-muted text-ink-soft" },
};

export const TOPIC_ICON: Record<string, typeof SunIcon> = {
  daily: SunIcon,
  travel: PlaneIcon,
  food: UtensilsIcon,
  work: BriefcaseIcon,
};

export const TASK_CATEGORY_TAG: Record<
  "life" | "work",
  { label: string; tint: string }
> = {
  // Muted teal/gold chips from the OpenDesign premium palette
  life: { label: "生活类", tint: "bg-[#DCEAE8] text-[#3F6E6B]" },
  work: { label: "职场类", tint: "bg-[#EFE6D2] text-[#A6813F]" },
};

/** Unified lookup for chat topics and task scenarios (growth page, session label). */
export const SCENARIO_LABELS: Record<string, string> = Object.fromEntries([
  ...CHAT_TOPICS.map((t) => [t.id, t.title] as const),
  ...TASK_SCENARIOS.map((t) => [t.id, t.title] as const),
]);

export function scenarioLabel(id: string | null): string {
  if (!id) {
    return "自由畅聊";
  }
  return SCENARIO_LABELS[id] ?? id;
}
