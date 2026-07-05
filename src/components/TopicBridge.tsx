import type { TopicOption } from "../types";
import { TOPIC_TAG } from "../config/topics";
import { Card } from "./ui/Card";

export function TopicBridge({ topic }: { topic: TopicOption }) {
  const tag = TOPIC_TAG[topic.id];

  return (
    <Card
      variant="ghost"
      className="animate-fade-up mx-4 mt-4 border border-accent-soft/80 bg-surface-raised/80 p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        {tag ? (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tag.tint}`}>
            {tag.label}
          </span>
        ) : null}
        <span className="text-xs text-text-muted">已选好话题</span>
      </div>
      <p className="mt-2 text-base font-medium text-text">{topic.title}</p>
      <p className="mt-1 text-sm leading-relaxed text-text-muted">{topic.description}</p>
      {topic.openingHint ? (
        <p className="mt-3 rounded-xl bg-bg-warm/60 px-3 py-2 text-xs leading-relaxed text-text-secondary">
          {topic.openingHint}
        </p>
      ) : null}
    </Card>
  );
}
