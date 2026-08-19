// Простая авторизация под одного преподавателя: один пароль (APP_PASSWORD).
// После входа в куку кладётся HMAC-подпись — подделать без AUTH_SECRET нельзя.
// Файл edge-совместимый (используется в middleware) — без Node-API, только Web Crypto.

export const SESSION_COOKIE = "anya_crm_session";

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return toHex(sig);
}

function secret(): string {
  const configured = process.env.AUTH_SECRET?.trim();
  if (configured) return configured;
  throw new Error("AUTH_SECRET is required");
}

function hostnameFromHeader(value: string | null | undefined): string | null {
  const raw = value?.split(",", 1)[0]?.trim().toLowerCase();
  if (!raw) return null;
  if (raw.startsWith("[")) {
    const closingBracket = raw.indexOf("]");
    return closingBracket === -1 ? null : raw.slice(1, closingBracket);
  }
  if (raw === "::1") return raw;
  const hostname = raw.includes(":") ? raw.slice(0, raw.lastIndexOf(":")) : raw;
  return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
}

export function isLoopbackHost(value: string | null | undefined): boolean {
  const hostname = hostnameFromHeader(value);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function isLocalOwnerBypass(
  host: string | null | undefined,
  forwardedHost?: string | null,
): boolean {
  if (process.env.LOCAL_AUTH_BYPASS !== "1" || !isLoopbackHost(host)) return false;
  return !forwardedHost || isLoopbackHost(forwardedHost);
}

/** Значение сессионной куки */
export async function sessionToken(): Promise<string> {
  return hmacHex(secret(), "authenticated:v1");
}

/** Сравнение строк за постоянное время (защита от тайминг-атак) */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Валидна ли сессия по значению куки */
export async function isValidSession(
  cookieValue: string | undefined,
): Promise<boolean> {
  if (!cookieValue) return false;
  return timingSafeEqual(cookieValue, await sessionToken());
}
