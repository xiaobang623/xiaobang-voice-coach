/**
 * Conversation persona LLM suite.
 *
 * Covers the real-time coach system prompt used by live free-talk/expression
 * sessions. Red line: when the learner is stuck, the coach must lower pressure
 * with reassurance + a tiny scaffold, never mid-chat correction.
 */

import { buildSystemPrompt } from "../../src/config/session.ts";
import { callDeepseekText, judgeCase, makeCheck, runCases } from "../lib/harness.mjs";

export const name = "conversation";
export const kind = "llm";

const SYSTEM = buildSystemPrompt("The learner wants relaxed free talk practice after a busy day.");
const REASSURANCE_RE = /take your time|no rush|no worries|it's okay|that'?s okay|totally okay|all good|别急|慢慢来/i;
const SCAFFOLD_RE = /you can start|start with|try saying|you could say|you can just say|can just say|one simple way|something like|maybe just say|two options|pick one|for me|可以先说|先说|试试说/i;
const CORRECTION_RE = /grammar|mistake|wrong|correct|should say|you should have said|not .* but|error/i;

const CASES = [
  {
    id: "VC-CONV-001-stuck-english",
    input: "um... how do I say... I don't know.",
    criteria:
      "The coach reply must warmly reassure the learner, offer a tiny English sentence starter or two easy options, and avoid any correction, judgement, or pressure. It should feel like a friend helping them keep speaking, not a teacher testing them.",
  },
  {
    id: "VC-CONV-002-stuck-chinese",
    input: "我不知道怎么说。",
    criteria:
      "The coach reply must recognize the learner is stuck, lower the pressure, and give a simple starting sentence or easy choice. It must not correct English, mention mistakes, or shame the learner for using Chinese.",
  },
  {
    id: "VC-CONV-003-long-silence",
    input: "[The learner goes quiet for a long silence and seems stuck.]",
    criteria:
      "For long silence, the coach should not wait, pressure, or interrogate. It should reassure briefly and offer a small scaffold: a simpler way to start, two easy options, or an easier related question. No correction or evaluation.",
  },
];

export async function run({ judgeEnabled = true, concurrency = 3 } = {}) {
  return runCases(
    CASES,
    async (testCase) => {
      const output = await callDeepseekText({
        system: SYSTEM,
        user: testCase.input,
        temperature: 0,
        maxTokens: 90,
      });

      const wordCount = output.trim().split(/\s+/).filter(Boolean).length;
      const checks = [
        makeCheck("回复非空", output.trim().length > 0),
        makeCheck("语音回复保持轻量（≤45 words）", wordCount <= 45, `${wordCount} words: ${output}`),
        makeCheck("包含安抚", REASSURANCE_RE.test(output), output),
        makeCheck("包含起手句/选择等小台阶", SCAFFOLD_RE.test(output), output),
        makeCheck("不纠错、不点名 mistake", !CORRECTION_RE.test(output), output),
      ];

      let judge;
      if (judgeEnabled) {
        judge = await judgeCase({ criteria: testCase.criteria, input: testCase.input, output });
      }

      return { checks, judge, output };
    },
    { concurrency },
  );
}
