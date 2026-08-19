import "server-only";

import { redirect } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { getClientPortalSession } from "@/lib/client-auth";
import { prisma } from "@/lib/db";

export async function requireCabinetClient() {
  const session = await getClientPortalSession();
  if (!session) redirect("/cabinet/login");

  const client = await prisma.client.findUnique({
    where: { id: session.clientId },
    select: {
      id: true,
      fullName: true,
      avatarStorageKey: true,
      telegramAvatarFileId: true,
      avatarUpdatedAt: true,
    },
  });
  if (!client) redirect("/cabinet/login");

  return client;
}

export function cabinetAvatarUrl(client: {
  id: number;
  avatarStorageKey: string | null;
  telegramAvatarFileId: string | null;
  avatarUpdatedAt: Date | null;
}) {
  if (!client.avatarStorageKey && !client.telegramAvatarFileId) return null;
  return `/api/clients/${client.id}/avatar?v=${client.avatarUpdatedAt?.getTime() ?? 0}`;
}

export function visibleMaterialsWhere(clientId: number): Prisma.MaterialWhereInput {
  return {
    isPublished: true,
    OR: [
      { programId: null },
      { program: { enrollments: { some: { clientId, status: "active" } } } },
      { program: { flows: { some: { enrollments: { some: { clientId, status: "active" } } } } } },
    ],
  };
}

export function visibleEventsWhere(clientId: number): Prisma.EventWhereInput {
  return {
    status: { not: "cancelled" },
    OR: [
      { clientId },
      { attendances: { some: { clientId } } },
    ],
  };
}
