"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SyncRefresh } from "@/components/SyncRefresh";
import { logout } from "@/lib/auth-actions";

const navigation = [
  { href: "/", label: "Главная", mark: "⌂" },
  { href: "/clients", label: "Клиенты", mark: "◎" },
  { href: "/flows", label: "Потоки", mark: "◇" },
  { href: "/events", label: "Эфиры", mark: "◌" },
  { href: "/more", label: "Ещё", mark: "•••" },
];

function activeFor(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeIndex = Math.max(0, navigation.findIndex((item) => activeFor(pathname, item.href)));

  if (pathname === "/login" || pathname.startsWith("/cabinet")) return <>{children}</>;

  return (
    <div className="app-shell">
      <SyncRefresh />
      <aside className="side-nav">
        <Link className="brand" href="/" aria-label="На главную">
          <span className="brand-mark">А</span>
          <span><strong>АНЯ</strong><small>рабочая CRM</small></span>
        </Link>
        <nav aria-label="Основное меню">
          {navigation.map((item) => (
            <Link className={activeFor(pathname, item.href) ? "active" : ""} href={item.href} key={item.href}>
              <span className="side-mark">{item.mark}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="local-pill"><i /> Локальная база</div>
      </aside>

      <div className="workspace">
        <header className="workspace-bar">
          <div>
            <span className="eyebrow">Пространство Ани</span>
            <strong>Управление сопровождением</strong>
          </div>
          <div className="workspace-account">
            <span className="owner-avatar" aria-hidden="true">А</span>
            <form action={logout}>
              <button className="workspace-logout" type="submit">Выйти</button>
            </form>
          </div>
        </header>
        <main className="workspace-content">{children}</main>
      </div>

      <nav className="liquid-nav" aria-label="Меню на телефоне">
        <span className="liquid-lens" style={{ transform: `translateX(${activeIndex * 100}%)` }} />
        {navigation.map((item) => (
          <Link
            className={activeFor(pathname, item.href) ? "active" : ""}
            href={item.href}
            key={item.href}
            aria-current={activeFor(pathname, item.href) ? "page" : undefined}
          >
            <span className="nav-mark">{item.mark}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
