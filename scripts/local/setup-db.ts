import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { normalizedClientIdentity } from "../../src/lib/client-identity";

const root = process.cwd();
process.umask(0o077);
const localDir = resolve(root, "prisma/.local");
const localSchema = resolve(localDir, "schema.prisma");
const databasePath = process.env.LOCAL_DATABASE_PATH
  ? resolve(process.env.LOCAL_DATABASE_PATH)
  : resolve(root, "anya-crm-local.db");
const databaseAlreadyExists = existsSync(databasePath);
// Относительный file: URL обходится без проблем нативного SQLite-движка
// с кириллицей в полном пути к рабочей папке.
const databaseUrl = process.env.LOCAL_DATABASE_PATH
  ? `file:${databasePath}`
  : "file:./anya-crm-local.db";

mkdirSync(localDir, { recursive: true });
chmodSync(localDir, 0o700);

const source = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8")
  .replace('provider = "postgresql"', 'provider = "sqlite"')
  .replace(/output\s*=\s*"\.\.\/src\/generated\/prisma"/, 'output = "../../src/generated/prisma"');
writeFileSync(localSchema, source);

const env = { ...process.env, DATABASE_URL: databaseUrl };
execFileSync(
  process.execPath,
  [resolve(root, "node_modules/prisma/build/index.js"), "generate", "--schema", localSchema],
  { stdio: "inherit", env },
);
// На локальном Mac схема создаётся напрямую через тот же SQLite-драйвер,
// который затем использует приложение. Это не затрагивает PostgreSQL-схему
// будущего сервера и не требует отдельной установленной СУБД.
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const db = new Database(databasePath, { timeout: 5_000 });
db.pragma("busy_timeout = 5000");
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");
const assertDatabaseHealthy = (stage: string) => {
  const integrity = String(db.pragma("integrity_check", { simple: true }));
  if (integrity !== "ok") throw new Error(`База ${stage} не прошла integrity_check: ${integrity}`);
  const foreignKeyIssues = (db.pragma("foreign_key_check") as unknown[]).length;
  if (foreignKeyIssues) throw new Error(`База ${stage} содержит ошибки связей: ${foreignKeyIssues}`);
};

