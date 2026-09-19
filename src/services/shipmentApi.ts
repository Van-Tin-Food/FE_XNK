import type {
  ArchivedDocumentsResponse,
  DriveDataResponse,
  ReturnItem,
  Shipment,
  ShipmentDocument,
  ShipmentMetricsSummary,
} from "@/types/shipment";
import { getStoredUser } from "@/services/authApi";
import { backendApiUrl } from "@/services/backendApiUrl";
import {
  fetchDriveDocumentRows,
  fetchNotificationRows,
  fetchPostgresReturnItems,
  fetchPostgresShipmentListSnapshot,
  databaseEndpoints,
  updateDatabaseRow,
} from "@/services/postgresShipmentApi";
import type { EvergreenTrackingLaunchResponse } from "@/utils/evergreenTracking";
import type { DriveDocumentFileRecord, DriveDocumentRecord, DriveDocumentValue, NotificationRecord, PostgresShipmentRelations, PostgresShipmentSnapshot, PurchaseRecord } from "@/types/postgresShipment";
import { createHttpApiError, createInvalidResponseError, createNetworkApiError, parseApiResponse } from "@/utils/apiError";

export const NOTIFICATIONS_SYNC_EVENT = "xnk:notifications-sync";
const DOCUMENT_CODES = [
  "PI", "INV", "PKL", "BL", "CO", "HC", "DON_KD", "BB_LM",
  "PHI_TK", "THUE_NK", "TK", "15B", "QDTQ", "MV", "TRA_CONG",
] as const;

const FLOW_DOCUMENT_GROUPS: Array<{ key: Shipment["flowStageKey"]; docs: string[] }> = [
  // Đơn đã xuất hiện trong bảng nghĩa là PI đã được tạo. Hành trình bắt đầu từ INV/PKL.
  { key: "buying", docs: ["INV", "PKL"] },
  { key: "shipping", docs: ["BL", "CO", "HC"] },
  { key: "arrived", docs: ["DON_KD"] },
  { key: "declared", docs: ["BB_LM", "PHI_TK", "THUE_NK", "TK"] },
  { key: "fifteenb", docs: ["15B"] },
  { key: "customs", docs: ["QDTQ", "MV"] },
];

const FLOW_STAGE_LABELS: Record<NonNullable<Shipment["flowStageKey"]>, string> = {
  buying: "Lên đơn hàng",
  shipping: "Vận chuyển trên biển",
  arrived: "Kiểm dịch hàng hóa",
  declared: "Khai báo hải quan",
  fifteenb: "Mẫu 15B",
  customs: "Thông quan",
  delivered: "Giao hàng / Trả công",
};

export const SUMMARY_FIELDS = [
  "Số HĐ", "Ngày HĐ PI", "Nhà cung cấp", "XUẤT XỨ", "Tên hàng", "Giá tổng",
  "INV", "Ngày INV", "Số hộp", "Trọng lượng", "BL NO.",
  "Số Container", "Hãng tàu", "Cảng đến", "ETD", "ETA", "ATA",
] as const;

function endpoint(path: string): string {
  return backendApiUrl(`/api/${path.replace(/^\//, "")}`);
}

function parseDate(value: unknown): string | undefined {
  const raw = String(value ?? "").trim().split(",")[0].trim();
  if (!raw) return undefined;
  const slashDate = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashDate) {
    const first = Number(slashDate[1]);
    const second = Number(slashDate[2]);
    const year = Number(slashDate[3]);
    // Sheet hiện tại chủ yếu dùng MM/DD/YYYY; nếu số đầu > 12 thì nhận là DD/MM/YYYY.
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    const date = new Date(year, month - 1, day);
    if (
      month < 1 || month > 12 || day < 1 || day > 31 ||
      date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day
    ) return undefined;
    return date.toISOString().split("T")[0];
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().split("T")[0];
}

