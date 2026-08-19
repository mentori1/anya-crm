import { PortalActionForm } from "@/components/PortalActionForm";
import { PortalSubmitButton } from "@/components/PortalSubmitButton";
import { saveCurrentWeekReport, saveTodayReport } from "@/lib/cabinet-actions";
import { requireCabinetClient } from "@/lib/cabinet-data";
import { prisma } from "@/lib/db";
import { formatMoscowDate, moscowDayStart, moscowWeekBounds } from "@/lib/moscow-time";

export const dynamic = "force-dynamic";

export default async function CabinetResultsPage() {
  const client = await requireCabinetClient();
  const today = moscowDayStart();
  const week = moscowWeekBounds();
  const [dailyReport, weeklyReport, recentDays, recentWeeks, feedback] = await Promise.all([
    prisma.dailyReport.findUnique({ where: { clientId_reportDate: { clientId: client.id, reportDate: today } } }),
    prisma.weeklyReport.findUnique({ where: { clientId_weekStart: { clientId: client.id, weekStart: week.start } } }),
    prisma.dailyReport.findMany({ where: { clientId: client.id }, orderBy: { reportDate: "desc" }, take: 7 }),
    prisma.weeklyReport.findMany({ where: { clientId: client.id }, orderBy: { weekStart: "desc" }, take: 6 }),
    prisma.feedback.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  return (
    <div className="portal-page-stack">
      <header className="portal-page-heading">
        <div><span className="eyebrow">Фиксируем движение</span><h1>Отчёты и результаты</h1><p>Коротко записывай факты. Так виден реальный путь, а Аня быстрее даст точную обратную связь.</p></div>
      </header>

      <div className="portal-report-grid">
        <PortalActionForm action={saveTodayReport} className="panel portal-edit-form" successMessage="Отчёт за сегодня сохранён">
          {dailyReport ? <input type="hidden" name="dailyReportUpdatedAt" value={dailyReport.updatedAt.toISOString()} /> : null}
          <div className="portal-form-heading"><div><span className="section-kicker">{formatMoscowDate(today)}</span><h2>Отчёт за день</h2></div><span className={`portal-state ${dailyReport ? "ready" : "waiting"}`}>{dailyReport ? "Заполнен" : "Ждёт"}</span></div>
          <label className="portal-field"><span>Главный результат</span><textarea name="result" rows={3} defaultValue={dailyReport?.result ?? ""} placeholder="Что получилось сегодня?" /></label>
          <label className="portal-field"><span>Что было сделано</span><textarea name="actions" rows={3} defaultValue={dailyReport?.actions ?? ""} placeholder="Конкретные действия, встречи, касания" /></label>
          <label className="portal-field"><span>Что мешало</span><textarea name="blockers" rows={2} defaultValue={dailyReport?.blockers ?? ""} placeholder="Можно оставить пустым" /></label>
          <label className="portal-field"><span>Следующий шаг</span><textarea name="nextStep" rows={2} defaultValue={dailyReport?.nextStep ?? ""} placeholder="Одно главное действие на завтра" /></label>
          <div className="portal-form-footer"><p>Отчёт можно дополнить сегодня. Старую версию из другого окна система не перезапишет.</p><PortalSubmitButton pendingText="Сохраняю отчёт…">Сохранить день</PortalSubmitButton></div>
        </PortalActionForm>

        <PortalActionForm action={saveCurrentWeekReport} className="panel portal-edit-form" successMessage="Итоги недели сохранены">
          {weeklyReport ? <input type="hidden" name="weeklyReportUpdatedAt" value={weeklyReport.updatedAt.toISOString()} /> : null}
          <div className="portal-form-heading"><div><span className="section-kicker">Неделя с {formatMoscowDate(week.start)}</span><h2>Итоги недели</h2></div><span className={`portal-state ${weeklyReport ? "ready" : "waiting"}`}>{weeklyReport ? "Заполнены" : "Ждут"}</span></div>
          <label className="portal-field"><span>Короткий итог</span><textarea name="summary" rows={3} defaultValue={weeklyReport?.summary ?? ""} placeholder="Что изменилось за эту неделю?" /></label>
          <div className="portal-number-grid">
            <label className="portal-field"><span>Выручка, ₽</span><input name="revenue" type="number" min="0" step="1" inputMode="decimal" defaultValue={weeklyReport?.revenue ?? ""} /></label>
            <label className="portal-field"><span>Лиды</span><input name="leads" type="number" min="0" step="1" inputMode="numeric" defaultValue={weeklyReport?.leads ?? ""} /></label>
            <label className="portal-field"><span>Продажи</span><input name="sales" type="number" min="0" step="1" inputMode="numeric" defaultValue={weeklyReport?.sales ?? ""} /></label>
          </div>
          <label className="portal-field"><span>Победы</span><textarea name="wins" rows={2} defaultValue={weeklyReport?.wins ?? ""} placeholder="Что особенно важно отметить?" /></label>
          <label className="portal-field"><span>Сложности</span><textarea name="blockers" rows={2} defaultValue={weeklyReport?.blockers ?? ""} placeholder="Где нужна помощь?" /></label>
          <label className="portal-field"><span>Фокус следующей недели</span><textarea name="nextFocus" rows={2} defaultValue={weeklyReport?.nextFocus ?? ""} placeholder="На чём держим внимание дальше?" /></label>
          <div className="portal-form-footer"><p>Цифры и выводы сразу попадут в карточку клиента у Ани.</p><PortalSubmitButton pendingText="Сохраняю итоги…">Сохранить неделю</PortalSubmitButton></div>
        </PortalActionForm>
      </div>

      <div className="portal-history-grid">
        <section className="panel portal-history-panel">
          <div className="section-heading"><div><span className="section-kicker">История</span><h2>Последние отчёты</h2></div></div>
          {recentDays.length || recentWeeks.length ? <div className="portal-report-history">
            {recentDays.map((report) => <article key={`day-${report.id}`}><time>{formatMoscowDate(report.reportDate)}</time><div><strong>{report.result ?? "День зафиксирован"}</strong><small>{report.nextStep ? `Дальше: ${report.nextStep}` : "Следующий шаг не указан"}</small></div><span>День</span></article>)}
            {recentWeeks.map((report) => <article key={`week-${report.id}`}><time>с {formatMoscowDate(report.weekStart)}</time><div><strong>{report.summary ?? "Неделя зафиксирована"}</strong><small>{report.revenue !== null ? `Выручка: ${new Intl.NumberFormat("ru-RU").format(report.revenue)} ₽` : "Без финансовых данных"}</small></div><span>Неделя</span></article>)}
          </div> : <div className="empty-state"><span>↗</span><strong>История начнётся с первого отчёта</strong><p>Сохранённые результаты останутся здесь.</p></div>}
        </section>

        <section className="panel portal-history-panel">
          <div className="section-heading"><div><span className="section-kicker">Ответ на результаты</span><h2>Обратная связь от Ани</h2></div></div>
          {feedback.length ? <div className="portal-feedback-history">{feedback.map((item) => <article key={item.id}><span className="person-avatar">А</span><div><time>{formatMoscowDate(item.createdAt)}</time><p>{item.body}</p></div></article>)}</div> : <div className="empty-state"><span>А</span><strong>Обратной связи пока нет</strong><p>Она появится после разбора твоих результатов.</p></div>}
        </section>
      </div>
    </div>
  );
}