try {
  assertDatabaseHealthy("до миграции");
  const migrate = db.transaction(() => {
    db.exec(`
  CREATE TABLE IF NOT EXISTS "Client" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT, "phoneNormalized" TEXT,
    "telegram" TEXT, "telegramNormalized" TEXT,
    "email" TEXT, "emailNormalized" TEXT, "source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastActivityAt" DATETIME, "nextContactAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS "Client_status_idx" ON "Client"("status");
  CREATE INDEX IF NOT EXISTS "Client_fullName_idx" ON "Client"("fullName");
  CREATE INDEX IF NOT EXISTS "Client_phone_idx" ON "Client"("phone");
  CREATE INDEX IF NOT EXISTS "Client_telegram_idx" ON "Client"("telegram");

  CREATE TABLE IF NOT EXISTS "ClientPortalAccess" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientId" INTEGER NOT NULL,
    "publicId" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "isActive" INTEGER NOT NULL DEFAULT 1,
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "failedLoginWindowStartedAt" DATETIME,
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientPortalAccess_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "ClientPortalAccess_clientId_key" ON "ClientPortalAccess"("clientId");
  CREATE UNIQUE INDEX IF NOT EXISTS "ClientPortalAccess_publicId_key" ON "ClientPortalAccess"("publicId");
  CREATE INDEX IF NOT EXISTS "ClientPortalAccess_isActive_idx" ON "ClientPortalAccess"("isActive");

  CREATE TABLE IF NOT EXISTS "Program" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL, "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS "Flow" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'draft',
    "startDate" DATETIME, "endDate" DATETIME, "programId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Flow_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE
  );
  CREATE INDEX IF NOT EXISTS "Flow_status_idx" ON "Flow"("status");
  CREATE INDEX IF NOT EXISTS "Flow_programId_idx" ON "Flow"("programId");

  CREATE TABLE IF NOT EXISTS "Enrollment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientId" INTEGER NOT NULL, "programId" INTEGER, "flowId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active', "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Enrollment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Enrollment_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Enrollment_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE SET NULL ON UPDATE CASCADE
  );
  CREATE INDEX IF NOT EXISTS "Enrollment_clientId_idx" ON "Enrollment"("clientId");
  CREATE INDEX IF NOT EXISTS "Enrollment_programId_idx" ON "Enrollment"("programId");
  CREATE INDEX IF NOT EXISTS "Enrollment_flowId_idx" ON "Enrollment"("flowId");
  CREATE INDEX IF NOT EXISTS "Enrollment_status_idx" ON "Enrollment"("status");

  CREATE TABLE IF NOT EXISTS "Goal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientId" INTEGER NOT NULL, "title" TEXT NOT NULL,
    "startValue" REAL, "targetValue" REAL, "currentValue" REAL, "unit" TEXT,
    "movement" TEXT NOT NULL DEFAULT 'on_track', "status" TEXT NOT NULL DEFAULT 'active',
    "deadline" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Goal_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE INDEX IF NOT EXISTS "Goal_clientId_idx" ON "Goal"("clientId");
  CREATE INDEX IF NOT EXISTS "Goal_status_idx" ON "Goal"("status");
  CREATE INDEX IF NOT EXISTS "Goal_movement_idx" ON "Goal"("movement");

  CREATE TABLE IF NOT EXISTS "WeeklyPlan" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientId" INTEGER NOT NULL, "weekStart" DATETIME NOT NULL, "weekEnd" DATETIME NOT NULL,
    "focus" TEXT, "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeeklyPlan_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "WeeklyPlan_clientId_weekStart_key" ON "WeeklyPlan"("clientId","weekStart");
  CREATE INDEX IF NOT EXISTS "WeeklyPlan_clientId_idx" ON "WeeklyPlan"("clientId");
  CREATE INDEX IF NOT EXISTS "WeeklyPlan_weekStart_idx" ON "WeeklyPlan"("weekStart");

  CREATE TABLE IF NOT EXISTS "PlanTask" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "planId" INTEGER NOT NULL,
    "title" TEXT NOT NULL, "dueAt" DATETIME, "status" TEXT NOT NULL DEFAULT 'todo', "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanTask_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WeeklyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE INDEX IF NOT EXISTS "PlanTask_planId_idx" ON "PlanTask"("planId");
  CREATE INDEX IF NOT EXISTS "PlanTask_status_idx" ON "PlanTask"("status");

  CREATE TABLE IF NOT EXISTS "DailyReport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "clientId" INTEGER NOT NULL, "reportDate" DATETIME NOT NULL,
    "result" TEXT, "actions" TEXT, "blockers" TEXT, "nextStep" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailyReport_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "DailyReport_clientId_reportDate_key" ON "DailyReport"("clientId","reportDate");
  CREATE INDEX IF NOT EXISTS "DailyReport_reportDate_idx" ON "DailyReport"("reportDate");

  CREATE TABLE IF NOT EXISTS "WeeklyReport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "clientId" INTEGER NOT NULL, "weekStart" DATETIME NOT NULL,
    "summary" TEXT, "revenue" REAL, "leads" INTEGER, "sales" INTEGER, "wins" TEXT, "blockers" TEXT, "nextFocus" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeeklyReport_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "WeeklyReport_clientId_weekStart_key" ON "WeeklyReport"("clientId","weekStart");
  CREATE INDEX IF NOT EXISTS "WeeklyReport_weekStart_idx" ON "WeeklyReport"("weekStart");

  CREATE TABLE IF NOT EXISTS "Feedback" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "clientId" INTEGER NOT NULL, "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Feedback_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE INDEX IF NOT EXISTS "Feedback_clientId_idx" ON "Feedback"("clientId");

  CREATE TABLE IF NOT EXISTS "Material" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "programId" INTEGER,
    "title" TEXT NOT NULL, "description" TEXT, "kind" TEXT NOT NULL DEFAULT 'lesson', "url" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0, "isPublished" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Material_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE
  );
  CREATE INDEX IF NOT EXISTS "Material_programId_idx" ON "Material"("programId");
  CREATE INDEX IF NOT EXISTS "Material_isPublished_idx" ON "Material"("isPublished");

  CREATE TABLE IF NOT EXISTS "MaterialProgress" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "clientId" INTEGER NOT NULL, "materialId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_started', "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MaterialProgress_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MaterialProgress_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "MaterialProgress_clientId_materialId_key" ON "MaterialProgress"("clientId","materialId");
  CREATE INDEX IF NOT EXISTS "MaterialProgress_materialId_idx" ON "MaterialProgress"("materialId");

  CREATE TABLE IF NOT EXISTS "Event" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "title" TEXT NOT NULL, "kind" TEXT NOT NULL DEFAULT 'live',
    "startsAt" DATETIME NOT NULL, "durationMinutes" INTEGER NOT NULL DEFAULT 60, "link" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned', "flowId" INTEGER, "clientId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Event_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Event_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE
  );
  CREATE INDEX IF NOT EXISTS "Event_startsAt_idx" ON "Event"("startsAt");
  CREATE INDEX IF NOT EXISTS "Event_flowId_idx" ON "Event"("flowId");
  CREATE INDEX IF NOT EXISTS "Event_clientId_idx" ON "Event"("clientId");

  CREATE TABLE IF NOT EXISTS "Attendance" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "eventId" INTEGER NOT NULL, "clientId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'invited', "joinedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attendance_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attendance_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "Attendance_eventId_clientId_key" ON "Attendance"("eventId","clientId");
  CREATE INDEX IF NOT EXISTS "Attendance_clientId_idx" ON "Attendance"("clientId");

  CREATE TABLE IF NOT EXISTS "Payment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "clientId" INTEGER NOT NULL, "title" TEXT NOT NULL,
    "amountRub" INTEGER NOT NULL, "dueDate" DATETIME, "paidAt" DATETIME, "status" TEXT NOT NULL DEFAULT 'planned',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE INDEX IF NOT EXISTS "Payment_clientId_idx" ON "Payment"("clientId");
  CREATE INDEX IF NOT EXISTS "Payment_status_idx" ON "Payment"("status");
  CREATE INDEX IF NOT EXISTS "Payment_dueDate_idx" ON "Payment"("dueDate");

  CREATE TABLE IF NOT EXISTS "AttentionItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "clientId" INTEGER, "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'manual', "priority" TEXT NOT NULL DEFAULT 'normal', "dueAt" DATETIME, "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttentionItem_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE INDEX IF NOT EXISTS "AttentionItem_clientId_idx" ON "AttentionItem"("clientId");
  CREATE INDEX IF NOT EXISTS "AttentionItem_resolvedAt_idx" ON "AttentionItem"("resolvedAt");
  CREATE INDEX IF NOT EXISTS "AttentionItem_dueAt_idx" ON "AttentionItem"("dueAt");

  CREATE TABLE IF NOT EXISTS "PrivateNote" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "clientId" INTEGER NOT NULL, "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrivateNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE INDEX IF NOT EXISTS "PrivateNote_clientId_idx" ON "PrivateNote"("clientId");

  CREATE TABLE IF NOT EXISTS "NotificationTemplate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "key" TEXT NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'telegram', "isActive" INTEGER NOT NULL DEFAULT 1, "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "NotificationTemplate_key_key" ON "NotificationTemplate"("key");

  CREATE TABLE IF NOT EXISTS "Notification" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "clientId" INTEGER, "eventId" INTEGER,
    "kind" TEXT NOT NULL, "body" TEXT NOT NULL, "channel" TEXT NOT NULL DEFAULT 'telegram',
    "scheduledAt" DATETIME, "sentAt" DATETIME, "status" TEXT NOT NULL DEFAULT 'draft',
    "deliveryKey" TEXT, "attempts" INTEGER NOT NULL DEFAULT 0, "lastError" TEXT, "claimedAt" DATETIME, "externalMessageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE
  );
  CREATE INDEX IF NOT EXISTS "Notification_clientId_idx" ON "Notification"("clientId");
  CREATE INDEX IF NOT EXISTS "Notification_eventId_idx" ON "Notification"("eventId");
  CREATE INDEX IF NOT EXISTS "Notification_status_idx" ON "Notification"("status");
  CREATE INDEX IF NOT EXISTS "Notification_scheduledAt_idx" ON "Notification"("scheduledAt");

  CREATE TABLE IF NOT EXISTS "MutationReceipt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "action" TEXT NOT NULL, "operationKey" TEXT NOT NULL, "payloadHash" TEXT NOT NULL,
    "entityType" TEXT NOT NULL, "entityId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" DATETIME
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "MutationReceipt_action_operationKey_key" ON "MutationReceipt"("action","operationKey");
  CREATE INDEX IF NOT EXISTS "MutationReceipt_createdAt_idx" ON "MutationReceipt"("createdAt");

  CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL, "payload" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType","entityId");
  CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
    `);
    const clientColumns = new Set(
      db.prepare('PRAGMA table_info("Client")').all().map((row: { name: string }) => row.name),
    );
    const addClientColumn = (name: string, sqlType: string) => {
      if (!clientColumns.has(name)) db.exec(`ALTER TABLE "Client" ADD COLUMN "${name}" ${sqlType}`);
    };
    addClientColumn("telegramUserId", "TEXT");
    addClientColumn("telegramChatId", "TEXT");
    addClientColumn("telegramAvatarFileId", "TEXT");
    addClientColumn("avatarStorageKey", "TEXT");
    addClientColumn("avatarMimeType", "TEXT");
    addClientColumn("avatarUpdatedAt", "DATETIME");
    addClientColumn("phoneNormalized", "TEXT");
    addClientColumn("telegramNormalized", "TEXT");
    addClientColumn("emailNormalized", "TEXT");
    addClientColumn("version", "INTEGER NOT NULL DEFAULT 1");

    const identityRows = db.prepare(`
      SELECT "id", "phone", "telegram", "email"
      FROM "Client"
      ORDER BY "id"
    `).all() as Array<{
      id: number;
      phone: string | null;
      telegram: string | null;
      email: string | null;
    }>;
    const normalizedRows = identityRows.map((row) => ({
      id: row.id,
      ...normalizedClientIdentity(row),
    }));
    const identityFields = [
      ["phoneNormalized", "телефон"],
      ["telegramNormalized", "Telegram"],
      ["emailNormalized", "email"],
    ] as const;
    const conflicts: string[] = [];
    for (const [field, label] of identityFields) {
      const idsByValue = new Map<string, number[]>();
      for (const row of normalizedRows) {
        const value = row[field];
        if (!value) continue;
        const ids = idsByValue.get(value) ?? [];
        ids.push(row.id);
        idsByValue.set(value, ids);
      }
      for (const [value, ids] of idsByValue) {
        if (ids.length > 1) conflicts.push(`${label} ${value}: клиенты ${ids.join(", ")}`);
      }
    }
    if (conflicts.length) {
      throw new Error(
        `Миграция остановлена: найдены совпадающие контакты после нормализации. ` +
        `Ничего не изменено. Сначала объедините или исправьте записи: ${conflicts.join("; ")}`,
      );
    }
    const updateIdentity = db.prepare(`
      UPDATE "Client"
      SET "phoneNormalized" = ?, "telegramNormalized" = ?, "emailNormalized" = ?
      WHERE "id" = ?
    `);
    for (const row of normalizedRows) {
      updateIdentity.run(
        row.phoneNormalized,
        row.telegramNormalized,
        row.emailNormalized,
        row.id,
      );
    }
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS "Client_phoneNormalized_key" ON "Client"("phoneNormalized");
      CREATE UNIQUE INDEX IF NOT EXISTS "Client_telegramNormalized_key" ON "Client"("telegramNormalized");
      CREATE UNIQUE INDEX IF NOT EXISTS "Client_emailNormalized_key" ON "Client"("emailNormalized");
    `);
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS "Client_telegramUserId_key" ON "Client"("telegramUserId")');

    const portalColumns = new Set(
      db.prepare('PRAGMA table_info("ClientPortalAccess")').all().map((row: { name: string }) => row.name),
    );
    const addPortalColumn = (name: string, sqlType: string) => {
      if (!portalColumns.has(name)) db.exec(`ALTER TABLE "ClientPortalAccess" ADD COLUMN "${name}" ${sqlType}`);
    };
    addPortalColumn("failedLoginCount", "INTEGER NOT NULL DEFAULT 0");
    addPortalColumn("failedLoginWindowStartedAt", "DATETIME");
    addPortalColumn("lockedUntil", "DATETIME");

    const templateColumns = new Set(
      db.prepare('PRAGMA table_info("NotificationTemplate")').all().map((row: { name: string }) => row.name),
    );
    if (!templateColumns.has("version")) {
      db.exec('ALTER TABLE "NotificationTemplate" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1');
    }

    const notificationColumns = new Set(
      db.prepare('PRAGMA table_info("Notification")').all().map((row: { name: string }) => row.name),
    );
    const addNotificationColumn = (name: string, sqlType: string) => {
      if (!notificationColumns.has(name)) db.exec(`ALTER TABLE "Notification" ADD COLUMN "${name}" ${sqlType}`);
    };
    addNotificationColumn("deliveryKey", "TEXT");
    addNotificationColumn("attempts", "INTEGER NOT NULL DEFAULT 0");
    addNotificationColumn("lastError", "TEXT");
    addNotificationColumn("claimedAt", "DATETIME");
    addNotificationColumn("externalMessageId", "TEXT");
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS "Notification_deliveryKey_key" ON "Notification"("deliveryKey")');

    db.pragma("user_version = 3");
  });
  migrate();
  assertDatabaseHealthy("после миграции");
} finally {
  db.close();
}
chmodSync(databasePath, 0o600);
for (const sidecar of [`${databasePath}-wal`, `${databasePath}-shm`]) {
  if (existsSync(sidecar)) chmodSync(sidecar, 0o600);
}
if (process.env.LOCAL_KEEP_DATA !== "1" || !databaseAlreadyExists) {
  execFileSync(
    resolve(root, "node_modules/.bin/tsx"),
    [resolve(root, "prisma/seed.ts")],
    { stdio: "inherit", env },
  );
} else {
  console.log("Локальные данные сохранены, выполнено только обновление схемы.");
}

console.log(`Локальная база CRM Ани готова: ${databasePath}`);
