import { randomUUID } from "node:crypto";
import Link from "next/link";
import {
  createNotificationTemplate,
  updateNotificationTemplate,
} from "@/lib/reminder-actions";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const channelLabels: Record<string, string> = {
  telegram: "Telegram",
  manual: "Сообщение вручную",
  email: "Email",
};

type SearchParams = Promise<{ error?: string; id?: string }>;

export default async function RemindersPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const submissionKey = randomUUID();
  const [templates, auditLogs] = await Promise.all([
    prisma.notificationTemplate.findMany({ orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }] }),
    prisma.auditLog.findMany({
      where: { entityType: "notification_template" },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Коммуникация</p>
          <h1>Напоминания</h1>
          <p>Рабочие тексты для планов, отчётов, эфиров, созвонов и оплат.</p>
        </div>
        <Link href="/more" className="button-secondary">← Все инструменты</Link>
      </header>

      {query.error === "stale" ? <p className="form-banner">Шаблон №{query.id} уже изменили в другой вкладке. CRM не затёрла ту правку: открой шаблон заново и повтори изменение.</p> : null}
      <p className="stage-note">Очередь Telegram уже связана с данными CRM и защищена от двойной обработки. Реальная отправка остаётся выключенной до подключения отдельного бота Ани.</p>

      <div className="two-column">
        <section className="panel list-panel">
          <div className="section-heading">
            <div><span className="section-kicker">Библиотека</span><h2>Шаблоны сообщений</h2></div>
            <span className="count-badge">{templates.length}</span>
          </div>

          {templates.length ? (
            <div className="goals-list">
              {templates.map((template) => (
                <article key={template.id}>
                  <div>
                    <strong>{template.title}</strong>
                    <span>{template.isActive ? "Активен" : "Выключен"}</span>
                  </div>
                  <p className="muted-copy">{template.body}</p>
                  <small>
                    {channelLabels[template.channel] ?? template.channel} · обновлён {formatDateTime(template.updatedAt)}
                  </small>

                  <details className="inline-details">
                    <summary>Редактировать шаблон</summary>
                    <form action={updateNotificationTemplate} className="data-form compact-form">
                      <input type="hidden" name="id" value={template.id} />
                      <input type="hidden" name="version" value={template.version} />
                      <label className="field-wide">
                        <span>Название</span>
                        <input name="title" defaultValue={template.title} required maxLength={120} />
                      </label>
                      <label className="field-wide">
                        <span>Текст сообщения</span>
                        <textarea name="body" defaultValue={template.body} required rows={5} maxLength={3000} />
                      </label>
                      <label>
                        <span>Канал</span>
                        <select name="channel" defaultValue={template.channel}>
                          <option value="telegram">Telegram</option>
                          <option value="manual">Сообщение вручную</option>
                          <option value="email">Email</option>
                        </select>
                      </label>
                      <label>
                        <span>Состояние</span>
                        <select name="isActive" defaultValue={String(template.isActive)}>
                          <option value="true">Активен</option>
                          <option value="false">Выключен</option>
                        </select>
                      </label>
                      <button className="button-primary field-wide">Сохранить изменения</button>
                    </form>
                  </details>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state empty-state-tall">
              <span>↗</span>
              <strong>Шаблонов пока нет</strong>
              <p>Создай первый текст для регулярного сообщения справа.</p>
            </div>
          )}
        </section>

        <section className="panel form-panel sticky-panel">
          <div className="section-heading">
            <div><span className="section-kicker">Новый текст</span><h2>Создать шаблон</h2></div>
          </div>
          <form action={createNotificationTemplate} className="data-form compact-form">
            <input type="hidden" name="submissionKey" value={submissionKey} />
            <label className="field-wide">
              <span>Название</span>
              <input name="title" required maxLength={120} placeholder="Например, Вечерний отчёт" />
            </label>
            <label className="field-wide">
              <span>Текст сообщения</span>
              <textarea
                name="body"
                required
                rows={7}
                maxLength={3000}
                placeholder="Например: пришли сегодня короткий отчёт — что сделал, какой результат и что планируешь завтра."
              />
            </label>
            <label>
              <span>Канал</span>
              <select name="channel" defaultValue="telegram">
                <option value="telegram">Telegram</option>
                <option value="manual">Сообщение вручную</option>
                <option value="email">Email</option>
              </select>
            </label>
            <label>
              <span>Состояние</span>
              <select name="isActive" defaultValue="true">
                <option value="true">Активен</option>
                <option value="false">Выключен</option>
              </select>
            </label>
            <button className="button-primary field-wide">Создать шаблон</button>
          </form>
        </section>
      </div>

      <section className="panel compact-panel">
        <div className="section-heading">
          <div><span className="section-kicker">История</span><h2>Последние изменения</h2></div>
          <span className="count-badge">{auditLogs.length}</span>
        </div>
        {auditLogs.length ? (
          <div className="notes-list">
            {auditLogs.map((log) => (
              <article key={log.id}>
                <p>{log.action === "created" ? "Создан" : "Обновлён"} шаблон №{log.entityId}</p>
                <small>{formatDateTime(log.createdAt)}</small>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-inline">
            <span>◌</span><div><strong>Изменений пока нет</strong><p>История появится после создания первого шаблона.</p></div>
          </div>
        )}
      </section>
    </div>
  );
}
