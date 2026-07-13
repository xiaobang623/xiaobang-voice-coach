import type { TopicOption } from "../types";

export const CHAT_TOPICS: TopicOption[] = [
  {
    id: "daily",
    title: "今天过得怎么样",
    description: "从日常小事聊起，最放松的开场",
    openingHint: "小榜会先问你今天过得怎么样，比如 How has your day been?",
    greeting: "Hey, good to see you! How has your day been so far?",
    promptSeed:
      "start by asking the user how their day has been and gently keep the small talk going.",
  },
  {
    id: "travel",
    title: "想去的地方",
    description: "聊聊旅行计划，或者印象最深的一次出行",
    openingHint: "小榜会问你下次想去哪，或者最难忘的一次旅行",
    greeting: "Hi there! So, where would you love to travel to next?",
    promptSeed:
      "start by asking where the user would love to travel next, or their most memorable trip.",
  },
  {
    id: "food",
    title: "吃点什么好",
    description: "推荐一家店、一道菜，或者自己做饭的故事",
    openingHint: "小榜会问你最爱吃什么、常去哪家店，或者会不会自己做饭",
    greeting: "Hey! What have you been eating lately — anything good?",
    promptSeed:
      "start by asking the user about food they love — a favorite dish, restaurant, or cooking they do.",
  },
  {
    id: "work",
    title: "工作与生活",
    description: "最近在忙什么，有什么想吐槽或分享的",
    openingHint: "小榜会问你最近在忙什么、工作节奏怎么样",
    greeting: "Hi! What have you been up to at work lately?",
    promptSeed:
      "start by asking what the user has been busy with at work lately and how they feel about it.",
  },
];
