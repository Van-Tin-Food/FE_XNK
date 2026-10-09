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

function exportDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const slash = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!slash) return raw;
  const first = Number(slash[1]);
  const second = Number(slash[2]);
  const day = first > 12 ? first : second;
  const month = first > 12 ? second : first;
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${slash[3]}`;
}

function contractDateKey(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!raw) return Number.POSITIVE_INFINITY;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const timestamp = Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
  }
  const slash = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!slash) return Number.POSITIVE_INFINITY;
  const first = Number(slash[1]);
  const second = Number(slash[2]);
  const day = first > 12 ? first : second;
  const month = first > 12 ? second : first;
  const timestamp = Date.UTC(Number(slash[3]), month - 1, day);
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

function sortByContractDate(shipments: Shipment[]): Shipment[] {
  return shipments
    .map((shipment, index) => ({ shipment, index }))
    .sort((left, right) => (
      contractDateKey(left.shipment.database?.purchase?.ngay_hop_dong)
      - contractDateKey(right.shipment.database?.purchase?.ngay_hop_dong)
      || left.index - right.index
    ))
    .map(({ shipment }) => shipment);
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
        "Tên nhà máy": joinValues(itemCodes.map((item) => item.ten_nha_may)),
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
  const orderedShipments = sortByContractDate(shipments);
  const orderCodes = [...new Set(orderedShipments.map((shipment) => shipment.orderCode).filter(Boolean))];

  addSheet(workbook, "Tổng hợp XNK", buildSummaryRows(orderedShipments));

  addSheet(workbook, "Chi tiết mua hàng", orderedShipments.flatMap((shipment) => (shipment.database?.details || []).map((detail) => ({
    "Mã đơn hàng": shipment.orderCode,
    "ID chi tiết": detail.id_chi_tiet,
    "Tên hàng": detail.ten_hang,
    "Số lượng kiện": detail.so_kien,
    "Đơn vị kiện": detail.don_vi_kien,
    "Số lượng NET": detail.net_weight,
    "Đơn giá": detail.don_gia,
    "Giá tổng": detail.tong_gia,
  }))));

  addSheet(workbook, "Vận đơn", orderedShipments.flatMap((shipment) => (shipment.database?.bills || []).map((bill) => ({
    "Mã đơn hàng": shipment.orderCode,
    "Mã BL": bill.ma_bl,
    "Hãng tàu": bill.carrier?.ten_hang_tau || bill.id_hang_tau,
    "Cảng đi": bill.cang_di,
    "Cảng đến": bill.cang_den,
    "ETD": bill.etd,
    "ETA": bill.eta,
    "ATA": bill.ata,
  }))));

  addSheet(workbook, "Container", orderedShipments.flatMap((shipment) => (shipment.database?.bills || []).flatMap((bill) => bill.containers.map((container) => ({
    "Mã đơn hàng": shipment.orderCode,
    "Mã BL": bill.ma_bl,
    "ID B/L - container": container.id_bl_container,
    "Mã container": container.ma_container,
    "Chi tiết hàng trong container": JSON.stringify(container.details || []),
  })))));

  addSheet(workbook, "Vận chuyển", orderedShipments.flatMap((shipment) => (shipment.database?.bills || []).flatMap((bill) => bill.containers.flatMap((container) => container.transports.map((transport) => ({
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

  addSheet(workbook, "Chứng từ", orderedShipments.flatMap((shipment) => (shipment.documents || []).flatMap((document) => {
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

export const ETA_EXPORT_HEADERS = [
  "STT", "Số HĐ", "Ngày HĐ", "INV", "Ngày INV", "ITEM CODE", "Tên hàng",
  "Nhà cung cấp", "XUẤT XỨ", "MÃ NHÀ MÁY", "Tên nhà máy", "Cảng", "BL NO.",
  "Mã công", "Hãng tàu", "ETD", "ETA", "Thùng", "Trlg", "Giá bán($)",
  "Thành tiền ($)", "Ngày vận chuyển", "Mã kho", "Nhà xe", "Nơi lấy công", "Nơi trả công",
];

/** Builds the contract-focused layout used by the ETA Google Sheet. */
export function buildEtaRows(shipments: Shipment[], returnItemsByOrder: ReturnItemsByOrder): Array<Record<string, unknown>> {
  let sequence = 1;
  const rows: Array<Record<string, unknown>> = sortByContractDate(shipments)
    .filter((shipment) => String(shipment.orderCode || "").trim() !== "")
    .flatMap((shipment) => {
    const purchase = shipment.database?.purchase;
    const details = shipment.database?.details?.length ? shipment.database.details : [null];
    const bills = shipment.database?.bills?.length ? shipment.database.bills : [null];
    const returnItems = returnItemsByOrder[shipment.orderCode] || [];

    return details.flatMap((detail) => {
      const itemCodes = detail?.itemCodes || [];
      const itemCode = joinValues(itemCodes.map((item) => item.item_code));
      const factoryCode = joinValues(itemCodes.map((item) => item.ma_nha_may));
      const factoryName = joinValues(itemCodes.map((item) => item.ten_nha_may));

      return bills.flatMap((bill) => {
        const containers = bill?.containers?.length ? bill.containers : [null];
        return containers.flatMap((container) => {
          const transports = container?.transports?.length ? container.transports : [null];
          return transports.map((transport) => {
            const returnItem = returnItems.find((item) => (
              (transport?.id_van_chuyen && item.idVanChuyen === transport.id_van_chuyen)
              || (container?.id_bl_container && item.idBlContainer === container.id_bl_container)
            ));
            const carrier = bill?.carrier?.ten_hang_tau || bill?.id_hang_tau || shipment.vessel || "";
            const port = [bill?.cang_di, bill?.cang_den].filter(Boolean).join(" → ");
            return {
              "STT": sequence++,
              "Số HĐ": shipment.orderCode,
              "Ngày HĐ": exportDate(purchase?.ngay_hop_dong),
              "INV": purchase?.ma_inv,
              "Ngày INV": exportDate(purchase?.ngay_inv),
              "ITEM CODE": itemCode,
              "Tên hàng": detail?.ten_hang || shipment.shipName,
              "Nhà cung cấp": shipment.supplier,
              "XUẤT XỨ": shipment.origin,

              "MÃ NHÀ MÁY": factoryCode,
              "Tên nhà máy": factoryName,
              "Cảng": port || shipment.port,
              "BL NO.": bill?.ma_bl || shipment.bill,
              "Mã công": container?.ma_container || returnItem?.soCont,
              "Hãng tàu": carrier,
              "ETD": exportDate(bill?.etd || shipment.etd),
              "ETA": exportDate(bill?.eta || shipment.eta),
              "Thùng": detail?.so_kien,
              "Trlg": detail?.net_weight,
              "Giá bán($)": detail?.don_gia,
              "Thành tiền ($)": detail?.tong_gia,
              "Ngày vận chuyển": exportDate(transport?.ngay_van_chuyen || returnItem?.ngay),
              "Mã kho": transport?.id_kho || returnItem?.idKho,
              "Nhà xe": transport?.nha_xe || returnItem?.nhaXe,
              "Nơi lấy công": transport?.noi_di || returnItem?.noiDi,
              "Nơi trả công": transport?.noi_tra_container || returnItem?.noiTraContainer,
            };
          });
        });
      });
    });
  });

  // Giữ mọi dòng cùng một schema và cùng thứ tự cột trước khi gửi sang Apps Script.
  // Điều này tránh dữ liệu bị lệch cột khi một trường trong dòng bị rỗng.
  return rows.map((row) => Object.fromEntries(
    ETA_EXPORT_HEADERS.map((header) => [header, row[header] ?? ""]),
  ));
}

export function getEtaHeaders(): string[] {
  return [...ETA_EXPORT_HEADERS];
}

