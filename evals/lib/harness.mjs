/**
 * Voice Coach evals shared harness.
 *
 * 提供：.env.local 加载、DeepSeek 客户端、LLM judge、check 工具、
 * 并发执行器、scorecard 汇总与落盘（results/history.jsonl + latest.md + runs/）。
 *
 * 设计原则：
 * - eval 代码 import 生产模块（report-post-process.js 等），永远和线上同一份 prompt/清洗逻辑。
 * - 每次运行记录 git commit + prompt hash + model + temperature，保证版本对比可复现。
 */

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const RESULTS_DIR = path.join(ROOT, "evals", "results");
export const RUNS_DIR = path.join(RESULTS_DIR, "runs");

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------

export function loadEnvLocal() {
  for (const file of [".env.local", ".env"]) {
    let raw;
    try {
      raw = readFileSync(path.join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) {
        continue;
      }
      const key = match[1];
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// DeepSeek client（与生产 api/generate-report.js 相同 endpoint / json mode）
// ---------------------------------------------------------------------------

export const EVAL_MODEL = "deepseek-chat";
export const EVAL_TEMPERATURE = 0; // 评测固定 0，保证可复现（生产为 0.2~0.3）

export async function callDeepseekText({ system, user, messages, temperature = EVAL_TEMPERATURE, maxTokens = 200, maxRetries = 2 }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY missing — 请确认 .env.local 或环境变量");
  }

  const chatMessages = [
    { role: "system", content: system },
    ...(messages ?? [{ role: "user", content: user }]),
  ];

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: EVAL_MODEL,
          temperature,
          max_tokens: maxTokens,
          messages: chatMessages,
        }),
      });
      if (!response.ok) {
        throw new Error(`DeepSeek HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
      }
      const completion = await response.json();
      const content = completion?.choices?.[0]?.message?.content;
      if (!content || typeof content !== "string") {
        throw new Error("Empty model response");
      }
      return content.trim();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

export async function callDeepseekJson({ system, user, temperature = EVAL_TEMPERATURE, maxRetries = 2 }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY missing — 请确认 .env.local 或环境变量");
  }

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: EVAL_MODEL,
          temperature,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!response.ok) {
        throw new Error(`DeepSeek HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
      }
      const completion = await response.json();
      const content = completion?.choices?.[0]?.message?.content;
      if (!content || typeof content !== "string") {
        throw new Error("Empty model response");
      }
      return JSON.parse(content);
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// LLM judge（deepseek-chat 打分 1-5；≥4 视为 pass，对齐 eval 文档 rubric）
// ---------------------------------------------------------------------------

const JUDGE_SYSTEM = `You are a strict evaluation judge for an AI English speaking-coach app used by Chinese learners.
You will receive: (1) the evaluation criteria for one test case, (2) the input given to the system under test, (3) the system's actual output.
Grade how well the output satisfies the criteria.
Scoring rubric: 5 = fully satisfies, ship as-is; 4 = minor imperfection, still good for users; 3 = direction OK but noticeably flawed; 2 = clearly misleading or unhelpful; 1 = wrong, fabricated, or harms user trust.
Be strict about: fabricated quotes not present in the input, generic advice like "practice more", overlap between growth items and corrections, privacy leaks, and Chinese/English usage matching the field specs.
Respond ONLY with strict JSON: {"score": 1-5, "reason": "one concise sentence in Chinese"}.`;

export async function judgeCase({ criteria, input, output }) {
  const payload = [
    `## Evaluation criteria\n${criteria}`,
    `## Input to system under test\n${typeof input === "string" ? input : JSON.stringify(input, null, 2)}`,
    `## Actual output\n${JSON.stringify(output, null, 2)}`,
  ].join("\n\n");

  const raw = await callDeepseekJson({ system: JUDGE_SYSTEM, user: payload });
  const score = Number(raw?.score);
  return {
    score: Number.isFinite(score) ? Math.min(5, Math.max(1, score)) : 1,
    reason: String(raw?.reason ?? "").slice(0, 300),
  };
}

// ---------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------

export function makeCheck(name, pass, detail = "") {
  return { name, pass: Boolean(pass), detail: String(detail ?? "").slice(0, 400) };
}

/** 并发跑 case，executor(case) → { checks: [], judge?: {score, reason}, output? } */
export async function runCases(cases, executor, { concurrency = 3 } = {}) {
  const results = new Array(cases.length);
  let cursor = 0;

  async function worker() {
    while (cursor < cases.length) {
      const index = cursor;
      cursor += 1;
      const testCase = cases[index];
      try {
        const outcome = await executor(testCase);
        results[index] = { id: testCase.id, ...outcome };
      } catch (error) {
        results[index] = {
          id: testCase.id,
          checks: [makeCheck("no-crash", false, error instanceof Error ? error.message : String(error))],
        };
      }
      const done = results.filter(Boolean).length;
      process.stdout.write(`\r  ${done}/${cases.length} cases done`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, worker));
  process.stdout.write("\n");
  return results;
}

// ---------------------------------------------------------------------------
// scorecard
// ---------------------------------------------------------------------------

export function sha8(text) {
  return createHash("sha256").update(String(text)).digest("hex").slice(0, 8);
}

export function gitInfo() {
  try {
    const commit = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim();
    const dirty = execSync("git status --porcelain", { cwd: ROOT }).toString().trim().length > 0;
    return { commit, dirty };
  } catch {
    return { commit: "unknown", dirty: false };
  }
}

export function summarizeSuite(suiteName, caseResults) {
  const checks = caseResults.flatMap((entry) => entry.checks ?? []);
  const checksPassed = checks.filter((entry) => entry.pass).length;
  const judgeScores = caseResults
    .map((entry) => entry.judge?.score)
    .filter((score) => Number.isFinite(score));
  const judgePassed = judgeScores.filter((score) => score >= 4).length;
  const passRate = checks.length > 0 ? checksPassed / checks.length : 1;

  // gate 对齐 eval 文档 4.5：Green ≥85% / Yellow 70–85% / Red <70%
  const judgeOk = judgeScores.length === 0 || judgePassed / judgeScores.length >= 0.7;
  const verdict =
    passRate >= 0.85 && judgeOk ? "green" : passRate >= 0.7 ? "yellow" : "red";

  return {
    suite: suiteName,
    cases: caseResults.length,
    checksTotal: checks.length,
    checksPassed,
    passRate: Number(passRate.toFixed(4)),
    judgeAvg: judgeScores.length > 0 ? Number((judgeScores.reduce((a, b) => a + b, 0) / judgeScores.length).toFixed(2)) : null,
    judgeCases: judgeScores.length,
    verdict,
    failures: caseResults
      .map((entry) => ({
        id: entry.id,
        failed: (entry.checks ?? []).filter((check) => !check.pass),
        judge: entry.judge && entry.judge.score < 4 ? entry.judge : undefined,
      }))
      .filter((entry) => entry.failed.length > 0 || entry.judge),
  };
}

const VERDICT_ICON = { green: "🟢", yellow: "🟡", red: "🔴" };

export function writeResults({ summaries, caseDetails, meta }) {
  mkdirSync(RUNS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:]/g, "-").slice(0, 19);

  // 1. 完整原始输出（gitignore，仅本地排查用）
  writeFileSync(
    path.join(RUNS_DIR, `${timestamp}.json`),
    JSON.stringify({ meta, summaries, caseDetails }, null, 2),
  );

  // 2. history.jsonl（进 git，做版本对比）
  appendFileSync(
    path.join(RESULTS_DIR, "history.jsonl"),
    `${JSON.stringify({ ts: timestamp, ...meta, suites: summaries.map(({ failures, ...rest }) => rest) })}\n`,
  );

  // 3. latest.md scorecard（进 git）
  const lines = [
    `# Voice Coach Evals · 最近一次运行`,
    "",
    `- 时间：${timestamp}`,
    `- commit：\`${meta.git.commit}\`${meta.git.dirty ? "（工作区有未提交改动）" : ""}`,
    `- model：${meta.model} · temperature ${meta.temperature}`,
    `- prompt hash：report \`${meta.promptHashes.report}\` · memory \`${meta.promptHashes.memory}\` · directions \`${meta.promptHashes.directions}\` · conversation \`${meta.promptHashes.conversation ?? "—"}\``,
    "",
    "| Suite | 结论 | checks | 通过率 | judge 均分 |",
    "|---|---|---:|---:|---:|",
    ...summaries.map(
      (summary) =>
        `| ${summary.suite} | ${VERDICT_ICON[summary.verdict]} ${summary.verdict} | ${summary.checksPassed}/${summary.checksTotal} | ${(summary.passRate * 100).toFixed(1)}% | ${summary.judgeAvg ?? "—"} |`,
    ),
    "",
  ];

  const allFailures = summaries.flatMap((summary) =>
    summary.failures.map((failure) => ({ suite: summary.suite, ...failure })),
  );
  if (allFailures.length > 0) {
    lines.push("## 未通过项", "");
    for (const failure of allFailures) {
      for (const check of failure.failed) {
        lines.push(`- **${failure.suite} / ${failure.id}** · ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
      }
      if (failure.judge) {
        lines.push(`- **${failure.suite} / ${failure.id}** · judge ${failure.judge.score}/5 — ${failure.judge.reason}`);
      }
    }
    lines.push("");
  }
  writeFileSync(path.join(RESULTS_DIR, "latest.md"), lines.join("\n"));

  return { timestamp };
}

export function printSummaries(summaries) {
  console.log("");
  for (const summary of summaries) {
    console.log(
      `${VERDICT_ICON[summary.verdict]} ${summary.suite.padEnd(12)} checks ${summary.checksPassed}/${summary.checksTotal} (${(summary.passRate * 100).toFixed(1)}%)` +
        (summary.judgeAvg != null ? ` · judge ${summary.judgeAvg}/5` : ""),
    );
    for (const failure of summary.failures) {
      for (const check of failure.failed) {
        console.log(`   ✗ ${failure.id} · ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
      }
      if (failure.judge) {
        console.log(`   ✗ ${failure.id} · judge ${failure.judge.score}/5 — ${failure.judge.reason}`);
      }
    }
  }
  console.log("");
}
