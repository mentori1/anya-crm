"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { getClientPortalSession } from "@/lib/client-auth";
import { prisma, withTransientDbRetry } from "@/lib/db";

const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_PLAN_TASKS = 30;

type ClientSession = NonNullable<Awaited<ReturnType<typeof getClientPortalSession>>>;
type TransactionClient = Prisma.TransactionClient;

type TaskInput = {
  id: number | null;
  title: string;
  status: "todo" | "in_progress" | "done" | null;
  dueAt: Date | null | undefined;
};

type ResolvedTask = {
  id: number | null;
  title: string;
  status: "todo" | "in_progress" | "done";
  dueAt: Date | null;
  sortOrder: number;
};

class CabinetConflictError extends Error {
  constructor(message = "Данные уже изменились в другом окне. Обнови страницу и повтори действие.") {
    super(message);
    this.name = "CabinetConflictError";
  }
}

class CabinetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CabinetValidationError";
  }
}

class RetryMaterialProgressError extends Error {}

function isUniqueConstraint(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function requireClientSession() {
  const session = await getClientPortalSession();
  if (!session) throw new Error("Сессия личного кабинета истекла. Войди снова.");
  return session;
}

async function assertActiveSession(tx: TransactionClient, session: ClientSession) {
  const access = await tx.clientPortalAccess.findFirst({
    where: {
      clientId: session.clientId,
      publicId: session.publicId,
      isActive: true,
    },
    select: { id: true },
  });
  if (!access) throw new Error("Сессия личного кабинета больше не активна. Войди снова.");
}

function formText(formData: FormData, key: string, maxLength: number) {
  const raw = formData.get(key);
  if (raw === null || typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  if (value.length > maxLength) {
    throw new CabinetValidationError(`Поле «${key}» слишком длинное`);
  }
  return value;
}

function positiveInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function expectedTimestamp(formData: FormData, ...keys: string[]) {
  const key = keys.find((candidate) => formData.has(candidate));
  if (!key) return null;
  const raw = formText(formData, key, 80);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new CabinetValidationError("Не удалось проверить версию данных. Обнови страницу.");
  }
  return parsed;
}

function optionalNumber(formData: FormData, key: string, integerOnly = false) {
  const raw = formData.get(key);
  if (raw === null || typeof raw !== "string" || !raw.trim()) return null;
  const normalized = raw.replace(/[\s\u00a0]/g, "").replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || (integerOnly && !Number.isInteger(parsed))) {
    throw new CabinetValidationError(`Проверь значение поля «${key}»`);
  }
  return parsed;
}

function currentMoscowPeriod(now = new Date()) {
  const shifted = new Date(now.getTime() + MOSCOW_OFFSET_MS);
  const calendarDate = new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  ));
  const weekday = calendarDate.getUTCDay() || 7;
  const monday = new Date(calendarDate.getTime() - (weekday - 1) * DAY_MS);
  const today = new Date(calendarDate.getTime() - MOSCOW_OFFSET_MS);
  const weekStart = new Date(monday.getTime() - MOSCOW_OFFSET_MS);
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS - 1);
  return { today, weekStart, weekEnd };
}

function parseTaskDueAt(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new CabinetValidationError("Некорректный срок задачи");
  const normalized = value.trim();
  if (!normalized) return null;

  // `datetime-local` has no zone. Treat it as Moscow wall-clock time.
  const localMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(normalized);
  const parsed = localMatch
    ? new Date(Date.UTC(
        Number(localMatch[1]),
        Number(localMatch[2]) - 1,
        Number(localMatch[3]),
        Number(localMatch[4]) - 3,
        Number(localMatch[5]),
        Number(localMatch[6] ?? 0),
      ))
    : new Date(normalized);
  if (Number.isNaN(parsed.getTime())) throw new CabinetValidationError("Некорректный срок задачи");
  return parsed;
}

function taskStatus(value: unknown): TaskInput["status"] {
  if (value === null || value === undefined || value === "") return null;
  if (value === "todo" || value === "in_progress" || value === "done") return value;
  throw new CabinetValidationError("Некорректный статус задачи");
}

