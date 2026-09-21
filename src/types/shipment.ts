// ============================================================
// Shipment Domain Types
// ============================================================

import type { DriveDocumentFileRecord, PostgresShipmentRelations } from "@/types/postgresShipment";

export type ShipmentStatus =
  | "shipping"      // Đang vận chuyển (chưa đến ETA)
  | "completed"     // Hoàn thành (đã qua ETA + đủ giấy tờ)
  | "missing_docs"  // Thiếu chứng từ theo bảng chung_tu_drive
  | "cancelled";    // Đơn đã hủy (giữ nguyên dữ liệu, chỉ đổi trạng thái)

export type DocumentStatus = "ok" | "missing" | "pending" | "expired";
export type ShipmentFilterStatus = ShipmentStatus;

export type JourneyStage =
  | "origin_port"       // Cảng xuất phát (A)
  | "transit_port"      // Cảng trung chuyển (B)
  | "destination_port"  // Cảng đến (VN)
  | "customs_clearance" // Thông quan
  | "delivered";        // Đã giao

export interface ShipmentDocument {
  id: string;
  name: string;
  type: string;
  status: DocumentStatus;
  fileId?: string;
  url?: string;
  /** Multiple physical files for the same document type, when supplied by the backend. */
  urls?: string[];
  files?: DriveDocumentFileRecord[];
  updatedAt?: string;
  note?: string;
  uploaderEmail?: string;
  uploaderName?: string;
}

export interface ArchivedDocumentFile {
  fileId: string;
  fileName: string;
  fileUrl: string;
  mimeType?: string;
  createdTime?: string;
  updatedTime?: string;
}

export interface ArchivedDocumentsResponse {
  success: boolean;
  archived: boolean;
  orderCode?: string;
  folderId?: string;
  folderName?: string;
  folderUrl?: string;
  totalFiles?: number;
  files?: ArchivedDocumentFile[];
  message?: string;
}

export interface ShipmentTimeline {
  id: string;
  stage: JourneyStage;
  label: string;
  timestamp?: string;
  isCompleted: boolean;
  isCurrent: boolean;
  portName?: string;
  note?: string;
}

export interface ShipmentStatusHistory {
  id: string;
  action: string;
  description: string;
  timestamp: string;
  user?: string;
}

export interface Shipment {
  id: string;
  orderCode: string;           // Số HĐ
  shipName: string;            // Tên hàng
  supplier: string;            // KHÁCH HÀNG (người mua)
  factoryCode?: string;        // MÃ NHÀ MÁY
  origin?: string;             // XUẤT XỨ
  vessel?: string;             // Hãng tàu
  bill?: string;               // BL NO.
  etd?: string;                // ETD
  eta?: string;                // ETA
  ata?: string;                // Actual Time of Arrival (nếu có)
  port?: string;               // Cảng
  contCount?: number;          // Số cont
  status: ShipmentStatus;
  docStatus: number;           // 0 = thiếu, 1 = đủ theo dữ liệu chứng từ Drive
  flowStageKey?: "buying" | "shipping" | "arrived" | "declared" | "fifteenb" | "customs" | "delivered";
  flowStageLabel?: string;
  flowStageLate?: boolean;
  totalDocs: number;           // requist_docs
  receivedDocs: number;        // total_docs (đã có)
  missingDocs: string;         // mis_docs (danh sách tên giấy tờ thiếu)
  timeUpdate?: string;         // date_time từ bảng chung_tu_drive
  documents?: ShipmentDocument[];
  timeline?: ShipmentTimeline[];
  statusHistory?: ShipmentStatusHistory[];
  /** Dữ liệu tổng hợp từ các quan hệ PostgreSQL, dùng cho tab Chi tiết và OCR. */
  summaryFields?: Record<string, string>;
  /** Quan hệ dữ liệu nghiệp vụ từ PostgreSQL; file vật lý được lưu trên Drive. */
  database?: PostgresShipmentRelations;
  updatedAt: string;
  createdAt: string;
}

export interface ShipmentMetricsSummary {
  total: number;
  completed: number;
  shipping: number;
  cancelled: number;
}

export interface ShipmentFilter {
  status?: ShipmentFilterStatus | "all";
  search?: string;            // lọc mã đơn hàng + tên hàng
  supplier?: string;          // lọc nhà cung cấp (KHÁCH HÀNG)
  port?: string;              // lọc cảng
  vessel?: string;            // lọc hãng tàu
  dateFrom?: string;
  dateTo?: string;
  dateField?: "eta" | "etd";
}

export interface DriveDataResponse {
  success: boolean;
  message?: string;
  fileUrl?: string;
  fileName?: string;
  fileId?: string;
  files?: DriveDocumentFileRecord[];
  updatedAt?: string;
}

export interface ReturnItem {
  idVanChuyen: string;
  idBlContainer: string;
  ngay: string;
  soCont: string;
  soHd: string;
  nhaXe: string;
  tenTaiXe: string;
  bienSoXe: string;
  noiDi: string;
  noiTraContainer: string;
  idKho: string;
  tenKho: string;
  ghiChu: string;
}
