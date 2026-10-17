import { getStoredUser, GOOGLE_DRIVE_AUTH_REQUIRED_EVENT } from "@/services/authApi";
import { backendApiUrl } from "@/services/backendApiUrl";
import { createHttpApiError, createInvalidResponseError, createNetworkApiError, parseApiResponse } from "@/utils/apiError";
import type { PaymentCurrency } from "@/utils/paymentRequest";

// Đề nghị thanh toán (BE: /api/payment-requests). Quy trình: 1 tạo (nháp) → 2 gửi lên Google Chat → 3 duyệt / từ chối
// (trên Google Chat) → 4 lưu trữ hồ sơ (upload chứng từ vào thư mục Drive DNTT_xxx, bộ phận có quyền xác nhận).

/** -2 đã hủy, -1 không duyệt, 0 chưa duyệt (nháp nếu chưa gửi), 1 đã duyệt, 2 đã lưu trữ. */
export type PaymentRequestStatus = -2 | -1 | 0 | 1 | 2;
export type PaymentFlow = "xanh" | "vang" | "do";
export const PAYMENT_STATUSES: readonly PaymentRequestStatus[] = [0, 1, -1, 2, -2];
export const PAYMENT_STATUS_LABEL_KEYS: Record<PaymentRequestStatus, string> = {
  0: "prStatusPending",
  1: "prStatusApproved",
  [-1]: "prStatusRejected",
  2: "prStatusCompleted",
  [-2]: "prStatusCancelled",
};

export interface PaymentCategory {
  id: string;
  type: string;
  code: string;
  flow: PaymentFlow;
  name: string;
}

export interface PaymentCost {
  id: string;
  categoryId: string;
  type: string;
  code: string;
  flow: PaymentFlow;
  categoryName: string;
  amount: string;
  container: string;
  contract: string;
  requestId: string;
  createdAt: string;
}

export interface PaymentRequest {
  id: string;
  userId: number;
  creatorName: string;
  content: string;
  currency: PaymentCurrency;
  total: string;
  approverName: string;
  createdAt: string;
  updatedAt: string;
  dueDate: string;
  /** Link thư mục Drive hồ sơ (có sau lần upload chứng từ đầu tiên). */
  link: string;
  /** Lúc gửi lên Google Chat; rỗng = nháp. */
  sentAt: string;
  status: PaymentRequestStatus;
  rejectReason: string;
  hasRed: boolean;
  costCount: number;
  costs: PaymentCost[];
}

export interface PaymentRequestOptions {
  categories: PaymentCategory[];
  /** total: tổng tiền hàng (chỉ có khi được xem tiền hàng) để điền sẵn thanh toán quốc tế. */
  /** seaPassed: đơn đã qua giai đoạn vận chuyển biển (đã giao) — không tạo thanh toán quốc tế nữa. */
  contracts: Array<{ code: string; date: string; supplier: string; total: string; seaPassed: boolean }>;
  containers: Array<{ code: string; contract: string }>;
  availableCosts: PaymentCost[];
  /** Khoản phí HD × hợp đồng đã nằm trong đề nghị chưa hủy (mỗi khoản chỉ một đề nghị). */
  usedContractCosts: Array<{ contract: string; categoryId: string; requestId: string }>;
}

export interface PaymentCostInput {
  /** Có id = chi phí đã nhập sẵn / đã thuộc đề nghị; không id = chi phí mới. */
  id?: string;
  categoryId: string;
  amount: string;
  container?: string;
  contract?: string;
}

export interface PaymentRequestInput {
  content: string;
  currency: PaymentCurrency;
  dueDate: string;
  costs: PaymentCostInput[];
}

export interface PaymentDocumentFile {
  fileId: string;
  fileName: string;
  fileUrl: string;
  uploadedAt: string;
  uploadedBy: string;
}

export interface PaymentDocuments {
  folderName: string;
  folderUrl: string;
  files: PaymentDocumentFile[];
}

export interface PaymentDocumentNameCheck {
  fileName: string;
  duplicate: boolean;
  reason: "exists" | "same_batch" | null;
}

export interface PaymentRequestQuery {
  limit: number;
  offset: number;
  status?: PaymentRequestStatus;
  q?: string;
  mine?: boolean;
}

const SCOPE = "Đề nghị thanh toán";

type JsonRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const flowOf = (value: unknown): PaymentFlow => (value === "do" || value === "vang" ? value : "xanh");

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const apiPath = `/api/payment-requests${path}`;
  const token = getStoredUser()?.token?.trim();
  let response: Response;
  try {
    response = await fetch(backendApiUrl(apiPath), {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (error instanceof TypeError) throw createNetworkApiError(SCOPE, method, apiPath, error);
    throw error;
  }
  const { data, nonJsonPreview } = await parseApiResponse(response);
  if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("xnk:auth-expired"));
  if (!response.ok || (isRecord(data) && data.success === false)) {
    // Chứng từ hồ sơ dùng quyền Google Drive của người dùng như chứng từ XNK: hết quyền thì mời cấp lại — chỉ khi
    // người dùng thao tác (upload), không tự chuyển trang Google chỉ vì mở xem đề nghị.
    if (method !== "GET" && isRecord(data) && data.code === "GOOGLE_DRIVE_AUTH_REQUIRED" && typeof window !== "undefined") {
      window.dispatchEvent(new Event(GOOGLE_DRIVE_AUTH_REQUIRED_EVENT));
    }
    throw createHttpApiError(SCOPE, method, apiPath, response, data, nonJsonPreview);
  }
  if (data === null) throw createInvalidResponseError(SCOPE, method, apiPath, nonJsonPreview);
  return data as T;
}

function normalizeCost(row: unknown): PaymentCost | null {
  if (!isRecord(row) || !row.id_payment_cost) return null;
  return {
    id: str(row.id_payment_cost),
    categoryId: str(row.id_payment_category),
    type: str(row.loai_phi),
    code: str(row.ma_phi),
    flow: flowOf(row.vung_phi),
    categoryName: str(row.ten_phi ?? row.noi_dung),
    amount: str(row.so_tien),
    container: str(row.id_container),
    contract: str(row.id_mua_hang),
    requestId: str(row.id_payment_request),
    createdAt: str(row.ngay_tao),
  };
}

function normalizeRequest(row: unknown): PaymentRequest | null {
  if (!isRecord(row) || !row.id_payment_request) return null;
  const status = Number(row.status);
  const costs = Array.isArray(row.costs) ? row.costs.map(normalizeCost).filter((cost): cost is PaymentCost => cost !== null) : [];
  return {
    id: str(row.id_payment_request),
    userId: Number(row.id_user) || 0,
    creatorName: str(row.creator_name) || str(row.creator_username),
    content: str(row.noi_dung),
    currency: row.loai_tien === "USD" ? "USD" : "VND",
    total: str(row.tong_tien),
    approverName: str(row.approver_name) || str(row.approver_username),
    createdAt: str(row.ngay_tao),
    updatedAt: str(row.ngay_cap_nhat),
    dueDate: str(row.han_thanh_toan),
    link: str(row.link),
    sentAt: str(row.ngay_gui),
    status: (PAYMENT_STATUSES as readonly number[]).includes(status) ? status as PaymentRequestStatus : 0,
    rejectReason: str(row.ly_do_tu_choi),
    hasRed: row.has_red === true,
    costCount: Number(row.cost_count ?? costs.length) || 0,
    costs,
  };
}

function requireRequest(payload: unknown): PaymentRequest {
  const data = normalizeRequest(isRecord(payload) ? payload.data : null);
  if (!data) throw new Error("Phản hồi đề nghị thanh toán không hợp lệ");
  return data;
}

const toBody = (input: PaymentRequestInput) => ({
  noi_dung: input.content,
  loai_tien: input.currency,
  han_thanh_toan: input.dueDate,
  costs: input.costs.map((cost) => ({
    ...(cost.id ? { id_payment_cost: cost.id } : {}),
    id_payment_category: cost.categoryId,
    so_tien: cost.amount,
    id_container: cost.container || null,
    id_mua_hang: cost.contract || null,
  })),
});

export async function listPaymentRequests(query: PaymentRequestQuery, signal?: AbortSignal): Promise<{ requests: PaymentRequest[]; total: number; viewAll: boolean }> {
  const params = new URLSearchParams({ limit: String(query.limit), offset: String(query.offset) });
  if (query.status !== undefined) params.set("status", String(query.status));
  if (query.q) params.set("q", query.q);
  if (query.mine) params.set("mine", "1");
  const payload = await request<unknown>("GET", `?${params.toString()}`, undefined, signal);
  const rows = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  const pagination = isRecord(payload) && isRecord(payload.pagination) ? payload.pagination : {};
  const requests = rows.map(normalizeRequest).filter((row): row is PaymentRequest => row !== null);
  return {
    requests,
    total: Number.isFinite(Number(pagination.total)) ? Number(pagination.total) : requests.length,
    viewAll: isRecord(payload) && payload.viewAll === true,
  };
}

export async function getPaymentRequest(id: string, signal?: AbortSignal): Promise<PaymentRequest> {
  return requireRequest(await request<unknown>("GET", `/${encodeURIComponent(id)}`, undefined, signal));
}

