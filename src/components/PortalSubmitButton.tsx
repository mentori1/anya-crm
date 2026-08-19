"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

export function PortalSubmitButton({
  children,
  pendingText = "Сохраняю…",
  className = "button-primary",
}: {
  children: ReactNode;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return <button className={className} disabled={pending}>{pending ? pendingText : children}</button>;
}