function parseJsonTasks(raw: string): TaskInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CabinetValidationError("Не удалось прочитать список задач");
  }
  if (!Array.isArray(parsed)) throw new CabinetValidationError("Некорректный список задач");
  return parsed.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new CabinetValidationError("Некорректная задача в плане");
    }
    const record = item as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    if (title.length > 240) throw new CabinetValidationError("Название задачи слишком длинное");
    const suppliedId = record.id === null || record.id === undefined || record.id === ""
      ? null
      : positiveInteger(record.id);
    if (record.id !== null && record.id !== undefined && record.id !== "" && suppliedId === null) {
      throw new CabinetValidationError("Некорректный идентификатор задачи");
    }
    return {
      id: suppliedId,
      title,
      status: taskStatus(record.status),
      dueAt: parseTaskDueAt(record.dueAt),
    };
  });
}

function parseRepeatedTasks(formData: FormData): TaskInput[] {
  const titles = formData.getAll("taskTitle");
  const ids = formData.getAll("taskId");
  const statuses = formData.getAll("taskStatus");
  const dueDates = formData.getAll("taskDueAt");
  const doneValues = new Set(
    formData.getAll("taskDone").filter((value): value is string => typeof value === "string"),
  );

  return titles.map((rawTitle, index) => {
    const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
    if (title.length > 240) throw new CabinetValidationError("Название задачи слишком длинное");
    const rawId = ids[index];
    const id = rawId === undefined || rawId === "" ? null : positiveInteger(rawId);
    if (rawId !== undefined && rawId !== "" && id === null) {
      throw new CabinetValidationError("Некорректный идентификатор задачи");
    }
    let status = statuses[index] === undefined ? null : taskStatus(statuses[index]);
    if (!statuses.length && doneValues.size) {
      status = doneValues.has(String(id ?? index)) || doneValues.has(String(index)) ? "done" : "todo";
    }
    return {
      id,
      title,
      status,
      dueAt: parseTaskDueAt(dueDates[index]),
    };
  });
}

function parsePlanTasks(formData: FormData) {
  const rawJson = formData.get("tasksJson");
  const replaceTasks = rawJson !== null || formData.has("taskTitle") || formData.get("replaceTasks") === "1";
  const parsed = typeof rawJson === "string" && rawJson.trim()
    ? parseJsonTasks(rawJson)
    : parseRepeatedTasks(formData);
  const tasks = parsed.filter((task) => task.title);
  if (tasks.length > MAX_PLAN_TASKS) {
    throw new CabinetValidationError(`В плане может быть не больше ${MAX_PLAN_TASKS} задач`);
  }
  const ids = tasks.flatMap((task) => task.id === null ? [] : [task.id]);
  if (new Set(ids).size !== ids.length) throw new CabinetValidationError("Одна задача передана несколько раз");
  return { replaceTasks, tasks };
}

function sameDate(left: Date | null, right: Date | null) {
  return left?.getTime() === right?.getTime();
}

function sameTasks(
  current: Array<{ id: number; title: string; status: string; dueAt: Date | null; sortOrder: number }>,
  desired: ResolvedTask[],
) {
  if (current.length !== desired.length) return false;
  return current.every((task, index) => {
    const target = desired[index];
    return (
      (!target.id || target.id === task.id) &&
      task.title === target.title &&
      task.status === target.status &&
      task.sortOrder === target.sortOrder &&
      sameDate(task.dueAt, target.dueAt)
    );
  });
}

function resolveTasks(
  input: TaskInput[],
  current: Array<{ id: number; title: string; status: string; dueAt: Date | null; sortOrder: number }>,
) {
  const currentById = new Map(current.map((task) => [task.id, task]));
  return input.map<ResolvedTask>((task, sortOrder) => {
    const existing = task.id ? currentById.get(task.id) : null;
    if (task.id && !existing) {
      throw new CabinetValidationError("Одна из задач не относится к твоему плану. Обнови страницу.");
    }
    return {
      id: task.id,
      title: task.title,
      status: task.status ?? (existing?.status === "in_progress" || existing?.status === "done" ? existing.status : "todo"),
      dueAt: task.dueAt === undefined ? existing?.dueAt ?? null : task.dueAt,
      sortOrder,
    };
  });
}

function revalidateCabinet(clientId: number) {
  revalidatePath("/cabinet");
  revalidatePath("/cabinet/plan");
  revalidatePath("/cabinet/results");
  revalidatePath("/cabinet/materials");
  revalidatePath("/cabinet/events");
  revalidatePath("/");
  revalidatePath(`/clients/${clientId}`);
}

