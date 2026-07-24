# 小榜 Voice Coach · 仓库约定

- 项目文档（PRD / 开发日志 / 速查表）在 Obsidian vault：`/Users/cyforia/xiaobang/01-Projects/AI口语陪练/`
- 技术栈：Vite + React 19 + Tailwind 4 · 豆包实时语音（Railway proxy）· DeepSeek · Supabase
- 线上：https://xiaobang-voice-coach.vercel.app

## 改完代码自动跑 Evals（用户长期约定）

每次完成功能改动后，**自动跑 evals，不用用户开口**（体系说明见 `evals/README.md`）：

1. 任何代码改动 → `npm run evals:smoke`（零成本，秒级，必须 100% 通过；pre-push 钩子也会强制跑）
2. 改到 `report-post-process.js` / `memory-post-process.js` / `directions-post-process.js` / `api/generate-*.js`（prompt、清洗、后处理）→ 额外跑对应 LLM 套件：`npm run evals:report` / `evals:memory` / `evals:directions`
3. 上线前 / 换模型 / 大改 prompt → `npm run evals` 全量，对比 `evals/results/history.jsonl` 里上一版的通过率和 judge 分

**更新功能必须同步更新 evals**：新增或修改会影响模型输出/用户流程的功能时，先在 `evals/suites/` 加或改 case（新套件要在 `evals/run.mjs` 的 SUITES 注册），再改代码；改完把结果一句话汇报给用户（哪个套件、通过率、judge 发现了什么）。

## 改完代码自动 run（用户长期约定）

每次完成代码改动后，自动执行 `.claude/skills/run/SKILL.md`（项目 run skill），不用用户开口：

1. 查端口（5173/8080/8081/3099/8090），只补缺的服务，全部后台启动
2. 改 `src/**` → Vite HMR 自动生效，不重启；改 `backend/server.js` / `proxy.js` / `dev-api-server.js` / `report-server.js` → 重启对应端口服务
3. 冒烟验证后给用户链接：练习页 http://localhost:5173/ · 管理后台 http://localhost:5173/admin/login
4. 注明这次验证应该看什么

## UI / 响应式设计约定

以后新增或修改任何前端 UI，默认必须一起覆盖窄屏样式，不需要用户额外提醒：

- 至少检查 `320px / 375px / 430px / 768px / 1024px` 五档宽度。
- 绝对定位装饰图（尤其 `Mascot` / 插画 / 浮层）必须有独立的移动端尺寸、位置和文字安全区，不能遮挡主标题、说明文案、按钮或可点击区域。
- 首页、对话页、报告页等主流程组件优先 mobile-first 写法，再逐级放大到平板和桌面。
- 改视觉时优先复用现有 design tokens、`Card` / `Button` / `Mascot` / `eyebrow` / `section-title`，不要自造一套视觉语言。
- UI 改动完成后，除了 `npm run build` / `npm run evals:smoke`，还要说明已覆盖哪些关键屏宽；能本地截图/浏览器验证时优先做。
