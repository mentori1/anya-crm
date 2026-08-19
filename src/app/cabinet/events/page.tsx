import { PortalActionForm } from "@/components/PortalActionForm";
import { PortalSubmitButton } from "@/components/PortalSubmitButton";
import { setOwnEventAttendance } from "@/lib/cabinet-actions";
import { requireCabinetClient, visibleEventsWhere } from "@/lib/cabinet-data";
import { prisma } from "@/lib/db";
import { formatMoscowDateTime } from "@/lib/moscow-time";

export const dynamic = "force-dynamic";

function usableUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.hostname.endsWith(".invalid") ? null : value;
  } catch {
    return null;
  }
}

const kindLabels: Record<string, string> = {
  call: "Личный созвон",
  live: "Эфир",
  workshop: "Практика",
};

export default async function CabinetEventsPage() {
  const client = await requireCabinetClient();
  const now = new Date();
  const events = await prisma.event.findMany({
    where: { ...visibleEventsWhere(client.id), startsAt: { gte: now } },
    include: { attendances: { where: { clientId: client.id }, take: 1 } },
    orderBy: { startsAt: "asc" },
    take: 20,
  });
  const confirmed = events.filter((event) => event.attendances[0]?.status === "confirmed").length;

  return (
    <div className="portal-page-stack">
      <header className="portal-page-heading">
        <div><span className="eyebrow">Расписание по Москве</span><h1>Эфиры и созвоны</h1><p>Все даты, ссылки и твои ответы собраны в одном месте.</p></div>
        <div className="portal-progress-pill"><strong>{events.length}</strong><span>впереди · {confirmed} подтверждено</span></div>
      </header>

      {events.length ? <div className="portal-event-cards">{events.map((event, index) => {
        const attendance = event.attendances[0];
        const response = attendance?.status ?? "invited";
        const url = usableUrl(event.link);
        return (
          <article className={`panel portal-event-card ${index === 0 ? "next" : ""}`} key={event.id}>
            <div className="portal-event-date"><span>{index === 0 ? "Ближайшее" : kindLabels[event.kind] ?? "Событие"}</span><strong>{formatMoscowDateTime(event.startsAt)}</strong><small>{event.durationMinutes} минут · по Москве</small></div>
            <div className="portal-event-card-main"><span className="section-kicker">{kindLabels[event.kind] ?? "Событие"}</span><h2>{event.title}</h2><p>{url ? "Ссылка уже готова. В назначенное время подключайся отсюда." : "Аня добавит ссылку, и она автоматически появится здесь."}</p></div>
            <div className="portal-event-card-actions">
              {url ? <a className="event-button" href={url} target="_blank" rel="noreferrer">Подключиться <b>↗</b></a> : <span className="portal-link-waiting">Ссылка появится позже</span>}
              <div className="portal-rsvp">
                <PortalActionForm action={setOwnEventAttendance} className="portal-inline-form" successMessage="Ответ сохранён">
                  <input type="hidden" name="eventId" value={event.id} />
                  <input type="hidden" name="status" value="confirmed" />
                  {attendance ? <input type="hidden" name="attendanceUpdatedAt" value={attendance.updatedAt.toISOString()} /> : null}
                  <PortalSubmitButton className={response === "confirmed" ? "portal-choice active" : "portal-choice"} pendingText="…">✓ Участвую</PortalSubmitButton>
                </PortalActionForm>
                <PortalActionForm action={setOwnEventAttendance} className="portal-inline-form" successMessage="Ответ сохранён">
                  <input type="hidden" name="eventId" value={event.id} />
                  <input type="hidden" name="status" value="declined" />
                  {attendance ? <input type="hidden" name="attendanceUpdatedAt" value={attendance.updatedAt.toISOString()} /> : null}
                  <PortalSubmitButton className={response === "declined" ? "portal-choice active declined" : "portal-choice"} pendingText="…">Не смогу</PortalSubmitButton>
                </PortalActionForm>
              </div>
            </div>
          </article>
        );
      })}</div> : <section className="panel"><div className="empty-state empty-state-tall"><span>◌</span><strong>В расписании пока пусто</strong><p>Новый эфир или созвон появится здесь вместе со ссылкой.</p></div></section>}
    </div>
  );
}
