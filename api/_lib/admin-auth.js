import bcrypt from "bcryptjs";
import * as jose from "jose";
import { getAdminSupabase } from "./admin-supabase.js";

const COOKIE_NAME = "auth_token";
const TOKEN_TTL = "7d";

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

export async function signAdminToken({ userId, username, role }) {
  return new jose.SignJWT({ user_id: userId, username, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(getJwtSecret());
}

export async function verifyAdminToken(token) {
  const { payload } = await jose.jwtVerify(token, getJwtSecret());
  const userId = payload.user_id;
  const username = payload.username;
  const role = payload.role;

  if (typeof userId !== "string" || typeof username !== "string" || typeof role !== "string") {
    throw new Error("Invalid token payload");
  }

  if (role !== "admin" && role !== "viewer") {
    throw new Error("Invalid role in token");
  }

  return { userId, username, role };
}

export function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization ?? req.headers.Authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const cookieHeader = req.headers.cookie ?? req.headers.Cookie;
  if (typeof cookieHeader !== "string") {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return null;
}

export function setAuthCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}${secure}`,
  );
}

export function clearAuthCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}

export async function requireAdmin(req, res, { adminOnly = false } = {}) {
  const token = getTokenFromRequest(req);
  if (!token) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return null;
  }

  try {
    const user = await verifyAdminToken(token);
    if (adminOnly && user.role !== "admin") {
      res.status(403).json({ success: false, error: "Permission denied" });
      return null;
    }
    return user;
  } catch {
    res.status(401).json({ success: false, error: "Invalid or expired token" });
    return null;
  }
}

export async function findAdminByUsername(username) {
  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("admin_users")
    .select("id, username, password_hash, role")
    .eq("username", username)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function adminUsersCount() {
  const supabase = getAdminSupabase();
  const { count, error } = await supabase
    .from("admin_users")
    .select("id", { count: "exact", head: true });

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

export async function createAdminUser({ username, password, role = "admin" }) {
  const supabase = getAdminSupabase();
  const passwordHash = await hashPassword(password);
  const { error } = await supabase.from("admin_users").insert({
    username,
    password_hash: passwordHash,
    role,
  });

  if (error) {
    throw new Error(error.message);
  }
}
