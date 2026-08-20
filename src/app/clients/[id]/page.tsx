import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { createEvent, addGoal, addPrivateNote, updateClient } from "@/lib/actions";
import { syncTelegramAvatar, uploadClientAvatar } from "@/lib/avatar-actions";
import { configureClientPortal, disableClientPortal } from "@/lib/client-portal-actions";
import { prisma } from "@/lib/db";
import { clientStatusLabels, formatDate, inputDate } from "@/lib/format";
import { filesystemAvatarUploadsAvailable } from "@/lib/runtime-capabilities";
import { telegramIsConfigured } from "@/lib/telegram-api";

export const dynamic = "force-dynamic";

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ access?: string; error?: string; duplicateId?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const clientId = Number(id);
  if (!Number.isInteger(clientId)) notFound();
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      goals: { orderBy: { createdAt: "desc" } },
      privateNotes: { orderBy: { createdAt: "desc" }, take: 10 },
      enrollments: { include: { flow: true, program: true }, orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "desc" }, take: 5 },
      portalAccess: true,
      _count: { select: { dailyReports: true, weeklyReports: true, events: true } },
    },
  });
  if (!client) notFound();
  const photoSrc = client.avatarStorageKey || client.telegramAvatarFileId
    ? `/api/clients/${client.id}/avatar?v=${client.avatarUpdatedAt?.getTime() ?? 0}`
    : null;
  const telegramReady = telegramIsConfigured();
  const avatarUploadAvailable = filesystemAvatarUploadsAvailable();
  const goalSubmissionKey = randomUUID();
  const eventSubmissionKey = randomUUID();
  const noteSubmissionKey = randomUUID();

  return (
    <div className="page-stack">
      <header className="client-heading">
        <Link href="/clients" className="back-link">← Клиенты</Link>
        <div className="client-identity"><Avatar name={client.fullName} src={photoSrc} size={64} className="profile" /><div><p className="eyebrow">Карточка клиента</p><h1>{client.fullName}</h1><p>{client.telegram || client.phone || client.email || "Контакт не указан"}</p></div></div>
        <span className={`status-badge status-${client.status}`}>{clientStatusLabels[client.status] ?? client.status}</span>
      </header>

      <div className="client-detail-grid">
        <section className="panel detail-main">
          {query.error === "stale" ? <p className="form-banner">Кто-то уже изменил эту карточку. CRM не затёрла новые данные: проверь обновлённую карточку и сохрани свою правку ещё раз.</p> : null}
          {query.error === "duplicate" ? <p className="form-banner">Такой телефон, Telegram или email уже есть у другого клиента. {query.duplicateId ? <Link href={`/clients/${query.duplicateId}`}>Открыть его карточку</Link> : null}</p> : null}
          <div className="section-heading"><div><span className="section-kicker">Путь клиента</span><h2>Точка А → точка Б</h2></div><span className="count-badge">{client.goals.length}</span></div>
          {client.goals.length ? <div className="goals-list">{client.goals.map((goal) => {
            const progress = goal.startValue !== null && goal.targetValue !== null && goal.currentValue !== null && goal.targetValue !== goal.startValue
              ? Math.max(0, Math.min(100, Math.round(((goal.currentValue - goal.startValue) / (goal.targetValue - goal.startValue)) * 100))) : 0;
            return <article key={goal.id}><div><strong>{goal.title}</strong><span>{goal.movement === "ahead" ? "Опережает" : goal.movement === "behind" ? "Отстаёт" : "По плану"}</span></div><div className="goal-values"><small>А: {goal.startValue ?? "—"} {goal.unit}</small><b>{goal.currentValue ?? "—"} {goal.unit}</b><small>Б: {goal.targetValue ?? "—"} {goal.unit}</small></div><div className="goal-progress"><i style={{ width: `${progress}%` }} /></div><small>{progress}% пути</small></article>;
          })}</div> : <div className="empty-inline"><span>↗</span><div><strong>Цель ещё не зафиксирована</strong><p>Добавь точку А, текущий результат и точку Б.</p></div></div>}

          <details className="inline-details"><summary>+ Добавить цель</summary><form action={addGoal} className="data-form compact-form"><input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="submissionKey" value={goalSubmissionKey} /><label className="field-wide"><span>Название цели</span><input name="title" required placeholder="Например, выйти на 400 000 ₽ в месяц" /></label><label><span>Точка А</span><input name="startValue" inputMode="decimal" /></label><label><span>Сейчас</span><input name="currentValue" inputMode="decimal" /></label><label><span>Точка Б</span><input name="targetValue" inputMode="decimal" /></label><label><span>Единица</span><input name="unit" placeholder="₽, клиентов, %" /></label><label><span>Движение</span><select name="movement"><option value="on_track">По плану</option><option value="ahead">Опережает</option><option value="behind">Отстаёт</option></select></label><label><span>Срок</span><input type="date" name="deadline" /></label><button className="button-primary field-wide">Сохранить цель</button></form></details>
        </section>

        <section className="panel detail-main quick-call-panel">
          <div className="section-heading"><div><span className="section-kicker">Личная встреча</span><h2>Назначить созвон</h2></div><span className="call-badge">Телемост</span></div>
          <form action={createEvent} className="data-form compact-form">
            <input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="kind" value="call" /><input type="hidden" name="submissionKey" value={eventSubmissionKey} />
            <label className="field-wide"><span>Название</span><input name="title" required defaultValue={`Созвон с ${client.fullName}`} /></label>
            <label><span>Дата и время</span><input name="startsAt" type="datetime-local" required /></label><label><span>Длительность, минут</span><input name="durationMinutes" type="number" min="5" defaultValue="60" /></label>
            <label className="field-wide"><span>Ссылка Телемоста</span><input name="link" type="url" required placeholder="https://telemost.yandex.ru/…" /></label>
            <p className="field-wide form-hint">После сохранения встреча и ссылка сразу появятся в личном кабинете этого клиента.</p>
            <button className="button-primary field-wide">Назначить и выдать ссылку</button>
          </form>
        </section>

        <aside className="detail-side">
          <section className="panel compact-panel avatar-panel">
            <div className="section-heading"><div><span className="section-kicker">Фотография</span><h2>Аватар клиента</h2></div><Avatar name={client.fullName} src={photoSrc} size={48} /></div>
            {avatarUploadAvailable ? <form action={uploadClientAvatar} className="avatar-upload-form"><input type="hidden" name="clientId" value={client.id} /><input type="file" name="avatar" accept="image/jpeg,image/png,image/webp" required /><button className="button-secondary">Загрузить фото</button></form> : <p className="form-hint">Загрузка файла появится после подключения постоянного хранилища изображений.</p>}
            <div className="avatar-sync-row"><span>{client.telegramAvatarFileId ? telegramReady ? "Фото Telegram найдено" : "Фото сохранено, но бот не подключён" : client.telegramUserId ? telegramReady ? "Можно запросить фото Telegram" : "Подключи Telegram-бота для синхронизации" : "Telegram ID появится после подключения бота"}</span><form action={syncTelegramAvatar}><input type="hidden" name="clientId" value={client.id} /><button className="text-link" disabled={!telegramReady || !client.telegramUserId}>Подтянуть</button></form></div>
            <p className="form-hint">{avatarUploadAvailable ? "Приоритет: фото, загруженное здесь или клиентом → фото Telegram → инициалы." : "Сейчас доступны фото Telegram и инициалы."}</p>
          </section>

          <section className="panel compact-panel">
            <div className="section-heading"><div><span className="section-kicker">Данные</span><h2>Контакт и статус</h2></div></div>
            <form action={updateClient} className="data-form compact-form"><input type="hidden" name="id" value={client.id} /><input type="hidden" name="version" value={client.version} /><label className="field-wide"><span>Имя</span><input name="fullName" defaultValue={client.fullName} required /></label><label><span>Телефон</span><input name="phone" defaultValue={client.phone ?? ""} /></label><label><span>Telegram</span><input name="telegram" defaultValue={client.telegram ?? ""} /></label><label><span>Email</span><input name="email" defaultValue={client.email ?? ""} /></label><label><span>Источник</span><input name="source" defaultValue={client.source ?? ""} /></label><label><span>Статус</span><select name="status" defaultValue={client.status}><option value="new">Новый</option><option value="active">В работе</option><option value="paused">Пауза</option><option value="completed">Завершил</option><option value="upsell">На допродажу</option><option value="archived">Архив</option></select></label><label><span>Следующий контакт</span><input name="nextContactAt" type="date" defaultValue={inputDate(client.nextContactAt)} /></label><details className="field-wide technical-fields"><summary>Связь с Telegram</summary><div><label><span>Telegram User ID</span><input name="telegramUserId" defaultValue={client.telegramUserId ?? ""} /></label><label><span>Telegram Chat ID</span><input name="telegramChatId" defaultValue={client.telegramChatId ?? ""} /></label></div></details><button className="button-secondary field-wide">Сохранить изменения</button></form>
          </section>

          <section className="panel compact-panel portal-access-panel">
            <div className="section-heading"><div><span className="section-kicker">Личный кабинет</span><h2>Доступ клиента</h2></div>{client.portalAccess?.isActive ? <span className="status-badge status-active">Включён</span> : null}</div>
            {query.access === "saved" ? <p className="form-banner">Код сохранён. Передай клиенту ссылку и назначенный код.</p> : null}
            {client.portalAccess?.isActive ? <div className="portal-link-box"><span>Персональная ссылка</span><a href={`/cabinet/login?client=${client.portalAccess.publicId}`} target="_blank">/cabinet/login?client={client.portalAccess.publicId}</a><small>Открывает только кабинет этого клиента, без доступа к CRM Ани.</small></div> : <p className="muted-copy">Доступ ещё не создан.</p>}
            <form action={configureClientPortal} className="portal-access-form"><input type="hidden" name="clientId" value={client.id} /><label><span>{client.portalAccess ? "Новый код доступа" : "Придумай код доступа"}</span><input name="pin" inputMode="numeric" pattern="[0-9]{6,8}" minLength={6} maxLength={8} required placeholder="6–8 цифр" /></label><button className="button-primary">{client.portalAccess ? "Обновить код" : "Создать доступ"}</button></form>
            {client.portalAccess?.isActive ? <form action={disableClientPortal}><input type="hidden" name="clientId" value={client.id} /><button className="text-link portal-disable">Отключить доступ</button></form> : null}
          </section>

          <section className="panel compact-panel">
            <div className="section-heading"><div><span className="section-kicker">История</span><h2>Рабочие заметки</h2></div></div>
            <form action={addPrivateNote} className="note-form"><input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="submissionKey" value={noteSubmissionKey} /><textarea name="body" required placeholder="Что важно помнить по клиенту…" /><button className="button-secondary">Добавить заметку</button></form>
            {client.privateNotes.length ? <div className="notes-list">{client.privateNotes.map((note) => <article key={note.id}><p>{note.body}</p><small>{formatDate(note.createdAt)}</small></article>)}</div> : <p className="muted-copy">Заметок пока нет.</p>}
          </section>
        </aside>
      </div>

      <section className="panel client-numbers"><div><span>Ежедневных отчётов</span><strong>{client._count.dailyReports}</strong></div><div><span>Итогов недели</span><strong>{client._count.weeklyReports}</strong></div><div><span>Созвонов и эфиров</span><strong>{client._count.events}</strong></div><div><span>В базе с</span><strong>{formatDate(client.createdAt)}</strong></div></section>
    </div>
  );
}