export async function getPaymentRequestOptions(signal?: AbortSignal): Promise<PaymentRequestOptions> {
  const payload = await request<unknown>("GET", "/options", undefined, signal);
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
  const list = (value: unknown) => (Array.isArray(value) ? value.filter(isRecord) : []);
  return {
    categories: list(data.categories).map((row) => ({
      id: str(row.id_payment_category),
      type: str(row.loai_phi),
      code: str(row.ma_phi),
      flow: flowOf(row.vung_phi),
      name: str(row.noi_dung),
    })).filter((row) => row.id),
    contracts: list(data.contracts).map((row) => ({
      code: str(row.ma_hop_dong), date: str(row.ngay_hop_dong), supplier: str(row.ten_ncc), total: str(row.tong_tien_hang), seaPassed: row.qua_van_chuyen_bien === true,
    })).filter((row) => row.code),
    containers: list(data.containers).map((row) => ({ code: str(row.ma_container), contract: str(row.ma_hop_dong) })).filter((row) => row.code),
    availableCosts: list(data.availableCosts).map(normalizeCost).filter((cost): cost is PaymentCost => cost !== null),
    usedContractCosts: list(data.usedContractCosts)
      .map((row) => ({ contract: str(row.id_mua_hang), categoryId: str(row.id_payment_category), requestId: str(row.id_payment_request) }))
      .filter((row) => row.contract && row.categoryId && row.requestId),
  };
}

/** Bước 1: lưu nháp (chưa gửi Google Chat). */
export async function createPaymentRequest(input: PaymentRequestInput): Promise<PaymentRequest> {
  return requireRequest(await request<unknown>("POST", "", toBody(input)));
}

/** Sửa đề nghị: quay về nháp, phải xem lại và gửi lại. */
export async function updatePaymentRequest(id: string, input: PaymentRequestInput): Promise<PaymentRequest> {
  return requireRequest(await request<unknown>("PUT", `/${encodeURIComponent(id)}`, toBody(input)));
}

/** Bước 2: xác nhận gửi (hoặc gửi lại) thẻ đề nghị lên Google Chat. */
export async function sendPaymentRequest(id: string): Promise<PaymentRequest> {
  return requireRequest(await request<unknown>("POST", `/${encodeURIComponent(id)}/send`));
}

/** Người tạo (hoặc kế toán) hủy đề nghị chưa duyệt / bị từ chối. Không có xóa đề nghị. */
export async function cancelPaymentRequest(id: string): Promise<PaymentRequest> {
  return requireRequest(await request<unknown>("POST", `/${encodeURIComponent(id)}/cancel`));
}

/** Bước 4: xác nhận đầy đủ chứng từ → đề nghị hoàn thành (khóa). */
export async function confirmPaymentRequestDocuments(id: string): Promise<PaymentRequest> {
  return requireRequest(await request<unknown>("POST", `/${encodeURIComponent(id)}/confirm-documents`));
}

function normalizeDocumentFile(row: unknown): PaymentDocumentFile | null {
  if (!isRecord(row) || !row.fileId || row.isFolder === true) return null;
  return {
    fileId: str(row.fileId),
    fileName: str(row.fileName),
    fileUrl: str(row.fileUrl),
    uploadedAt: str(row.uploadedAt),
    uploadedBy: str(row.uploadedBy),
  };
}

export async function listPaymentDocuments(id: string, signal?: AbortSignal): Promise<PaymentDocuments> {
  const payload = await request<unknown>("GET", `/${encodeURIComponent(id)}/documents`, undefined, signal);
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
  return {
    folderName: str(data.folderName),
    folderUrl: str(data.folderUrl),
    files: (Array.isArray(data.files) ? data.files : []).map(normalizeDocumentFile).filter((file): file is PaymentDocumentFile => file !== null),
  };
}

/** Kiểm tra trùng tên trước khi upload (như chứng từ XNK). */
export async function checkPaymentDocumentNames(id: string, fileNames: string[]): Promise<PaymentDocumentNameCheck[]> {
  const payload = await request<unknown>("POST", `/${encodeURIComponent(id)}/documents/check-names`, { fileNames });
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
  return (Array.isArray(data.files) ? data.files : []).filter(isRecord).map((row) => ({
    fileName: str(row.fileName),
    duplicate: row.duplicate === true,
    reason: row.reason === "exists" || row.reason === "same_batch" ? row.reason : null,
  }));
}

/** Bỏ chứng từ up nhầm khi đề nghị chưa hoàn thành (file vào thùng rác Drive). */
export async function removePaymentDocument(id: string, fileId: string): Promise<void> {
  await request<unknown>("DELETE", `/${encodeURIComponent(id)}/documents/${encodeURIComponent(fileId)}`);
}

export async function uploadPaymentDocument(id: string, file: { name: string; type: string; data: string }): Promise<PaymentDocumentFile> {
  const payload = await request<unknown>("POST", `/${encodeURIComponent(id)}/documents`, { fileName: file.name, mimeType: file.type, fileData: file.data });
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
  const uploaded = normalizeDocumentFile(data.file);
  if (!uploaded) throw new Error("Phản hồi upload chứng từ không hợp lệ");
  return uploaded;
}
