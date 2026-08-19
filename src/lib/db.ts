import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// Prisma 7: подключение к БД идёт через driver adapter.
// PostgreSQL (Supabase) — строка подключения в .env (DATABASE_URL).
// max: 1 — на serverless каждый инстанс держит максимум 1 коннект,
// иначе Supabase Session pooler (лимит 15) быстро исчерпывается.
// Локальная CRM должна оставаться рабочей и при прямом `next build`/`next dev`,
// когда DATABASE_URL не был подставлен обёрткой scripts/local/run-crm.ts.
// PostgreSQL выбираем только по явной postgres-ссылке, а не по отсутствию URL.
const databaseUrl = process.env.DATABASE_URL?.trim() || "file:./anya-crm-local.db";
export const usesPostgres = /^postgres(?:ql)?:\/\//i.test(databaseUrl);

class HardenedSqliteAdapter extends PrismaBetterSqlite3 {
  private async configure(
    connection: Awaited<ReturnType<InstanceType<typeof PrismaBetterSqlite3>["connect"]>>,
  ) {
    const raw = (sql: string) => connection.queryRaw({ sql, args: [], argTypes: [] });
    await raw("PRAGMA journal_mode = WAL");
    await raw("PRAGMA busy_timeout = 5000");
    await raw("PRAGMA synchronous = NORMAL");
    await raw("PRAGMA foreign_keys = ON");
    const result = await raw("PRAGMA foreign_keys");
    if (Number(result.rows[0]?.[0]) !== 1) {
      await connection.dispose();
      throw new Error("SQLite foreign_keys не удалось включить на соединении CRM");
    }
    return connection;
  }

  override async connect() {
    return this.configure(await super.connect());
  }

  override async connectToShadowDb() {
    return this.configure(await super.connectToShadowDb());
  }
}

const adapter = usesPostgres
  ? new PrismaPg({
      connectionString: databaseUrl,
      max: 1,
      idleTimeoutMillis: 10_000,
    })
  : new HardenedSqliteAdapter({ url: databaseUrl, timeout: 5_000 });

// Один экземпляр клиента на процесс (иначе в dev при hot-reload плодятся коннекты).
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

function transientSqliteLock(error: unknown) {
  const visited = new Set<unknown>();
  const parts: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (value === null || value === undefined || depth > 5 || visited.has(value)) return;
    if (typeof value === "string" || typeof value === "number") {
      parts.push(String(value));
      return;
    }
    if (typeof value !== "object") return;
    visited.add(value);
    const record = value as Record<string, unknown>;
    for (const key of [
      "name",
      "message",
      "code",
      "cause",
      "meta",
      "originalCode",
      "originalMessage",
      "originalError",
    ]) {
      visit(record[key], depth + 1);
    }
  };
  visit(error, 0);
  const description = parts.join(" ").toLocaleLowerCase("en-US");
  return (
    description.includes("sqlite_busy") ||
    description.includes("sqlite_locked") ||
    description.includes("database is locked") ||
    description.includes("database table is locked")
  );
}

/** Retry only SQLite's temporary writer-lock errors; validation, uniqueness,
 * foreign-key and application errors are returned immediately. */
export async function withTransientDbRetry<T>(
  operation: () => Promise<T>,
  options: { maxAttempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const maxAttempts = Math.max(1, Math.min(8, options.maxAttempts ?? 4));
  const baseDelayMs = Math.max(5, Math.min(1_000, options.baseDelayMs ?? 35));
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (usesPostgres || attempt >= maxAttempts || !transientSqliteLock(error)) throw error;
      const jitterMs = Math.floor(Math.random() * baseDelayMs);
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1) + jitterMs));
    }
  }
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
