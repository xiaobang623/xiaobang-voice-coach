---
name: run
description: 启动/检查小榜 Voice Coach 本地全套服务（Vite 前端 + 豆包 proxy + 自建语音后台 + Admin API + 报告服务），冒烟验证后给出访问链接。用户说「run 一下 / 起服务 / 给我链接」或改完代码要真机验证时使用。
---

# 小榜 Voice Coach · 本地运行

仓库根目录：`/Users/cyforia/xiaobang-voice-coach`

## 服务清单与端口

| 服务 | 端口 | 启动命令 | 什么时候需要 |
|------|------|----------|--------------|
| Vite 前端 | 5173 | `npm run dev` | 永远需要 |
| 豆包语音 proxy | 8080 | `npm run proxy` | 主线（豆包端到端）对话 |
| 自建语音后台 | 8081 | `npm run selfhosted-voice` | 第四期链路：平台原生 ASR / Whisper / CosyVoice / SiliconFlow |
| Admin API | 3099 | `npm run dev:api` | 管理后台 `/admin/*` |
| 报告/记忆 API | 8090 | `npm run report-server` | 结束对话生成复盘、记忆提取 |

## 标准流程

1. **先查端口，只补缺的**（服务常驻，不要重复起）：

```bash
lsof -iTCP:5173 -iTCP:8080 -iTCP:8081 -iTCP:3099 -iTCP:8090 -sTCP:LISTEN -P
```

2. 缺哪个就在**后台**启动哪个（`run_in_background: true`，cwd 用仓库根目录）。

3. **冒烟验证**再报结果：

```bash
curl -sf -o /dev/null -w "vite: %{http_code}\n" http://localhost:5173/
```

- 自建语音后台就绪标志（看后台任务输出）：`listening on localhost:8081`、`cosyvoice ready`、`siliconflow asr warmup ok`
- `whisper health check failed` 可忽略（本地 Whisper 不常开，平台原生 ASR / SiliconFlow 链路用不到）

4. **给用户链接**（固定这几个）：
   - 练习页：http://localhost:5173/
   - 管理后台：http://localhost:5173/admin/login
   - 线上对照：https://xiaobang-voice-coach.vercel.app

## 改动后要不要重启？

| 改了什么 | 动作 |
|----------|------|
| `src/**`（前端，含 `adapters/asr/platformNative.ts`） | **不用重启**，Vite HMR 自动热更新，刷新浏览器即可 |
| `backend/server.js`（自建语音后台） | 重启 8081：杀掉旧进程再 `npm run selfhosted-voice` |
| `proxy.js` | 重启 8080 |
| `dev-api-server.js` | 重启 3099 |
| `report-server.js` / `api/**` | 重启 8090 |

杀进程：`lsof -tiTCP:<端口> -sTCP:LISTEN | xargs kill`

## 约定：改完代码自动 run

每次完成代码改动后，**不用用户开口**，自动执行本 skill：查端口→补缺/按上表重启受影响服务→冒烟→把访问链接发给用户，并注明这次验证应该看什么（如「说一段带停顿的句子，应只出一个气泡」）。
