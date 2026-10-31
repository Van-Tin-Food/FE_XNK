import type {
  ArchivedDocumentsResponse,
  DriveDataResponse,
  ReturnItem,
  Shipment,
  ShipmentDocument,
  ShipmentMetricsSummary,
} from "@/types/shipment";
import { getStoredUser, GOOGLE_DRIVE_AUTH_REQUIRED_EVENT } from "@/services/authApi";
import { backendApiUrl } from "@/services/backendApiUrl";
import {
  fetchDriveDocumentRows,
  fetchNotificationRows,
  fetchPostgresReturnItems,
  fetchPostgresShipmentListSnapshot,
  databaseEndpoints,
  updateDatabaseRow,
} from "@/services/postgresShipmentApi";
import type { DriveDocumentFileRecord, DriveDocumentRecord, DriveDocumentValue, NotificationRecord, PostgresShipmentRelations, PostgresShipmentSnapshot, PurchaseRecord } from "@/types/postgresShipment";
import { type ApiError, createHttpApiError, createInvalidResponseError, createNetworkApiError, parseApiResponse } from "@/utils/apiError";
import { getDocumentMimeType } from "@/utils/documentFile";
import { DriveUploadError, preUploadToDriveSession, uploadFileToDriveSession, type UploadProgress } from "@/utils/driveResumableUpload";

