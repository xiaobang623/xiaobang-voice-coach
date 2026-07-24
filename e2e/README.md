# Voice Coach E2E UI 自动化

本目录是浏览器层回归测试，和 `evals/` 完全独立：

- `evals/`：评估 AI 输出质量、prompt/后处理、记忆隐私等逻辑层能力。
- `e2e/`：用 Playwright 在移动端 Chromium 里模拟真实用户点击，检查导航、页面状态、权限边界、表单持久化和 console/runtime 崩溃。

## 命令

| 命令 | 内容 | 说明 |
|---|---|---|
| `npm run e2e` | 跑全部 Playwright spec | 自动启动 `npm run dev -- --port 5173`；本地通常几十秒内完成 |
| `npm run e2e:ui` | 打开 Playwright UI 调试 | 适合定位失败用例、查看 trace |
| `npx playwright show-report` | 查看上次 HTML 报告 | 失败截图、video、trace 会保存在 Playwright 输出目录 |

`playwright.config.ts` 只启动前台 Vite dev server。Admin API、报告 API、语音后台、Supabase 都由 Playwright `page.route` / mock WebSocket 固定返回，避免真实 LLM/语音网络导致用例不稳定。

## 覆盖矩阵

| PRD # | 功能模块 | 覆盖 spec | 覆盖口径 |
|---|---|---|---|
| 1 | 话题选择 | `tests/topic-and-onboarding.spec.ts` | 首页文案、话题卡点击、自由/场景入口可见 |
| 1.1 | 开场引导与首轮破冰 | `tests/topic-and-onboarding.spec.ts` | 半屏准备页、连接/就绪状态、点「我准备好了」后进入收音态 |
| 2 | 实时语音对话 | `tests/chat-session.spec.ts` | mock 自建语音 WebSocket，验证会话 UI 不崩溃、可发出一轮文本输入 |
| 3 | 聊天界面 | `tests/chat-session.spec.ts` | 用户气泡、Coach 气泡、字幕开关入口 |
| 4 | 会话个性化 | `tests/chat-session.spec.ts`, `tests/preferences-and-nav.spec.ts` | 会话内语速/字幕控制、默认偏好带入新会话 |
| 5 | 复盘报告 | `tests/report.spec.ts` | 生成中 / 失败 / 就绪三态；就绪报告结构渲染 |
| 7 | 存储持久化 | `tests/report.spec.ts`, `tests/preferences-and-nav.spec.ts` | 游客报告不保存提示；游客偏好写入 localStorage |
| 8 | 历史回看 | `tests/growth-and-history.spec.ts` | 成长页历史复盘列表、展开后按需展示报告详情 |
| 9 | 账号系统 | `tests/account.spec.ts` | 游客态权限边界、登录/注册表单、注册后用户态 |
| 10.1 | 掌握度追踪与复用识别 | `tests/report.spec.ts`, `tests/growth-and-history.spec.ts` | 报告「你把上次学的用出来了」区块；表达掌握度分组 |
| 11 | 成长记录页 | `tests/growth-and-history.spec.ts` | 统计卡、最近复盘、练习次数/时长 |
| 11.1 | 掌握度视图 + 进步趋势 | `tests/growth-and-history.spec.ts` | 未掌握 / 复习中 / 已掌握 tab 数据展示 |
| 12 | 练习偏好同步 | `tests/preferences-and-nav.spec.ts` | 音色/语速/字幕本地持久化，刷新后保留 |
| 13 | 底部导航 | `tests/preferences-and-nav.spec.ts` | 练习 / 我的双 Tab 切换 |
| 15 | 语言等级体系与对比 | `tests/growth-and-history.spec.ts` | B2 当前等级、A1–C2 等级体系展示 |
| 17 | 管理后台与成本核算 | `tests/admin.spec.ts` | `/admin` 登录、今日数据、成本、用户/会话看板冒烟 |
| 6 | 实时轻提示 | 未覆盖 | UI 未完整落地，先不做自动化 |
| 16 | 自建语音链路实验 | 未覆盖真实链路 | 本目录只 mock WebSocket；真实链路需人工/专项联调 |
| 18 | 对话感/聊伴人格 | 未覆盖 | 需要真人听感或 LLM judge，不适合浏览器结构断言 |

## 不自动化的部分

- 真实 ASR 识别准确率：需要真实音频输入、口音/环境样本，交给人工或专项音频评测。
- 真实 TTS 音质/延迟：需要听感和硬件链路，不在无头浏览器里判断。
- 对话是否自然、有陪练感：属于内容体验，继续交给人工评审或 `evals/` 的 LLM judge。
- 复盘报告纠错是否准确：这是 `evals/` 的职责；E2E 只断言报告页面三态和结构是否渲染。

## Mock 策略

- `e2e/fixtures/report-ready.json`：固定复盘报告，用于报告就绪态与复用识别区块。
- `e2e/fixtures/growth-data.json`：固定成长页数据，用于历史、掌握度、等级体系。
- `e2e/fixtures/admin-data.json`：固定后台看板数据。
- `e2e/support/test.ts`：统一 mock：
  - `/api/voice-backend-config` 返回 selfhosted + SiliconFlow voice profile。
  - `/api/check-quota`, `/api/issue-voice-token`, `/api/log-event`, `/api/persist-session` 固定成功。
  - `/api/generate-directions` 返回固定开场方向。
  - `WebSocket('ws://localhost:8081/ws')` 被替换成内存 mock：收到 `start` 后发 `ready`，收到 `text-query` 后发固定 Coach 气泡。
  - Supabase Auth/REST 指向 `http://127.0.0.1:5173/e2e-supabase`，由 Playwright route 返回匿名/注册用户和资料数据。

测试里不硬编码任何真实密钥或真实环境变量。

## 新增功能时怎么加用例

1. 先判断边界：如果是 UI 点击、导航、权限、状态、设置持久化，放到 `e2e/tests/`；如果是 AI 生成质量，放到 `evals/`。
2. 按 PRD 模块选择已有 spec；跨模块的新流程可新建 `tests/<feature>.spec.ts`。
3. 优先用 role/text/label/title selector；避免依赖 Tailwind class 和像素位置。
4. 所有真实 LLM/语音/存储请求都要在 `support/test.ts` 或该 spec 内 route mock；断言结构和状态，不断言 AI 措辞。
5. 新增 mock 数据放 `e2e/fixtures/`，并在本 README 的覆盖矩阵补上模块编号、覆盖口径或跳过原因。
6. 本地跑 `npm run e2e` 和 `npm run build`；普通 push 不自动跑 e2e，避免多个服务 + 真浏览器拖慢 pre-push。

## 旧 smoke 脚本迁移说明

原 `scripts/test-real-user-smoke.mjs` 覆盖的「首页 → 话题卡 → 准备页 → 我准备好了 → 返回 → 我的页」路径，已迁移到：

- `tests/topic-and-onboarding.spec.ts`
- `tests/account.spec.ts`
- `tests/preferences-and-nav.spec.ts`

因此旧 CDP 手写脚本已删除，避免同一条冒烟路径维护两份实现。