async function touchClient(tx: TransactionClient, clientId: number, now: Date) {
  await tx.client.updateMany({
    where: {
      id: clientId,
      OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: now } }],
    },
    data: { lastActivityAt: now },
  });
}

/**
 * Saves the authenticated client's current Moscow-week plan.
 *
 * Forms should send `planUpdatedAt` for an existing plan and `replaceTasks=1`
 * when the submitted task list is authoritative. Tasks may be sent as parallel
 * `taskId`/`taskTitle`/`taskStatus`/`taskDueAt` fields or as `tasksJson`.
 */
export async function saveCurrentWeekPlan(formData: FormData): Promise<void> {
  const session = await requireClientSession();
  const now = new Date();
  const { weekStart, weekEnd } = currentMoscowPeriod(now);
  const focus = formText(formData, "focus", 2_000);
  const expectedUpdatedAt = expectedTimestamp(formData, "planUpdatedAt", "expectedUpdatedAt");
  const taskSubmission = parsePlanTasks(formData);

  const save = async () => withTransientDbRetry(() => prisma.$transaction(async (tx) => {
    await assertActiveSession(tx, session);
    const current = await tx.weeklyPlan.findUnique({
      where: { clientId_weekStart: { clientId: session.clientId, weekStart } },
      include: { tasks: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
    });

    const inputTasks = taskSubmission.replaceTasks
      ? taskSubmission.tasks
      : current?.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          status: taskStatus(task.status),
          dueAt: task.dueAt,
        })) ?? [];
    const desiredTasks = resolveTasks(inputTasks, current?.tasks ?? []);

    if (!current) {
      const created = await tx.weeklyPlan.create({
        data: {
          clientId: session.clientId,
          weekStart,
          weekEnd,
          focus,
          status: "active",
          tasks: desiredTasks.length
            ? {
                create: desiredTasks.map((task) => ({
                  title: task.title,
                  status: task.status,
                  dueAt: task.dueAt,
                  sortOrder: task.sortOrder,
                })),
              }
            : undefined,
        },
      });
      await touchClient(tx, session.clientId, now);
      await tx.auditLog.create({
        data: {
          entityType: "weekly_plan",
          entityId: String(created.id),
          action: "client_saved",
          payload: JSON.stringify({
            actor: "client_portal",
            clientId: session.clientId,
            weekStart: weekStart.toISOString(),
            taskCount: desiredTasks.length,
          }),
        },
      });
      return;
    }

    const unchanged = current.focus === focus && current.status === "active" && sameTasks(current.tasks, desiredTasks);
    if (unchanged) return;
    if (!expectedUpdatedAt) {
      throw new CabinetConflictError("План открыт в устаревшей форме. Обнови страницу и повтори сохранение.");
    }

    const updated = await tx.weeklyPlan.updateMany({
      where: {
        id: current.id,
        clientId: session.clientId,
        weekStart,
        updatedAt: expectedUpdatedAt,
      },
      data: { focus, status: "active", weekEnd },
    });
    if (updated.count !== 1) {
      const latest = await tx.weeklyPlan.findUnique({
        where: { clientId_weekStart: { clientId: session.clientId, weekStart } },
        include: { tasks: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
      });
      const latestTasks = latest ? resolveTasks(inputTasks, latest.tasks) : [];
      if (latest && latest.focus === focus && latest.status === "active" && sameTasks(latest.tasks, latestTasks)) return;
      throw new CabinetConflictError();
    }

    const retainedIds = desiredTasks.flatMap((task) => task.id === null ? [] : [task.id]);
    await tx.planTask.deleteMany({
      where: {
        planId: current.id,
        ...(retainedIds.length ? { id: { notIn: retainedIds } } : {}),
      },
    });
    for (const task of desiredTasks) {
      if (task.id) {
        const taskUpdate = await tx.planTask.updateMany({
          where: { id: task.id, planId: current.id },
          data: {
            title: task.title,
            status: task.status,
            dueAt: task.dueAt,
            sortOrder: task.sortOrder,
          },
        });
        if (taskUpdate.count !== 1) throw new CabinetConflictError();
      } else {
        await tx.planTask.create({
          data: {
            planId: current.id,
            title: task.title,
            status: task.status,
            dueAt: task.dueAt,
            sortOrder: task.sortOrder,
          },
        });
      }
    }
    await touchClient(tx, session.clientId, now);
    await tx.auditLog.create({
      data: {
        entityType: "weekly_plan",
        entityId: String(current.id),
        action: "client_saved",
        payload: JSON.stringify({
          actor: "client_portal",
          clientId: session.clientId,
          weekStart: weekStart.toISOString(),
          taskCount: desiredTasks.length,
        }),
      },
    });
  }));

  try {
    await save();
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error;
    // Concurrent first saves can race on @@unique([clientId, weekStart]). An
    // identical winner is a successful idempotent replay; differing data must
    // be reviewed instead of silently overwriting it.
    const current = await prisma.weeklyPlan.findUnique({
      where: { clientId_weekStart: { clientId: session.clientId, weekStart } },
      include: { tasks: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
    });
    if (!current) throw error;
    const desiredTasks = resolveTasks(taskSubmission.tasks, current.tasks);
    if (current.focus !== focus || current.status !== "active" || !sameTasks(current.tasks, desiredTasks)) {
      throw new CabinetConflictError();
    }
  }
  revalidateCabinet(session.clientId);
}

