/**
 * 复盘报告 LLM 套件（P0）：真实调用 DeepSeek，走与生产完全相同的
 * SYSTEM_PROMPT + cleanTranscriptForReport + postProcessReport 链路。
 *
 * case 编号沿用 vault《Voice Coach Evals评测体系》的 Golden Set（VC-R / VC-T / VC-G / VC-L）。
 * 确定性断言测「误伤率 / 召回 / task 判断 / growth 不编造」；judge 测解释质量与可用性。
 */

import {
  SYSTEM_PROMPT,
  cleanTranscriptForReport,
  postProcessReport,
} from "../../report-post-process.js";
import { callDeepseekJson, judgeCase, makeCheck, runCases } from "../lib/harness.mjs";

export const name = "report";
export const kind = "llm";

// ---------------------------------------------------------------------------
// Golden cases
// ---------------------------------------------------------------------------

const CASES = [
  {
    id: "VC-R-001-grammar-past-tense",
    transcript: [
      "Coach: What did you do yesterday?",
      "User: I go to school yesterday and meet my friend.",
      "Coach: Nice! What did you two do together?",
      "User: We play basketball for two hours.",
    ].join("\n"),
    expect: (report, checks) => {
      checks.push(makeCheck("抓到过去时错误（went）", hasCorrection(report, "went"), correctionsBrief(report)));
      checks.push(makeCheck("时态错误归类 grammar", findCorrection(report, "went")?.type === "grammar"));
    },
    judge: "Corrections should catch the past-tense errors (go→went, meet→met, play→played or a pattern-level item), explanations in concise Chinese, no fabricated errors.",
  },
  {
    id: "VC-R-002-naturalness-very-like",
    transcript: [
      "Coach: Do you play mobile games?",
      "User: Yes, I very like this game called Genshin.",
      "Coach: What do you like about it?",
      "User: The story is good and the picture is beautiful.",
    ].join("\n"),
    expect: (report, checks) => {
      checks.push(makeCheck("抓到 very like → really like", hasCorrection(report, "really"), correctionsBrief(report)));
    },
    judge: "Should correct 'I very like' to a natural alternative like 'I really like'. May also suggest 'graphics' for 'picture'. Corrections must be natural spoken English, not bookish.",
  },
  {
    id: "VC-R-003-collocation-made-homework",
    transcript: [
      "Coach: How was your evening?",
      "User: I made my homework last night, then I watched a movie.",
    ].join("\n"),
    expect: (report, checks) => {
      checks.push(makeCheck("抓到 made → did homework", hasCorrection(report, "did"), correctionsBrief(report)));
    },
  },
  {
    id: "VC-R-005-structure-broken-sentence",
    transcript: [
      "Coach: What kind of games are you looking for?",
      "User: I want find a game can play with friend.",
    ].join("\n"),
    expect: (report, checks) => {
      const structural = report.corrections.find((c) => c.type === "structure" || c.type === "grammar");
      checks.push(makeCheck("抓到结构问题（structure/grammar）", Boolean(structural), correctionsBrief(report)));
    },
    judge: "Should rewrite into a complete structure like 'I want to find a game I can play with my friends' and explain the missing 'to' / relative clause in Chinese.",
  },
  {
    id: "VC-R-006-no-error-dont-overcorrect",
    transcript: [
      "Coach: Tell me about your weekend.",
      "User: I went to the park yesterday and had a great time with my friends.",
      "Coach: That sounds lovely! What did you do there?",
      "User: We had a picnic and played some card games until it got dark.",
    ].join("\n"),
    expect: (report, checks) => {
      checks.push(
        makeCheck("无错误样本不硬纠错（≤1 条 minor）", report.corrections.length <= 1 && report.corrections.every((c) => c.severity === "minor"), correctionsBrief(report)),
      );
    },
  },
  {
    id: "VC-R-007-asr-noise-no-false-positive",
    transcript: [
      "Coach: What do you think about it?",
      "User: um uh I I I [inaudible] good good",
    ].join("\n"),
    expect: (report, checks) => {
      checks.push(makeCheck("ASR 噪声不产生纠错（误伤率红线）", report.corrections.length === 0, correctionsBrief(report)));
    },
  },
  {
    id: "VC-R-008-nested-prefix-noise",
    transcript: [
      "Coach: Do you like it?",
      "User: Coach: User: I like it.",
    ].join("\n"),
    expect: (report, checks) => {
      checks.push(makeCheck("嵌套前缀清理后不误判", report.corrections.length === 0, correctionsBrief(report)));
    },
  },
  {
    id: "VC-R-009-short-answer",
    transcript: ["Coach: Do you drink coffee?", "User: Yes."].join("\n"),
    expect: (report, checks) => {
      checks.push(makeCheck("超短对话 corrections ≤1", report.corrections.length <= 1, correctionsBrief(report)));
      checks.push(makeCheck("userLevel 合法", ["beginner", "intermediate", "advanced"].includes(report.userLevel)));
    },
  },
  {
    id: "VC-R-010-grammar-third-person",
    transcript: [
      "Coach: Does your sister like spicy food?",
      "User: No, she don't like spicy food. She like sweet things.",
    ].join("\n"),
    expect: (report, checks) => {
      checks.push(makeCheck("抓到 don't → doesn't", hasCorrection(report, "doesn't"), correctionsBrief(report)));
    },
  },
  {
    id: "VC-T-001-task-done",
    taskGoals: [
      { id: "cafe-price", desc: "Ask about the price of the drink" },
      { id: "cafe-custom", desc: "Make a customization request" },
    ],
    transcript: [
      "Coach: Hi there! What can I get for you today?",
      "User: I want a latte. Can I have it with oat milk and less sugar?",
      "Coach: Of course! One oat milk latte, less sugar.",
      "User: How much is it?",
      "Coach: That'll be 32 yuan.",
      "User: OK, thank you.",
    ].join("\n"),
    expect: (report, checks) => {
      checks.push(makeCheck("cafe-price 判 done", taskStatus(report, "cafe-price") === "done", tasksBrief(report)));
      checks.push(makeCheck("cafe-custom 判 done", taskStatus(report, "cafe-custom") === "done", tasksBrief(report)));
      checks.push(makeCheck("taskScore = 2/2", report.taskScore === "2/2", report.taskScore));
    },
    judge: "Task reasons must be one concise Chinese sentence each, citing what the user actually said (asked price, requested oat milk / less sugar).",
  },
  {
    id: "VC-T-002-task-not-done",
    taskGoals: [{ id: "late-reason", desc: "Explain the reason why you were late" }],
    transcript: [
      "Coach: You're late today. What happened?",
      "User: Sorry I'm late.",
      "Coach: It's OK. Was everything alright?",
      "User: Yes, everything is fine.",
    ].join("\n"),
    expect: (report, checks) => {
      const status = taskStatus(report, "late-reason");
      checks.push(makeCheck("没解释原因不能判 done", status === "partial" || status === "missed", tasksBrief(report)));
    },
  },
  {
    id: "VC-G-001-growth-not-fabricated",
    transcript: [
      "Coach: Let's talk about coffee. Do you drink it every day?",
      "User: Yes, I drink coffee every morning. I like latte.",
      "Coach: Nice! Where do you usually buy it?",
      "User: I buy it near my office. The shop is small but the coffee is good.",
      "Coach: Do you ever make coffee at home?",
      "User: No, I don't make coffee at home. It is too slow for me.",
    ].join("\n"),
    expect: (report, checks) => {
      checks.push(makeCheck("有足够内容时 growth 存在", Boolean(report.growth)));
      if (report.growth) {
        const userText = normalize(userLines(CASES.find((c) => c.id === "VC-G-001-growth-not-fabricated").transcript));
        const fabricated = report.growth.sayBetter.filter((item) => !userText.includes(normalize(item.original)));
        checks.push(
          makeCheck("sayBetter.original 必须来自用户原话（不编造）", fabricated.length === 0, fabricated.map((f) => f.original).join(" | ")),
        );
        checks.push(makeCheck("newExpressions ≥1", report.growth.newExpressions.length >= 1));
        const recycled = report.growth.newExpressions.filter((item) => userText.includes(normalize(item.phrase)));
        checks.push(
          makeCheck("newExpressions 不能把用户原话当新表达", recycled.length === 0, recycled.map((r) => r.phrase).join(" | ")),
        );
        checks.push(makeCheck("talkMore 带英文起手句", report.growth.talkMore.every((t) => /[a-z]/i.test(t.starter))));
        const generic = /\b(practice more|speak more|use better)\b/i.test(JSON.stringify(report.growth));
        checks.push(makeCheck("无 practice more 式空话", !generic));
      }
    },
    judge: "Growth pack quality: sayBetter upgrades should be one notch above the user's level (i+1, not interview-level), newExpressions must be coffee-topic-relevant spoken chunks, talkMore starters must be sayable verbatim. No overlap with corrections.",
  },
  {
    id: "VC-L-002-level-beginner",
    transcript: [
      "Coach: Tell me about your day.",
      "User: I today go work. Work very busy. I no time eat lunch.",
      "Coach: Oh no! What did you do after work?",
      "User: I go home. I eat many food. Then sleep.",
    ].join("\n"),
    expect: (report, checks) => {
      checks.push(makeCheck("大量基础错误 → beginner", report.userLevel === "beginner", report.userLevel));
      checks.push(makeCheck("低价值同类小错不刷屏（≤6 条且有 pattern 合并空间）", report.corrections.length <= 6, correctionsBrief(report)));
    },
  },
];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function normalize(text) {
  return String(text ?? "").toLowerCase().replace(/[^a-z0-9一-鿿]+/g, " ").trim();
}

