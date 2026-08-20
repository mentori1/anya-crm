import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { uploadOwnAvatar } from "@/lib/avatar-actions";
import { cabinetAvatarUrl, requireCabinetClient, visibleEventsWhere, visibleMaterialsWhere } from "@/lib/cabinet-data";
import { prisma } from "@/lib/db";
import { formatMoscowDateTime, moscowDayStart, moscowWeekBounds } from "@/lib/moscow-time";
import { filesystemAvatarUploadsAvailable } from "@/lib/runtime-capabilities";

export const dynamic = "force-dynamic";

function goalProgress(goal: { startValue: number | null; currentValue: number | null; targetValue: number | null }) {
  if (goal.startValue === null || goal.currentValue === null || goal.targetValue === null || goal.startValue === goal.targetValue) return 0;
  return Math.max(0, Math.min(100, Math.round(((goal.currentValue - goal.startValue) / (goal.targetValue - goal.startValue)) * 100)));
}

function usableUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.hostname.endsWith(".invalid") ? null : value;
  } catch {
    return null;
  }
}

export default async function ClientCabinetPage() {
  const client = await requireCabinetClient();
  const now = new Date();
  const today = moscowDayStart(now);
  const week = moscowWeekBounds(now);
  const [goals, plan, feedback, materials, events, dailyReport, weeklyReport] = await Promise.all([
    prisma.goal.findMany({ where: { clientId: client.id, status: "active" }, orderBy: { createdAt: "desc" }, take: 3 }),
    prisma.weeklyPlan.findFirst({
      where: { clientId: client.id, weekStart: week.start, status: { not: "draft" } },
      include: { tasks: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.feedback.findFirst({ where: { clientId: client.id }, orderBy: { createdAt: "desc" } }),
    prisma.material.findMany({
      where: visibleMaterialsWhere(client.id),
      select: { id: true, progress: { where: { clientId: client.id }, select: { status: true }, take: 1 } },
    }),
    prisma.event.findMany({
      where: { ...visibleEventsWhere(client.id), startsAt: { gte: now } },
      orderBy: { startsAt: "asc" },
      take: 3,
    }),
    prisma.dailyReport.findUnique({ where: { clientId_reportDate: { clientId: client.id, reportDate: today } } }),
    prisma.weeklyReport.findUnique({ where: { clientId_weekStart: { clientId: client.id, weekStart: week.start } } }),
  ]);

  const firstName = client.fullName.trim().split(/\s+/)[0] || client.fullName;
  const photoSrc = cabinetAvatarUrl(client);
  const nextEvent = events[0];
  const nextEventUrl = usableUrl(nextEvent?.link ?? null);
  const doneTasks = plan?.tasks.filter((task) => task.status === "done").length ?? 0;
  const materialDone = materials.filter((material) => material.progress[0]?.status === "completed").length;
  const avatarUploadAvailable = filesystemAvatarUploadsAvailable();

  return (
    <div className="portal-page-stack">
      <section className="portal-profile portal-profile-home">
        <Avatar name={client.fullName} src={photoSrc} size={70} className="profile" />
        <div>
          <p className="eyebrow">Добро пожаловать</p>
          <h1>{firstName}, всё важное здесь</h1>
          <p>Смотри ближайший шаг, отмечай сделанное и фиксируй результат.</p>
        </div>
        {avatarUploadAvailable ? (
          <details className="portal-avatar-upload">
            <summary>Изменить фото</summary>
            <form action={uploadOwnAvatar}>
              <input type="file" name="avatar" accept="image/jpeg,image/png,image/webp" required />
              <button className="button-secondary">Загрузить</button>
            </form>
          </details>
        ) : null}
      </section>

      <div className="portal-overview-grid">
        <section className="panel portal-focus">
          <div className="section-heading"><div><span className="section-kicker">Ближайшее</span><h2>Созвон или эфир</h2></div><Link className="text-link" href="/cabinet/events">Все события</Link></div>
          {nextEvent ? (
            <article className="portal-event">
              <span>{formatMoscowDateTime(nextEvent.startsAt)}</span>
              <h3>{nextEvent.title}</h3>
              <p>{nextEvent.durationMinutes} минут</p>
              {nextEventUrl
                ? <a className="event-button" href={nextEventUrl} target="_blank" rel="noreferrer">Подключиться <b>↗</b></a>
                : <small>Ссылка появится здесь после добавления Аней.</small>}
            </article>
          ) : <div className="empty-state"><span>◌</span><strong>Ближайших событий нет</strong><p>Когда появится новый эфир или созвон, он будет здесь.</p></div>}
        </section>

        <section className="panel portal-journey">
          <div className="section-heading"><div><span className="section-kicker">Мой путь</span><h2>Точка А → точка Б</h2></div></div>
          {goals.length ? <div className="goals-list">{goals.map((goal) => {
            const progress = goalProgress(goal);
            return (
              <article key={goal.id}>
                <strong>{goal.title}</strong>
                <div className="goal-values"><small>А: {goal.startValue ?? "—"} {goal.unit}</small><b>{goal.currentValue ?? "—"} {goal.unit}</b><small>Б: {goal.targetValue ?? "—"} {goal.unit}</small></div>
                <div className="goal-progress"><i style={{ width: `${progress}%` }} /></div>
                <small>{progress}% пути</small>
              </article>
            );
          })}</div> : <div className="empty-state"><span>↗</span><strong>Цель настраивается</strong><p>После фиксации точки А и точки Б здесь появится прогресс.</p></div>}
        </section>

        <section className="panel portal-today">
          <div className="section-heading"><div><span className="section-kicker">Сегодня</span><h2>Рабочий ритм</h2></div></div>
          <div className="portal-status-cards">
            <Link href="/cabinet/plan"><span>План недели</span><strong>{plan ? `${doneTasks}/${plan.tasks.length}` : "Не заполнен"}</strong><small>{plan?.focus ?? "Зафиксируй главный фокус"}</small></Link>
            <Link href="/cabinet/results"><span>Отчёт за день</span><strong>{dailyReport ? "Готов" : "Ждёт"}</strong><small>{dailyReport?.result ?? "Запиши результат и следующий шаг"}</small></Link>
            <Link href="/cabinet/results"><span>Итоги недели</span><strong>{weeklyReport ? "Готовы" : "Ждут"}</strong><small>{weeklyReport?.summary ?? "Собери цифры, победы и сложности"}</small></Link>
            <Link href="/cabinet/materials"><span>Материалы</span><strong>{materialDone}/{materials.length}</strong><small>завершено</small></Link>
          </div>
        </section>

        <section className="panel portal-plan-preview">
          <div className="section-heading"><div><span className="section-kicker">Текущая неделя</span><h2>Мой план</h2></div><Link className="text-link" href="/cabinet/plan">Открыть план</Link></div>
          {plan ? <><p className="portal-focus-copy">{plan.focus}</p><div className="portal-task-list">{plan.tasks.slice(0, 4).map((task, index) => <div className={task.status === "done" ? "done" : ""} key={task.id}><span>{task.status === "done" ? "✓" : index + 1}</span><p>{task.title}</p></div>)}</div></> : <div className="empty-state"><span>✓</span><strong>План пока не добавлен</strong><p>Открой раздел и зафиксируй задачи на эту неделю.</p><Link className="button-secondary" href="/cabinet/plan">Составить план</Link></div>}
        </section>

        <section className="panel portal-feedback-card">
          <div className="section-heading"><div><span className="section-kicker">Обратная связь</span><h2>От Ани</h2></div><Link className="text-link" href="/cabinet/results">Вся история</Link></div>
          {feedback ? <div className="portal-feedback"><span className="person-avatar">А</span><p>{feedback.body}</p></div> : <div className="empty-state"><span>А</span><strong>Сообщений пока нет</strong><p>Обратная связь по твоим результатам появится здесь.</p></div>}
        </section>
      </div>
    </div>
  );
}