export const NOTIFICATIONS_SYNC_EVENT = "xnk:notifications-sync";
export type DriveFolderLinks = {
  source?: string;
  complete?: string;
  documents?: Record<string, string>;
  /** Tên thư mục Drive theo mã chứng từ, vd PI → "01. PI Hợp đồng mua". */
  names?: Record<string, string>;
};
const DOCUMENT_CODES = [
  "PI", "INV", "PKL", "BL", "CO", "HC", "DON_KD", "BB_LM",
  "PHI_TK", "THUE_NK", "TK", "15B", "QDTQ", "MV", "TRA_CONT",
  "AN", "EDO", "CPN", "INSPECTION", "PS",
] as const;
// PS = chứng từ phát sinh: chứng từ không thuộc danh sách chuẩn, lưu ở thư mục "99. PS Chứng từ phát sinh".
export const OPTIONAL_DOCUMENT_CODES = new Set(["AN", "EDO", "CPN", "INSPECTION", "PS"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const FLOW_DOCUMENT_GROUPS: Array<{ key: Shipment["flowStageKey"]; docs: string[] }> = [
  // Đơn đã xuất hiện trong bảng nghĩa là PI đã được tạo. Hành trình bắt đầu từ INV/PKL.
  { key: "buying", docs: ["INV", "PKL"] },
  { key: "shipping", docs: ["BL", "CO", "HC"] },
  { key: "arrived", docs: ["DON_KD"] },
  { key: "declared", docs: ["BB_LM", "PHI_TK", "THUE_NK", "TK"] },
  { key: "fifteenb", docs: ["15B"] },
  { key: "customs", docs: ["QDTQ", "MV"] },
  { key: "delivered", docs: ["TRA_CONT"] },
];

const FLOW_STAGE_LABELS: Record<NonNullable<Shipment["flowStageKey"]>, string> = {
  buying: "Lên đơn hàng",
  shipping: "Vận chuyển trên biển",
  arrived: "Kiểm dịch hàng hóa",
  declared: "Khai báo hải quan",
  fifteenb: "Mẫu 15B",
  customs: "Thông quan",
  delivered: "Giao hàng / Hạ rỗng",
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
  // Date/timestamp từ PostgreSQL đã có ngày lịch đúng; không parse qua UTC
  // vì múi giờ Việt Nam có thể làm ngày 05/10 thành 04/10.
  const isoDate = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) return isoDate[1];
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
  DON_KD: "don_kd", AN: "an", EDO: "edo", CPN: "cpn", INSPECTION: "inspection",
  BB_LM: "bb_lm", PHI_TK: "phi_tk", THUE_NK: "thue_nk",
  TK: "tk", "15B": "15b", QDTQ: "qdtq", MV: "mv", TRA_CONT: "tra_cong", PS: "ps",
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
    const fileUrl = [file.fileUrl, file.url, file.webViewLink].find((value): value is string => (
      typeof value === "string" && /^https?:\/\//i.test(value.trim())
    ));
    if (!fileUrl) return [];
    return [{
      fileUrl: fileUrl.trim(),
      fileId: typeof file.fileId === "string" ? file.fileId : undefined,
      fileName: typeof file.fileName === "string" ? file.fileName : undefined,
      referenceCode: typeof file.referenceCode === "string" ? file.referenceCode : undefined,
      idChiTiet: typeof file.idChiTiet === "string" ? file.idChiTiet : undefined,
      requestId: typeof file.requestId === "string" ? file.requestId : undefined,
      uploadedAt: typeof file.uploadedAt === "string" ? file.uploadedAt : undefined,
      uploadedBy: typeof file.uploadedBy === "string" ? file.uploadedBy : undefined,
      uploadedByEmail: typeof file.uploadedByEmail === "string" ? file.uploadedByEmail : undefined,
      folderId: typeof file.folderId === "string" ? file.folderId : undefined,
      folderName: typeof file.folderName === "string" ? file.folderName : undefined,
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
    : ["uploadDocument", "startDocumentUpload", "completeDocumentUpload", "finishDocumentUploadBatch", "checkDocumentFileNames", "getArchivedDocuments", "moveCompletedOrder", "deleteDocumentFile"].some((name) => path.startsWith(name))
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
      if (typeof window !== "undefined" && isRecord(parsed)
        && (parsed.code === "GOOGLE_DRIVE_AUTH_REQUIRED" || parsed.errorCode === "GOOGLE_DRIVE_AUTH_REQUIRED")) {
        window.dispatchEvent(new Event(GOOGLE_DRIVE_AUTH_REQUIRED_EVENT));
      }
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
  return driveDocumentMap(await fetchDriveDocumentRows());
}

function groupBy<T>(rows: T[], key: (row: T) => unknown): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const value = String(key(row) ?? "");
    const group = groups.get(value);
    if (group) group.push(row);
    else groups.set(value, [row]);
  }
  return groups;
}

function indexBy<T>(rows: T[], key: (row: T) => unknown): Map<string, T> {
  const index = new Map<string, T>();
  for (const row of rows) {
    const value = String(key(row) ?? "");
    if (!index.has(value)) index.set(value, row);
  }
  return index;
}

/**
 * Chỉ mục quan hệ dựng một lần cho cả danh sách. Trước đây mỗi đơn lọc lại toàn bộ các bảng
 * (số đơn × số dòng), dữ liệu càng nhiều càng chậm; giờ mỗi lần tra là O(1).
 */
function buildRelationIndex(database: PostgresShipmentSnapshot) {
  return {
    suppliers: indexBy(database.suppliers, (item) => item.id_ncc),
    carriers: indexBy(database.carriers, (item) => item.id_hang_tau),
    warehouses: indexBy(database.warehouses, (item) => item.id_kho),
    detailsByContract: groupBy(database.purchaseDetails, (item) => item.ma_hop_dong),
    itemCodesByDetail: groupBy(database.itemCodes, (item) => item.id_chi_tiet),
    billsByContract: groupBy(database.bills, (item) => item.ma_hop_dong),
    containersByBill: groupBy(database.containers, (item) => item.id_xnk),
    containerDetailsByContainer: groupBy(database.containerDetails, (item) => item.id_bl_container),
    transportsByContainer: groupBy(database.transports, (item) => item.id_bl_container),
  };
}

type RelationIndex = ReturnType<typeof buildRelationIndex>;

function driveDocumentMap(rows: DriveDocumentRecord[]): Map<string, DriveDocumentRecord> {
  const map = new Map<string, DriveDocumentRecord>();
  rows.forEach((row) => {
    const code = String(row.order_code ?? "").trim();
    if (code) map.set(code.toUpperCase(), row);
  });
  return map;
}

export type ShipmentListResult = { shipments: Shipment[]; lastUpdated: string; updatedBy: string };

// Lần tải danh sách gần nhất: danh sách đơn và trang chi tiết đơn (/shipments/<mã>) hiện ngay khi chuyển qua lại,
// rồi mới tải lại ngầm. Khoá theo token để đổi tài khoản không thấy dữ liệu (đã lọc theo quyền) của người trước.
let shipmentListCache: { token: string; result: ShipmentListResult } | null = null;

export function getCachedShipments(): ShipmentListResult | null {
  const token = getStoredUser()?.token || "";
  return shipmentListCache && shipmentListCache.token === token ? shipmentListCache.result : null;
}

// Lần tải đang chạy. shareInFlight (chỉ dùng cho lần tải lúc mở trang): đang có request thì chờ chung thay vì tải toàn bộ
// dữ liệu thêm lần nữa (ví dụ chuyển nhanh trang chủ <-> chi tiết). Tải lại sau khi sửa / bấm làm mới thì không truyền,
// luôn gọi request mới để không nhận kết quả của request bắt đầu trước khi lưu.
let shipmentListInFlight: { token: string; promise: Promise<ShipmentListResult> } | null = null;

// Đơn vừa tải lại riêng (fetchShipment, sau khi lưu) đánh số theo lúc bắt đầu tải. Lần tải cả danh sách bắt đầu TRƯỚC đó mà
// về sau (dữ liệu trước khi lưu) thì thay các đơn này bằng bản mới, không ghi đè cache / bảng bằng dữ liệu cũ.
let shipmentLoadSequence = 0;
const freshShipments = new Map<string, { sequence: number; token: string; shipment: Shipment }>();
const MAX_FRESH_SHIPMENTS = 100;

function applyFreshShipments(result: ShipmentListResult, token: string, startedAt: number): ShipmentListResult {
  const newer = [...freshShipments.entries()].filter(([, entry]) => entry.token === token && entry.sequence > startedAt);
  if (newer.length === 0) return result;
  const byCode = new Map(newer.map(([code, entry]) => [code, entry.shipment]));
  return {
    ...result,
    shipments: result.shipments.map((item) => {
      const fresh = byCode.get(item.orderCode.trim().toUpperCase());
      return fresh ? { ...fresh, id: item.id } : item;
    }),
  };
}

export function fetchShipments({ shareInFlight = false }: { shareInFlight?: boolean } = {}): Promise<ShipmentListResult> {
  const token = getStoredUser()?.token || "";
  if (shareInFlight && shipmentListInFlight && shipmentListInFlight.token === token) return shipmentListInFlight.promise;
  const startedAt = ++shipmentLoadSequence;
  const promise = loadShipmentList()
    .then((loaded) => {
      const result = applyFreshShipments(loaded, token, startedAt);
      shipmentListCache = { token, result };
      return result;
    })
    .finally(() => {
      if (shipmentListInFlight?.promise === promise) shipmentListInFlight = null;
    });
  shipmentListInFlight = { token, promise };
  return promise;
}

/**
 * Tải lại một đơn (trang chi tiết đơn: mở trang, tải lại sau khi lưu) thay vì cả danh sách: BE chỉ đọc dòng của đơn đó.
 * Có cache danh sách thì thay đúng đơn đó trong cache (giữ vị trí / id), để quay lại danh sách thấy dữ liệu mới ngay.
 * Trả null khi không có đơn (đã tìm lại trong cả danh sách).
 */
export async function fetchShipment(orderCode: string): Promise<Shipment | null> {
  const token = getStoredUser()?.token || "";
  const wanted = orderCode.trim().toUpperCase();
  const sequence = ++shipmentLoadSequence;
  const database = await fetchPostgresShipmentListSnapshot({ orderCode: wanted });
  const purchase = database.purchases.find((row) => String(row.ma_hop_dong || "").trim().toUpperCase() === wanted);
  if (!purchase) {
    // BE lọc bằng UPPER(TRIM()) của PostgreSQL, chỉ bỏ dấu cách: mã đơn trong DB có tab / xuống dòng / NBSP (dán từ Excel)
    // thì không khớp. Tìm lại trong cả danh sách (so khớp như trước) rồi mới kết luận không có đơn; cache được thay luôn.
    const full = await fetchShipments();
    return full.shipments.find((item) => item.orderCode.trim().toUpperCase() === wanted) || null;
  }
  const totalMap = database.driveDocuments ? driveDocumentMap(database.driveDocuments) : await fetchDriveDocumentMap();
  // Đọc cache sau khi tải xong (lúc chờ có thể đã có lần tải danh sách khác ghi vào); cache của tài khoản khác thì bỏ qua.
  const cached = shipmentListCache && shipmentListCache.token === token ? shipmentListCache.result : null;
  const cachedIndex = cached ? cached.shipments.findIndex((item) => item.orderCode.trim().toUpperCase() === wanted) : -1;
  const position = cachedIndex >= 0 ? cachedIndex : (cached?.shipments.length ?? 0);
  const shipment = mapPostgresShipment(purchase, buildRelationIndex(database), totalMap.get(wanted), position, new Date().toISOString());
  freshShipments.delete(wanted);
  freshShipments.set(wanted, { sequence, token, shipment });
  if (freshShipments.size > MAX_FRESH_SHIPMENTS) freshShipments.delete(freshShipments.keys().next().value as string);
  if (cached) {
    const shipments = cachedIndex >= 0
      ? cached.shipments.map((item, index) => (index === cachedIndex ? shipment : item))
      : [...cached.shipments, shipment];
    shipmentListCache = { token, result: { ...cached, shipments } };
  }
  return shipment;
}

async function loadShipmentList(): Promise<ShipmentListResult> {
  const database = await fetchPostgresShipmentListSnapshot();
  const totalMap = database.driveDocuments ? driveDocumentMap(database.driveDocuments) : await fetchDriveDocumentMap();
  const index = buildRelationIndex(database);
  const lastUpdated = new Date().toISOString();
  const shipments = database.purchases
    .filter((purchase) => String(purchase.ma_hop_dong || "").trim())
    .map((purchase, position) => mapPostgresShipment(
      purchase,
      index,
      totalMap.get(purchase.ma_hop_dong.trim().toUpperCase()),
      position,
      lastUpdated,
    ));
  return {
    shipments,
    lastUpdated,
    updatedBy: "PostgreSQL",
  };
}

function numberValue(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapPostgresShipment(
  purchase: PurchaseRecord,
  database: RelationIndex,
  total: DriveDocumentRecord | undefined,
  index: number,
  updatedAt: string,
): Shipment {
  const supplier = database.suppliers.get(String(purchase.id_ncc ?? ""));
  const details = (database.detailsByContract.get(String(purchase.ma_hop_dong)) || [])
    .map((detail) => ({
      ...detail,
      itemCodes: database.itemCodesByDetail.get(String(detail.id_chi_tiet)) || [],
    }));
  const bills = (database.billsByContract.get(String(purchase.ma_hop_dong)) || [])
    .map((bill) => ({
      ...bill,
      carrier: database.carriers.get(String(bill.id_hang_tau ?? "")),
      containers: (database.containersByBill.get(String(bill.id_xnk)) || [])
        .map((container) => ({
          ...container,
          details: database.containerDetailsByContainer.get(String(container.id_bl_container)) || [],
          transports: (database.transportsByContainer.get(String(container.id_bl_container)) || [])
            .map((transport) => ({
              ...transport,
              warehouse: transport.id_kho ? database.warehouses.get(String(transport.id_kho)) : undefined,
            })),
        })),
    }));
  const primaryBill = [...bills].sort((left, right) => String(left.eta || "9999-12-31").localeCompare(String(right.eta || "9999-12-31")))[0];
  const containers = bills.flatMap((bill) => bill.containers);
  const itemCodes = details.flatMap((detail) => detail.itemCodes);
  const documents = buildDocuments(total);
  const requiredDocuments = documents.filter((document) => !OPTIONAL_DOCUMENT_CODES.has(document.id));
  const receivedDocs = requiredDocuments.filter((document) => document.status === "ok").length;
  const totalDocs = requiredDocuments.length;
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
    "Tên nhà máy": itemCodes.map((item) => item.ten_nha_may).filter(Boolean).join(", "),
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
    missingDocs: requiredDocuments.filter((document) => document.status !== "ok").map((document) => document.id).join(", "),
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

export async function exportEtaRows(payload: { title: string; headers: string[]; rows: Array<Record<string, unknown>> }): Promise<void> {
  await requestJson("eta-export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getNotifications(): Promise<NotificationRecord[]> {
  return fetchNotificationRows();
}

export async function markNotificationsRead(notificationIds: Array<string | number>): Promise<void> {
  const uniqueIds = [...new Set(notificationIds.map(String).filter(Boolean))];
  if (uniqueIds.length === 0) return;
  try {
    // Một request cho mọi thông báo thay vì một PATCH cho mỗi thông báo.
    await requestJson("thong-bao/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: uniqueIds }),
    });
  } catch (error) {
    // BE cũ chưa có API gộp thì cập nhật từng thông báo như trước.
    if ((error as ApiError).status !== 404) throw error;
    await Promise.all(uniqueIds.map((id) =>
      updateDatabaseRow<NotificationRecord>(databaseEndpoints.notifications, id, { status: 1 }),
    ));
  }
}

export interface DocumentProgressResponse {
  success: boolean;
  orderCode: string;
  currentStage: number | null;
  currentStageKey?: string;
  currentStageLabel?: string;
  archiveStatus?: number;
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

export interface DeleteDocumentFileResponse {
  success: boolean;
  orderCode: string;
  documentCode: string;
  file: { fileId: string; fileName: string };
  /** Tiến độ chứng từ sau khi xoá; null nếu BE chưa tính lại được (việc xoá vẫn đã xong). */
  documentProgress: DocumentProgressResponse | null;
  files: DriveDocumentFileRecord[];
}

/** Xoá một file chứng từ: chuyển vào thùng rác Google Drive + bỏ khỏi chung_tu_drive (quyền documentDelete:edit). */
export function deleteDocumentFile(payload: { orderCode: string; documentCode: string; fileId: string }): Promise<DeleteDocumentFileResponse> {
  return requestJson<DeleteDocumentFileResponse>("deleteDocumentFile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export interface DocumentSyncCandidate {
  candidateId: string;
  fileId: string;
  fileName: string;
  fileUrl: string;
  documentCode: string;
  folderName: string;
  /** File nằm trong thư mục container (TRA_CONT, INSPECTION): mã đơn lấy theo tên thư mục. */
  containerFolder?: boolean;
  orderCode: string;
  nameValid: boolean;
  expectedFileName: string;
}

export interface DatabaseOnlyDocumentFile {
  orderCode: string;
  documentCode: string;
  fileId: string;
  fileName?: string | null;
  fileUrl?: string | null;
  reason: "not_found" | "trashed";
}

export interface DocumentSyncResult {
  success: boolean;
  snapshotId: string;
  createdAt: string;
  summary: {
    scannedFiles: number;
    removedFromDatabase: number;
    pendingCandidates: number;
    driveOnlyFiles: number;
    databaseOnlyFiles: number;
    unresolvedFiles: number;
    trashedFiles: number;
  };
  candidates: DocumentSyncCandidate[];
  databaseOnlyFiles: DatabaseOnlyDocumentFile[];
  autoAddedFiles: Array<{ fileId: string; fileName: string; documentCode: string; orderCode: string }>;
  unresolvedFiles: Array<{ fileId: string; fileName: string; documentCode: string; orderCode: string | null; folderName: string }>;
  trashedFiles: Array<{ fileId: string; fileName?: string | null; documentCode: string; orderCode: string; fileUrl?: string | null }>;
}

export function scanDocumentSync(): Promise<DocumentSyncResult> {
  return requestJson<DocumentSyncResult>("document-sync/scan", { method: "POST" });
}

export function acceptDocumentSync(candidateId: string, data: Record<string, string> = {}): Promise<unknown> {
  return requestJson("document-sync/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidateId, ...data }),
  });
}

export function rejectDocumentSync(candidateId: string): Promise<{ success: boolean }> {
  return requestJson<{ success: boolean }>("document-sync/reject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidateId }),
  });
}

export function restoreDocumentSync(fileId: string, documentCode: string): Promise<{ success: boolean; fileName?: string }> {
  return requestJson<{ success: boolean; fileName?: string }>("document-sync/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId, documentCode }),
  });
}

export function renameDocumentSync(candidateId: string, fileName: string, documentCode: string): Promise<{
  success: boolean;
  candidateId: string;
  fileId: string;
  fileName: string;
  fileUrl: string;
  orderCode: string;
  documentCode: string;
}> {
  return requestJson("document-sync/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidateId, fileName, documentCode }),
  });
}

/** Đích upload của một chứng từ (đơn, mã chứng từ, thư mục container...). */
export interface DocumentUploadTarget {
  orderCode: string;
  documentCode: string;
  referenceCode?: string;
  idChiTiet?: string;
  /** Số container, bắt buộc với TRA_CONT và INSPECTION. */
  transportCode?: string;
  /** Ghi chú nối vào tên thư mục container của INSPECTION. */
  folderNote?: string;
  /** Thư mục container đã có, dùng khi upload tiếp vào thư mục cũ. */
  containerFolderName?: string;
}

/**
 * Lượt upload để BE gom thông báo Google Chat: chọn 20 ảnh một lần = một tin "đã upload 20 file".
 * batchTotal = số file của lượt; có file lỗi thì gọi finishDocumentUploadBatch để gửi phần đã lưu.
 */
export interface DocumentUploadBatch {
  batchId: string;
  batchTotal: number;
}

export interface UploadDocumentInput extends DocumentUploadTarget {
  file: File;
  requestId: string;
  batch?: DocumentUploadBatch;
}

/** Tạo lượt upload mới cho số file người dùng vừa chọn. */
export function createUploadBatch(batchTotal: number): DocumentUploadBatch {
  return { batchId: crypto.randomUUID(), batchTotal };
}

/** Lượt upload có file lỗi: báo BE gửi ngay thông báo Google Chat cho các file đã lưu. Lỗi ở đây bỏ qua. */
export async function finishDocumentUploadBatch(batch: DocumentUploadBatch, documentCode: string): Promise<void> {
  try {
    await requestJson("finishDocumentUploadBatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadBatchId: batch.batchId, documentCode }),
    });
  } catch {
    // Thông báo Chat không quan trọng bằng upload; BE tự gửi sau một thời gian chờ.
  }
}

