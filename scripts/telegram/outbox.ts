import { processTelegramOutbox } from "../../src/lib/notification-outbox";
import { prisma } from "../../src/lib/db";

function argumentValue(name: string) {
  const prefix = `${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

const live = process.argv.includes("--live");
const limit = Number(argumentValue("--limit") ?? 25);

async function main() {
  const result = await processTelegramOutbox({
    dryRun: !live,
    allowLiveSend: live,
    limit,
    workerId: argumentValue("--worker") ?? undefined,
  });

  if (!live) {
    console.log("Telegram outbox: read-only preview (database and Telegram were not changed)");
    for (const item of result.preview) {
      console.log(JSON.stringify({
        id: item.id,
        kind: item.kind,
        client: item.clientName,
        hasChatId: item.hasChatId,
        due: item.due,
        scheduledAt: item.scheduledAt?.toISOString() ?? null,
        bodyPreview: item.body.slice(0, 120),
      }));
    }
    console.log(`Queued preview: ${result.preview.length}`);
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
