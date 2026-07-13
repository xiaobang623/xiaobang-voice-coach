/**
 * Local dev server for Vercel-style api/*.js handlers (port 3099 by default).
 * Used by Vite proxy for /api/admin/* so admin dashboard works without `vercel dev`.
 */
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PORT = Number(process.env.DEV_API_PORT || 3099);
const ENV_LOCAL_PATH = resolve(process.cwd(), ".env.local");

function loadEnvLocal() {
  if (!existsSync(ENV_LOCAL_PATH)) {
    return;
  }

  const file = readFileSync(ENV_LOCAL_PATH, "utf8");
  for (const rawLine of file.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvLocal();

const requiredForAdmin = ["JWT_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_URL"];
const missing = requiredForAdmin.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.warn(`[dev-api] missing env: ${missing.join(", ")} — add to .env.local and restart`);
}

function rewriteVercelRoutes(url) {
  // Mirror vercel.json locally:
  //   /api/admin/(.*) -> /api/admin.js?path=$1
  // Without this, Vite proxy sends /api/admin/auth/login to this dev server,
  // and a file lookup for api/admin/auth/login.js fails.
  if (url.pathname.startsWith("/api/admin/")) {
    url.searchParams.set("path", url.pathname.slice("/api/admin/".length));
    url.pathname = "/api/admin";
  }
}

function resolveHandlerPath(pathname) {
  if (!pathname.startsWith("/api/")) {
    return null;
  }

  const relative = pathname.slice("/api/".length);
  const candidate = resolve(process.cwd(), "api", `${relative}.js`);
  return existsSync(candidate) ? candidate : null;
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function createVercelResponse(nodeRes) {
  const headers = {};
  let statusCode = 200;

  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    setHeader(name, value) {
      headers[name] = value;
      return res;
    },
    json(body) {
      if (!headers["Content-Type"]) {
        headers["Content-Type"] = "application/json; charset=utf-8";
      }
      nodeRes.writeHead(statusCode, headers);
      nodeRes.end(JSON.stringify(body));
    },
    end(data) {
      nodeRes.writeHead(statusCode, headers);
      nodeRes.end(data);
    },
  };

  return res;
}

function createVercelRequest(nodeReq, url, body) {
  const query = {};
  for (const [key, value] of url.searchParams.entries()) {
    query[key] = value;
  }

  return {
    method: nodeReq.method,
    url: `${url.pathname}${url.search}`,
    headers: nodeReq.headers,
    query,
    body,
  };
}

const server = createServer((nodeReq, nodeRes) => {
  void (async () => {
    try {
      const url = new URL(nodeReq.url ?? "/", `http://${nodeReq.headers.host || "localhost"}`);
      rewriteVercelRoutes(url);
      const handlerPath = resolveHandlerPath(url.pathname);

      if (!handlerPath) {
        nodeRes.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        nodeRes.end(JSON.stringify({ success: false, error: `No API handler for ${url.pathname}` }));
        return;
      }

      const body =
        nodeReq.method === "GET" || nodeReq.method === "HEAD" ? null : await readRequestBody(nodeReq);
      const req = createVercelRequest(nodeReq, url, body);
      const res = createVercelResponse(nodeRes);
      const module = await import(pathToFileURL(handlerPath).href);
      const handler = module.default;

      if (typeof handler !== "function") {
        nodeRes.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        nodeRes.end(JSON.stringify({ success: false, error: "Handler is not a function" }));
        return;
      }

      await handler(req, res);
    } catch (error) {
      if (!nodeRes.headersSent) {
        nodeRes.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        nodeRes.end(
          JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
  })();
});

server.on("listening", () => {
  console.log(`[dev-api] listening on http://localhost:${PORT}`);
  console.log("[dev-api] serving api/*.js — use with npm run dev (Vite proxies /api/admin here)");
});

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(`[dev-api] port ${PORT} is already in use.`);
    process.exitCode = 1;
    return;
  }
  console.error("[dev-api] server error", error);
});

server.listen(PORT);
