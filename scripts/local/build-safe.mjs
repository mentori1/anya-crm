import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The production compiler imports server modules. Giving it the live SQLite
// file while the dev server is running can disturb that database's WAL files.
// Build against a disposable empty SQLite file instead; dynamic CRM routes do
// not read business data during compilation.
const root = process.cwd();
const buildSecret = randomBytes(32).toString("base64url");
const configuredDatabaseUrl = process.env.DATABASE_URL?.trim() || "";
const postgresBuild = /^postgres(?:ql)?:\/\//i.test(configuredDatabaseUrl);
const vercelBuild = process.env.VERCEL === "1";
const productionVercelBuild = vercelBuild && process.env.VERCEL_ENV === "production";
const initializeDemo = process.env.VERCEL_INITIALIZE_DEMO === "1";
const configuredAuthSecret = process.env.AUTH_SECRET?.trim() || "";
const configuredClientAuthSecret = process.env.CLIENT_AUTH_SECRET?.trim() || "";
const configuredAppPassword = process.env.APP_PASSWORD?.trim() || "";

if (vercelBuild && !postgresBuild) {
  throw new Error(
    "Vercel build requires a PostgreSQL DATABASE_URL. Connect the managed PostgreSQL resource before deploying.",
  );
}

if (vercelBuild) {
  const missingSecrets = [
    ["AUTH_SECRET", configuredAuthSecret],
    ["CLIENT_AUTH_SECRET", configuredClientAuthSecret],
    ["APP_PASSWORD", configuredAppPassword],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missingSecrets.length) {
    throw new Error(`Vercel build is missing required secrets: ${missingSecrets.join(", ")}.`);
  }
}

if (initializeDemo && !productionVercelBuild) {
  throw new Error("VERCEL_INITIALIZE_DEMO=1 is allowed only for a Vercel production build.");
}

// A clean npm install generates the PostgreSQL client from the main schema.
// Local builds need SQLite instead, so generate it from a disposable schema
// that points back to the ignored generated-client directory. No working DB or
// WAL file is opened while the client is generated.
const mainSchemaPath = resolve(root, "prisma/schema.prisma");
const generatedClientDir = resolve(root, "src/generated/prisma");
const generatedClientPath = resolve(root, "src/generated/prisma/internal/class.ts");
const prismaCli = resolve(root, "node_modules/prisma/build/index.js");
const buildDir = postgresBuild ? null : mkdtempSync(join(tmpdir(), "anya-crm-build-"));
const buildDatabase = buildDir ? join(buildDir, "build.db") : null;
const buildDatabaseUrl = postgresBuild ? configuredDatabaseUrl : `file:${buildDatabase}`;
const buildEnvironment = {
  ...process.env,
  DATABASE_URL: buildDatabaseUrl,
  LOCAL_AUTH_BYPASS: "0",
  AUTH_SECRET: configuredAuthSecret || buildSecret,
  CLIENT_AUTH_SECRET: configuredClientAuthSecret || buildSecret,
  ...(configuredAppPassword ? { APP_PASSWORD: configuredAppPassword } : {}),
  NEXT_DIST_DIR: ".next",
};

function runPrisma(args) {
  execFileSync(process.execPath, [prismaCli, ...args], {
    cwd: root,
    stdio: "inherit",
    env: buildEnvironment,
  });
}

function generateMatchingClient() {
  let buildSchemaPath = mainSchemaPath;
  if (!postgresBuild) {
    if (!buildDir) throw new Error("Temporary build directory is unavailable.");
    buildSchemaPath = join(buildDir, "schema.prisma");
    const sqliteSchema = readFileSync(mainSchemaPath, "utf8")
      .replace('provider = "postgresql"', 'provider = "sqlite"')
      .replace(
        /output\s*=\s*"\.\.\/src\/generated\/prisma"/,
        `output = ${JSON.stringify(generatedClientDir)}`,
      );
    writeFileSync(buildSchemaPath, sqliteSchema, { mode: 0o600 });
  }

  runPrisma(["generate", "--schema", buildSchemaPath]);

  if (!existsSync(generatedClientPath)) {
    throw new Error("Prisma Client generation did not create the expected output.");
  }
  const generatedClient = readFileSync(generatedClientPath, "utf8");
  const providerMatch = generatedClient.match(/["']activeProvider["']\s*:\s*["']([^"']+)["']/);
  const expectedProvider = postgresBuild ? "postgresql" : "sqlite";
  if (!providerMatch || providerMatch[1] !== expectedProvider) {
    throw new Error(
      `Prisma Client generation did not produce the required ${expectedProvider} provider.`,
    );
  }
}

try {
  generateMatchingClient();

  if (productionVercelBuild) {
    runPrisma(["migrate", "deploy", "--schema", mainSchemaPath]);
    if (initializeDemo) {
      const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
      execFileSync(npmCommand, ["run", "db:seed"], {
        cwd: root,
        stdio: "inherit",
        env: buildEnvironment,
      });
      execFileSync(npmCommand, ["run", "local:fill-demo"], {
        cwd: root,
        stdio: "inherit",
        env: buildEnvironment,
      });
    }
  }

  execFileSync(
    process.execPath,
    [resolve(root, "node_modules/next/dist/bin/next"), "build"],
    {
      cwd: root,
      stdio: "inherit",
      env: buildEnvironment,
    },
  );
} finally {
  if (buildDir) rmSync(buildDir, { recursive: true, force: true });
}
