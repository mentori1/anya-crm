"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/lib/auth-actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, undefined);
  return (
    <form action={action} className="login-form">
      <label>
        <span>Пароль</span>
        <input name="password" type="password" autoComplete="current-password" autoFocus required />
      </label>
      {state?.error ? <p className="form-error">{state.error}</p> : null}
      <button className="button-primary" disabled={pending}>{pending ? "Открываю…" : "Войти"}</button>
    </form>
  );
}
