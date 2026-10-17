// Tiện ích đề nghị thanh toán: đọc số tiền người dùng gõ, cộng tổng chính xác (theo xu), định dạng hiển thị.
// BE nhận số tiền dạng chuỗi "1250000" / "18500.5" (tối đa 2 chữ số thập phân, > 0).

export type PaymentCurrency = "VND" | "USD";

const MAX_INTEGER_DIGITS = 16;

/**
 * Đọc số tiền người dùng gõ thành chuỗi chuẩn cho BE; không hợp lệ hoặc <= 0 thì null.
 * VND: bỏ dấu ngăn cách nghìn ("1.250.000", "1,250,000" → "1250000"), không nhận phần lẻ.
 * USD: dấu phẩy là ngăn cách nghìn, dấu chấm là phần thập phân ("18,500.50" → "18500.50").
 */
export function parseAmountInput(value: string, currency: PaymentCurrency): string | null {
  const raw = String(value ?? "").replace(/\s+/g, "");
  if (!raw) return null;
  let normalized: string;
  if (currency === "VND") {
    if (!/^\d{1,3}([.,]\d{3})*$|^\d+$/.test(raw)) return null;
    normalized = raw.replace(/[.,]/g, "");
  } else {
    if (!/^(\d{1,3}(,\d{3})*|\d+)(\.\d{1,2})?$/.test(raw)) return null;
    normalized = raw.replace(/,/g, "");
  }
  normalized = normalized.replace(/^0+(?=\d)/, "");
  const [integer] = normalized.split(".");
  if (integer.length > MAX_INTEGER_DIGITS) return null;
  return amountToCents(normalized) > BigInt(0) ? normalized : null;
}

/**
 * Đọc số tiền khi CHƯA biết loại tiền (tab Chi phí, bước nhập chi phí của đề nghị — loại tiền chọn ở bước cuối).
 * Chỉ một loại dấu: nhóm 3 chữ số đều đặn là dấu nghìn ("1.250.000", "1,250,000"), còn lại là phần lẻ ("18500,5", "18500.50").
 * Có cả hai dấu: dấu đứng sau cùng là phần lẻ ("18.500,50" / "18,500.50"). Không hợp lệ hoặc <= 0 → null.
 */
export function parseAmountLoose(value: string): string | null {
  const raw = String(value ?? "").replace(/\s+/g, "");
  if (!raw || !/^[\d.,]+$/.test(raw)) return null;
  let normalized: string;
  const lastDot = raw.lastIndexOf(".");
  const lastComma = raw.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    const [integer, fraction, ...rest] = raw.split(decimal);
    if (rest.length || !/^\d{1,3}(\d{3})*$/.test(integer.split(thousands).join("")) || !/^\d{1,3}([.,]\d{3})*$/.test(integer)) return null;
    normalized = `${integer.split(thousands).join("")}.${fraction}`;
  } else {
    const separator = lastDot >= 0 ? "." : lastComma >= 0 ? "," : "";
    if (!separator) normalized = raw;
    else if (new RegExp(`^\\d{1,3}(\\${separator}\\d{3})+$`).test(raw)) normalized = raw.split(separator).join("");
    else {
      const parts = raw.split(separator);
      if (parts.length !== 2) return null;
      normalized = `${parts[0]}.${parts[1]}`;
    }
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  normalized = normalized.replace(/^0+(?=\d)/, "");
  if (normalized.split(".")[0].length > MAX_INTEGER_DIGITS) return null;
  return amountToCents(normalized) > BigInt(0) ? normalized : null;
}

/** Số tiền không kèm loại tiền: "1250000.00" → "1.250.000"; "18500.5" → "18.500,50". */
export function formatAmount(value: string | number | null | undefined, language: "vi" | "en" = "vi"): string {
  const cents = amountToCents(typeof value === "number" ? value.toFixed(2) : value);
  const integerPart = new Intl.NumberFormat(language === "en" ? "en-US" : "vi-VN").format(cents / BigInt(100));
  const fraction = (cents % BigInt(100)).toString().padStart(2, "0");
  return fraction === "00" ? integerPart : `${integerPart}${language === "en" ? "." : ","}${fraction}`;
}

/** "18500.5" → 1850050n. Chuỗi không hợp lệ → 0n. */
export function amountToCents(value: string | number | null | undefined): bigint {
  const match = /^(\d+)(?:\.(\d{1,2})\d*)?$/.exec(String(value ?? "").trim());
  if (!match) return BigInt(0);
  return BigInt(match[1]) * BigInt(100) + BigInt((match[2] || "").padEnd(2, "0"));
}

/** Cộng các số tiền dạng chuỗi, không sai số dấu phẩy động. Trả chuỗi "1500000.00". */
export function sumAmounts(values: Array<string | null | undefined>): string {
  const cents = values.reduce((total, value) => total + amountToCents(value), BigInt(0));
  const integer = cents / BigInt(100);
  const fraction = (cents % BigInt(100)).toString().padStart(2, "0");
  return `${integer}.${fraction}`;
}

/** "5050000.00" + VND → "5.050.000 VND"; "18500.5" + USD → "18,500.50 USD" (theo ngôn ngữ giao diện). */
export function formatMoney(value: string | number | null | undefined, currency: string, language: "vi" | "en" = "vi"): string {
  const cents = amountToCents(typeof value === "number" ? value.toFixed(2) : value);
  const digits = currency === "USD" ? 2 : 0;
  const locale = language === "en" ? "en-US" : "vi-VN";
  const integerPart = new Intl.NumberFormat(locale).format(cents / BigInt(100));
  const fraction = (cents % BigInt(100)).toString().padStart(2, "0");
  const decimal = language === "en" ? "." : ",";
  const showFraction = digits > 0 || fraction !== "00";
  return `${integerPart}${showFraction ? `${decimal}${fraction}` : ""} ${currency}`.trim();
}

/** Số tiền đang gõ để hiển thị lại trong ô nhập khi sửa (BE trả "1250000.00"). */
export function amountForInput(value: string | null | undefined, currency: PaymentCurrency): string {
  const cents = amountToCents(value);
  if (cents === BigInt(0)) return "";
  const integer = (cents / BigInt(100)).toString();
  const fraction = (cents % BigInt(100)).toString().padStart(2, "0");
  if (currency === "VND" || fraction === "00") return integer;
  return `${integer}.${fraction}`;
}
