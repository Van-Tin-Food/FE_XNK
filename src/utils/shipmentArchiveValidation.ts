import type { ReturnItem } from "@/types/shipment";

/**
 * Danh sách trường bắt buộc phải có dữ liệu trước khi bấm "Lưu trữ dữ liệu".
 * Cố ý KHÔNG đưa toàn bộ trường vào đây: một số ô có thể bỏ trống
 * (ví dụ Ghi chú, ATA, Số tiền cọc, Lệnh thả hàng...).
 */

// Tab "Chi tiết": so khớp với các trường trong shipment.summaryFields.
export const ARCHIVE_REQUIRED_DETAIL_FIELDS: ReadonlyArray<{ field: string; label: string }> = [
  { field: "Số HĐ", label: "Mã hợp đồng" },
  { field: "Ngày HĐ PI", label: "Ngày hợp đồng" },
  { field: "Nhà cung cấp", label: "Nhà cung cấp" },
  { field: "XUẤT XỨ", label: "Xuất xứ" },
  { field: "INV", label: "Mã INV" },
  { field: "Ngày INV", label: "Ngày INV" },
  { field: "BL NO.", label: "Số BL" },
  { field: "Mã Container", label: "Mã container" },
  { field: "Hãng tàu", label: "Hãng tàu" },
  { field: "Cảng đi", label: "Cảng đi" },
  { field: "Cảng đến", label: "Cảng đến" },
  { field: "ETD", label: "ETD" },
  { field: "ETA", label: "ETA" },
];

// Tab "Vận chuyển container": so khớp với các ô nhập của mỗi container.
export const ARCHIVE_REQUIRED_TRANSPORT_FIELDS: ReadonlyArray<{ key: keyof ReturnItem; label: string }> = [
  { key: "ngay", label: "Ngày vận chuyển container" },
  { key: "nhaXe", label: "Nhà xe" },
  { key: "tenTaiXe", label: "Tên tài xế" },
  { key: "bienSoXe", label: "Số xe" },
  { key: "noiDi", label: "Nơi đi" },
  { key: "noiTraContainer", label: "Nơi trả container" },
  { key: "idKho", label: "Mã kho" },
];

function normalizeFieldName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]/g, "");
}

function isFilled(value: unknown): boolean {
  return String(value ?? "").trim() !== "";
}

/** Danh sách nhãn trường còn thiếu của tab Chi tiết (theo thứ tự trong list). */
export function getMissingArchiveDetailFields(summaryFields: Record<string, string> | undefined): string[] {
  if (!summaryFields) return ARCHIVE_REQUIRED_DETAIL_FIELDS.map(({ label }) => label);
  const entries = Object.entries(summaryFields);
  return ARCHIVE_REQUIRED_DETAIL_FIELDS
    .filter(({ field }) => {
      const wanted = normalizeFieldName(field);
      const match = entries.find(([key]) => normalizeFieldName(key) === wanted);
      return !match || !isFilled(match[1]);
    })
    .map(({ label }) => label);
}

/**
 * Danh sách trường còn thiếu của tab Vận chuyển container,
 * ghép theo từng container dạng "MÃ-CONT: trường 1, trường 2".
 */
export function getMissingArchiveTransportFields(transportItems: ReturnItem[]): string[] {
  return transportItems.flatMap((item) => {
    const missing = ARCHIVE_REQUIRED_TRANSPORT_FIELDS
      .filter(({ key }) => !isFilled(item[key]))
      .map(({ label }) => label);
    return missing.length === 0 ? [] : [`${item.soCont || "container"}: ${missing.join(", ")}`];
  });
}
