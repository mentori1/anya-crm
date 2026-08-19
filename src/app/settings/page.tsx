import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import Link from "next/link";
import { logout } from "@/lib/auth-actions";
import { prisma } from "@/lib/db";
import { refreshSystemStatus } from "@/lib/settings-actions";
import { formatDateTime } from "@/lib/format";
import { telegramIsConfigured } from "@/lib/telegram-api";

export const dynamic = "force-dynamic";

type BackupInfo = {
  name: string;
  createdAt: Date;
  size: number;
  verification: "ok" | "mismatch" | "no-manifest" | "unreadable";
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function inspectBackups(): BackupInfo[] {
  const directory = resolve(process.cwd(), ".backups");
  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter((name) => name.endsWith(".db"))
    .map((name) => {
      const path = resolve(directory, name);
      try {
        const stat = statSync(path);
        const manifestPath = `${path}.json`;
        let verification: BackupInfo["verification"] = "no-manifest";
        if (existsSync(manifestPath)) {
          const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { sha256?: string };
          const actualHash = createHash("sha256").update(readFileSync(path)).digest("hex");
          verification = manifest.sha256 === actualHash ? "ok" : "mismatch";
        }
        return { name, createdAt: stat.mtime, size: stat.size, verification };
      } catch {
        return { name, createdAt: new Date(0), size: 0, verification: "unreadable" as const };
      }
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 12);
}

function inspectLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl.startsWith("file:")) {
    return { local: false, mode: "Внешняя база", file: "—", integrity: "Проверяется средствами сервера", foreignKeyIssues: null, journalMode: "Серверный" };
  }

  const databasePath = resolve(/* turbopackIgnore: true */ process.cwd(), databaseUrl.slice("file:".length));
  if (!existsSync(databasePath)) {
    return { local: true, mode: "Локальная база SQLite", file: basename(databasePath), integrity: "Файл не найден", foreignKeyIssues: null, journalMode: "—" };
  }

  try {
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3");
    const database = new Database(databasePath, { readonly: true, fileMustExist: true });
    const integrity = String(database.pragma("integrity_check", { simple: true }));
    const foreignKeyIssues = (database.pragma("foreign_key_check") as unknown[]).length;
    const journalMode = String(database.pragma("journal_mode", { simple: true })).toUpperCase();
    database.close();
    return { local: true, mode: "Локальная база SQLite", file: basename(databasePath), integrity, foreignKeyIssues, journalMode };
  } catch {
    return { local: true, mode: "Локальная база SQLite", file: basename(databasePath), integrity: "Проверка недоступна", foreignKeyIssues: null, journalMode: "—" };
  }
}

const verificationLabels: Record<BackupInfo["verification"], string> = {
  ok: "Контрольная сумма совпадает",
  mismatch: "Контрольная сумма не совпала",
  "no-manifest": "Нет файла проверки",
  unreadable: "Не удалось прочитать",
};

