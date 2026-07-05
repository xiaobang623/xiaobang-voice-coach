import type { TopicOption } from "../types";
import { TOPIC_TAG } from "../config/topics";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

export interface TopicSelectorProps {
  topics: TopicOption[];
  onSelectTopic: (topicId: string) => void;
  onFreeTalk: () => void;
}

export function TopicSelector({ topics, onSelectTopic, onFreeTalk }: TopicSelectorProps) {
  return (
    <section className="animate-fade-up py-4">
      <header className="mb-6">
        <h2 className="text-xl font-semibold text-text">今天想聊点什么？</h2>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">
          挑一个话题轻松开场，或者直接自由畅聊
        </p>
      </header>

      <div className="grid grid-cols-2 items-start gap-3">
        {topics.map((topic, index) => {
          const tag = TOPIC_TAG[topic.id];
          return (
            <button
              key={topic.id}
              type="button"
              onClick={() => onSelectTopic(topic.id)}
              className="group w-full text-left"
              style={{ animationDelay: `${index * 60}ms` }}
            >
              <Card
                variant="elevated"
                className="p-3.5 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-elevated group-active:scale-[0.99]"
              >
                {tag ? (
                  <span
                    className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[11px] font-medium ${tag.tint}`}
                  >
                    {tag.label}
                  </span>
                ) : null}
                <h3 className="mt-2 text-sm font-semibold leading-snug text-text">{topic.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">{topic.description}</p>
              </Card>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex w-full flex-col items-center gap-2">
        <Button variant="primary" size="lg" fullWidth onClick={onFreeTalk}>
          不挑了，直接开聊
        </Button>
        <p className="text-center text-xs text-text-muted">没有固定话题，想到什么说什么</p>
      </div>
    </section>
  );
}
