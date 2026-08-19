import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isLocalOwnerBypass, isValidSession, SESSION_COOKIE } from "@/lib/auth";
import { getClientPortalSession } from "@/lib/client-auth";
import { prisma } from "@/lib/db";
import { downloadTelegramFile } from "@/lib/telegram-api";

export const dynamic = "force-dynamic";

async function mayRead(clientId: number, request: Request) {
  if (isLocalOwnerBypass(request.headers.get("host"), request.headers.get("x-forwarded-host"))) return true;
  const store = await cookies();
  if (await isValidSession(store.get(SESSION_COOKIE)?.value)) return true;
  const clientSession = await getClientPortalSession();
  return clientSession?.clientId === clientId;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const clientId = Number(id);
  if (!Number.isInteger(clientId) || !(await mayRead(clientId, request))) return new NextResponse(null, { status: 404 });
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { avatarStorageKey: true, avatarMimeType: true, telegramAvatarFileId: true },
  });
  if (!client) return new NextResponse(null, { status: 404 });
  try {
    if (client.avatarStorageKey) {
      const safeKey = basename(client.avatarStorageKey);
      const bytes = await readFile(resolve(process.cwd(), "storage/avatars", safeKey));
      return new NextResponse(bytes, { headers: { "content-type": client.avatarMimeType || "image/jpeg", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
    }
    if (client.telegramAvatarFileId) {
      const file = await downloadTelegramFile(client.telegramAvatarFileId);
      return new NextResponse(new Uint8Array(file.bytes), { headers: { "content-type": file.contentType, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
    }
  } catch {
    return new NextResponse(null, { status: 502 });
  }
  return new NextResponse(null, { status: 404 });
}
