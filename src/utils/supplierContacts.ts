import type { SupplierContact } from "@/types/postgresShipment";

// Người liên hệ nhà cung cấp: cột JSONB nha_cung_cap.lien_he. BE chuẩn hoá và kiểm tra lại
// (be/src/utils/supplierContacts.js), ở đây chỉ để báo lỗi sớm trên form và hiển thị.
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clean = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());

/** Danh sách liên hệ đã bỏ khoảng trắng, bỏ dòng trống; chịu được giá trị hỏng (không phải mảng). */
export function supplierContacts(value: unknown): SupplierContact[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      ten_nguoi_lien_he: clean(item.ten_nguoi_lien_he) || null,
      email: clean(item.email) || null,
      so_dien_thoai: clean(item.so_dien_thoai) || null,
    }))
    .filter((item) => item.ten_nguoi_lien_he || item.email || item.so_dien_thoai);
}

/** "Tên · email · SĐT" của một người liên hệ. */
export function formatSupplierContact(contact: SupplierContact): string {
  return [contact.ten_nguoi_lien_he, contact.email, contact.so_dien_thoai].map(clean).filter(Boolean).join(" · ");
}

/** Lỗi đầu tiên của danh sách trên form: thiếu cả email lẫn SĐT, hoặc email sai định dạng. */
export function findSupplierContactError(contacts: SupplierContact[]): { index: number; reason: "missing" | "email" } | null {
  for (const [index, contact] of contacts.entries()) {
    const email = clean(contact.email);
    if (!clean(contact.ten_nguoi_lien_he) && !email && !clean(contact.so_dien_thoai)) continue;
    if (!email && !clean(contact.so_dien_thoai)) return { index, reason: "missing" };
    if (email && !EMAIL_PATTERN.test(email)) return { index, reason: "email" };
  }
  return null;
}
