import { randomUUID } from "node:crypto";
import { createMaterial, setMaterialPublished } from "@/lib/material-actions";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const kindLabels: Record<string, string> = {
  lesson: "Урок",
  live_recording: "Запись эфира",
  guide: "Гайд",
  checklist: "Чек-лист",
  link: "Ссылка",
};

export default async function MaterialsPage() {
  const submissionKey = randomUUID();
  const [materials, programs] = await Promise.all([
    prisma.material.findMany({
      include: { program: { select: { id: true, title: true } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    }),
    prisma.program.findMany({
      where: { status: { not: "archived" } },
      orderBy: { title: "asc" },
    }),
  ]);

  const publishedCount = materials.filter((material) => material.isPublished).length;

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Контент для клиентов</p>
          <h1>Материалы</h1>
          <p>
            Уроки, записи эфиров, гайды и полезные ссылки. Опубликованные материалы
            будут доступны клиентам в личном кабинете.
          </p>
        </div>
      </header>

      <div className="two-column">
        <section className="panel list-panel">
          <div className="section-heading">
            <div>
              <span className="section-kicker">Библиотека</span>
              <h2>Все материалы</h2>
            </div>
            <span className="count-badge">{materials.length}</span>
          </div>

          {materials.length ? (
            <div className="flow-list">
              {materials.map((material) => (
                <article key={material.id}>
                  <span className="flow-mark">
                    {material.kind === "live_recording" ? "▶" : material.kind === "link" ? "↗" : "◇"}
                  </span>
                  <div>
                    <strong>{material.title}</strong>
                    <small>
                      {kindLabels[material.kind] ?? material.kind}
                      {material.program ? ` · ${material.program.title}` : " · Без программы"}
                    </small>
                    {material.description ? <small>{material.description}</small> : null}
                    {material.url ? (
                      <small>
                        <a href={material.url} target="_blank" rel="noreferrer">
                          Открыть материал ↗
                        </a>
                      </small>
                    ) : null}
                  </div>
                  <form action={setMaterialPublished}>
                    <input type="hidden" name="id" value={material.id} />
                    <input
                      type="hidden"
                      name="isPublished"
                      value={material.isPublished ? "false" : "true"}
                    />
                    <button
                      type="submit"
                      className={`status-badge ${material.isPublished ? "status-active" : "status-draft"}`}
                      title={material.isPublished ? "Скрыть от клиентов" : "Опубликовать для клиентов"}
                    >
                      {material.isPublished ? "Опубликован" : "Черновик"}
                    </button>
                  </form>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state empty-state-tall">
              <span>◇</span>
              <strong>Материалов пока нет</strong>
              <p>Добавь первый урок, запись или полезную ссылку справа.</p>
            </div>
          )}
        </section>

        <section className="panel form-panel sticky-panel">
          <div className="section-heading">
            <div>
              <span className="section-kicker">Новый материал</span>
              <h2>Добавить в библиотеку</h2>
            </div>
            <span className="status-badge status-active">{publishedCount} открыто</span>
          </div>

          <form action={createMaterial} className="data-form compact-form">
            <input type="hidden" name="submissionKey" value={submissionKey} />
            <label className="field-wide">
              <span>Название</span>
              <input name="title" required placeholder="Например, Как подвести итоги недели" />
            </label>

            <label>
              <span>Вид материала</span>
              <select name="kind" defaultValue="lesson">
                <option value="lesson">Урок</option>
                <option value="live_recording">Запись эфира</option>
                <option value="guide">Гайд</option>
                <option value="checklist">Чек-лист</option>
                <option value="link">Ссылка</option>
              </select>
            </label>

            <label>
              <span>Программа</span>
              <select name="programId" defaultValue="">
                <option value="">Без программы</option>
                {programs.map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.title}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-wide">
              <span>Ссылка</span>
              <input name="url" type="url" placeholder="https://…" />
            </label>

            <label className="field-wide">
              <span>Описание</span>
              <textarea
                name="description"
                rows={4}
                placeholder="Коротко объясни, что внутри и зачем это клиенту"
              />
            </label>

            <label className="field-wide">
              <span>Доступ клиентам</span>
              <select name="isPublished" defaultValue="false">
                <option value="false">Сохранить как черновик</option>
                <option value="true">Сразу опубликовать</option>
              </select>
            </label>

            <button className="button-primary field-wide">Сохранить материал</button>
          </form>
        </section>
      </div>
    </div>
  );
}