export type { UploadProgress };

/** Dung lượng tối đa mỗi file khi upload thẳng lên Google Drive (BE kiểm tra lại). */
export const MAX_DOCUMENT_UPLOAD_BYTES = 1024 * 1024 * 1024;
/**
 * File gửi đi phân tích OCR vẫn qua gateway Vercel (tối đa 4,5 MB mỗi request, tính cả phần đầu multipart),
 * nên giữ dưới 4 MB.
 */
export const MAX_OCR_FILE_BYTES = 4 * 1024 * 1024;

export interface DocumentFileNameCheck {
  fileName: string;
  targetName: string;
  duplicate: boolean;
  reason: "exists" | "same_batch" | null;
}

export interface DocumentFileNameCheckResponse {
  success: boolean;
  folderName: string;
  hasDuplicates: boolean;
  files: DocumentFileNameCheck[];
}

/** Kiểm tra tên sẽ lưu trên Drive có trùng không trước khi upload (không ghi gì lên Drive). */
export function checkDocumentFileNames(payload: DocumentUploadTarget & { fileNames: string[] }): Promise<DocumentFileNameCheckResponse> {
  return requestJson<DocumentFileNameCheckResponse>("checkDocumentFileNames", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export interface DocumentUploadSession {
  uploadUrl: string;
  uploadToken: string;
  fileName: string;
}

/** Lỗi mở phiên của một file: code của BE (DUPLICATE_FILE_NAME...), tên sẽ lưu và thư mục đích. */
export type DocumentUploadSessionError = Error & { code?: string; targetName?: string; folderName?: string };

/** Phiên upload của một file trong lượt: đã mở được, hoặc lỗi riêng của file đó (trùng tên, Drive không mở phiên...). */
export type DocumentUploadSessionResult = { session: DocumentUploadSession; error?: undefined } | { session?: undefined; error: Error };

function postJson<T>(path: string, body: object): Promise<T> {
  return requestJson<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Bước 1 cho cả lượt nhiều file, một request thay cho mở phiên từng file: BE kiểm tra đơn đã lưu trữ, tìm / tạo thư mục
 * và chặn trùng tên một lần rồi mở phiên upload cho mọi file. Kết quả cùng thứ tự `files`; file trùng tên hay mở phiên
 * lỗi chỉ hỏng file đó. Lỗi chung (đơn đã lưu trữ, hết quyền Google...) thì ném lỗi như các API khác.
 */
export async function openDocumentUploadSessions(target: DocumentUploadTarget, files: File[]): Promise<DocumentUploadSessionResult[]> {
  for (const file of files) {
    if (file.size <= 0) throw new Error(`File ${file.name} rỗng, không upload được`);
    if (file.size > MAX_DOCUMENT_UPLOAD_BYTES) throw new Error(`File ${file.name} vượt quá dung lượng tối đa 1 GB`);
  }
  const response = await postJson<{ files?: unknown; folderName?: unknown }>("startDocumentUploads", {
    ...target,
    files: files.map((file) => ({ fileName: file.name, fileSize: file.size, mimeType: getDocumentMimeType(file) })),
  });
  const rows = Array.isArray(response.files) ? response.files : [];
  return files.map((file, index) => {
    const row = isRecord(rows[index]) ? rows[index] : {};
    const uploadUrl = typeof row.uploadUrl === "string" ? row.uploadUrl : "";
    const uploadToken = typeof row.uploadToken === "string" ? row.uploadToken : "";
    if (uploadUrl && uploadToken) {
      return { session: { uploadUrl, uploadToken, fileName: typeof row.fileName === "string" ? row.fileName : file.name } };
    }
    const error = new Error(typeof row.message === "string" && row.message ? row.message : "Máy chủ chưa mở được phiên upload Google Drive") as DocumentUploadSessionError;
    if (typeof row.code === "string") error.code = row.code;
    // Tên sẽ lưu + thư mục để FE tự dựng câu báo trùng tên theo ngôn ngữ giao diện.
    error.targetName = typeof row.fileName === "string" ? row.fileName : file.name;
    error.folderName = typeof response.folderName === "string" ? response.folderName : "";
    return { error };
  });
}

/** Một file đã mở phiên và gửi trước phần lớn trong lúc người dùng còn xác nhận (prepareDocumentUpload). */
export interface PreparedDocumentUpload {
  /** Phiên upload của file; lỗi = trùng tên, đơn đã lưu trữ, hết quyền Google... (như mở phiên thường). */
  session: Promise<DocumentUploadSession>;
  /** Phần gửi trước đã xong hoặc đã dừng (không bao giờ lỗi; gửi trước lỗi thì lúc xác nhận gửi lại phần còn thiếu). */
  preUploaded: Promise<void>;
  /** Huỷ (người dùng bỏ file): dừng gửi trước. Drive chưa tạo file nên không phải dọn gì. */
  cancel: () => void;
}

/**
 * Mở phiên upload và gửi trước gần hết file ngay khi người dùng chọn / bấm lưu, chạy song song với OCR hoặc ghi DB.
 * Drive chỉ tạo file khi nhận byte cuối (preUploadToDriveSession), nên xác nhận thì uploadDocument(..., { prepared }) chỉ
 * còn gửi phần cuối + lưu DB; huỷ thì không để lại file nào. target giống uploadDocument (không cần referenceCode /
 * idChiTiet: hai trường này gửi lúc xác nhận).
 */
export function prepareDocumentUpload(
  target: DocumentUploadTarget,
  file: File,
  options: { onProgress?: (progress: UploadProgress) => void } = {},
): PreparedDocumentUpload {
  const controller = new AbortController();
  const session = openDocumentUploadSessions(target, [file]).then(([result]) => {
    if (!result.session) throw result.error;
    return result.session;
  });
  const preUploaded = session
    .then((opened) => preUploadToDriveSession(opened.uploadUrl, file, { signal: controller.signal, onProgress: options.onProgress }))
    .then(() => undefined, () => undefined);
  // Người gọi có thể không chờ session (huỷ sớm): không để thành lỗi không ai bắt.
  session.catch(() => {});
  return { session, preUploaded, cancel: () => controller.abort() };
}

/**
 * Upload chứng từ thẳng lên Google Drive, không qua gateway Vercel (giới hạn 4,5 MB mỗi request):
 * 1. BE đặt tên, chọn thư mục, kiểm tra trùng và mở phiên upload Drive (bỏ qua khi đã có `options.session` từ
 *    openDocumentUploadSessions, hoặc `options.prepared` từ prepareDocumentUpload: khi đó chỉ gửi phần còn lại; mở phiên
 *    trước bị lỗi thì mở lại phiên mới như thường để báo đúng lỗi);
 * 2. trình duyệt gửi file từng phần tới Google (onProgress báo số byte đã gửi);
 * 3. BE kiểm tra file trên Drive rồi lưu chung_tu_drive, trả kết quả như upload cũ.
 */
export async function uploadDocument(
  input: UploadDocumentInput,
  options: {
    onProgress?: (progress: UploadProgress) => void;
    signal?: AbortSignal;
    session?: DocumentUploadSession;
    prepared?: PreparedDocumentUpload;
  } = {},
): Promise<DriveDataResponse> {
  const { file, requestId, batch, ...target } = input;
  if (file.size <= 0) throw new Error(`File ${file.name} rỗng, không upload được`);
  if (file.size > MAX_DOCUMENT_UPLOAD_BYTES) throw new Error(`File ${file.name} vượt quá dung lượng tối đa 1 GB`);
  let result: DriveDataResponse;
  try {
    let preparedSession: DocumentUploadSession | undefined;
    if (options.prepared) {
      preparedSession = await options.prepared.session.catch(() => undefined);
      // Chờ phần gửi trước dừng hẳn rồi mới gửi tiếp, không để hai lượt gửi cùng một phiên.
      if (preparedSession) await options.prepared.preUploaded;
    }
    const openSession = () => postJson<DocumentUploadSession>("startDocumentUpload", {
      ...target,
      fileName: file.name,
      fileSize: file.size,
      mimeType: getDocumentMimeType(file),
    });
    let session = options.session ?? preparedSession ?? await openSession();
    if (!session.uploadUrl || !session.uploadToken) throw new Error("Máy chủ chưa mở được phiên upload Google Drive");
    let uploaded: { id: string };
    try {
      uploaded = await uploadFileToDriveSession(session.uploadUrl, file, {
        onProgress: options.onProgress,
        signal: options.signal,
        resume: Boolean(preparedSession),
      });
    } catch (error) {
      // Phiên mở trước (lúc chọn file / Thử lại sau lâu) đã hết hạn: mở phiên mới rồi gửi lại cả file.
      if (!preparedSession || !(error instanceof DriveUploadError) || !error.sessionExpired) throw error;
      session = await openSession();
      if (!session.uploadUrl || !session.uploadToken) throw new Error("Máy chủ chưa mở được phiên upload Google Drive");
      uploaded = await uploadFileToDriveSession(session.uploadUrl, file, { onProgress: options.onProgress, signal: options.signal });
    }
    result = await postJson<DriveDataResponse>("completeDocumentUpload", {
      uploadToken: session.uploadToken,
      fileId: uploaded.id,
      documentCode: target.documentCode,
      referenceCode: target.referenceCode,
      idChiTiet: target.idChiTiet,
      transportCode: target.transportCode,
      requestId,
      ...(batch ? { uploadBatchId: batch.batchId, uploadBatchTotal: batch.batchTotal } : {}),
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
    if (code === "GOOGLE_DRIVE_FOLDER_NOT_FOUND") {
      throw new Error("Tài khoản Google chưa được cấp quyền truy cập thư mục chứng từ. Vui lòng kiểm tra lại quyền Google Drive hoặc liên hệ quản trị viên.");
    }
    throw error;
  }
  if (!result.fileUrl) throw new Error("[Upload chứng từ] Backend không trả fileUrl sau khi lưu file Drive");

  // Upload đã thành công: yêu cầu dropdown tải lại bảng thong_bao PostgreSQL.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(NOTIFICATIONS_SYNC_EVENT));
  }
  return result;
}

export async function getDriveFolderLinks(): Promise<DriveFolderLinks> {
  const response = await requestJson<Record<string, unknown>>("drive-folder-links");
  const documents = Object.fromEntries(
    Object.entries(response).filter(([key, value]) => key !== "source" && key !== "complete" && typeof value === "string"),
  ) as Record<string, string>;
  const names = isRecord(response.names)
    ? Object.fromEntries(Object.entries(response.names).filter(([, value]) => typeof value === "string")) as Record<string, string>
    : {};
  return {
    source: typeof response.source === "string" ? response.source : "",
    complete: typeof response.complete === "string" ? response.complete : "",
    documents,
    names,
  };
}

/** Tên chứng từ hiển thị = tên thư mục Drive bỏ số thứ tự ("01. PI Hợp đồng mua" → "PI Hợp đồng mua"). */
export function documentDisplayName(folderName: string | undefined): string {
  return String(folderName || "").replace(/^\d+\.\s*/, "").trim();
}

let documentFolderNamesCache: Promise<Record<string, string>> | null = null;
/** Tên thư mục Drive của các chứng từ; gọi API một lần cho cả phiên, lỗi thì lần sau gọi lại. */
export function getDocumentFolderNames(): Promise<Record<string, string>> {
  documentFolderNamesCache ??= getDriveFolderLinks()
    .then((links) => links.names || {})
    .catch((error: unknown) => {
      documentFolderNamesCache = null;
      throw error;
    });
  return documentFolderNamesCache;
}

export type OcrDataRow = Record<string, string>;
export interface AnalyzeDocumentResponse { success: boolean; documentType: "PI" | "INV" | "PKL" | "BL"; fileName: string; data: OcrDataRow[]; _confidence?: number; ocrConfidence?: number; _reason?: string; models?: Record<string, string>; aiAvailable?: boolean; aiWarningCode?: string; }
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
    aiAvailable: typeof raw.aiAvailable === "boolean" ? raw.aiAvailable : undefined,
    aiWarningCode: typeof raw.aiWarningCode === "string" ? raw.aiWarningCode : undefined,
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
