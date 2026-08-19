import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { resolveAttention } from "@/lib/actions";

export const dynamic = "force-dynamic";

function startOfCurrentWeek() {
  const now = new Date();
  const day = now.getDay() || 7;
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() - day + 1);
  return now;
}

export default async function DashboardPage() {
  const now = new Date();
  const weekStart = startOfCurrentWeek();
  const [events, attentionItems, activeClients, totalClients, reports, goalGroups] = await Promise.all([
    prisma.event.findMany({
      where: { startsAt: { gte: now }, status: { not: "cancelled" } },
      include: { client: true, flow: true },
      orderBy: { startsAt: "asc" },
      take: 3,
    }),
    prisma.attentionItem.findMany({
      where: { resolvedAt: null },
      include: { client: true },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 50,
    }),
    prisma.client.count({ where: { status: "active" } }),
    prisma.client.count({ where: { status: { not: "archived" } } }),
    prisma.weeklyReport.count({ where: { weekStart: { gte: weekStart } } }),
    prisma.goal.groupBy({
      by: ["movement"],
      where: { status: "active" },
      _count: { _all: true },
    }),
  ]);

  const priorityRank: Record<string, number> = { high: 0, normal: 1, low: 2 };
  const attention = attentionItems
    .sort((a, b) => {
      const byPriority = (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1);
      if (byPriority !== 0) return byPriority;
      return (a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER);
    })
    .slice(0, 6);

  const movement = Object.fromEntries(goalGroups.map((row) => [row.movement, row._count._all]));
  const reportPercent = activeClients ? Math.min(100, Math.round((reports / activeClients) * 100)) : 0;
  const mainEvent = events[0];

  return (
    <div className="page-stack">
      <header className="page-heading dashboard-heading">
        <div>
          <p className="eyebrow">{new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(now)}</p>
          <h1>Доброе утро, Аня</h1>
          <p>Ближайшие дела и состояние клиентов собраны в одном месте.</p>
        </div>
        <Link href="/clients/new" className="button-primary">+ Добавить клиента</Link>
      </header>

      <div className="dashboard-grid">
        <section className="panel events-panel">
          <div className="section-heading">
            <div><span className="section-kicker">Расписание</span><h2>Ближайшие события</h2></div>
            <Link href="/events" className="text-link">Все события</Link>
          </div>

          {mainEvent ? (
            <>
              <article className="event-hero">
                <div className="event-orb" />
                <div className="event-meta"><span>{formatDateTime(mainEvent.startsAt)}</span><span>{mainEvent.kind === "call" ? "Созвон" : "Эфир"}</span></div>
                <h3>{mainEvent.title}</h3>
                <p>{mainEvent.flow?.title ?? mainEvent.client?.fullName ?? `Продолжительность ${mainEvent.durationMinutes} минут`}</p>
                {mainEvent.link ? <a href={mainEvent.link} target="_blank" rel="noreferrer" className="event-button">Открыть встречу <span>↗</span></a> : <Link href="/events" className="event-button">Открыть расписание <span>→</span></Link>}
              </article>
              <div className="timeline-list">
                {events.slice(1).map((event) => (
                  <Link href="/events" key={event.id}>
                    <time>{new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(event.startsAt)}</time>
                    <span><strong>{event.title}</strong><small>{formatDateTime(event.startsAt)}</small></span>
                    <b>›</b>
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state empty-state-tall">
              <span>◌</span><strong>Событий пока нет</strong><p>Добавь эфир или созвон, и он появится здесь.</p>
              <Link href="/events" className="button-secondary">Создать событие</Link>
            </div>
          )}
        </section>

        <section className="panel attention-panel">
          <div className="section-heading">
            <div><span className="section-kicker">Приоритет</span><h2>Требует внимания</h2></div>
            <span className="count-badge">{attention.length}</span>
          </div>
          {attention.length ? (
            <div className="attention-list">
              {attention.map((item) => (
                <article className={`attention-card priority-${item.priority}`} key={item.id}>
                  {item.client ? <Avatar name={item.client.fullName} size={40} src={item.client.avatarStorageKey || item.client.telegramAvatarFileId ? `/api/clients/${item.client.id}/avatar?v=${item.client.avatarUpdatedAt?.getTime() ?? 0}` : null} /> : <span className="person-avatar">!</span>}
                  <div><strong>{item.client?.fullName ?? item.title}</strong><span>{item.client ? item.title : item.kind}</span><small>{item.dueAt ? formatDateTime(item.dueAt) : "Без срока"}</small></div>
                  <form action={resolveAttention}><input type="hidden" name="id" value={item.id} /><button title="Отметить выполненным">✓</button></form>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state"><span>✓</span><strong>Всё разобрано</strong><p>Новых срочных действий нет.</p></div>
          )}
        </section>

        <section className="panel metrics-panel">
          <div className="section-heading">
            <div><span className="section-kicker">Общая картина</span><h2>Показатели</h2></div>
            <Link href="/clients" className="text-link">К клиентам</Link>
          </div>
          <div className="metrics-grid">
            <article className="metric-card"><span>Клиентов в работе</span><strong>{activeClients}</strong><small>{totalClients} всего в базе</small></article>
            <article className="metric-card"><span>Итоги за неделю</span><strong>{reports}<em>/{activeClients}</em></strong><div className="micro-progress"><i style={{ width: `${reportPercent}%` }} /></div></article>
            <article className="metric-card metric-card-wide">
              <span>Движение к целям</span>
              <div className="status-row">
                <div><b>{movement.on_track ?? 0}</b><small><i className="status-dot good" />По плану</small></div>
                <div><b>{movement.ahead ?? 0}</b><small><i className="status-dot ahead" />Опережают</small></div>
                <div><b>{movement.behind ?? 0}</b><small><i className="status-dot late" />Отстают</small></div>
              </div>
            </article>
          </div>
        </section>
      </div>
    </div>
  );
}
