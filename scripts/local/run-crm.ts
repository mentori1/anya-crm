import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

// Local CRM files can contain real client data. New databases, WAL files,
// backups and secrets must be readable only by the current macOS user.
process.umask(0o077);

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

const root = process.cwd();
const databaseUrl = "file:./anya-crm-local.db";
const prepareEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  LOCAL_KEEP_DATA: "1",
};

execFileSync(
  resolve(root, "node_modules/.bin/tsx"),
  [resolve(root, "scripts/local/setup-db.ts")],
  { stdio: "inherit", env: prepareEnv },
);

type StoredSecrets = { authSecret?: string; clientAuthSecret?: string };
const localDir = resolve(root, "prisma/.local");
const secretsPath = resolve(localDir, "auth-secrets.json");
mkdirSync(localDir, { recursive: true });
chmodSync(localDir, 0o700);
let stored: StoredSecrets = {};
if (existsSync(secretsPath)) {
  try {
    stored = JSON.parse(readFileSync(secretsPath, "utf8")) as StoredSecrets;
  } catch {
    throw new Error("Не удалось прочитать prisma/.local/auth-secrets.json. Исправь файл, чтобы не потерять доступ к кабинетам.");
  }
}

const configuredAuthSecret = process.env.AUTH_SECRET?.trim();
const configuredClientSecret = process.env.CLIENT_AUTH_SECRET?.trim();
const generatedAuthSecret = stored.authSecret?.trim() || randomBytes(32).toString("base64url");
const generatedClientSecret = stored.clientAuthSecret?.trim() || randomBytes(32).toString("base64url");
if (!configuredAuthSecret || !configuredClientSecret) {
  writeFileSync(
    secretsPath,
    JSON.stringify(
      {
        authSecret: configuredAuthSecret ? stored.authSecret : generatedAuthSecret,
        clientAuthSecret: configuredClientSecret ? stored.clientAuthSecret : generatedClientSecret,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  chmodSync(secretsPath, 0o600);
}

const child = spawn(
  process.execPath,
  [resolve("node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", "3002"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      LOCAL_AUTH_BYPASS: "1",
      AUTH_SECRET: configuredAuthSecret || generatedAuthSecret,
      CLIENT_AUTH_SECRET: configuredClientSecret || generatedClientSecret,
      NEXT_PUBLIC_APP_NAME: "АНЯ · CRM",
      NEXT_DIST_DIR: ".next-dev",
    },
  },
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
