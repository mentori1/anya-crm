import { prisma } from "@/lib/db";
import {
  sendTelegramMessage,
  telegramDeliveryIsUncertain,
  telegramIsConfigured,
} from "@/lib/telegram-api";

const OUTBOX_CHANNEL = "telegram";
const DEFAULT_LIMIT = 25;
const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;

export type TelegramOutboxStatus = "queued" | "sending" | "sent" | "error" | "waiting" | "uncertain";

export type TelegramSender = (
  chatId: string,
  text: string,
) => Promise<{ message_id: number }>;

export type TelegramOutboxPreviewItem = {
  id: number;
  kind: string;
  clientId: number | null;
  clientName: string | null;
  hasChatId: boolean;
  body: string;
  scheduledAt: Date | null;
  due: boolean;
  status: string;
};

export type TelegramOutboxRunResult = {
  dryRun: boolean;
  quarantined: number;
  claimed: number;
  sent: number;
  waiting: number;
  errors: number;
  uncertain: number;
  skipped: number;
  preview: TelegramOutboxPreviewItem[];
};

type ProcessTelegramOutboxOptions = {
  /** Dry-run is intentionally the default and never changes the database. */
  dryRun?: boolean;
  limit?: number;
  now?: Date;
  staleAfterMs?: number;
  workerId?: string;
  /** Tests may inject a sender. The production sender is never used in dry-run. */
  sender?: TelegramSender;
  /** Live network delivery additionally requires TELEGRAM_OUTBOX_LIVE_SEND=1. */
  allowLiveSend?: boolean;
};

const notificationSelection = {
  id: true,
  kind: true,
  body: true,
  status: true,
  deliveryKey: true,
  attempts: true,
  lastError: true,
  claimedAt: true,
  clientId: true,
  scheduledAt: true,
  updatedAt: true,
  client: {
    select: {
      fullName: true,
      telegramChatId: true,
    },
  },
} as const;

function boundedLimit(limit: number | undefined) {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(100, Math.trunc(limit ?? DEFAULT_LIMIT)));
}

function safeWorkerId(workerId: string | undefined) {
  return (workerId?.trim() || `worker-${process.pid}`).slice(0, 100);
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/bot\d+:[^/\s]+/gi, "bot[redacted]").slice(0, 800);
}

type NotificationPreviewRecord = {
  id: number;
  kind: string;
  body: string;
  status: string;
  deliveryKey: string | null;
  attempts: number;
  lastError: string | null;
  claimedAt: Date | null;
  clientId: number | null;
  scheduledAt: Date | null;
  updatedAt: Date;
  client: { fullName: string; telegramChatId: string | null } | null;
};

function toPreview(
  notification: NotificationPreviewRecord,
  now: Date,
): TelegramOutboxPreviewItem {
  return {
    id: notification.id,
    kind: notification.kind,
    clientId: notification.clientId,
    clientName: notification.client?.fullName ?? null,
    hasChatId: Boolean(notification.client?.telegramChatId?.trim()),
    body: notification.body,
    scheduledAt: notification.scheduledAt,
    due: !notification.scheduledAt || notification.scheduledAt <= now,
    status: notification.status,
  };
}

/**
 * Read-only queue preview. It does not claim rows, update timestamps, or call Telegram.
 */
