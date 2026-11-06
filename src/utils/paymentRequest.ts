// Tiện ích đề nghị thanh toán: đọc số tiền người dùng gõ, cộng tổng chính xác (theo xu), định dạng hiển thị.
// BE nhận số tiền dạng chuỗi "1250000" / "18500.5" (tối đa 2 chữ số thập phân, > 0).

import type { PermissionFunction, PermissionLevel } from "@/config/shipmentActionPermissions";

export type PaymentCurrency = "VND" | "USD";

/**
 * Được mở danh sách / chi tiết đề nghị: có quyền đề nghị, hoặc được uỷ quyền duyệt / xác nhận chứng từ
 * (khớp requireAnyPermission của route GET /api/payment-requests ở BE).
 */
export function canOpenPaymentRequests(can: (fn: PermissionFunction, level?: PermissionLevel) => boolean): boolean {
  return can("paymentRequests") || can("paymentApprove", "edit") || can("paymentDocuments", "edit") || can("paymentRequestsOnBehalf", "edit");
}

/** Được tạo đề nghị: tự tạo (paymentRequests edit) hoặc được ủy quyền tạo thay (khớp route POST /api/payment-requests ở BE). */
export function canCreatePaymentRequests(can: (fn: PermissionFunction, level?: PermissionLevel) => boolean): boolean {
  return can("paymentRequests", "edit") || can("paymentRequestsOnBehalf", "edit");
}

const MAX_INTEGER_DIGITS = 16;

/**
 * Đọc số tiền người dùng gõ thành chuỗi chuẩn cho BE; không hợp lệ hoặc <= 0 thì null.
 * VND: bỏ dấu ngăn cách nghìn ("1.250.000", "1,250,000" → "1250000"), không nhận phần lẻ.
 * USD: dấu phẩy là ngăn cách nghìn, dấu chấm là phần thập phân ("18,500.50" → "18500.50").
 */
/** "VH · Phí internet": mã phí đứng trước tên khoản phí (cùng thứ tự với thẻ Google Chat). Thiếu phần nào thì bỏ phần đó. */
export function costCodeName(code: string | null | undefined, name: string | null | undefined): string {
  return [String(code || "").trim().toUpperCase(), String(name || "").trim()].filter(Boolean).join(" · ");
}

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

/**
 * Ô nhập số tiền tự chia nhóm nghìn khi gõ (kiểu Việt Nam, như formatAmount "vi"): "192802100" → "192.802.100", phần lẻ sau
 * dấu phẩy, tối đa 2 số ("18.500,5"). Dấu chấm trong ô là dấu nghìn do ô tự chèn; người dùng GÕ một dấu "." hoặc "," là bắt
 * đầu phần lẻ. Dán cả chuỗi thì đọc như parseAmountLoose ("18,500.50" → "18.500,50"). Kết quả đọc lại đúng bằng
 * parseAmountLoose (bỏ dấu phẩy cuối khi đang gõ dở: "18.500,").
 * caret: vị trí con trỏ trong next → trả vị trí tương ứng trong text (sau đúng số chữ số / dấu phẩy đã đứng trước nó).
 */
export function formatAmountTyping(next: string, previous = "", caret = next.length): { text: string; caret: number } {
  const value = String(next ?? "");
  const before = String(previous ?? "");
  // Dán (thêm nhiều ký tự một lúc, có dấu): đọc theo parseAmountLoose để hiểu đúng "18,500.50" / "1.250.000".
  if (value.length > before.length + 1 && /[.,]/.test(value)) {
    const pasted = parseAmountLoose(value);
    if (pasted) {
      const text = formatAmount(pasted, "vi");
      return { text, caret: text.length };
    }
  }
  // Vị trí (trong next) của dấu phần lẻ: gõ đúng một dấu "." / "," → dấu đó; còn lại → dấu phẩy đầu tiên (do ô đã tạo).
  let decimalAt = -1;
  if (value.length === before.length + 1) {
    let index = 0;
    while (index < before.length && value[index] === before[index]) index += 1;
    const typed = value[index];
    if ((typed === "." || typed === ",") && value.slice(0, index) + value.slice(index + 1) === before) {
      if (before.includes(",")) return { text: before, caret: index }; // đã có phần lẻ: bỏ dấu gõ thêm
      decimalAt = index;
    }
  }
  if (decimalAt < 0) decimalAt = value.indexOf(",");
  const digitsOf = (part: string) => part.replace(/\D/g, "");
  const integerRaw = digitsOf(decimalAt < 0 ? value : value.slice(0, decimalAt));
  const fraction = decimalAt < 0 ? "" : digitsOf(value.slice(decimalAt + 1)).slice(0, 2);
  const integer = integerRaw.replace(/^0+(?=\d)/, "") || (decimalAt < 0 ? "" : "0");
  const text = `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}${decimalAt < 0 ? "" : `,${fraction}`}`;
  // Con trỏ: đếm chữ số + dấu phần lẻ đứng trước nó trong next (bỏ số 0 đầu bị cắt), đặt sau đúng chừng ấy ký tự trong text.
  let wanted = 0;
  for (let index = 0; index < Math.min(caret, value.length); index += 1) {
    if (/\d/.test(value[index]) || index === decimalAt) wanted += 1;
  }
  const strippedZeros = integerRaw.length - integerRaw.replace(/^0+(?=\d)/, "").length;
  const addedZero = !integerRaw && decimalAt >= 0 && wanted > 0 ? 1 : 0; // ",5" → "0,5"
  wanted = Math.max(0, wanted - strippedZeros) + addedZero;
  let position = 0;
  for (let seen = 0; position < text.length && seen < wanted; position += 1) {
    if (text[position] !== ".") seen += 1;
  }
  return { text, caret: position };
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
export function amountForInput(value: string | null | undefined): string {
  const cents = amountToCents(value);
  if (cents === BigInt(0)) return "";
  const integer = (cents / BigInt(100)).toString();
  const fraction = (cents % BigInt(100)).toString().padStart(2, "0");
  // Giữ phần lẻ (cả VND, ví dụ tổng gồm VAT 2938755.60): cắt đi thì sửa xong lưu lại sẽ mất tiền lẻ.
  if (fraction === "00") return integer;
  return `${integer}.${fraction}`;
}

// ---------- VAT: số tiền lưu luôn là số ĐÃ GỒM VAT; % VAT lưu riêng (payment_cost.phan_tram_vat) ----------

/** "8", "8,5", "10%" → "8" / "8.5" / "10"; ngoài 0 - 100 hoặc quá 2 chữ số thập phân → null. Trống → null. */
export function parseVatInput(value: string): string | null {
  const raw = String(value ?? "").replace(/\s+/g, "").replace(/%$/, "").replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw) || Number(raw) > 100) return null;
  return String(Number(raw));
}

