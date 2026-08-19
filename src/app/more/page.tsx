import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function MorePage() {
  const [materials, payments, templates] = await Promise.all([
    prisma.material.count(),
    prisma.payment.count({ where: { status: { not: "paid" } } }),
    prisma.notificationTemplate.count({ where: { isActive: true } }),
  ]);
  return (
    <div className="page-stack">
      <header className="page-heading"><div><p className="eyebrow">Остальные инструменты</p><h1>Ещё</h1><p>Материалы, оплаты, напоминания и настройки системы.</p></div></header>
      <section className="tool-grid">
        <Link href="/materials" className="panel tool-card tool-card-link"><span className="tool-icon">▷</span><div><h2>Материалы</h2><p>Уроки, записи эфиров и выдача по программам.</p></div><b>{materials}</b><small>материалов</small><span className="development-label ready-label">открыть →</span></Link>
        <article className="panel tool-card"><span className="tool-icon">₽</span><div><h2>Оплаты</h2><p>График платежей и напоминания клиентам.</p></div><b>{payments}</b><small>ожидают</small><span className="development-label">следующий этап</span></article>
        <Link href="/reminders" className="panel tool-card tool-card-link"><span className="tool-icon">↗</span><div><h2>Напоминания</h2><p>Утренние планы, вечерние отчёты, эфиры и оплаты.</p></div><b>{templates}</b><small>шаблонов</small><span className="development-label ready-label">открыть →</span></Link>
        <Link href="/settings" className="panel tool-card tool-card-link"><span className="tool-icon">⚙</span><div><h2>Настройки</h2><p>Доступ, резервные копии и состояние локальной базы.</p></div><b>1</b><small>владелец</small><span className="development-label ready-label">открыть →</span></Link>
      </section>
      <p className="stage-note">Материалы, шаблоны напоминаний и системные проверки уже работают. Оплаты подключим следующим самостоятельным блоком.</p>
      <Link href="/" className="back-link">← Вернуться на главную</Link>
    </div>
  );
}
