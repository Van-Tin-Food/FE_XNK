import * as XLSX from "xlsx";
import type { ReturnItem, Shipment } from "@/types/shipment";

export type ReturnItemsByOrder = Record<string, ReturnItem[]>;

function excelValue(value: unknown): string | number {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "string") return value;
  return JSON.stringify(value);
}

function joinValues(values: unknown[]): string {
  return values.map((value) => String(value ?? "").trim()).filter(Boolean).join(" | ");
}

function addSheet(workbook: XLSX.WorkBook, name: string, rows: Array<Record<string, unknown>>) {
  const safeRows = rows.length > 0 ? rows : [{ "Thông tin": "Không có dữ liệu" }];
  const normalized = safeRows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, excelValue(value)]),
  ));
  const sheet = XLSX.utils.json_to_sheet(normalized);
  sheet["!cols"] = Object.keys(normalized[0] || {}).map(() => ({ wch: 22 }));
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

function buildSummaryRows(shipments: Shipment[]): Array<Record<string, unknown>> {
  return shipments.flatMap((shipment) => {
    const details = shipment.database?.details || [null];
    const billRows = (shipment.database?.bills || []).flatMap((bill) => {
      const containerRows = bill.containers.length > 0 ? bill.containers : [null];
      return containerRows.flatMap((container) => {
        const transportRows = container?.transports?.length ? container.transports : [null];
        return transportRows.map((transport) => ({ bill, container, transport }));
      });
    });
    const relationRows = billRows.length > 0 ? billRows : [{ bill: null, container: null, transport: null }];

    return details.flatMap((detail) => relationRows.map(({ bill, container, transport }) => {
      const itemCodes = detail?.itemCodes || [];
      return {
        "ID mã đơn hàng": shipment.id,
        "Mã đơn hàng": shipment.orderCode,
        "Ngày tạo đơn": shipment.createdAt,
        "Mã INV": shipment.database?.purchase.ma_inv,
        "Ngày INV": shipment.database?.purchase.ngay_inv,
        "Tên hàng": detail?.ten_hang || shipment.shipName,
        "Nhà cung cấp": shipment.supplier,
        "Xuất xứ": shipment.origin,
        "Item code": joinValues(itemCodes.map((item) => item.item_code)),
        "Mã nhà máy": joinValues(itemCodes.map((item) => item.ma_nha_may)),
        "Số lượng kiện": detail?.so_kien,
        "Số lượng NET": detail?.net_weight,
        "Đơn giá": detail?.don_gia,
        "Giá tổng": detail?.tong_gia,
        "Mã BL": bill?.ma_bl || shipment.bill,
        "Hãng tàu": bill?.carrier?.ten_hang_tau || bill?.id_hang_tau || shipment.vessel,
        "Cảng đến": bill?.cang_den || shipment.port,
        "ETA": bill?.eta || shipment.eta,
        "ETD": bill?.etd || shipment.etd,
        "Giai đoạn": shipment.flowStageLabel,
        "Chứng từ thiếu": shipment.missingDocs,
        "Mã container": container?.ma_container,
        "ID B/L - container": container?.id_bl_container,
        "ID vận chuyển": transport?.id_van_chuyen,
        "Ngày vận chuyển": transport?.ngay_van_chuyen,
        "Nhà xe": transport?.nha_xe,
        "Tên tài xế": transport?.ten_tai_xe,
        "Biển số xe": transport?.bien_so_xe,
        "Nơi đi": transport?.noi_di,
        "Nơi trả container": transport?.noi_tra_container,
        "Kho nhận": transport?.warehouse?.ten_kho || transport?.id_kho,
        "Ghi chú vận chuyển": transport?.ghi_chu,
      };
    }));
  });
}

