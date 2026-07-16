/**
 * 开场方向 LLM 套件（进行中功能 1.1 开场引导与首轮破冰）。
 * 走与生产 api/generate-directions.js 相同的
 * DIRECTIONS_SYSTEM_PROMPT + buildDirectionsUserPrompt + postProcessDirections 链路。
 *
 * 红线：个性化不能有监控感（不出现「上次你说过」式表达）；失败必须返回 null 走静态池回退。
 */

import {
  DIRECTIONS_SYSTEM_PROMPT,
  buildDirectionsUserPrompt,
  postProcessDirections,
} from "../../directions-post-process.js";
import { callDeepseekJson, judgeCase, makeCheck, runCases } from "../lib/harness.mjs";

export const name = "directions";
export const kind = "llm";

const SURVEILLANCE_RE = /上次|你说过|你提到|我记得|还记得/;

const CASES = [
  {
    id: "VC-DIR-001-free-topic",
    input: {
      title: "旅行见闻",
      description: "聊聊你去过或想去的地方",
      promptSeed: "The user wants to practice talking about travel experiences.",
    },
    judge: "Six directions should be fresh, concrete angles about travel (not restatements of the topic title), casual Chinese, each with a short usable English starter phrase.",
  },
  {
    id: "VC-DIR-002-personalized-no-surveillance",
    input: {
      title: "自由聊天",
      description: "想聊什么都可以",
      userMemoryBlock:
        "Learner level: intermediate. Enjoys talking about: coffee, video games. Frequent mistakes: past tense. A useful expression to reuse: 'Could I get a refill?'",
    },
    personalized: true,
    reuseTarget: "refill",
    judge: "At least one direction should softly connect to the learner's interests (coffee / video games), and one direction's en should let the learner naturally reuse 'Could I get a refill?' (or close variant), WITHOUT any surveillance phrasing ('上次', '你说过', '我记得'). Directions must feel like a friend's suggestions.",
  },
  {
    id: "VC-DIR-003-task-cafe",
    input: {
      title: "咖啡店点单",
      description: "在咖啡店完成一次英文点单",
      promptSeed: "Task scenario: the user practices ordering a drink at a cafe — asking price, customizing, closing politely.",
    },
    judge: "Directions should map to the cafe-ordering task (customization, price, small talk with barista, polite closing), not generic coffee chat.",
  },
];

export async function run({ judgeEnabled = true, concurrency = 3 } = {}) {
  return runCases(
    CASES,
    async (testCase) => {
      const raw = await callDeepseekJson({
        system: DIRECTIONS_SYSTEM_PROMPT,
        user: buildDirectionsUserPrompt(testCase.input),
        temperature: 0,
      });

      const directions = postProcessDirections(raw);
      const checks = [];

      checks.push(makeCheck("后处理通过（≥3 条可用，否则应回退静态池）", directions !== null, JSON.stringify(raw).slice(0, 200)));
      if (directions) {
        const joined = JSON.stringify(directions);
        checks.push(makeCheck("产出 6 条左右（≥5）", directions.length >= 5, `实际 ${directions.length} 条`));
        checks.push(
          makeCheck(
            "zh 简短（≤20 字，prompt 要求 <14）",
            directions.every((d) => d.zh.length <= 20),
            directions.map((d) => `${d.zh}(${d.zh.length})`).join(" / "),
          ),
        );
        checks.push(
          makeCheck(
            "en 起手短语 ≤8 词",
            directions.every((d) => !d.en || d.en.split(/\s+/).length <= 8),
            directions.map((d) => d.en ?? "").join(" / "),
          ),
        );
        checks.push(makeCheck("无监控感表达（上次/你说过/我记得…）", !SURVEILLANCE_RE.test(joined), joined));
        if (testCase.reuseTarget) {
          checks.push(
            makeCheck(
              "有一条方向承接记忆里的目标复用句式",
              joined.toLowerCase().includes(testCase.reuseTarget),
              joined,
            ),
          );
        }
      }

      let judge;
      if (judgeEnabled && testCase.judge && directions) {
        judge = await judgeCase({ criteria: testCase.judge, input: testCase.input, output: directions });
      }

      return { checks, judge, output: directions };
    },
    { concurrency },
  );
}
