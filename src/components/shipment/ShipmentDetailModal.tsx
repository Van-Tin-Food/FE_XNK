"use client";
import React, { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import type { Shipment } from "@/types/shipment";
import ShipmentStatusBar, { type ShipmentFlowStage } from "./ShipmentStatusBar";
import { useAuth } from "@/context/AuthContext";
import { analyzeDocument, checkDocumentProgress, fetchReturnItems, getArchivedDocuments, launchEvergreenTracking, moveCompletedOrder, NOTIFICATIONS_SYNC_EVENT, SUMMARY_FIELDS, uploadDocument, type DocumentProgressResponse } from "@/services/shipmentApi";
import { cancelPostgresShipment, createDatabaseRow, databaseEndpoints, listDatabaseRows, passDriveDocument, savePostgresBlOcrRows, savePostgresInvOcrRows, savePostgresPiOcrRows, savePostgresPklOcrRow, savePostgresReturnItem, updateDatabaseRow, updatePostgresShipmentFields } from "@/services/postgresShipmentApi";
import type { ArchivedDocumentsResponse, ReturnItem } from "@/types/shipment";
import type { CarrierRecord, ContainerDetailRecord, ContainerRecord, PostgresShipmentRelations, PurchaseDetailRecord, PurchaseItemCodeRecord, SupplierRecord, WarehouseRecord } from "@/types/postgresShipment";
import { recordActivity } from "@/services/activityLogApi";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import { useSystemConfirm } from "@/context/SystemConfirmContext";
import { useLanguage } from "@/context/LanguageContext";
import { submitEvergreenTracking } from "@/utils/evergreenTracking";
import { getMissingArchiveDetailFields, getMissingArchiveTransportFields } from "@/utils/shipmentArchiveValidation";
import { findBestCatalogMatch, normalizeCatalogText } from "@/utils/masterDataMatching";
import { DESTINATION_PORT_OPTIONS, isDestinationPort } from "@/config/shipmentCatalogOptions";
import { toDocumentPreviewUrl } from "@/utils/documentPreview";
import { backendApiUrl } from "@/services/backendApiUrl";
import { shouldValidateContainerPackages } from "@/utils/containerPackageValidation";
import {
  formatInternationalNumber,
  formatMoneyAmount,
  formatNetWeight,
  formatPackageCount,
  getCurrencyText,
  parseInternationalNumber,
  parsePackageCount,
  toDatabaseNumber,
  toDatabasePackageCount,
} from "@/utils/internationalNumber";
import { DOCUMENT_FILE_ACCEPT, getDocumentMimeType, isSupportedDocumentFile } from "@/utils/documentFile";

interface ShipmentDetailModalProps {
  shipment: Shipment | null;
  isOpen: boolean;
  onClose: () => void;
  onRefresh?: () => Promise<void>;
}

type ModalTab = "overview" | "journey" | "documents" | "return" | "details" | "folder";

const TAB_LIST: { key: ModalTab; labelKey: string; icon: React.ReactNode }[] = [
  {
    key: "overview",
    labelKey: "overview",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7"/>
        <rect x="14" y="3" width="7" height="7"/>
        <rect x="14" y="14" width="7" height="7"/>
        <rect x="3" y="14" width="7" height="7"/>
      </svg>
    ),
  },
  {
    key: "journey",
    labelKey: "journey",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
    ),
  },
  {
    key: "documents",
    labelKey: "documentTab",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
    ),
  },
  // {
  //   key: "history",
  //   label: "Lịch sử",
  //   icon: (
  //     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
  //       <polyline points="12 8 12 12 14 14"/>
  //       <path d="M3.05 11a9 9 0 1 0 .5-4H1"/>
  //       <polyline points="1 2 1 7 6 7"/>
  //     </svg>
  //   ),
  // },
  {
    key: "details",
    labelKey: "details",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/>
      </svg>
    ),
  },
  {
    key: "return",
    labelKey: "emptyReturn",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17h18"/><path d="M5 17V8h14v9"/><path d="M8 8V5h8v3"/><circle cx="7" cy="19" r="2"/><circle cx="17" cy="19" r="2"/>
      </svg>
    ),
  },

];

const RETURN_FIELD_GROUPS: Array<{
  labelKey: string;
  fields: Array<{ key: keyof ReturnItem; labelKey: string }>;
}> = [
  {
    labelKey: "orderContainerGroup",
    fields: [
      { key: "soHd", labelKey: "orderNumber" },
      { key: "soCont", labelKey: "containerNumberShort" },
    ],
  },
  {
    labelKey: "transportLocationsGroup",
    fields: [
      { key: "noiDi", labelKey: "departureLocation" },
      { key: "idKho", labelKey: "warehouseCode" },
      { key: "noiTraContainer", labelKey: "containerReturnLocation" },
      { key: "ghiChu", labelKey: "note" },
    ],
  },
  {
    labelKey: "vehicleContainerGroup",
    fields: [
      { key: "nhaXe", labelKey: "carrierCompany" },
      { key: "tenTaiXe", labelKey: "driverName" },
      { key: "bienSoXe", labelKey: "vehicleNumber" },
    ],
  },
];


const DOC_STATUS_MAP: Record<string, { label: string; color: string; dot: string }> = {
  ok:      { label: "Đã có",      color: "text-success-600", dot: "bg-success-500" },
  missing: { label: "Còn thiếu",  color: "text-error-600",   dot: "bg-error-500" },
  pending: { label: "Đang chờ",   color: "text-warning-600", dot: "bg-warning-500" },
  expired: { label: "Hết hạn",    color: "text-gray-500",    dot: "bg-gray-400" },
};

const FLOW_STAGES: ShipmentFlowStage[] = [
  { key: "buying", label: "Lên đơn hàng", shortLabel: "INV / PKL" },
  { key: "shipping", label: "Vận chuyển trên biển", shortLabel: "BL / CO / HC" },
  { key: "arrived", label: "Kiểm dịch hàng hóa", shortLabel: "DON_KD" },
  { key: "declared", label: "Khai báo hải quan", shortLabel: "BB_LM / PHI_TK / THUE_NK / TK" },
  { key: "fifteenb", label: "Mẫu 15B", shortLabel: "15B" },
  { key: "customs", label: "Thông quan", shortLabel: "QDTQ / MV" },
  { key: "delivered", label: "Giao hàng / Trả công", shortLabel: "TRA_CONG" },
];

const STAGE_DOC_GROUPS: Record<Exclude<ShipmentFlowStage["key"], "delivered">, string[]> = {
  buying: ["INV", "PKL"],
  shipping: ["BL", "CO", "HC"],
  arrived: ["DON_KD"],
  declared: ["BB_LM", "PHI_TK", "THUE_NK", "TK"],
  fifteenb: ["15B"],
  customs: ["QDTQ", "MV"],
};

const DOCUMENT_DISPLAY_ORDER = [
  "PI", "INV", "PKL", "BL", "CO", "HC", "DON_KD", "BB_LM",
  "PHI_TK", "THUE_NK", "TK", "15B", "QDTQ", "MV", "TRA_CONG",
];

type CarrierTrackingLink = {
  name: string;
  aliases: string[];
  trackingType?: "BL" | "CONTAINER";
  requiresManualCode: boolean;
  usesBackendApi?: boolean;
  buildUrl?: (trackingCode: string) => string;
};

type TrackingApiResponse = {
  success?: boolean;
  message?: string;
};

function buildBackendTrackingUrl(endpoint: string, trackingCode: string): string {
  return `${backendApiUrl(endpoint)}/${encodeURIComponent(trackingCode)}`;
}

function buildMscTrackingUrl(trackingCode: string): string {
  const params = btoa(`trackingNumber=${trackingCode}&trackingMode=0`);
  return `https://www.msc.com/en/track-a-shipment?params=${encodeURIComponent(params)}`;
}

function buildCmaTrackingUrl(reference: string): string {
  const normalizedReference = reference.trim().toUpperCase();
  const searchBy = /^[A-Z]{4}\d{7}$/.test(normalizedReference) ? "Container" : "Booking";
  const params = new URLSearchParams({ Reference: normalizedReference, SearchBy: searchBy });
  return `https://www.cma-cgm.com/ebusiness/tracking?${params.toString()}`;
}

// Chỉ hiển thị link cho các hãng đã được cấu hình. Có thể bổ sung URL tại đây
// khi có thêm danh sách tracking chính thức từ các hãng tàu.
const CARRIER_TRACKING_LINKS: CarrierTrackingLink[] = [
  {
    name: "Hapag-Lloyd",
    aliases: ["happ","hapag", "hapag-lloyd", "hapag lloyd"],
    requiresManualCode: false,
    buildUrl: (trackingCode) => `https://www.hapag-lloyd.com/en/online-business/track/track-by-booking-solution.html?blno=${trackingCode}`,
  },
  {
    name: "Maersk",
    aliases: ["maersk", "a.p. moller", "apm"],
    requiresManualCode: false,
    buildUrl: (trackingCode) => `https://www.maersk.com/tracking/${trackingCode}`,
  },
  {
    name: "MSC",
    aliases: ["msc", "mediterranean shipping"],
    requiresManualCode: false,
    buildUrl: buildMscTrackingUrl,
  },
  {
    name: "CMA CGM",
    aliases: ["cma", "cma cgm"],
    requiresManualCode: false,
    usesBackendApi: false,
    buildUrl: buildCmaTrackingUrl,
  },
  {
    name: "COSCO",
    aliases: ["cosco", "cosco shipping"],
    requiresManualCode: false,
    buildUrl: (trackingCode) => `https://elines.coscoshipping.com/ebusiness/cargoTracking?trackingType=BOOKING&number=${trackingCode}`,
  },
  {
    name: "HMM",
    aliases: ["hmm", "hyundai merchant marine"],
    requiresManualCode: false,
    buildUrl: (trackingCode) => `https://www.hmm21.com/e-service/search/index.do?query=${trackingCode}`,
  },
  {
    name: "FESCO",
    aliases: ["fesco"],
    requiresManualCode: false,
    buildUrl: (trackingCode) => `https://my.fesco.com/tracking?tab=${trackingCode}`,
  },
  {
    name: "Yang Ming",
    aliases: ["yang ming", "yangming", "yml"],
    requiresManualCode: false,
    usesBackendApi: true,
    buildUrl: (trackingCode) => `https://www.yangming.com/en/esolution/cargo_tracking?service=${trackingCode}`,
  },
  {
    name: "CK LINE",
    aliases: ["ck line", "ckline", "ck"],
    trackingType: "BL",
    requiresManualCode: false,
    usesBackendApi: false,
    buildUrl: () => "https://es.ckline.co.kr/",
  },
  {
    name: "EVERGREEN",
    aliases: ["evergreen", "evergreen marine", "ever", "emc", "shipmentlink"],
    requiresManualCode: false,
    usesBackendApi: true,
    buildUrl: (trackingCode) => buildBackendTrackingUrl("/api/tracking/shipmentlink", trackingCode),
  },
  {
    name: "ONE",
    aliases: ["one",
      "ONE", "one cargo"],
    requiresManualCode: false,
    buildUrl: (trackingCode) => `https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking?trakNoParam=${trackingCode}&trakNoTpCdParam=B`,
  },
  {
    name: "OOCL",
    aliases: ["oocl", "oocl shipping"],
    requiresManualCode: false,
    buildUrl: (trackingCode) => `https://www.oocl.com/Pages/ExpressLink.aspx?eltype=ct&businessType=bookingNumber&businessNumber=${trackingCode}&language=en`,
  },
  {
    name: "PIL",
    aliases: ["pil", "pacific international lines"],
    requiresManualCode: false,
    buildUrl: (trackingCode) => `https://www.pilship.com/digital-solutions/?tab=customer&id=track-trace&label=containerTandT&module=TrackTraceBL&refNo=${trackingCode}`,
  },
  {
    name: "SINOKOR",
    aliases: ["sinokor", "sinokor shipping"],
    requiresManualCode: false,
    buildUrl: (trackingCode) => `https://ebiz.sinokor.co.kr/BLDetail?blno=${trackingCode}`,
  }
];

function findCarrierTrackingLink(vessel?: string): CarrierTrackingLink | null {
  const normalizedVessel = (vessel || "").toLowerCase().trim();
  if (!normalizedVessel) return null;
  return CARRIER_TRACKING_LINKS.find((carrier) =>
    carrier.aliases.some((alias) => normalizedVessel.includes(alias))
  ) || null;
}

