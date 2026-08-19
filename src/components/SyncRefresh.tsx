"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const INTERVAL_MS = 15_000;

function formHasLocalChanges(form: HTMLFormElement) {
  return Array.from(form.elements).some((element) => {
    if (element instanceof HTMLInputElement) {
      if (["hidden", "submit", "button", "file"].includes(element.type)) return false;
      if (element.type === "checkbox" || element.type === "radio") {
        return element.checked !== element.defaultChecked;
      }
      return element.value !== element.defaultValue;
    }
    if (element instanceof HTMLTextAreaElement) return element.value !== element.defaultValue;
    if (element instanceof HTMLSelectElement) {
      return Array.from(element.options).some((option) => option.selected !== option.defaultSelected);
    }
    return false;
  });
}

function refreshIsSafe() {
  const focused = document.activeElement;
  if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement || focused instanceof HTMLSelectElement) {
    return false;
  }
  return !Array.from(document.forms).some(formHasLocalChanges);
}

/**
 * Подтягивает свежие серверные данные для второй открытой вкладки/менеджера,
 * но никогда не перерисовывает страницу поверх заполненной формы.
 */
export function SyncRefresh() {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && refreshIsSafe()) router.refresh();
    };
    const timer = window.setInterval(refresh, INTERVAL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [router]);

  return null;
}
