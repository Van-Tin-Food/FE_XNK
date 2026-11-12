// Danh mục thao tác của Nhật ký thao tác: nhóm chức năng (lọc + màu), nhãn từng mã, khoảng thời gian nhanh, gom theo ngày.
// Hàm thuần — test ở tests/activityLogCatalog.test.mjs. Mã thao tác mới ghi ở FE / BE: thêm vào đúng nhóm dưới đây
// (kèm key dịch log*), nếu không dòng log hiện mã thô và chỉ lọc được ở nhóm "Khác".

type Translate = (key: string) => string;

export type ActivityGroupKey = "shipment" | "documentSync" | "payment" | "cost" | "masterData" | "account" | "auth" | "system" | "other";

export interface ActivityGroup {
  key: ActivityGroupKey;
  /** [mã thao tác, key dịch nhãn] theo thứ tự hiện trong ô lọc. */
  actions: readonly (readonly [string, string])[];
}

export const ACTIVITY_GROUPS: readonly ActivityGroup[] = [
  { key: "shipment", actions: [
    ["CREATE_SHIPMENT", "logCreateShipment"],
    ["EDIT_SHIPMENT_DETAILS", "logEditShipmentDetails"],
    ["EDIT_RETURN_ITEM", "logEditContainerTransport"],
    ["UPLOAD_DOCUMENT", "logUploadDocument"],
    ["UPLOAD_OCR_DOCUMENT", "logUploadOcrDocument"],
    ["PASS_DOCUMENT", "logPassDocument"],
    ["DELETE_DOCUMENT_FILE", "logDeleteDocumentFile"],
    ["ARCHIVE_DOCUMENTS", "logArchiveDocuments"],
    ["CANCEL_SHIPMENT", "logCancelShipment"],
    ["EXPORT_EXCEL", "logExportExcel"],
  ] },
  { key: "payment", actions: [
    ["PAYMENT_REQUEST_CREATE", "logPaymentCreate"],
    ["PAYMENT_REQUEST_UPDATE", "logPaymentUpdate"],
    ["PAYMENT_REQUEST_SEND", "logPaymentSend"],
    ["PAYMENT_REQUEST_NOTIFY", "logPaymentNotify"],
    ["PAYMENT_REQUEST_APPROVE", "logPaymentApprove"],
    ["PAYMENT_REQUEST_REJECT", "logPaymentReject"],
    ["PAYMENT_REQUEST_PAID", "logPaymentPaid"],
    ["PAYMENT_REQUEST_PAYMENT_PROOF", "logPaymentProof"],
    ["PAYMENT_REQUEST_UPLOAD", "logPaymentUpload"],
    ["PAYMENT_REQUEST_DOCUMENT_REMOVE", "logPaymentDocRemove"],
    ["PAYMENT_REQUEST_MISSING_DOCUMENTS", "logPaymentMissingDocs"],
    ["PAYMENT_REQUEST_LINK", "logPaymentLink"],
    ["PAYMENT_REQUEST_COMPLETE", "logPaymentComplete"],
    ["PAYMENT_REQUEST_CANCEL", "logPaymentCancel"],
    ["PAYMENT_REQUEST_DELETE", "logPaymentDelete"],
    ["PAYMENT_CONTAINER_REPAIR", "logPaymentContainerRepair"],
  ] },
  { key: "cost", actions: [
    ["PAYMENT_COST_UPDATE", "logPaymentCostUpdate"],
    ["PAYMENT_COST_DELETE", "logPaymentCostDelete"],
    ["GOODS_PAYMENT_MANUAL_MARK", "logGoodsPaymentManualMark"],
    ["BANK_TRANSACTION_LINK", "logBankLink"],
    ["BANK_TRANSACTION_UNLINK", "logBankUnlink"],
    ["BANK_TRANSACTION_IGNORE", "logBankIgnore"],
  ] },
  { key: "documentSync", actions: [
    ["DOCUMENT_SYNC_SCAN", "logDocumentSyncScan"],
    ["DOCUMENT_SYNC_ACCEPT", "logDocumentSyncAccept"],
    ["DOCUMENT_SYNC_RENAME", "logDocumentSyncRename"],
    ["DOCUMENT_SYNC_RESTORE", "logDocumentSyncRestore"],
  ] },
  { key: "masterData", actions: [
    ["CREATE_MASTER_DATA", "logCreateMasterData"],
    ["UPDATE_MASTER_DATA", "logUpdateMasterData"],
    ["DELETE_MASTER_DATA", "logDeleteMasterData"],
    ["PAYMENT_CATEGORY_CREATE", "logPaymentCategoryCreate"],
    ["PAYMENT_CATEGORY_UPDATE", "logPaymentCategoryUpdate"],
  ] },
  { key: "account", actions: [
    ["REGISTER_USER", "logRegisterUser"],
    ["UPDATE_USER_PERMISSION", "logUpdatePermission"],
    ["UPDATE_USER_PASSWORD", "logResetPassword"],
    ["USER_SIGNATURE_UPDATE", "logSignatureUpdate"],
    ["USER_SIGNATURE_DELETE", "logSignatureDelete"],
  ] },
  { key: "auth", actions: [
    ["LOGIN", "logLogin"],
    ["LOGIN_GOOGLE", "logLoginGoogle"],
    ["LOGIN_FAILED", "logLoginFailed"],
    ["LOGOUT", "logLogout"],
  ] },
  { key: "system", actions: [
    ["AUTO_DOCUMENT_SYNC", "logAutoDocumentSync"],
    ["AUTO_DOCUMENT_SYNC_RUN", "logAutoDocumentSyncRun"],
    ["ETA_ARRIVAL_REMINDER", "logEtaArrivalReminder"],
  ] },
  { key: "other", actions: [
    ["AI_CHAT", "logAiChat"],
  ] },
];

