import { randomUUID } from "node:crypto";
import { createEvent } from "@/lib/actions";
import { prisma } from "@/lib/db";
import { formatMoscowDateTime } from "@/lib/moscow-time";

export const dynamic = "force-dynamic";

const deliveryStatusLabels: Record<string, string> = {
  queued: "Telegram: в очереди",
  sending: "Telegram: отправляется",
  sent: "Telegram: отправлено",
  waiting: "Telegram ещё не привязан",
  error: "Telegram отклонил отправку",
  uncertain: "Нужно проверить отправку",
  draft: "Приглашение ждёт ссылку",
  portal_ready: "Ссылка в личном кабинете",
};

export default async function EventsPage() {
  const submissionKey = randomUUID();
  const [events, flows, clients] = await Promise.all([
    prisma.event.findMany({ include: { flow: true, client: true, notifications: { orderBy: { createdAt: "desc" }, take: 1 }, _count: { select: { attendances: true } } }, orderBy: { startsAt: "asc" }, take: 100 }),
    prisma.flow.findMany({ where: { status: { in: ["enrolling", "active", "draft"] } }, orderBy: { title: "asc" } }),
    prisma.client.findMany({ where: { status: { not: "archived" } }, orderBy: { fullName: "asc" } }),
  ]);

  return (
    <div className="page-stack">
      <header className="page-heading"><div><p className="eyebrow">Расписание</p><h1>Эфиры и созвоны</h1><p>Общие эфиры, личные встречи и ссылки на подключение.</p></div><a href="#new-call" className="button-primary">+ Назначить созвон</a></header>
      <div className="two-column events-layout">
        <section className="panel list-panel">
          <div className="section-heading"><div><span className="section-kicker">Календарь</span><h2>Все события</h2></div><span className="count-badge">{events.length}</span></div>
          {events.length ? <div className="schedule-list">{events.map((event) => { const invite = event.notifications[0]; return <article key={event.id}><div className="date-tile"><strong>{new Intl.DateTimeFormat("ru-RU", { day: "2-digit", timeZone: "Europe/Moscow" }).format(event.startsAt)}</strong><span>{new Intl.DateTimeFormat("ru-RU", { month: "short", timeZone: "Europe/Moscow" }).format(event.startsAt)}</span></div><div><span className="section-kicker">{event.kind === "call" ? "Созвон" : event.kind === "task" ? "Задача" : "Эфир"}</span><strong>{event.title}</strong><small>{formatMoscowDateTime(event.startsAt)} · {event.durationMinutes} мин.</small><small>{event.flow?.title ?? event.client?.fullName ?? "Общее событие"}</small>{event._count.attendances ? <small>Выдано участникам: {event._count.attendances}</small> : null}{invite ? <small className={`invite-status invite-${invite.status}`}>{deliveryStatusLabels[invite.status] ?? invite.status}</small> : null}</div>{event.link ? <a href={event.link} target="_blank" rel="noreferrer">↗</a> : <span className="event-no-link">—</span>}</article>; })}</div> : <div className="empty-state empty-state-tall"><span>◌</span><strong>Расписание пустое</strong><p>Добавь первый эфир или созвон справа.</p></div>}
        </section>
        <section className="panel form-panel sticky-panel" id="new-call">
          <div className="section-heading"><div><span className="section-kicker">Новое событие</span><h2>Назначить созвон или эфир</h2></div></div>
          <form action={createEvent} className="data-form compact-form">
            <input type="hidden" name="submissionKey" value={submissionKey} />
            <label className="field-wide"><span>Название</span><input name="title" required placeholder="Например, Разбор итогов недели" /></label>
            <label><span>Тип</span><select name="kind"><option value="live">Общий эфир</option><option value="call">Личный созвон</option><option value="task">Задача</option></select></label><label><span>Дата и время (МСК)</span><input name="startsAt" type="datetime-local" required /></label>
            <label><span>Длительность, минут</span><input name="durationMinutes" type="number" defaultValue="60" min="5" /></label><label><span>Ссылка Телемоста</span><input name="link" type="url" placeholder="https://telemost.yandex.ru/…" /></label>
            <label><span>Поток</span><select name="flowId" defaultValue=""><option value="">Не выбран</option>{flows.map((flow) => <option value={flow.id} key={flow.id}>{flow.title}</option>)}</select></label>
            <label><span>Клиент</span><select name="clientId" defaultValue=""><option value="">Не выбран</option>{clients.map((client) => <option value={client.id} key={client.id}>{client.fullName}</option>)}</select></label>
            <p className="field-wide form-hint">Личный созвон появится у выбранного клиента. Эфир потока автоматически появится у всех его активных участников. Время всегда сохраняется по Москве.</p>
            <button className="button-primary field-wide">Назначить и выдать ссылку</button>
          </form>
        </section>
      </div>
    </div>
  );
}
