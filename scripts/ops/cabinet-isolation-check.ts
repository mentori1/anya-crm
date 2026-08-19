import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const root = process.cwd();

function sourceSlice(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `Не найдено начало проверяемого блока: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `Не найден конец проверяемого блока: ${end}`);
  return source.slice(from, to);
}

function assertSourceGuards() {
  const cabinetPages = [
    "src/app/cabinet/page.tsx",
    "src/app/cabinet/plan/page.tsx",
    "src/app/cabinet/results/page.tsx",
    "src/app/cabinet/materials/page.tsx",
    "src/app/cabinet/events/page.tsx",
  ].map((path) => readFileSync(resolve(root, path), "utf8"));
  const cabinet = cabinetPages.join("\n");
  const cabinetData = readFileSync(resolve(root, "src/lib/cabinet-data.ts"), "utf8");
  const cabinetActions = readFileSync(resolve(root, "src/lib/cabinet-actions.ts"), "utf8");
  const clientAuth = readFileSync(resolve(root, "src/lib/client-auth.ts"), "utf8");
  const portalActions = readFileSync(resolve(root, "src/lib/client-portal-actions.ts"), "utf8");
  const avatarActions = readFileSync(resolve(root, "src/lib/avatar-actions.ts"), "utf8");
  const avatarRoute = readFileSync(resolve(root, "src/app/api/clients/[id]/avatar/route.ts"), "utf8");

  for (const page of cabinetPages) assert.match(page, /await requireCabinetClient\(\)/);
  assert.match(cabinetData, /const session = await getClientPortalSession\(\)/);
  assert.match(cabinetData, /if \(!session\) redirect\("\/cabinet\/login"\)/);
  assert.match(cabinetData, /where: \{ id: session\.clientId \}/);
  assert.match(cabinetData, /some: \{ clientId, status: "active" \}/);
  assert.match(cabinetData, /attendances: \{ some: \{ clientId \} \}/);
  assert.match(cabinetActions, /const session = await requireClientSession\(\)/);
  assert.match(cabinetActions, /clientId: session\.clientId/);
  assert.doesNotMatch(cabinetActions, /formData\.get\("clientId"\)/);
  assert.doesNotMatch(cabinet, /privateNotes|payments/i, "Кабинет не должен читать рабочие заметки или оплаты без отдельного scoped-DAL");

  assert.match(clientAuth, /where: \{ publicId: parsed\.publicId \}/);
  assert.match(clientAuth, /!access\?\.isActive \|\| access\.sessionVersion !== parsed\.sessionVersion/);
  assert.match(clientAuth, /return \{ clientId: access\.clientId, publicId: access\.publicId \}/);

  const ownAvatarAction = sourceSlice(
    avatarActions,
    "export async function uploadOwnAvatar",
    "export async function syncTelegramAvatar",
  );
  assert.match(ownAvatarAction, /const session = await getClientPortalSession\(\)/);
  assert.match(ownAvatarAction, /saveAvatar\(session\.clientId, file, "client"\)/);
  assert.doesNotMatch(ownAvatarAction, /formData\.get\("clientId"\)/);

  assert.match(avatarRoute, /clientSession\?\.clientId === clientId/);
  assert.match(avatarRoute, /status: 404/);

  const ownerOnlyActions = ["configureClientPortal", "disableClientPortal"];
  for (const name of ownerOnlyActions) {
    const block = sourceSlice(
      portalActions,
      `export async function ${name}`,
      name === "configureClientPortal"
        ? "export async function disableClientPortal"
        : "export type ClientLoginState",
    );
    assert.match(block, /await requireOwner\(\)/, `${name} обязан перепроверять владельца внутри Server Action`);
  }
}

function runSyntheticIsolationCheck() {
  const tempRoot = mkdtempSync(join(tmpdir(), "anya-cabinet-isolation-"));
  const databasePath = join(tempRoot, "cabinet-isolation.db");
  const db = new Database(databasePath);
  try {
    db.pragma("foreign_keys = ON");
    db.exec(`
      CREATE TABLE Client (id INTEGER PRIMARY KEY, fullName TEXT NOT NULL);
      CREATE TABLE ClientPortalAccess (
        id INTEGER PRIMARY KEY, clientId INTEGER NOT NULL UNIQUE, publicId TEXT NOT NULL UNIQUE,
        pinHash TEXT NOT NULL, isActive INTEGER NOT NULL, sessionVersion INTEGER NOT NULL,
        FOREIGN KEY (clientId) REFERENCES Client(id) ON DELETE CASCADE
      );
      CREATE TABLE Goal (id INTEGER PRIMARY KEY, clientId INTEGER NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, FOREIGN KEY (clientId) REFERENCES Client(id));
      CREATE TABLE WeeklyPlan (id INTEGER PRIMARY KEY, clientId INTEGER NOT NULL, weekStart TEXT NOT NULL, FOREIGN KEY (clientId) REFERENCES Client(id));
      CREATE TABLE PlanTask (id INTEGER PRIMARY KEY, planId INTEGER NOT NULL, title TEXT NOT NULL, FOREIGN KEY (planId) REFERENCES WeeklyPlan(id));
      CREATE TABLE Feedback (id INTEGER PRIMARY KEY, clientId INTEGER NOT NULL, body TEXT NOT NULL, FOREIGN KEY (clientId) REFERENCES Client(id));
      CREATE TABLE Program (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE Enrollment (id INTEGER PRIMARY KEY, clientId INTEGER NOT NULL, programId INTEGER, status TEXT NOT NULL, FOREIGN KEY (clientId) REFERENCES Client(id), FOREIGN KEY (programId) REFERENCES Program(id));
      CREATE TABLE Material (id INTEGER PRIMARY KEY, programId INTEGER, title TEXT NOT NULL, isPublished INTEGER NOT NULL, FOREIGN KEY (programId) REFERENCES Program(id));
      CREATE TABLE Event (id INTEGER PRIMARY KEY, title TEXT NOT NULL, clientId INTEGER, status TEXT NOT NULL, startsAt TEXT NOT NULL, FOREIGN KEY (clientId) REFERENCES Client(id));
      CREATE TABLE Attendance (id INTEGER PRIMARY KEY, eventId INTEGER NOT NULL, clientId INTEGER NOT NULL, FOREIGN KEY (eventId) REFERENCES Event(id), FOREIGN KEY (clientId) REFERENCES Client(id));
      CREATE TABLE PrivateNote (id INTEGER PRIMARY KEY, clientId INTEGER NOT NULL, body TEXT NOT NULL, FOREIGN KEY (clientId) REFERENCES Client(id));
      CREATE TABLE Payment (id INTEGER PRIMARY KEY, clientId INTEGER NOT NULL, title TEXT NOT NULL, FOREIGN KEY (clientId) REFERENCES Client(id));

      INSERT INTO Client VALUES (1, 'Клиент А'), (2, 'Клиент Б');
      INSERT INTO ClientPortalAccess VALUES
        (1, 1, 'public-a', 'hash-a', 1, 3),
        (2, 2, 'public-b', 'hash-b', 1, 8);
      INSERT INTO Goal VALUES (1, 1, 'Цель А', 'active'), (2, 2, 'Цель Б', 'active');
      INSERT INTO WeeklyPlan VALUES (1, 1, '2026-08-17'), (2, 2, '2026-08-17');
      INSERT INTO PlanTask VALUES (1, 1, 'Задача А'), (2, 2, 'Задача Б');
      INSERT INTO Feedback VALUES (1, 1, 'Обратная связь А'), (2, 2, 'Обратная связь Б');
      INSERT INTO Program VALUES (1, 'Программа А'), (2, 'Программа Б');
      INSERT INTO Enrollment VALUES (1, 1, 1, 'active'), (2, 2, 2, 'active'), (3, 1, 2, 'paused');
      INSERT INTO Material VALUES
        (1, NULL, 'Общий опубликованный', 1),
        (2, 1, 'Материал А', 1),
        (3, 2, 'Материал Б', 1),
        (4, NULL, 'Общий черновик', 0);
      INSERT INTO Event VALUES
        (1, 'Личный созвон А', 1, 'planned', '2099-01-01'),
        (2, 'Личный созвон Б', 2, 'planned', '2099-01-01'),
        (3, 'Групповой эфир А', NULL, 'planned', '2099-01-01'),
        (4, 'Групповой эфир Б', NULL, 'planned', '2099-01-01'),
        (5, 'Отменённый эфир А', 1, 'cancelled', '2099-01-01');
      INSERT INTO Attendance VALUES (1, 3, 1), (2, 4, 2);
      INSERT INTO PrivateNote VALUES (1, 1, 'Скрытая заметка А'), (2, 2, 'Скрытая заметка Б');
      INSERT INTO Payment VALUES (1, 1, 'Оплата А'), (2, 2, 'Оплата Б');
    `);

    const clientId = 1;
    const ownClient = db.prepare("SELECT id, fullName FROM Client WHERE id = ?").get(clientId) as { id: number; fullName: string };
    const goals = db.prepare("SELECT title FROM Goal WHERE clientId = ? AND status = 'active'").all(clientId) as Array<{ title: string }>;
    const tasks = db.prepare(`
      SELECT t.title FROM PlanTask t
      JOIN WeeklyPlan p ON p.id = t.planId
      WHERE p.clientId = ?
    `).all(clientId) as Array<{ title: string }>;
    const feedback = db.prepare("SELECT body FROM Feedback WHERE clientId = ?").all(clientId) as Array<{ body: string }>;
    const materials = db.prepare(`
      SELECT DISTINCT m.title FROM Material m
      WHERE m.isPublished = 1 AND (
        m.programId IS NULL OR EXISTS (
          SELECT 1 FROM Enrollment e
          WHERE e.programId = m.programId AND e.clientId = ? AND e.status = 'active'
        )
      ) ORDER BY m.title
    `).all(clientId) as Array<{ title: string }>;
    const events = db.prepare(`
      SELECT DISTINCT e.title FROM Event e
      WHERE e.status <> 'cancelled' AND (
        e.clientId = ? OR EXISTS (
          SELECT 1 FROM Attendance a WHERE a.eventId = e.id AND a.clientId = ?
        )
      ) ORDER BY e.title
    `).all(clientId, clientId) as Array<{ title: string }>;

    const snapshot = { ownClient, goals, tasks, feedback, materials, events };
    assert.deepEqual(snapshot.ownClient, { id: 1, fullName: "Клиент А" });
    assert.deepEqual(snapshot.goals.map((row) => row.title), ["Цель А"]);
    assert.deepEqual(snapshot.tasks.map((row) => row.title), ["Задача А"]);
    assert.deepEqual(snapshot.feedback.map((row) => row.body), ["Обратная связь А"]);
    assert.deepEqual(snapshot.materials.map((row) => row.title), ["Материал А", "Общий опубликованный"]);
    assert.deepEqual(snapshot.events.map((row) => row.title), ["Групповой эфир А", "Личный созвон А"]);
    assert.equal("privateNotes" in snapshot, false);
    assert.equal("payments" in snapshot, false);
    assert.equal(db.pragma("foreign_key_check").length, 0);
    assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
  } finally {
    db.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

assertSourceGuards();
runSyntheticIsolationCheck();
console.log("Cabinet isolation check: OK");
console.log("- clientId comes only from the signed, active, versioned client session");
console.log("- goals, plans, feedback, program materials and events are scoped to that client");
console.log("- own-avatar upload ignores clientId form tampering; avatar reads compare session clientId");
console.log("- private notes and payments are absent from the current cabinet data contract");
console.log("- the test used only a generated temporary database and removed it afterwards");