function userLines(transcript) {
  return transcript
    .split("\n")
    .filter((line) => line.startsWith("User:"))
    .join(" ");
}

function findCorrection(report, substring) {
  return report.corrections.find((c) => normalize(c.corrected).includes(normalize(substring)));
}

function hasCorrection(report, substring) {
  return Boolean(findCorrection(report, substring));
}

function correctionsBrief(report) {
  return report.corrections.map((c) => `[${c.type}/${c.severity}] ${c.original} → ${c.corrected}`).join(" ; ") || "(无纠错)";
}

function taskStatus(report, goalId) {
  return report.taskResults?.find((t) => t.goalId === goalId)?.status;
}

function tasksBrief(report) {
  return (report.taskResults ?? []).map((t) => `${t.goalId}=${t.status}`).join(" ; ") || "(无 taskResults)";
}

// ---------------------------------------------------------------------------
// runner —— 与 api/generate-report.js 完全一致的调用方式
// ---------------------------------------------------------------------------

export async function run({ judgeEnabled = true, concurrency = 3 } = {}) {
  return runCases(
    CASES,
    async (testCase) => {
      const input = {
        sessionId: `eval-${testCase.id}`,
        durationSeconds: 180,
        transcript: testCase.transcript,
        ...(testCase.taskGoals ? { taskGoals: testCase.taskGoals } : {}),
      };

      const cleaned = cleanTranscriptForReport(input.transcript);
      const transcriptForModel = cleaned.trim() || input.transcript;
      const taskGoalsBlock =
        Array.isArray(input.taskGoals) && input.taskGoals.length > 0
          ? `\n\nTask goals to judge:\n${input.taskGoals.map((g) => `- [${g.id}] ${g.desc}`).join("\n")}`
          : "";

      const raw = await callDeepseekJson({
        system: SYSTEM_PROMPT,
        user: `sessionId: ${input.sessionId}\ndurationSeconds: ${input.durationSeconds}${taskGoalsBlock}\n\nTranscript (lightly cleaned for obvious ASR noise):\n${transcriptForModel}`,
      });

      const report = postProcessReport(raw, input);
      const checks = [makeCheck("JSON 有效且通过后处理", true)];
      testCase.expect(report, checks);

      let judge;
      if (judgeEnabled && testCase.judge) {
        judge = await judgeCase({ criteria: testCase.judge, input: testCase.transcript, output: report });
      }

      return { checks, judge, output: report };
    },
    { concurrency },
  );
}
