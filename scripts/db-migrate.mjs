/**
 * Apply pending SQL migrations via Supabase Management API.
 * Requires: VITE_SUPABASE_URL in .env.local + `supabase login` access token.
 *
 * Usage: node scripts/db-migrate.mjs [migration-file]
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const ENV_PATH = resolve(ROOT, ".env.local");
const TOKEN_PATH = resolve(homedir(), ".config/supabase/access-token");

function parseEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }
  const entries = {};
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const index = line.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    entries[key] = value;
  }
  return entries;
}

function projectRefFromUrl(url) {
  const match = url.match(/^https:\/\/([^.]+)\.supabase\.co/i);
  return match?.[1] ?? null;
}

async function runQuery({ token, projectRef, sql }) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Migration failed (${response.status}): ${body}`);
  }
  return body;
}

const migrationArg = process.argv[2] ?? "supabase/migrations/0002_profile_preferences.sql";
const migrationPath = resolve(ROOT, migrationArg);

if (!existsSync(migrationPath)) {
  console.error(`[db-migrate] file not found: ${migrationPath}`);
  process.exit(1);
}

const sql = readFileSync(migrationPath, "utf8").trim();
if (!sql) {
  console.error("[db-migrate] migration file is empty");
  process.exit(1);
}

const env = parseEnvFile(ENV_PATH);
const supabaseUrl = env.VITE_SUPABASE_URL;
const projectRef = projectRefFromUrl(supabaseUrl ?? "");

if (!projectRef) {
  console.error("[db-migrate] VITE_SUPABASE_URL missing or invalid in .env.local");
  process.exit(1);
}

if (!existsSync(TOKEN_PATH)) {
  console.error("[db-migrate] Supabase access token not found.");
  console.error("Run once: npx supabase login   (or install CLI and run supabase login)");
  process.exit(1);
}

const token = readFileSync(TOKEN_PATH, "utf8").trim();
if (!token) {
  console.error("[db-migrate] Supabase access token is empty. Run: supabase login");
  process.exit(1);
}

console.log(`[db-migrate] applying ${migrationArg} to project ${projectRef}...`);

try {
  await runQuery({ token, projectRef, sql });
  console.log("[db-migrate] done.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
