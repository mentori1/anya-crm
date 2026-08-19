"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";

type FormState = { kind: "success" | "error"; message: string } | null;

export function PortalActionForm({
  action,
  children,
  className,
  successMessage = "Сохранено",
}: {
  action: (formData: FormData) => Promise<void>;
  children: ReactNode;
  className?: string;
  successMessage?: string;
}) {
  const [state, submit] = useActionState<FormState, FormData>(async (_previous, formData) => {
    try {
      await action(formData);
      return { kind: "success", message: successMessage };
    } catch (error) {
      return {
        kind: "error",
        message: error instanceof Error ? error.message : "Не получилось сохранить. Обнови страницу и попробуй ещё раз.",
      };
    }
  }, null);

  return (
    <form action={submit} className={className}>
      {children}
      {state ? <p className={`portal-form-message ${state.kind}`} role="status">{state.message}</p> : null}
    </form>
  );
}