function InfoRow({ label, value, mono = false }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start">
      <span className="w-full sm:w-40 text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">{label}</span>
      <span className={`min-w-0 break-words text-sm font-medium text-gray-800 dark:text-white/90 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function getSummaryValue(fields: Record<string, string> | undefined, candidates: string[]): string {
  if (!fields) return "";
  const normalize = (value: string) => value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const entries = Object.entries(fields);
  for (const candidate of candidates) {
    const wanted = normalize(candidate);
    const match = entries.find(([field]) => normalize(field) === wanted);
    if (match && match[1]?.trim()) return match[1].trim();
  }
  return "";
}

function getOriginalSummaryValue(fields: Record<string, string> | undefined, field: string): string {
  const directValue = fields?.[field];
  return directValue == null ? getSummaryValue(fields, [field]) : String(directValue).trim();
}

function describeFieldChanges(
  orderCode: string,
  changes: Array<[string, string]>,
  originalFields: Record<string, string> | undefined,
): string {
  const details = changes.map(([field, newValue]) => {
    const oldValue = getOriginalSummaryValue(originalFields, field).trim() || "(trống)";
    const nextValue = newValue.trim() || "(trống)";
    return `${field}: ${oldValue} → ${nextValue}`;
  });
  return `Đơn ${orderCode}; thay đổi: ${details.join(" | ")}`;
}

function describeEditedFields(
  subject: string,
  original: object | undefined,
  updated: object,
  labels: Record<string, string>,
): string[] {
  const beforeFields = original as Record<string, unknown> | undefined;
  const afterFields = updated as Record<string, unknown>;
  return Object.entries(labels).flatMap(([field, label]) => {
    const before = String(beforeFields?.[field] ?? "").trim();
    const after = String(afterFields[field] ?? "").trim();
    return before === after ? [] : [`${subject} ${label}: ${before || "(trống)"} → ${after || "(trống)"}`];
  });
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("vi-VN");
}

function toDateInputValue(value?: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const match = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    // Sheet có thể trả DD/MM/YYYY hoặc MM/DD/YYYY. Giá trị > 12 giúp xác định chắc chắn thứ tự.
    const month = second > 12 && first <= 12 ? first : second;
    const day = second > 12 && first <= 12 ? second : first;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${match[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return "";
}

function toUtcDay(value: string | undefined): number | null {
  const normalized = toDateInputValue(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function formatEtaStatus(eta: string | undefined, ata: string | undefined, currentDay: number, language: "vi" | "en"): string | null {
  const etaDay = toUtcDay(eta);
  if (etaDay == null) return null;
  const actualDay = ata ? toUtcDay(ata) : currentDay;
  if (actualDay == null) return null;
  const diffDays = Math.round((actualDay - etaDay) / (24 * 60 * 60 * 1000));

  if (ata) {
    if (diffDays === 0) return language === "en" ? "Arrived on time" : "Giao đúng hạn";
    if (diffDays < 0) return language === "en" ? `${Math.abs(diffDays)} days early` : `Giao sớm ${Math.abs(diffDays)} ngày`;
    return language === "en" ? `${diffDays} days late` : `Giao trễ ${diffDays} ngày`;
  }

  if (diffDays === 0) return language === "en" ? "Due today" : "Dự kiến đến hôm nay";
  if (diffDays < 0) return language === "en" ? `${Math.abs(diffDays)} days remaining` : `Còn ${Math.abs(diffDays)} ngày`;
  return language === "en" ? `${diffDays} days late` : `Đang trễ ${diffDays} ngày`;
}

function isDateDetailField(field: string): boolean {
  const normalized = field
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return normalized.startsWith("ngay") || normalized === "etd" || normalized === "eta" || normalized === "ata";
}

function isMoneyDetailField(field: string): boolean {
  return ["sotiencoc", "sotienthanhtoan", "dongia", "giatong", "tongtien", "tienhang"]
    .includes(normalizeSheetField(field));
}

function isQuantityDetailField(field: string): boolean {
  return [
    "soluong",
    "sokien",
    "sohop",
    "socontainer",
    "trongluong",
    "trongluongcabi",
    "netweight",
    "grossweight",
    "khoiluongnet",
    "khoiluonggross",
  ].includes(normalizeSheetField(field));
}

function isPackageCountDetailField(field: string): boolean {
  return ["soluong", "sokien", "sohop"].includes(normalizeSheetField(field));
}

function isNetWeightDetailField(field: string): boolean {
  return [
    "trongluong",
    "trongluongcabi",
    "netweight",
    "grossweight",
    "khoiluongnet",
    "khoiluonggross",
  ].includes(normalizeSheetField(field));
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function DateFieldInput({
  id,
  value,
  disabled,
  label,
  onChange,
}: {
  id?: string;
  value?: string;
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const openPicker = () => {
    if (disabled || !inputRef.current) return;
    if (typeof inputRef.current.showPicker === "function") inputRef.current.showPicker();
    else inputRef.current.focus();
  };

  return (
    <div className="relative">
      <input
        id={id}
        ref={inputRef}
        type="date"
        value={toDateInputValue(value)}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="input-date-icon h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 pr-10 text-sm font-normal text-gray-800 outline-none transition-colors focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-500/10 disabled:cursor-not-allowed disabled:opacity-75 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:focus:border-brand-500"
      />
      <button
        type="button"
        aria-label={`Chọn ${label}`}
        disabled={disabled}
        onClick={openPicker}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-brand-500 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-700"
      >
        <CalendarIcon />
      </button>
    </div>
  );
}

function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return reject(new Error("Không đọc được file"));
      resolve(reader.result.includes(",") ? reader.result.split(",", 2)[1] : reader.result);
    };
    reader.onerror = () => reject(new Error("Không đọc được file"));
    reader.readAsDataURL(file);
  });
}

type OcrDocumentType = "PI" | "INV" | "PKL" | "BL";

const OCR_REQUIRED_FIELDS: Record<OcrDocumentType, string[]> = {
  PI: ["Số HĐ", "Ngày HĐ PI", "Nhà cung cấp", "XUẤT XỨ", "Tên hàng", "Giá tổng", "Đơn giá"],
  INV: ["INV", "Ngày INV", "Tên hàng", "Giá tổng", "Đơn giá"],
  PKL: ["Số kiện", "Trọng lượng NET"],
  BL: ["BL NO.", "Mã Container", "Hãng tàu", "Cảng đi", "Cảng đến", "ETD"],
};

const OCR_FIELD_ALIASES: Record<OcrDocumentType, Record<string, string[]>> = {
  PI: {
    "Số HĐ": ["Số HĐ", "Mã PI", "Số PI", "Order code"],
    "Ngày HĐ PI": ["Ngày HĐ PI", "Ngày PI", "Ngày HĐ"],
    "Nhà cung cấp": ["Nhà cung cấp", "NCC", "Supplier"],
    "XUẤT XỨ": ["XUẤT XỨ", "Xuất xứ", "Origin"],
    "Tên hàng": ["Tên hàng", "Tên sản phẩm", "Product"],
    "Giá tổng": ["Giá tổng", "Tổng tiền", "Total amount"],
    "Đơn giá": ["Đơn giá", "Unit price"],
  },
  INV: {
    INV: ["INV", "Mã INV", "Số INV", "Invoice No", "Invoice number"],
    "Ngày INV": ["Ngày INV", "Invoice date", "Ngày hóa đơn"],
    "Tên hàng": ["Tên hàng", "Tên sản phẩm", "Product"],
    "Giá tổng": ["Giá tổng", "Tổng tiền", "Total amount"],
    "Đơn giá": ["Đơn giá", "Unit price"],
  },
  PKL: {
    "Số kiện": ["Số kiện", "Số hộp", "Quantity", "Packages"],
    "Trọng lượng NET": ["Trọng lượng NET", "Net weight", "Trọng lượng", "Khối lượng net"],
  },
  BL: {
    "BL NO.": ["BL NO.", "BL", "Mã BL", "B/L", "Bill of lading"],
    "Mã Container": ["Mã Container", "Container", "Container No", "Số Container"],
    "Hãng tàu": ["Hãng tàu", "Carrier", "Shipping line"],
    "Cảng đi": ["Cảng đi", "POL", "Port of loading"],
    "Cảng đến": ["Cảng đến", "POD", "Port of discharge"],
    ETD: ["ETD", "Ngày khởi hành"],
  },
};

function normalizeSheetField(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]/g, "");
}

function formatSheetDateOnly(value: string): string {
  const normalized = toDateInputValue(value);
  if (normalized) {
    const [year, month, day] = normalized.split("-");
    return `${day}/${month}/${year}`;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(parsed);
  }

  return value;
}

function localizeSheetField(field: string, translate: (key: string) => string): string {
  const fieldKeys: Record<string, string> = {
    sohd: "orderNumber", ngayhdpi: "piDate", nhacungcap: "supplier", xuatxu: "origin",
    manhamay: "factoryCode", tenhang: "productName", itemcode: "itemCode",
    mahang: "itemCode", dongia: "unitPrice", unitprice: "unitPrice", giatong: "totalAmount",
    tongtien: "totalAmount", totalamount: "totalAmount", inv: "invoiceNumber", ngayinv: "invoiceDate",
    sohop: "quantity", soluong: "quantity", quantity: "quantity",
    trongluong: "netWeight", trongluongtinh: "netWeight", netweight: "netWeight",
    khoiluongnet: "netWeight", tiencoc: "depositAmount",
    sotiencoc: "depositAmount",
    sotienthanhtoan: "paymentAmount", tienthanhtoan: "paymentAmount", blno: "billNumber",
    mabl: "billNumber", macontainer: "containerCode", macont: "containerCode", macong: "containerCode",
    socontainer: "containerNumber", socont: "containerNumber", socong: "containerNumber",
    hangtau: "carrier", cangden: "destinationPort", lenhthahang: "releaseOrder",
    etd: "estimatedDeparture", eta: "estimatedArrival", ata: "actualArrival", trangthai: "status",
  };
  const key = fieldKeys[normalizeSheetField(field)];
  return key ? translate(key) : field;
}

type DetailFieldGroupKey = "purchasing" | "internationalPayment" | "orderDetails" | "importExport";

type DetailFieldDefinition = {
  sheetField: string;
  labelKey: string;
};

type DetailFieldGroup = {
  key: DetailFieldGroupKey;
  labelKey: string;
  descriptionKey: string;
  number: string;
  badgeClass: string;
  headerClass: string;
  fields: DetailFieldDefinition[];
};

const DETAIL_FIELD_GROUPS: DetailFieldGroup[] = [
  {
    key: "purchasing",
    labelKey: "detailGroupPurchasing",
    descriptionKey: "detailGroupPurchasingDescription",
    number: "01",
    badgeClass: "bg-brand-500 text-white",
    headerClass: "bg-brand-50/80 dark:bg-brand-500/10",
    fields: [
      { sheetField: "INV", labelKey: "invoiceNumber" },
      { sheetField: "Ngày INV", labelKey: "invoiceDate" },
      { sheetField: "Nhà cung cấp", labelKey: "supplier" },
      { sheetField: "XUẤT XỨ", labelKey: "origin" },
    ],
  },
  // {
  //   key: "internationalPayment",
  //   labelKey: "detailGroupInternationalPayment",
  //   descriptionKey: "detailGroupInternationalPaymentDescription",
  //   number: "02",
  //   badgeClass: "bg-success-500 text-white",
  //   headerClass: "bg-success-50/80 dark:bg-success-500/10",
  //   fields: [
  //     { sheetField: "Số tiền cọc", labelKey: "depositAmount" },
  //     { sheetField: "Số tiền thanh toán", labelKey: "paymentAmount" },
  //     { sheetField: "Lệnh thả hàng", labelKey: "releaseOrder" },
  //   ],
  // },
  {
    key: "orderDetails",
    labelKey: "detailGroupOrderDetails",
    descriptionKey: "detailGroupOrderDetailsDescription",
    number: "02",
    badgeClass: "bg-warning-500 text-white",
    headerClass: "bg-warning-50/80 dark:bg-warning-500/10",
    fields: [
      { sheetField: "Tên hàng", labelKey: "productName" },
      { sheetField: "Item code", labelKey: "itemCode" },
      { sheetField: "Đơn giá", labelKey: "unitPrice" },
      { sheetField: "Số hộp", labelKey: "quantity" },
      { sheetField: "Giá tổng", labelKey: "totalAmount" },
      { sheetField: "Trọng lượng", labelKey: "netWeight" },
    ],
  },
  {
    key: "importExport",
    labelKey: "detailGroupImportExport",
    descriptionKey: "detailGroupImportExportDescription",
    number: "03",
    badgeClass: "bg-purple-500 text-white",
    headerClass: "bg-purple-50/80 dark:bg-purple-500/10",
    fields: [
      { sheetField: "BL NO.", labelKey: "billNumber" },
      { sheetField: "Mã Container", labelKey: "containerCode" },
      { sheetField: "Số container", labelKey: "containerCount" },
      { sheetField: "Hãng tàu", labelKey: "carrier" },
      { sheetField: "Cảng đi", labelKey: "departurePort" },
      { sheetField: "Cảng đến", labelKey: "destinationPort" },
      { sheetField: "ETD", labelKey: "estimatedDeparture" },
      { sheetField: "ETA", labelKey: "estimatedArrival" },
      { sheetField: "ATA", labelKey: "actualArrival" },
    ],
  },
];

function findActualSheetField(fields: string[], wantedField: string): string {
  const wanted = normalizeSheetField(wantedField);
  return fields.find((field) => normalizeSheetField(field) === wanted) || wantedField;
}

function getDetailGroupGridClass(group: DetailFieldGroupKey): string {
  if (group === "internationalPayment") return "sm:grid-cols-3";
  if (group === "importExport") return "sm:grid-cols-6";
  if (group === "orderDetails") return "sm:grid-cols-2 xl:grid-cols-4";
  return "sm:grid-cols-2";
}

function getDetailFieldSpanClass(group: DetailFieldGroupKey, field: string): string {
  const normalized = normalizeSheetField(field);
  if (group === "orderDetails" && ["tenhang", "tensanpham"].includes(normalized)) {
    return "xl:col-span-2";
  }
  if (group === "importExport") {
    return isDateDetailField(field) ? "sm:col-span-2" : "sm:col-span-3";
  }
  return "";
}

function isReadOnlyDetailField(field: string): boolean {
  return ["stt", "sohd", "ordercode"].includes(normalizeSheetField(field));
}

type PurchaseDetailWithItems = PostgresShipmentRelations["details"][number];
type ShipmentContainer = ContainerRecord & { ma_bl: string };

function flattenContainerDetails(database?: PostgresShipmentRelations): ContainerDetailRecord[] {
  return database?.bills.flatMap((bill) => bill.containers.flatMap((container) => container.details)) || [];
}

function flattenShipmentContainers(database?: PostgresShipmentRelations): ShipmentContainer[] {
  return database?.bills.flatMap((bill) => bill.containers.map((container) => ({ ...container, ma_bl: bill.ma_bl }))) || [];
}

function formatQuantity(value: unknown): string {
  return formatInternationalNumber(value, 3);
}

function packageAmount(value: unknown): number {
  return parsePackageCount(value) ?? 0;
}

function formatPackageQuantity(value: unknown): string {
  return formatPackageCount(value);
}

function formatMoney(value: unknown): string {
  return formatMoneyAmount(value);
}

function formatOverviewGroupedNumber(value: unknown, fractionDigits?: number): string {
  const parsed = parseInternationalNumber(value);
  if (parsed == null) return String(value ?? "");
  return new Intl.NumberFormat("en-US", {
    useGrouping: true,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits ?? 3,
  }).format(parsed);
}

function formatOverviewPackageCount(value: unknown): string {
  const parsed = parsePackageCount(value);
  if (parsed == null) return String(value ?? "");
  return new Intl.NumberFormat("en-US", { useGrouping: true, maximumFractionDigits: 0 }).format(Math.round(parsed));
}

function formatOverviewNetWeight(value: unknown): string {
  const formatted = formatOverviewGroupedNumber(value, 2);
  return formatted ? `${formatted} KG` : "";
}

function formatOverviewMoney(value: unknown): string {
  const formatted = formatOverviewGroupedNumber(value, 2);
  if (!formatted) return "";
  const currency = getCurrencyText(value);
  return currency ? `${formatted} ${currency}` : formatted;
}

function formatDetailNumericValue(field: string, value: unknown): string {
  if (isMoneyDetailField(field)) return formatMoney(value);
  if (isPackageCountDetailField(field)) return formatPackageQuantity(value);
  if (isNetWeightDetailField(field)) return formatNetWeight(value);
  if (isQuantityDetailField(field)) return formatQuantity(value);
  return String(value ?? "");
}

function databaseNumberOrNull(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const parsed = toDatabaseNumber(value);
  if (parsed == null) throw new Error(`Giá trị số không hợp lệ: ${String(value)}. Dùng dấu chấm cho phần thập phân, ví dụ 1,234.56`);
  return parsed;
}

function databasePackageCountOrNull(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const parsed = toDatabasePackageCount(value);
  if (parsed == null) throw new Error(`Số kiện không hợp lệ: ${String(value)}. Có thể nhập 1377`);
  return parsed;
}

function PurchaseDetailsTable({
  group,
  details,
  containerDetails,
  editing,
  onChange,
  onItemChange,
  onAddItem,
  onAddRow,
  translate,
}: {
  group: Omit<DetailFieldGroup, "fields">;
  details: PurchaseDetailWithItems[];
  containerDetails: ContainerDetailRecord[];
  editing: boolean;
  onChange: (id: string, field: keyof PurchaseDetailRecord, value: string) => void;
  onItemChange: (detailId: string, itemId: string, field: "item_code" | "ma_nha_may", value: string) => void;
  onAddItem: (detailId: string) => void;
  onAddRow: () => void;
  translate: (key: string) => string;
}) {
  const tableRows = details.flatMap<{ detail: PurchaseDetailWithItems; item: PurchaseItemCodeRecord | null; itemIndex: number }>((detail) => (
    detail.itemCodes.length > 0
      ? detail.itemCodes.map((item, itemIndex) => ({ detail, item, itemIndex }))
      : [{ detail, item: null, itemIndex: 0 }]
  ));

  const getItemPackageCount = (detail: PurchaseDetailWithItems, item: PurchaseItemCodeRecord | null): string => {
    if (!item) return "";
    const allocations = containerDetails.filter((allocation) => allocation.id_item_code === item.id_item_code);
    if (allocations.length > 0) {
      return formatPackageQuantity(allocations.reduce((total, allocation) => total + packageAmount(allocation.so_kien), 0));
    }
    return detail.itemCodes.length === 1 ? formatPackageQuantity(detail.so_kien) : "";
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-700 dark:bg-white/[0.02]">
      <div className={`flex items-center gap-3 border-b border-gray-100 px-4 py-3.5 dark:border-gray-800 sm:px-5 ${group.headerClass}`}>
        <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-xs font-bold shadow-sm ${group.badgeClass}`}>{group.number}</span>
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-gray-900 dark:text-white">{translate(group.labelKey)}</h4>
          <p className="mt-0.5 text-xs leading-5 text-gray-500 dark:text-gray-400">{translate(group.descriptionKey)}</p>
        </div>
        {editing && <button type="button" onClick={onAddRow} className="ml-auto shrink-0 rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-600 hover:bg-brand-50 dark:border-brand-500/30 dark:bg-gray-900 dark:text-brand-300">{translate("addRow")}</button>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] table-fixed text-left xl:min-w-0">
          <colgroup>
            <col className="w-[6%]" />
            <col className="w-[39%]" />
            <col className="w-[35%]" />
            <col className="w-[20%]" />
          </colgroup>
          <thead className="bg-gray-50 text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">{translate("productName")}</th>
              <th className="px-4 py-3">{translate("itemCode")}<span className="mt-0.5 block text-[9px] font-medium normal-case tracking-normal">{translate("factoryCode")}</span></th>
              <th className="px-4 py-3">{translate("itemPackageCount")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {tableRows.map(({ detail, item, itemIndex }, rowIndex) => (
              <tr key={item?.id_item_code || `${detail.id_chi_tiet}-without-item-${rowIndex}`} className="align-top bg-white hover:bg-gray-50/60 dark:bg-transparent dark:hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-xs font-bold text-gray-500">{rowIndex + 1}</td>
                <EditableTableCell value={detail.ten_hang} editing={editing} onChange={(value) => onChange(detail.id_chi_tiet, "ten_hang", value)} />
                <td className="px-4 py-3">
                  <div className="space-y-2">
                    {item && (editing ? (
                      <div className="grid grid-cols-2 gap-1.5">
                        <input value={item.item_code || ""} onChange={(event) => onItemChange(detail.id_chi_tiet, item.id_item_code, "item_code", event.target.value)} placeholder="Item code" className="h-8 min-w-0 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                        <input value={item.ma_nha_may || ""} onChange={(event) => onItemChange(detail.id_chi_tiet, item.id_item_code, "ma_nha_may", event.target.value)} placeholder={translate("factoryCode")} className="h-8 min-w-0 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                      </div>
                    ) : item.item_code || item.ma_nha_may ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {item.item_code && <span className="rounded-md bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{item.item_code}</span>}
                        {item.ma_nha_may && <span className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">{item.ma_nha_may}</span>}
                      </div>
                    ) : null)}
                    {editing && itemIndex === 0 && (
                      <button type="button" onClick={() => onAddItem(detail.id_chi_tiet)} className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
                        {translate("addItemCode")}
                      </button>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  {getItemPackageCount(detail, item) || ""}{getItemPackageCount(detail, item) && detail.don_vi_kien ? ` ${detail.don_vi_kien}` : ""}
                </td>
              </tr>
            ))}
            {tableRows.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">{translate("noPurchaseDetails")}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EditableTableCell({ value, editing, onChange, suffix, displayFormatter }: { value: unknown; editing: boolean; onChange: (value: string) => void; suffix?: string | null; displayFormatter?: (value: unknown) => string }) {
  const text = value == null ? "" : String(value);
  const displayText = displayFormatter ? displayFormatter(value) : text;
  return (
    <td className="px-4 py-3">
      {editing ? (
        <input
          value={text}
          inputMode={displayFormatter ? "decimal" : undefined}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-full min-w-24 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-800 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        />
      ) : (
        <span className="text-sm text-gray-700 dark:text-gray-300">{displayText || "—"}{displayText && suffix ? ` ${suffix}` : ""}</span>
      )}
    </td>
  );
}

function ContainerCargoDetailsTable({
  details,
  containers,
  purchaseDetails,
  editing,
  onChange,
  onAddRow,
  expectedPackages,
  translate,
}: {
  details: ContainerDetailRecord[];
  containers: ShipmentContainer[];
  purchaseDetails: PurchaseDetailWithItems[];
  editing: boolean;
  onChange: (id: string, field: keyof ContainerDetailRecord, value: string) => void;
  onAddRow: () => void;
  expectedPackages: number;
  translate: (key: string) => string;
}) {
  const itemOptions = purchaseDetails.flatMap((purchaseDetail) => purchaseDetail.itemCodes
    .filter((item) => !item.id_item_code.startsWith("new-item-"))
    .map((item) => ({ item, purchaseDetail })));
  const allocatedPackages = details.reduce((total, detail) => total + packageAmount(detail.so_kien), 0);
  const packagesMatch = Math.abs(allocatedPackages - expectedPackages) < 0.0001;
  const allocationPending = !details.some((detail) => packageAmount(detail.so_kien) > 0);

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-700 dark:bg-white/[0.02]">
      <div className="flex items-center gap-3 border-b border-gray-100 bg-cyan-50/70 px-4 py-3.5 dark:border-gray-800 dark:bg-cyan-500/[0.06] sm:px-5">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-cyan-600 text-xs font-bold text-white shadow-sm">04</span>
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-gray-900 dark:text-white">{translate("containerCargoDetails")}</h4>
          <p className="mt-0.5 text-xs leading-5 text-gray-500 dark:text-gray-400">{translate("containerCargoDescription")}</p>
        </div>
        {editing && (
          <button type="button" onClick={onAddRow} className="ml-auto shrink-0 rounded-lg border border-cyan-200 bg-white px-3 py-1.5 text-xs font-semibold text-cyan-700 hover:bg-cyan-50 dark:border-cyan-500/30 dark:bg-gray-900 dark:text-cyan-300">
            {translate("addContainerCargo")}
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-left">
          <thead className="bg-gray-50 text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">{translate("billNumber")}</th>
              <th className="px-4 py-3">{translate("containerCode")}</th>
              <th className="px-4 py-3">{translate("productName")}</th>
              <th className="px-4 py-3">{translate("itemCode")}</th>
              <th className="px-4 py-3">{translate("packageCount")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {details.map((detail, index) => {
              const selectedContainer = containers.find((container) => container.id_bl_container === detail.id_bl_container);
              const selectedOption = itemOptions.find(({ item }) => item.id_item_code === detail.id_item_code);
              const selectedPurchaseDetailId = selectedOption?.purchaseDetail.id_chi_tiet || "";
              const itemCodesForProduct = itemOptions.filter(({ purchaseDetail }) => purchaseDetail.id_chi_tiet === selectedPurchaseDetailId);
              return (
                <tr key={detail.id_chi_tiet_container || `container-detail-${index}`} className="align-top hover:bg-gray-50/60 dark:hover:bg-white/[0.02]">
                  <td className="px-4 py-3 text-xs font-semibold text-gray-400">{index + 1}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200">{selectedContainer?.ma_bl || "—"}</td>
                  <td className="px-4 py-3">
                    {editing ? (
                      <select value={detail.id_bl_container} onChange={(event) => onChange(detail.id_chi_tiet_container, "id_bl_container", event.target.value)} className="h-9 min-w-40 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-800 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white">
                        <option value="">{translate("selectContainer")}</option>
                        {containers.map((container) => <option key={container.id_bl_container} value={container.id_bl_container}>{container.ma_container}</option>)}
                      </select>
                    ) : <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{selectedContainer?.ma_container || detail.id_bl_container || "—"}</span>}
                  </td>
                  <td className="px-4 py-3">
                    {editing ? (
                      <select
                        value={selectedPurchaseDetailId}
                        onChange={(event) => {
                          const firstItem = itemOptions.find(({ purchaseDetail }) => purchaseDetail.id_chi_tiet === event.target.value)?.item;
                          onChange(detail.id_chi_tiet_container, "id_item_code", firstItem?.id_item_code || "");
                        }}
                        className="h-9 min-w-52 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-800 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                      >
                        <option value="">{translate("selectProduct")}</option>
                        {purchaseDetails.filter((item) => item.itemCodes.some((code) => !code.id_item_code.startsWith("new-item-"))).map((item) => <option key={item.id_chi_tiet} value={item.id_chi_tiet}>{item.ten_hang}</option>)}
                      </select>
                    ) : <span className="text-sm text-gray-700 dark:text-gray-300">{selectedOption?.purchaseDetail.ten_hang || "—"}</span>}
                  </td>
                  <td className="px-4 py-3">
                    {editing ? (
                      <select value={detail.id_item_code} onChange={(event) => onChange(detail.id_chi_tiet_container, "id_item_code", event.target.value)} className="h-9 min-w-36 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-800 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white">
                        <option value="">{translate("selectItemCode")}</option>
                        {itemCodesForProduct.map(({ item }) => <option key={item.id_item_code} value={item.id_item_code}>{item.item_code}</option>)}
                      </select>
                    ) : <span className="rounded-md bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{selectedOption?.item.item_code || detail.id_item_code || "—"}</span>}
                  </td>
                  <EditableTableCell value={detail.so_kien} editing={editing} onChange={(value) => onChange(detail.id_chi_tiet_container, "so_kien", value)} displayFormatter={formatPackageQuantity} />
                </tr>
              );
            })}
            {details.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">{translate("noContainerCargo")}</td></tr>}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50/80 dark:border-gray-700 dark:bg-gray-900/60">
            <tr>
              <td colSpan={5} className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">{translate("containerPackageComparison")}</td>
              <td className={`px-4 py-3 text-sm font-bold ${allocationPending ? "text-gray-500 dark:text-gray-400" : packagesMatch ? "text-success-600 dark:text-success-400" : "text-error-600 dark:text-error-400"}`}>
                {formatPackageQuantity(allocatedPackages)} / {formatPackageQuantity(expectedPackages)} {allocationPending ? translate("quantityNotAllocated") : packagesMatch ? translate("quantityMatched") : translate("quantityNotMatched")}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function isDatabaseReadOnlyField(group: DetailFieldGroupKey, field: string): boolean {
  const normalized = normalizeSheetField(field);
  return group === "internationalPayment" || normalized === "xuatxu" || normalized === "socontainer";
}

function normalizeOcrFields(data: Record<string, string>, documentType: OcrDocumentType): Record<string, string> {
  const aliases = OCR_FIELD_ALIASES[documentType];
  const normalized = Object.fromEntries(OCR_REQUIRED_FIELDS[documentType].map((field) => {
    const wanted = new Set((aliases[field] || [field]).map(normalizeSheetField));
    const found = Object.entries(data).find(([key]) => wanted.has(normalizeSheetField(key)));
    return [field, String(found?.[1] ?? "").trim()];
  }));
  const optionalFields = documentType === "PI"
    ? ["id_ncc", "Item code"]
    : documentType === "INV"
      ? ["Item code"]
    : documentType === "BL"
      ? ["id_hang_tau"]
      : [];
  optionalFields.forEach((field) => {
    const wanted = normalizeSheetField(field);
    const found = Object.entries(data).find(([key]) => normalizeSheetField(key) === wanted);
    normalized[field] = String(found?.[1] ?? "").trim();
  });
  return normalized;
}

function getMissingOcrFields(fields: Record<string, string>, documentType: OcrDocumentType | null): string[] {
  if (!documentType) return [];
  return OCR_REQUIRED_FIELDS[documentType].filter((requiredField) => {
    const wanted = normalizeSheetField(requiredField);
    const match = Object.entries(fields).find(([field]) => normalizeSheetField(field) === wanted);
    return !match || !String(match[1] ?? "").trim();
  });
}

function getOcrDocumentType(documentCode: string): OcrDocumentType | null {
  const code = documentCode.toUpperCase();
  return code === "PI" || code === "INV" || code === "PKL" ? code : code === "BL" ? "BL" : null;
}

export default function ShipmentDetailModal({ shipment, isOpen, onClose, onRefresh }: ShipmentDetailModalProps) {
  const { user, permissions } = useAuth();
  const { notify } = useSystemNotification();
  const { confirm } = useSystemConfirm();
  const { language, t } = useLanguage();
  const [activeTab, setActiveTab] = useState<ModalTab>("overview");
  const [archived, setArchived] = useState<ArchivedDocumentsResponse | null>(null);
  const [isArchiveLoading, setIsArchiveLoading] = useState(false);
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);
  const [returnItem, setReturnItem] = useState<ReturnItem | null>(null);
  const [isReturnLoading, setIsReturnLoading] = useState(false);
  const [isReturnEditing, setIsReturnEditing] = useState(false);
  const [isSavingReturn, setIsSavingReturn] = useState(false);
  const [returnForm, setReturnForm] = useState<ReturnItem | null>(null);
  const [isDetailsEditing, setIsDetailsEditing] = useState(false);
  const [detailForm, setDetailForm] = useState<Record<string, string>>({});
  const [purchaseDetailForms, setPurchaseDetailForms] = useState<PurchaseDetailWithItems[]>([]);
  const [containerDetailForms, setContainerDetailForms] = useState<ContainerDetailRecord[]>([]);
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [currentDay] = useState(() => {
    const now = new Date();
    return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState("");
  const [isPreviewMaximized, setIsPreviewMaximized] = useState(false);
  const [isPreviewCollapsed, setIsPreviewCollapsed] = useState(false);
  const [ocrFilePreviewUrl, setOcrFilePreviewUrl] = useState<string | null>(null);
  const [localUploads, setLocalUploads] = useState<Record<string, string>>({});
  const [ocrUploadDocId, setOcrUploadDocId] = useState<string | null>(null);
  const [ocrUploadFile, setOcrUploadFile] = useState<File | null>(null);
  const [ocrUploadFileData, setOcrUploadFileData] = useState("");
  const [ocrUploadRequestId, setOcrUploadRequestId] = useState("");
  const pendingUploadRequestIds = React.useRef(new Map<string, string>());
  const [ocrUploadRows, setOcrUploadRows] = useState<Array<Record<string, string>>>([]);
  const [pklTargetDetailId, setPklTargetDetailId] = useState("");
  const [isOcrAnalyzing, setIsOcrAnalyzing] = useState(false);
  const [isOcrSaving, setIsOcrSaving] = useState(false);
  const [ocrUploadError, setOcrUploadError] = useState("");
  const [passingDocumentId, setPassingDocumentId] = useState<string | null>(null);
  const [locallyPassedDocumentIds, setLocallyPassedDocumentIds] = useState<string[]>([]);
  const [selectedMissingDocIds, setSelectedMissingDocIds] = useState<string[]>([]);
  const [isSendingEmail] = useState(false);
  const [emailSent] = useState(false);
  const [isOpeningTracking, setIsOpeningTracking] = useState(false);
  const [selectedTrackingCode, setSelectedTrackingCode] = useState("");
  const [openDocumentFileListId, setOpenDocumentFileListId] = useState<string | null>(null);
  const evergreenTrackingInProgress = React.useRef(false);
  const [trackingFeedback, setTrackingFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [, setDocumentProgress] = useState<DocumentProgressResponse | null>(null);
  const [documentProgressError, setDocumentProgressError] = useState("");
  const [supplierOptions, setSupplierOptions] = useState<SupplierRecord[]>([]);
  const [carrierOptions, setCarrierOptions] = useState<CarrierRecord[]>([]);
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseRecord[]>([]);

  const resetFilePreview = () => {
    setPreviewUrl(null);
    setPreviewName("");
    setIsPreviewMaximized(false);
    setIsPreviewCollapsed(false);
    setLocalUploads({});
    setOpenDocumentFileListId(null);
  };

  const handleModalClose = () => {
    resetFilePreview();
    onClose();
  };

  // Modal được giữ mounted giữa các lần chọn đơn, vì vậy phải xóa file của đơn cũ
  // cả khi đóng modal lẫn khi parent chuyển thẳng sang một shipment khác.
  useEffect(() => {
    setPreviewUrl(null);
    setPreviewName("");
    setIsPreviewMaximized(false);
    setIsPreviewCollapsed(false);
    setLocalUploads({});
    setOpenDocumentFileListId(null);
  }, [isOpen, shipment?.id]);

  useEffect(() => {
    setSelectedTrackingCode("");
  }, [shipment?.id]);

  useEffect(() => {
    if (previewUrl) setIsPreviewCollapsed(false);
  }, [previewUrl]);

  useEffect(() => {
    if (!ocrUploadFile) {
      setOcrFilePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(ocrUploadFile);
    setOcrFilePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [ocrUploadFile]);

  useEffect(() => {
    if (!ocrUploadDocId) return;
    const timer = window.setTimeout(() => {
      const documentType = getOcrDocumentType(ocrUploadDocId);
      setOcrUploadRows((current) => current.map((row) => {
        if (documentType === "PI") {
          const supplier = supplierOptions.find((item) => item.id_ncc === row.id_ncc)
            || findBestCatalogMatch(row["Nhà cung cấp"], supplierOptions, "ten_ncc");
          if (supplier) return { ...row, id_ncc: supplier.id_ncc, "Nhà cung cấp": supplier.ten_ncc, "XUẤT XỨ": String(supplier.quoc_gia || "") };
        }
        if (documentType === "BL") {
          const carrier = carrierOptions.find((item) => item.id_hang_tau === row.id_hang_tau)
            || findBestCatalogMatch(row["Hãng tàu"], carrierOptions, "ten_hang_tau");
          if (carrier) return { ...row, id_hang_tau: carrier.id_hang_tau, "Hãng tàu": carrier.ten_hang_tau };
        }
        return row;
      }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [carrierOptions, ocrUploadDocId, supplierOptions]);

  useEffect(() => {
    if (activeTab === "journey") {
      setTrackingFeedback(null);
    }
  }, [activeTab, shipment?.id]);

  useEffect(() => {
    if (!isOpen || !shipment) return;
    setDocumentProgress(null);
    setDocumentProgressError("");
    setOcrUploadDocId(null);
    setOcrUploadFile(null);
    setOcrUploadFileData("");
    setOcrUploadRequestId("");
    pendingUploadRequestIds.current.clear();
    setOcrUploadRows([]);
    setPklTargetDetailId("");
    setOcrUploadError("");
    setPassingDocumentId(null);
    setLocallyPassedDocumentIds([]);
    setArchived(null);
    setReturnItems([]);
    setReturnItem(null);
    setReturnForm(null);
    setIsReturnEditing(false);
    setDetailForm(shipment.summaryFields || {});
    setPurchaseDetailForms(shipment.database?.details || []);
    setContainerDetailForms(flattenContainerDetails(shipment.database));
    setIsDetailsEditing(false);
    setIsReturnLoading(true);
    void Promise.all([
      listDatabaseRows<SupplierRecord>(databaseEndpoints.suppliers),
      listDatabaseRows<CarrierRecord>(databaseEndpoints.carriers),
    ]).then(([suppliers, carriers]) => {
      setSupplierOptions(suppliers);
      setCarrierOptions(carriers);
    }).catch(() => {
      setSupplierOptions([]);
      setCarrierOptions([]);
    });
    setWarehouseOptions([]);
    void listDatabaseRows<WarehouseRecord>(databaseEndpoints.warehouses)
      .then(setWarehouseOptions)
      .catch(() => setWarehouseOptions([]));
    const databaseOrderId = shipment.database?.purchase.ma_hop_dong || shipment.orderCode;
    void fetchReturnItems(databaseOrderId)
      .then((results) => {
        const displayResults = results.map((result) => ({ ...result, soHd: shipment.orderCode }));
        const firstResult = displayResults[0] || null;
        setReturnItems(displayResults);
        setReturnItem(firstResult);
        setReturnForm(firstResult);
      })
      .catch(() => {
        setReturnItems([]);
        setReturnItem(null);
        setReturnForm(null);
      })
      .finally(() => setIsReturnLoading(false));
    void getArchivedDocuments(shipment.orderCode)
      .then((result) => setArchived(result.archived ? result : { success: true, archived: false }))
      // Đơn chưa có thư mục lưu trữ có thể được backend trả về dưới dạng lỗi/not found.
      // Đánh dấu là chưa lưu trữ để quyền admin/xnk vẫn hoạt động bình thường.
      .catch(() => setArchived({ success: true, archived: false }));
    void checkDocumentProgress(shipment.orderCode)
      .then(setDocumentProgress)
      .catch((progressError) => {
        setDocumentProgressError(progressError instanceof Error ? progressError.message : "Không thể kiểm tra tiến độ chứng từ");
      });
  }, [isOpen, shipment]);

  if (!shipment) return null;

  const isCancelled = shipment.status === "cancelled";
  const isArchived = archived?.archived === true;
  const canUploadDocuments = !isCancelled && !isArchived && permissions.uploadDocument;
  const canPassDocuments = !isCancelled && !isArchived && permissions.passDocument;
  const canArchiveDocuments = !isCancelled && !isArchived && permissions.archiveDocuments;
  const canEditReturnItem = !isCancelled && !isArchived && permissions.editReturnItem;
  const canEditDetails = !isCancelled && !isArchived && permissions.editShipmentDetails;
  const canCancelShipment = !isCancelled && !isArchived && permissions.cancelShipment;
  const shipmentContainers = flattenShipmentContainers(shipment.database);
  const billContainerRows = shipment.database?.bills.flatMap((bill) => (
    bill.containers.length > 0
      ? bill.containers.map((container) => ({
        key: container.id_bl_container,
        billNumber: bill.ma_bl,
        containerNumber: container.ma_container,
      }))
      : [{ key: `bill-${bill.ma_bl}`, billNumber: bill.ma_bl, containerNumber: "" }]
  )) || [];
  const summaryFields = shipment.summaryFields;
  const overviewInfo = {
    invoice: getSummaryValue(summaryFields, ["INV", "Mã INV", "Số INV"]),
    container: getSummaryValue(summaryFields, ["Số Container", "Mã Container", "Số cont", "Container"]),
    packageCount: getSummaryValue(summaryFields, ["Số kiện hàng", "Số kiện", "Số hộp"]),
    netWeight: getSummaryValue(summaryFields, ["Net weight", "Trọng lượng", "Trọng lượng tịnh"]),
    goodsValue: getSummaryValue(summaryFields, ["Tiền hàng", "Giá tổng", "Trị giá", "Tổng tiền"]),
    releaseOrder: getSummaryValue(summaryFields, ["Lệnh thả hàng", "Lệnh giao hàng", "Telex", "Telex release"]),
  };
  const overviewPackageCount = overviewInfo.packageCount && /^[\d\s.,]+$/.test(overviewInfo.packageCount)
    ? formatOverviewPackageCount(overviewInfo.packageCount)
    : overviewInfo.packageCount;
  const overviewGoodsValue = overviewInfo.goodsValue ? formatOverviewMoney(overviewInfo.goodsValue) : "";
  const packageUnits = Array.from(new Set(
    (shipment.database?.details || [])
      .map((detail) => String(detail.don_vi_kien || "").trim().toUpperCase())
      .filter(Boolean),
  ));
  const overviewPackageUnit = packageUnits.length === 1 ? packageUnits[0] : "CARTONS";
  const overviewPackageDisplay = overviewPackageCount ? `${overviewPackageCount} ${overviewPackageUnit}` : "";
  const overviewNetWeightDisplay = overviewInfo.netWeight ? formatOverviewNetWeight(overviewInfo.netWeight) : "";
  const overviewGoodsValueDisplay = overviewGoodsValue ? `${overviewGoodsValue} USD` : "USD";
  const etaStatus = formatEtaStatus(shipment.eta, shipment.ata, currentDay, language);
  const piDate = getSummaryValue(summaryFields, ["Ngày HĐ PI", "Ngày PI", "PI Date"]);
  const piDateDisplay = piDate ? formatSheetDateOnly(piDate) : "";
  // Mã hợp đồng đã nằm ở header và ngày PI được đưa lên cạnh mã đơn.
  const hiddenDetailFields = new Set(["stt", "sohd", "ordercode", "madonhang", "mapi", "sopi", "ngayhdpi", "ngaypi"]);
  const detailFields = (Object.keys(detailForm).length > 0 ? Object.keys(detailForm) : [...SUMMARY_FIELDS])
    .filter((field) => !hiddenDetailFields.has(normalizeSheetField(field)));
  const groupedDetailFields = DETAIL_FIELD_GROUPS.map((group) => ({
    ...group,
    fields: group.fields.map(({ sheetField, labelKey }) => ({
      field: findActualSheetField(detailFields, sheetField),
      labelKey,
    })),
  }));
  const stageLabelKeys: Record<NonNullable<Shipment["flowStageKey"]>, string> = {
    buying: "stageBuying",
    shipping: "stageShipping",
    arrived: "stageArrived",
    declared: "stageDeclared",
    fifteenb: "stageFifteenB",
    customs: "stageCustoms",
    delivered: "stageDelivered",
  };
  const flowLabel = isCancelled
    ? t("cancelledStatus")
    : shipment.flowStageKey
      ? t(stageLabelKeys[shipment.flowStageKey])
      : t({ cancelled: "cancelledStatus", shipping: "shipping", completed: "completed", missing_docs: "missingDocumentsStatus" }[shipment.status] || "status");
  const localizedFlowStages = FLOW_STAGES.map((stage) => ({
    ...stage,
    label: t(stageLabelKeys[stage.key]),
  }));
  const flowColor = isCancelled
    ? "text-error-600 bg-error-50 dark:bg-error-500/10 dark:text-error-400"
    : shipment.flowStageKey === "delivered"
      ? "text-success-600 bg-success-50 dark:bg-success-500/10"
      : shipment.flowStageKey === "buying"
        ? "text-amber-700 bg-amber-50 dark:bg-amber-500/10"
        : "text-blue-light-600 bg-blue-light-50 dark:bg-blue-light-500/10";
  const flowDotColor = isCancelled
    ? "bg-error-500"
    : shipment.flowStageKey === "delivered"
      ? "bg-success-500"
      : shipment.flowStageKey === "buying"
        ? "bg-amber-500"
        : "bg-blue-light-500";
  const documentsSorted = [...(shipment.documents || [])].map((document) => (
    locallyPassedDocumentIds.includes(document.id)
      ? { ...document, status: "ok" as const, url: undefined, urls: [], files: [], fileId: undefined, note: "Chứng từ đã được PASS" }
      : document
  )).sort((a, b) => {
    const orderA = DOCUMENT_DISPLAY_ORDER.indexOf(a.id.toUpperCase());
    const orderB = DOCUMENT_DISPLAY_ORDER.indexOf(b.id.toUpperCase());
    return (orderA < 0 ? Number.MAX_SAFE_INTEGER : orderA) - (orderB < 0 ? Number.MAX_SAFE_INTEGER : orderB);
  });
  const documentFileGroups = documentsSorted.map((document) => {
    const archivedFiles = archived?.archived
      ? (archived.files || []).filter((file) => file.fileName.toUpperCase().startsWith(`${shipment.orderCode}_${document.id}`.toUpperCase()))
      : [];
    const files = [
      ...(document.files?.length ? document.files : (document.urls?.length ? document.urls : document.url ? [document.url] : []).map((url) => ({ fileUrl: url, referenceCode: undefined, idChiTiet: undefined, fileName: undefined }))).map((file, index) => ({
        url: file.fileUrl,
        label: [
          file.referenceCode?.trim()
            || shipment.database?.details.find((detail) => detail.id_chi_tiet === file.idChiTiet)?.ten_hang,
          file.fileName?.trim() || t("documentFileIndex", { index: index + 1 }),
        ].filter(Boolean).join(" — "),
      })),
      ...archivedFiles.map((file) => ({ url: file.fileUrl, label: file.fileName })),
      ...(localUploads[document.id] && !document.url
        ? [{ url: localUploads[document.id], label: t("documentFileIndex", { index: 1 }) }]
        : []),
    ].filter((file, index, allFiles) => file.url && allFiles.findIndex((other) => other.url === file.url) === index);
    return { document, files };
  });
  const missingDocs = documentsSorted.filter(d => d.status === "missing" || d.status === "pending");
  const selectedMissingDocs = missingDocs.filter((doc) => selectedMissingDocIds.includes(doc.id));
  const isDocumentsComplete = shipment.docStatus === 1 || (
    shipment.totalDocs > 0 && shipment.receivedDocs >= shipment.totalDocs && missingDocs.length === 0
  );
  const activeStageDocs = shipment.flowStageKey && shipment.flowStageKey !== "delivered"
    ? STAGE_DOC_GROUPS[shipment.flowStageKey]
    : [];
  const activeMissingDocCodes = missingDocs
    .map((document) => document.id)
    .filter((code) => activeStageDocs.includes(code));
  const activeStageMessage = activeMissingDocCodes.length > 0
    ? `${t("missing")}: ${activeMissingDocCodes.join(", ")}`
    : t("processing");
  const carrierTrackingLink = findCarrierTrackingLink(shipment.vessel);
  const isEvergreenTracking = carrierTrackingLink?.name === "EVERGREEN";
  const isCkLineTracking = carrierTrackingLink?.name === "CK LINE";
  const isCmaTracking = carrierTrackingLink?.name === "CMA CGM";
  const fallbackContainers = (overviewInfo.container || "").split(",").map((code) => code.trim()).filter(Boolean);
  const fallbackBills = (shipment.bill || "").split(",").map((code) => code.trim()).filter(Boolean);
  const containerCodes = [...new Set([
    fallbackContainers[0],
    ...(shipment.database?.bills.flatMap((bill) => bill.containers.map((container) => container.ma_container)) || []),
  ].map((code) => code?.trim()).filter((code): code is string => Boolean(code)))];
  const billCodes = [...new Set([
    fallbackBills[0],
    ...(shipment.database?.bills.map((bill) => bill.ma_bl) || []),
  ].map((code) => code?.trim()).filter((code): code is string => Boolean(code)))];
  const trackingOptions = isEvergreenTracking
    ? (containerCodes.length ? containerCodes : fallbackContainers)
    : (billCodes.length ? billCodes : fallbackBills);
  const availableTrackingCodes = trackingOptions.length || !isCmaTracking
    ? trackingOptions
    : containerCodes.length ? containerCodes : fallbackContainers;
  const trackingCode = availableTrackingCodes.includes(selectedTrackingCode)
    ? selectedTrackingCode
    : availableTrackingCodes[0] || "";
  const evergreenContainerNo = isEvergreenTracking ? trackingCode : "";
  const carrierTrackingUrl = carrierTrackingLink?.buildUrl && !isEvergreenTracking && (trackingCode || isCkLineTracking)
    ? carrierTrackingLink.buildUrl(trackingCode)
    : null;
  const currentOcrDocumentType = ocrUploadDocId ? getOcrDocumentType(ocrUploadDocId) : null;
  const canAddOcrRows = currentOcrDocumentType === "PI" || currentOcrDocumentType === "INV" || currentOcrDocumentType === "BL";
  const ocrUploadFields = ocrUploadRows[0] || {};
  const missingOcrFields = getMissingOcrFields(ocrUploadFields, currentOcrDocumentType);
  ocrUploadRows.slice(1).forEach((row) => {
    getMissingOcrFields(row, currentOcrDocumentType).forEach((field) => {
      if (!missingOcrFields.includes(field)) missingOcrFields.push(field);
    });
  });
  if (currentOcrDocumentType === "PI" && !supplierOptions.some((supplier) => supplier.ten_ncc === ocrUploadFields["Nhà cung cấp"])) {
    if (!missingOcrFields.includes("Nhà cung cấp")) missingOcrFields.push("Nhà cung cấp");
  }
  if (currentOcrDocumentType === "BL" && !carrierOptions.some((carrier) => carrier.ten_hang_tau === ocrUploadFields["Hãng tàu"])) {
    if (!missingOcrFields.includes("Hãng tàu")) missingOcrFields.push("Hãng tàu");
  }
  if (currentOcrDocumentType === "BL" && !isDestinationPort(ocrUploadFields["Cảng đến"] || "")) {
    if (!missingOcrFields.includes("Cảng đến")) missingOcrFields.push("Cảng đến");
  }
  if (currentOcrDocumentType === "PKL" && shipment.database?.details.length !== 1 && !pklTargetDetailId) {
    missingOcrFields.push("Mặt hàng");
  }

  const updateOcrRowField = (rowIndex: number, key: string, value: string) => {
    const normalizedKey = normalizeSheetField(key);
    const sharedPiFields = new Set(["sohd", "ngayhdpi", "nhacungcap", "xuatxu", "idncc"]);
    const sharedInvFields = new Set(["inv", "ngayinv"]);
    const sharedBlFields = new Set(["blno", "hangtau", "idhangtau", "cangdi", "cangden", "etd"]);
    const updateEveryRow = currentOcrDocumentType === "PI"
      ? sharedPiFields.has(normalizedKey)
      : currentOcrDocumentType === "INV"
        ? sharedInvFields.has(normalizedKey)
      : currentOcrDocumentType === "BL" && sharedBlFields.has(normalizedKey);
    setOcrUploadRows((current) => current.map((row, index) => (
      updateEveryRow || index === rowIndex ? { ...row, [key]: value } : row
    )));
  };

  const updateOcrSupplier = (supplierName: string) => {
    const supplier = supplierOptions.find((item) => item.ten_ncc === supplierName);
    setOcrUploadRows((current) => current.map((row) => ({
      ...row,
      "Nhà cung cấp": supplierName,
      id_ncc: supplier?.id_ncc || "",
      "XUẤT XỨ": String(supplier?.quoc_gia || ""),
    })));
  };

  const updateOcrCarrier = (carrierName: string) => {
    const carrier = carrierOptions.find((item) => item.ten_hang_tau === carrierName);
    setOcrUploadRows((current) => current.map((row) => ({
      ...row,
      "Hãng tàu": carrierName,
      id_hang_tau: carrier?.id_hang_tau || "",
    })));
  };

  const addOcrRow = () => {
    if (!currentOcrDocumentType || !canAddOcrRows) return;
    setOcrUploadRows((current) => {
      const first = current[0] || {};
      const row = normalizeOcrFields({}, currentOcrDocumentType);
      if (currentOcrDocumentType === "PI") {
        ["Số HĐ", "Ngày HĐ PI", "Nhà cung cấp", "XUẤT XỨ", "id_ncc"].forEach((field) => { row[field] = first[field] || ""; });
      } else if (currentOcrDocumentType === "INV") {
        ["INV", "Ngày INV"].forEach((field) => { row[field] = first[field] || ""; });
      } else if (currentOcrDocumentType === "BL") {
        ["BL NO.", "Hãng tàu", "id_hang_tau", "Cảng đi", "Cảng đến", "ETD"].forEach((field) => { row[field] = first[field] || ""; });
      }
      return [...current, row];
    });
  };

  const removeOcrRow = (rowIndex: number) => {
    setOcrUploadRows((current) => current.length > 1 ? current.filter((_, index) => index !== rowIndex) : current);
  };

  const handleOpenCarrierTracking = async () => {
    if (!carrierTrackingLink?.usesBackendApi || !carrierTrackingUrl) return;

    setIsOpeningTracking(true);
    setTrackingFeedback(null);

    try {
      const response = await fetch(carrierTrackingUrl, {
        method: "GET",
        cache: "no-store",
      });
      const result = await response
        .json()
        .catch(() => ({})) as TrackingApiResponse;
      const message = result.message?.trim();

      if (!response.ok || result.success !== true) {
        throw new Error(
          message || `Không thể mở tracking ${carrierTrackingLink.name}.`,
        );
      }

      setTrackingFeedback({
        type: "success",
        message: message || `Đã mở tracking ${carrierTrackingLink.name}.`,
      });
    } catch (error) {
      setTrackingFeedback({
        type: "error",
        message: error instanceof Error
          ? error.message
          : `Không thể mở tracking ${carrierTrackingLink.name}.`,
      });
    } finally {
      setIsOpeningTracking(false);
    }
  };

  const handleExternalCarrierTracking = () => {
    if (!carrierTrackingUrl) return;
    const trackingWindow = window.open(
      carrierTrackingUrl,
      "carrier_tracking_popup",
      "popup=yes,width=1200,height=800,left=80,top=60,resizable=yes,scrollbars=yes",
    );
    if (!trackingWindow) notify("Trình duyệt đang chặn popup tracking. Vui lòng cho phép popup cho trang này.", "warning");
    else trackingWindow.focus();
  };

  const handleEvergreenTracking = async () => {
    if (!isEvergreenTracking || !evergreenContainerNo || evergreenTrackingInProgress.current) return;

    try {
      await submitEvergreenTracking(evergreenContainerNo, {
        requestLaunch: launchEvergreenTracking,
        showError: (message) => notify(message, "error"),
        onStarted: () => {
          evergreenTrackingInProgress.current = true;
          setIsOpeningTracking(true);
        },
      });
    } finally {
      evergreenTrackingInProgress.current = false;
      setIsOpeningTracking(false);
    }
  };

  const handlePickUpload = (docId: string) => {
    if (!canUploadDocuments || archived?.archived) return;
    setSelectedMissingDocIds([docId]);
    window.setTimeout(() => document.getElementById("shipment-document-upload")?.click(), 0);
  };

  const handlePassDocument = async (docId: string) => {
    if (getOcrDocumentType(docId) || !canPassDocuments || archived?.archived || passingDocumentId) return;
    const confirmed = await confirm({
      title: t("passDocumentTitle"),
      message: t("passDocumentMessage", { document: docId, orderCode: shipment.orderCode }),
      confirmText: t("passDocumentAction"),
      cancelText: t("goBack"),
    });
    if (!confirmed) return;

    setPassingDocumentId(docId);
    try {
      await passDriveDocument(shipment.orderCode, docId);
      setLocallyPassedDocumentIds((current) => current.includes(docId) ? current : [...current, docId]);
      recordActivity(user, {
        action: "PASS_DOCUMENT",
        location: `ShipmentDetailModal/Documents/${docId}`,
        detail: `Đánh dấu PASS chứng từ ${docId} cho đơn ${shipment.orderCode}`,
      });
      await onRefresh?.();
      try {
        setDocumentProgress(await checkDocumentProgress(shipment.orderCode));
        setDocumentProgressError("");
      } catch (progressError) {
        setDocumentProgressError(progressError instanceof Error ? progressError.message : "Không thể tải lại tiến độ chứng từ");
      }
      window.dispatchEvent(new Event(NOTIFICATIONS_SYNC_EVENT));
      notify(t("passDocumentSuccess", { document: docId }), "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : t("passDocumentError"), "error");
    } finally {
      setPassingDocumentId(null);
    }
  };

  const handleUploadSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const file = files[0];
    const docId = selectedMissingDocIds[0];
    if (!file || !docId || !canUploadDocuments || archived?.archived || isOcrAnalyzing || isOcrSaving) return;
    event.target.value = "";
    const documentType = getOcrDocumentType(docId);
    setOcrUploadError("");
    setOcrUploadRows([]);
    setPklTargetDetailId(documentType === "PKL" && shipment.database?.details.length === 1
      ? shipment.database.details[0].id_chi_tiet
      : "");
    try {
      if (files.some((selectedFile) => !isSupportedDocumentFile(selectedFile))) {
        setOcrUploadError("Định dạng file không được hỗ trợ.");
        return;
      }
      if (documentType && files.length > 1) {
        setOcrUploadError("Chứng từ có OCR chỉ xử lý từng file một để xác nhận kết quả.");
        return;
      }
      if (!documentType) {
        setIsOcrSaving(true);
        for (const selectedFile of files) {
          const fingerprint = `${shipment.orderCode}:${docId}:${selectedFile.name}:${selectedFile.size}:${selectedFile.lastModified}`;
          const requestId = pendingUploadRequestIds.current.get(fingerprint) || crypto.randomUUID();
          pendingUploadRequestIds.current.set(fingerprint, requestId);
          const fileData = await readFileAsBase64(selectedFile);
          await uploadDocument({
            action: "uploadDocument",
            orderCode: shipment.orderCode,
            documentCode: docId,
            fileName: selectedFile.name,
            fileData,
            mimeType: getDocumentMimeType(selectedFile),
            requestId,
          });
        }
        recordActivity(user, {
          action: "UPLOAD_DOCUMENT",
          location: "ShipmentDetailModal/Documents",
          detail: `Đã upload ${files.length} file chứng từ ${docId} cho đơn ${shipment.orderCode}`,
        });
        setLocalUploads((current) => ({ ...current, [docId]: URL.createObjectURL(files[files.length - 1]) }));
        await onRefresh?.();
        try {
          setDocumentProgress(await checkDocumentProgress(shipment.orderCode));
          setDocumentProgressError("");
        } catch (progressError) {
          setDocumentProgressError(progressError instanceof Error ? progressError.message : "Không thể tải lại tiến độ chứng từ");
        }
        notify(`Đã upload ${files.length} file chứng từ ${docId}`, "success");
        files.forEach((selectedFile) => {
          pendingUploadRequestIds.current.delete(`${shipment.orderCode}:${docId}:${selectedFile.name}:${selectedFile.size}:${selectedFile.lastModified}`);
        });
        return;
      }
      setOcrUploadFile(file);
      setOcrUploadDocId(docId);
      setOcrUploadRequestId(crypto.randomUUID());
      setIsOcrAnalyzing(true);
      const fileData = await readFileAsBase64(file);
      setOcrUploadFileData(fileData);
      const result = await analyzeDocument({ documentType, file });
      if (result.data.length === 0) throw new Error(`OCR ${documentType} không trả về dữ liệu`);
      const normalizedRows = result.data.map((analyzedFields) => {
        const normalizedFields = normalizeOcrFields(analyzedFields, documentType);
        if (normalizedFields["Cảng đến"]) normalizedFields["Cảng đến"] = normalizedFields["Cảng đến"].toUpperCase();
        if (documentType === "PI") {
          const supplier = supplierOptions.find((item) => item.id_ncc === normalizedFields.id_ncc)
            || findBestCatalogMatch(normalizedFields["Nhà cung cấp"], supplierOptions, "ten_ncc");
          if (supplier) {
            normalizedFields.id_ncc = supplier.id_ncc;
            normalizedFields["Nhà cung cấp"] = supplier.ten_ncc;
            normalizedFields["XUẤT XỨ"] = String(supplier.quoc_gia || "");
          }
        }
        if (documentType === "BL") {
          const carrier = carrierOptions.find((item) => item.id_hang_tau === normalizedFields.id_hang_tau)
            || findBestCatalogMatch(normalizedFields["Hãng tàu"], carrierOptions, "ten_hang_tau");
          if (carrier) {
            normalizedFields.id_hang_tau = carrier.id_hang_tau;
            normalizedFields["Hãng tàu"] = carrier.ten_hang_tau;
          }
        }
        return normalizedFields;
      });
      setOcrUploadRows(normalizedRows);
    } catch (error) {
      setOcrUploadError(error instanceof Error ? error.message : "Không thể upload hoặc phân tích chứng từ");
      setOcrUploadFile(null);
      setOcrUploadDocId(null);
      setOcrUploadFileData("");
      setOcrUploadRequestId("");
      setOcrUploadRows([]);
      setPklTargetDetailId("");
    } finally {
      setIsOcrAnalyzing(false);
      setIsOcrSaving(false);
      setSelectedMissingDocIds([]);
    }
  };

  const handleConfirmOcrUpload = async () => {
    if (!ocrUploadDocId || !ocrUploadFile || !ocrUploadFileData || !ocrUploadRequestId || !canUploadDocuments || isOcrSaving) return;
    const documentType = getOcrDocumentType(ocrUploadDocId);
    const missingFields = ocrUploadRows.flatMap((row) => getMissingOcrFields(row, documentType));
    if (documentType === "PKL" && shipment.database?.details.length !== 1 && !pklTargetDetailId) {
      missingFields.push("Mặt hàng");
    }
    if (missingFields.length > 0) {
      setOcrUploadError(t("requiredMissing", { fields: missingFields.map((field) => localizeSheetField(field, t)).join(", ") }));
      return;
    }
    if (documentType === "BL") {
      const firstBillCode = ocrUploadRows[0]?.["BL NO."]?.trim().toUpperCase();
      if (ocrUploadRows.some((row) => row["BL NO."]?.trim().toUpperCase() !== firstBillCode)) {
        setOcrUploadError(t("oneBillPerFile"));
        return;
      }
    }
    setIsOcrSaving(true);
    setOcrUploadError("");
    try {
      await uploadDocument({
        action: "uploadDocument",
        orderCode: shipment.orderCode,
        documentCode: ocrUploadDocId,
        fileName: ocrUploadFile.name,
        fileData: ocrUploadFileData,
        mimeType: getDocumentMimeType(ocrUploadFile),
        requestId: ocrUploadRequestId,
        ...(documentType === "BL" ? { referenceCode: ocrUploadRows[0]?.["BL NO."]?.trim() } : {}),
        ...(documentType === "PKL" ? { idChiTiet: pklTargetDetailId } : {}),
      });

      const data = Object.fromEntries(
      Object.entries(ocrUploadRows[0] || {}).filter(([key, value]) => !key.startsWith("_") && value.trim()),
      ) as Record<string, string>;
      delete data.documentType;
      delete data.fileName;
      const changedOcrFields = Object.entries(data).filter(([field, nextValue]) => (
        nextValue.trim() !== getOriginalSummaryValue(shipment.summaryFields, field)
      ));
      if (!shipment.database) throw new Error("Không tìm thấy quan hệ PostgreSQL của đơn hàng");
      if (documentType === "BL") {
        await savePostgresBlOcrRows(shipment.database, ocrUploadRows);
      } else if (documentType === "PI") {
        await savePostgresPiOcrRows(shipment.database, ocrUploadRows);
      } else if (documentType === "INV") {
        await savePostgresInvOcrRows(shipment.database, ocrUploadRows);
      } else if (documentType === "PKL") {
        await savePostgresPklOcrRow(shipment.database, ocrUploadRows[0] || {}, pklTargetDetailId);
      } else {
        await updatePostgresShipmentFields(shipment.database, data);
      }
      if (changedOcrFields.length > 0) {
        recordActivity(user, {
          action: "UPLOAD_OCR_DOCUMENT",
          location: `ShipmentDetailModal/Documents/${ocrUploadDocId}`,
          detail: describeFieldChanges(shipment.orderCode, changedOcrFields, shipment.summaryFields),
        });
      } else {
        recordActivity(user, {
          action: "UPLOAD_OCR_DOCUMENT",
          location: `ShipmentDetailModal/Documents/${ocrUploadDocId}`,
          detail: `Đã upload chứng từ ${ocrUploadDocId} cho đơn ${shipment.orderCode}`,
        });
      }
      setLocalUploads((current) => ({ ...current, [ocrUploadDocId]: URL.createObjectURL(ocrUploadFile) }));
      await onRefresh?.();
      try {
        setDocumentProgress(await checkDocumentProgress(shipment.orderCode));
        setDocumentProgressError("");
      } catch (progressError) {
        setDocumentProgressError(progressError instanceof Error ? progressError.message : "Không thể tải lại tiến độ chứng từ");
      }
      setOcrUploadFile(null);
      setOcrUploadDocId(null);
      setOcrUploadFileData("");
      setOcrUploadRequestId("");
      setOcrUploadRows([]);
      setPklTargetDetailId("");
      notify(`Đã bổ sung và cập nhật chứng từ ${ocrUploadDocId}`, "success");
    } catch (error) {
      setOcrUploadError(error instanceof Error ? error.message : "Không thể lưu chứng từ");
    } finally {
      setIsOcrSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!canArchiveDocuments || !isDocumentsComplete || archived?.archived || isArchiveLoading) return;
    // Bước 2: kiểm tra dữ liệu đầu vào của tab Chi tiết và tab Vận chuyển container
    // trước khi cho gọi hàm Apps Script di chuyển hồ sơ.
    const missingDetailFields = getMissingArchiveDetailFields(shipment.summaryFields);
    const transportItems = returnItems.length > 0
      ? returnItems
      : returnForm ? [returnForm] : [];
    const missingTransportFields = getMissingArchiveTransportFields(transportItems);
    if (missingDetailFields.length > 0 || missingTransportFields.length > 0) {
      const detailMessage = missingDetailFields.length > 0
        ? `Chi tiết: ${missingDetailFields.join(", ")}`
        : "";
      const transportMessage = missingTransportFields.length > 0
        ? `Vận chuyển container: ${missingTransportFields.join(" | ")}`
        : "";
      notify([detailMessage, transportMessage].filter(Boolean).join(" — "), "warning");
      return;
    }
    setIsArchiveLoading(true);
    try {
      await moveCompletedOrder(shipment.orderCode);
      recordActivity(user, {
        action: "ARCHIVE_DOCUMENTS",
        location: "ShipmentDetailModal/Documents",
        detail: `Lưu trữ chứng từ đơn ${shipment.orderCode}`,
      });
      const result = await getArchivedDocuments(shipment.orderCode);
      setArchived(result);
      setActiveTab("documents");
      notify(`Đã lưu trữ hồ sơ đơn ${shipment.orderCode}`, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể lưu trữ hồ sơ", "error");
    } finally {
      setIsArchiveLoading(false);
    }
  };

  const handleToggleDetailsEditing = () => {
    if (isDetailsEditing) {
      setPurchaseDetailForms(shipment.database?.details || []);
      setContainerDetailForms(flattenContainerDetails(shipment.database));
      setIsDetailsEditing(false);
      return;
    }
    setPurchaseDetailForms((current) => current.map((detail, index) => (
      detail.itemCodes.length > 0
        ? detail
        : {
          ...detail,
          itemCodes: [{
            id_item_code: `new-item-${detail.id_chi_tiet}-${index}`,
            id_chi_tiet: detail.id_chi_tiet,
            item_code: "",
            ma_nha_may: "",
          }],
        }
    )));
    setIsDetailsEditing(true);
  };

  const handleSaveDetails = async () => {
    if (!canEditDetails || isSavingDetails) return;
    const etdEntry = Object.entries(detailForm).find(([field]) => normalizeSheetField(field) === "etd");
    const etaEntry = Object.entries(detailForm).find(([field]) => normalizeSheetField(field) === "eta");
    const etd = toDateInputValue(etdEntry?.[1]);
    const eta = toDateInputValue(etaEntry?.[1]);
    if (etd && eta && eta < etd) {
      notify(t("etaBeforeEtd"), "error");
      return;
    }
    const data: Record<string, string> = {};
    Object.entries(detailForm).forEach(([field, nextValue]) => {
      const normalizedField = field.trim().toLowerCase();
      if (normalizedField === "số hđ" || normalizedField === "stt" || normalizedField === "order_code" || normalizedField === "order code") return;
      if (nextValue !== (shipment.summaryFields?.[field] || "")) data[field] = nextValue;
    });
    const newPurchaseDetails = purchaseDetailForms.filter((draft) => draft.id_chi_tiet.startsWith("new-"));
    const changedPurchaseDetails = purchaseDetailForms.filter((draft) => {
      if (draft.id_chi_tiet.startsWith("new-")) return false;
      const original = shipment.database?.details.find((item) => item.id_chi_tiet === draft.id_chi_tiet);
      return !original || ["ten_hang", "so_kien", "net_weight", "don_gia", "tong_gia"].some((field) => (
        String(draft[field as keyof PurchaseDetailRecord] ?? "") !== String(original[field as keyof PurchaseDetailRecord] ?? "")
      ));
    });
    const changedItemCodes = purchaseDetailForms.flatMap((draft) => draft.itemCodes.filter((item) => {
      if (item.id_item_code.startsWith("new-item-")) return false;
      const originalDetail = shipment.database?.details.find((detail) => detail.id_chi_tiet === draft.id_chi_tiet);
      const original = originalDetail?.itemCodes.find((candidate) => candidate.id_item_code === item.id_item_code);
      return !original || item.item_code !== original.item_code || String(item.ma_nha_may || "") !== String(original.ma_nha_may || "");
    }));
    const newItemCodes = purchaseDetailForms.flatMap((detail) => (
      detail.id_chi_tiet.startsWith("new-")
        ? []
        : detail.itemCodes
          .filter((item) => item.id_item_code.startsWith("new-item-") && (item.item_code.trim() || String(item.ma_nha_may || "").trim()))
          .map((item) => ({ detailId: detail.id_chi_tiet, item }))
    ));
    const invalidNewRowIndex = newPurchaseDetails.findIndex((detail) => !detail.ten_hang.trim());
    if (invalidNewRowIndex >= 0) {
      notify(`Dòng mới ${invalidNewRowIndex + 1} chưa có tên hàng`, "error");
      return;
    }
    const originalContainerDetails = flattenContainerDetails(shipment.database);
    const newContainerDetails = containerDetailForms.filter((detail) => detail.id_chi_tiet_container.startsWith("new-container-detail-"));
    const changedContainerDetails = containerDetailForms.filter((detail) => {
      if (detail.id_chi_tiet_container.startsWith("new-container-detail-")) return false;
      const original = originalContainerDetails.find((item) => item.id_chi_tiet_container === detail.id_chi_tiet_container);
      return !original || ["id_bl_container", "id_item_code", "so_kien"].some((field) => (
        String(detail[field as keyof ContainerDetailRecord] ?? "") !== String(original[field as keyof ContainerDetailRecord] ?? "")
      ));
    });
    const containerAllocationChanged = newContainerDetails.length > 0 || changedContainerDetails.some((detail) => {
      const original = originalContainerDetails.find((item) => item.id_chi_tiet_container === detail.id_chi_tiet_container);
      return !original || detail.id_bl_container !== original.id_bl_container || detail.id_item_code !== original.id_item_code
        || packageAmount(detail.so_kien) !== packageAmount(original.so_kien);
    });
    const purchaseQuantityChanged = newPurchaseDetails.some((detail) => packageAmount(detail.so_kien) !== 0)
      || changedPurchaseDetails.some((detail) => {
        const original = shipment.database?.details.find((item) => item.id_chi_tiet === detail.id_chi_tiet);
        return packageAmount(detail.so_kien) !== packageAmount(original?.so_kien);
      });
    const touchedContainerDetailIds = new Set([...newContainerDetails, ...changedContainerDetails].map((detail) => detail.id_chi_tiet_container));
    const invalidContainerDetailIndex = containerDetailForms.findIndex((detail) =>
      touchedContainerDetailIds.has(detail.id_chi_tiet_container) && (!detail.id_bl_container || !detail.id_item_code));
    if (invalidContainerDetailIndex >= 0) {
      notify(`Dòng chi tiết container ${invalidContainerDetailIndex + 1} chưa chọn container hoặc Item Code`, "error");
      return;
    }
    const expectedPackageTotal = purchaseDetailForms.reduce((total, detail) => total + packageAmount(detail.so_kien), 0);
    const allocatedPackageTotal = containerDetailForms.reduce((total, detail) => total + packageAmount(detail.so_kien), 0);
    const mustValidatePackages = shouldValidateContainerPackages(
      containerDetailForms.some((detail) => packageAmount(detail.so_kien) > 0),
      purchaseQuantityChanged,
      containerAllocationChanged,
    );
    if (mustValidatePackages && Math.abs(expectedPackageTotal - allocatedPackageTotal) >= 0.0001) {
      notify(t("containerQuantityMismatch", { allocated: formatPackageQuantity(allocatedPackageTotal), expected: formatPackageQuantity(expectedPackageTotal) }), "error");
      return;
    }
    const mismatchedProduct = mustValidatePackages && purchaseDetailForms.find((purchaseDetail) => {
      const itemIds = new Set(purchaseDetail.itemCodes
        .filter((item) => !item.id_item_code.startsWith("new-item-"))
        .map((item) => item.id_item_code));
      if (itemIds.size === 0) return false;
      const allocated = containerDetailForms
        .filter((detail) => itemIds.has(detail.id_item_code))
        .reduce((total, detail) => total + packageAmount(detail.so_kien), 0);
      return Math.abs(allocated - packageAmount(purchaseDetail.so_kien)) >= 0.0001;
    });
    if (mismatchedProduct) {
      const itemIds = new Set(mismatchedProduct.itemCodes.map((item) => item.id_item_code));
      const allocated = containerDetailForms
        .filter((detail) => itemIds.has(detail.id_item_code))
        .reduce((total, detail) => total + packageAmount(detail.so_kien), 0);
      notify(t("productContainerQuantityMismatch", {
        product: mismatchedProduct.ten_hang,
        allocated: formatPackageQuantity(allocated),
        expected: formatPackageQuantity(mismatchedProduct.so_kien),
      }), "error");
      return;
    }
    if (Object.keys(data).length === 0 && changedPurchaseDetails.length === 0 && changedItemCodes.length === 0 && newItemCodes.length === 0 && newPurchaseDetails.length === 0 && changedContainerDetails.length === 0 && newContainerDetails.length === 0) {
      setIsDetailsEditing(false);
      return;
    }
    setIsSavingDetails(true);
    try {
      if (!shipment.database) throw new Error("Không tìm thấy quan hệ PostgreSQL của đơn hàng");
      await Promise.all([
        updatePostgresShipmentFields(shipment.database, data),
        ...changedPurchaseDetails.map((detail) => updateDatabaseRow<PurchaseDetailRecord>(
          databaseEndpoints.purchaseDetails,
          detail.id_chi_tiet,
          {
            ten_hang: detail.ten_hang,
            so_kien: databasePackageCountOrNull(detail.so_kien),
            net_weight: databaseNumberOrNull(detail.net_weight),
            don_gia: databaseNumberOrNull(detail.don_gia),
            tong_gia: databaseNumberOrNull(detail.tong_gia),
          },
        )),
        ...changedItemCodes.map((item) => updateDatabaseRow<PurchaseItemCodeRecord>(
          databaseEndpoints.itemCodes,
          item.id_item_code,
          {
            item_code: item.item_code,
            ma_nha_may: item.ma_nha_may || null,
          },
        )),
        ...changedContainerDetails.map((detail) => updateDatabaseRow<ContainerDetailRecord>(
          databaseEndpoints.containerDetails,
          detail.id_chi_tiet_container,
          {
            id_bl_container: detail.id_bl_container,
            id_item_code: detail.id_item_code,
            so_kien: databasePackageCountOrNull(detail.so_kien),
          },
        )),
      ]);
      for (const detail of newPurchaseDetails) {
        const created = await createDatabaseRow<PurchaseDetailRecord>(databaseEndpoints.purchaseDetails, {
          ma_hop_dong: shipment.database.purchase.ma_hop_dong,
          ten_hang: detail.ten_hang.trim(),
          so_kien: databasePackageCountOrNull(detail.so_kien),
          net_weight: databaseNumberOrNull(detail.net_weight),
          don_gia: databaseNumberOrNull(detail.don_gia),
          tong_gia: databaseNumberOrNull(detail.tong_gia),
          don_vi_kien: detail.don_vi_kien || null,
        });
        for (const item of detail.itemCodes) {
          if (!item.item_code.trim()) continue;
          if (!created.id_chi_tiet) throw new Error("Backend không trả id_chi_tiet cho dòng hàng mới");
          await createDatabaseRow<PurchaseItemCodeRecord>(databaseEndpoints.itemCodes, {
            id_chi_tiet: created.id_chi_tiet,
            item_code: item.item_code.trim(),
            ma_nha_may: item.ma_nha_may || "",
          });
        }
      }
      for (const { detailId, item } of newItemCodes) {
        await createDatabaseRow<PurchaseItemCodeRecord>(databaseEndpoints.itemCodes, {
          id_chi_tiet: detailId,
          item_code: item.item_code.trim(),
          ma_nha_may: String(item.ma_nha_may || "").trim(),
        });
      }
      for (const detail of newContainerDetails) {
        await createDatabaseRow<ContainerDetailRecord>(databaseEndpoints.containerDetails, {
          id_bl_container: detail.id_bl_container,
          id_item_code: detail.id_item_code,
          so_kien: databasePackageCountOrNull(detail.so_kien),
        });
      }
      const logChanges = [
        ...Object.entries(data).map(([field, value]) => {
          const before = getOriginalSummaryValue(shipment.summaryFields, field).trim();
          return `${field}: ${before || "(trống)"} → ${value.trim() || "(trống)"}`;
        }),
        ...newPurchaseDetails.map((detail) => `thêm hàng ${detail.ten_hang}`),
        ...newPurchaseDetails.flatMap((detail) => detail.itemCodes
          .filter((item) => item.item_code.trim())
          .map((item) => `hàng ${detail.ten_hang} Item Code ${item.item_code}${item.ma_nha_may ? ` (${item.ma_nha_may})` : ""}`)),
        ...changedPurchaseDetails.flatMap((detail) => describeEditedFields(
          `hàng ${detail.ten_hang}`,
          shipment.database?.details.find((item) => item.id_chi_tiet === detail.id_chi_tiet),
          detail,
          { ten_hang: "Tên hàng", so_kien: "Số kiện", net_weight: "NET", don_gia: "Đơn giá", tong_gia: "Tổng tiền" },
        )),
        ...newItemCodes.map(({ item }) => `thêm Item Code ${item.item_code}${item.ma_nha_may ? ` (${item.ma_nha_may})` : ""}`),
        ...changedItemCodes.flatMap((item) => {
          const original = shipment.database?.details.flatMap((detail) => detail.itemCodes).find((candidate) => candidate.id_item_code === item.id_item_code);
          return describeEditedFields(
            `Item Code ${original?.item_code || item.id_item_code}`,
            original,
            item,
            { item_code: "Mã", ma_nha_may: "Mã nhà máy" },
          );
        }),
        ...newContainerDetails.map((detail) => `thêm chi tiết container ${detail.id_bl_container}: ${detail.so_kien || 0} kiện`),
        ...changedContainerDetails.flatMap((detail) => describeEditedFields(
          `container ${detail.id_bl_container}`,
          originalContainerDetails.find((item) => item.id_chi_tiet_container === detail.id_chi_tiet_container),
          detail,
          { id_bl_container: "Container", id_item_code: "Item Code", so_kien: "Số kiện" },
        )),
      ];
      recordActivity(user, {
        action: "EDIT_SHIPMENT_DETAILS",
        location: "ShipmentDetailModal/Details",
        detail: `Đơn ${shipment.orderCode}; ${logChanges.join(" | ")}`,
      });
      await onRefresh?.();
      setIsDetailsEditing(false);
      notify("Đã cập nhật chi tiết đơn hàng", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể cập nhật chi tiết đơn hàng", "error");
    } finally {
      setIsSavingDetails(false);
    }
  };

  const handleSaveReturn = async () => {
    if (!canEditReturnItem || !returnForm || isSavingReturn) return;
    setIsSavingReturn(true);
    try {
      await savePostgresReturnItem(returnForm);
      recordActivity(user, {
        action: "EDIT_RETURN_ITEM",
        location: "ShipmentDetailModal/ReturnItem",
        detail: `Cập nhật vận chuyển Container ${returnForm.soCont} của đơn ${shipment.orderCode}`,
      });
      const refreshed = await fetchReturnItems(shipment.database?.purchase.ma_hop_dong || shipment.orderCode);
      const displayResults = refreshed.map((item) => ({ ...item, soHd: shipment.orderCode }));
      const displayResult = displayResults.find((item) => item.idBlContainer === returnForm.idBlContainer) || displayResults[0] || null;
      setReturnItems(displayResults);
      setReturnItem(displayResult);
      setReturnForm(displayResult || returnForm);
      setIsReturnEditing(false);
      notify("Đã cập nhật thông tin vận chuyển Container", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể cập nhật thông tin vận chuyển Container", "error");
    } finally {
      setIsSavingReturn(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!canCancelShipment || isCancelling) return;

    const confirmed = await confirm({
      title: t("cancelShipmentTitle"),
      message: t("cancelShipmentMessage", { orderCode: shipment.orderCode }),
      confirmText: t("cancelShipmentAction"),
      cancelText: t("goBack"),
      tone: "danger",
    });
    if (!confirmed) return;

    setIsCancelling(true);
    try {
      await cancelPostgresShipment(shipment.database?.purchase.ma_hop_dong || shipment.orderCode);
      recordActivity(user, {
        action: "CANCEL_SHIPMENT",
        location: "ShipmentDetailModal/Details",
        detail: `Chuyển đơn ${shipment.orderCode} sang trạng thái Hủy`,
      });
      await onRefresh?.();
      notify(`Đã chuyển đơn ${shipment.orderCode} sang trạng thái Hủy`, "success");
      handleModalClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể cập nhật trạng thái đơn hàng", "error");
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={handleModalClose}
      contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
      className={`mx-2 my-2 flex h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-5xl flex-col overflow-hidden transition-[width,transform] duration-300 sm:mx-4 sm:my-4 sm:h-[94vh] sm:w-full ${previewUrl && !isPreviewCollapsed && !isPreviewMaximized ? "md:w-[calc(50vw-1.5rem)] md:max-w-none md:-translate-x-1/2" : ""}`}
    >
      {/* Header */}
      <div className="flex shrink-0 flex-col gap-3 border-b border-gray-100 px-4 pb-4 pt-5 dark:border-gray-800 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:pb-4 sm:pt-6">
        <div className="min-w-0 flex flex-col gap-1 pr-10 sm:pr-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
            <h2 className="min-w-0 break-all text-base font-bold tracking-wide text-gray-900 dark:text-white sm:text-lg font-mono">
              {shipment.orderCode}
            </h2>
            <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${flowColor}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${flowDotColor}`} />
              <span className="truncate">{flowLabel}</span>
            </span>
          </div>
          {piDateDisplay && (
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {t("piDate")}: <span className="font-semibold text-gray-700 dark:text-gray-200">{piDateDisplay}</span>
            </p>
          )}
          <p className="break-words text-sm text-gray-500 dark:text-gray-400">{shipment.shipName}</p>
          <p className="break-words text-xs text-gray-400">{t("supplierPrefix", { supplier: shipment.supplier })}</p>
        </div>

        {/* Missing docs badge */}
      </div>

      {/* Tabs */}
      <div className="flex flex-shrink-0 flex-wrap items-center gap-1 border-b border-gray-100 px-3 py-2 no-scrollbar dark:border-gray-800 sm:flex-nowrap sm:overflow-x-auto sm:px-6">
        {TAB_LIST.filter((tab) => tab.key !== "folder" || archived?.archived).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`inline-flex min-w-0 basis-[calc(50%-0.25rem)] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-xs font-medium transition-all duration-150 sm:basis-auto sm:flex-shrink-0 sm:flex-none sm:justify-start sm:px-3 sm:py-1.5 ${
              activeTab === tab.key
                ? "bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"
                : "text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200"
            }`}
          >
            {tab.icon}
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      <input id="shipment-document-upload" type="file" className="hidden" accept={DOCUMENT_FILE_ACCEPT} onChange={handleUploadSelected} />

      {/* Tab Content */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 custom-scrollbar sm:px-6 sm:py-5">

        {isCancelled && (
          <div className="mb-4 rounded-xl bg-error-50 px-4 py-3 text-sm font-medium text-error-600 dark:bg-error-500/10 dark:text-error-400">
            {t("cancelledReadOnly")}
          </div>
        )}

        {canUploadDocuments && (isOcrAnalyzing || ocrUploadFile || ocrUploadError) && (
          <div className="mb-5">
            <p className="text-sm font-semibold text-brand-700 dark:text-brand-300">
              {isOcrAnalyzing ? t("analyzingDocument") : t("reviewBeforeSave", { document: ocrUploadDocId || "" })}
            </p>
            {ocrUploadFile && !isOcrAnalyzing && (
              <>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 break-words text-xs text-gray-500">{t("fileAndOrder", { file: ocrUploadFile.name, orderCode: shipment.orderCode })}</p>
                  <button
                    type="button"
                    disabled={!ocrFilePreviewUrl}
                    onClick={() => {
                      if (!ocrUploadDocId || !ocrFilePreviewUrl) return;
                      setLocalUploads((current) => ({ ...current, [ocrUploadDocId]: ocrFilePreviewUrl }));
                      setPreviewUrl(ocrFilePreviewUrl);
                      setPreviewName(ocrUploadFile.name);
                      setIsPreviewCollapsed(false);
                    }}
                    className="shrink-0 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-600 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300 dark:hover:bg-brand-500/20"
                  >
                    {t("viewDocument")}
                  </button>
                </div>
                <div className="mt-3 space-y-3">
                  {currentOcrDocumentType === "PKL" && (
                    <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                      <span>{t("pklTargetProduct")} <span className="text-error-500">*</span></span>
                      <select
                        value={pklTargetDetailId}
                        onChange={(event) => setPklTargetDetailId(event.target.value)}
                        disabled={shipment.database?.details.length === 1 || isOcrSaving}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-500 disabled:cursor-not-allowed disabled:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:disabled:bg-gray-800"
                      >
                        <option value="">{t("selectPklProduct")}</option>
                        {(shipment.database?.details || []).map((detail, index) => (
                          <option key={detail.id_chi_tiet} value={detail.id_chi_tiet}>
                            {index + 1}. {detail.ten_hang}{detail.itemCodes[0]?.item_code ? ` — ${detail.itemCodes[0].item_code}` : ""}
                          </option>
                        ))}
                      </select>
                      {shipment.database?.details.length === 1 && <span className="text-[11px] text-success-600 dark:text-success-400">{t("autoSelectedOnlyProduct")}</span>}
                    </label>
                  )}
                  {canAddOcrRows && <div className="flex justify-end">
                    <button type="button" onClick={addOcrRow} disabled={isOcrSaving} className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-600 hover:bg-brand-100 disabled:opacity-50 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">{t("addRow")}</button>
                  </div>}
                  {ocrUploadRows.map((row, rowIndex) => (
                    <section key={`ocr-${ocrUploadDocId || "document"}-${rowIndex}`} className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 dark:border-gray-700 dark:bg-white/[0.02]">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                          {currentOcrDocumentType === "BL"
                            ? `Container ${rowIndex + 1}`
                            : currentOcrDocumentType === "PKL"
                              ? `${t("pklData")}${shipment.database?.details.find((detail) => detail.id_chi_tiet === pklTargetDetailId)?.ten_hang ? ` — ${shipment.database.details.find((detail) => detail.id_chi_tiet === pklTargetDetailId)?.ten_hang}` : ""}`
                              : t("productIndex", { index: rowIndex + 1 })}
                        </p>
                        {canAddOcrRows && ocrUploadRows.length > 1 && <button type="button" onClick={() => removeOcrRow(rowIndex)} disabled={isOcrSaving} className="rounded-md px-2 py-1 text-xs font-semibold text-error-600 hover:bg-error-50 disabled:opacity-50 dark:text-error-400 dark:hover:bg-error-500/10">{t("removeRow")}</button>}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                    {Object.entries(row).filter(([key]) => !key.startsWith("_") && !key.toLowerCase().startsWith("id_")).map(([key, value]) => (
                      <label key={`${rowIndex}-${key}`} className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                        <span>
                          {localizeSheetField(key, t)}
                          {currentOcrDocumentType && OCR_REQUIRED_FIELDS[currentOcrDocumentType].some((field) => normalizeSheetField(field) === normalizeSheetField(key)) && (
                            <span className="text-error-500"> *</span>
                          )}
                        </span>
                        {normalizeSheetField(key) === normalizeSheetField("Nhà cung cấp") ? (
                          <select
                            value={value}
                            onChange={(event) => updateOcrSupplier(event.target.value)}
                            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                          >
                            <option value="">{t("selectSupplier")}</option>
                            {value && !supplierOptions.some((supplier) => normalizeCatalogText(supplier.ten_ncc) === normalizeCatalogText(value)) && <option value={value} disabled>{t("ocrNotMatched", { value })}</option>}
                            {supplierOptions.map((supplier) => <option key={supplier.id_ncc} value={supplier.ten_ncc}>{supplier.ten_ncc}</option>)}
                          </select>
                        ) : normalizeSheetField(key) === normalizeSheetField("Hãng tàu") ? (
                          <select value={value} onChange={(event) => updateOcrCarrier(event.target.value)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white">
                            <option value="">{t("selectCarrier")}</option>
                            {value && !carrierOptions.some((carrier) => normalizeCatalogText(carrier.ten_hang_tau) === normalizeCatalogText(value)) && <option value={value} disabled>{t("ocrNotMatched", { value })}</option>}
                            {carrierOptions.map((carrier) => <option key={carrier.id_hang_tau} value={carrier.ten_hang_tau}>{carrier.ten_hang_tau}</option>)}
                          </select>
                        ) : normalizeSheetField(key) === normalizeSheetField("Cảng đến") ? (
                          <select value={value} onChange={(event) => updateOcrRowField(rowIndex, key, event.target.value)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white">
                            <option value="">{t("selectDestinationPort")}</option>
                            {value && !isDestinationPort(value) && <option value={value} disabled>{t("ocrNotMatched", { value })}</option>}
                            {DESTINATION_PORT_OPTIONS.map((port) => <option key={port} value={port}>{port}</option>)}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={value}
                            inputMode={isMoneyDetailField(key) || isQuantityDetailField(key) ? "decimal" : undefined}
                            readOnly={normalizeSheetField(key) === normalizeSheetField("XUẤT XỨ")}
                            onChange={(event) => updateOcrRowField(rowIndex, key, event.target.value)}
                            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-500 read-only:cursor-not-allowed read-only:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:read-only:bg-gray-800"
                          />
                        )}
                      </label>
                    ))}
                      </div>
                    </section>
                  ))}
                </div>
                {missingOcrFields.length > 0 && (
                  <p className="mt-3 text-xs text-error-600 dark:text-error-400">
                    {t("requiredMissing", { fields: missingOcrFields.map((field) => localizeSheetField(field, t)).join(", ") })}
                  </p>
                )}
                {ocrUploadError && <p className="mt-3 rounded-lg border border-error-200 bg-error-50 px-3 py-2 text-sm text-error-600">{ocrUploadError}</p>}
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => { setOcrUploadFile(null); setOcrUploadDocId(null); setOcrUploadFileData(""); setOcrUploadRequestId(""); setOcrUploadRows([]); setPklTargetDetailId(""); setOcrUploadError(""); }} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-white dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">{t("cancel")}</button>
                  <button type="button" onClick={handleConfirmOcrUpload} disabled={!canUploadDocuments || isOcrSaving || missingOcrFields.length > 0} title={missingOcrFields.length > 0 ? t("requiredMissing", { fields: missingOcrFields.map((field) => localizeSheetField(field, t)).join(", ") }) : undefined} className="rounded-lg bg-brand-500 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60">{isOcrSaving ? t("saving") : t("confirmSave")}</button>
                </div>
              </>
            )}
            {ocrUploadError && !ocrUploadFile && <p className="mt-3 rounded-lg border border-error-200 bg-error-50 px-3 py-2 text-sm text-error-600">{ocrUploadError}</p>}
          </div>
        )}

        {/* ── OVERVIEW ── */}
        {activeTab === "overview" && (
          <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
            {/* Key info grid */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.02]">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">{t("shipmentInformation")}</p>
                <div className="flex flex-col gap-2">
                  <InfoRow label={t("invoiceNumber")} value={overviewInfo.invoice || t("notAvailable")} mono />
                  <InfoRow label={t("packageCount")} value={overviewPackageDisplay || t("notAvailable")} />
                  <InfoRow label={t("netWeight")} value={overviewNetWeightDisplay || t("notAvailable")} />
                  <InfoRow label={t("goodsValue")} value={overviewGoodsValueDisplay || t("notAvailable")} />
                </div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.02]">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t("shippingInformation")}</p>
                <div className="flex flex-col gap-2">
                  <InfoRow label={t("containerNumber")} value={overviewInfo.container || t("notAvailable")} mono />
                  <InfoRow label={t("carrier")} value={shipment.vessel || t("notAvailable")} />
                  <InfoRow label="Bill of Lading" value={shipment.bill || t("notAvailable")} mono />
                  <InfoRow label={t("destinationPort")} value={shipment.port || t("notAvailable")} />
                </div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.02]">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t("timeline")}</p>
                <div className="flex flex-col gap-2">
                  <InfoRow label={t("estimatedDeparture")} value={formatDate(shipment.etd)} />
                  <InfoRow label={t("estimatedArrival")} value={formatDate(shipment.eta)} />
                  <InfoRow label={t("actualArrival")} value={shipment.ata ? formatDate(shipment.ata) : t("notArrived")} />
                  {etaStatus && <InfoRow label={t("comparedWithEta")} value={etaStatus} />}
                </div>
              </div>
            </div>

            {!isCancelled && (
              <>
                {/* {hasStageWarning && documentProgress && (
                  <div className="rounded-xl border border-warning-300 bg-warning-50 p-4 text-sm text-warning-800 dark:border-warning-500/40 dark:bg-warning-500/10 dark:text-warning-300">
                    <p className="font-semibold">{t("routeWarning")}</p>
                    <p className="mt-1">{documentProgress.currentStageLabel}</p>
                    <p className="mt-1">{t("missing")}: {(documentProgress.missingDocuments || []).join(", ") || "—"}</p>
                    <p className="mt-1">{t("exceededDocuments")}: {(documentProgress.exceededDocuments || []).join(", ") || "—"}</p>
                  </div>
                )} */}
                {documentProgressError && (
                  <div className="rounded-xl border border-error-200 bg-error-50 p-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">
                    {documentProgressError}
                  </div>
                )}
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.02]">
                  <ShipmentStatusBar
                    activeStage={shipment.flowStageKey || "buying"}
                    stages={localizedFlowStages}
                    activeStageMessage={activeStageMessage}
                  />
                </div>
              </>
            )}

            {/* Docs summary */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t("documentSummary")}</p>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-success-400 to-success-500 transition-all duration-700"
                    style={{ width: shipment.totalDocs > 0 ? `${(shipment.receivedDocs / shipment.totalDocs) * 100}%` : "0%" }}
                  />
                </div>
                <span className="text-sm font-bold text-gray-800 mb-4 dark:text-white whitespace-nowrap">
                  {shipment.receivedDocs} / {shipment.totalDocs}
                </span>
              </div>
              
            </div>
          </div>
        )}

        {/* ── JOURNEY ── */}
        {activeTab === "journey" && (
          <div className="flex flex-col gap-6">
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.02] sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    {t("scheduleLookup")}
                  </p>
                  <p className="mt-2 text-sm font-medium text-gray-800 dark:text-white/90">
                    {shipment.vessel || t("unknownCarrier")}
                  </p>
                    <p className="mt-1 break-words text-xs text-gray-500 dark:text-gray-400">
                    {t("trackingHelp")}
                  </p>
                  {trackingCode && (
                    <p className="mt-1 text-xs font-mono text-gray-400 dark:text-gray-500">
                      {t("trackingCode", { code: trackingCode })}
                    </p>
                  )}
                </div>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-shrink-0 text-brand-500">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </div>

              {availableTrackingCodes.length > 1 && (
                <label className="mt-4 flex flex-col gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">
                  <span>{t(isEvergreenTracking ? "selectTrackingContainer" : "selectTrackingBill")}</span>
                  <select
                    value={trackingCode}
                    onChange={(event) => setSelectedTrackingCode(event.target.value)}
                    disabled={isOpeningTracking}
                    className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-800 outline-none focus:border-brand-500 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  >
                    {availableTrackingCodes.map((code) => <option key={code} value={code}>{code}</option>)}
                  </select>
                </label>
              )}

              {carrierTrackingLink && (isEvergreenTracking || carrierTrackingUrl) ? (
                <>
                  {carrierTrackingLink.requiresManualCode && (
                    <p className="mt-4 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300">
                      {t("copyTrackingCode")}
                    </p>
                  )}
                  {isEvergreenTracking ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleEvergreenTracking()}
                        disabled={!evergreenContainerNo || isOpeningTracking}
                        className="mt-4 flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-500 px-3 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-brand-500/30 sm:px-4"
                      >
                        <span className="min-w-0 break-words text-left leading-5">
                          {isOpeningTracking ? t("openingEvergreenTracking") : t("trackEvergreen")}
                        </span>
                        {isOpeningTracking ? (
                          <svg className="flex-shrink-0 animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="23 4 23 10 17 10" />
                            <polyline points="1 20 1 14 7 14" />
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                          </svg>
                        ) : (
                          <svg className="flex-shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                        )}
                      </button>
                      {!evergreenContainerNo && (
                        <p className="mt-2 text-xs text-warning-600 dark:text-warning-400">{t("addTrackingCode")}</p>
                      )}
                    </>
                  ) : carrierTrackingLink.usesBackendApi ? (
                    <button
                      type="button"
                      onClick={handleOpenCarrierTracking}
                      disabled={isOpeningTracking}
                      className="mt-4 flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-500 px-3 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-wait disabled:opacity-70 dark:border-brand-500/30 sm:px-4"
                    >
                      <span className="min-w-0 break-words text-left leading-5">
                        {isOpeningTracking
                          ? `${t("updating")} ${carrierTrackingLink.name}...`
                          : `${t("scheduleLookup")} ${carrierTrackingLink.name}`}
                      </span>
                      {isOpeningTracking ? (
                        <svg className="flex-shrink-0 animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="23 4 23 10 17 10" />
                          <polyline points="1 20 1 14 7 14" />
                          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                      ) : (
                        <svg className="flex-shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleExternalCarrierTracking}
                      className={`${carrierTrackingLink.requiresManualCode ? "mt-2" : "mt-4"} flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-500 px-3 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-600 dark:border-brand-500/30 sm:px-4`}
                    >
                      <span className="min-w-0 break-words text-left leading-5">{t("scheduleLookup")} {carrierTrackingLink.name}</span>
                      <svg className="flex-shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </button>
                  )}
                  {carrierTrackingLink.usesBackendApi && trackingFeedback && (
                    <p
                      role={trackingFeedback.type === "error" ? "alert" : "status"}
                      className={`mt-2 rounded-lg border px-3 py-2 text-xs ${
                        trackingFeedback.type === "success"
                          ? "border-success-200 bg-success-50 text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-300"
                          : "border-error-200 bg-error-50 text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300"
                      }`}
                    >
                      {trackingFeedback.message}
                    </p>
                  )}
                </>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-warning-200 bg-warning-50/70 px-4 py-3 dark:border-warning-500/30 dark:bg-warning-500/10">
                  <p className="text-sm font-semibold text-warning-700 dark:text-warning-300">
                    {carrierTrackingLink ? t("trackingUnavailable") : t("carrierTrackingUnavailable")}
                  </p>
                  <p className="mt-1 text-xs text-warning-600 dark:text-warning-400">
                    {carrierTrackingLink
                      ? carrierTrackingLink.trackingType === "BL"
                        ? t("ckLineMissingBill")
                        : t("addTrackingCode")
                      : t("noCarrierLink")}
                  </p>
                </div>
              )}
            </div>

            {/* Journey detail cards */}
            {shipment.timeline && (
              <div className="flex flex-col gap-3">
                {shipment.timeline.map((stage, idx) => (
                  <div
                    key={stage.id || `timeline-stage-${idx}`}
                    className={`flex min-w-0 gap-3 rounded-xl border p-3 transition-all sm:gap-4 sm:p-4 ${
                      stage.isCompleted
                        ? "border-success-100 bg-success-50/50 dark:border-success-500/20 dark:bg-success-500/5"
                        : stage.isCurrent
                        ? "border-brand-200 bg-brand-50 dark:border-brand-500/30 dark:bg-brand-500/10"
                        : "border-gray-100 bg-gray-50/50 dark:border-gray-800 dark:bg-white/[0.01]"
                    }`}
                  >
                    <div className={`flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${
                      stage.isCompleted ? "bg-success-500 text-white" : stage.isCurrent ? "bg-brand-500 text-white" : "bg-gray-200 text-gray-500 dark:bg-gray-700"
                    }`}>
                      {stage.isCompleted ? "✓" : idx + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className={`min-w-0 break-words text-sm font-semibold ${
                          stage.isCompleted ? "text-success-700 dark:text-success-400" : stage.isCurrent ? "text-brand-700 dark:text-brand-300" : "text-gray-500"
                        }`}>{stage.label}</p>
                        {stage.isCurrent && (
                          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-500 dark:bg-brand-500/10">{t("currentStage")}</span>
                        )}
                      </div>
                      {stage.portName && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">📍 {stage.portName}</p>}
                      {stage.timestamp && <p className="text-xs text-gray-400 mt-0.5">🕐 {formatDateTime(stage.timestamp)}</p>}
                      {stage.note && (
                        <p className="mt-1.5 text-xs text-warning-700 dark:text-warning-300 bg-warning-50 dark:bg-warning-500/10 rounded-lg px-2 py-1">
                          ⚠️ {stage.note}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── DOCUMENTS ── */}
        {activeTab === "documents" && (
          <div className="flex flex-col gap-4">
            {canArchiveDocuments && isDocumentsComplete && !archived?.archived && (
              <button type="button" onClick={handleArchive} disabled={isArchiveLoading} className="flex w-full items-center justify-center rounded-xl bg-success-500 px-4 py-3 text-sm font-semibold text-white hover:bg-success-600 disabled:cursor-not-allowed disabled:opacity-60">
                {isArchiveLoading ? t("archiving") : t("archiveDocuments")}
              </button>
            )}
            {archived?.archived && archived.folderUrl && (
              <a href={archived.folderUrl} target="_blank" rel="noopener noreferrer" className="flex w-full items-center justify-center gap-2 rounded-xl border border-brand-200 bg-brand-500 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-600 dark:border-brand-500/30">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                </svg>
                {t("openDocumentFolder")}
              </a>
            )}
            {/* Missing docs alert removed: upload is available on each document row. */}
            {false && missingDocs.length > 0 && (
              <div className="rounded-xl border border-error-200 bg-error-50 p-3 dark:border-error-500/20 dark:bg-error-500/10 sm:p-4">
                <div className="flex items-start gap-3">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-error-500 mt-0.5 flex-shrink-0">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-error-700 dark:text-error-400">
                      Còn thiếu {missingDocs.length} chứng từ
                    </p>
                    <p className="mt-2 text-[11px] text-error-600 dark:text-error-300">
                      Bấm vào chứng từ để bổ sung file (Admin):
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {missingDocs.map((doc) => (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => handlePickUpload(doc.id)}
                          disabled={!canUploadDocuments || Boolean(archived?.archived) || isOcrAnalyzing || isOcrSaving}
                          aria-label={`Bổ sung ${doc.name}`}
                          className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
                            localUploads[doc.id]
                              ? "border-success-200 bg-success-50 text-success-700 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-300"
                              : "border-error-100 bg-white/70 text-error-600 hover:border-error-200 dark:border-error-500/20 dark:bg-error-500/5 dark:text-error-300"
                          }`}
                        >
                          {doc.name.replace(/^Chứng từ\s*/i, "")}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Email alert button */}
            {missingDocs.length > 0 && (
              <button
                onClick={() => undefined}
                disabled={isSendingEmail || emailSent || selectedMissingDocs.length === 0}
                className={`hidden flex w-full flex-wrap items-center justify-center gap-2 rounded-xl border px-3 py-3 text-center text-sm font-semibold leading-5 transition-all duration-200 sm:px-4 ${
                  emailSent
                    ? "border-success-200 bg-success-50 text-success-600 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-400"
                    : "border-brand-200 bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed"
                }`}
              >
                {emailSent ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Đã gửi email thành công!
                  </>
                ) : isSendingEmail ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                      <polyline points="23 4 23 10 17 10"/>
                      <polyline points="1 20 1 14 7 14"/>
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                    </svg>
                    Đang gửi email...
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                      <polyline points="22,6 12,13 2,6"/>
                    </svg>
                    Gửi email cảnh báo ({selectedMissingDocs.length} chứng từ)
                  </>
                )}
              </button>
            )}

            {/* Document list */}
            <div className="flex flex-col gap-2">
              {documentsSorted.map(doc => {
                const docStatus = DOC_STATUS_MAP[doc.status];
                const isPassed = doc.note?.toUpperCase().includes("PASS") === true;
                const documentFiles = documentFileGroups.find((group) => group.document.id === doc.id)?.files || [];
                return (
                  <div
                    key={doc.id}
                    className={`flex flex-col items-stretch gap-3 rounded-xl border p-3 transition-colors sm:flex-row sm:flex-wrap sm:items-center sm:p-3.5 ${
                      doc.status === "missing"
                        ? "border-error-100 bg-error-50/50 dark:border-error-500/20 dark:bg-error-500/5"
                        : doc.status === "pending"
                        ? "border-warning-100 bg-warning-50/50 dark:border-warning-500/20 dark:bg-warning-500/5"
                        : "border-gray-100 bg-gray-50/50 dark:border-gray-800 dark:bg-white/[0.02]"
                    }`}
                  >
                    {/* Icon */}
                    <div className={`flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg ${
                      doc.status === "ok" ? "bg-success-100 dark:bg-success-500/10" :
                      doc.status === "missing" ? "bg-error-100 dark:bg-error-500/10" :
                      "bg-warning-100 dark:bg-warning-500/10"
                    }`}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={
                        doc.status === "ok" ? "text-success-600" :
                        doc.status === "missing" ? "text-error-600" : "text-warning-600"
                      }>
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                      </svg>
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-white/90 truncate">{language === "en" ? t("documentName", { code: doc.id }) : doc.name}</p>
                      <p className="text-xs text-gray-400">{doc.type.toUpperCase()}</p>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <span className={`flex items-center gap-1 text-xs font-semibold ${docStatus?.color}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${docStatus?.dot}`} />
                        {isPassed ? t("passed") : t({ ok: "available", missing: "missing", pending: "pending", expired: "expired" }[doc.status] || "status")}
                      </span>
                      {documentFiles.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            if (documentFiles.length > 1) {
                              setOpenDocumentFileListId((current) => current === doc.id ? null : doc.id);
                              return;
                            }
                            setOpenDocumentFileListId(null);
                            setPreviewUrl(toDocumentPreviewUrl(documentFiles[0].url));
                            setPreviewName(doc.name);
                            setIsPreviewCollapsed(false);
                          }}
                          aria-label={t("viewDocument")}
                          aria-expanded={documentFiles.length > 1 ? openDocumentFileListId === doc.id : undefined}
                          className="flex items-center justify-center w-7 h-7 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                            <polyline points="15 3 21 3 21 9"/>
                            <line x1="10" y1="14" x2="21" y2="3"/>
                          </svg>
                        </button>
                      )}
                      {!archived?.archived && canUploadDocuments && (
                        <button type="button" disabled={isOcrAnalyzing || isOcrSaving} onClick={() => handlePickUpload(doc.id)} className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1 text-[11px] font-semibold text-brand-600 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
                          {isOcrAnalyzing && ocrUploadDocId === doc.id ? t("analyzingDocument") : doc.status === "ok" ? t("uploadAnother") : localUploads[doc.id] ? t("uploadAnother") : t("uploadDocument")}
                        </button>
                      )}
                      {!archived?.archived && canPassDocuments && doc.status !== "ok" && !getOcrDocumentType(doc.id) && (
                        <button
                          type="button"
                          disabled={Boolean(passingDocumentId) || isOcrAnalyzing || isOcrSaving}
                          onClick={() => void handlePassDocument(doc.id)}
                          className="rounded-lg border border-success-200 bg-success-50 px-2 py-1 text-[11px] font-semibold text-success-700 hover:bg-success-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-300"
                        >
                          {passingDocumentId === doc.id ? t("passingDocument") : t("passDocument")}
                        </button>
                      )}
                    </div>
                    {openDocumentFileListId === doc.id && documentFiles.length > 1 && (
                      <div className="w-full rounded-lg border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900">
                        <p className="px-2 py-1 text-xs font-semibold text-gray-500 dark:text-gray-400">{t("selectDocumentFile")}</p>
                        <div className="max-h-48 space-y-1 overflow-y-auto custom-scrollbar">
                          {documentFiles.map((file, index) => (
                            <button
                              key={`${file.url}-${index}`}
                              type="button"
                              onClick={() => {
                                setPreviewUrl(toDocumentPreviewUrl(file.url));
                                setPreviewName(`${doc.name} — ${file.label}`);
                                setIsPreviewCollapsed(false);
                                setOpenDocumentFileListId(null);
                              }}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                            >
                              <span className="shrink-0 font-semibold text-brand-600 dark:text-brand-400">{doc.id === "BL" ? "B/L" : doc.id} {index + 1}</span>
                              <span className="min-w-0 truncate text-gray-500 dark:text-gray-400">{file.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {(!shipment.documents || shipment.documents.length === 0) && (
                <p className="py-8 text-center text-sm text-gray-400">{t("noDocuments")}</p>
              )}
            </div>
          </div>
        )}

        {/* ── RETURN ITEM ── */}
        {activeTab === "return" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-white">{t("emptyReturnInformation")}</p>
                <p className="mt-1 text-xs text-gray-400">{t("emptyReturnSource")}</p>
              </div>
              {canEditReturnItem && (
                <button
                  type="button"
                  disabled={isReturnLoading || returnItems.length === 0}
                  onClick={() => setIsReturnEditing((current) => !current)}
                  className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-600 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300"
                >
                  {isReturnEditing ? t("closeEdit") : t("edit")}
                </button>
              )}
            </div>
            {!isReturnLoading && returnItems.length > 0 && (
              <section className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-white/[0.02]">
                <p className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">{t("selectReturnContainer")}</p>
                <div className="flex flex-wrap gap-2">
                  {returnItems.map((item) => {
                    const selected = item.idBlContainer === returnForm?.idBlContainer;
                    return (
                      <button
                        key={item.idBlContainer}
                        type="button"
                        disabled={isReturnEditing || isSavingReturn}
                        onClick={() => {
                          setReturnItem(item);
                          setReturnForm(item);
                        }}
                        className={`rounded-lg border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${selected
                          ? "border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-500/10 dark:text-brand-300"
                          : "border-gray-200 bg-white text-gray-600 hover:border-brand-200 hover:bg-brand-50/50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"}`}
                      >
                        <span className="block text-xs font-bold">{item.soCont}</span>
                        <span className="mt-0.5 block text-[10px] font-medium opacity-75">{item.tenKho || item.idKho || t("returnNotConfigured")}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
            {isReturnLoading ? (
              <p className="py-8 text-center text-sm text-gray-400">{t("loadingEmptyReturn")}</p>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.7fr)]">
                  <section className="rounded-2xl border border-brand-100 bg-brand-50/50 p-4 dark:border-brand-500/20 dark:bg-brand-500/5">
                    <div className="mb-4 flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white"><CalendarIcon /></span>
                      <h4 className="text-sm font-semibold text-gray-800 dark:text-white">{t("returnDate")}</h4>
                    </div>
                    <DateFieldInput
                      label={t("returnDate")}
                      value={returnForm?.ngay}
                      disabled={!canEditReturnItem || !isReturnEditing}
                      onChange={(value) => setReturnForm((current) => current ? { ...current, ngay: value } : current)}
                    />
                  </section>

                  <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-700 dark:bg-white/[0.02]">
                    <div className="flex items-center gap-3 border-b border-gray-100 bg-brand-50/80 px-4 py-3.5 dark:border-gray-800 dark:bg-brand-500/10 sm:px-5">
                      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-brand-500 text-xs font-bold text-white shadow-sm">01</span>
                      <h4 className="text-sm font-bold text-gray-900 dark:text-white">{t(RETURN_FIELD_GROUPS[2].labelKey)}</h4>
                    </div>
                    <div className="grid gap-3 p-4 sm:p-5 md:grid-cols-3">
                      {RETURN_FIELD_GROUPS[2].fields.map(({ key, labelKey }) => (
                        <label key={key} className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                          <span>{t(labelKey)}</span>
                          <input type="text" value={returnForm?.[key] || ""} disabled={!canEditReturnItem || !isReturnEditing} onChange={(event) => setReturnForm((current) => current ? { ...current, [key]: event.target.value } : current)} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-medium text-gray-800 outline-none transition focus:border-brand-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70 dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                        </label>
                      ))}
                    </div>
                  </section>
                </div>

                <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-700 dark:bg-white/[0.02]">
                  <div className="flex items-center gap-3 border-b border-gray-100 bg-warning-50/80 px-4 py-3.5 dark:border-gray-800 dark:bg-warning-500/10 sm:px-5">
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-warning-500 text-xs font-bold text-white shadow-sm">02</span>
                    <h4 className="text-sm font-bold text-gray-900 dark:text-white">{t(RETURN_FIELD_GROUPS[0].labelKey)}</h4>
                  </div>
                  <div className="grid gap-3 p-4 sm:p-5 sm:grid-cols-2">
                    {RETURN_FIELD_GROUPS[0].fields.map(({ key, labelKey }) => (
                      <label key={key} className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                        <span>{t(labelKey)}</span>
                        <input type="text" value={returnForm?.[key] || ""} disabled={!canEditReturnItem || !isReturnEditing || key === "soHd" || key === "soCont"} onChange={(event) => setReturnForm((current) => current ? { ...current, [key]: event.target.value } : current)} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-medium text-gray-800 outline-none transition focus:border-brand-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70 dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                      </label>
                    ))}
                  </div>
                </section>

                <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-700 dark:bg-white/[0.02]">
                  <div className="flex items-center gap-3 border-b border-gray-100 bg-purple-50/80 px-4 py-3.5 dark:border-gray-800 dark:bg-purple-500/10 sm:px-5">
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-purple-500 text-xs font-bold text-white shadow-sm">03</span>
                    <h4 className="text-sm font-bold text-gray-900 dark:text-white">{t(RETURN_FIELD_GROUPS[1].labelKey)}</h4>
                  </div>
                  <div className="grid gap-3 p-4 sm:p-5 md:grid-cols-4">
                    {RETURN_FIELD_GROUPS[1].fields.map(({ key, labelKey }) => (
                      <label key={key} className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                        <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-warning-400" />{t(labelKey)}</span>
                        {key === "idKho" ? (
                          <select
                            value={returnForm?.idKho || ""}
                            disabled={!canEditReturnItem || !isReturnEditing}
                            onChange={(event) => {
                              const warehouse = warehouseOptions.find((item) => item.id_kho === event.target.value);
                              setReturnForm((current) => current ? { ...current, idKho: event.target.value, tenKho: warehouse?.ten_kho || "" } : current);
                            }}
                            className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 outline-none transition focus:border-brand-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                          >
                            <option value="">{t("selectWarehouse")}</option>
                            {returnForm?.idKho && !warehouseOptions.some((warehouse) => warehouse.id_kho === returnForm.idKho) && (
                              <option value={returnForm.idKho}>{returnForm.idKho}</option>
                            )}
                            {warehouseOptions.map((warehouse) => (
                              <option key={warehouse.id_kho} value={warehouse.id_kho}>{warehouse.id_kho} — {warehouse.ten_kho}</option>
                            ))}
                          </select>
                        ) : (
                          <input type="text" value={returnForm?.[key] || ""} disabled={!canEditReturnItem || !isReturnEditing} onChange={(event) => setReturnForm((current) => current ? { ...current, [key]: event.target.value } : current)} className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-medium text-gray-800 outline-none transition focus:border-brand-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70 dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                        )}
                      </label>
                    ))}
                  </div>
                </section>
              </div>
            )}
            {canEditReturnItem && isReturnEditing && (
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { setReturnForm(returnItem || { idVanChuyen: "", idBlContainer: "", ngay: "", soCont: "", soHd: shipment.orderCode, nhaXe: "", tenTaiXe: "", bienSoXe: "", noiDi: "", noiTraContainer: "", idKho: "", tenKho: "", ghiChu: "" }); setIsReturnEditing(false); }} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300">{t("cancel")}</button>
                <button type="button" onClick={handleSaveReturn} disabled={isSavingReturn} className="rounded-lg bg-brand-500 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60">{isSavingReturn ? t("saving") : t("save")}</button>
              </div>
            )}
            {!isReturnLoading && !returnItem && (!isReturnEditing || !canEditReturnItem) && (
              <p className="py-4 text-center text-sm text-gray-400">{t("noEmptyReturn")}</p>
            )}
          </div>
        )}

        {/* ── DETAILS ── */}
        {activeTab === "details" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-white">{t("shipmentDetails")}</p>
                <p className="mt-1 text-xs text-gray-400">{t("summarySheetFields")}</p>
              </div>
              {(canEditDetails || canCancelShipment) && (
                <div className="flex flex-wrap justify-end gap-2">
                  {canEditDetails && (
                  <button type="button" onClick={handleToggleDetailsEditing} className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-600 hover:bg-brand-100 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
                    {isDetailsEditing ? t("closeEdit") : t("edit")}
                  </button>
                  )}
                  {canCancelShipment && (
                  <button type="button" onClick={handleCancelOrder} disabled={isCancelling} title={t("cancelShipmentHint")} className="rounded-lg border border-error-200 bg-error-50 px-3 py-2 text-xs font-semibold text-error-600 hover:bg-error-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">
                    {isCancelling ? t("updatingShipment") : t("deleteShipment")}
                  </button>
                  )}
                </div>
              )}
            </div>
            <div className="grid gap-5">
              {groupedDetailFields.map((group) => group.key === "orderDetails" && shipment.database ? (
                <PurchaseDetailsTable
                  key={group.key}
                  group={group}
                  details={purchaseDetailForms}
                  containerDetails={containerDetailForms}
                  editing={canEditDetails && isDetailsEditing}
                  translate={t}
                  onChange={(id, field, value) => setPurchaseDetailForms((current) => current.map((detail) => (
                    detail.id_chi_tiet === id ? { ...detail, [field]: value } : detail
                  )))}
                  onItemChange={(detailId, itemId, field, value) => setPurchaseDetailForms((current) => current.map((detail) => (
                    detail.id_chi_tiet === detailId
                      ? { ...detail, itemCodes: detail.itemCodes.map((item) => item.id_item_code === itemId ? { ...item, [field]: value } : item) }
                      : detail
                  )))}
                  onAddItem={(detailId) => setPurchaseDetailForms((current) => current.map((detail) => (
                    detail.id_chi_tiet === detailId
                      ? {
                        ...detail,
                        itemCodes: [...detail.itemCodes, {
                          id_item_code: `new-item-${detailId}-${Date.now()}-${detail.itemCodes.length}`,
                          id_chi_tiet: detailId,
                          item_code: "",
                          ma_nha_may: "",
                        }],
                      }
                      : detail
                  )))}
                  onAddRow={() => {
                    const temporaryId = `new-${Date.now()}-${purchaseDetailForms.length}`;
                    setPurchaseDetailForms((current) => [...current, {
                      id_chi_tiet: temporaryId,
                      ma_hop_dong: shipment.database?.purchase.ma_hop_dong || shipment.orderCode,
                      ten_hang: "",
                      so_kien: null,
                      don_vi_kien: null,
                      net_weight: null,
                      don_gia: null,
                      tong_gia: null,
                      itemCodes: [{
                        id_item_code: `new-item-${temporaryId}`,
                        id_chi_tiet: temporaryId,
                        item_code: "",
                        ma_nha_may: "",
                      }],
                    }]);
                  }}
                />
              ) : (
                <section
                  key={group.key}
                  className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-700 dark:bg-white/[0.02]"
                >
                  <div className={`flex items-center gap-3 border-b border-gray-100 px-4 py-3.5 dark:border-gray-800 sm:px-5 ${group.headerClass}`}>
                    <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-xs font-bold shadow-sm ${group.badgeClass}`}>
                      {group.number}
                    </span>
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-gray-900 dark:text-white">{t(group.labelKey)}</h4>
                      <p className="mt-0.5 text-xs leading-5 text-gray-500 dark:text-gray-400">{t(group.descriptionKey)}</p>
                    </div>
                  </div>
                  <div className={`grid gap-x-4 gap-y-4 p-4 sm:p-5 ${getDetailGroupGridClass(group.key)}`}>
                    {group.fields.map(({ field, labelKey }, fieldIndex) => {
                      const inputId = `shipment-detail-${group.key}-${normalizeSheetField(field)}`;
                      const normalizedField = normalizeSheetField(field);
                      if (group.key === "importExport" && normalizedField === normalizeSheetField("Mã Container")) return null;
                      return (
                      <React.Fragment key={field}>
                        {group.key === "importExport" && isDateDetailField(field) && !group.fields.slice(0, fieldIndex).some((item) => isDateDetailField(item.field)) && (
                          <div className="col-span-full mt-1 flex items-center gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
                            <span className="h-px flex-1 bg-gray-100 dark:bg-gray-800" />
                            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-400">{t("detailSchedule")}</p>
                            <span className="h-px flex-1 bg-gray-100 dark:bg-gray-800" />
                          </div>
                        )}
                        <div className={`flex min-w-0 flex-col gap-1.5 ${group.key === "importExport" && normalizedField === normalizeSheetField("BL NO.") ? "col-span-full" : getDetailFieldSpanClass(group.key, field)}`}>
                          <label htmlFor={inputId} className="truncate text-xs font-semibold text-gray-600 dark:text-gray-300">
                            {group.key === "importExport" && normalizedField === normalizeSheetField("BL NO.")
                              ? t("billContainerList")
                              : labelKey ? t(labelKey) : localizeSheetField(field, t)}
                          </label>
                          {group.key === "importExport" && normalizedField === normalizeSheetField("BL NO.") ? (
                            <div id={inputId} className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
                              <table className="w-full table-fixed text-left">
                                <thead className="bg-gray-100/80 text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                                  <tr>
                                    <th className="w-1/2 border-r border-gray-200 px-4 py-2.5 dark:border-gray-700">{t("billNumber")}</th>
                                    <th className="w-1/2 px-4 py-2.5">{t("containerCode")}</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-white/[0.02]">
                                  {billContainerRows.length > 0 ? billContainerRows.map((row) => (
                                    <tr key={row.key}>
                                      <td className="border-r border-gray-100 px-4 py-3 dark:border-gray-800">
                                        <span className="font-semibold text-gray-800 dark:text-gray-200">{row.billNumber}</span>
                                      </td>
                                      <td className="px-4 py-3">
                                        {row.containerNumber ? <span className="font-semibold text-cyan-700 dark:text-cyan-300">{row.containerNumber}</span> : <span className="text-sm text-gray-400">{t("noContainersForBill")}</span>}
                                      </td>
                                    </tr>
                                  )) : (
                                    <tr><td colSpan={2} className="px-4 py-5 text-center text-sm text-gray-400">—</td></tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          ) : normalizeSheetField(field) === normalizeSheetField("Nhà cung cấp") ? (
                            <select
                              id={inputId}
                              value={detailForm[field] || ""}
                              disabled={!canEditDetails || !isDetailsEditing}
                              onChange={(event) => {
                                const supplier = supplierOptions.find((item) => item.ten_ncc === event.target.value);
                                const originField = findActualSheetField(Object.keys(detailForm), "XUẤT XỨ");
                                setDetailForm((current) => ({
                                  ...current,
                                  [field]: event.target.value,
                                  [originField]: String(supplier?.quoc_gia || ""),
                                }));
                              }}
                              className="h-10 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-800 outline-none focus:border-brand-400 disabled:cursor-not-allowed disabled:opacity-75 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                            >
                              <option value="">{t("selectSupplier")}</option>
                              {detailForm[field] && !supplierOptions.some((supplier) => supplier.ten_ncc === detailForm[field]) && <option value={detailForm[field]}>{detailForm[field]}</option>}
                              {supplierOptions.map((supplier) => <option key={supplier.id_ncc} value={supplier.ten_ncc}>{supplier.ten_ncc}</option>)}
                            </select>
                          ) : normalizeSheetField(field) === normalizeSheetField("Hãng tàu") ? (
                            <select id={inputId} value={detailForm[field] || ""} disabled={!canEditDetails || !isDetailsEditing} onChange={(event) => setDetailForm((current) => ({ ...current, [field]: event.target.value }))} className="h-10 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-800 outline-none focus:border-brand-400 disabled:cursor-not-allowed disabled:opacity-75 dark:border-gray-700 dark:bg-gray-900 dark:text-white">
                              <option value="">{t("selectCarrier")}</option>
                              {detailForm[field] && !carrierOptions.some((carrier) => carrier.ten_hang_tau === detailForm[field]) && <option value={detailForm[field]}>{detailForm[field]}</option>}
                              {carrierOptions.map((carrier) => <option key={carrier.id_hang_tau} value={carrier.ten_hang_tau}>{carrier.ten_hang_tau}</option>)}
                            </select>
                          ) : normalizeSheetField(field) === normalizeSheetField("Cảng đến") ? (
                            <select id={inputId} value={isDestinationPort(detailForm[field] || "") ? detailForm[field].trim().toUpperCase() : detailForm[field] || ""} disabled={!canEditDetails || !isDetailsEditing} onChange={(event) => setDetailForm((current) => ({ ...current, [field]: event.target.value }))} className="h-10 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-800 outline-none focus:border-brand-400 disabled:cursor-not-allowed disabled:opacity-75 dark:border-gray-700 dark:bg-gray-900 dark:text-white">
                              <option value="">{t("selectDestinationPort")}</option>
                              {detailForm[field] && !isDestinationPort(detailForm[field]) && <option value={detailForm[field]} disabled>{detailForm[field]}</option>}
                              {DESTINATION_PORT_OPTIONS.map((port) => <option key={port} value={port}>{port}</option>)}
                            </select>
                          ) : isDateDetailField(field) ? (
                            <DateFieldInput
                              id={inputId}
                              label={field}
                              value={detailForm[field]}
                              disabled={!canEditDetails || !isDetailsEditing || isReadOnlyDetailField(field) || isDatabaseReadOnlyField(group.key, field)}
                              onChange={(value) => setDetailForm((current) => ({ ...current, [field]: value }))}
                            />
                          ) : (
                            <input
                              id={inputId}
                              type="text"
                              value={!isDetailsEditing
                                ? isMoneyDetailField(field) || isQuantityDetailField(field)
                                  ? formatDetailNumericValue(field, detailForm[field])
                                  : detailForm[field] || ""
                                : detailForm[field] || ""}
                              disabled={!canEditDetails || !isDetailsEditing || isReadOnlyDetailField(field) || isDatabaseReadOnlyField(group.key, field)}
                              inputMode={isMoneyDetailField(field) || isQuantityDetailField(field) ? "decimal" : undefined}
                              onChange={(event) => setDetailForm((current) => ({ ...current, [field]: event.target.value }))}
                              className="h-10 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-normal text-gray-800 outline-none transition-colors focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-500/10 disabled:cursor-not-allowed disabled:opacity-75 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:focus:border-brand-500"
                            />
                          )}
                        </div>
                      </React.Fragment>
                      );
                    })}
                  </div>
                </section>
              ))}
              {shipment.database && (
                <ContainerCargoDetailsTable
                  details={containerDetailForms}
                  containers={shipmentContainers}
                  purchaseDetails={purchaseDetailForms}
                  expectedPackages={purchaseDetailForms.reduce((total, detail) => total + packageAmount(detail.so_kien), 0)}
                  editing={canEditDetails && isDetailsEditing}
                  translate={t}
                  onChange={(id, field, value) => setContainerDetailForms((current) => current.map((detail) => (
                    detail.id_chi_tiet_container === id ? { ...detail, [field]: value } : detail
                  )))}
                  onAddRow={() => {
                    const availableItems = purchaseDetailForms.flatMap((detail) => detail.itemCodes.filter((item) => !item.id_item_code.startsWith("new-item-")));
                    if (shipmentContainers.length === 0) {
                      notify(t("containerRequiredForCargo"), "error");
                      return;
                    }
                    if (availableItems.length === 0) {
                      notify(t("itemCodeRequiredForCargo"), "error");
                      return;
                    }
                    setContainerDetailForms((current) => [...current, {
                      id_chi_tiet_container: `new-container-detail-${Date.now()}-${current.length}`,
                      id_bl_container: shipmentContainers[0].id_bl_container,
                      id_item_code: availableItems[0].id_item_code,
                      so_kien: null,
                      don_vi_kien: null,
                      net_weight: null,
                    }]);
                  }}
                />
              )}
            </div>
            {canEditDetails && isDetailsEditing && (
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { setDetailForm(shipment.summaryFields || {}); setPurchaseDetailForms(shipment.database?.details || []); setContainerDetailForms(flattenContainerDetails(shipment.database)); setIsDetailsEditing(false); }} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300">{t("cancel")}</button>
                <button type="button" onClick={handleSaveDetails} disabled={isSavingDetails} className="rounded-lg bg-brand-500 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60">{isSavingDetails ? t("saving") : t("save")}</button>
              </div>
            )}
          </div>
        )}

        {/* ── FOLDER ── */}
        {activeTab === "folder" && (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.02] sm:p-5">
              <div className="mb-4 flex items-start gap-3 sm:items-center sm:gap-4">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-warning-100 dark:bg-warning-500/10 sm:h-12 sm:w-12">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-warning-600">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="break-words text-sm font-bold text-gray-800 dark:text-white">{t("archivedRecords")}</p>
                  <p className="mt-0.5 break-words text-xs text-gray-400">{t("archivedDocumentsOf", { orderCode: shipment.orderCode })}</p>
                </div>
              </div>

              {archived?.folderUrl ? (
                <a
                  href={archived.folderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                className="flex w-full flex-wrap items-center justify-center gap-2 rounded-xl border border-brand-200 bg-brand-500 px-3 py-3 text-center text-sm font-semibold leading-5 text-white transition-colors hover:bg-brand-600 sm:px-4"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <polyline points="15 3 21 3 21 9"/>
                    <line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                  {t("openArchivedRecords")}
                </a>
              ) : (
                <div className="rounded-xl border border-dashed border-gray-200 p-5 text-center dark:border-gray-700 sm:p-6">
                  <p className="text-sm text-gray-400">{t("noDriveFolder")}</p>
                </div>
              )}

              {archived?.files && archived.files.length > 0 && (
                <div className="mt-4 flex flex-col gap-2">
                  {archived.files.map((file, fileIndex) => (
                    <button key={file.fileId || file.fileUrl || `${file.fileName}-${fileIndex}`} type="button" onClick={() => { setPreviewUrl(toDocumentPreviewUrl(file.fileUrl)); setPreviewName(file.fileName); }} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                      {file.fileName}
                    </button>
                  ))}
                </div>
              )}

              {shipment.timeUpdate && (
                <p className="mt-3 break-words text-center text-xs text-gray-400">
                  {t("lastUpdated", { time: new Date(shipment.timeUpdate).toLocaleString(language === "en" ? "en-US" : "vi-VN") })}
                </p>
              )}
            </div>

            {/* Quick email from folder tab */}
            {/* {missingDocsCount > 0 && (
              <button
                onClick={() => undefined}
                disabled={isSendingEmail || emailSent || selectedMissingDocs.length === 0}
                className={`flex w-full flex-wrap items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-center text-sm font-semibold leading-5 transition-all sm:px-4 ${
                  emailSent
                    ? "border-success-200 bg-success-50 text-success-600 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-400"
                    : "border-error-200 bg-error-50 text-error-600 hover:bg-error-100 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400 disabled:opacity-60"
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
                {emailSent ? "Đã gửi!" : `Gửi email cảnh báo (${selectedMissingDocs.length} chứng từ)`}
              </button>
            )} */}
          </div>
        )}
      </div>
    </Modal>
      {previewUrl && !isPreviewCollapsed && (
        <aside className={`fixed right-0 top-0 z-[100000] flex h-screen min-h-0 flex-col border-l border-gray-200 bg-white shadow-2xl transition-all duration-300 dark:border-gray-700 dark:bg-gray-900 ${isPreviewMaximized ? "w-full" : "w-[92vw] md:w-1/2"}`}>
          <div className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-gray-200 px-4 dark:border-gray-700">
            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800 dark:text-white">{previewName}</p>
            <button type="button" onClick={() => setIsPreviewMaximized((current) => !current)} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800" title={isPreviewMaximized ? t("minimize") : t("maximize")}>
              {isPreviewMaximized ? t("minimize") : t("maximize")}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-gray-100 p-2 custom-scrollbar dark:bg-gray-950">
            <iframe title={previewName} src={previewUrl} className="block h-[calc(100vh-4.5rem)] min-h-[720px] w-full rounded-lg bg-white" />
          </div>
        </aside>
      )}
      {previewUrl && !isPreviewCollapsed && (
        <button type="button" onClick={() => setIsPreviewCollapsed(true)} className="fixed right-0 top-1/2 z-[100001] -translate-y-1/2 rounded-l-xl border border-r-0 border-brand-200 bg-brand-500 px-3 py-4 text-sm font-semibold text-white shadow-lg hover:bg-brand-600" aria-label={t("collapsePreview")}>
          → File
        </button>
      )}
      {previewUrl && isPreviewCollapsed && (
        <button type="button" onClick={() => setIsPreviewCollapsed(false)} className="fixed right-0 top-1/2 z-[100000] -translate-y-1/2 rounded-l-xl border border-r-0 border-brand-200 bg-brand-500 px-3 py-4 text-sm font-semibold text-white shadow-lg hover:bg-brand-600" aria-label={t("openPreview")}>
          ← File
        </button>
      )}
    </>
  );
}
