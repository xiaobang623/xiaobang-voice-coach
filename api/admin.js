import authLogin from "../serverless-admin/auth-login.js";
import authLogout from "../serverless-admin/auth-logout.js";
import authReset from "../serverless-admin/auth-reset.js";
import authSetup from "../serverless-admin/auth-setup.js";
import dashboardSummary from "../serverless-admin/dashboard-summary.js";
import funnelSummary from "../serverless-admin/funnel-summary.js";
import me from "../serverless-admin/me.js";
import modelInstances from "../serverless-admin/model-instances.js";
import sessions from "../serverless-admin/sessions.js";
import tokenSummary from "../serverless-admin/token-summary.js";
import users from "../serverless-admin/users.js";
import voiceConfig from "../serverless-admin/voice-config.js";
import { json, setJsonCors } from "./_lib/http.js";

const ROUTES = new Map([
  ["auth/login", authLogin],
  ["auth/logout", authLogout],
  ["auth/reset", authReset],
  ["auth/setup", authSetup],
  ["dashboard-summary", dashboardSummary],
  ["funnel-summary", funnelSummary],
  ["me", me],
  ["model-instances", modelInstances],
  ["sessions", sessions],
  ["token-summary", tokenSummary],
  ["users", users],
  ["voice-config", voiceConfig],
]);

function normalizePath(path) {
  return String(path ?? "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

export default async function handler(req, res) {
  setJsonCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const path = normalizePath(url.searchParams.get("path"));
  const route = ROUTES.get(path);

  if (!route) {
    json(res, 404, { success: false, error: `Unknown admin route: ${path || "/"}` });
    return;
  }

  return route(req, res);
}
