import type { ReactNode } from "react";
import { ClientPortalShell } from "@/components/ClientPortalShell";
import { cabinetAvatarUrl } from "@/lib/cabinet-data";
import { getClientPortalSession } from "@/lib/client-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function CabinetLayout({ children }: { children: ReactNode }) {
  const session = await getClientPortalSession();
  const client = session
    ? await prisma.client.findUnique({
        where: { id: session.clientId },
        select: {
          id: true,
          fullName: true,
          avatarStorageKey: true,
          telegramAvatarFileId: true,
          avatarUpdatedAt: true,
        },
      })
    : null;

  return (
    <ClientPortalShell client={client ? { fullName: client.fullName, photoSrc: cabinetAvatarUrl(client) } : null}>
      {children}
    </ClientPortalShell>
  );
}
