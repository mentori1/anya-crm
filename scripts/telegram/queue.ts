import { queueTelegramNotification } from "../../src/lib/notification-outbox";
import { prisma } from "../../src/lib/db";

const notificationId = Number(process.argv[2]);

async function main() {
  if (!Number.isInteger(notificationId) || notificationId <= 0) {
    throw new Error("Укажи ID уведомления: tsx scripts/telegram/queue.ts 123");
  }
  const queued = await queueTelegramNotification(notificationId, "telegram_queue_script");
  console.log(queued ? `Уведомление ${notificationId} поставлено в очередь.` : `Уведомление ${notificationId} уже обработано или недоступно.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