type DailyReportData = {
  result: string | null;
  actions: string | null;
  blockers: string | null;
  nextStep: string | null;
};

function sameDailyReport(current: DailyReportData, desired: DailyReportData) {
  return (
    current.result === desired.result &&
    current.actions === desired.actions &&
    current.blockers === desired.blockers &&
    current.nextStep === desired.nextStep
  );
}

/** Saves one report for the authenticated client and the current Moscow date. */
export async function saveTodayReport(formData: FormData): Promise<void> {
  const session = await requireClientSession();
  const now = new Date();
  const { today } = currentMoscowPeriod(now);
  const expectedUpdatedAt = expectedTimestamp(formData, "dailyReportUpdatedAt", "reportUpdatedAt", "expectedUpdatedAt");
  const data: DailyReportData = {
    result: formText(formData, "result", 4_000),
    actions: formText(formData, "actions", 4_000),
    blockers: formText(formData, "blockers", 4_000),
    nextStep: formText(formData, "nextStep", 2_000),
  };

  try {
    await withTransientDbRetry(() => prisma.$transaction(async (tx) => {
      await assertActiveSession(tx, session);
      const current = await tx.dailyReport.findUnique({
        where: { clientId_reportDate: { clientId: session.clientId, reportDate: today } },
      });
      if (!current) {
        const created = await tx.dailyReport.create({ data: { clientId: session.clientId, reportDate: today, ...data } });
        await touchClient(tx, session.clientId, now);
        await tx.auditLog.create({
          data: {
            entityType: "daily_report",
            entityId: String(created.id),
            action: "client_saved",
            payload: JSON.stringify({ actor: "client_portal", clientId: session.clientId, reportDate: today.toISOString() }),
          },
        });
        return;
      }
      if (sameDailyReport(current, data)) return;
      if (!expectedUpdatedAt) {
        throw new CabinetConflictError("Отчёт открыт в устаревшей форме. Обнови страницу и повтори сохранение.");
      }
      const updated = await tx.dailyReport.updateMany({
        where: { id: current.id, clientId: session.clientId, reportDate: today, updatedAt: expectedUpdatedAt },
        data,
      });
      if (updated.count !== 1) {
        const latest = await tx.dailyReport.findUnique({
          where: { clientId_reportDate: { clientId: session.clientId, reportDate: today } },
        });
        if (latest && sameDailyReport(latest, data)) return;
        throw new CabinetConflictError();
      }
      await touchClient(tx, session.clientId, now);
      await tx.auditLog.create({
        data: {
          entityType: "daily_report",
          entityId: String(current.id),
          action: "client_saved",
          payload: JSON.stringify({ actor: "client_portal", clientId: session.clientId, reportDate: today.toISOString() }),
        },
      });
    }));
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error;
    const current = await prisma.dailyReport.findUnique({
      where: { clientId_reportDate: { clientId: session.clientId, reportDate: today } },
    });
    if (!current || !sameDailyReport(current, data)) throw new CabinetConflictError();
  }
  revalidateCabinet(session.clientId);
}

type WeeklyReportData = {
  summary: string | null;
  revenue: number | null;
  leads: number | null;
  sales: number | null;
  wins: string | null;
  blockers: string | null;
  nextFocus: string | null;
};

function sameWeeklyReport(current: WeeklyReportData, desired: WeeklyReportData) {
  return (
    current.summary === desired.summary &&
    current.revenue === desired.revenue &&
    current.leads === desired.leads &&
    current.sales === desired.sales &&
    current.wins === desired.wins &&
    current.blockers === desired.blockers &&
    current.nextFocus === desired.nextFocus
  );
}

