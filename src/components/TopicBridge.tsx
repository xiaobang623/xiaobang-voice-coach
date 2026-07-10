import type { TopicOption } from "../types";
import { TOPIC_TAG } from "../config/topics";
import { Mascot, type MascotExpression } from "./ui/Mascot";

export function CoachOpeningBubble({
  text,
  tag,
  expression = "idle",
}: {
  text: string;
  tag?: { label: string; tint: string };
  expression?: MascotExpression;
}) {
  return (
    <li className="flex w-full items-end gap-2.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft ring-2 ring-surface">
        <Mascot expression={expression} size={34} bob={false} />
      </div>
      <div className="min-w-[5.5rem] w-full max-w-[88%]">
        {tag ? (
          <span
            className={`mb-1.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${tag.tint}`}
          >
            {tag.label}
          </span>
        ) : null}
        <div className="w-full rounded-[18px] rounded-bl-md border border-border-subtle bg-surface-raised px-4 py-3 shadow-card">
          <p className="break-words text-[15px] leading-relaxed text-text">{text}</p>
        </div>
      </div>
    </li>
  );
}

export function TopicBridge({
  topic,
  expression = "idle",
}: {
  topic: TopicOption;
  expression?: MascotExpression;
}) {
  const tag = TOPIC_TAG[topic.id];
  return (
    <CoachOpeningBubble
      text={topic.openingHint ?? topic.description}
      tag={tag}
      expression={expression}
    />
  );
}