export async function previewTelegramOutbox(options: { limit?: number; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const notifications = await prisma.notification.findMany({
    where: { channel: OUTBOX_CHANNEL, status: "queued" },
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
    take: boundedLimit(options.limit),
    select: notificationSelection,
  });
  return notifications.map((notification) => toPreview(notification, now));
}

/**
 * Deliberately puts an existing CRM notification into the Telegram queue.
 * Repeated calls are safe: only the first allowed state transition succeeds.
 */
export async function queueTelegramNotification(notificationId: number, actor = "crm") {
  if (!Number.isInteger(notificationId) || notificationId <= 0) return false;
  return prisma.$transaction(async (tx) => {
    const queued = await tx.notification.updateMany({
      where: {
        id: notificationId,
        channel: OUTBOX_CHANNEL,
        status: { in: ["draft", "portal_ready", "waiting", "error", "uncertain"] },
      },
      data: {
        status: "queued",
        sentAt: null,
        claimedAt: null,
        lastError: null,
      },
    });
    if (queued.count !== 1) return false;
    await tx.auditLog.create({
      data: {
        entityType: "notification",
        entityId: String(notificationId),
        action: "telegram_queued",
        payload: JSON.stringify({ actor: actor.slice(0, 100) }),
      },
    });
    return true;
  });
}

/**
 * Quarantines abandoned `sending` rows. They are intentionally NOT requeued:
 * Telegram may have accepted the message before the worker crashed, and an
 * automatic retry could create a duplicate. Requeue is always a manual action.
 */
export async function reclaimStaleTelegramClaims(options: {
  now?: Date;
  staleAfterMs?: number;
  workerId?: string;
} = {}) {
  const now = options.now ?? new Date();
  const staleAfterMs = Math.max(60_000, options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS);
  const cutoff = new Date(now.getTime() - staleAfterMs);
  const workerId = safeWorkerId(options.workerId);
  const stale = await prisma.notification.findMany({
    where: {
      channel: OUTBOX_CHANNEL,
      status: "sending",
      updatedAt: { lte: cutoff },
    },
    orderBy: { updatedAt: "asc" },
    take: 100,
    select: { id: true },
  });

  let quarantined = 0;
  for (const candidate of stale) {
    const didQuarantine = await prisma.$transaction(async (tx) => {
      const updated = await tx.notification.updateMany({
        where: {
          id: candidate.id,
          channel: OUTBOX_CHANNEL,
          status: "sending",
          updatedAt: { lte: cutoff },
        },
        data: {
          status: "uncertain",
          claimedAt: null,
          lastError: "Worker stopped without a confirmed local delivery result; manual review required",
        },
      });
      if (updated.count !== 1) return false;
      await tx.auditLog.create({
        data: {
          entityType: "notification",
          entityId: String(candidate.id),
          action: "telegram_stale_uncertain",
          payload: JSON.stringify({ workerId, cutoff: cutoff.toISOString() }),
        },
      });
      return true;
    });
    if (didQuarantine) quarantined += 1;
  }
  return quarantined;
}

async function claimNextDueNotification(now: Date, workerId: string) {
  for (let collision = 0; collision < 20; collision += 1) {
    const candidate = await prisma.notification.findFirst({
      where: {
        channel: OUTBOX_CHANNEL,
        status: "queued",
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
      },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!candidate) return null;

    const claimed = await prisma.$transaction(async (tx) => {
      // This conditional update is the lock: among concurrent workers only one
      // can change the same row from queued to sending.
      const updated = await tx.notification.updateMany({
        where: {
          id: candidate.id,
          channel: OUTBOX_CHANNEL,
          status: "queued",
          OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
        },
        data: {
          status: "sending",
          claimedAt: now,
          lastError: null,
          attempts: { increment: 1 },
        },
      });
      if (updated.count !== 1) return null;
      await tx.auditLog.create({
        data: {
          entityType: "notification",
          entityId: String(candidate.id),
          action: "telegram_claimed",
          payload: JSON.stringify({ workerId }),
        },
      });
      return tx.notification.findUnique({
        where: { id: candidate.id },
        select: notificationSelection,
      });
    });
    if (claimed) return claimed;
  }
  return null;
}

async function finishClaim(
  notificationId: number,
  status: "sent" | "waiting" | "error" | "uncertain",
  workerId: string,
  payload: Record<string, unknown>,
  now: Date,
) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.notification.updateMany({
      where: { id: notificationId, channel: OUTBOX_CHANNEL, status: "sending" },
      data: {
        status,
        sentAt: status === "sent" ? now : null,
        externalMessageId: status === "sent" && typeof payload.telegramMessageId === "number"
          ? String(payload.telegramMessageId)
          : null,
        claimedAt: null,
        lastError: status === "sent"
          ? null
          : typeof payload.error === "string"
            ? payload.error.slice(0, 800)
            : typeof payload.reason === "string"
              ? payload.reason.slice(0, 800)
              : status,
      },
    });
    if (updated.count !== 1) {
      await tx.auditLog.create({
        data: {
          entityType: "notification",
          entityId: String(notificationId),
          action: "telegram_claim_lost",
          payload: JSON.stringify({ workerId, targetStatus: status }),
        },
      });
      return false;
    }
    await tx.auditLog.create({
      data: {
        entityType: "notification",
        entityId: String(notificationId),
        action: `telegram_${status}`,
        payload: JSON.stringify({ workerId, ...payload }),
      },
    });
    return true;
  });
}

/**
 * Processes due notifications. Without `dryRun: false`, this function is
 * guaranteed to remain read-only. Live delivery needs both an explicit option
 * and TELEGRAM_OUTBOX_LIVE_SEND=1; tests use an injected mock sender instead.
 */
