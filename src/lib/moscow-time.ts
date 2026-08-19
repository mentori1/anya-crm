const MOSCOW_UTC_OFFSET_HOURS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function moscowCalendarParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const valueFor = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: valueFor("year"),
    month: valueFor("month"),
    day: valueFor("day"),
  };
}

/** The stored instant that represents 00:00 of the Moscow calendar day. */
export function moscowDayStart(value = new Date()) {
  const { year, month, day } = moscowCalendarParts(value);
  return new Date(Date.UTC(year, month - 1, day, -MOSCOW_UTC_OFFSET_HOURS));
}

/** Monday 00:00 through the next Monday 00:00 in Moscow time. */
export function moscowWeekBounds(value = new Date()) {
  const today = moscowDayStart(value);
  const wallClock = new Date(today.getTime() + MOSCOW_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  const weekday = wallClock.getUTCDay() || 7;
  const start = new Date(today.getTime() - (weekday - 1) * DAY_MS);
  const nextStart = new Date(start.getTime() + 7 * DAY_MS);
  return { start, end: new Date(nextStart.getTime() - 1), nextStart };
}

export function formatMoscowDate(value: Date | string | null | undefined) {
  if (!value) return "Не указано";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long",
  }).format(new Date(value));
}

/**
 * `datetime-local` does not contain a time zone. Treat its value as Moscow time
 * explicitly so the stored instant does not depend on the server's TZ setting.
 */
export function parseMoscowDateTimeLocal(value: string | null | undefined) {
  if (!value) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0"] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  if (
    month < 1 || month > 12 || day < 1 || day > 31 ||
    hour < 0 || hour > 23 || minute < 0 || minute > 59 ||
    second < 0 || second > 59
  ) return null;

  const instant = new Date(Date.UTC(
    year,
    month - 1,
    day,
    hour - MOSCOW_UTC_OFFSET_HOURS,
    minute,
    second,
  ));
  const moscowWallClock = new Date(instant.getTime() + MOSCOW_UTC_OFFSET_HOURS * 60 * 60 * 1000);

  if (
    moscowWallClock.getUTCFullYear() !== year ||
    moscowWallClock.getUTCMonth() !== month - 1 ||
    moscowWallClock.getUTCDate() !== day ||
    moscowWallClock.getUTCHours() !== hour ||
    moscowWallClock.getUTCMinutes() !== minute ||
    moscowWallClock.getUTCSeconds() !== second
  ) return null;

  return instant;
}

export function formatMoscowDateTime(value: Date | string | null | undefined) {
  if (!value) return "Не указано";

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
