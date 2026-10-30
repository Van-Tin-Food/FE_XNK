import type { SupplierRecord } from "@/types/postgresShipment";

// Trang Gửi email: người nhận, bộ lọc nhà cung cấp và chọn theo nhóm. Hàm thuần để test được (tests/emailRecipients.test.mjs).

/** Đồng bộ với MAX_EMAIL_RECIPIENTS ở be/src/services/emailService.js. */
export const MAX_EMAIL_RECIPIENTS = 15;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Một email người nhận = một người liên hệ có email của nhà cung cấp (NCC có nhiều liên hệ thì nhiều người nhận). */
export interface EmailRecipientOption {
  key: string;
  supplierId: string;
  supplierName: string;
  contactName: string;
  email: string;
}

export type EmailContactFilter = "all" | "withEmail" | "withoutEmail";
export type EmailHistoryFilter = "all" | "never" | "notWithin7" | "notWithin30" | "within7";
export type EmailSelectionFilter = "all" | "selected" | "unselected";

export interface EmailSupplierFilters {
  query: string;
  country: string;
  contact: EmailContactFilter;
  history: EmailHistoryFilter;
  selection: EmailSelectionFilter;
}

export const DEFAULT_EMAIL_FILTERS: EmailSupplierFilters = {
  query: "",
  country: "",
  contact: "all",
  history: "all",
  selection: "all",
};

/** Nhà cung cấp sau khi lọc + các email của nó còn hiện (bộ lọc lịch sử / đang chọn lọc tới từng email). */
export interface EmailSupplierRow {
  supplier: SupplierRecord;
  recipients: EmailRecipientOption[];
  totalRecipients: number;
}

export interface EmailFilterContext {
  /** email viết thường → thời điểm gửi thành công gần nhất (ISO). */
  lastSent: Map<string, string>;
  selectedKeys: ReadonlySet<string>;
  now: number;
}

/** Bỏ dấu, viết thường: tìm "viet" ra "Việt", quốc gia "brazil" và "Brazil" là một. */
export function normalizeSearchText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase("vi")
    .trim();
}

/** Danh sách quốc gia không trùng (không phân biệt hoa/thường, dấu), giữ cách viết gặp đầu tiên. */
export function countryOptions(suppliers: SupplierRecord[]): string[] {
  const byKey = new Map<string, string>();
  for (const supplier of suppliers) {
    const label = String(supplier.quoc_gia || "").trim();
    const key = normalizeSearchText(label);
    if (key && !byKey.has(key)) byKey.set(key, label);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, "vi"));
}

function matchesHistory(filter: EmailHistoryFilter, lastSentAt: string | undefined, now: number): boolean {
  if (filter === "all") return true;
  const time = lastSentAt ? Date.parse(lastSentAt) : Number.NaN;
  const sent = Number.isFinite(time);
  if (filter === "never") return !sent;
  if (filter === "within7") return sent && now - time <= 7 * DAY_MS;
  const days = filter === "notWithin7" ? 7 : 30;
  return !sent || now - time > days * DAY_MS;
}

export function hasActiveEmailFilters(filters: EmailSupplierFilters): boolean {
  return Boolean(filters.query.trim() || filters.country)
    || filters.contact !== "all" || filters.history !== "all" || filters.selection !== "all";
}

/**
 * Lọc nhà cung cấp. Tìm kiếm: tên NCC / quốc gia khớp thì hiện mọi email, không thì chỉ hiện người liên hệ khớp
 * (tên hoặc email). Bộ lọc lịch sử gửi và đang chọn áp lên từng email; NCC không còn email nào thì ẩn.
 */
export function filterEmailSuppliers(
  suppliers: SupplierRecord[],
  recipientsBySupplier: Map<string, EmailRecipientOption[]>,
  filters: EmailSupplierFilters,
  context: EmailFilterContext,
): EmailSupplierRow[] {
  const query = normalizeSearchText(filters.query);
  const country = normalizeSearchText(filters.country);
  const recipientLevel = filters.history !== "all" || filters.selection !== "all";
  const rows: EmailSupplierRow[] = [];

  for (const supplier of suppliers) {
    const all = recipientsBySupplier.get(supplier.id_ncc) || [];
    if (country && normalizeSearchText(supplier.quoc_gia) !== country) continue;
    if (filters.contact === "withEmail" && all.length === 0) continue;
    if (filters.contact === "withoutEmail" && all.length > 0) continue;

    let recipients = all;
    if (query) {
      const supplierMatches = normalizeSearchText(`${supplier.ten_ncc} ${supplier.quoc_gia || ""}`).includes(query);
      if (!supplierMatches) {
        recipients = all.filter((recipient) => normalizeSearchText(`${recipient.contactName} ${recipient.email}`).includes(query));
        if (recipients.length === 0) continue;
      }
    }
    if (recipientLevel) {
      recipients = recipients.filter((recipient) => {
        const selected = context.selectedKeys.has(recipient.key);
        if (filters.selection === "selected" && !selected) return false;
        if (filters.selection === "unselected" && selected) return false;
        return matchesHistory(filters.history, context.lastSent.get(recipient.email.toLowerCase()), context.now);
      });
      if (recipients.length === 0) continue;
    }
    rows.push({ supplier, recipients, totalRecipients: all.length });
  }
  return rows;
}

export type GroupSelectionState = "none" | "some" | "all";

export function groupSelectionState(selectedKeys: ReadonlySet<string>, keys: string[]): GroupSelectionState {
  const selected = keys.filter((key) => selectedKeys.has(key)).length;
  if (keys.length === 0 || selected === 0) return "none";
  return selected === keys.length ? "all" : "some";
}

/**
 * Chọn / bỏ chọn cả nhóm (một nhà cung cấp, hoặc mọi email đang hiện trên trang): đã chọn hết thì bỏ cả nhóm,
 * chưa thì thêm phần còn thiếu theo thứ tự hiển thị, tối đa max. skipped = số email không thêm được vì vượt giới hạn.
 */
export function toggleRecipientGroup(selected: string[], keys: string[], max = MAX_EMAIL_RECIPIENTS): { next: string[]; skipped: number } {
  if (keys.length === 0) return { next: selected, skipped: 0 };
  const current = new Set(selected);
  if (keys.every((key) => current.has(key))) {
    const remove = new Set(keys);
    return { next: selected.filter((key) => !remove.has(key)), skipped: 0 };
  }
  const missing = keys.filter((key) => !current.has(key));
  const room = Math.max(0, max - selected.length);
  const added = missing.slice(0, room);
  return { next: [...selected, ...added], skipped: missing.length - added.length };
}