export function buildShipmentWorkbook(shipments: Shipment[], returnItemsByOrder: ReturnItemsByOrder): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const orderCodes = [...new Set(shipments.map((shipment) => shipment.orderCode).filter(Boolean))];

  addSheet(workbook, "Tổng hợp XNK", buildSummaryRows(shipments));

  addSheet(workbook, "Chi tiết mua hàng", shipments.flatMap((shipment) => (shipment.database?.details || []).map((detail) => ({
    "Mã đơn hàng": shipment.orderCode,
    "ID chi tiết": detail.id_chi_tiet,
    "Tên hàng": detail.ten_hang,
    "Số lượng kiện": detail.so_kien,
    "Đơn vị kiện": detail.don_vi_kien,
    "Số lượng NET": detail.net_weight,
    "Đơn giá": detail.don_gia,
    "Giá tổng": detail.tong_gia,
  }))));

  addSheet(workbook, "Vận đơn", shipments.flatMap((shipment) => (shipment.database?.bills || []).map((bill) => ({
    "Mã đơn hàng": shipment.orderCode,
    "Mã BL": bill.ma_bl,
    "Hãng tàu": bill.carrier?.ten_hang_tau || bill.id_hang_tau,
    "Cảng đi": bill.cang_di,
    "Cảng đến": bill.cang_den,
    "ETD": bill.etd,
    "ETA": bill.eta,
    "ATA": bill.ata,
  }))));

  addSheet(workbook, "Container", shipments.flatMap((shipment) => (shipment.database?.bills || []).flatMap((bill) => bill.containers.map((container) => ({
    "Mã đơn hàng": shipment.orderCode,
    "Mã BL": bill.ma_bl,
    "ID B/L - container": container.id_bl_container,
    "Mã container": container.ma_container,
    "Chi tiết hàng trong container": JSON.stringify(container.details || []),
  })))));

  addSheet(workbook, "Vận chuyển", shipments.flatMap((shipment) => (shipment.database?.bills || []).flatMap((bill) => bill.containers.flatMap((container) => container.transports.map((transport) => ({
    "Mã đơn hàng": shipment.orderCode,
    "Mã BL": bill.ma_bl,
    "Mã container": container.ma_container,
    "ID vận chuyển": transport.id_van_chuyen,
    "Ngày vận chuyển": transport.ngay_van_chuyen,
    "Nhà xe": transport.nha_xe,
    "Tên tài xế": transport.ten_tai_xe,
    "Biển số xe": transport.bien_so_xe,
    "Nơi đi": transport.noi_di,
    "Nơi trả container": transport.noi_tra_container,
    "Kho nhận": transport.warehouse?.ten_kho || transport.id_kho,
    "Ghi chú vận chuyển": transport.ghi_chu,
  }))))));

  addSheet(workbook, "Trả công", orderCodes.flatMap((orderCode) => (returnItemsByOrder[orderCode] || []).map((item) => ({
    "Mã đơn hàng": orderCode,
    "ID vận chuyển": item.idVanChuyen,
    "ID B/L - container": item.idBlContainer,
    "Ngày trả công": item.ngay,
    "Số container": item.soCont,
    "Số HĐ": item.soHd,
    "Nhà xe": item.nhaXe,
    "Tên tài xế": item.tenTaiXe,
    "Biển số xe": item.bienSoXe,
    "Nơi đi": item.noiDi,
    "Nơi trả container": item.noiTraContainer,
    "ID kho": item.idKho,
    "Tên kho": item.tenKho,
    "Ghi chú": item.ghiChu,
  }))));

  addSheet(workbook, "Chứng từ", shipments.flatMap((shipment) => (shipment.documents || []).flatMap((document) => {
    const files = document.files?.length ? document.files : [{ fileUrl: document.url || "" }];
    return files.map((file) => ({
      "Mã đơn hàng": shipment.orderCode,
      "Mã chứng từ": document.id,
      "Tên chứng từ": document.name,
      "Trạng thái": document.status,
      "Tên file": file.fileName,
      "Đường dẫn file": file.fileUrl,
      "Ngày cập nhật": document.updatedAt,
    }));
  })));

  return workbook;
}

export async function saveShipmentWorkbook(workbook: XLSX.WorkBook, suggestedName: string): Promise<void> {
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const pickerWindow = window as Window & {
    showSaveFilePicker?: (options?: Record<string, unknown>) => Promise<{
      createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
    }>;
  };

  if (pickerWindow.showSaveFilePicker) {
    const handle = await pickerWindow.showSaveFilePicker({
      suggestedName,
      types: [{ description: "Excel workbook", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
