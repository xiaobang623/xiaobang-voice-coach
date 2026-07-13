import type { TaskScenario } from "../types";

/** First slice: cafe + interview. Remaining 4 scenarios added after validation. */
export const TASK_SCENARIOS: TaskScenario[] = [
  {
    id: "cafe",
    mode: "task",
    category: "life",
    title: "点一杯咖啡",
    description: "在咖啡店完成点单全流程",
    openingHint: "你先开口点单，小榜会进入咖啡店店员的角色跟你演",
    greeting: "Hi there, welcome in! What would you like to order today?",
    directions: [
      { zh: "打个招呼，点你想喝的", en: "Hi, can I get..." },
      { zh: "问店员今天推荐什么", en: "What do you recommend?" },
      { zh: "先要一份菜单看看", en: "Could I see the menu?" },
      { zh: "问有没有无咖啡因的", en: "anything decaf?" },
      { zh: "问今天有没有特价", en: "any specials today?" },
      { zh: "犹豫一下，让店员帮你选", en: "I can't decide..." },
    ],
    roleSetup:
      "You are a friendly café barista. The user is a customer who just walked up to order a drink. Greet them naturally and stay in character as a barista throughout.",
    goals: [
      {
        id: "cafe-price",
        desc: "问到价格",
        coachHint:
          "naturally lead the conversation so the user asks about the price of a drink",
      },
      {
        id: "cafe-custom",
        desc: "提出一个定制要求（如少糖/换燕麦奶）",
        coachHint:
          "wait for the user to request a customization such as less sugar, oat milk, or size change",
      },
      {
        id: "cafe-close",
        desc: "礼貌收尾",
        coachHint:
          "let the user close the order with a polite thank-you or goodbye before wrapping up",
      },
    ],
  },
  {
    id: "interview",
    mode: "task",
    category: "work",
    title: "AI PM 英文面试",
    description: "模拟求职面试，练 STAR 和追问应对",
    openingHint: "你先开口打招呼，小榜会进入面试官的角色跟你演",
    greeting: "Hi, nice to meet you. Could you start by introducing yourself?",
    directions: [
      { zh: "打招呼，做个简短自我介绍", en: "Hi, nice to meet you. I'm..." },
      { zh: "问要不要先讲自己的背景", en: "should I start with my background?" },
      { zh: "说说你为什么想做这个岗位", en: "the reason I'm interested in this role..." },
      { zh: "简单聊聊你现在的工作", en: "in my current role, I..." },
      { zh: "表达一下面试的心情", en: "I'm excited to be here" },
      { zh: "用一句话概括你自己", en: "in one sentence, I'm..." },
    ],
    roleSetup:
      "You are an interviewer for an AI Product Manager role at a tech company. Conduct a realistic job interview in English. Stay in character as the interviewer throughout.",
    goals: [
      {
        id: "interview-star",
        desc: "用 STAR 法讲一个项目案例",
        coachHint:
          "prompt the user to describe a project using STAR (Situation, Task, Action, Result) structure",
      },
      {
        id: "interview-question",
        desc: "主动问一个团队/技术栈相关问题",
        coachHint:
          "create an opening for the user to ask you a thoughtful question about the team or tech stack",
      },
      {
        id: "interview-pushback",
        desc: "回应一个追问式压力问题",
        coachHint:
          "ask a follow-up pressure question about their answer and let them respond substantively",
      },
    ],
  },
];

export function findTaskScenario(id: string): TaskScenario | undefined {
  return TASK_SCENARIOS.find((s) => s.id === id);
}

export function isTaskScenarioId(id: string): boolean {
  return TASK_SCENARIOS.some((s) => s.id === id);
}
