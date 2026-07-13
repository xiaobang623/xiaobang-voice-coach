import { requireAdmin } from "../api/_lib/admin-auth.js";
import { getAdminSupabase } from "../api/_lib/admin-supabase.js";
import {
  aggregateCostLog,
  buildCostByProvider,
  finalizeProviderRow,
  formatModelDisplayName,
  getCostProviderMeta,
  getModelRateHint,
  roundCost,
} from "../api/_lib/cost-providers.js";
import { setJsonCors, json } from "../api/_lib/http.js";

function defaultDateFrom() {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date.toISOString().slice(0, 10);
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  setJsonCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    json(res, 405, { success: false, error: "Method not allowed" });
    return;
  }

  const user = await requireAdmin(req, res);
  if (!user) {
    return;
  }

  try {
    const url = new URL(req.url, "http://localhost");
    const dateFrom = url.searchParams.get("date_from") ?? defaultDateFrom();
    const dateTo = url.searchParams.get("date_to") ?? todayDate();

    const supabase = getAdminSupabase();
    const { data: logs, error } = await supabase
      .from("token_logs")
      .select("user_id, guest_id, api_provider, model_name, tokens_used, duration_seconds, cost")
      .gte("created_at", `${dateFrom}T00:00:00.000Z`)
      .lte("created_at", `${dateTo}T23:59:59.999Z`);

    if (error) {
      throw new Error(error.message);
    }

    const byModelMap = new Map();
    const byUserMap = new Map();
    let totalCost = 0;
    let totalTokens = 0;

    for (const log of logs ?? []) {
      const tokens = Number(log.tokens_used ?? 0);
      const cost = Number(log.cost ?? 0);
      totalTokens += tokens;
      totalCost += cost;

      const providerMeta = getCostProviderMeta(log.api_provider);

      const modelKey = `${log.api_provider}::${log.model_name}`;
      const modelRow = byModelMap.get(modelKey) ?? {
        model_name: log.model_name,
        model_label: formatModelDisplayName(log.api_provider, log.model_name),
        api_provider: log.api_provider,
        provider_label: providerMeta.label,
        usage_kind: providerMeta.usage_kind,
        rate_hint: getModelRateHint(log.api_provider, log.model_name),
        call_count: 0,
        total_tokens: 0,
        total_duration_seconds: 0,
        total_characters: 0,
        total_cost: 0,
      };
      aggregateCostLog(modelRow, log);
      byModelMap.set(modelKey, modelRow);

      const actorKey = log.user_id ? `user:${log.user_id}` : `guest:${log.guest_id ?? "unknown"}`;
      const userRow = byUserMap.get(actorKey) ?? {
        actor_key: actorKey,
        user_id: log.user_id,
        guest_id: log.guest_id,
        call_count: 0,
        total_tokens: 0,
        total_duration_seconds: 0,
        total_cost: 0,
      };
      userRow.call_count += 1;
      userRow.total_tokens += tokens;
      userRow.total_duration_seconds += Number(log.duration_seconds ?? 0);
      userRow.total_cost += cost;
      byUserMap.set(actorKey, userRow);
    }

    const byModel = [...byModelMap.values()]
      .map(finalizeProviderRow)
      .sort((a, b) => b.total_cost - a.total_cost);

    const byProvider = buildCostByProvider(logs);

    const userIds = [
      ...new Set(
        (logs ?? []).map((log) => log.user_id).filter(Boolean),
      ),
    ];
    const nicknames = new Map();
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, nickname")
        .in("id", userIds);
      for (const profile of profiles ?? []) {
        nicknames.set(profile.id, profile.nickname ?? "未设置昵称");
      }
    }

    const labelForActor = (row) => {
      if (row.user_id) {
        return nicknames.get(row.user_id) ?? `游客 ${row.user_id.slice(0, 8)}`;
      }
      const guestId = row.guest_id ?? "unknown";
      return `游客 ${guestId.slice(0, 8)}`;
    };

    const byUser = [...byUserMap.values()]
      .map((row) => ({
        user_id: row.user_id ?? row.guest_id ?? row.actor_key,
        user_nickname: labelForActor(row),
        call_count: row.call_count,
        total_tokens: row.total_tokens,
        total_duration_seconds: row.total_duration_seconds,
        total_cost: roundCost(row.total_cost),
      }))
      .sort((a, b) => b.total_cost - a.total_cost)
      .slice(0, 20);

    json(res, 200, {
      success: true,
      data: {
        total_cost: roundCost(totalCost),
        total_tokens: totalTokens,
        by_provider: byProvider,
        by_model: byModel,
        by_user: byUser,
      },
    });
  } catch (error) {
    json(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load token summary",
    });
  }
}
