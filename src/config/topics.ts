import { CHAT_TOPICS } from "./chatTopics";
import { TASK_SCENARIOS } from "./taskScenarios";
import { BriefcaseIcon, PlaneIcon, SunIcon, UtensilsIcon } from "../components/ui/icons";

/** Curated pastel tag colors — a small deliberate palette (not random Tailwind hues)
 *  so topic cards read as lively/distinct without clashing with the coral/mint brand. */
export const TOPIC_TAG: Record<string, { label: string; tint: string }> = {
  daily: { label: "日常", tint: "bg-[#FFE1D2] text-[#C24A22]" },
  travel: { label: "旅行", tint: "bg-[#D7F0FF] text-[#1F6FA6]" },
  food: { label: "美食", tint: "bg-[#FFEFB8] text-[#8A6A0F]" },
  work: { label: "工作", tint: "bg-[#CFF5EE] text-[#0E8A79]" },
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
  life: { label: "生活类", tint: "bg-[#D7F0FF] text-[#1F6FA6]" },
  work: { label: "职场类", tint: "bg-[#CFF5EE] text-[#0E8A79]" },
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
