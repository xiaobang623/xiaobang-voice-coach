import {
  createAdminUser,
  findAdminByUsername,
  requireAdmin,
  setAuthCookie,
  signAdminToken,
  verifyPassword,
} from "../../_lib/admin-auth.js";
import { setJsonCors, readJsonBody, json } from "../../_lib/http.js";

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
    const body = await readJsonBody(req);
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!username || !password) {
      json(res, 400, { success: false, error: "Username and password are required" });
      return;
    }

    const admin = await findAdminByUsername(username);
    if (!admin || !(await verifyPassword(password, admin.password_hash))) {
      json(res, 401, { success: false, error: "Invalid username or password" });
      return;
    }

    const token = await signAdminToken({
      userId: admin.id,
      username: admin.username,
      role: admin.role,
    });

    setAuthCookie(res, token);
    json(res, 200, {
      success: true,
      token,
      role: admin.role,
      username: admin.username,
    });
  } catch (error) {
    json(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : "Login failed",
    });
  }
}
