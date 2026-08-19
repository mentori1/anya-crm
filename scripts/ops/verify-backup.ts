import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";

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

type ManifestAsset = {
  storageKey: string;
  relativePath: string;
  size: number;
  sha256: string;
};

type BackupManifest = {
  formatVersion: number;
  sha256: string;
  counts: Record<string, number>;
  assetsPath: string | null;
  assets: ManifestAsset[];
};

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

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

function readManifest(manifestPath: string): BackupManifest {
  const value = JSON.parse(readFileSync(manifestPath, "utf8")) as Partial<BackupManifest>;
  if (
    value.formatVersion !== 2 ||
    typeof value.sha256 !== "string" ||
    !value.counts ||
    typeof value.counts !== "object" ||
    !Array.isArray(value.assets) ||
    !(typeof value.assetsPath === "string" || value.assetsPath === null)
  ) {
    throw new Error("Манифест резервной копии имеет неподдерживаемый формат.");
  }
  return value as BackupManifest;
}

const root = process.cwd();
const backupDir = resolve(root, ".backups");
const requested = process.argv[2];
const latest = existsSync(backupDir)
  ? readdirSync(backupDir).filter((name) => name.endsWith(".db")).sort().at(-1)
  : undefined;
const backupPath = requested ? resolve(root, requested) : latest ? resolve(backupDir, latest) : "";
if (!backupPath || !existsSync(backupPath)) throw new Error("Резервная копия не найдена.");

const manifestPath = `${backupPath}.json`;
if (!existsSync(manifestPath)) {
  throw new Error("У резервной копии отсутствует обязательный манифест.");
}
const manifest = readManifest(manifestPath);
const databaseHash = sha256(backupPath);
if (manifest.sha256 !== databaseHash) {
  throw new Error("Контрольная сумма копии не совпала с манифестом.");
}

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const db = new Database(backupPath, { readonly: true });
let integrity: unknown;
let foreignKeys: unknown[];
let missingTables: string[];
let counts: Record<string, number>;
let avatarReferences: AvatarReference[];
try {
  integrity = db.pragma("integrity_check", { simple: true });
  foreignKeys = db.pragma("foreign_key_check") as unknown[];
  const existing = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row: { name: string }) => row.name),
  );
  missingTables = BUSINESS_TABLES.filter((table) => !existing.has(table));
  counts = Object.fromEntries(
    BUSINESS_TABLES.filter((table) => existing.has(table)).map((table) => {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as {
        count: number;
      };
      return [table, Number(row.count)];
    }),
  );
  avatarReferences = existing.has("Client")
    ? (db
        .prepare(
          'SELECT id, avatarStorageKey FROM "Client" WHERE avatarStorageKey IS NOT NULL ORDER BY id',
        )
        .all() as AvatarReference[])
    : [];
} finally {
  db.close();
}

if (integrity !== "ok") throw new Error(`Проверка целостности не пройдена: ${integrity}`);
if (foreignKeys.length) throw new Error(`Найдены нарушения внешних связей: ${foreignKeys.length}`);
if (missingTables.length) throw new Error(`В копии нет таблиц: ${missingTables.join(", ")}`);

for (const table of BUSINESS_TABLES) {
  const expected = manifest.counts[table];
  if (!Number.isInteger(expected) || expected < 0) {
    throw new Error(`В манифесте нет корректного количества строк таблицы ${table}.`);
  }
  if (counts[table] !== expected) {
    throw new Error(
      `Количество строк ${table} не совпало: в базе ${counts[table]}, в манифесте ${expected}.`,
    );
  }
}

const referencedKeys = new Set<string>();
for (const reference of avatarReferences) {
  const storageKey = String(reference.avatarStorageKey);
  if (!avatarStorageKeyIsValid(storageKey, Number(reference.id))) {
    throw new Error(
      `Некорректный avatarStorageKey у клиента ${reference.id}: ${storageKey}`,
    );
  }
  referencedKeys.add(storageKey);
}

const manifestAssets = new Map<string, ManifestAsset>();
for (const asset of manifest.assets) {
  if (
    typeof asset.storageKey !== "string" ||
    typeof asset.relativePath !== "string" ||
    asset.relativePath !== asset.storageKey ||
    basename(asset.relativePath) !== asset.relativePath ||
    !Number.isInteger(asset.size) ||
    asset.size < 0 ||
    typeof asset.sha256 !== "string"
  ) {
    throw new Error("В манифесте есть некорректная запись файла аватара.");
  }
  if (manifestAssets.has(asset.storageKey)) {
    throw new Error(`Аватар продублирован в манифесте: ${asset.storageKey}`);
  }
  manifestAssets.set(asset.storageKey, asset);
}

const missingAssets = [...referencedKeys].filter((key) => !manifestAssets.has(key));
if (missingAssets.length) {
  throw new Error(`В манифесте нет аватаров из базы: ${missingAssets.join(", ")}`);
}
const extraAssets = [...manifestAssets.keys()].filter((key) => !referencedKeys.has(key));
if (extraAssets.length) {
  throw new Error(`В манифесте есть лишние аватары: ${extraAssets.join(", ")}`);
}

const expectedAssetsPath = resolve(
  dirname(backupPath),
  `${basename(backupPath, ".db")}-assets`,
);
if (manifestAssets.size > 0) {
  if (!manifest.assetsPath) throw new Error("В манифесте нет пути к файлам аватаров.");
  if (resolve(manifest.assetsPath) !== expectedAssetsPath) {
    throw new Error("Путь к файлам аватаров не соответствует резервной копии.");
  }
  if (!existsSync(expectedAssetsPath) || !statSync(expectedAssetsPath).isDirectory()) {
    throw new Error("Папка файлов аватаров резервной копии не найдена.");
  }
} else if (manifest.assetsPath !== null) {
  throw new Error("Для копии без аватаров в манифесте указан лишний путь к файлам.");
}

const actualAssetPaths = existsSync(expectedAssetsPath) ? filesBelow(expectedAssetsPath) : [];
const actualRelativePaths = new Set(
  actualAssetPaths.map((path) => relative(expectedAssetsPath, path)),
);
const undeclaredFiles = [...actualRelativePaths].filter(
  (path) => ![...manifestAssets.values()].some((asset) => asset.relativePath === path),
);
if (undeclaredFiles.length) {
  throw new Error(`В папке копии есть лишние файлы: ${undeclaredFiles.join(", ")}`);
}
if (actualRelativePaths.size !== manifestAssets.size) {
  throw new Error("Количество файлов аватаров не совпало с манифестом.");
}

for (const asset of manifestAssets.values()) {
  const assetPath = resolve(expectedAssetsPath, asset.relativePath);
  if (!existsSync(assetPath) || !statSync(assetPath).isFile()) {
    throw new Error(`В копии нет файла аватара: ${asset.relativePath}`);
  }
  if (lstatSync(assetPath).isSymbolicLink()) {
    throw new Error(`Символические ссылки запрещены в копии: ${asset.relativePath}`);
  }
  if (statSync(assetPath).size !== asset.size) {
    throw new Error(`Размер файла аватара не совпал: ${asset.relativePath}`);
  }
  if (sha256(assetPath) !== asset.sha256) {
    throw new Error(`Повреждён файл аватара: ${asset.relativePath}`);
  }
}

console.log(`Копия исправна: ${backupPath}`);
console.log(`SHA-256: ${databaseHash}`);
