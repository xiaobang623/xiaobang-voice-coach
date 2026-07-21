/**
 * One-off helper for backfilling reports.summary from reports.payload.
 *
 * Dry run (default, no writes):
 *   node scripts/backfill-report-summaries.mjs
 *   node scripts/backfill-report-summaries.mjs --dry-run --limit 200
 *
 * Apply (writes to Supabase; do not run without explicit approval):
 *   node scripts/backfill-report-summaries.mjs --apply
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildReportSummary } from "../api/_lib/report-summary.js";

const ROOT = resolve(import.meta.dirname, "..");
const ENV_PATH = resolve(ROOT, ".env.local");
const PAGE_SIZE = 100;

function parseEnvFile(path) {
  if (!existsSync(path)) {
    return { entries: {}, sources: {} };
  }

  const entries = {};
  const sources = {};
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
    sources[key] = path;
  }
  return { entries, sources };
}

function loadEnv() {
  const parsed = parseEnvFile(ENV_PATH);
  const env = { ...parsed.entries, ...process.env };
  const sources = { ...parsed.sources };
  for (const key of Object.keys(process.env)) {
    if (process.env[key]) {
      sources[key] = "process.env";
    }
  }
  return { env, sources };
}

function readOptionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }

  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

function projectRefFromUrl(url) {
  const match = String(url ?? "").match(/^https:\/\/([^.]+)\.supabase\.co/i);
  return match?.[1] ?? (String(url ?? "").includes("localhost") ? "local" : "unknown");
}

function createSupabaseClient() {
  const { env, sources } = loadEnv();
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("VITE_SUPABASE_URL missing. Set it in .env.local or environment.");
  }
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY missing. Set it in .env.local or environment.");
  }

  const projectRef = projectRefFromUrl(supabaseUrl);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    supabase,
    projectRef,
    environment: projectRef === "local" ? "local development database" : "remote Supabase project",
    supabaseUrlSource: sources.VITE_SUPABASE_URL ?? "unknown",
    serviceRoleKeySource: sources.SUPABASE_SERVICE_ROLE_KEY ?? "unknown",
  };
}

function isEmptyObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);
}

function needsBackfill(row) {
  return !row.summary || isEmptyObject(row.summary) || row.summary.schemaVersion !== 1;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply;
  const maxRows = Math.max(0, Number.parseInt(readOptionValue("--limit", "0"), 10) || 0);
  const info = createSupabaseClient();

  console.log(`[config] database environment: ${info.environment}`);
  console.log(`[config] project ref: ${info.projectRef}`);
  console.log(`[config] VITE_SUPABASE_URL source: ${info.supabaseUrlSource}`);
  console.log(`[config] SUPABASE_SERVICE_ROLE_KEY source: ${info.serviceRoleKeySource}`);
  console.log(`[mode] ${dryRun ? "dry-run (no writes)" : "apply (writes enabled)"}`);

  let scanned = 0;
  let candidates = 0;
  let updated = 0;
  let skippedInvalidPayload = 0;

  while (true) {
    if (maxRows > 0 && scanned >= maxRows) {
      break;
    }

    const from = scanned;
    const to = maxRows > 0
      ? Math.min(scanned + PAGE_SIZE - 1, maxRows - 1)
      : scanned + PAGE_SIZE - 1;

    const { data, error } = await info.supabase
      .from("reports")
      .select("id, session_id, created_at, payload, summary")
      .order("created_at", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to read reports: ${error.message}`);
    }
    if (!data?.length) {
      break;
    }

    scanned += data.length;

    for (const row of data) {
      if (!needsBackfill(row)) {
        continue;
      }

      candidates += 1;
      if (!row.payload || typeof row.payload !== "object") {
        skippedInvalidPayload += 1;
        continue;
      }

      const summary = buildReportSummary(
        {
          ...row.payload,
          sessionId: row.payload.sessionId || row.session_id,
          createdAt: row.payload.createdAt || row.created_at,
        },
        row.created_at,
      );

      if (dryRun) {
        if (candidates <= 5) {
          console.log(`[dry-run] ${row.id} session=${row.session_id} corrections=${summary.correctionCount}`);
        }
        continue;
      }

      const { error: updateError } = await info.supabase
        .from("reports")
        .update({ summary })
        .eq("id", row.id);

      if (updateError) {
        throw new Error(`Failed to update report ${row.id}: ${updateError.message}`);
      }
      updated += 1;
    }

    if (data.length < PAGE_SIZE) {
      break;
    }
  }

  console.log(`[done] scanned=${scanned} candidates=${candidates} updated=${updated} skippedInvalidPayload=${skippedInvalidPayload}`);
  if (dryRun) {
    console.log("[next] run with --apply to write summaries after checking the dry-run output.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
