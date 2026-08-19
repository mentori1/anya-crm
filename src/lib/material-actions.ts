"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma, withTransientDbRetry } from "@/lib/db";
import { requireOwner } from "@/lib/owner-auth";

function text(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function integer(formData: FormData, key: string) {
  const value = text(formData, key);
  if (value === null) return null;

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function checked(formData: FormData, key: string) {
  const value = formData.get(key);
  return value === "on" || value === "true" || value === "1";
}

function submissionKey(formData: FormData) {
  const candidate = text(formData, "submissionKey");
  return candidate && /^[a-zA-Z0-9:_-]{16,160}$/.test(candidate) ? candidate : randomUUID();
}

function materialKind(formData: FormData) {
  const value = text(formData, "kind") ?? "lesson";
  const allowedKinds = new Set(["lesson", "live_recording", "guide", "checklist", "link"]);
  return allowedKinds.has(value) ? value : "lesson";
}

function webUrl(formData: FormData) {
  const value = text(formData, "url");
  if (!value) return null;

  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export async function createMaterial(formData: FormData) {
  await requireOwner();

  const title = text(formData, "title");
  if (!title) return;

  const requestedProgramId = integer(formData, "programId");
  const isPublished = checked(formData, "isPublished");
  const description = text(formData, "description");
  const kind = materialKind(formData);
  const url = webUrl(formData);
  const operationKey = submissionKey(formData);
  const payloadHash = createHash("sha256").update(JSON.stringify({
    title,
    description,
    kind,
    url,
    requestedProgramId,
    isPublished,
  })).digest("hex");

  try {
    await withTransientDbRetry(() => prisma.$transaction(async (tx) => {
      const receipt = await tx.mutationReceipt.create({
        data: { action: "create_material", operationKey, payloadHash, entityType: "material" },
      });
      const program = requestedProgramId
        ? await tx.program.findUnique({ where: { id: requestedProgramId }, select: { id: true } })
        : null;
      const material = await tx.material.create({
        data: { title, description, kind, url, programId: program?.id ?? null, isPublished },
      });
      await tx.auditLog.create({
        data: {
          entityType: "material",
          entityId: String(material.id),
          action: "created",
          payload: JSON.stringify({ title: material.title, kind: material.kind, programId: material.programId, isPublished: material.isPublished }),
        },
      });
      await tx.mutationReceipt.update({
        where: { id: receipt.id },
        data: { entityId: String(material.id), completedAt: new Date() },
      });
    }));
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const receipt = await prisma.mutationReceipt.findUnique({
      where: { action_operationKey: { action: "create_material", operationKey } },
    });
    if (!receipt?.entityId || receipt.payloadHash !== payloadHash) throw error;
  }
  revalidatePath("/materials");
  revalidatePath("/more");
}

export async function setMaterialPublished(formData: FormData) {
  await requireOwner();

  const id = integer(formData, "id");
  if (id === null) return;

  const isPublished = checked(formData, "isPublished");
  const changed = await withTransientDbRetry(() => prisma.$transaction(async (tx) => {
    const updated = await tx.material.updateMany({
      where: { id, isPublished: { not: isPublished } },
      data: { isPublished },
    });
    if (updated.count !== 1) return false;
    await tx.auditLog.create({
      data: {
        entityType: "material",
        entityId: String(id),
        action: isPublished ? "published" : "unpublished",
        payload: JSON.stringify({ previousValue: !isPublished, isPublished }),
      },
    });
    return true;
  }));
  if (!changed) return;
  revalidatePath("/materials");
  revalidatePath("/more");
}
