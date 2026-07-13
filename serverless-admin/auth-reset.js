import { createAdminUser } from "../api/_lib/admin-auth.js";
import { getAdminSupabase } from "../api/_lib/admin-supabase.js";
import { setJsonCors, readJsonBody, json } from "../api/_lib/http.js";

export default async function handler(req, res) {
  setJsonCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { success: false, error: "Method not allowed" });
    return;
  }

  const resetSecret = process.env.ADMIN_RESET_SECRET;
  if (!resetSecret) {
    json(res, 404, { success: false, error: "Not found" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    if (body?.resetSecret !== resetSecret) {
      json(res, 403, { success: false, error: "Forbidden" });
      return;
    }

    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!username || password.length < 8) {
      json(res, 400, {
        success: false,
        error: "Username is required and password must be at least 8 characters",
      });
      return;
    }

    const supabase = getAdminSupabase();
    const { error: deleteError } = await supabase.from("admin_users").delete().eq("username", username);
    if (deleteError) {
      throw new Error(deleteError.message);
    }

    await createAdminUser({ username, password, role: "admin" });
    json(res, 200, {
      success: true,
      message: `Admin account "${username}" reset. You can now log in.`,
    });
  } catch (error) {
    json(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : "Reset failed",
    });
  }
}
