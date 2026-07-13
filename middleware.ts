/// <reference types="node" />

import * as jose from "jose";

const PUBLIC_PATHS = new Set(["/admin/login"]);

function getTokenFromCookie(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "auth_token") {
      return decodeURIComponent(rest.join("="));
    }
  }

  return null;
}

async function verifyToken(token: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return false;
  }

  try {
    await jose.jwtVerify(token, new TextEncoder().encode(secret));
    return true;
  } catch {
    return false;
  }
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (!path.startsWith("/admin")) {
    return;
  }

  const token = getTokenFromCookie(request);
  const isValid = token ? await verifyToken(token) : false;

  if (PUBLIC_PATHS.has(path)) {
    if (isValid) {
      return Response.redirect(new URL("/admin/dashboard", request.url));
    }
    return;
  }

  if (!isValid) {
    return Response.redirect(new URL("/admin/login", request.url));
  }
}
