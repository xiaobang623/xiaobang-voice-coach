# 小榜 Voice Coach · 仓库约定

- 项目文档（PRD / 开发日志 / 速查表）在 Obsidian vault：`/Users/cyforia/xiaobang/01-Projects/AI口语陪练/`
- 技术栈：Vite + React 19 + Tailwind 4 · 豆包实时语音（Railway proxy）· DeepSeek · Supabase
- 线上：https://xiaobang-voice-coach.vercel.app

## 改完代码自动 run（用户长期约定）

每次完成代码改动后，自动执行 `.claude/skills/run/SKILL.md`（项目 run skill），不用用户开口：

1. 查端口（5173/8080/8081/3099/8090），只补缺的服务，全部后台启动
2. 改 `src/**` → Vite HMR 自动生效，不重启；改 `backend/server.js` / `proxy.js` / `dev-api-server.js` / `report-server.js` → 重启对应端口服务
3. 冒烟验证后给用户链接：练习页 http://localhost:5173/ · 管理后台 http://localhost:5173/admin/login
4. 注明这次验证应该看什么
