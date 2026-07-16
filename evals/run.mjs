#!/usr/bin/env node
/**
 * Voice Coach evals 入口。
 *
 * 用法：
 *   node evals/run.mjs                     # smoke + 全部 LLM 套件（report/memory/directions）
 *   node evals/run.mjs --smoke             # 只跑确定性 smoke（零成本，秒级）
 *   node evals/run.mjs --suite report      # 只跑指定套件（逗号分隔）
 *   node evals/run.mjs --no-judge          # 跳过 LLM judge，只跑确定性断言（更快更省）
 *   node evals/run.mjs --smoke --no-write  # 只做 gate，不改写结果文件（CI / git hook）
 *   node evals/run.mjs --concurrency 5
 *
 * 退出码：任何套件 red、或 smoke 未 100% 通过 → 非 0（可做 CI / git hook gate）。
 */

import {
  loadEnvLocal,
  gitInfo,
  sha8,
  summarizeSuite,
  writeResults,
  printSummaries,
  EVAL_MODEL,
  EVAL_TEMPERATURE,
} from "./lib/harness.mjs";
import { SYSTEM_PROMPT } from "../report-post-process.js";
import { MEMORY_SYSTEM_PROMPT } from "../memory-post-process.js";
import { DIRECTIONS_SYSTEM_PROMPT } from "../directions-post-process.js";
import * as smokeSuite from "./suites/smoke.mjs";
import * as reportSuite from "./suites/report.mjs";
import * as memorySuite from "./suites/memory.mjs";
import * as directionsSuite from "./suites/directions.mjs";

const SUITES = {
  smoke: smokeSuite,
  report: reportSuite,
  memory: memorySuite,
  directions: directionsSuite,
};

function parseArgs(argv) {
  const args = { suites: null, smokeOnly: false, judge: true, write: true, concurrency: 3 };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--smoke") args.smokeOnly = true;
    else if (arg === "--no-judge") args.judge = false;
    else if (arg === "--no-write") args.write = false;
    else if (arg === "--suite") args.suites = String(argv[++index] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--concurrency") args.concurrency = Math.max(1, Number(argv[++index]) || 3);
    else {
      console.error(`未知参数：${arg}`);
      process.exit(2);
    }
  }
  return args;
}

const args = parseArgs(process.argv);
loadEnvLocal();

let selected;
if (args.smokeOnly) {
  selected = ["smoke"];
} else if (args.suites) {
  selected = args.suites;
  const unknown = selected.filter((name) => !SUITES[name]);
  if (unknown.length > 0) {
    console.error(`未知套件：${unknown.join(", ")}（可选：${Object.keys(SUITES).join(", ")}）`);
    process.exit(2);
  }
} else {
  selected = Object.keys(SUITES); // smoke + 全部 LLM
}

const needsApi = selected.some((name) => SUITES[name].kind === "llm");
if (needsApi && !process.env.DEEPSEEK_API_KEY) {
  console.error("缺少 DEEPSEEK_API_KEY（.env.local）。只跑确定性测试请用 --smoke。");
  process.exit(2);
}

const meta = {
  git: gitInfo(),
  model: EVAL_MODEL,
  temperature: EVAL_TEMPERATURE,
  judge: args.judge,
  promptHashes: {
    report: sha8(SYSTEM_PROMPT),
    memory: sha8(MEMORY_SYSTEM_PROMPT),
    directions: sha8(DIRECTIONS_SYSTEM_PROMPT),
  },
};

console.log(`Voice Coach evals · commit ${meta.git.commit}${meta.git.dirty ? "*" : ""} · 套件：${selected.join(", ")}${args.judge ? "" : " · no-judge"}`);

const summaries = [];
const caseDetails = {};

for (const suiteName of selected) {
  const suite = SUITES[suiteName];
  console.log(`\n▶ ${suiteName}${suite.kind === "llm" ? "（调用 DeepSeek）" : "（确定性）"}`);
  const started = Date.now();
  const caseResults = await suite.run({ judgeEnabled: args.judge, concurrency: args.concurrency });
  console.log(`  耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
  summaries.push(summarizeSuite(suiteName, caseResults));
  caseDetails[suiteName] = caseResults;
}

printSummaries(summaries);
if (args.write) {
  const { timestamp } = writeResults({ summaries, caseDetails, meta });
  console.log(`结果已写入 evals/results/latest.md · history.jsonl · runs/${timestamp}.json`);
} else {
  console.log("Gate 模式：未改写 evals 结果文件");
}

const smokeSummary = summaries.find((summary) => summary.suite === "smoke");
const failed =
  summaries.some((summary) => summary.verdict === "red") ||
  (smokeSummary && smokeSummary.passRate < 1);

if (failed) {
  console.error("\n❌ Evals gate 未通过（smoke 必须 100%；LLM 套件不得 red）");
  process.exit(1);
}
console.log("✅ Evals gate 通过");
