import { PortalActionForm } from "@/components/PortalActionForm";
import { PortalSubmitButton } from "@/components/PortalSubmitButton";
import { setOwnMaterialProgress } from "@/lib/cabinet-actions";
import { requireCabinetClient, visibleMaterialsWhere } from "@/lib/cabinet-data";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const materialKind: Record<string, { mark: string; label: string }> = {
  lesson: { mark: "◇", label: "Урок" },
  live_recording: { mark: "▶", label: "Запись эфира" },
  guide: { mark: "≡", label: "Инструкция" },
  template: { mark: "□", label: "Шаблон" },
};

function usableUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.hostname.endsWith(".invalid") ? null : value;
  } catch {
    return null;
  }
}

export default async function CabinetMaterialsPage() {
  const client = await requireCabinetClient();
  const materials = await prisma.material.findMany({
    where: visibleMaterialsWhere(client.id),
    include: {
      program: { select: { title: true } },
      progress: { where: { clientId: client.id }, take: 1 },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  const completed = materials.filter((material) => material.progress[0]?.status === "completed").length;
  const inProgress = materials.filter((material) => material.progress[0]?.status === "in_progress").length;
  const percent = materials.length ? Math.round((completed / materials.length) * 100) : 0;

  return (
    <div className="portal-page-stack">
      <header className="portal-page-heading">
        <div><span className="eyebrow">База знаний</span><h1>Материалы</h1><p>Уроки, записи эфиров и шаблоны, которые открыты именно тебе.</p></div>
        <div className="portal-progress-pill"><strong>{percent}%</strong><span>{completed} из {materials.length} завершено</span></div>
      </header>

      {materials.length ? (
        <>
          <section className="panel portal-material-summary">
            <div><span>Всего</span><strong>{materials.length}</strong></div><div><span>В работе</span><strong>{inProgress}</strong></div><div><span>Готово</span><strong>{completed}</strong></div>
            <div className="portal-material-progress"><i style={{ width: `${percent}%` }} /></div>
          </section>

          <div className="portal-material-cards">
            {materials.map((material, index) => {
              const progress = material.progress[0]?.status ?? "not_started";
              const meta = materialKind[material.kind] ?? { mark: "◇", label: "Материал" };
              const url = usableUrl(material.url);
              return (
                <article className={`panel portal-material-card status-${progress}`} key={material.id}>
                  <div className="portal-material-card-top">
                    <span className="portal-material-mark">{meta.mark}</span>
                    <div><small>{material.program?.title ?? "Общая база"} · {meta.label}</small><h2>{material.title}</h2></div>
                    <span className="portal-material-order">{String(index + 1).padStart(2, "0")}</span>
                  </div>
                  <p>{material.description ?? "Материал без описания"}</p>
                  <div className="portal-material-card-footer">
                    <span className={`portal-state ${progress === "completed" ? "ready" : progress === "in_progress" ? "working" : "waiting"}`}>
                      {progress === "completed" ? "Завершён" : progress === "in_progress" ? "В работе" : "Не начат"}
                    </span>
                    <div className="portal-material-actions">
                      {url ? <a className="button-secondary" href={url} target="_blank" rel="noreferrer">Открыть ↗</a> : <span className="portal-link-waiting">Ссылка появится позже</span>}
                      {progress !== "completed" ? (
                        <PortalActionForm action={setOwnMaterialProgress} className="portal-inline-form" successMessage={progress === "in_progress" ? "Материал завершён" : "Материал добавлен в работу"}>
                          <input type="hidden" name="materialId" value={material.id} />
                          <input type="hidden" name="status" value={progress === "in_progress" ? "completed" : "started"} />
                          <PortalSubmitButton className="button-primary" pendingText="Сохраняю…">{progress === "in_progress" ? "Завершить" : "Начать"}</PortalSubmitButton>
                        </PortalActionForm>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      ) : <section className="panel"><div className="empty-state empty-state-tall"><span>◇</span><strong>Материалов пока нет</strong><p>Когда Аня откроет урок или запись, они появятся здесь.</p></div></section>}
    </div>
  );
}
