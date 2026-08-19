import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = fileURLToPath(import.meta.url);
const tsxPath = resolve(root, "node_modules/.bin/tsx");
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

type WorkerTask =
  | { kind: "create-duplicate"; label: string }
  | { kind: "update-version"; clientId: number; version: number; fullName: string }
  | { kind: "create-independent"; index: number }
  | { kind: "idempotent-flow"; operationKey: string }
  | { kind: "invalid-fk" };

type WorkerResult = Record<string, unknown> & { kind: WorkerTask["kind"] };

function encoded(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decoded<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

function errorInfo(error: unknown) {
  const record = error as { code?: unknown; message?: unknown; meta?: unknown };
  return {
    code: typeof record?.code === "string" ? record.code : null,
    message: error instanceof Error ? error.message : String(error),
    meta: record?.meta ?? null,
  };
}

async function waitForFile(path: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`Таймаут ожидания ${path}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}

async function workerMain() {
  const dbPath = process.argv[3];
  const readyPath = process.argv[4];
  const goPath = process.argv[5];
  const task = decoded<WorkerTask>(process.argv[6]);
  if (!dbPath || !readyPath || !goPath || !task) throw new Error("Worker arguments missing");

  writeFileSync(readyPath, String(process.pid));
  await waitForFile(goPath);
  process.env.DATABASE_URL = `file:${dbPath}`;
  const { prisma, withTransientDbRetry } = await import("../../src/lib/db");
  let result: WorkerResult;
  try {
    if (task.kind === "create-duplicate") {
      try {
        const client = await withTransientDbRetry(() => prisma.client.create({
          data: {
            fullName: `Дубль ${task.label}`,
            phone: task.label === "A" ? "+7 (999) 111-22-33" : "8 999 111 22 33",
            phoneNormalized: "+79991112233",
            email: `${task.label.toLowerCase()}@example.test`,
            emailNormalized: `${task.label.toLowerCase()}@example.test`,
          },
        }));
        result = { kind: task.kind, outcome: "created", id: client.id };
      } catch (error) {
        result = { kind: task.kind, outcome: "rejected", error: errorInfo(error) };
      }
    } else if (task.kind === "update-version") {
      const update = await withTransientDbRetry(() => prisma.client.updateMany({
        where: { id: task.clientId, version: task.version },
        data: { fullName: task.fullName, version: { increment: 1 } },
      }));
      result = { kind: task.kind, count: update.count, fullName: task.fullName };
    } else if (task.kind === "create-independent") {
      const client = await withTransientDbRetry(() => prisma.client.create({
        data: {
          fullName: `Независимый ${task.index}`,
          email: `parallel-${task.index}@example.test`,
          emailNormalized: `parallel-${task.index}@example.test`,
        },
      }));
      result = { kind: task.kind, id: client.id };
    } else if (task.kind === "idempotent-flow") {
      const action = "concurrency_test_flow";
      const hash = "same-payload-hash";
      try {
        const entityId = await withTransientDbRetry(() => prisma.$transaction(async (tx) => {
          const receipt = await tx.mutationReceipt.create({
            data: {
              action,
              operationKey: task.operationKey,
              payloadHash: hash,
              entityType: "flow",
            },
          });
          const flow = await tx.flow.create({ data: { title: "Поток без дубля" } });
          await tx.mutationReceipt.update({
            where: { id: receipt.id },
            data: { entityId: String(flow.id), completedAt: new Date() },
          });
          return flow.id;
        }));
        result = { kind: task.kind, entityId, reused: false };
      } catch (error) {
        const receipt = await prisma.mutationReceipt.findUnique({
          where: { action_operationKey: { action, operationKey: task.operationKey } },
        });
        if (!receipt?.entityId || receipt.payloadHash !== hash) throw error;
        result = { kind: task.kind, entityId: Number(receipt.entityId), reused: true };
      }
    } else {
      try {
        await prisma.goal.create({ data: { clientId: 999_999_999, title: "Недопустимая связь" } });
        result = { kind: task.kind, rejected: false };
      } catch (error) {
        result = { kind: task.kind, rejected: true, error: errorInfo(error) };
      }
    }
  } finally {
    await prisma.$disconnect();
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function runSetup(dbPath: string) {
  const result = spawnSync(tsxPath, [resolve(root, "scripts/local/setup-db.ts")], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      LOCAL_DATABASE_PATH: dbPath,
      LOCAL_KEEP_DATA: "1",
    },
  });
  if (result.status !== 0) {
    throw new Error(`Disposable setup failed:\n${result.stdout}\n${result.stderr}`);
  }
}

function spawnWorker(
  dbPath: string,
  readyPath: string,
  goPath: string,
  task: WorkerTask,
) {
  const child = spawn(tsxPath, [scriptPath, "--worker", dbPath, readyPath, goPath, encoded(task)], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return child;
}

async function collect(child: ReturnType<typeof spawnWorker>) {
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const exitCode = await new Promise<number | null>((resolveExit) => child.on("close", resolveExit));
  if (exitCode !== 0) throw new Error(`Worker failed (${exitCode}):\n${stdout}\n${stderr}`);
  const lastLine = stdout.trim().split("\n").at(-1);
  if (!lastLine) throw new Error(`Worker returned no JSON: ${stderr}`);
  return JSON.parse(lastLine) as WorkerResult;
}

async function runWave(
  dbPath: string,
  waveDir: string,
  tasks: WorkerTask[],
  blocker: InstanceType<typeof Database>,
) {
  const goPath = join(waveDir, "go");
  const readyPaths = tasks.map((_, index) => join(waveDir, `ready-${index}`));
  const children = tasks.map((task, index) => spawnWorker(dbPath, readyPaths[index], goPath, task));
  await Promise.all(readyPaths.map((path) => waitForFile(path)));

  blocker.exec("BEGIN IMMEDIATE");
  writeFileSync(goPath, "go");
  await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  blocker.exec("COMMIT");
  return Promise.all(children.map(collect));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function checkConflictMigration(tempRoot: string) {
  const dbPath = join(tempRoot, "legacy-conflict.db");
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE "Client" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "fullName" TEXT NOT NULL, "phone" TEXT, "telegram" TEXT, "email" TEXT,
      "status" TEXT NOT NULL DEFAULT 'new',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO "Client" ("fullName", "phone") VALUES ('Первый', '+7 999 123-45-67');
    INSERT INTO "Client" ("fullName", "phone") VALUES ('Второй', '8 (999) 123 45 67');
  `);
  legacy.close();

  const setup = spawnSync(tsxPath, [resolve(root, "scripts/local/setup-db.ts")], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, LOCAL_DATABASE_PATH: dbPath, LOCAL_KEEP_DATA: "1" },
  });
  const output = `${setup.stdout}\n${setup.stderr}`;
  assert(setup.status !== 0, "Migration with normalized duplicates unexpectedly succeeded");
  assert(output.includes("Миграция остановлена"), "Migration did not explain normalized duplicate conflict");

  const after = new Database(dbPath, { readonly: true });
  const rows = Number(after.prepare('SELECT COUNT(*) AS count FROM "Client"').get().count);
  const columns = after.prepare('PRAGMA table_info("Client")').all() as Array<{ name: string }>;
  after.close();
  assert(rows === 2, "Conflict migration changed legacy rows");
  assert(!columns.some((column) => column.name === "phoneNormalized"), "Conflict migration was not rolled back");
}

