import { PortalActionForm } from "@/components/PortalActionForm";
import { PortalSubmitButton } from "@/components/PortalSubmitButton";
import { saveCurrentWeekPlan } from "@/lib/cabinet-actions";
import { requireCabinetClient } from "@/lib/cabinet-data";
import { prisma } from "@/lib/db";
import { formatMoscowDate, moscowWeekBounds } from "@/lib/moscow-time";

export const dynamic = "force-dynamic";

const taskStatusLabels: Record<string, string> = {
  todo: "Запланировано",
  in_progress: "В работе",
  done: "Готово",
};

export default async function CabinetPlanPage() {
  const client = await requireCabinetClient();
  const week = moscowWeekBounds();
  const plan = await prisma.weeklyPlan.findUnique({
    where: { clientId_weekStart: { clientId: client.id, weekStart: week.start } },
    include: { tasks: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
  });
  const taskRows = [
    ...(plan?.tasks ?? []),
    ...Array.from({ length: Math.max(3, 6 - (plan?.tasks.length ?? 0)) }, (_, index) => ({
      id: 0 - index,
      title: "",
      status: "todo",
    })),
  ];
  const doneCount = plan?.tasks.filter((task) => task.status === "done").length ?? 0;

  return (
    <div className="portal-page-stack">
      <header className="portal-page-heading">
        <div><span className="eyebrow">{formatMoscowDate(week.start)} — {formatMoscowDate(week.end)}</span><h1>План недели</h1><p>Оставь только то, что действительно двигает тебя к цели.</p></div>
        <div className="portal-progress-pill"><strong>{doneCount}/{plan?.tasks.length ?? 0}</strong><span>выполнено</span></div>
      </header>

      <PortalActionForm action={saveCurrentWeekPlan} className="panel portal-edit-form" successMessage="План сохранён">
        {plan ? <input type="hidden" name="planUpdatedAt" value={plan.updatedAt.toISOString()} /> : null}
        <input type="hidden" name="replaceTasks" value="1" />

        <label className="portal-field portal-focus-field">
          <span>Главный фокус недели</span>
          <textarea key={`focus-${plan?.updatedAt.toISOString() ?? "new"}`} name="focus" rows={3} defaultValue={plan?.focus ?? ""} placeholder="Например: провести четыре встречи и закрыть две продажи" />
        </label>

        <div className="portal-form-heading">
          <div><span className="section-kicker">Конкретные действия</span><h2>Задачи</h2></div>
          <small>Пустые строки не сохраняются</small>
        </div>

        <div className="portal-task-editor">
          {taskRows.map((task, index) => {
            const isPersisted = task.id > 0;
            return (
              <div className="portal-task-edit-row" key={`${isPersisted ? task.id : `new-${index}`}-${plan?.updatedAt.toISOString() ?? "new"}`}>
                <span className="portal-task-number">{index + 1}</span>
                <input type="hidden" name="taskId" value={isPersisted ? task.id : ""} />
                <input name="taskTitle" defaultValue={task.title} maxLength={240} placeholder="Что нужно сделать?" aria-label={`Задача ${index + 1}`} />
                <select name="taskStatus" defaultValue={task.status} aria-label={`Статус задачи ${index + 1}`}>
                  {Object.entries(taskStatusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
              </div>
            );
          })}
        </div>

        <div className="portal-form-footer"><p>Можно вернуться и изменить план. Одновременные правки из другого окна не затрутся.</p><PortalSubmitButton pendingText="Сохраняю план…">Сохранить план</PortalSubmitButton></div>
      </PortalActionForm>
    </div>
  );
}