const ACTION_INDEX = new Map<string, { group: ActivityGroupKey; labelKey: string }>(
  ACTIVITY_GROUPS.flatMap((group) => group.actions.map(([code, labelKey]) => [code, { group: group.key, labelKey }] as const)),
);

function normalizeAction(action: string): string {
  return String(action || "").trim().toUpperCase();
}

/** Nhóm chức năng của một mã thao tác; mã chưa khai báo thuộc nhóm "Khác". */
export function activityGroupOf(action: string): ActivityGroupKey {
  return ACTION_INDEX.get(normalizeAction(action))?.group ?? "other";
}

/** Nhãn dễ đọc của mã thao tác; mã chưa khai báo giữ nguyên mã để còn tra được. */
export function activityActionLabel(action: string, t: Translate): string {
  const info = ACTION_INDEX.get(normalizeAction(action));
  return info ? t(info.labelKey) : action || t("unknown");
}

/**
 * Tham số lọc thao tác gửi BE: chọn thao tác cụ thể → `action`; chỉ chọn nhóm → `actions` (mọi mã của nhóm);
 * không chọn gì → không lọc.
 */
export function activityActionQuery(group: ActivityGroupKey | "", action: string): { action?: string; actions?: string[] } {
  if (action) return { action };
  const found = ACTIVITY_GROUPS.find((item) => item.key === group);
  return found ? { actions: found.actions.map(([code]) => code) } : {};
}

/** Mốc thời gian lưu trong log ("2026-11-12 09:01:02.123" = giờ địa phương, hoặc ISO). */
export function parseLogDate(value: string): Date {
  const raw = String(value || "").trim();
  // PostgreSQL timestamp without time zone is a wall-clock value. Keep it in local time.
  const postgresMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/);
  if (postgresMatch) {
    const milliseconds = (postgresMatch[3] || "").slice(0, 3).padEnd(3, "0");
    return new Date(`${postgresMatch[1]}T${postgresMatch[2]}.${milliseconds}`);
  }
  return new Date(raw);
}

/** Ngày theo giờ máy người dùng, dạng YYYY-MM-DD (giá trị của ô input date). */
export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export type ActivityPeriod = "all" | "today" | "yesterday" | "last7" | "last30" | "custom";
export const ACTIVITY_PERIODS: readonly ActivityPeriod[] = ["all", "today", "yesterday", "last7", "last30", "custom"];

/** Khoảng ngày (from/to YYYY-MM-DD, tính cả hai đầu) của một lựa chọn thời gian nhanh. */
export function activityPeriodRange(
  period: ActivityPeriod,
  custom: { from: string; to: string } = { from: "", to: "" },
  now: Date = new Date(),
): { from: string; to: string } {
  const daysAgo = (days: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() - days);
    return dateKey(date);
  };
  switch (period) {
    case "today": return { from: daysAgo(0), to: daysAgo(0) };
    case "yesterday": return { from: daysAgo(1), to: daysAgo(1) };
    case "last7": return { from: daysAgo(6), to: daysAgo(0) };
    case "last30": return { from: daysAgo(29), to: daysAgo(0) };
    case "custom": return { from: custom.from, to: custom.to };
    default: return { from: "", to: "" };
  }
}

/** Gom các dòng (đã xếp mới nhất trước) theo ngày, giữ nguyên thứ tự. Dòng không đọc được ngày gom vào nhóm "". */
export function groupActivityByDay<T extends { createdAt: string }>(logs: readonly T[]): { day: string; items: T[] }[] {
  const groups: { day: string; items: T[] }[] = [];
  for (const log of logs) {
    const date = parseLogDate(log.createdAt);
    const day = Number.isNaN(date.getTime()) ? "" : dateKey(date);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(log);
    else groups.push({ day, items: [log] });
  }
  return groups;
}

/** "today" / "yesterday" nếu ngày (YYYY-MM-DD) là hôm nay / hôm qua theo giờ máy, còn lại "". */
export function relativeDay(day: string, now: Date = new Date()): "today" | "yesterday" | "" {
  if (!day) return "";
  if (day === dateKey(now)) return "today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return day === dateKey(yesterday) ? "yesterday" : "";
}