export async function processTelegramOutbox(
  options: ProcessTelegramOutboxOptions = {},
): Promise<TelegramOutboxRunResult> {
  const dryRun = options.dryRun ?? true;
  const limit = boundedLimit(options.limit);
  const now = options.now ?? new Date();
  const workerId = safeWorkerId(options.workerId);
  const preview = await previewTelegramOutbox({ limit, now });
  const result: TelegramOutboxRunResult = {
    dryRun,
    quarantined: 0,
    claimed: 0,
    sent: 0,
    waiting: 0,
    errors: 0,
    uncertain: 0,
    skipped: 0,
    preview,
  };
  if (dryRun) return result;

  const sender = options.sender ?? sendTelegramMessage;
  if (!options.sender) {
    const explicitlyEnabled = options.allowLiveSend && process.env.TELEGRAM_OUTBOX_LIVE_SEND === "1";
    if (!explicitlyEnabled) {
      throw new Error(
        "Реальная отправка заблокирована: нужны --live и TELEGRAM_OUTBOX_LIVE_SEND=1",
      );
    }
  }

  result.quarantined = await reclaimStaleTelegramClaims({
    now,
    staleAfterMs: options.staleAfterMs,
    workerId,
  });

  for (let index = 0; index < limit; index += 1) {
    const notification = await claimNextDueNotification(now, workerId);
    if (!notification) break;
    result.claimed += 1;
    const chatId = notification.client?.telegramChatId?.trim();
    if (!chatId) {
      const completed = await finishClaim(
        notification.id,
        "waiting",
        workerId,
        { reason: notification.clientId ? "telegram_chat_id_missing" : "client_missing" },
        now,
      );
      if (completed) result.waiting += 1;
      else result.skipped += 1;
      continue;
    }
    if (!options.sender && !telegramIsConfigured()) {
      const completed = await finishClaim(
        notification.id,
        "waiting",
        workerId,
        { reason: "telegram_bot_token_missing" },
        now,
      );
      if (completed) result.waiting += 1;
      else result.skipped += 1;
      continue;
    }

    try {
      const delivered = await sender(chatId, notification.body);
      const completed = await finishClaim(
        notification.id,
        "sent",
        workerId,
        { telegramMessageId: delivered.message_id },
        now,
      );
      if (completed) result.sent += 1;
      else result.skipped += 1;
    } catch (error) {
      const uncertain = telegramDeliveryIsUncertain(error);
      const completed = await finishClaim(
        notification.id,
        uncertain ? "uncertain" : "error",
        workerId,
        { error: errorMessage(error) },
        now,
      );
      if (completed) {
        if (uncertain) result.uncertain += 1;
        else result.errors += 1;
      }
      else result.skipped += 1;
    }
  }
  return result;
}

function formatMoscow(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Builds a client-safe answer from CRM data. It deliberately excludes private
 * notes, payments, other clients, and owner-only attention items.
 */
export async function composeClientCrmSummary(clientId: number, now = new Date()) {
  const [client, events, goals, materials] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { fullName: true } }),
    prisma.event.findMany({
      where: {
        startsAt: { gte: now },
        status: { not: "cancelled" },
        OR: [
          { clientId },
          { attendances: { some: { clientId } } },
        ],
      },
      orderBy: { startsAt: "asc" },
      take: 3,
      select: { title: true, startsAt: true, link: true },
    }),
    prisma.goal.findMany({
      where: { clientId, status: "active" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { title: true, currentValue: true, targetValue: true, unit: true },
    }),
    prisma.material.findMany({
      where: {
        isPublished: true,
        OR: [
          { programId: null },
          { program: { enrollments: { some: { clientId, status: "active" } } } },
        ],
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      take: 5,
      select: { title: true, url: true },
    }),
  ]);
  if (!client) return null;

  const eventLines = events.length
    ? events.map((event) => `• ${formatMoscow(event.startsAt)} — ${event.title}${event.link ? `\n  ${event.link}` : ""}`)
    : ["• Пока ничего не запланировано"];
  const goalLines = goals.length
    ? goals.map((goal) => `• ${goal.title}: ${goal.currentValue ?? "—"} / ${goal.targetValue ?? "—"} ${goal.unit ?? ""}`.trim())
    : ["• Активные цели пока не добавлены"];
  const materialLines = materials.length
    ? materials.map((material) => `• ${material.title}${material.url ? ` — ${material.url}` : ""}`)
    : ["• Опубликованных материалов пока нет"];

  return [
    `${client.fullName}, вот актуальная информация из CRM:`,
    "",
    "Ближайшие события:",
    ...eventLines,
    "",
    "Цели:",
    ...goalLines,
    "",
    "Материалы:",
    ...materialLines,
  ].join("\n");
}

/**
 * Minimal command handler for a future webhook. It prepares a reply but never
 * polls Telegram and never sends anything itself.
 */
export async function prepareTelegramCommandReply(chatId: string, input: string) {
  const normalizedChatId = chatId.trim();
  if (!normalizedChatId) return "Не удалось определить Telegram-аккаунт.";
  const clients = await prisma.client.findMany({
    where: { telegramChatId: normalizedChatId, status: { not: "archived" } },
    orderBy: { id: "asc" },
    take: 2,
    select: { id: true },
  });
  if (!clients.length) return "Этот Telegram пока не привязан к личному кабинету. Напиши Ане, чтобы она проверила привязку.";
  if (clients.length > 1) return "Telegram привязан неоднозначно. Напиши Ане, чтобы она исправила привязку; данные из CRM не показаны.";
  const client = clients[0];

  const command = input.trim().split(/\s+/, 1)[0]?.toLowerCase().split("@", 1)[0];
  if (["/start", "/help", "/menu"].includes(command)) {
    return "Доступные команды:\n/summary — ближайшие события, цели и материалы\n/events — та же актуальная сводка из CRM";
  }
  if (["/summary", "/events", "/goals", "/materials"].includes(command)) {
    return (await composeClientCrmSummary(client.id)) ?? "Клиент не найден.";
  }
  return "Неизвестная команда. Отправь /help, чтобы увидеть доступные команды.";
}