/** % VAT → phần vạn (8.5% → 850n). */
const vatBasis = (vat: string) => BigInt(Math.round(Number(vat) * 100));
/** Chia làm tròn nửa lên cho số không âm. */
const roundDiv = (a: bigint, b: bigint) => (a * BigInt(2) + b) / (b * BigInt(2));
const centsToAmount = (cents: bigint) => `${cents / BigInt(100)}.${(cents % BigInt(100)).toString().padStart(2, "0")}`;
/** Bước làm tròn theo loại tiền: VND tròn đồng, USD (hoặc chưa biết) tròn xu. */
const roundStep = (currency?: PaymentCurrency | "") => BigInt(currency === "VND" ? 100 : 1);

/** Tách số tiền đã gồm VAT: trước thuế = tổng / (1 + %VAT), VAT = tổng - trước thuế. */
export function splitVat(amount: string, vat: string, currency?: PaymentCurrency | ""): { base: string; tax: string } {
  const total = amountToCents(amount);
  if (!vat) return { base: centsToAmount(total), tax: "0.00" };
  const step = roundStep(currency);
  const base = roundDiv(total * BigInt(10000), (BigInt(10000) + vatBasis(vat)) * step) * step;
  return { base: centsToAmount(base), tax: centsToAmount(total - base) };
}

/**
 * Tổng gồm VAT từ tiền trước thuế: trước thuế × (1 + %VAT), làm tròn đến xu cho mọi loại tiền (VND giữ 2 chữ số lẻ:
 * 2.721.070 + 8% = 2.938.755,60). Không làm tròn từng khoản đến đồng: nhiều khoản cộng lại sẽ lệch tổng hoá đơn
 * (9 × 2.938.756 = 26.448.804 trong khi 9 × 2.721.070 × 1,08 = 26.448.800,40).
 */
export function addVat(base: string, vat: string, currency?: PaymentCurrency | ""): string {
  void currency;
  return centsToAmount(roundDiv(amountToCents(base) * (BigInt(10000) + vatBasis(vat || "0")), BigInt(10000)));
}

/** Tổng tiền đề nghị: VND làm tròn đến đồng, nửa lên (như BE sumTotal; từng khoản vẫn giữ 2 chữ số lẻ). Loại tiền khác /
 * chưa chọn giữ nguyên. */
export function roundRequestTotal(amount: string, currency?: PaymentCurrency | ""): string {
  if (currency !== "VND") return amount;
  return centsToAmount(roundDiv(amountToCents(amount), BigInt(100)) * BigInt(100));
}

/** a - b (chuỗi số tiền), không sai số dấu phẩy động; âm → null. */
export function subtractAmounts(a: string | null | undefined, b: string | null | undefined): string | null {
  const cents = amountToCents(a) - amountToCents(b);
  return cents < BigInt(0) ? null : centsToAmount(cents);
}

// ---------- Phí sửa cont trừ vào tiền cược (upload hóa đơn của đề nghị cược cont đã chi tiền) ----------

/** Số hãng tàu hoàn cược: được âm (phải trả thêm) và 0. "-5.000.000" → "-5000000", "0" → "0"; sai → null. */
export function parseSignedAmount(value: string): string | null {
  const raw = String(value ?? "").replace(/\s+/g, "").replace(/^[−–]/, "-");
  const negative = raw.startsWith("-");
  const body = negative ? raw.slice(1) : raw;
  if (/^0+([.,]0{1,2})?$/.test(body)) return "0";
  const parsed = parseAmountLoose(body);
  if (parsed === null) return null;
  return negative ? `-${parsed}` : parsed;
}

/**
 * Phí sửa cont = tiền cược − số hoàn (như BE paymentCostService.planContainerRepairs). excess = phần phí sửa vượt tiền cược
 * (số hoàn âm); refundTooHigh = hoàn nhiều hơn tiền cược (không hợp lệ, repair trả "0.00").
 */
export function containerRepairOf(deposit: string, refund: string): { repair: string; excess: string; refundTooHigh: boolean } {
  const negative = refund.startsWith("-");
  const refundCents = amountToCents(negative ? refund.slice(1) : refund) * BigInt(negative ? -1 : 1);
  const repairCents = amountToCents(deposit) - refundCents;
  return {
    repair: repairCents < BigInt(0) ? "0.00" : centsToAmount(repairCents),
    excess: centsToAmount(negative ? -refundCents : BigInt(0)),
    refundTooHigh: repairCents < BigInt(0),
  };
}
