"use server";

import { randomUUID } from "node:crypto";
import { chmod, mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getClientPortalSession } from "@/lib/client-auth";
import { prisma, withTransientDbRetry } from "@/lib/db";
import { requireOwner } from "@/lib/owner-auth";
import { filesystemAvatarUploadsAvailable } from "@/lib/runtime-capabilities";
import { telegramApi, telegramIsConfigured } from "@/lib/telegram-api";

function imageKind(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { ext: "png", mime: "image/png" };
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { ext: "webp", mime: "image/webp" };
  return null;
}

function managedAvatarPath(storageDir: string, storageKey: string | null, clientId: number) {
  if (!storageKey || basename(storageKey) !== storageKey) return null;
  const escapedClientId = String(clientId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const managedName = new RegExp(
    `^client-${escapedClientId}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(?:jpg|png|webp)$`,
    "i",
  );
  return managedName.test(storageKey) ? resolve(storageDir, storageKey) : null;
}

class ConcurrentAvatarMutationError extends Error {}

async function removeManagedAvatar(path: string | null) {
  if (!path) return;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await unlink(path);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      if (attempt === 3) throw error;
      await delay(25 * attempt);
    }
  }
}

async function saveAvatar(clientId: number, file: File, actor: "owner" | "client") {
  if (!filesystemAvatarUploadsAvailable()) {
    throw new Error(
      "Загрузка фотографий в облачной версии временно выключена до подключения постоянного хранилища.",
    );
  }
  if (!file.size || file.size > 5 * 1024 * 1024) throw new Error("Фотография должна быть не больше 5 МБ");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = imageKind(bytes);
  if (!kind) throw new Error("Поддерживаются JPG, PNG и WebP");
  const storageDir = resolve(process.cwd(), "storage/avatars");
  await mkdir(storageDir, { recursive: true, mode: 0o700 });
  await chmod(storageDir, 0o700);
  const storageKey = `client-${clientId}-${randomUUID()}.${kind.ext}`;
  const newAvatarPath = resolve(storageDir, storageKey);
  await writeFile(newAvatarPath, bytes, { flag: "wx", mode: 0o600 });

  let previousStorageKey: string | null = null;
  try {
    previousStorageKey = await withTransientDbRetry(() => prisma.$transaction(async (tx) => {
      const current = await tx.client.findUnique({
        where: { id: clientId },
        select: { avatarStorageKey: true },
      });
      if (!current) throw new Error("Клиент не найден");

      const updated = await tx.client.updateMany({
        where: { id: clientId, avatarStorageKey: current.avatarStorageKey },
        data: {
          avatarStorageKey: storageKey,
          avatarMimeType: kind.mime,
          avatarUpdatedAt: new Date(),
          lastActivityAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new ConcurrentAvatarMutationError();
      await tx.auditLog.create({
        data: {
          entityType: "client",
          entityId: String(clientId),
          action: "avatar_uploaded",
          payload: JSON.stringify({
            actor,
            previousStorageKey: current.avatarStorageKey,
            storageKey,
          }),
        },
      });
      return current.avatarStorageKey;
    }));
  } catch (error) {
    await removeManagedAvatar(newAvatarPath).catch(() => undefined);
    if (error instanceof ConcurrentAvatarMutationError) {
      throw new Error("Фотография была изменена одновременно. Обнови страницу и загрузи файл ещё раз.");
    }
    throw error;
  }

  if (previousStorageKey !== storageKey) {
    const previousAvatarPath = managedAvatarPath(storageDir, previousStorageKey, clientId);
    const previousStillReferenced = previousStorageKey
      ? await prisma.client.count({ where: { id: clientId, avatarStorageKey: previousStorageKey } })
      : 0;
    if (!previousStillReferenced) {
      try {
        await removeManagedAvatar(previousAvatarPath);
      } catch (error) {
        await prisma.auditLog.create({
          data: {
            entityType: "client",
            entityId: String(clientId),
            action: "avatar_cleanup_failed",
            payload: JSON.stringify({
              storageKey: previousStorageKey,
              error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
            }),
          },
        });
      }
    }
  }
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/cabinet");
}

export async function uploadClientAvatar(formData: FormData) {
  await requireOwner();
  const clientId = Number(formData.get("clientId"));
  const file = formData.get("avatar");
  if (!Number.isInteger(clientId) || !(file instanceof File)) return;
  await saveAvatar(clientId, file, "owner");
}

export async function uploadOwnAvatar(formData: FormData) {
  const session = await getClientPortalSession();
  const file = formData.get("avatar");
  if (!session || !(file instanceof File)) redirect("/cabinet/login");
  await saveAvatar(session.clientId, file, "client");
}

export async function syncTelegramAvatar(formData: FormData) {
  await requireOwner();
  if (!telegramIsConfigured()) return;
  const clientId = Number(formData.get("clientId"));
  if (!Number.isInteger(clientId)) return;
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { telegramUserId: true, telegramAvatarFileId: true } });
  if (!client?.telegramUserId) return;
  const profile = await telegramApi<{ total_count: number; photos: { file_id: string; width: number; height: number }[][] }>("getUserProfilePhotos", {
    user_id: client.telegramUserId,
    offset: 0,
    limit: 1,
  });
  const telegramAvatarFileId = profile.photos[0]?.at(-1)?.file_id ?? null;
  if (!telegramAvatarFileId || telegramAvatarFileId === client.telegramAvatarFileId) return;
  const changed = await withTransientDbRetry(() => prisma.$transaction(async (tx) => {
    const updated = await tx.client.updateMany({
      where: {
        id: clientId,
        telegramUserId: client.telegramUserId,
        telegramAvatarFileId: client.telegramAvatarFileId,
      },
      data: {
        telegramAvatarFileId,
        avatarUpdatedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) return false;
    await tx.auditLog.create({
      data: {
        entityType: "client",
        entityId: String(clientId),
        action: "telegram_avatar_synced",
        payload: JSON.stringify({
          previousTelegramAvatarFileId: client.telegramAvatarFileId,
          telegramAvatarFileId,
        }),
      },
    });
    return true;
  }));
  if (!changed) {
    const latest = await prisma.client.findUnique({
      where: { id: clientId },
      select: { telegramAvatarFileId: true },
    });
    if (latest?.telegramAvatarFileId !== telegramAvatarFileId) {
      throw new Error("Telegram-фотография была изменена одновременно. Обнови страницу и повтори действие.");
    }
  }
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
}
