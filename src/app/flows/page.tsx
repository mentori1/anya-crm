import { randomUUID } from "node:crypto";
import { createFlow } from "@/lib/actions";
import { prisma } from "@/lib/db";
import { flowStatusLabels, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function FlowsPage() {
  const submissionKey = randomUUID();
  const flows = await prisma.flow.findMany({
    include: { _count: { select: { enrollments: true, events: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="page-stack">
      <header className="page-heading"><div><p className="eyebrow">Групповая работа</p><h1>Потоки</h1><p>Участники, даты, программа и общие эфиры каждого запуска.</p></div></header>
      <div className="two-column">
        <section className="panel list-panel">
          <div className="section-heading"><div><span className="section-kicker">Все запуски</span><h2>Список потоков</h2></div><span className="count-badge">{flows.length}</span></div>
          {flows.length ? <div className="flow-list">{flows.map((flow) => <article key={flow.id}><span className="flow-mark">◇</span><div><strong>{flow.title}</strong><small>{formatDate(flow.startDate)} — {formatDate(flow.endDate)}</small></div><span className={`status-badge status-${flow.status}`}>{flowStatusLabels[flow.status] ?? flow.status}</span><div className="flow-counts"><b>{flow._count.enrollments}</b><small>участников</small></div></article>)}</div> : <div className="empty-state empty-state-tall"><span>◇</span><strong>Потоков пока нет</strong><p>Создай первый запуск справа.</p></div>}
        </section>
        <section className="panel form-panel sticky-panel">
          <div className="section-heading"><div><span className="section-kicker">Новый запуск</span><h2>Создать поток</h2></div></div>
          <form action={createFlow} className="data-form compact-form">
            <input type="hidden" name="submissionKey" value={submissionKey} />
            <label className="field-wide"><span>Название</span><input name="title" required placeholder="Например, Рост · сентябрь" /></label>
            <label><span>Начало</span><input name="startDate" type="date" /></label><label><span>Окончание</span><input name="endDate" type="date" /></label>
            <label className="field-wide"><span>Статус</span><select name="status" defaultValue="draft"><option value="draft">Черновик</option><option value="enrolling">Набор</option><option value="active">Идёт</option><option value="completed">Завершён</option></select></label>
            <button className="button-primary field-wide">Создать поток</button>
          </form>
        </section>
      </div>
    </div>
  );
}
