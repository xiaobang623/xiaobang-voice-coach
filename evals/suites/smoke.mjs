/**
 * Smoke 套件：确定性单测，不调用任何 API，秒级完成、零成本。
 * 覆盖生产纯逻辑：transcript 清洗、报告后处理、记忆后处理 + 掌握度合并、
 * 开场方向后处理（进行中功能 1.1）、成本单价计算（进行中功能 17）。
 *
 * 约定：smoke 必须 100% 通过；任何功能改动后自动跑（pre-push hook + Claude 约定）。
 */

import {
  cleanTranscriptForReport,
  postProcessReport,
} from "../../report-post-process.js";
import {
  postProcessMemory,
  mergeTrackedExpressions,
  buildTrackedExpressionsFromReport,
  normalizeExpressionKey,
} from "../../memory-post-process.js";
import { postProcessDirections } from "../../directions-post-process.js";
import { getModelCostRate, calculateCostForUsage } from "../../api/_lib/cost-rates.js";
import { makeCheck } from "../lib/harness.mjs";

export const name = "smoke";
export const kind = "smoke";

export async function run() {
  const results = [];
  const record = (id, checks) => results.push({ id, checks });

  // -------------------------------------------------------------------------
  // 1. transcript 清洗（报告输入净化 → 影响 ASR 噪声误伤率）
  // -------------------------------------------------------------------------
  record("SMK-CLEAN-001-filler-only-line", [
    makeCheck("纯 filler 行被移除", cleanTranscriptForReport("User: um uh hmm") === ""),
  ]);
  record("SMK-CLEAN-002-noise-marker", [
    makeCheck(
      "[inaudible] 标记被清掉",
      cleanTranscriptForReport("User: I like it [inaudible] very much") === "User: I like it very much",
    ),
  ]);
  record("SMK-CLEAN-003-nested-prefix", [
    makeCheck(
      "嵌套 speaker prefix 清理（VC-R-008）",
      cleanTranscriptForReport("User: Coach: User: I like it.") === "User: I like it.",
    ),
  ]);
  record("SMK-CLEAN-004-duplicate-lines", [
    makeCheck(
      "连续重复行去重（前缀复读场景）",
      cleanTranscriptForReport("User: I like coffee.\nUser: I like coffee.") === "User: I like coffee.",
    ),
  ]);
  record("SMK-CLEAN-005-preserve-errors", [
    makeCheck(
      "用户真实语法错误不能被清洗改写",
      cleanTranscriptForReport("User: I go to school yesterday.") === "User: I go to school yesterday.",
    ),
  ]);
  record("SMK-CLEAN-006-edge-filler", [
    makeCheck(
      "句首 filler 剥离但正文保留",
      cleanTranscriptForReport("User: um, I like coffee") === "User: I like coffee",
    ),
  ]);

  // -------------------------------------------------------------------------
  // 2. 报告后处理（type 归一 / 去重 / 截断 / task / growth）
  // -------------------------------------------------------------------------
  const baseInput = { sessionId: "smoke-session", durationSeconds: 120 };

  const aliasReport = postProcessReport(
    {
      userLevel: "weird-level",
      corrections: [
        { original: "a", corrected: "b", type: "word-choice", severity: "huge" },
      ],
    },
    baseInput,
  );
  record("SMK-REPORT-001-normalize", [
    makeCheck("type 别名 word-choice → vocabulary", aliasReport.corrections[0].type === "vocabulary"),
    makeCheck("非法 severity 回落 important", aliasReport.corrections[0].severity === "important"),
    makeCheck("非法 userLevel 回落 intermediate", aliasReport.userLevel === "intermediate"),
  ]);

  const dupeReport = postProcessReport(
    {
      corrections: [
        { original: "I go", corrected: "I went", type: "grammar", severity: "minor" },
        { original: "i go", corrected: "I went", type: "grammar", severity: "critical" },
      ],
    },
    baseInput,
  );
  record("SMK-REPORT-002-dedupe", [
    makeCheck("同一纠错去重合并", dupeReport.corrections.length === 1),
    makeCheck("合并后取更高 severity", dupeReport.corrections[0].severity === "critical"),
    makeCheck("frequency 累加", dupeReport.corrections[0].frequency === 2),
  ]);

  const manyReport = postProcessReport(
    {
      corrections: Array.from({ length: 9 }, (_, index) => ({
        original: `orig-${index}`,
        corrected: `fix-${index}`,
        type: "grammar",
        severity: index < 2 ? "critical" : "minor",
      })),
    },
    baseInput,
  );
  record("SMK-REPORT-003-trim-sort", [
    makeCheck("最多保留 6 条纠错", manyReport.corrections.length === 6),
    makeCheck("critical 排最前", manyReport.corrections[0].severity === "critical"),
  ]);

  const taskReport = postProcessReport(
    {
      taskResults: [{ goalId: "cafe-price", status: "done", reason: "问到了价格" }],
      taskScore: "not-a-score",
    },
    { ...baseInput, taskGoals: [{ id: "cafe-price", desc: "ask price" }, { id: "cafe-close", desc: "polite closing" }] },
  );
  record("SMK-REPORT-004-task", [
    makeCheck("模型漏掉的 goal 补 missed", taskReport.taskResults.find((t) => t.goalId === "cafe-close")?.status === "missed"),
    makeCheck("非法 taskScore 重算为 1/2", taskReport.taskScore === "1/2"),
  ]);

  const noTaskReport = postProcessReport({ corrections: [] }, baseInput);
  record("SMK-REPORT-005-no-task", [
    makeCheck("无 taskGoals 时不输出 taskResults", !("taskResults" in noTaskReport)),
  ]);

  const growthReport = postProcessReport(
    {
      growth: {
        topic: "咖啡",
        sayBetter: [
          { original: "I like coffee.", upgraded: "I'm really into coffee these days.", note: "更地道" },
          { original: "no upgrade here" }, // 缺 upgraded，应被丢弃
        ],
        newExpressions: [],
        talkMore: [],
      },
      naturalUpgrades: [{ original: "It is good.", improved: "It's pretty good.", note: "口语化" }],
    },
    baseInput,
  );
  record("SMK-REPORT-006-growth-legacy", [
    makeCheck("growth 缺字段 item 被丢弃", growthReport.growth?.sayBetter.length === 1),
    makeCheck("legacy naturalUpgrades 迁入 corrections", growthReport.corrections.some((c) => c.type === "naturalness")),
  ]);

  const emptyGrowthReport = postProcessReport({ growth: { sayBetter: [], newExpressions: [], talkMore: [] } }, baseInput);
  record("SMK-REPORT-007-empty-growth", [
    makeCheck("全空 growth 整体省略", !("growth" in emptyGrowthReport)),
  ]);

  // -------------------------------------------------------------------------
  // 3. 记忆后处理 + 掌握度追踪（功能 10 / 10.1）
  // -------------------------------------------------------------------------
  const memory = postProcessMemory(
    {
      summary: {
        userLevel: "advanced",
        topics: ["travel", "food", "work", "games", "music", "extra"],
        frequentMistakes: ["a", "b", "c", "d", "e", "f", "g"],
        personalFacts: [
          "Works as a product manager at a gaming company and loves data driven decision making every single day always",
        ],
        coachNotes: "x".repeat(500),
      },
      entry: { topic: "coffee chat", highlights: "used past tense well", mistakes: "", storyNotes: "" },
    },
    {
      sessionId: "s-new",
      previousEntries: Array.from({ length: 20 }, (_, index) => ({
        sessionId: `s-${index}`,
        topic: "t",
        highlights: "",
        mistakes: "",
        storyNotes: "",
        createdAt: new Date(2026, 0, index + 1).toISOString(),
      })),
      report: {
        corrections: [{ original: "I go", corrected: "I went", type: "grammar" }],
        growth: {
          sayBetter: [{ original: "I like coffee.", upgraded: "I'm really into coffee.", note: "" }],
          newExpressions: [{ phrase: "grab a coffee", meaning: "喝杯咖啡", example: "" }],
        },
      },
    },
  );
  record("SMK-MEMORY-001-limits", [
    makeCheck("topics 上限 4", memory.summary.topics.length === 4),
    makeCheck("frequentMistakes 上限 5", memory.summary.frequentMistakes.length === 5),
    makeCheck("personalFact 截断到 15 词", memory.summary.personalFacts[0].split(" ").length <= 15),
    makeCheck("coachNotes 截断到 400 字符", memory.summary.coachNotes.length <= 400),
    makeCheck("entries 滚动保留 20 条", memory.entries.length === 20),
    makeCheck("新 entry 在末尾", memory.entries[memory.entries.length - 1].sessionId === "s-new"),
  ]);
  record("SMK-MEMORY-002-tracked-expressions", [
    makeCheck(
      "报告的 correction/sayBetter/newExpression 全部转入掌握度追踪",
      memory.summary.trackedExpressions.length === 3,
    ),
    makeCheck(
      "新表达初始状态 unmastered",
      memory.summary.trackedExpressions.every((expr) => expr.status === "unmastered"),
    ),
  ]);

  const existing = buildTrackedExpressionsFromReport(
    { corrections: [{ original: "I go", corrected: "I went", type: "grammar" }] },
    { now: "2026-07-01T00:00:00.000Z", ownerKey: "u1" },
  ).map((expr) => ({ ...expr, status: "reviewing", reuseCount: 2 }));
  const merged = mergeTrackedExpressions(
    existing,
    buildTrackedExpressionsFromReport(
      { corrections: [{ original: "i GO", corrected: "I went!", type: "grammar" }] },
      { now: "2026-07-16T00:00:00.000Z", ownerKey: "u1" },
    ),
    "2026-07-16T00:00:00.000Z",
  );
  record("SMK-MEMORY-003-merge", [
    makeCheck("同一表达（大小写/标点差异）合并不重复", merged.length === 1),
    makeCheck("合并保留原 status/reuseCount", merged[0].status === "reviewing" && merged[0].reuseCount === 2),
    makeCheck("lastSeenAt 更新为新时间", merged[0].lastSeenAt === "2026-07-16T00:00:00.000Z"),
    makeCheck("normalizeExpressionKey 抹平引号差异", normalizeExpressionKey("I’m fine.") === normalizeExpressionKey("i'm fine")),
  ]);

  // -------------------------------------------------------------------------
  // 4. 开场方向后处理（进行中功能 1.1 开场引导）
  // -------------------------------------------------------------------------
  record("SMK-DIR-001-bad-shape", [
    makeCheck("非法结构返回 null（触发静态池回退）", postProcessDirections({ nope: true }) === null),
    makeCheck("不足 3 条返回 null", postProcessDirections({ directions: [{ zh: "聊聊周末" }, { zh: "聊聊工作" }] }) === null),
  ]);
  const cleanedDirections = postProcessDirections({
    directions: [
      { zh: "聊聊周末计划", en: "my weekend plan" },
      { zh: "聊聊周末计划", en: "dup" },
      { zh: "这一条实在太长了完全超过了四十个中文字符的上限应该被丢弃掉才对不然界面会放不下去了", en: "too long" },
      { zh: "最近追的剧", en: "" },
      { zh: "工作里的小事" },
      { zh: "最想去的城市", en: "a city I'd love to visit" },
    ],
  });
  record("SMK-DIR-002-clean", [
    makeCheck("zh 去重", cleanedDirections.filter((d) => d.zh === "聊聊周末计划").length === 1),
    makeCheck("超长 zh 丢弃", !cleanedDirections.some((d) => d.zh.length > 40)),
    makeCheck("空 en 省略字段", cleanedDirections.find((d) => d.zh === "最近追的剧")?.en === undefined),
  ]);

  // -------------------------------------------------------------------------
  // 5. 成本核算（进行中功能 17 管理后台）
  //    注意：依赖默认单价；若 .env.local 配了 *_COST_* 覆盖，请同步更新这里
  // -------------------------------------------------------------------------
  record("SMK-COST-001-deepseek", [
    makeCheck("DeepSeek 50 万 token = ¥1", calculateCostForUsage({ apiProvider: "deepseek", modelName: "deepseek-chat", tokensUsed: 500_000 }) === 1),
    makeCheck(
      "小额成本不被抹零（1000 token = ¥0.002）",
      calculateCostForUsage({ apiProvider: "deepseek", modelName: "deepseek-chat", tokensUsed: 1000 }) === 0.002,
    ),
  ]);
  record("SMK-COST-002-doubao", [
    makeCheck(
      "豆包无 token 单价时按时长兜底（60s = ¥0.4）",
      calculateCostForUsage({ apiProvider: "doubao", modelName: "volc.speech.dialog", tokensUsed: 1000, durationSeconds: 60 }) === 0.4,
    ),
    makeCheck("无 token 无时长 = 0", calculateCostForUsage({ apiProvider: "doubao", modelName: "volc.speech.dialog" }) === 0),
  ]);
  record("SMK-COST-003-siliconflow", [
    makeCheck(
      "CosyVoice 2000 字符 = ¥0.1",
      calculateCostForUsage({ apiProvider: "siliconflow", modelName: "siliconflow-cosyvoice", tokensUsed: 2000 }) === 0.1,
    ),
    makeCheck(
      "SenseVoice ASR 默认免费",
      getModelCostRate("siliconflow", "siliconflow-sensevoice").per1KChars === 0,
    ),
  ]);

  return results;
}
