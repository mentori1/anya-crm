"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Avatar } from "@/components/Avatar";
import { clientLogout } from "@/lib/client-portal-actions";

const navigation = [
  { href: "/cabinet", label: "Главная", mark: "⌂" },
  { href: "/cabinet/plan", label: "План", mark: "✓" },
  { href: "/cabinet/results", label: "Отчёты", mark: "↗" },
  { href: "/cabinet/materials", label: "Материалы", mark: "◇" },
  { href: "/cabinet/events", label: "Эфиры", mark: "◌" },
];

function isActive(pathname: string, href: string) {
  return href === "/cabinet" ? pathname === href : pathname.startsWith(href);
}

export function ClientPortalShell({
  client,
  children,
}: {
  client: { fullName: string; photoSrc: string | null } | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  if (pathname === "/cabinet/login" || !client) return <>{children}</>;

  const activeIndex = Math.max(0, navigation.findIndex((item) => isActive(pathname, item.href)));

  return (
    <main className="client-portal">
      <header className="client-portal-header">
        <Link className="client-portal-brand" href="/cabinet" aria-label="На главную кабинета">
          <span className="brand-mark">А</span>
          <span><strong>Пространство роста</strong><small>вместе с Аней</small></span>
        </Link>
        <div className="portal-header-person">
          <Avatar name={client.fullName} src={client.photoSrc} size={36} />
          <form action={clientLogout}><button className="portal-logout">Выйти</button></form>
        </div>
      </header>

      <div className="client-portal-content">{children}</div>

      <nav className="portal-liquid-nav" aria-label="Навигация личного кабинета">
        <span className="portal-liquid-lens" style={{ transform: `translateX(${activeIndex * 100}%)` }} />
        {navigation.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link className={active ? "active" : ""} href={item.href} key={item.href} aria-current={active ? "page" : undefined}>
              <span>{item.mark}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </main>
  );
}
