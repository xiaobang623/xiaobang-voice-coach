/**
 * One-off helper for inspecting/backfilling memory.summary.trackedExpressions.
 *
 * Read-only sample:
 *   node scripts/backfill-tracked-expressions.mjs --sample [--limit 30]
 *
 * Dry run (default, no writes):
 *   node scripts/backfill-tracked-expressions.mjs --dry-run
 *   node scripts/backfill-tracked-expressions.mjs
 *
 * Apply (writes to Supabase; do not run without explicit approval):
 *   node scripts/backfill-tracked-expressions.mjs --apply
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { normalizeExpressionKey } from "../memory-post-process.js";

const ROOT = resolve(import.meta.dirname, "..");
const ENV_PATH = resolve(ROOT, ".env.local");
const DEFAULT_SAMPLE_LIMIT = 30;
const DEFAULT_EXAMPLE_LIMIT = 8;
const PAGE_SIZE = 100;
const MAX_SAMPLE_ROWS_TO_SCAN = 2_000;

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

function printUsage() {
  console.log(`Usage:
  node scripts/backfill-tracked-expressions.mjs --sample [--limit 30]
  node scripts/backfill-tracked-expressions.mjs [--dry-run] [--examples 8]
  node scripts/backfill-tracked-expressions.mjs --apply [--examples 8]

--sample is read-only and prints raw frequentMistakes text.
--dry-run is the default and prints planned conversions without writing.
--apply writes memory.summary.trackedExpressions to Supabase.`);
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
  const environment = projectRef === "local" ? "local development database" : "remote Supabase project";
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    supabase,
    projectRef,
    environment,
    supabaseUrlSource: sources.VITE_SUPABASE_URL ?? "unknown",
    serviceRoleKeySource: sources.SUPABASE_SERVICE_ROLE_KEY ?? "unknown",
  };
}

function printEnvironmentInfo(info) {
  console.log(`[config] database environment: ${info.environment}`);
  console.log(`[config] project ref: ${info.projectRef}`);
  console.log(`[config] VITE_SUPABASE_URL source: ${info.supabaseUrlSource}`);
  console.log(`[config] SUPABASE_SERVICE_ROLE_KEY source: ${info.serviceRoleKeySource}`);
}

async function sampleFrequentMistakes() {
  const info = createSupabaseClient();
  printEnvironmentInfo(info);

  const limit = Math.max(1, Number.parseInt(readOptionValue("--limit", DEFAULT_SAMPLE_LIMIT), 10));
  const samples = [];
  let rowsScanned = 0;
  let rowsWithFrequentMistakes = 0;

  while (samples.length < limit && rowsScanned < MAX_SAMPLE_ROWS_TO_SCAN) {
    const from = rowsScanned;
    const to = Math.min(rowsScanned + PAGE_SIZE - 1, MAX_SAMPLE_ROWS_TO_SCAN - 1);
    const { data, error } = await info.supabase
      .from("memory")
      .select("updated_at, summary")
      .order("updated_at", { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to read memory rows: ${error.message}`);
    }
    if (!data?.length) {
      break;
    }

    rowsScanned += data.length;

    for (const row of data) {
      const frequentMistakes = row?.summary?.frequentMistakes;
      if (!Array.isArray(frequentMistakes) || frequentMistakes.length === 0) {
        continue;
      }

      rowsWithFrequentMistakes += 1;

      for (const item of frequentMistakes) {
        samples.push({
          updatedAt: row.summary?.updatedAt ?? row.updated_at ?? null,
          text: item,
        });
        if (samples.length >= limit) {
          break;
        }
      }

      if (samples.length >= limit) {
        break;
      }
    }
  }

  console.log("[sample] read-only frequentMistakes sample");
  console.log(`[sample] rows scanned: ${rowsScanned}`);
  console.log(`[sample] rows with frequentMistakes: ${rowsWithFrequentMistakes}`);
  console.log(`[sample] sample items: ${samples.length}`);
  console.log("");

  if (samples.length === 0) {
    console.log("[sample] no frequentMistakes found.");
    return;
  }

  samples.forEach((sample, index) => {
    console.log(`${index + 1}. updatedAt=${sample.updatedAt ?? "(unknown)"}`);
    console.log(`   ${JSON.stringify(sample.text)}`);
  });
}

function stripOuterQuotes(value) {
  let text = String(value ?? "").trim();
  let changed = true;
  while (changed && text.length >= 2) {
    changed = false;
    const first = text.at(0);
    const last = text.at(-1);
    const quotePairs = new Map([
      ["'", "'"],
      ['"', '"'],
      ["‘", "’"],
      ["“", "”"],
    ]);
    if (quotePairs.get(first) === last) {
      text = text.slice(1, -1).trim();
      changed = true;
    }
  }
  return text;
}

function cleanLegacySide(value) {
  let text = String(value ?? "").trim();
  const labelQuotedMatch = text.match(/^[^:：]{1,80}[:：]\s*(['"‘“])(.+?)(['"’”])\s*$/u);
  if (labelQuotedMatch) {
    text = labelQuotedMatch[2];
  }
  return stripOuterQuotes(text);
}

export function parseLegacyFrequentMistake(rawText) {
  const text = String(rawText ?? "").trim();
  const delimiterMatch = text.match(/\s*(→|->|=>)\s*/u);
  if (!delimiterMatch || delimiterMatch.index == null) {
    const cleaned = cleanLegacySide(text);
    return { originalText: cleaned, targetText: cleaned };
  }

  const delimiterStart = delimiterMatch.index;
  const delimiterEnd = delimiterStart + delimiterMatch[0].length;
  const originalText = cleanLegacySide(text.slice(0, delimiterStart));
  const targetText = cleanLegacySide(text.slice(delimiterEnd));
  return {
    originalText: originalText || targetText || text,
    targetText: targetText || originalText || text,
  };
}

