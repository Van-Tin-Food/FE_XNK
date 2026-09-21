const CURRENCY_TEXT = /\b(?:USD|VND|VNĐ|EUR|EURO|GBP|CNY|JPY)\b|[$€£¥]/gi;

/**
 * Database syntax: dot starts decimals; commas are tolerated only as thousands
 * separators from old/manual input and are removed before saving.
 */
export function parseInternationalNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value ?? "").replace(CURRENCY_TEXT, "").replace(/\s/g, "").trim();
  if (!raw) return null;
  const valid = /^-?\d[\d,]*(?:\.\d+)?$/.test(raw);
  if (!valid) return null;
  const parsed = Number(raw.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function toDatabaseNumber(value: unknown): number | null {
  return parseInternationalNumber(value);
}

export function getCurrencyText(value: unknown): string {
  const match = String(value ?? "").match(CURRENCY_TEXT);
  return match?.[0]?.trim() || "";
}

function formatPlainNumber(value: unknown, fractionDigits?: number, maximumFractionDigits = 4): string {
  if (value == null || String(value).trim() === "") return "";
  const parsed = parseInternationalNumber(value);
  if (parsed == null) return String(value);
  if (fractionDigits != null) return parsed.toFixed(fractionDigits);
  return Number(parsed.toFixed(maximumFractionDigits)).toString();
}

export function formatInternationalNumber(value: unknown, maximumFractionDigits = 4): string {
  return formatPlainNumber(value, undefined, maximumFractionDigits);
}

export function parsePackageCount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value ?? "").replace(/\s/g, "").trim();
  if (!raw) return null;
  if (/^-?\d{1,3}(?:[.,]\d{3})+$/.test(raw)) return Number(raw.replace(/[.,]/g, ""));
  const parsed = parseInternationalNumber(raw);
  return parsed == null ? null : parsed;
}

export function toDatabasePackageCount(value: unknown): number | null {
  const parsed = parsePackageCount(value);
  return parsed == null ? null : Math.round(parsed);
}

export function formatPackageCount(value: unknown): string {
  const parsed = parsePackageCount(value);
  return parsed == null ? String(value ?? "") : String(Math.round(parsed));
}

export function formatNetWeight(value: unknown): string {
  return formatPlainNumber(value, 2);
}

export function formatMoneyAmount(value: unknown): string {
  const amount = formatPlainNumber(value, 2);
  if (!amount) return amount;
  const currency = getCurrencyText(value);
  return currency ? `${amount} ${currency}` : amount;
}
