import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { createRequire } from "node:module";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

async function main() {
  const tempDirectory = mkdtempSync(resolve(tmpdir(), "anya-telegram-outbox-"));
  const databasePath = resolve(tempDirectory, "outbox.db");
  const database = new Database(databasePath);
  try {
    database.pragma("journal_mode = WAL");
    database.pragma("busy_timeout = 5000");
    database.exec(`
      CREATE TABLE "Client" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "fullName" TEXT NOT NULL,
        "telegramChatId" TEXT
      );
      CREATE TABLE "Notification" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "clientId" INTEGER,
        "eventId" INTEGER,
        "kind" TEXT NOT NULL,
        "body" TEXT NOT NULL,
        "channel" TEXT NOT NULL DEFAULT 'telegram',
        "scheduledAt" DATETIME,
        "sentAt" DATETIME,
        "status" TEXT NOT NULL DEFAULT 'draft',
        "deliveryKey" TEXT UNIQUE,
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "lastError" TEXT,
        "claimedAt" DATETIME,
        "externalMessageId" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE "AuditLog" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "entityType" TEXT NOT NULL,
        "entityId" TEXT NOT NULL,
        "action" TEXT NOT NULL,
        "payload" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO "Client" ("fullName", "telegramChatId") VALUES ('Test Client', '100500');
      INSERT INTO "Notification" ("clientId", "kind", "body", "status")
      VALUES (1, 'test', 'Mock only: no Telegram request', 'queued');
      INSERT INTO "Notification" ("clientId", "kind", "body", "status", "claimedAt", "updatedAt")
      VALUES (1, 'stale-test', 'Must be quarantined, never resent', 'sending', '2020-01-01 00:00:00', '2020-01-01 00:00:00');
    `);
    database.close();

    const worker = resolve(process.cwd(), "scripts/telegram/mock-worker.ts");
    const env = {
      ...process.env,
      DATABASE_URL: `file:${databasePath}`,
      TELEGRAM_BOT_TOKEN: "",
      TELEGRAM_OUTBOX_LIVE_SEND: "",
    };
    const outbox = resolve(process.cwd(), "scripts/telegram/outbox.ts");
    const preview = await execFileAsync(process.execPath, ["--import", "tsx", outbox, "--limit=1"], { env });
    const previewCheck = new Database(databasePath, { readonly: true });
    const beforeDelivery = previewCheck.prepare('SELECT "status" FROM "Notification" WHERE "id" = 1').get() as { status: string };
    const auditsBeforeDelivery = Number((previewCheck.prepare('SELECT COUNT(*) AS count FROM "AuditLog"').get() as { count: number }).count);
    previewCheck.close();
    if (!preview.stdout.includes("read-only preview")) throw new Error("Dry-run preview did not run");
    if (beforeDelivery.status !== "queued" || auditsBeforeDelivery !== 0) {
      throw new Error("Dry-run changed the disposable database");
    }

    const [first, second] = await Promise.all([
      execFileAsync(process.execPath, ["--import", "tsx", worker, "worker-a"], { env }),
      execFileAsync(process.execPath, ["--import", "tsx", worker, "worker-b"], { env }),
    ]);

    const checked = new Database(databasePath, { readonly: true });
    const notification = checked.prepare('SELECT "status", "sentAt" FROM "Notification" WHERE "id" = 1').get() as { status: string; sentAt: string | null };
    const staleNotification = checked.prepare('SELECT "status", "sentAt" FROM "Notification" WHERE "id" = 2').get() as { status: string; sentAt: string | null };
    const sentAudits = Number((checked.prepare("SELECT COUNT(*) AS count FROM \"AuditLog\" WHERE \"action\" = 'telegram_sent'").get() as { count: number }).count);
    const claimedAudits = Number((checked.prepare("SELECT COUNT(*) AS count FROM \"AuditLog\" WHERE \"action\" = 'telegram_claimed'").get() as { count: number }).count);
    checked.close();

    if (notification.status !== "sent" || !notification.sentAt) throw new Error("Mock notification was not marked sent");
    if (staleNotification.status !== "uncertain" || staleNotification.sentAt) throw new Error("Stale claim was not safely quarantined");
    if (sentAudits !== 1) throw new Error(`Expected one send audit, got ${sentAudits}`);
    if (claimedAudits !== 1) throw new Error(`Expected one claim audit, got ${claimedAudits}`);

    console.log(first.stdout.trim());
    console.log(second.stdout.trim());
    console.log("PASS: dry-run was read-only; two worker processes mock-delivered one notification at most once; stale sending was quarantined without retry; Telegram was never called.");
  } finally {
    try { database.close(); } catch { /* already closed */ }
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
