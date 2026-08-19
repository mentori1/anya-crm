import { createHmac, randomBytes, scryptSync, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

export const CLIENT_SESSION_COOKIE = "anya_client_session";
const SESSION_DAYS = 30;

function authSecret() {
  const configured = process.env.CLIENT_AUTH_SECRET?.trim();
  if (configured) return configured;
  throw new Error("CLIENT_AUTH_SECRET is required");
}

function sign(value: string) {
  return createHmac("sha256", authSecret()).update(value).digest("base64url");
}

export function createPinHash(pin: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(`${pin}:${authSecret()}`, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPin(pin: string, stored: string) {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(`${pin}:${authSecret()}`, salt, 32).toString("hex");
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && nodeTimingSafeEqual(a, b);
}

export function createClientSessionToken(publicId: string, sessionVersion: number) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 60 * 60;
  const payload = `${publicId}.${sessionVersion}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

function parseClientSessionToken(token: string | undefined) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [publicId, versionRaw, expiresRaw, signature] = parts;
  const payload = `${publicId}.${versionRaw}.${expiresRaw}`;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !nodeTimingSafeEqual(a, b)) return null;
  const sessionVersion = Number(versionRaw);
  const expiresAt = Number(expiresRaw);
  if (!Number.isInteger(sessionVersion) || !Number.isFinite(expiresAt) || expiresAt < Date.now() / 1000) return null;
  return { publicId, sessionVersion };
}

export async function getClientPortalSession() {
  const store = await cookies();
  const parsed = parseClientSessionToken(store.get(CLIENT_SESSION_COOKIE)?.value);
  if (!parsed) return null;
  const access = await prisma.clientPortalAccess.findUnique({
    where: { publicId: parsed.publicId },
    select: { clientId: true, isActive: true, sessionVersion: true, publicId: true },
  });
  if (!access?.isActive || access.sessionVersion !== parsed.sessionVersion) return null;
  return { clientId: access.clientId, publicId: access.publicId };
}

export function clientSessionMaxAge() {
  return SESSION_DAYS * 24 * 60 * 60;
}
