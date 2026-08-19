"use client";

import { useActionState } from "react";
import { clientLogin, type ClientLoginState } from "@/lib/client-portal-actions";

export function ClientLoginForm({ publicId }: { publicId: string }) {
  const [state, action, pending] = useActionState<ClientLoginState, FormData>(clientLogin, undefined);
  return (
    <form action={action} className="login-form">
      <input type="hidden" name="publicId" value={publicId} />
      <label><span>Код доступа</span><input name="pin" type="password" inputMode="numeric" pattern="[0-9]{6,8}" minLength={6} maxLength={8} autoComplete="one-time-code" required autoFocus /></label>
      {state?.error ? <p className="form-error">{state.error}</p> : null}
      <button className="button-primary" disabled={pending}>{pending ? "Открываю…" : "Открыть кабинет"}</button>
    </form>
  );
}
