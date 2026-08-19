"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, sessionToken, timingSafeEqual } from "@/lib/auth";

export type LoginState = { error?: string } | undefined;

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");
  const expected = process.env.APP_PASSWORD ?? "";

  if (!expected) {
    return { error: "Пароль не настроен на сервере (APP_PASSWORD)." };
  }
  if (!timingSafeEqual(password, expected)) {
    return { error: "Неверный пароль" };
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 год — запоминаем устройство
  });
  redirect("/");
}

export async function logout() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
