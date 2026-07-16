# Voice Coach 自动化 Evals

对应设计文档：Obsidian vault `01-Projects/AI口语陪练/Voice Coach Evals评测体系.md`。
本目录是它的**可执行落地**：eval 代码直接 import 生产模块（`report-post-process.js` / `memory-post-process.js` / `directions-post-process.js` / `api/_lib/cost-rates.js`），永远和线上同一份 prompt 与清洗逻辑，不存在「测的和跑的不一样」。

## 命令

| 命令 | 内容 | 成本/耗时 |
|---|---|---|
| `npm run evals:smoke` | 确定性单测：清洗、报告/记忆/方向后处理、掌握度合并、成本单价 | 零成本，<1s |
| `npm run evals` | smoke + report + memory + directions 全量（含 LLM judge） | 调 DeepSeek，约 1–3 分钟，几分钱 |
| `npm run evals:report` | 只跑复盘报告套件 | 同上 |
| `npm run evals:memory` | 只跑记忆提取套件 | 同上 |
| `npm run evals:directions` | 只跑开场方向套件 | 同上 |
| `node evals/run.mjs --no-judge` | 跳过 LLM judge，只留确定性断言 | 更快更省 |
| `node evals/run.mjs --smoke --no-write` | 只执行 gate，不改写结果文件 | CI / pre-push 使用 |

退出码非 0 = gate 未通过（smoke 必须 100%；LLM 套件不得 red）。`git push` 时 pre-push 钩子自动跑 smoke，可用 `SKIP_EVALS=1 git push` 跳过。

## 套件与覆盖

| 套件 | 对应功能模块 | 测什么 |
|---|---|---|
| smoke | 报告清洗、后处理、记忆/掌握度（10.x）、开场方向（1.1）、成本核算（17） | 纯逻辑回归，确定性 |
| report | 复盘报告（5）+ 任务判断 | 纠错召回、ASR 噪声误伤红线、不硬纠错、task done/missed、growth 不编造用户原话、等级判断 |
| memory | 智能体记忆（10）+ 掌握度追踪（10.1） | 隐私红线（0 泄露）、长期事实 vs 一次性事件、合并不丢事实、纠错入掌握度 |
| directions | 开场引导与首轮破冰（1.1，进行中） | 6 条格式、简短、无监控感、个性化贴兴趣、任务场景贴任务 |

**不自动化（保留人工 eval，见 vault 文档 §5/§9）**：ASR/判停/TTS 延迟（16 语音链路实验，需真机音频）、对话感/自然转场（18/18.1，跑在豆包实时链路上，离线无法复现）、端到端会话体验（§6 Live Session Set）。

## 结果与版本对比

- `results/latest.md` — 最近一次 scorecard（进 git）
- `results/history.jsonl` — 每次运行一行：commit、prompt hash、各套件通过率（进 git，做 v1/v2 版本对比）
- `results/runs/*.json` — 完整模型输出，本地排查用（不进 git）

每次运行自动记录 **git commit + 三个 system prompt 的 hash + model + temperature**——改了 prompt 没跑 evals，hash 对不上一眼可见。

## 判分口径

- 确定性断言：硬性 pass/fail（红线类：ASR 噪声误伤、隐私泄露、growth 编造原话）。
- LLM judge：deepseek-chat 按 1–5 rubric 打分，≥4 为 pass（对齐 vault 文档 §4.3）。注意 judge 与被测模型同源，存在自评偏置，红线一律用确定性断言兜底。
- Gate：对齐 vault 文档 §4.5 —— Green ≥85% / Yellow 70–85% / Red <70%；smoke 必须 100%。

## ⚠️ 更新功能时必须同步更新 evals（长期约定）

改动以下任何内容时，**先改/加 eval case，再改代码，改完自动跑对应套件**：

| 你改了什么 | 必须做什么 |
|---|---|
| `report-post-process.js`（prompt/清洗/后处理） | 更新 `suites/report.mjs` + `suites/smoke.mjs`，跑 `npm run evals:report` |
| `memory-post-process.js` | 更新 `suites/memory.mjs` + smoke，跑 `npm run evals:memory` |
| `directions-post-process.js` | 更新 `suites/directions.mjs` + smoke，跑 `npm run evals:directions` |
| `api/_lib/cost-rates.js` 或成本 env | 更新 smoke 的 SMK-COST 断言 |
| 新增会调用 LLM 的功能 | 新建 `suites/<feature>.mjs`，在 `run.mjs` 的 SUITES 注册，README 和 vault eval 文档登记 |
| 其他任何代码改动 | 至少跑 `npm run evals:smoke`（pre-push 也会强制跑） |
