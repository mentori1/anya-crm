import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { prisma } from "@/lib/db";
import { clientStatusLabels, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ q?: string; status?: string }>;

export default async function ClientsPage({ searchParams }: { searchParams: SearchParams }) {
  const { q = "", status = "all" } = await searchParams;
  const clients = await prisma.client.findMany({
    where: {
      ...(status !== "all" ? { status } : { status: { not: "archived" } }),
      ...(q ? { OR: [{ fullName: { contains: q } }, { phone: { contains: q } }, { telegram: { contains: q } }] } : {}),
    },
    include: { _count: { select: { goals: true, weeklyReports: true } } },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div><p className="eyebrow">Единая база</p><h1>Клиенты</h1><p>Контакты, путь к цели, планы и история работы.</p></div>
        <Link href="/clients/new" className="button-primary">+ Добавить клиента</Link>
      </header>

      <section className="panel list-panel">
        <form className="filters" method="get">
          <label className="search-field"><span>⌕</span><input name="q" defaultValue={q} placeholder="Имя, телефон или Telegram" /></label>
          <select name="status" defaultValue={status}>
            <option value="all">Все активные</option><option value="new">Новые</option><option value="active">В работе</option><option value="paused">Пауза</option><option value="completed">Завершили</option><option value="upsell">На допродажу</option><option value="archived">Архив</option>
          </select>
          <button className="button-secondary">Найти</button>
        </form>

        <div className="list-summary"><strong>{clients.length}</strong><span>найдено в базе</span></div>
        {clients.length ? (
          <div className="client-list">
            {clients.map((client) => (
              <Link href={`/clients/${client.id}`} className="client-row" key={client.id}>
                <Avatar name={client.fullName} size={44} className="large" src={client.avatarStorageKey || client.telegramAvatarFileId ? `/api/clients/${client.id}/avatar?v=${client.avatarUpdatedAt?.getTime() ?? 0}` : null} />
                <span className="client-copy"><strong>{client.fullName}</strong><small>{client.telegram || client.phone || client.email || "Контакт не указан"}</small></span>
                <span className="client-facts"><small>Целей</small><b>{client._count.goals}</b></span>
                <span className="client-facts desktop-only"><small>Последняя активность</small><b>{formatDate(client.lastActivityAt ?? client.createdAt)}</b></span>
                <span className={`status-badge status-${client.status}`}>{clientStatusLabels[client.status] ?? client.status}</span>
                <b className="row-arrow">›</b>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state empty-state-tall"><span>＋</span><strong>Пока никого нет</strong><p>Добавь первого клиента или измени условия поиска.</p><Link href="/clients/new" className="button-secondary">Добавить клиента</Link></div>
        )}
      </section>
    </div>
  );
}