async function main() {
  const tempRoot = mkdtempSync(join(tmpdir(), "anya-crm-concurrency-"));
  try {
    checkConflictMigration(tempRoot);
    const dbPath = join(tempRoot, "concurrency.db");
    runSetup(dbPath);
    const blocker = new Database(dbPath, { timeout: 5_000 });
    blocker.pragma("journal_mode = WAL");
    blocker.pragma("foreign_keys = ON");

    const duplicateWaveDir = join(tempRoot, "wave-duplicate");
    const versionWaveDir = join(tempRoot, "wave-version");
    const parallelWaveDir = join(tempRoot, "wave-parallel");
    const receiptWaveDir = join(tempRoot, "wave-receipt");
    for (const path of [duplicateWaveDir, versionWaveDir, parallelWaveDir, receiptWaveDir]) {
      require("node:fs").mkdirSync(path);
    }

    const duplicateResults = await runWave(
      dbPath,
      duplicateWaveDir,
      [{ kind: "create-duplicate", label: "A" }, { kind: "create-duplicate", label: "B" }],
      blocker,
    );
    assert(duplicateResults.filter((item) => item.outcome === "created").length === 1, "Duplicate: expected one insert");
    assert(duplicateResults.filter((item) => item.outcome === "rejected").length === 1, "Duplicate: expected one rejection");

    const inserted = blocker.prepare(`
      INSERT INTO "Client" ("fullName", "version", "createdAt", "updatedAt")
      VALUES (?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run("Версионный клиент");
    const versionClientId = Number(inserted.lastInsertRowid);
    const versionResults = await runWave(
      dbPath,
      versionWaveDir,
      [
        { kind: "update-version", clientId: versionClientId, version: 1, fullName: "Редактор один" },
        { kind: "update-version", clientId: versionClientId, version: 1, fullName: "Редактор два" },
      ],
      blocker,
    );
    assert(versionResults.filter((item) => item.count === 1).length === 1, "Version: expected one winner");
    assert(versionResults.filter((item) => item.count === 0).length === 1, "Version: expected one stale update");
    const versionRow = blocker.prepare('SELECT "version", "fullName" FROM "Client" WHERE "id" = ?').get(versionClientId);
    assert(Number(versionRow.version) === 2, "Version: final version must be 2");

    const independentTasks: WorkerTask[] = Array.from({ length: 6 }, (_, index) => ({
      kind: "create-independent",
      index,
    }));
    const independentResults = await runWave(dbPath, parallelWaveDir, independentTasks, blocker);
    assert(independentResults.every((item) => Number.isInteger(item.id)), "Parallel: an independent write failed");
    const independentCount = Number(blocker.prepare(`
      SELECT COUNT(*) AS count FROM "Client" WHERE "emailNormalized" LIKE 'parallel-%@example.test'
    `).get().count);
    assert(independentCount === independentTasks.length, "Parallel: not all independent writes persisted");

    const operationKey = "operation-concurrency-test-0001";
    const receiptResults = await runWave(
      dbPath,
      receiptWaveDir,
      [{ kind: "idempotent-flow", operationKey }, { kind: "idempotent-flow", operationKey }],
      blocker,
    );
    assert(new Set(receiptResults.map((item) => item.entityId)).size === 1, "Receipt: workers returned different entities");
    const flowCount = Number(blocker.prepare(`SELECT COUNT(*) AS count FROM "Flow" WHERE "title" = 'Поток без дубля'`).get().count);
    assert(flowCount === 1, "Receipt: double submit created more than one flow");

    const fkDir = join(tempRoot, "wave-fk");
    require("node:fs").mkdirSync(fkDir);
    const [fkResult] = await runWave(dbPath, fkDir, [{ kind: "invalid-fk" }], blocker);
    assert(fkResult.rejected === true, "Foreign key: invalid Prisma write was accepted");
    assert(Number(blocker.pragma("foreign_keys", { simple: true })) === 1, "Foreign keys disabled on verification connection");
    assert(String(blocker.pragma("integrity_check", { simple: true })) === "ok", "SQLite integrity_check failed");
    assert((blocker.pragma("foreign_key_check") as unknown[]).length === 0, "SQLite foreign_key_check failed");
    assert(String(blocker.pragma("journal_mode", { simple: true })).toLowerCase() === "wal", "SQLite WAL is not enabled");
    blocker.close();

    console.log(JSON.stringify({
      ok: true,
      checks: {
        conflictMigrationRollback: true,
        atomicNormalizedDuplicate: true,
        optimisticConcurrency: true,
        parallelIndependentWrites: independentCount,
        mutationReceiptIdempotency: true,
        prismaForeignKeyRejection: true,
        integrity: "ok",
        journalMode: "wal",
      },
    }, null, 2));
  } finally {
    if (tempRoot.startsWith(join(tmpdir(), "anya-crm-concurrency-"))) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

const entry = process.argv[2] === "--worker" ? workerMain : main;
// A pending Promise alone does not keep Node alive between worker waves. Keep
// one harmless handle until the complete multi-process scenario has settled.
const keepAlive = setInterval(() => undefined, 1_000);
void entry()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => clearInterval(keepAlive));
