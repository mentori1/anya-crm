export const clientStatusLabels: Record<string, string> = {
  new: "Новый",
  active: "В работе",
  paused: "Пауза",
  completed: "Завершил",
  upsell: "На допродажу",
  archived: "Архив",
};

export const flowStatusLabels: Record<string, string> = {
  draft: "Черновик",
  enrolling: "Набор",
  active: "Идёт",
  completed: "Завершён",
};

export function formatDate(value: Date | string | null | undefined) {
  if (!value) return "Не указано";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "Не указано";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function inputDate(value: Date | null | undefined) {
  if (!value) return "";
  const offset = value.getTimezoneOffset();
  return new Date(value.getTime() - offset * 60_000).toISOString().slice(0, 10);
}
