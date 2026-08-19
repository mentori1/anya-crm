import { processTelegramOutbox } from "../../src/lib/notification-outbox";
import { prisma } from "../../src/lib/db";

async function main() {
  const workerId = process.argv[2] || `mock-${process.pid}`;
  const result = await processTelegramOutbox({
    dryRun: false,
    limit: 1,
    workerId,
    sender: async () => {
      // Deliberately no network call. The delay widens the concurrent claim test.
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { message_id: 700_000 + process.pid };
    },
  });
  console.log(JSON.stringify({ workerId, claimed: result.claimed, sent: result.sent }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
