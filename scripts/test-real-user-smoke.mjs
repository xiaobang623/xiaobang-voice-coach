import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import assert from "node:assert/strict";
import WebSocket from "ws";

const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:5175/";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT ?? 9_300 + Math.floor(Math.random() * 500));

async function getJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}`);
  }
  return response.json();
}

async function waitFor(fn, label, timeoutMs = 10_000) {
  const startedAt = Date.now();
  let last;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${label}${last instanceof Error ? `: ${last.message}` : ""}`);
}

async function isReachable(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

class CdpPage {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.errors = [];
    this.ws.on("message", (buffer) => {
      const message = JSON.parse(buffer.toString());
      if (message.method) {
        this.events.push(message);
        if (message.method === "Runtime.exceptionThrown") {
          this.errors.push({ type: "exception", detail: message.params.exceptionDetails?.text ?? "exception" });
        }
        if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
          this.errors.push({ type: "console", detail: message.params.args?.map((arg) => arg.value ?? arg.description).join(" ") });
        }
        if (message.method === "Log.entryAdded" && message.params.entry?.level === "error") {
          const text = message.params.entry.text ?? "";
          const url = message.params.entry.url ?? "";
          // Ignore harmless browser chrome noise that does not affect the app flow.
          if (!url.endsWith("/favicon.ico")) {
            this.errors.push({ type: "log", detail: `${text} ${url}`.trim() });
          }
        }
      }
      if (message.id && this.pending.has(message.id)) {
        this.pending.get(message.id)(message);
        this.pending.delete(message.id);
      }
    });
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });
    await this.send("Runtime.enable");
    await this.send("Page.enable");
    await this.send("Log.enable");
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => this.pending.set(id, resolve));
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.result?.exceptionDetails) {
      throw new Error(response.result.exceptionDetails.text ?? "Evaluation failed");
    }
    return response.result?.result?.value;
  }

  async text() {
    return this.evaluate("document.body.innerText");
  }

  async rootChildCount() {
    return this.evaluate("document.getElementById('root')?.childElementCount ?? 0");
  }

  async clickText(text) {
    return this.evaluate(`(() => {
      const targetText = ${JSON.stringify(text)};
      const candidates = [...document.querySelectorAll('button, a, [role="button"], [tabindex], .cursor-pointer')];
      const match = candidates.find((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (el.innerText || el.textContent || '').includes(targetText);
      });
      if (!match) return false;
      match.scrollIntoView({ block: 'center', inline: 'center' });
      match.click();
      return true;
    })()`);
  }

  async clickFirstContaining(text) {
    return this.evaluate(`(() => {
      const targetText = ${JSON.stringify(text)};
      const candidates = [...document.querySelectorAll('button, a, [role="button"], [tabindex], div, section')];
      const match = candidates.find((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (el.innerText || el.textContent || '').includes(targetText);
      });
      if (!match) return false;
      match.scrollIntoView({ block: 'center', inline: 'center' });
      match.click();
      return true;
    })()`);
  }

  close() {
    this.ws.close();
  }
}

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=/tmp/xiaobang-real-user-${Date.now()}`,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
  { stdio: "ignore" },
);
let vite = null;

try {
  if (!(await isReachable(APP_URL))) {
    const parsedUrl = new URL(APP_URL);
    vite = spawn(
      "npm",
      [
        "run",
        "dev",
        "--",
        "--host",
        parsedUrl.hostname,
        "--port",
        parsedUrl.port || "5175",
        "--strictPort",
      ],
      { stdio: "ignore" },
    );
    await waitFor(() => isReachable(APP_URL), "Vite dev server", 15_000);
  }

  await waitFor(() => getJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`), "Chrome CDP");
  const newPage = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(APP_URL)}`, { method: "PUT" });
  const page = new CdpPage(newPage.webSocketDebuggerUrl);
  await page.open();
  await page.send("Page.navigate", { url: APP_URL });

  const homeText = await waitFor(async () => {
    const text = await page.text();
    return text.includes("选择场景") ? text : false;
  }, "home screen");
  assert.match(homeText, /开始练习|开始对话/);
  assert.match(homeText, /今天过得怎么样/);

  assert.equal(await page.clickText("今天过得怎么样"), true, "topic card should be clickable");
  const prepText = await waitFor(async () => {
    const text = await page.text();
    return text.includes("我准备好了") || text.includes("正在连接") || text.includes("准备")
      ? text
      : false;
  }, "chat prep screen");
  assert.match(prepText, /今天过得怎么样|准备|我准备好了/);

  const clickedReady = await page.clickText("我准备好了");
  if (clickedReady) {
    await sleep(2_000);
  }
  const afterReadyRootChildren = await page.rootChildCount();
  assert.ok(afterReadyRootChildren > 0, "page should stay rendered after ready click");

  // Return from chat / connecting state; this is the highest-risk UI escape path for a real user.
  const clickedBack = (await page.clickText("返回")) || (await page.clickText("← 返回"));
  assert.equal(clickedBack, true, "back button should be clickable");
  await waitFor(async () => (await page.text()).includes("选择场景"), "back to home");

  const clickedMe = await page.clickText("我的");
  assert.equal(clickedMe, true, "Me tab should be clickable");
  await waitFor(async () => {
    const text = await page.text();
    return text.includes("登录") || text.includes("语言能力档案") || text.includes("练习记录") || text.includes("我的");
  }, "me/growth screen");
  const meText = await page.text();
  assert.ok(!meText.includes("小榜记得的关于你") || !meText.includes("登录后"), "guest memory block should not be shown as remembered facts");

  const severeErrors = page.errors.filter((error) => {
    const detail = String(error.detail ?? "");
    return (
      !detail.includes("favicon.ico") &&
      !detail.includes("apple-mobile-web-app-capable") &&
      // In local smoke tests the voice websocket/proxy may be intentionally absent.
      // The assertion above verifies the UI stays rendered and escapable after the
      // ready click; this dependency error is reported by Chrome but is not a React
      // crash or memory-regression failure.
      !detail.includes("ws://localhost:8081/ws") &&
      !detail.includes("net::ERR_CONNECTION_REFUSED")
    );
  });

  if (severeErrors.length > 0) {
    throw new Error(`Browser errors: ${JSON.stringify(severeErrors, null, 2)}`);
  }

  page.close();
  console.log("real user smoke test passed");
} finally {
  chrome.kill("SIGTERM");
  if (vite) {
    vite.kill("SIGTERM");
  }
}
