"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import {
  CLIENT_SESSION_COOKIE,
  clientSessionMaxAge,
  createClientSessionToken,
  createPinHash,
  verifyPin,
} from "@/lib/client-auth";
import { prisma, withTransientDbRetry } from "@/lib/db";
import { requireOwner } from "@/lib/owner-auth";

const MAX_LOGIN_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOCK_MESSAGE = "Слишком много попыток. Повтори через 15 минут.";

class ConcurrentPortalMutationError extends Error {}

function uniqueConstraint(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function configureClientPortal(formData: FormData) {
  await requireOwner();
  const clientId = Number(formData.get("clientId"));
  const pin = String(formData.get("pin") ?? "").trim();
  if (!Number.isInteger(clientId) || !/^\d{6,8}$/.test(pin)) return;

  const pinHash = createPinHash(pin);
  try {
    await withTransientDbRetry(() => prisma.$transaction(async (tx) => {
      const existing = await tx.clientPortalAccess.findUnique({
        where: { clientId },
        select: { id: true, pinHash: true, isActive: true, updatedAt: true },
      });
      if (existing?.isActive && verifyPin(pin, existing.pinHash)) return;

      if (!existing) {
        const access = await tx.clientPortalAccess.create({
          data: { clientId, publicId: randomUUID(), pinHash },
        });
        await tx.auditLog.create({
          data: {
            entityType: "client_portal",
            entityId: String(access.id),
            action: "access_created",
            payload: JSON.stringify({ clientId }),
          },
        });
        return;
      }

      const updated = await tx.clientPortalAccess.updateMany({
        where: { id: existing.id, updatedAt: existing.updatedAt },
        data: {
          pinHash,
          isActive: true,
          sessionVersion: { increment: 1 },
          failedLoginCount: 0,
          failedLoginWindowStartedAt: null,
          lockedUntil: null,
        },
      });
      if (updated.count !== 1) throw new ConcurrentPortalMutationError();
      await tx.auditLog.create({
        data: {
          entityType: "client_portal",
          entityId: String(existing.id),
          action: "access_updated",
          payload: JSON.stringify({ clientId }),
        },
      });
    }));
  } catch (error) {
    if (!(error instanceof ConcurrentPortalMutationError) && !uniqueConstraint(error)) throw error;
    const current = await prisma.clientPortalAccess.findUnique({
      where: { clientId },
      select: { pinHash: true, isActive: true },
    });
    // A repeated concurrent submit with the same resulting state is a no-op.
    if (!current?.isActive || !verifyPin(pin, current.pinHash)) {
      throw new Error("Доступ клиента был изменён одновременно. Обнови страницу и повтори действие.");
    }
  }
  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}?access=saved`);
}

export async function disableClientPortal(formData: FormData) {
  await requireOwner();
  const clientId = Number(formData.get("clientId"));
  if (!Number.isInteger(clientId)) return;
  await withTransientDbRetry(() => prisma.$transaction(async (tx) => {
    const access = await tx.clientPortalAccess.findUnique({
      where: { clientId },
      select: { id: true, isActive: true, updatedAt: true },
    });
    if (!access?.isActive) return;
    const disabled = await tx.clientPortalAccess.updateMany({
      where: { id: access.id, isActive: true, updatedAt: access.updatedAt },
      data: { isActive: false, sessionVersion: { increment: 1 } },
    });
    if (disabled.count !== 1) {
      const latest = await tx.clientPortalAccess.findUnique({
        where: { id: access.id },
        select: { isActive: true },
      });
      if (latest?.isActive) {
        throw new Error("Доступ клиента был изменён одновременно. Обнови страницу и повтори действие.");
      }
      return;
    }
    await tx.auditLog.create({
      data: {
        entityType: "client_portal",
        entityId: String(access.id),
        action: "access_disabled",
      },
    });
  }));
  revalidatePath(`/clients/${clientId}`);
}

export type ClientLoginState = { error?: string } | undefined;

export async function clientLogin(_previous: ClientLoginState, formData: FormData): Promise<ClientLoginState> {
  const publicId = String(formData.get("publicId") ?? "").trim();
  const pin = String(formData.get("pin") ?? "").trim();
  const access = await prisma.clientPortalAccess.findUnique({ where: { publicId } });
  if (!access?.isActive) return { error: "Неверный код доступа" };

  const now = new Date();
  if (access.lockedUntil && access.lockedUntil > now) return { error: LOCK_MESSAGE };

  const pinIsValid = /^\d{6,8}$/.test(pin) && verifyPin(pin, access.pinHash);
  if (!pinIsValid) {
    const windowCutoff = new Date(now.getTime() - LOGIN_WINDOW_MS);
    const reset = await prisma.clientPortalAccess.updateMany({
      where: {
        id: access.id,
        OR: [
          { failedLoginWindowStartedAt: null },
          { failedLoginWindowStartedAt: { lte: windowCutoff } },
        ],
      },
      data: {
        failedLoginCount: 1,
        failedLoginWindowStartedAt: now,
        lockedUntil: null,
      },
    });
    const failedLoginCount = reset.count
      ? 1
      : (
          await prisma.clientPortalAccess.update({
            where: { id: access.id },
            data: { failedLoginCount: { increment: 1 } },
            select: { failedLoginCount: true },
          })
        ).failedLoginCount;

    if (failedLoginCount >= MAX_LOGIN_FAILURES) {
      await prisma.clientPortalAccess.update({
        where: { id: access.id },
        data: { lockedUntil: new Date(now.getTime() + LOGIN_WINDOW_MS) },
      });
      return { error: LOCK_MESSAGE };
    }
    return { error: "Неверный код доступа" };
  }

  await prisma.clientPortalAccess.update({
    where: { id: access.id },
    data: {
      lastLoginAt: now,
      failedLoginCount: 0,
      failedLoginWindowStartedAt: null,
      lockedUntil: null,
    },
  });

  const store = await cookies();
  store.set(CLIENT_SESSION_COOKIE, createClientSessionToken(access.publicId, access.sessionVersion), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: clientSessionMaxAge(),
  });
  redirect("/cabinet");
}

export async function clientLogout() {
  const store = await cookies();
  store.delete(CLIENT_SESSION_COOKIE);
  redirect("/cabinet/login");
}
