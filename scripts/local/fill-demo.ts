import { prisma } from "../../src/lib/db";
import { normalizedClientIdentity } from "../../src/lib/client-identity";

const DEMO_SOURCE = "Демо CRM Ани";
const DEMO_PROGRAM_TITLE = "Система роста дохода";
const DEMO_FLOW_TITLE = "Рост в действии · демонстрационный поток";
const DEMO_LINK_ROOT = "https://example.invalid/anya-crm-demo";

const DAY_MS = 24 * 60 * 60 * 1_000;

function startOfDay(value: Date) {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

function startOfWeek(value: Date) {
  const result = startOfDay(value);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return result;
}

function addDays(value: Date, amount: number) {
  return new Date(value.getTime() + amount * DAY_MS);
}

function atDayOffset(now: Date, dayOffset: number, hours: number, minutes = 0) {
  const result = addDays(startOfDay(now), dayOffset);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

const clientFixtures = [
  {
    key: "marina",
    fullName: "Марина Орлова",
    email: "marina.orlova@demo.invalid",
    status: "active",
    activityDaysAgo: 0,
    nextContactDays: 1,
    goal: {
      title: "Выйти на стабильные 240 000 ₽ в месяц",
      startValue: 120,
      currentValue: 185,
      targetValue: 240,
      unit: "тыс. ₽/мес",
      movement: "on_track",
    },
    planFocus: "Упаковать основной продукт и провести продажи без перегруза",
    tasks: [
      ["Собрать результаты пяти последних клиентов", "done"],
      ["Обновить презентацию основной услуги", "in_progress"],
      ["Провести 4 диагностических встречи", "todo"],
    ],
    report: {
      summary: "Пересобрала предложение и провела три сильных диагностики.",
      revenue: 185_000,
      leads: 14,
      sales: 3,
      wins: "Продала сопровождение без скидки и получила две рекомендации.",
      blockers: "Много времени уходит на подготовку каждого предложения вручную.",
      nextFocus: "Стандартизировать презентацию и увеличить число встреч.",
    },
    dailyResult: "Провела две встречи и получила одну оплату.",
    feedback: "Ты хорошо держишь темп. На этой неделе не добавляй новые задачи: доведи до конца упаковку и четыре встречи.",
    note: "Важно поддержать фокус: Марина склонна улучшать продукт вместо регулярных продаж.",
  },
  {
    key: "elena",
    fullName: "Елена Ветрова",
    email: "elena.vetrova@demo.invalid",
    status: "active",
    activityDaysAgo: 0,
    nextContactDays: 2,
    goal: {
      title: "Увеличить доход до 200 000 ₽",
      startValue: 90,
      currentValue: 174,
      targetValue: 200,
      unit: "тыс. ₽/мес",
      movement: "ahead",
    },
    planFocus: "Закрепить результат и подготовить более ёмкий формат работы",
    tasks: [
      ["Подвести цифры за прошлый запуск", "done"],
      ["Собрать предложение для мини-группы", "done"],
      ["Открыть лист ожидания на следующий поток", "todo"],
    ],
    report: {
      summary: "Закрыла план месяца раньше срока и начала собирать лист ожидания.",
      revenue: 174_000,
      leads: 19,
      sales: 5,
      wins: "Два клиента выбрали расширенный пакет.",
      blockers: "Нужно освободить время от части операционных задач.",
      nextFocus: "Делегировать администрирование и открыть предзапись.",
    },
    dailyResult: "Передала помощнику расписание и согласовала структуру мини-группы.",
    feedback: "Ты идёшь быстрее плана. Следующий рост сейчас не в количестве задач, а в более ёмком формате и делегировании.",
    note: "Кандидат на расширенный пакет: вернуться к предложению после итогов потока.",
  },
  {
    key: "daria",
    fullName: "Дарья Соколова",
    email: "daria.sokolova@demo.invalid",
    status: "active",
    activityDaysAgo: 3,
    nextContactDays: 0,
    goal: {
      title: "Достичь выручки 300 000 ₽ в месяц",
      startValue: 150,
      currentValue: 172,
      targetValue: 300,
      unit: "тыс. ₽/мес",
      movement: "behind",
    },
    planFocus: "Вернуть регулярность контактов и быстро проверить новый оффер",
    tasks: [
      ["Сформулировать один главный оффер", "done"],
      ["Написать 15 тёплым контактам", "in_progress"],
      ["Назначить минимум 5 диагностик", "todo"],
    ],
    report: null,
    dailyResult: "Вернулась к тёплой базе, получила четыре ответа.",
    feedback: "Не усложняй предложение. Сначала проведи пять разговоров и только после этого меняй формулировку.",
    note: "Требуется короткий контроль в середине недели: есть риск снова уйти в обучение вместо продаж.",
  },
  {
    key: "ksenia",
    fullName: "Ксения Белова",
    email: "ksenia.belova@demo.invalid",
    status: "active",
    activityDaysAgo: 1,
    nextContactDays: 3,
    goal: {
      title: "Набрать 15 постоянных клиентов",
      startValue: 6,
      currentValue: 10,
      targetValue: 15,
      unit: "клиентов",
      movement: "on_track",
    },
    planFocus: "Усилить рекомендации и повторные продажи",
    tasks: [
      ["Запросить обратную связь у 6 клиентов", "done"],
      ["Подготовить предложение на продление", "in_progress"],
      ["Сделать 3 партнёрских касания", "todo"],
    ],
    report: {
      summary: "Получила три сильных отзыва и два запроса на продление.",
      revenue: 128_000,
      leads: 11,
      sales: 4,
      wins: "Половина новых обращений пришла по рекомендациям.",
      blockers: "Нет единого сценария для предложения продления.",
      nextFocus: "Собрать простой сценарий допродажи и применить его на пяти клиентах.",
    },
    dailyResult: "Получила новый отзыв и договорилась о двух партнёрских публикациях.",
    feedback: "Сильная неделя. Зафиксируй рабочий сценарий продления, чтобы результат не зависел от импровизации.",
    note: "Хорошо реагирует на короткие измеримые задачи и видимый прогресс.",
  },
  {
    key: "olga",
    fullName: "Ольга Миронова",
    email: "olga.mironova@demo.invalid",
    status: "paused",
    activityDaysAgo: 8,
    nextContactDays: 4,
    goal: {
      title: "Перейти из найма на собственную практику",
      startValue: 60,
      currentValue: 78,
      targetValue: 150,
      unit: "тыс. ₽/мес",
      movement: "behind",
    },
    planFocus: "Сохранить контакт с аудиторией во время паузы",
    tasks: [
      ["Зафиксировать причину паузы и доступный темп", "done"],
      ["Подготовить один полезный пост", "todo"],
      ["Назначить дату возвращения к активному плану", "todo"],
    ],
    report: null,
    dailyResult: null,
    feedback: "Сейчас важно не форсировать темп. Оставь одно лёгкое действие в неделю и возвращайся к плану после паузы.",
    note: "Пауза по личным обстоятельствам. Связаться мягко, без давления, в назначенную дату.",
  },
  {
    key: "victoria",
    fullName: "Виктория Лебедева",
    email: "victoria.lebedeva@demo.invalid",
    status: "new",
    activityDaysAgo: 0,
    nextContactDays: 1,
    goal: {
      title: "Получить первые 3 продажи новой услуги",
      startValue: 0,
      currentValue: 0,
      targetValue: 3,
      unit: "продажи",
      movement: "on_track",
    },
    planFocus: "Проверить спрос до большой упаковки продукта",
    tasks: [
      ["Описать результат услуги одним предложением", "done"],
      ["Собрать список из 20 тёплых контактов", "in_progress"],
      ["Провести первые 3 интервью", "todo"],
    ],
    report: null,
    dailyResult: "Зафиксировала аудиторию и собрала первые восемь контактов.",
    feedback: "На старте нам важнее реальные разговоры, чем идеальная упаковка. Проведи три интервью и принеси формулировки клиентов.",
    note: "Новый клиент: на следующем созвоне уточнить точку А по доходу и доступное время на проект.",
  },
  {
    key: "alina",
    fullName: "Алина Романова",
    email: "alina.romanova@demo.invalid",
    status: "upsell",
    activityDaysAgo: 2,
    nextContactDays: 5,
    goal: {
      title: "Удвоить выручку направления",
      startValue: 180,
      currentValue: 390,
      targetValue: 350,
      unit: "тыс. ₽/мес",
      movement: "ahead",
    },
    planFocus: "Подвести итог сопровождения и выбрать следующий уровень",
    tasks: [
      ["Собрать цифры до и после сопровождения", "done"],
      ["Описать изменения в процессах", "done"],
      ["Выбрать формат следующего квартала", "todo"],
    ],
    report: null,
    dailyResult: null,
    feedback: "Цель этапа достигнута. Теперь важно выбрать, что масштабируем дальше: команду, продуктовую линейку или стабильный поток лидов.",
    note: "Предложить стратегический квартал после финальной встречи; есть выраженный запрос на рост команды.",
  },
] as const;

const materialFixtures = [
  {
    title: "Как поставить измеримую цель на месяц",
    description: "Короткая схема: точка А, точка Б, срок и еженедельные контрольные показатели.",
    kind: "lesson",
    sortOrder: 10,
    url: `${DEMO_LINK_ROOT}/goal`,
  },
  {
    title: "Шаблон плана недели",
    description: "Помогает выбрать один фокус и превратить его в конкретные действия.",
    kind: "guide",
    sortOrder: 20,
    url: `${DEMO_LINK_ROOT}/weekly-plan`,
  },
  {
    title: "Запись эфира: продажи без перегруза",
    description: "Демонстрационная запись с разбором простого ритма продаж.",
    kind: "live_recording",
    sortOrder: 30,
    url: `${DEMO_LINK_ROOT}/sales-live`,
  },
  {
    title: "Чек-лист итогов недели",
    description: "Что проверить в цифрах, результатах и действиях перед новым планом.",
    kind: "checklist",
    sortOrder: 40,
    url: `${DEMO_LINK_ROOT}/weekly-summary`,
  },
] as const;

async function main() {
  const now = new Date();
  const today = startOfDay(now);
  const weekStart = startOfWeek(now);
  const weekEnd = addDays(weekStart, 6);
  weekEnd.setHours(23, 59, 59, 999);
  const previousWeekStart = addDays(weekStart, -7);

  const result = await prisma.$transaction(
    async (tx) => {
      const existingProgram = await tx.program.findFirst({
        where: {
          title: DEMO_PROGRAM_TITLE,
          description: { contains: DEMO_SOURCE },
        },
      });
      const programData = {
        title: DEMO_PROGRAM_TITLE,
        description: `${DEMO_SOURCE}. Демонстрационная программа с целями, планами, отчётами и материалами.`,
        status: "active",
      };
      const program = existingProgram
        ? await tx.program.update({ where: { id: existingProgram.id }, data: programData })
        : await tx.program.create({ data: programData });

      const existingFlow = await tx.flow.findFirst({
        where: { programId: program.id, title: DEMO_FLOW_TITLE },
      });
      const flowData = {
        title: DEMO_FLOW_TITLE,
        status: "active",
        startDate: addDays(today, -8),
        endDate: addDays(today, 28),
        programId: program.id,
      };
      const flow = existingFlow
        ? await tx.flow.update({ where: { id: existingFlow.id }, data: flowData })
        : await tx.flow.create({ data: flowData });

      const materials = [];
      for (const fixture of materialFixtures) {
        const existing = await tx.material.findFirst({
          where: { programId: program.id, title: fixture.title },
        });
        const data = { ...fixture, programId: program.id, isPublished: true };
        materials.push(
          existing
            ? await tx.material.update({ where: { id: existing.id }, data })
            : await tx.material.create({ data }),
        );
      }

      const clients = new Map<string, { id: number; fullName: string }>();

      for (const fixture of clientFixtures) {
        const identity = normalizedClientIdentity({ email: fixture.email });
        const normalizedEmail = identity.emailNormalized;
        if (!normalizedEmail) throw new Error(`Не удалось нормализовать email ${fixture.email}`);
        const conflictingClient = await tx.client.findUnique({
          where: { emailNormalized: normalizedEmail },
        });
        if (conflictingClient && conflictingClient.source !== DEMO_SOURCE) {
          throw new Error(
            `Нормализованный email ${normalizedEmail} уже принадлежит не демонстрационному клиенту`,
          );
        }
        const clientData = {
          fullName: fixture.fullName,
          email: fixture.email,
          phone: null,
          telegram: null,
          telegramUserId: null,
          telegramChatId: null,
          ...identity,
          source: DEMO_SOURCE,
          status: fixture.status,
          lastActivityAt: addDays(now, -fixture.activityDaysAgo),
          nextContactAt: addDays(today, fixture.nextContactDays),
        };
        const client = await tx.client.upsert({
          where: { emailNormalized: normalizedEmail },
          update: clientData,
          create: { ...clientData, version: 1 },
        });
        clients.set(fixture.key, { id: client.id, fullName: client.fullName });

        const existingGoal = await tx.goal.findFirst({
          where: { clientId: client.id, title: fixture.goal.title },
        });
        const goalData = {
          clientId: client.id,
          ...fixture.goal,
          status: "active",
          deadline: addDays(today, 35),
        };
        if (existingGoal) {
          await tx.goal.update({ where: { id: existingGoal.id }, data: goalData });
        } else {
          await tx.goal.create({ data: goalData });
        }

        const plan = await tx.weeklyPlan.upsert({
          where: { clientId_weekStart: { clientId: client.id, weekStart } },
          update: { weekEnd, focus: fixture.planFocus, status: "active" },
          create: {
            clientId: client.id,
            weekStart,
            weekEnd,
            focus: fixture.planFocus,
            status: "active",
          },
        });

        for (const [sortOrder, [title, status]] of fixture.tasks.entries()) {
          const existingTask = await tx.planTask.findFirst({
            where: { planId: plan.id, sortOrder },
          });
          const taskData = {
            planId: plan.id,
            title,
            status,
            sortOrder,
            dueAt: atDayOffset(now, Math.min(sortOrder + 1, 5), 18),
          };
          if (existingTask) {
            await tx.planTask.update({ where: { id: existingTask.id }, data: taskData });
          } else {
            await tx.planTask.create({ data: taskData });
          }
        }

        if (fixture.report) {
          await tx.weeklyReport.upsert({
            where: { clientId_weekStart: { clientId: client.id, weekStart } },
            update: fixture.report,
            create: { clientId: client.id, weekStart, ...fixture.report },
          });
        } else {
          await tx.weeklyReport.upsert({
            where: { clientId_weekStart: { clientId: client.id, weekStart: previousWeekStart } },
            update: {
              summary: "Предыдущая неделя зафиксирована. Текущий итог ещё ожидается.",
              revenue: null,
              leads: null,
              sales: null,
              wins: "Определён следующий рабочий фокус.",
              blockers: "Текущий недельный отчёт ещё не заполнен.",
              nextFocus: fixture.planFocus,
            },
            create: {
              clientId: client.id,
              weekStart: previousWeekStart,
              summary: "Предыдущая неделя зафиксирована. Текущий итог ещё ожидается.",
              wins: "Определён следующий рабочий фокус.",
              blockers: "Текущий недельный отчёт ещё не заполнен.",
              nextFocus: fixture.planFocus,
            },
          });
        }

        if (fixture.dailyResult) {
          await tx.dailyReport.upsert({
            where: { clientId_reportDate: { clientId: client.id, reportDate: today } },
            update: {
              result: fixture.dailyResult,
              actions: "Выполнено главное действие из плана недели.",
              blockers: fixture.goal.movement === "behind" ? "Не хватает регулярности касаний." : null,
              nextStep: fixture.tasks.find((task) => task[1] !== "done")?.[0] ?? "Зафиксировать следующий шаг.",
            },
            create: {
              clientId: client.id,
              reportDate: today,
              result: fixture.dailyResult,
              actions: "Выполнено главное действие из плана недели.",
              blockers: fixture.goal.movement === "behind" ? "Не хватает регулярности касаний." : null,
              nextStep: fixture.tasks.find((task) => task[1] !== "done")?.[0] ?? "Зафиксировать следующий шаг.",
            },
          });
        }

        const existingFeedback = await tx.feedback.findFirst({
          where: { clientId: client.id, body: fixture.feedback },
        });
        if (!existingFeedback) {
          await tx.feedback.create({ data: { clientId: client.id, body: fixture.feedback } });
        }

        const existingNote = await tx.privateNote.findFirst({
          where: { clientId: client.id, body: fixture.note },
        });
        if (!existingNote) {
          await tx.privateNote.create({ data: { clientId: client.id, body: fixture.note } });
        }

        const paymentTitle = fixture.status === "upsell" ? "Стратегический квартал" : "Сопровождение · текущий месяц";
        const existingPayment = await tx.payment.findFirst({
          where: { clientId: client.id, title: paymentTitle },
        });
        const paymentData = {
          clientId: client.id,
          title: paymentTitle,
          amountRub: fixture.status === "upsell" ? 65_000 : 35_000,
          dueDate: addDays(today, fixture.status === "paused" ? -3 : fixture.nextContactDays + 3),
          paidAt: fixture.key === "marina" || fixture.key === "elena" ? addDays(today, -2) : null,
          status: fixture.key === "marina" || fixture.key === "elena"
            ? "paid"
            : fixture.status === "paused"
              ? "overdue"
              : "planned",
        };
        if (existingPayment) {
          await tx.payment.update({ where: { id: existingPayment.id }, data: paymentData });
        } else {
          await tx.payment.create({ data: paymentData });
        }

        const existingEnrollment = await tx.enrollment.findFirst({
          where: { clientId: client.id, flowId: flow.id },
        });
        const enrollmentData = {
          clientId: client.id,
          flowId: flow.id,
          programId: program.id,
          status: fixture.status === "paused" ? "paused" : fixture.status === "upsell" ? "completed" : "active",
          startedAt: addDays(today, -8),
          endedAt: fixture.status === "upsell" ? addDays(today, -1) : null,
        };
        if (existingEnrollment) {
          await tx.enrollment.update({ where: { id: existingEnrollment.id }, data: enrollmentData });
        } else {
          await tx.enrollment.create({ data: enrollmentData });
        }

        for (const [materialIndex, material] of materials.entries()) {
          const completed = (fixture.key.charCodeAt(0) + materialIndex) % 3 === 0;
          await tx.materialProgress.upsert({
            where: { clientId_materialId: { clientId: client.id, materialId: material.id } },
            update: {
              status: completed ? "completed" : materialIndex === 0 ? "in_progress" : "not_started",
              completedAt: completed ? addDays(now, -materialIndex - 1) : null,
            },
            create: {
              clientId: client.id,
              materialId: material.id,
              status: completed ? "completed" : materialIndex === 0 ? "in_progress" : "not_started",
              completedAt: completed ? addDays(now, -materialIndex - 1) : null,
            },
          });
        }

        const auditEntityId = `client:${fixture.key}`;
        const auditPayload = JSON.stringify({
          source: DEMO_SOURCE,
          clientId: client.id,
          status: fixture.status,
        });
        const existingAudit = await tx.auditLog.findFirst({
          where: { entityType: "demo_seed", entityId: auditEntityId, action: "upserted" },
        });
        if (existingAudit) {
          await tx.auditLog.update({ where: { id: existingAudit.id }, data: { payload: auditPayload } });
        } else {
          await tx.auditLog.create({
            data: { entityType: "demo_seed", entityId: auditEntityId, action: "upserted", payload: auditPayload },
          });
        }
      }

      const attentionFixtures = [
        ["daria", "Нет итогов текущей недели", "missing_weekly_report", "high", 0],
        ["olga", "Просрочена оплата сопровождения", "payment_overdue", "high", 1],
        ["victoria", "Подтвердить точку А после первой недели", "clarify_goal", "normal", 1],
        ["marina", "Проверить новую презентацию услуги", "review_material", "normal", 2],
        ["alina", "Подготовить предложение следующего этапа", "upsell_followup", "high", 4],
        ["ksenia", "Запросить цифры по продлениям", "metrics_followup", "normal", 3],
      ] as const;

      for (const [clientKey, title, kind, priority, dueDays] of attentionFixtures) {
        const client = clients.get(clientKey);
        if (!client) throw new Error(`Не найден демо-клиент ${clientKey}`);
        const existing = await tx.attentionItem.findFirst({
          where: { clientId: client.id, kind },
        });
        const data = {
          clientId: client.id,
          title,
          kind,
          priority,
          dueAt: atDayOffset(now, dueDays, dueDays === 0 ? 16 : 11),
          resolvedAt: null,
        };
        if (existing) {
          await tx.attentionItem.update({ where: { id: existing.id }, data });
        } else {
          await tx.attentionItem.create({ data });
        }
      }

      const eventFixtures = [
        {
          key: "marina-strategy",
          title: "Разбор стратегии с Мариной",
          kind: "call",
          startsAt: atDayOffset(now, 1, 12),
          durationMinutes: 60,
          clientKey: "marina",
          flowEvent: false,
        },
        {
          key: "daria-plan",
          title: "Короткий контроль плана с Дарьей",
          kind: "call",
          startsAt: atDayOffset(now, 2, 15, 30),
          durationMinutes: 30,
          clientKey: "daria",
          flowEvent: false,
        },
        {
          key: "sales-live",
          title: "Эфир: продажи без перегруза",
          kind: "live",
          startsAt: atDayOffset(now, 3, 19),
          durationMinutes: 90,
          clientKey: null,
          flowEvent: true,
        },
        {
          key: "product-workshop",
          title: "Практикум: продуктовая линейка",
          kind: "live",
          startsAt: atDayOffset(now, 6, 18, 30),
          durationMinutes: 75,
          clientKey: null,
          flowEvent: true,
        },
      ] as const;

      for (const fixture of eventFixtures) {
        const directClient = fixture.clientKey ? clients.get(fixture.clientKey) : null;
        const existing = await tx.event.findFirst({
          where: {
            title: fixture.title,
            clientId: directClient?.id ?? null,
            flowId: fixture.flowEvent ? flow.id : null,
          },
        });
        const eventData = {
          title: fixture.title,
          kind: fixture.kind,
          startsAt: fixture.startsAt,
          durationMinutes: fixture.durationMinutes,
          link: `${DEMO_LINK_ROOT}/meeting/${fixture.key}`,
          status: "planned",
          clientId: directClient?.id ?? null,
          flowId: fixture.flowEvent ? flow.id : null,
        };
        const event = existing
          ? await tx.event.update({ where: { id: existing.id }, data: eventData })
          : await tx.event.create({ data: eventData });

        const attendeeEntries = directClient && fixture.clientKey
          ? [[fixture.clientKey, directClient] as const]
          : [...clients.entries()]
              .filter(([key]) => !["olga", "alina"].includes(key));

        for (const [clientKey, attendee] of attendeeEntries) {
          const clientId = attendee.id;
          await tx.attendance.upsert({
            where: { eventId_clientId: { eventId: event.id, clientId } },
            update: { status: "invited", joinedAt: null },
            create: { eventId: event.id, clientId, status: "invited" },
          });

          const notificationKind = `demo_event_invite_${fixture.key}`;
          const deliveryKey = `demo:anya:event:${fixture.key}:client:${clientKey}`;
          const notificationData = {
            eventId: event.id,
            clientId,
            kind: notificationKind,
            body: `Напоминаю: ${fixture.title}. Ссылка на подключение уже в личном кабинете.`,
            channel: "telegram",
            scheduledAt: addDays(fixture.startsAt, -1),
            sentAt: null,
            status: "queued",
            deliveryKey,
            attempts: 0,
            lastError: null,
            claimedAt: null,
            externalMessageId: null,
          };
          await tx.notification.upsert({
            where: { deliveryKey },
            update: notificationData,
            create: notificationData,
          });
        }
      }

      const reminderTemplates = [
        ["demo_anya_morning_plan", "Утренний план · демо", "Доброе утро! Пришли, пожалуйста, три главных действия на сегодня."],
        ["demo_anya_evening_report", "Вечерний отчёт · демо", "Как прошёл день? Зафиксируй результат, действия, препятствия и следующий шаг."],
        ["demo_anya_weekly_summary", "Итоги недели · демо", "Подведём итоги: цифры, главная победа, вывод и фокус новой недели."],
      ] as const;

      for (const [key, title, body] of reminderTemplates) {
        await tx.notificationTemplate.upsert({
          where: { key },
          update: { title, body, channel: "telegram", isActive: true },
          create: { key, title, body, channel: "telegram", isActive: true },
        });
      }

      for (const clientKey of ["marina", "elena", "daria", "ksenia"] as const) {
        const client = clients.get(clientKey);
        if (!client) continue;
        const scheduledReminders = [
          {
            kind: "demo_morning_plan",
            body: "Доброе утро! Пришли, пожалуйста, три главных действия на сегодня.",
            scheduledAt: atDayOffset(now, 1, 9),
          },
          {
            kind: "demo_evening_report",
            body: "Вечером зафиксируй результат, действия, препятствия и следующий шаг.",
            scheduledAt: atDayOffset(now, 1, 20),
          },
        ];
        for (const reminder of scheduledReminders) {
          const deliveryKey = `demo:anya:reminder:${reminder.kind}:client:${clientKey}`;
          const data = {
            clientId: client.id,
            eventId: null,
            ...reminder,
            channel: "telegram",
            sentAt: null,
            status: "queued",
            deliveryKey,
            attempts: 0,
            lastError: null,
            claimedAt: null,
            externalMessageId: null,
          };
          await tx.notification.upsert({
            where: { deliveryKey },
            update: data,
            create: data,
          });
        }
      }

      const batchAuditPayload = JSON.stringify({
        source: DEMO_SOURCE,
        clientCount: clients.size,
        programId: program.id,
        flowId: flow.id,
        note: "Демонстрационные данные обновлены без отправки внешних уведомлений.",
      });
      const existingBatchAudit = await tx.auditLog.findFirst({
        where: { entityType: "demo_seed", entityId: "anya-dashboard-v1", action: "filled" },
      });
      if (existingBatchAudit) {
        await tx.auditLog.update({ where: { id: existingBatchAudit.id }, data: { payload: batchAuditPayload } });
      } else {
        await tx.auditLog.create({
          data: {
            entityType: "demo_seed",
            entityId: "anya-dashboard-v1",
            action: "filled",
            payload: batchAuditPayload,
          },
        });
      }

      return {
        clients: clients.size,
        goals: await tx.goal.count({ where: { clientId: { in: [...clients.values()].map((client) => client.id) } } }),
        attention: await tx.attentionItem.count({ where: { clientId: { in: [...clients.values()].map((client) => client.id) }, resolvedAt: null } }),
        events: await tx.event.count({
          where: {
            OR: [
              { clientId: { in: [...clients.values()].map((client) => client.id) } },
              { flowId: flow.id },
            ],
          },
        }),
        materials: materials.length,
      };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );

  console.log(
    `Демо-данные готовы: ${result.clients} клиентов, ${result.goals} целей, ` +
      `${result.attention} приоритетных действий, ${result.events} событий, ` +
      `${result.materials} материала. Внешние уведомления не отправлялись.`,
  );
}

main()
  .catch((error) => {
    console.error("Не удалось заполнить демонстрационные данные:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