export default async function SettingsPage() {
  const [clients, flows, events, materials, payments, templates, auditLogs, linkedTelegram, notificationGroups, protectedOperations] = await Promise.all([
    prisma.client.count(),
    prisma.flow.count(),
    prisma.event.count(),
    prisma.material.count(),
    prisma.payment.count(),
    prisma.notificationTemplate.count(),
    prisma.auditLog.count(),
    prisma.client.count({ where: { telegramChatId: { not: null } } }),
    prisma.notification.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.mutationReceipt.count(),
  ]);
  const backups = inspectBackups();
  const database = inspectLocalDatabase();
  const isLocalBypass = process.env.LOCAL_AUTH_BYPASS === "1";
  const canLogout = Boolean(process.env.APP_PASSWORD) && !isLocalBypass;
  const telegramConfigured = telegramIsConfigured();
  const outbox = Object.fromEntries(notificationGroups.map((row) => [row.status, row._count._all]));

  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Система</p>
          <h1>Настройки</h1>
          <p>Фактическое состояние локальной CRM, базы и резервных копий.</p>
        </div>
        <div className="form-actions">
          <form action={refreshSystemStatus}><button className="button-secondary">Обновить проверку</button></form>
          {canLogout ? <form action={logout}><button className="button-primary">Выйти</button></form> : null}
        </div>
      </header>

      <div className="dashboard-grid">
        <section className="panel compact-panel">
          <div className="section-heading"><div><span className="section-kicker">Режим работы</span><h2>{database.mode}</h2></div><span className="status-badge status-active">{database.local ? "Локально" : "Внешнее подключение"}</span></div>
          <div className="client-numbers">
            <div><span>Файл базы</span><strong>{database.file}</strong></div>
            <div><span>Целостность</span><strong>{database.integrity === "ok" ? "Исправна" : database.integrity}</strong></div>
            <div><span>Ошибки связей</span><strong>{database.foreignKeyIssues ?? "—"}</strong></div>
            <div><span>Режим записи</span><strong>{database.journalMode}</strong></div>
            <div><span>Доступ</span><strong>{isLocalBypass ? "Без пароля" : "По паролю"}</strong></div>
          </div>
          <p className="stage-note">
            {database.local ? "Сейчас CRM работает на этом Mac. Параллельные записи и конфликты уже защищены, но для работы менеджеров с разных устройств нужны единый сервер, PostgreSQL и отдельные аккаунты." : "CRM работает с единой внешней базой."}
          </p>
        </section>

        <section className="panel compact-panel">
          <div className="section-heading"><div><span className="section-kicker">Данные</span><h2>Записи в базе</h2></div></div>
          <div className="client-numbers">
            <div><span>Клиенты</span><strong>{clients}</strong></div>
            <div><span>Потоки</span><strong>{flows}</strong></div>
            <div><span>События</span><strong>{events}</strong></div>
            <div><span>Материалы</span><strong>{materials}</strong></div>
            <div><span>Оплаты</span><strong>{payments}</strong></div>
            <div><span>Шаблоны</span><strong>{templates}</strong></div>
            <div><span>Записи истории</span><strong>{auditLogs}</strong></div>
            <div><span>Защищённые операции</span><strong>{protectedOperations}</strong></div>
          </div>
        </section>
      </div>

      <section className="panel compact-panel">
        <div className="section-heading">
          <div><span className="section-kicker">Автоматизация</span><h2>Telegram и очередь уведомлений</h2></div>
          <span className={`status-badge ${telegramConfigured ? "status-active" : "status-paused"}`}>{telegramConfigured ? "Бот подключён" : "Бот не подключён"}</span>
        </div>
        <div className="client-numbers">
          <div><span>Клиенты с Telegram</span><strong>{linkedTelegram}</strong></div>
          <div><span>В очереди</span><strong>{outbox.queued ?? 0}</strong></div>
          <div><span>Ждут привязки</span><strong>{outbox.waiting ?? 0}</strong></div>
          <div><span>Отправлено</span><strong>{outbox.sent ?? 0}</strong></div>
          <div><span>Ошибка</span><strong>{outbox.error ?? 0}</strong></div>
          <div><span>Нужна проверка</span><strong>{outbox.uncertain ?? 0}</strong></div>
        </div>
        <p className="stage-note">Очередь читает события и напоминания из CRM. Одно уведомление может забрать только один обработчик. Сомнительная сетевая отправка не повторяется автоматически, а попадает на ручную проверку.</p>
      </section>

      <section className="panel list-panel">
        <div className="section-heading">
          <div><span className="section-kicker">Хранение</span><h2>Резервные копии</h2></div>
          <span className="count-badge">{backups.length}</span>
        </div>
        {backups.length ? (
          <div className="notes-list">
            {backups.map((backup) => (
              <article key={backup.name}>
                <p>{backup.name}</p>
                <small>
                  {formatDateTime(backup.createdAt)} · {formatBytes(backup.size)} · {verificationLabels[backup.verification]}
                </small>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-inline">
            <span>◌</span><div><strong>Копий пока нет</strong><p>Страница ничего не создаёт и показывает только реальные файлы из папки .backups.</p></div>
          </div>
        )}
      </section>

      <Link href="/more" className="back-link">← Вернуться к инструментам</Link>
    </div>
  );
}