/** Saves one weekly result for the authenticated client and current Moscow week. */
export async function saveCurrentWeekReport(formData: FormData): Promise<void> {
  const session = await requireClientSession();
  const now = new Date();
  const { weekStart } = currentMoscowPeriod(now);
  const expectedUpdatedAt = expectedTimestamp(formData, "weeklyReportUpdatedAt", "reportUpdatedAt", "expectedUpdatedAt");
  const data: WeeklyReportData = {
    summary: formText(formData, "summary", 4_000),
    revenue: optionalNumber(formData, "revenue"),
    leads: optionalNumber(formData, "leads", true),
    sales: optionalNumber(formData, "sales", true),
    wins: formText(formData, "wins", 4_000),
    blockers: formText(formData, "blockers", 4_000),
    nextFocus: formText(formData, "nextFocus", 2_000),
  };

  try {
    await withTransientDbRetry(() => prisma.$transaction(async (tx) => {
      await assertActiveSession(tx, session);
      const current = await tx.weeklyReport.findUnique({
        where: { clientId_weekStart: { clientId: session.clientId, weekStart } },
      });
      if (!current) {
        const created = await tx.weeklyReport.create({ data: { clientId: session.clientId, weekStart, ...data } });
        await touchClient(tx, session.clientId, now);
        await tx.auditLog.create({
          data: {
            entityType: "weekly_report",
            entityId: String(created.id),
            action: "client_saved",
            payload: JSON.stringify({ actor: "client_portal", clientId: session.clientId, weekStart: weekStart.toISOString() }),
          },
        });
        return;
      }
      if (sameWeeklyReport(current, data)) return;
      if (!expectedUpdatedAt) {
        throw new CabinetConflictError("Итог недели открыт в устаревшей форме. Обнови страницу и повтори сохранение.");
      }
      const updated = await tx.weeklyReport.updateMany({
        where: { id: current.id, clientId: session.clientId, weekStart, updatedAt: expectedUpdatedAt },
        data,
      });
      if (updated.count !== 1) {
        const latest = await tx.weeklyReport.findUnique({
          where: { clientId_weekStart: { clientId: session.clientId, weekStart } },
        });
        if (latest && sameWeeklyReport(latest, data)) return;
        throw new CabinetConflictError();
      }
      await touchClient(tx, session.clientId, now);
      await tx.auditLog.create({
        data: {
          entityType: "weekly_report",
          entityId: String(current.id),
          action: "client_saved",
          payload: JSON.stringify({ actor: "client_portal", clientId: session.clientId, weekStart: weekStart.toISOString() }),
        },
      });
    }));
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error;
    const current = await prisma.weeklyReport.findUnique({
      where: { clientId_weekStart: { clientId: session.clientId, weekStart } },
    });
    if (!current || !sameWeeklyReport(current, data)) throw new CabinetConflictError();
  }
  revalidateCabinet(session.clientId);
}

function requestedMaterialStatus(formData: FormData) {
  const status = formText(formData, "status", 30);
  if (status === "started" || status === "in_progress") return "in_progress" as const;
  if (status === "completed" || status === "done") return "completed" as const;
  throw new CabinetValidationError("Выбери: начать или завершить материал");
}

