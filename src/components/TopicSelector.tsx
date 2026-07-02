import type { TopicOption } from "../types";

export interface TopicSelectorProps {
  topics: TopicOption[];
  onSelectTopic: (topicId: string) => void;
  onFreeTalk: () => void;
}

const TOPIC_EMOJI: Record<string, string> = {
  travel: "🧳",
  food: "🍜",
  work: "💼",
  movie: "🎬",
  daily: "🌤️",
};

export function TopicSelector({ topics, onSelectTopic, onFreeTalk }: TopicSelectorProps) {
  return (
    <section className="py-6">
      <h2 className="text-xl font-medium text-[#3D3D3D]">今天想聊点什么？</h2>
      <p className="mt-1 text-sm text-[#A89B8C]">挑一个话题，或者随便聊聊都行</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {topics.map((topic) => (
          <button
            key={topic.id}
            type="button"
            onClick={() => onSelectTopic(topic.id)}
            className="rounded-3xl bg-[#FFF9F3] p-5 text-left shadow-md transition-transform hover:scale-[1.03] hover:shadow-lg active:scale-[0.99]"
          >
            <span className="text-2xl">{TOPIC_EMOJI[topic.id] ?? "💬"}</span>
            <h3 className="mt-3 text-base font-medium text-[#3D3D3D]">{topic.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-[#A89B8C]">{topic.description}</p>
          </button>
        ))}
      </div>

      <div className="mt-6 flex justify-center">
        <button
          type="button"
          onClick={onFreeTalk}
          className="rounded-full bg-[#7C6B5D] px-8 py-3 text-sm font-medium text-[#FAF8F3] shadow-md transition-transform hover:scale-105 active:scale-95"
        >
          不挑了，聊一会儿英语吧
        </button>
      </div>
    </section>
  );
}
