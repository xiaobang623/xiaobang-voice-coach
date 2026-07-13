import { requireAdmin } from "../api/_lib/admin-auth.js";
import { getAdminSupabase } from "../api/_lib/admin-supabase.js";
import { setJsonCors, json, readJsonBody } from "../api/_lib/http.js";
import {
  bustConfigCache,
  listInstanceKeys,
  parseModelInstances,
  resolveVoiceConfig,
} from "../api/_lib/voice-config.js";

function validateScopePayload(body) {
  const scopeType = body.scopeType ?? body.scope_type;
  if (!["global", "user", "session"].includes(scopeType)) {
    throw new Error("scopeType must be global, user, or session");
  }

  if (scopeType === "user" && !body.userId && !body.guestId) {
    throw new Error("userId or guestId is required for user scope");
  }

  if (scopeType === "session" && !body.sessionId) {
    throw new Error("sessionId is required for session scope");
  }

  const backend = body.backend;
  if (backend && backend !== "doubao" && backend !== "selfhosted") {
    throw new Error("backend must be doubao or selfhosted");
  }

  return {
    scopeType,
    userId: body.userId ?? null,
    guestId: body.guestId ?? null,
    sessionId: body.sessionId ?? null,
    backend: backend ?? "doubao",
    config: body.config && typeof body.config === "object" ? body.config : {},
  };
}

function buildUpsertRow(payload, updatedBy) {
  const row = {
    scope_type: payload.scopeType,
    backend: payload.backend,
    config: payload.config,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
    user_id: null,
    guest_id: null,
    session_id: null,
  };

  if (payload.scopeType === "user") {
    row.user_id = payload.userId;
    row.guest_id = payload.guestId;
  } else if (payload.scopeType === "session") {
    row.session_id = payload.sessionId;
  }

  return row;
}

async function findExistingRow(supabase, payload) {
  let query = supabase.from("voice_backend_config").select("*").eq("scope_type", payload.scopeType);

  if (payload.scopeType === "global") {
    query = query.limit(1);
  } else if (payload.scopeType === "user") {
    if (payload.userId) {
      query = query.eq("user_id", payload.userId);
    } else {
      query = query.eq("guest_id", payload.guestId);
    }
  } else {
    query = query.eq("session_id", payload.sessionId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export default async function handler(req, res) {
  setJsonCors(res, "GET, PUT, DELETE, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const admin = await requireAdmin(req, res);
  if (!admin) {
    return;
  }

  try {
    const supabase = getAdminSupabase();

    if (req.method === "GET") {
      const resolvePreview = req.query.resolve === "true";
      const context = {
        userId: typeof req.query.userId === "string" ? req.query.userId : undefined,
        guestId: typeof req.query.guestId === "string" ? req.query.guestId : undefined,
        sessionId: typeof req.query.sessionId === "string" ? req.query.sessionId : undefined,
      };

      if (resolvePreview) {
        const resolved = await resolveVoiceConfig(supabase, context);
        const registry = parseModelInstances();
        json(res, 200, {
          success: true,
          data: {
            effective: resolved,
            instanceKeys: listInstanceKeys(registry),
          },
        });
        return;
      }

      const scopeType = typeof req.query.scope_type === "string" ? req.query.scope_type : null;
      let query = supabase.from("voice_backend_config").select("*").order("updated_at", { ascending: false });
      if (scopeType) {
        query = query.eq("scope_type", scopeType);
      }

      const { data, error } = await query;
      if (error) {
        throw new Error(error.message);
      }

      json(res, 200, { success: true, data: data ?? [] });
      return;
    }

    if (req.method === "PUT") {
      if (admin.role !== "admin") {
        json(res, 403, { success: false, error: "Admin role required" });
        return;
      }

      const body = await readJsonBody(req);
      const payload = validateScopePayload(body ?? {});
      const row = buildUpsertRow(payload, admin.username);
      const existing = await findExistingRow(supabase, payload);

      let result;
      if (existing?.id) {
        const { data, error } = await supabase
          .from("voice_backend_config")
          .update(row)
          .eq("id", existing.id)
          .select("*")
          .single();
        if (error) {
          throw new Error(error.message);
        }
        result = data;
      } else {
        const { data, error } = await supabase.from("voice_backend_config").insert(row).select("*").single();
        if (error) {
          throw new Error(error.message);
        }
        result = data;
      }

      bustConfigCache();
      json(res, 200, { success: true, data: result });
      return;
    }

    if (req.method === "DELETE") {
      if (admin.role !== "admin") {
        json(res, 403, { success: false, error: "Admin role required" });
        return;
      }

      const body = await readJsonBody(req);
      const payload = validateScopePayload(body ?? {});

      if (payload.scopeType === "global") {
        json(res, 400, { success: false, error: "Cannot delete global config" });
        return;
      }

      const existing = await findExistingRow(supabase, payload);
      if (!existing?.id) {
        json(res, 404, { success: false, error: "Override not found" });
        return;
      }

      const { error } = await supabase.from("voice_backend_config").delete().eq("id", existing.id);
      if (error) {
        throw new Error(error.message);
      }

      bustConfigCache();
      json(res, 200, { success: true });
      return;
    }

    json(res, 405, { success: false, error: "Method not allowed" });
  } catch (error) {
    json(res, 400, {
      success: false,
      error: error instanceof Error ? error.message : "Request failed",
    });
  }
}
