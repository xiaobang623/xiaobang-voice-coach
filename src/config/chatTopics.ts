import type { TalkDirection, TopicOption } from "../types";

/** Free-talk direction pool: rough angles the user can pick from when no topic is chosen. */
export const FREE_TALK_DIRECTIONS: TalkDirection[] = [
  { zh: "今天发生的一件小事", en: "something small that happened today" },
  { zh: "最近让你开心的事", en: "something that made you happy lately" },
  { zh: "最近有点烦的事", en: "something that's been bothering you" },
  { zh: "这周末想干嘛", en: "your weekend plans" },
  { zh: "最近在看 / 在玩的东西", en: "a show, game or book you're into" },
  { zh: "一个最近的小目标", en: "a small goal you're working on" },
  { zh: "随便吐槽两句", en: "anything you feel like complaining about" },
  { zh: "此刻的心情", en: "how you're feeling right now" },
];

/**
 * Pick `count` random directions from a pool.
 * Pass `exclude` (currently shown ones) to re-roll without repeats when the pool is big enough.
 */
export function pickDirections(
  pool: TalkDirection[],
  count: number,
  exclude: TalkDirection[] = [],
): TalkDirection[] {
  const excludeSet = new Set(exclude.map((d) => d.zh));
  const rest = pool.filter((d) => !excludeSet.has(d.zh));
  const candidates = rest.length >= count ? rest : pool;
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

export const CHAT_TOPICS: TopicOption[] = [
  {
    id: "daily",
    title: "今天过得怎么样",
    description: "从日常小事聊起，最放松的开场",
    openingHint: "跟小榜聊聊今天过得怎么样，先开口说一句就行",
    greeting: "Hey, good to see you! How has your day been so far?",
    directions: [
      { zh: "今天最顺利的一件事", en: "the best part of your day" },
      { zh: "今天有点糟心的瞬间", en: "something annoying today" },
      { zh: "今天吃了什么", en: "what you ate today" },
      { zh: "今天忙不忙", en: "how busy today was" },
      { zh: "今天和谁聊了天", en: "someone you talked to today" },
      { zh: "今晚打算怎么放松", en: "your plan for tonight" },
      { zh: "今天注意到的一件小事", en: "something new you noticed" },
      { zh: "用一个词形容今天", en: "one word for today" },
    ],
    promptSeed:
      "start by asking the user how their day has been and gently keep the small talk going.",
  },
  {
    id: "travel",
    title: "想去的地方",
    description: "聊聊旅行计划，或者印象最深的一次出行",
    openingHint: "跟小榜聊聊你想去哪、或最难忘的一次旅行",
    greeting: "Hi there! So, where would you love to travel to next?",
    directions: [
      { zh: "下一个最想去的地方", en: "the next place you want to visit" },
      { zh: "印象最深的一次旅行", en: "your most memorable trip" },
      { zh: "旅行踩过的坑", en: "a travel fail you had" },
      { zh: "海边还是山里", en: "beach or mountains" },
      { zh: "一个人还是结伴旅行", en: "traveling alone or with friends" },
      { zh: "旅行必带的东西", en: "things you always pack" },
      { zh: "吃过最好吃的当地菜", en: "the best local food you tried" },
      { zh: "理想的周末短途", en: "an ideal weekend getaway" },
    ],
    promptSeed:
      "start by asking where the user would love to travel next, or their most memorable trip.",
  },
  {
    id: "food",
    title: "吃点什么好",
    description: "推荐一家店、一道菜，或者自己做饭的故事",
    openingHint: "跟小榜聊聊你爱吃什么、常去哪家店，或会不会做饭",
    greeting: "Hey! What have you been eating lately — anything good?",
    directions: [
      { zh: "最近吃过最好吃的一顿", en: "the best meal you had recently" },
      { zh: "常点的外卖", en: "your go-to takeout" },
      { zh: "想推荐的一家店", en: "a restaurant you'd recommend" },
      { zh: "自己做饭的经历", en: "your cooking experience" },
      { zh: "从小吃到大的味道", en: "a dish from your childhood" },
      { zh: "甜党还是咸党", en: "sweet or savory" },
      { zh: "一直想尝试的菜", en: "a food you've been wanting to try" },
      { zh: "深夜最想吃的东西", en: "your late-night craving" },
    ],
    promptSeed:
      "start by asking the user about food they love — a favorite dish, restaurant, or cooking they do.",
  },
  {
    id: "work",
    title: "工作与生活",
    description: "最近在忙什么，有什么想吐槽或分享的",
    openingHint: "跟小榜聊聊最近在忙什么、工作节奏怎么样",
    greeting: "Hi! What have you been up to at work lately?",
    directions: [
      { zh: "最近在忙的项目", en: "a project you're working on" },
      { zh: "今天开的会", en: "a meeting you had today" },
      { zh: "想吐槽的工作瞬间", en: "something to vent about" },
      { zh: "工作里学到的新东西", en: "something new you learned" },
      { zh: "和同事的相处", en: "working with your teammates" },
      { zh: "理想的工作节奏", en: "your ideal work-life balance" },
      { zh: "最近的小成就", en: "a small win at work" },
      { zh: "下份工作想做什么", en: "what you'd want in your next job" },
    ],
    promptSeed:
      "start by asking what the user has been busy with at work lately and how they feel about it.",
  },
];
