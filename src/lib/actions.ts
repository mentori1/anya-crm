"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { normalizedClientIdentity } from "@/lib/client-identity";
import { prisma, withTransientDbRetry } from "@/lib/db";
import { parseMoscowDateTimeLocal } from "@/lib/moscow-time";
import { requireOwner } from "@/lib/owner-auth";

function text(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function numeric(formData: FormData, key: string) {
  const value = text(formData, key);
  if (value === null) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateValue(formData: FormData, key: string) {
  const value = text(formData, key);
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isUniqueConstraint(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function submissionKey(formData: FormData) {
  const candidate = text(formData, "submissionKey");
  return candidate && /^[a-zA-Z0-9:_-]{16,160}$/.test(candidate)
    ? candidate
    : randomUUID();
}

function payloadHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function idempotentCreate(options: {
  action: string;
  operationKey: string;
  entityType: string;
  payload: unknown;
  create: (tx: Prisma.TransactionClient) => Promise<number>;
}) {
  const hash = payloadHash(options.payload);
  try {
    const entityId = await withTransientDbRetry(() => prisma.$transaction(async (tx) => {
      const receipt = await tx.mutationReceipt.create({
        data: {
          action: options.action,
          operationKey: options.operationKey,
          payloadHash: hash,
          entityType: options.entityType,
        },
      });
      const createdId = await options.create(tx);
      await tx.mutationReceipt.update({
        where: { id: receipt.id },
        data: { entityId: String(createdId), completedAt: new Date() },
      });
      return createdId;
    }));
    return { entityId, reused: false };
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error;
    const receipt = await prisma.mutationReceipt.findUnique({
      where: {
        action_operationKey: {
          action: options.action,
          operationKey: options.operationKey,
        },
      },
    });
    // A different unique index (for example a duplicate client contact) failed.
    if (!receipt) throw error;
    if (receipt.payloadHash !== hash) {
      throw new Error(`Ключ операции ${options.action} повторно использован с другими данными`);
    }
    if (!receipt.entityId) {
      throw new Error(`Операция ${options.action} не была завершена`);
    }
    return { entityId: Number(receipt.entityId), reused: true };
  }
}

export async function createClient(formData: FormData) {
  await requireOwner();
  const fullName = text(formData, "fullName");
  if (!fullName) redirect("/clients/new?error=name");

  const phone = text(formData, "phone");
  const telegram = text(formData, "telegram");
  const email = text(formData, "email");
  const identity = normalizedClientIdentity({ phone, telegram, email });
  const operationKey = submissionKey(formData);
  const data = {
    fullName,
    phone,
    telegram,
    email,
    source: text(formData, "source"),
    status: text(formData, "status") ?? "new",
    nextContactAt: dateValue(formData, "nextContactAt"),
    ...identity,
  };
  let clientId: number;
  try {
    ({ entityId: clientId } = await idempotentCreate({
      action: "create_client",
      operationKey,
      entityType: "client",
      payload: data,
      create: async (tx) => {
        const client = await tx.client.create({ data });
        await tx.auditLog.create({
          data: {
            entityType: "client",
            entityId: String(client.id),
            action: "created",
            payload: JSON.stringify({ fullName: client.fullName }),
          },
        });
        return client.id;
      },
    }));
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error;
    const duplicateConditions: Prisma.ClientWhereInput[] = [
      ...(identity.phoneNormalized ? [{ phoneNormalized: identity.phoneNormalized }] : []),
      ...(identity.telegramNormalized ? [{ telegramNormalized: identity.telegramNormalized }] : []),
      ...(identity.emailNormalized ? [{ emailNormalized: identity.emailNormalized }] : []),
    ];
    const duplicate = duplicateConditions.length
      ? await prisma.client.findFirst({ where: { OR: duplicateConditions }, select: { id: true } })
      : null;
    if (duplicate) redirect(`/clients/new?error=duplicate&id=${duplicate.id}`);
    throw error;
  }
  revalidatePath("/");
  revalidatePath("/clients");
  redirect(`/clients/${clientId}`);
}

export async function updateClient(formData: FormData) {
  await requireOwner();
  const id = Number(formData.get("id"));
  const version = Number(formData.get("version"));
  const fullName = text(formData, "fullName");
  if (!Number.isInteger(id) || !Number.isInteger(version) || version < 1 || !fullName) return;

  const phone = text(formData, "phone");
  const telegram = text(formData, "telegram");
  const email = text(formData, "email");
  const identity = normalizedClientIdentity({ phone, telegram, email });
  const data = {
    fullName,
    phone,
    telegram,
    telegramUserId: text(formData, "telegramUserId"),
    telegramChatId: text(formData, "telegramChatId"),
    email,
    source: text(formData, "source"),
    status: text(formData, "status") ?? "new",
    nextContactAt: dateValue(formData, "nextContactAt"),
    lastActivityAt: new Date(),
    version: { increment: 1 },
    ...identity,
  };
  let updated = false;
  try {
    updated = await withTransientDbRetry(() => prisma.$transaction(async (tx) => {
      const result = await tx.client.updateMany({ where: { id, version }, data });
      if (result.count !== 1) return false;
      await tx.auditLog.create({
        data: {
          entityType: "client",
          entityId: String(id),
          action: "updated",
          payload: JSON.stringify({ previousVersion: version, version: version + 1 }),
        },
      });
      return true;
    }));
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error;
    const duplicateConditions: Prisma.ClientWhereInput[] = [
      ...(identity.phoneNormalized ? [{ phoneNormalized: identity.phoneNormalized }] : []),
      ...(identity.telegramNormalized ? [{ telegramNormalized: identity.telegramNormalized }] : []),
      ...(identity.emailNormalized ? [{ emailNormalized: identity.emailNormalized }] : []),
    ];
    const duplicate = duplicateConditions.length
      ? await prisma.client.findFirst({
          where: { id: { not: id }, OR: duplicateConditions },
          select: { id: true },
        })
      : null;
    if (duplicate) redirect(`/clients/${id}?error=duplicate&duplicateId=${duplicate.id}`);
    throw error;
  }
  if (!updated) redirect(`/clients/${id}?error=stale`);
  revalidatePath("/");
  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
}

export async function addGoal(formData: FormData) {
  await requireOwner();
  const clientId = Number(formData.get("clientId"));
  const title = text(formData, "title");
  if (!Number.isInteger(clientId) || !title) return;

  const data = {
    clientId,
    title,
    startValue: numeric(formData, "startValue"),
    currentValue: numeric(formData, "currentValue"),
    targetValue: numeric(formData, "targetValue"),
    unit: text(formData, "unit"),
    movement: text(formData, "movement") ?? "on_track",
    deadline: dateValue(formData, "deadline"),
  };
  await idempotentCreate({
    action: "create_goal",
    operationKey: submissionKey(formData),
    entityType: "goal",
    payload: data,
    create: async (tx) => {
    const goal = await tx.goal.create({
      data,
    });
    await tx.auditLog.create({
      data: {
        entityType: "goal",
        entityId: String(goal.id),
        action: "created",
        payload: JSON.stringify({ clientId }),
      },
    });
    await tx.client.update({ where: { id: clientId }, data: { lastActivityAt: new Date() } });
    return goal.id;
    },
  });
  revalidatePath("/");
  revalidatePath(`/clients/${clientId}`);
}

export async function addPrivateNote(formData: FormData) {
  await requireOwner();
  const clientId = Number(formData.get("clientId"));
  const body = text(formData, "body");
  if (!Number.isInteger(clientId) || !body) return;

  const data = { clientId, body };
  await idempotentCreate({
    action: "create_private_note",
    operationKey: submissionKey(formData),
    entityType: "private_note",
    payload: data,
    create: async (tx) => {
    const note = await tx.privateNote.create({ data });
    await tx.auditLog.create({
      data: {
        entityType: "private_note",
        entityId: String(note.id),
        action: "created",
        payload: JSON.stringify({ clientId }),
      },
    });
    await tx.client.update({ where: { id: clientId }, data: { lastActivityAt: new Date() } });
    return note.id;
    },
  });
  revalidatePath(`/clients/${clientId}`);
}

export async function createFlow(formData: FormData) {
  await requireOwner();
  const title = text(formData, "title");
  if (!title) return;
  const data = {
    title,
    status: text(formData, "status") ?? "draft",
    startDate: dateValue(formData, "startDate"),
    endDate: dateValue(formData, "endDate"),
  };
  await idempotentCreate({
    action: "create_flow",
    operationKey: submissionKey(formData),
    entityType: "flow",
    payload: data,
    create: async (tx) => {
      const flow = await tx.flow.create({ data });
      await tx.auditLog.create({
        data: { entityType: "flow", entityId: String(flow.id), action: "created" },
      });
      return flow.id;
    },
  });
  revalidatePath("/flows");
}

export async function createEvent(formData: FormData) {
  await requireOwner();
  const title = text(formData, "title");
  const startsAt = parseMoscowDateTimeLocal(text(formData, "startsAt"));
  if (!title || !startsAt) return;

  const flowId = numeric(formData, "flowId");
  const clientId = numeric(formData, "clientId");
  const kind = text(formData, "kind") ?? "live";
  const link = text(formData, "link");
  const normalizedFlowId = flowId ? Math.trunc(flowId) : null;
  const normalizedClientId = clientId ? Math.trunc(clientId) : null;
  const eventLabel = kind === "call" ? "личный созвон" : kind === "live" ? "эфир" : "событие";
  const eventTime = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(startsAt);
  const invitationBody = `Аня назначила ${eventLabel} «${title}» на ${eventTime}.${link ? ` Ссылка: ${link}` : " Ссылка появится в личном кабинете."}`;
  const reminderBody = `Напоминание: ${eventLabel} «${title}» начнётся через час.${link ? ` Ссылка: ${link}` : ""}`;
  const reminderAt = new Date(startsAt.getTime() - 60 * 60 * 1000);
  const includeReminder = reminderAt > new Date();
  const eventData = {
    title,
    kind,
    startsAt,
    durationMinutes: numeric(formData, "durationMinutes") ?? 60,
    link,
    flowId: normalizedFlowId,
    clientId: normalizedClientId,
  };
  const { entityId: eventId } = await idempotentCreate({
    action: "create_event",
    operationKey: submissionKey(formData),
    entityType: "event",
    payload: eventData,
    create: async (tx) => {
      const flowParticipants = normalizedFlowId
        ? await tx.enrollment.findMany({
            where: {
              flowId: normalizedFlowId,
              status: "active",
              client: { status: { not: "archived" } },
            },
            select: { clientId: true },
          })
        : [];
      const recipientIds = Array.from(new Set([
        ...flowParticipants.map((enrollment) => enrollment.clientId),
        ...(normalizedClientId ? [normalizedClientId] : []),
      ]));
      const created = await tx.event.create({ data: eventData });
      if (recipientIds.length) {
        await tx.attendance.createMany({
          data: recipientIds.map((recipientId) => ({
            eventId: created.id,
            clientId: recipientId,
            status: "invited",
          })),
        });
        await tx.notification.createMany({
          data: recipientIds.flatMap((recipientId) => [
            {
              clientId: recipientId,
              eventId: created.id,
              kind: "event_invitation",
              body: invitationBody,
              status: link ? "queued" : "draft",
              deliveryKey: `event:${created.id}:client:${recipientId}:invitation`,
            },
            ...(includeReminder ? [{
              clientId: recipientId,
              eventId: created.id,
              kind: "event_reminder_1h",
              body: reminderBody,
              scheduledAt: reminderAt,
              status: link ? "queued" : "draft",
              deliveryKey: `event:${created.id}:client:${recipientId}:reminder:1h`,
            }] : []),
          ]),
        });
      }
      await tx.auditLog.create({
        data: {
          entityType: "event",
          entityId: String(created.id),
          action: "created",
          payload: JSON.stringify({
            clientId: normalizedClientId,
            flowId: normalizedFlowId,
            kind,
            recipientIds,
          }),
        },
      });
      return created.id;
    },
  });
  const recipientIds = (await prisma.attendance.findMany({
    where: { eventId },
    select: { clientId: true },
  })).map((attendance) => attendance.clientId);
  revalidatePath("/");
  revalidatePath("/events");
  revalidatePath("/cabinet");
  for (const recipientId of recipientIds) revalidatePath(`/clients/${recipientId}`);
}

export async function resolveAttention(formData: FormData) {
  await requireOwner();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  await withTransientDbRetry(() => prisma.$transaction(async (tx) => {
    const resolved = await tx.attentionItem.updateMany({
      where: { id, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
    if (resolved.count !== 1) return;
    await tx.auditLog.create({
      data: {
        entityType: "attention_item",
        entityId: String(id),
        action: "resolved",
      },
    });
  }));
  revalidatePath("/");
}