/** Marks an accessible published material as started or completed (monotonic). */
export async function setOwnMaterialProgress(formData: FormData): Promise<void> {
  const session = await requireClientSession();
  const materialId = positiveInteger(formData.get("materialId"));
  if (!materialId) throw new CabinetValidationError("Материал не найден");
  const requestedStatus = requestedMaterialStatus(formData);

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const now = new Date();
    try {
      await withTransientDbRetry(() => prisma.$transaction(async (tx) => {
        await assertActiveSession(tx, session);
        const material = await tx.material.findFirst({
          where: {
            id: materialId,
            isPublished: true,
            OR: [
              { programId: null },
              { program: { enrollments: { some: { clientId: session.clientId, status: "active" } } } },
              { program: { flows: { some: { enrollments: { some: { clientId: session.clientId, status: "active" } } } } } },
            ],
          },
          select: { id: true },
        });
        if (!material) throw new CabinetValidationError("Материал недоступен или больше не опубликован");

        const current = await tx.materialProgress.findUnique({
          where: { clientId_materialId: { clientId: session.clientId, materialId } },
        });
        const alreadySatisfied = current?.status === "completed" || current?.status === requestedStatus;
        if (alreadySatisfied) return;

        let progressId: number;
        if (!current) {
          const created = await tx.materialProgress.create({
            data: {
              clientId: session.clientId,
              materialId,
              status: requestedStatus,
              completedAt: requestedStatus === "completed" ? now : null,
            },
          });
          progressId = created.id;
        } else {
          const updated = await tx.materialProgress.updateMany({
            where: {
              id: current.id,
              clientId: session.clientId,
              materialId,
              status: current.status,
              updatedAt: current.updatedAt,
            },
            data: {
              status: requestedStatus,
              completedAt: requestedStatus === "completed" ? now : null,
            },
          });
          if (updated.count !== 1) throw new RetryMaterialProgressError();
          progressId = current.id;
        }
        await touchClient(tx, session.clientId, now);
        await tx.auditLog.create({
          data: {
            entityType: "material_progress",
            entityId: String(progressId),
            action: requestedStatus === "completed" ? "client_completed" : "client_started",
            payload: JSON.stringify({ actor: "client_portal", clientId: session.clientId, materialId }),
          },
        });
      }));
      revalidateCabinet(session.clientId);
      return;
    } catch (error) {
      if (attempt < 4 && (isUniqueConstraint(error) || error instanceof RetryMaterialProgressError)) continue;
      throw error;
    }
  }
}

/**
 * Confirms or declines an event visible to the authenticated client.
 * Existing attendance forms should send `attendanceUpdatedAt` so concurrent
 * answers cannot silently overwrite one another.
 */
export async function setOwnEventAttendance(formData: FormData): Promise<void> {
  const session = await requireClientSession();
  const eventId = positiveInteger(formData.get("eventId"));
  if (!eventId) throw new CabinetValidationError("Событие не найдено");
  const status = formText(formData, "status", 30);
  if (status !== "confirmed" && status !== "declined") {
    throw new CabinetValidationError("Выбери: участвую или не смогу");
  }
  const expectedUpdatedAt = expectedTimestamp(formData, "attendanceUpdatedAt", "expectedUpdatedAt");
  const now = new Date();

  try {
    await withTransientDbRetry(() => prisma.$transaction(async (tx) => {
      await assertActiveSession(tx, session);
      const event = await tx.event.findFirst({
        where: {
          id: eventId,
          OR: [
            { clientId: session.clientId },
            { attendances: { some: { clientId: session.clientId } } },
          ],
        },
        select: { id: true },
      });
      if (!event) throw new CabinetValidationError("Событие недоступно в твоём кабинете");

      const current = await tx.attendance.findUnique({
        where: { eventId_clientId: { eventId, clientId: session.clientId } },
      });
      if (current?.status === status) return;

      let attendanceId: number;
      if (!current) {
        const created = await tx.attendance.create({
          data: { eventId, clientId: session.clientId, status },
        });
        attendanceId = created.id;
      } else {
        if (!expectedUpdatedAt) {
          throw new CabinetConflictError("Ответ на событие открыт в устаревшей форме. Обнови страницу.");
        }
        const updated = await tx.attendance.updateMany({
          where: {
            id: current.id,
            eventId,
            clientId: session.clientId,
            updatedAt: expectedUpdatedAt,
          },
          data: { status },
        });
        if (updated.count !== 1) {
          const latest = await tx.attendance.findUnique({
            where: { eventId_clientId: { eventId, clientId: session.clientId } },
          });
          if (latest?.status === status) return;
          throw new CabinetConflictError();
        }
        attendanceId = current.id;
      }

      await touchClient(tx, session.clientId, now);
      await tx.auditLog.create({
        data: {
          entityType: "attendance",
          entityId: String(attendanceId),
          action: status === "confirmed" ? "client_confirmed" : "client_declined",
          payload: JSON.stringify({ actor: "client_portal", clientId: session.clientId, eventId }),
        },
      });
    }));
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error;
    const current = await prisma.attendance.findUnique({
      where: { eventId_clientId: { eventId, clientId: session.clientId } },
    });
    if (!current || current.status !== status) throw new CabinetConflictError();
  }

  revalidatePath("/cabinet");
  revalidatePath("/cabinet/events");
  revalidatePath("/events");
  revalidatePath(`/clients/${session.clientId}`);
}
