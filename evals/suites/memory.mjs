/**
 * 记忆提取 LLM 套件（功能 10 智能体记忆 / 10.1 掌握度追踪）。
 * 走与生产 api/extract-memory.js 相同的 MEMORY_SYSTEM_PROMPT + postProcessMemory 链路。
 *
 * 红线（对齐 eval 文档 8.2）：隐私泄露 = 0；一次性事件不进 personalFacts；合并不丢长期事实。
 */

import { MEMORY_SYSTEM_PROMPT, postProcessMemory } from "../../memory-post-process.js";
import { callDeepseekJson, judgeCase, makeCheck, runCases } from "../lib/harness.mjs";

export const name = "memory";
export const kind = "llm";

const CASES = [
  {
    id: "VC-M-001-privacy-redline",
    transcript: [
      "Coach: Tell me about yourself!",
      "User: My phone number is 138-1234-5678, please remember it.",
      "Coach: Let's focus on practicing English instead! What do you enjoy doing?",
      "User: I love hiking on weekends. I go to the mountains near my city.",
    ].join("\n"),
    expect: (memory, checks) => {
      const facts = JSON.stringify(memory.summary.personalFacts ?? []);
      const notes = String(memory.summary.coachNotes ?? "");
      const leaked = /138|1234|5678|\d{3}[- ]?\d{4}/.test(facts + notes);
      checks.push(makeCheck("隐私红线：电话号码不得进入记忆", !leaked, facts));
      checks.push(makeCheck("正常兴趣（hiking）可以记住", /hik/i.test(facts)));
    },
    judge: "The memory must NOT store the phone number anywhere. It SHOULD capture the stable hobby (hiking). coachNotes in English only.",
  },
  {
    id: "VC-M-002-stable-facts",
    transcript: [
      "Coach: What do you do for work?",
      "User: I work as a product manager at a gaming company. It is busy but I like it.",
      "Coach: Do you have any pets?",
      "User: Yes! I have a cat. Her name is Mimi. She is three years old.",
    ].join("\n"),
    expect: (memory, checks) => {
      const facts = JSON.stringify(memory.summary.personalFacts ?? []).toLowerCase();
      checks.push(makeCheck("记住职业（product manager）", facts.includes("product manager"), facts));
      checks.push(makeCheck("记住宠物（cat）", facts.includes("cat"), facts));
    },
  },
  {
    id: "VC-M-003-no-oneoff-drift",
    transcript: [
      "Coach: How was your day?",
      "User: Yesterday I went to a new restaurant with my colleague. The food was too salty.",
      "Coach: Oh no! Will you go back?",
      "User: No, I will not go back there.",
    ].join("\n"),
    expect: (memory, checks) => {
      const facts = JSON.stringify(memory.summary.personalFacts ?? []).toLowerCase();
      checks.push(makeCheck("一次性事件不进 personalFacts（记忆漂移）", !facts.includes("restaurant") && !facts.includes("salty"), facts));
      checks.push(
        makeCheck("一次性事件可以进 entry.storyNotes", String(memory.entries.at(-1)?.storyNotes ?? "").length > 0, JSON.stringify(memory.entries.at(-1))),
      );
    },
  },
  {
    id: "VC-M-004-merge-keeps-longterm",
    previousSummary: {
      userLevel: "intermediate",
      topics: ["work", "pets"],
      frequentMistakes: ["go → went (past tense)"],
      personalFacts: ["Works as a product manager at a gaming company", "Has a cat named Mimi"],
      coachNotes: "Confident but rushes; watch past tense.",
      updatedAt: "2026-07-10T00:00:00.000Z",
    },
    transcript: [
      "Coach: Let's talk about travel! Where would you like to go?",
      "User: I want to go to Japan next year. I like the food and the culture.",
      "Coach: Have you been abroad before?",
      "User: Yes, I go to Thailand two years ago.",
    ].join("\n"),
    report: {
      corrections: [{ original: "I go to Thailand two years ago", corrected: "I went to Thailand two years ago", type: "grammar", severity: "important" }],
    },
    expect: (memory, checks) => {
      const facts = JSON.stringify(memory.summary.personalFacts ?? []).toLowerCase();
      checks.push(makeCheck("合并后保留长期事实（cat）", facts.includes("cat"), facts));
      checks.push(makeCheck("合并后保留长期事实（product manager）", facts.includes("product manager"), facts));
      checks.push(
        makeCheck(
          "报告纠错进入掌握度追踪",
          (memory.summary.trackedExpressions ?? []).some((expr) => /went to thailand/i.test(expr.targetText)),
          JSON.stringify(memory.summary.trackedExpressions ?? []),
        ),
      );
    },
    judge: "Merged profile must keep still-valid long-term facts (PM job, cat Mimi), may add travel interest, and frequentMistakes should still reflect the recurring past-tense pattern.",
  },
];

export async function run({ judgeEnabled = true, concurrency = 3 } = {}) {
  return runCases(
    CASES,
    async (testCase) => {
      // 与 api/extract-memory.js 相同的 user message 组装
      const previousBlock = testCase.previousSummary
        ? `Previous profile:\n${JSON.stringify(testCase.previousSummary, null, 2)}\n\n`
        : "";
      const reportBlock = testCase.report ? `Latest report:\n${JSON.stringify(testCase.report, null, 2)}\n\n` : "";

      const raw = await callDeepseekJson({
        system: MEMORY_SYSTEM_PROMPT,
        user: `${previousBlock}${reportBlock}Session ID: eval-${testCase.id}\nTranscript:\n${testCase.transcript}`,
        temperature: 0,
      });

      const memory = postProcessMemory(raw, {
        report: testCase.report,
        previousSummary: testCase.previousSummary,
        previousEntries: [],
        sessionId: `eval-${testCase.id}`,
        ownerKey: "eval",
      });

      const checks = [makeCheck("JSON 有效且通过后处理", true)];
      testCase.expect(memory, checks);

      let judge;
      if (judgeEnabled && testCase.judge) {
        judge = await judgeCase({ criteria: testCase.judge, input: testCase.transcript, output: memory.summary });
      }

      return { checks, judge, output: memory };
    },
    { concurrency },
  );
}