const DOCUMENT_FIELD_MAP = {
  PI: "pi", INV: "inv", PKL: "pkl", BL: "bl", CO: "co", HC: "hc",
  DON_KD: "don_kd", BB_LM: "bb_lm", PHI_TK: "phi_tk", THUE_NK: "thue_nk",
  TK: "tk", "15B": "15b", QDTQ: "qdtq", MV: "mv", TRA_CONG: "tra_cong",
} as const satisfies Record<(typeof DOCUMENT_CODES)[number], keyof DriveDocumentRecord>;

function buildDocuments(total: DriveDocumentRecord | undefined): ShipmentDocument[] {
  return DOCUMENT_CODES.map((code) => {
    const rawValue = total?.[DOCUMENT_FIELD_MAP[code]];
    const passed = typeof rawValue === "string" && rawValue.trim().toUpperCase() === "PASS";
    const files = passed ? [] : parseDocumentFiles(rawValue);
    const urls = files.map((file) => file.fileUrl);
    const firstFile = files[0];
    return {
      id: code,
      name: `Chứng từ ${code}`,
      type: "pdf",
      status: passed || files.length > 0 ? "ok" : "missing",
      url: firstFile?.fileUrl,
      urls,
      files,
      fileId: firstFile?.fileId || undefined,
      note: passed ? "Chứng từ đã được PASS" : files.length > 0 ? undefined : "Chưa có URL trong PostgreSQL",
    };
  });
}

