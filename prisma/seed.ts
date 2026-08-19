import { prisma } from "../src/lib/db";

async function main() {
  const templates = [
    ["morning_plan", "План на день", "Доброе утро! Пришли, пожалуйста, план на сегодня."],
    ["evening_report", "Отчёт за день", "Как прошёл день? Пришли короткий отчёт по результатам."],
    ["weekly_plan", "План недели", "Начинаем новую неделю. Зафиксируй главные цели и задачи."],
    ["weekly_summary", "Итоги недели", "Подведём итоги недели: результат, выводы и следующий фокус."],
    ["event_reminder", "Напоминание об эфире", "Напоминаю о ближайшем эфире. Ссылка будет в расписании."],
    ["payment_reminder", "Напоминание об оплате", "Напоминаю о ближайшей оплате по сопровождению."],
  ] as const;

  for (const [key, title, body] of templates) {
    await prisma.notificationTemplate.upsert({
      where: { key },
      create: { key, title, body },
      update: { title, body },
    });
  }

  console.log("База готова. Тестовые клиенты не создавались.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
