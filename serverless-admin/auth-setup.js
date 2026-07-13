import { adminUsersCount, createAdminUser } from "../api/_lib/admin-auth.js";
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

  try {
    const count = await adminUsersCount();
    if (count > 0) {
      json(res, 403, { success: false, error: "Admin account already exists" });
      return;
    }

    const body = await readJsonBody(req);
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!username || password.length < 8) {
      json(res, 400, {
        success: false,
        error: "Username is required and password must be at least 8 characters",
      });
      return;
    }

    await createAdminUser({ username, password, role: "admin" });
    json(res, 200, {
      success: true,
      message: "Admin account created. You can now log in.",
    });
  } catch (error) {
    json(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : "Setup failed",
    });
  }
}