/** Supports parsed BE arrays plus legacy URL strings and serialized arrays. */
function parseDocumentFiles(value: DriveDocumentValue | undefined): DriveDocumentFileRecord[] {
  if (value == null || value === "") return [];
  let entries: unknown = value;
  if (typeof value === "string") {
    try {
      entries = JSON.parse(value) as unknown;
    } catch {
      entries = value.match(/https?:\/\/.*?(?=https?:\/\/|[\s,"\]]|$)/g) || [];
    }
  }
  if (typeof entries === "string") entries = [entries];
  if (!Array.isArray(entries)) return [];

  const files = entries.flatMap((entry): DriveDocumentFileRecord[] => {
    if (typeof entry === "string") {
      return /^https?:\/\//i.test(entry.trim()) ? [{ fileUrl: entry.trim() }] : [];
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const file = entry as Record<string, unknown>;
    if (typeof file.fileUrl !== "string" || !/^https?:\/\//i.test(file.fileUrl.trim())) return [];
    return [{
      fileUrl: file.fileUrl.trim(),
      fileId: typeof file.fileId === "string" ? file.fileId : undefined,
      fileName: typeof file.fileName === "string" ? file.fileName : undefined,
      referenceCode: typeof file.referenceCode === "string" ? file.referenceCode : undefined,
      idChiTiet: typeof file.idChiTiet === "string" ? file.idChiTiet : undefined,
      requestId: typeof file.requestId === "string" ? file.requestId : undefined,
      uploadedAt: typeof file.uploadedAt === "string" ? file.uploadedAt : undefined,
    }];
  });
  return files.filter((file, index) => files.findIndex((other) => (
    file.fileId && other.fileId ? file.fileId === other.fileId : file.fileUrl === other.fileUrl
  )) === index);
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredUser()?.token?.trim();
  const method = String(init?.method || "GET").toUpperCase();
  const apiPath = `/api/${path.replace(/^\//, "")}`;
  const scope = path.startsWith("ocr/")
    ? "OCR"
    : path.startsWith("tracking/")
      ? "Tracking"
      : ["uploadDocument", "getArchivedDocuments", "moveCompletedOrder"].some((name) => path.startsWith(name))
        ? "Drive"
        : "Backend";
  try {
    const response = await fetch(endpoint(path), {
      cache: "no-store",
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
    const { data: parsed, nonJsonPreview } = await parseApiResponse(response);
    const json = (parsed || {}) as { success?: boolean; message?: string; error?: string; data?: T } & T;
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event("xnk:auth-expired"));
    }
    if (!response.ok || json.success === false) {
      throw createHttpApiError(scope, method, apiPath, response, parsed, nonJsonPreview);
    }
    if (parsed === null) throw createInvalidResponseError(scope, method, apiPath, nonJsonPreview);
    return (json.data ?? json) as T;
  } catch (error) {
    if (error instanceof TypeError) throw createNetworkApiError(scope, method, apiPath, error);
    throw error;
  }
}

export async function fetchDriveDocumentMap(): Promise<Map<string, DriveDocumentRecord>> {
  const rows = await fetchDriveDocumentRows();
  const map = new Map<string, DriveDocumentRecord>();
  rows.forEach((row) => {
    const code = String(row.order_code ?? "").trim();
    if (code) map.set(code.toUpperCase(), row);
  });
  return map;
}

export async function fetchShipments(): Promise<{ shipments: Shipment[]; lastUpdated: string; updatedBy: string; supplierOptions: string[]; carrierOptions: string[] }> {
  const [database, totalMap] = await Promise.all([
    fetchPostgresShipmentListSnapshot(),
    fetchDriveDocumentMap(),
  ]);
  const lastUpdated = new Date().toISOString();
  const shipments = database.purchases
    .filter((purchase) => String(purchase.ma_hop_dong || "").trim())
    .map((purchase, index) => mapPostgresShipment(
      purchase,
      database,
      totalMap.get(purchase.ma_hop_dong.trim().toUpperCase()),
      index,
      lastUpdated,
    ));
  return {
    shipments,
    lastUpdated,
    updatedBy: "PostgreSQL",
    supplierOptions: [...new Set(database.suppliers.map((supplier) => supplier.ten_ncc).filter(Boolean))],
    carrierOptions: [...new Set(database.carriers.map((carrier) => carrier.ten_hang_tau).filter(Boolean))],
  };
}

function numberValue(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapPostgresShipment(
  purchase: PurchaseRecord,
  database: PostgresShipmentSnapshot,
  total: DriveDocumentRecord | undefined,
  index: number,
  updatedAt: string,
): Shipment {
  const supplier = database.suppliers.find((item) => item.id_ncc === purchase.id_ncc);
  const details = database.purchaseDetails
    .filter((item) => item.ma_hop_dong === purchase.ma_hop_dong)
    .map((detail) => ({
      ...detail,
      itemCodes: database.itemCodes.filter((item) => item.id_chi_tiet === detail.id_chi_tiet),
    }));
  const bills = database.bills
    .filter((item) => item.ma_hop_dong === purchase.ma_hop_dong)
    .map((bill) => ({
      ...bill,
      carrier: database.carriers.find((item) => item.id_hang_tau === bill.id_hang_tau),
      containers: database.containers
        .filter((item) => item.ma_bl === bill.ma_bl)
        .map((container) => ({
          ...container,
          details: database.containerDetails.filter((item) => item.id_bl_container === container.id_bl_container),
          transports: database.transports
            .filter((item) => item.id_bl_container === container.id_bl_container)
            .map((transport) => ({
              ...transport,
              warehouse: database.warehouses.find((item) => item.id_kho === transport.id_kho),
            })),
        })),
    }));
  const primaryBill = [...bills].sort((left, right) => String(left.eta || "9999-12-31").localeCompare(String(right.eta || "9999-12-31")))[0];
  const containers = bills.flatMap((bill) => bill.containers);
  const itemCodes = details.flatMap((detail) => detail.itemCodes);
  const documents = buildDocuments(total);
  const receivedDocs = documents.filter((document) => document.status === "ok").length;
  const totalDocs = documents.length;
  const completeByDocuments = receivedDocs === totalDocs && totalDocs > 0;
  const flowStageKey = completeByDocuments
    ? "delivered"
    : FLOW_DOCUMENT_GROUPS.find((group) => group.docs.some((code) => !documents.some((document) => document.id === code && document.status === "ok")))?.key || "customs";
  const totalPackages = details.reduce((sum, detail) => sum + numberValue(detail.so_kien), 0);
  const totalWeight = details.reduce((sum, detail) => sum + numberValue(detail.net_weight), 0);
  const totalPrice = details.reduce((sum, detail) => sum + numberValue(detail.tong_gia), 0);
  const firstDetail = details[0];
  const relations: PostgresShipmentRelations = { purchase, supplier, details, bills };
  const orderCode = purchase.ma_hop_dong.trim();
  const summaryFields: Record<string, string> = {
    "Số HĐ": orderCode,
    "Ngày HĐ PI": String(purchase.ngay_hop_dong || ""),
    "Nhà cung cấp": supplier?.ten_ncc || purchase.id_ncc,
    "XUẤT XỨ": supplier?.quoc_gia || "",
    "INV": String(purchase.ma_inv || ""),
    "Ngày INV": String(purchase.ngay_inv || ""),
    "Tên hàng": firstDetail?.ten_hang || "",
    "Giá tổng": totalPrice ? String(totalPrice) : "",
    "Đơn giá": firstDetail?.don_gia == null ? "" : String(firstDetail.don_gia),
    "Số hộp": totalPackages ? String(totalPackages) : "",
    "Trọng lượng": totalWeight ? String(totalWeight) : "",
    "BL NO.": primaryBill?.ma_bl || "",
    "Mã Container": containers.map((item) => item.ma_container).filter(Boolean).join(", "),
    "Số container": containers.length ? String(containers.length) : "",
    "Hãng tàu": primaryBill?.carrier?.ten_hang_tau || primaryBill?.id_hang_tau || "",
    "Cảng đi": primaryBill?.cang_di || "",
    "Cảng đến": primaryBill?.cang_den || "",
    "ETD": primaryBill?.etd || "",
    "ETA": primaryBill?.eta || "",
    "ATA": primaryBill?.ata || "",
    "Item code": itemCodes.map((item) => item.item_code).filter(Boolean).join(", "),
    "Mã nhà máy": itemCodes.map((item) => item.ma_nha_may).filter(Boolean).join(", "),
    "Số tiền cọc": "",
    "Số tiền thanh toán": "",
    "Lệnh thả hàng": "",
  };

  return {
    id: `PG-${purchase.ma_hop_dong}-${index}`,
    orderCode,
    shipName: details.map((item) => item.ten_hang).filter(Boolean).join(", "),
    supplier: supplier?.ten_ncc || purchase.id_ncc,
    origin: supplier?.quoc_gia || undefined,
    factoryCode: itemCodes[0]?.ma_nha_may || undefined,
    vessel: primaryBill?.carrier?.ten_hang_tau || undefined,
    bill: primaryBill?.ma_bl || undefined,
    etd: parseDate(primaryBill?.etd),
    eta: parseDate(primaryBill?.eta),
    ata: parseDate(primaryBill?.ata),
    port: primaryBill?.cang_den || undefined,
    contCount: containers.length,
    status: purchase.is_deleted ? "cancelled" : completeByDocuments ? "completed" : receivedDocs === 0 ? "missing_docs" : "shipping",
    docStatus: completeByDocuments ? 1 : Number(total?.status ?? 0),
    totalDocs,
    receivedDocs,
    missingDocs: documents.filter((document) => document.status !== "ok").map((document) => document.id).join(", "),
    timeUpdate: total?.date_time || undefined,
    documents,
    flowStageKey,
    flowStageLabel: completeByDocuments ? "Hoàn thành" : FLOW_STAGE_LABELS[flowStageKey],
    updatedAt,
    createdAt: parseDate(purchase.ngay_hop_dong) || updatedAt,
    summaryFields,
    database: relations,
  };
}

export async function fetchReturnItems(orderCode: string): Promise<ReturnItem[]> {
  return fetchPostgresReturnItems(orderCode);
}

export function getNotifications(): Promise<NotificationRecord[]> {
  return fetchNotificationRows();
}

export async function markNotificationsRead(notificationIds: Array<string | number>): Promise<void> {
  const uniqueIds = [...new Set(notificationIds.map(String).filter(Boolean))];
  await Promise.all(uniqueIds.map((id) =>
    updateDatabaseRow<NotificationRecord>(databaseEndpoints.notifications, id, { status: 1 }),
  ));
}

export interface DocumentProgressResponse {
  success: boolean;
  orderCode: string;
  currentStage: number;
  currentStageKey: string;
  currentStageLabel: string;
  missingDocuments: string[];
  exceededDocuments: string[];
  isExceeded: boolean;
  documents?: Record<string, unknown>;
  notification?: Record<string, unknown> | null;
}

export function checkDocumentProgress(orderCode: string): Promise<DocumentProgressResponse> {
  return requestJson<DocumentProgressResponse>("document-progress/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderCode }),
  });
}

export function getArchivedDocuments(orderCode: string): Promise<ArchivedDocumentsResponse> {
  return requestJson<ArchivedDocumentsResponse>(`getArchivedDocuments?orderCode=${encodeURIComponent(orderCode)}`);
}

export function moveCompletedOrder(orderCode: string): Promise<DriveDataResponse> {
  return requestJson<DriveDataResponse>(`moveCompletedOrder?orderCode=${encodeURIComponent(orderCode)}`, { method: "POST" });
}

export interface UploadDocumentPayload {
  action: "uploadDocument";
  orderCode: string;
  documentCode: string;
  fileName: string;
  fileData: string;
  mimeType: string;
  referenceCode?: string;
  idChiTiet?: string;
  requestId: string;
}
export async function uploadDocument(payload: UploadDocumentPayload): Promise<DriveDataResponse> {
  const result = await requestJson<DriveDataResponse>("uploadDocument", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!result.fileUrl) throw new Error("[Upload chứng từ] Backend không trả fileUrl sau khi lưu file Drive");

  // Upload đã thành công: yêu cầu dropdown tải lại bảng thong_bao PostgreSQL.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(NOTIFICATIONS_SYNC_EVENT));
  }
  return result;
}

export function launchEvergreenTracking(containerNo: string): Promise<EvergreenTrackingLaunchResponse> {
  const token = getStoredUser()?.token?.trim();
  return requestJson<EvergreenTrackingLaunchResponse>("tracking/evergreen/launch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ containerNo }),
  });
}

export type OcrDataRow = Record<string, string>;
export interface AnalyzeDocumentResponse { success: boolean; documentType: "PI" | "INV" | "PKL" | "BL"; fileName: string; data: OcrDataRow[]; _confidence?: number; ocrConfidence?: number; _reason?: string; models?: Record<string, string>; }
export async function analyzeDocument(payload: { documentType: "PI" | "INV" | "PKL" | "BL"; file: File }): Promise<AnalyzeDocumentResponse> {
  const formData = new FormData();
  formData.append("documentType", payload.documentType);
  formData.append("file", payload.file, payload.file.name);
  const response = await requestJson<unknown>("ocr/analyze", { method: "POST", body: formData });
  const raw = response && typeof response === "object" && !Array.isArray(response)
    ? response as Record<string, unknown>
    : {};
  // requestJson có thể đã unwrap thuộc tính data. Hỗ trợ cả response mới dạng mảng
  // và object một dòng cũ, nhưng component luôn nhận một mảng.
  const sourceRows = Array.isArray(response)
    ? response
    : Array.isArray(raw.data)
      ? raw.data
      : [raw.data && typeof raw.data === "object" ? raw.data : raw];
  const data = sourceRows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    .map((row) => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, value == null ? "" : String(value)]),
    ));
  return {
    success: raw.success !== false,
    documentType: raw.documentType === "PI" || raw.documentType === "INV" || raw.documentType === "PKL" || raw.documentType === "BL"
      ? raw.documentType
      : payload.documentType,
    fileName: typeof raw.fileName === "string" ? raw.fileName : payload.file.name,
    data,
    _confidence: typeof raw._confidence === "number" ? raw._confidence : undefined,
    ocrConfidence: typeof raw.ocrConfidence === "number" ? raw.ocrConfidence : undefined,
    _reason: typeof raw._reason === "string" ? raw._reason : undefined,
    models: raw.models && typeof raw.models === "object" ? raw.models as Record<string, string> : undefined,
  };
}

export function computeMetrics(shipments: Shipment[]): ShipmentMetricsSummary {
  return {
    total: shipments.length,
    completed: shipments.filter((shipment) => shipment.status === "completed").length,
    shipping: shipments.filter((shipment) => shipment.status === "shipping").length,
    cancelled: shipments.filter((shipment) => shipment.status === "cancelled").length,
  };
}