function legacyId(userId, targetText) {
  const normalizedTargetText = normalizeExpressionKey(targetText);
  const digest = createHash("md5").update(`${userId}${normalizedTargetText}`).digest("hex");
  return `legacy-${digest}`;
}

export function buildLegacyTrackedExpression({ userId, rawText, seenAt }) {
  const parsed = parseLegacyFrequentMistake(rawText);
  const targetText = String(parsed.targetText ?? "").trim();
  if (!targetText) {
    return null;
  }

  return {
    id: legacyId(userId, targetText),
    sourceType: "correction",
    originalText: String(parsed.originalText ?? "").trim(),
    targetText,
    category: "未分类",
    status: "unmastered",
    firstSeenAt: seenAt,
    lastSeenAt: seenAt,
    reuseCount: 0,
  };
}

function existingTargetKeys(trackedExpressions) {
  const keys = new Set();
  if (!Array.isArray(trackedExpressions)) {
    return keys;
  }

  for (const item of trackedExpressions) {
    const key = normalizeExpressionKey(item?.targetText);
    if (key) {
      keys.add(key);
    }
  }
  return keys;
}

async function runBackfill({ apply }) {
  const info = createSupabaseClient();
  printEnvironmentInfo(info);
  console.log(`[mode] ${apply ? "APPLY (writes enabled)" : "DRY RUN (no writes)"}`);

  const exampleLimit = Math.max(1, Number.parseInt(readOptionValue("--examples", DEFAULT_EXAMPLE_LIMIT), 10));
  const examples = [];
  let rowsScanned = 0;
  let usersWithLegacyFrequentMistakes = 0;
  let usersPlannedForUpdate = 0;
  let plannedNewExpressions = 0;
  let skippedDuplicates = 0;
  let skippedEmpty = 0;
  let updatedUsers = 0;

  while (true) {
    const from = rowsScanned;
    const to = rowsScanned + PAGE_SIZE - 1;
    const { data, error } = await info.supabase
      .from("memory")
      .select("user_id, updated_at, summary")
      .order("updated_at", { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to read memory rows: ${error.message}`);
    }
    if (!data?.length) {
      break;
    }

    rowsScanned += data.length;

    for (const row of data) {
      const summary = row.summary && typeof row.summary === "object" ? row.summary : {};
      const frequentMistakes = Array.isArray(summary.frequentMistakes)
        ? summary.frequentMistakes
        : [];
      if (frequentMistakes.length === 0) {
        continue;
      }

      usersWithLegacyFrequentMistakes += 1;

      const existingTrackedExpressions = Array.isArray(summary.trackedExpressions)
        ? summary.trackedExpressions
        : [];
      const targetKeys = existingTargetKeys(existingTrackedExpressions);
      const seenAt = String(summary.updatedAt ?? row.updated_at ?? new Date().toISOString());
      const additions = [];

      for (const rawText of frequentMistakes) {
        const expression = buildLegacyTrackedExpression({
          userId: row.user_id,
          rawText,
          seenAt,
        });
        if (!expression) {
          skippedEmpty += 1;
          continue;
        }

        const key = normalizeExpressionKey(expression.targetText);
        if (!key || targetKeys.has(key)) {
          skippedDuplicates += 1;
          continue;
        }

        targetKeys.add(key);
        additions.push(expression);
        plannedNewExpressions += 1;

        if (examples.length < exampleLimit) {
          examples.push({
            userId: row.user_id,
            rawText,
            expression,
          });
        }
      }

      if (additions.length === 0) {
        continue;
      }

      usersPlannedForUpdate += 1;

      if (apply) {
        const nextSummary = {
          ...summary,
          trackedExpressions: [...existingTrackedExpressions, ...additions],
        };
        const { error: updateError } = await info.supabase
          .from("memory")
          .update({ summary: nextSummary, updated_at: new Date().toISOString() })
          .eq("user_id", row.user_id);
        if (updateError) {
          throw new Error(`Failed to update memory for user ${row.user_id}: ${updateError.message}`);
        }
        updatedUsers += 1;
      }
    }
  }

  console.log("[backfill] summary");
  console.log(`[backfill] rows scanned: ${rowsScanned}`);
  console.log(`[backfill] users with legacy frequentMistakes: ${usersWithLegacyFrequentMistakes}`);
  console.log(`[backfill] users planned for update: ${usersPlannedForUpdate}`);
  console.log(`[backfill] planned new trackedExpressions: ${plannedNewExpressions}`);
  console.log(`[backfill] skipped duplicates: ${skippedDuplicates}`);
  console.log(`[backfill] skipped empty: ${skippedEmpty}`);
  if (apply) {
    console.log(`[backfill] users updated: ${updatedUsers}`);
  } else {
    console.log("[backfill] no writes performed");
  }

  if (examples.length > 0) {
    console.log("");
    console.log("[backfill] conversion examples");
    examples.forEach((example, index) => {
      console.log(`${index + 1}. user_id=${example.userId}`);
      console.log(`   raw: ${JSON.stringify(example.rawText)}`);
      console.log(`   originalText: ${JSON.stringify(example.expression.originalText)}`);
      console.log(`   targetText: ${JSON.stringify(example.expression.targetText)}`);
      console.log(`   id: ${example.expression.id}`);
      console.log(`   category: ${example.expression.category}`);
    });
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
  } else if (process.argv.includes("--sample")) {
    sampleFrequentMistakes().catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  } else {
    const apply = process.argv.includes("--apply");
    runBackfill({ apply }).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
