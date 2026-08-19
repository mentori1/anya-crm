"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma, withTransientDbRetry } from "@/lib/db";
import { requireOwner } from "@/lib/owner-auth";

const allowedChannels = new Set(["telegram", "manual", "email"]);

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function channelValue(formData: FormData) {
  const channel = text(formData, "channel");
  return allowedChannels.has(channel) ? channel : "telegram";
}

function activeValue(formData: FormData) {
  return text(formData, "isActive") === "true";
}

function operationKey(formData: FormData) {
  const candidate = text(formData, "submissionKey");
  return /^[a-zA-Z0-9:_-]{16,160}$/.test(candidate) ? candidate : randomUUID();
}

function uniqueConstraint(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function createNotificationTemplate(formData: FormData) {
  await requireOwner();

  const title = text(formData, "title");
  const body = text(formData, "body");
  if (!title || !body) return;

  const channel = channelValue(formData);
  const isActive = activeValue(formData);
  const key = `custom-${operationKey(formData)}`;
  try {
    await withTransientDbRetry(() => prisma.$transaction(async (tx) => {
      const template = await tx.notificationTemplate.create({
        data: { key, title, body, channel, isActive },
      });
      await tx.auditLog.create({
        data: {
          entityType: "notification_template",
          entityId: String(template.id),
          action: "created",
          payload: JSON.stringify({ title, channel, isActive }),
        },
      });
    }));
  } catch (error) {
    if (!uniqueConstraint(error)) throw error;
    const existing = await prisma.notificationTemplate.findUnique({ where: { key } });
    if (!existing || existing.title !== title || existing.body !== body || existing.channel !== channel || existing.isActive !== isActive) {
      throw error;
    }
  }
  revalidatePath("/reminders");
  revalidatePath("/more");
}

export async function updateNotificationTemplate(formData: FormData) {
  await requireOwner();

  const id = Number(formData.get("id"));
  const version = Number(formData.get("version"));
  const title = text(formData, "title");
  const body = text(formData, "body");
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(version) || version < 1 || !title || !body) return;

  const channel = channelValue(formData);
  const isActive = activeValue(formData);
  const updated = await withTransientDbRetry(() => prisma.$transaction(async (tx) => {
    const result = await tx.notificationTemplate.updateMany({
      where: { id, version },
      data: { title, body, channel, isActive, version: { increment: 1 } },
    });
    if (result.count !== 1) return false;
    await tx.auditLog.create({
      data: {
        entityType: "notification_template",
        entityId: String(id),
        action: "updated",
        payload: JSON.stringify({ title, channel, isActive, previousVersion: version, version: version + 1 }),
      },
    });
    return true;
  }));
  if (!updated) redirect(`/reminders?error=stale&id=${id}`);
  revalidatePath("/reminders");
  revalidatePath("/more");
}
