import { requireAdmin } from "../api/_lib/admin-auth.js";
import { setJsonCors, json } from "../api/_lib/http.js";

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

  json(res, 200, {
    success: true,
    data: {
      username: user.username,
      role: user.role,
    },
  });
}
