/**
 * Canonical client identifiers used only for matching and unique indexes.
 * The original values remain untouched for display.
 */

function optional(value: string | null | undefined) {
  const normalized = value?.normalize("NFKC").trim();
  return normalized || null;
}

export function normalizeClientPhone(value: string | null | undefined) {
  const source = optional(value);
  if (!source) return null;

  let digits = source.replace(/\D/g, "");
  if (!digits) return null;

  // The CRM is Russia-first: 8XXXXXXXXXX, 7XXXXXXXXXX and a bare ten-digit
  // mobile number are the same identity. Other countries keep all digits.
  if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return `+${digits}`;
}

export function normalizeClientTelegram(value: string | null | undefined) {
  let source = optional(value)?.toLocaleLowerCase("en-US");
  if (!source) return null;

  source = source
    .replace(/^tg:\/\/resolve\?domain=/, "")
    .replace(/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\//, "")
    .replace(/^@+/, "");
  source = source.split(/[/?#&]/, 1)[0]?.trim() ?? "";
  return source || null;
}

export function normalizeClientEmail(value: string | null | undefined) {
  return optional(value)?.toLocaleLowerCase("en-US") ?? null;
}

export type ClientIdentityInput = {
  phone?: string | null;
  telegram?: string | null;
  email?: string | null;
};

export function normalizedClientIdentity(input: ClientIdentityInput) {
  return {
    phoneNormalized: normalizeClientPhone(input.phone),
    telegramNormalized: normalizeClientTelegram(input.telegram),
    emailNormalized: normalizeClientEmail(input.email),
  };
}
