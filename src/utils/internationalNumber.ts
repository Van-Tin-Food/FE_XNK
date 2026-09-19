const CURRENCY_TEXT = /\b(?:USD|VND|EUR|GBP|CNY|JPY)\b/gi;

/**
 * International number syntax: comma groups thousands and dot starts decimals.
 * Examples: 1,234.56; 1234.56; 1,234.
 */
export function parseInternationalNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value ?? "").replace(CURRENCY_TEXT, "").replace(/\s/g, "").trim();
  if (!raw) return null;
  const valid = /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw);
  if (!valid) return null;
  const parsed = Number(raw.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function toDatabaseNumber(value: unknown): number | null {
  return parseInternationalNumber(value);
}

export function formatInternationalNumber(value: unknown, maximumFractionDigits = 4): string {
  if (value == null || String(value).trim() === "") return "";
  const parsed = parseInternationalNumber(value);
  if (parsed == null) return String(value);
  return new Intl.NumberFormat("en-US", {
    useGrouping: true,
    maximumFractionDigits,
  }).format(parsed);
}
