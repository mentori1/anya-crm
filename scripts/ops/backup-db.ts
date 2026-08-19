import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";

const BUSINESS_TABLES = [
  "Client",
  "ClientPortalAccess",
  "Program",
  "Flow",
  "Enrollment",
  "Goal",
  "WeeklyPlan",
  "PlanTask",
  "DailyReport",
  "WeeklyReport",
  "Feedback",
  "Material",
  "MaterialProgress",
  "Event",
  "Attendance",
  "Payment",
  "AttentionItem",
  "PrivateNote",
  "NotificationTemplate",
  "Notification",
  "MutationReceipt",
  "AuditLog",
] as const;

type AvatarReference = {
  id: number;
  avatarStorageKey: string;
};

function avatarStorageKeyIsValid(storageKey: string, clientId: number) {
  if (basename(storageKey) !== storageKey) return false;
  return new RegExp(
    `^client-${clientId}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(?:jpg|png|webp)$`,
    "i",
  ).test(storageKey);
}

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function main() {
  process.umask(0o077);
  const root = process.cwd();
  const databaseUrl = process.env.DATABASE_URL ?? "file:./anya-crm-local.db";
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("Локальная команда резервного копирования работает только с SQLite.");
  }

  const sourcePath = resolve(root, databaseUrl.slice("file:".length));
  const backupDir = resolve(root, ".backups");
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  chmodSync(backupDir, 0o700);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = resolve(backupDir, `anya-crm-${stamp}.db`);
  const require = createRequire(import.meta.url);
  const Database = require("better-sqlite3");
  const source = new Database(sourcePath);

  try {
    source.pragma("foreign_keys = ON");
    const integrity = source.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") {
      throw new Error(`Исходная база не прошла проверку: ${integrity}`);
    }
    await source.backup(backupPath);
    chmodSync(backupPath, 0o600);
  } finally {
    source.close();
  }

  // Манифест строится по самой копии, а не по меняющейся исходной базе.
  const backup = new Database(backupPath, { readonly: true });
  let counts: Record<string, number>;
  let avatarReferences: AvatarReference[];
  try {
    const existing = new Set(
      backup
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row: { name: string }) => row.name),
    );
    const missingTables = BUSINESS_TABLES.filter((table) => !existing.has(table));
    if (missingTables.length) {
      throw new Error(`В резервной копии нет таблиц: ${missingTables.join(", ")}`);
    }

    counts = Object.fromEntries(
      BUSINESS_TABLES.map((table) => {
        const row = backup.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as {
          count: number;
        };
        return [table, Number(row.count)];
      }),
    );
    avatarReferences = backup
      .prepare(
        'SELECT id, avatarStorageKey FROM "Client" WHERE avatarStorageKey IS NOT NULL ORDER BY id',
      )
      .all() as AvatarReference[];
  } finally {
    backup.close();
  }

  const avatarSource = resolve(root, "storage/avatars");
  const assetsPath = resolve(backupDir, `anya-crm-${stamp}-assets`);
  const assets: {
    storageKey: string;
    relativePath: string;
    size: number;
    sha256: string;
  }[] = [];
  const copiedKeys = new Set<string>();

  for (const reference of avatarReferences) {
    const storageKey = String(reference.avatarStorageKey);
    if (!avatarStorageKeyIsValid(storageKey, Number(reference.id))) {
      throw new Error(
        `Некорректный avatarStorageKey у клиента ${reference.id}: ${storageKey}`,
      );
    }
    if (copiedKeys.has(storageKey)) continue;

    const sourceAvatarPath = resolve(avatarSource, storageKey);
    if (!existsSync(sourceAvatarPath) || !statSync(sourceAvatarPath).isFile()) {
      throw new Error(
        `В базе указан отсутствующий файл аватара клиента ${reference.id}: ${storageKey}`,
      );
    }

    mkdirSync(assetsPath, { recursive: true, mode: 0o700 });
    chmodSync(assetsPath, 0o700);
    const copiedAvatarPath = resolve(assetsPath, storageKey);
    copyFileSync(sourceAvatarPath, copiedAvatarPath);
    chmodSync(copiedAvatarPath, 0o600);
    assets.push({
      storageKey,
      relativePath: storageKey,
      size: statSync(copiedAvatarPath).size,
      sha256: sha256(copiedAvatarPath),
    });
    copiedKeys.add(storageKey);
  }

  const databaseSha256 = sha256(backupPath);
  const manifestPath = `${backupPath}.json`;
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        formatVersion: 2,
        createdAt: new Date().toISOString(),
        sourcePath,
        backupPath,
        sha256: databaseSha256,
        counts,
        assetsPath: assets.length ? assetsPath : null,
        assets,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  chmodSync(manifestPath, 0o600);

  console.log(`Резервная копия создана: ${backupPath}`);
  console.log(`Файлов аватаров в копии: ${assets.length}`);
  console.log(`Контрольная сумма: ${databaseSha256}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
