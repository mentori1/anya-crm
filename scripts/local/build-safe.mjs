import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The production compiler imports server modules. Giving it the live SQLite
// file while the dev server is running can disturb that database's WAL files.
// Build against a disposable empty SQLite file instead; dynamic CRM routes do
// not read business data during compilation.
const root = process.cwd();
const buildDir = mkdtempSync(join(tmpdir(), "anya-crm-build-"));
const buildDatabase = join(buildDir, "build.db");
const buildSecret = randomBytes(32).toString("base64url");

try {
  execFileSync(
    process.execPath,
    [resolve(root, "node_modules/next/dist/bin/next"), "build"],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: `file:${buildDatabase}`,
        LOCAL_AUTH_BYPASS: "0",
        AUTH_SECRET: process.env.AUTH_SECRET?.trim() || buildSecret,
        CLIENT_AUTH_SECRET: process.env.CLIENT_AUTH_SECRET?.trim() || buildSecret,
        NEXT_DIST_DIR: ".next",
      },
    },
  );
} finally {
  rmSync(buildDir, { recursive: true, force: true });
}
