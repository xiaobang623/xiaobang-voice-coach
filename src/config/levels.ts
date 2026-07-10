import type { UserLevel } from "../types";

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export interface LevelInfo {
  code: CefrLevel;
  shortLabel: string;
  ability: string;
  typical: string;
  nextFocus: string;
}

export const LEVEL_SYSTEM: LevelInfo[] = [
  {
    code: "A1",
    shortLabel: "入门",
    ability: "能说非常基础的单词、短句和固定表达。",
    typical: "需要对方放慢语速；常用 yes/no、I like...、I want... 回答。",
    nextFocus: "建立高频句型和开口安全感。",
  },
  {
    code: "A2",
    shortLabel: "基础",
    ability: "能处理熟悉场景里的简单交流。",
    typical: "能聊自我介绍、日常安排、点餐、购物；句子较短，连接少。",
    nextFocus: "扩充常用动词、时态和场景表达。",
  },
  {
    code: "B1",
    shortLabel: "初级",
    ability: "能围绕熟悉话题连续表达基本想法。",
    typical: "能说明经历、计划、原因；会卡壳但能靠简单词绕过去。",
    nextFocus: "提升句子完整度和基础语法稳定性。",
  },
  {
    code: "B2",
    shortLabel: "中高级",
    ability: "能较流畅地表达观点并参与普通讨论。",
    typical: "能解释观点、举例、比较优缺点；错误不太影响理解。",
    nextFocus: "提升表达自然度、连接词和复杂句。",
  },
  {
    code: "C1",
    shortLabel: "高级",
    ability: "能自然、清晰、较准确地表达复杂想法。",
    typical: "能讨论抽象/工作/学习话题；会调整语气和表达策略。",
    nextFocus: "提升地道表达、精确用词和语域控制。",
  },
  {
    code: "C2",
    shortLabel: "精通",
    ability: "接近熟练使用者，能灵活表达细微含义。",
    typical: "能即兴、准确、自然地表达复杂观点和幽默/隐含意思。",
    nextFocus: "维持高阶表达，打磨风格和说服力。",
  },
];

export const USER_LEVEL_TO_CEFR: Record<UserLevel, CefrLevel> = {
  beginner: "B1",
  intermediate: "B2",
  advanced: "C1",
};

export function getCefrLevel(userLevel: UserLevel | null | undefined): CefrLevel {
  return userLevel ? USER_LEVEL_TO_CEFR[userLevel] : "B2";
}

export function getLevelInfo(level: CefrLevel): LevelInfo {
  return LEVEL_SYSTEM.find((item) => item.code === level) ?? LEVEL_SYSTEM[3];
}

export function getLevelIndex(level: CefrLevel): number {
  return LEVEL_SYSTEM.findIndex((item) => item.code === level);
}

export function getLevelContext(level: CefrLevel) {
  const currentIndex = getLevelIndex(level);
  const safeIndex = currentIndex >= 0 ? currentIndex : 3;
  return {
    current: LEVEL_SYSTEM[safeIndex],
    previous: LEVEL_SYSTEM.slice(0, safeIndex),
    next: LEVEL_SYSTEM.slice(safeIndex + 1),
  };
}
