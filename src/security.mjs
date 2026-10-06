import { createHash, timingSafeEqual } from "node:crypto";

export const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
};

export function authorizeAdmin(headers = {}, token = process.env.ADMIN_API_TOKEN) {
  if (!token || token.length < 32) return false;
  const authorization = headers.authorization || headers.Authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
  const hash = (value) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(authorization.slice(7)), hash(token));
}

export function createRateLimiter({ limit = 30, windowMs = 60_000, maxEntries = 2000 } = {}) {
  const clients = new Map();
  return (client, now = Date.now()) => {
    for (const [key, value] of clients) if (value.expiresAt <= now) clients.delete(key);
    const key = createHash("sha256").update(String(client || "unknown")).digest("hex");
    const current = clients.get(key);
    if (current && current.count >= limit) return Math.ceil((current.expiresAt - now) / 1000);
    if (current) current.count += 1;
    else {
      if (clients.size >= maxEntries) clients.delete(clients.keys().next().value);
      clients.set(key, { count: 1, expiresAt: now + windowMs });
    }
    return 0;
  };
}

export async function fetchWithTimeout(url, options = {}) {
  try {
    const timeout = AbortSignal.timeout(10_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    return await fetch(url, { ...options, signal });
  } catch (cause) {
    const error = new Error("외부 데이터 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.");
    error.status = cause.name === "TimeoutError" ? 504 : 502;
    throw error;
  }
}
