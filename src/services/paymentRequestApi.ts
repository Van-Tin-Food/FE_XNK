import { getStoredUser, GOOGLE_DRIVE_AUTH_REQUIRED_EVENT } from "@/services/authApi";
import { backendApiUrl } from "@/services/backendApiUrl";
import { createHttpApiError, createInvalidResponseError, createNetworkApiError, parseApiResponse } from "@/utils/apiError";
import type { PaymentCurrency } from "@/utils/paymentRequest";
import { uploadFileToDriveSession, type UploadProgress } from "@/utils/driveResumableUpload";

// Đề nghị thanh toán (BE: /api/payment-requests). Quy trình 4 giai đoạn: 1 lên đề nghị (nháp) và gửi lên Google Chat →
// 2 duyệt / từ chối → 3 chi tiền (người có quyền upload ủy nhiệm chi / ảnh chuyển tiền, trên hệ thống hoặc gửi file vào thread
// Chat) → 4 lưu trữ hồ sơ (chứng từ trong thư mục Drive DNTT_xxx, bộ phận có quyền xác nhận đầy đủ).

/** -2 đã hủy, -1 không duyệt, 0 chưa duyệt (nháp nếu chưa gửi), 1 đã duyệt (chờ chi tiền), 3 đã chi tiền, 2 đã lưu trữ. */
export type PaymentRequestStatus = -2 | -1 | 0 | 1 | 2 | 3;
export type PaymentFlow = "xanh" | "vang" | "do";
export const PAYMENT_STATUSES: readonly PaymentRequestStatus[] = [0, 1, 3, -1, 2, -2];
export const PAYMENT_STATUS_LABEL_KEYS: Record<PaymentRequestStatus, string> = {
  0: "prStatusPending",
  1: "prStatusApproved",
  3: "prStatusPaid",
  [-1]: "prStatusRejected",
  2: "prStatusCompleted",
  [-2]: "prStatusCancelled",
};
/** Loại chứng từ: ủy nhiệm chi / ảnh chuyển tiền (bước chi tiền). Chứng từ hồ sơ không có loại. */
export const PAYMENT_PROOF = "payment_proof" as const;
export type PaymentDocumentKind = typeof PAYMENT_PROOF | null;

export interface PaymentCategory {
  id: string;
  type: string;
  code: string;
  flow: PaymentFlow;
  name: string;
  /** Danh mục có thuế: tạo đề nghị phải nhập % VAT (số tiền luôn là số đã gồm VAT). */
  taxed: boolean;
}

export interface PaymentCost {
  id: string;
  categoryId: string;
  type: string;
  code: string;
  flow: PaymentFlow;
  categoryName: string;
  amount: string;
  /** Nội dung / diễn giải khoản (ví dụ "tháng 10"). */
  note: string;
  /** Khoản thuộc danh mục có thuế. */
  taxed: boolean;
  /** % VAT (rỗng = không thuế / chưa nhập); amount đã gồm VAT. */
  vat: string;
  container: string;
  contract: string;
  requestId: string;
  createdAt: string;
}

/**
 * Thông tin người thụ hưởng khi chuyển khoản: FE gửi khối "Nhãn: giá trị" mỗi dòng, BE đổi nhãn sang khoá JSON
 * (TRANSFER_KEY_BY_LABEL ở paymentRequestService.js) và lưu cột JSONB thong_tin_chuyen_khoan; đọc ra lại dạng nhãn.
 * Nhãn (label) và khoá (jsonKey) phải khớp BE. Quốc tế = đề nghị có khoản Cọc hàng / Thanh toán tiền còn lại.
 */
export type TransferKind = "domestic" | "international";
export interface TransferField {
  label: string;
  /** Khoá bản dịch nhãn hiển thị. */
  key: string;
  /** Khoá trong JSON lưu ở BE (cũng là khoá của gợi ý người thụ hưởng). */
  jsonKey: TransferJsonKey;
  required: boolean;
  multiline?: boolean;
}
export type TransferJsonKey = keyof PaymentBeneficiarySuggestion | "noi_dung_thanh_toan";
export const TRANSFER_FIELDS: Record<TransferKind, TransferField[]> = {
  domestic: [
    { label: "Số tài khoản", key: "prTf_accountNumber", jsonKey: "so_tai_khoan", required: true },
    { label: "Tên người thụ hưởng", key: "prTf_beneficiaryName", jsonKey: "ten_nguoi_thu_huong", required: true },
    { label: "Tên ngân hàng", key: "prTf_bankName", jsonKey: "ten_ngan_hang", required: true },
    { label: "Nội dung thanh toán", key: "prTf_paymentNote", jsonKey: "noi_dung_thanh_toan", required: false },
  ],
  international: [
    { label: "Số IBAN người thụ hưởng", key: "prTf_iban", jsonKey: "so_tai_khoan", required: true },
    { label: "Tên người thụ hưởng", key: "prTf_beneficiaryName", jsonKey: "ten_nguoi_thu_huong", required: true },
    { label: "Tên ngân hàng thụ hưởng", key: "prTf_beneficiaryBank", jsonKey: "ten_ngan_hang", required: true },
    { label: "Mã SWIFT", key: "prTf_swift", jsonKey: "ma_swift", required: true },
    { label: "Địa chỉ người thụ hưởng", key: "prTf_beneficiaryAddress", jsonKey: "dia_chi_nguoi_thu_huong", required: false },
    { label: "Địa chỉ ngân hàng thụ hưởng", key: "prTf_beneficiaryBankAddress", jsonKey: "dia_chi_ngan_hang", required: false },
    { label: "Ngân hàng trung gian", key: "prTf_intermediaryBank", jsonKey: "ngan_hang_trung_gian", required: false, multiline: true },
    { label: "Nội dung thanh toán", key: "prTf_paymentNote", jsonKey: "noi_dung_thanh_toan", required: false },
  ],
};

/** "Nhãn: giá trị" từng dòng → { nhãn: giá trị }. Dòng không theo mẫu (dữ liệu cũ) gom vào khoá "". */
export function parseTransferInfo(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = /^([^:]{1,60}):\s*(.*)$/.exec(line.trim());
    if (match) values[match[1].trim()] = match[2].trim();
    else if (line.trim()) values[""] = [values[""], line.trim()].filter(Boolean).join(" ");
  }
  return values;
}

/** Ghép các trường đã điền thành khối "Nhãn: giá trị" (bỏ trường trống, xuống dòng trong ô gộp thành "; "). */
export function buildTransferInfo(kind: TransferKind, values: Record<string, string>): string {
  return TRANSFER_FIELDS[kind]
    .map((field) => [field.label, (values[field.label] || "").split(/\r?\n/).map((part) => part.trim()).filter(Boolean).join("; ")] as const)
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

/** Hình thức thanh toán: tiền mặt / chuyển khoản. */
export const PAYMENT_METHODS = ["chuyen_khoan", "tien_mat"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABEL_KEYS: Record<PaymentMethod, string> = { chuyen_khoan: "prMethod_chuyen_khoan", tien_mat: "prMethod_tien_mat" };

export interface PaymentRequest {
  id: string;
  userId: number;
  creatorName: string;
  content: string;
  currency: PaymentCurrency;
  /** Hình thức thanh toán; rỗng = đề nghị cũ chưa có. */
  paymentMethod: PaymentMethod | "";
  /** Chuyển khoản: thông tin người thụ hưởng (nhiều dòng: tên tài khoản, ngân hàng, số tài khoản, nội dung CK...). */
  transferInfo: string;
  /** Mã ngân hàng (BIN) đã chọn từ danh sách (chuyển khoản trong nước); "" = chưa chọn / đề nghị cũ gõ tên tự do. */
  bankBin: string;
  total: string;
  approverName: string;
  createdAt: string;
  updatedAt: string;
  dueDate: string;
  /** Link thư mục Drive hồ sơ (có sau lần upload chứng từ đầu tiên). */
  link: string;
  /** Đã gửi lên Google Chat (false = nháp). */
  sent: boolean;
  status: PaymentRequestStatus;
  /** Ghi chú duyệt (cột ghi_chu_duyet): lý do khi từ chối, ghi chú (không bắt buộc) khi duyệt. */
  decisionNote: string;
  hasRed: boolean;
  /** Người đang xem được duyệt / từ chối đề nghị này (luồng đỏ chỉ kế toán); null = BE không trả (danh sách, kết quả duyệt). */
  canDecide: boolean | null;
  /** Người đang xem được chi tiền (upload ủy nhiệm chi); null = BE không trả (danh sách). */
  canRecordPayment: boolean | null;
  costCount: number;
  costs: PaymentCost[];
}

/** Ngân hàng trong danh sách chọn (bảng payment_bank): bin = mã NAPAS 6 số dùng tạo mã VietQR. */
export interface PaymentBank {
  bin: string;
  code: string;
  shortName: string;
  name: string;
}

/** Tên ngân hàng lưu vào thông tin chuyển khoản khi chọn từ danh sách: "Vietcombank - Ngân hàng TMCP Ngoại Thương Việt Nam". */
export const bankLabel = (bank: PaymentBank) => (bank.name && bank.name !== bank.shortName ? `${bank.shortName} - ${bank.name}` : bank.shortName);

export interface PaymentRequestOptions {
  categories: PaymentCategory[];
  contracts: Array<{ code: string; date: string; supplier: string }>;
  containers: Array<{ code: string; contract: string }>;
  /** Chi phí nhập sẵn ở tab Chi phí (container / hợp đồng) chưa thuộc đề nghị nào. */
  availableCosts: PaymentCost[];
  /** Danh sách ngân hàng (chuyển khoản trong nước); rỗng = BE chưa có bảng ngân hàng. */
  banks: PaymentBank[];
}

export interface PaymentBeneficiarySuggestion {
  so_tai_khoan: string;
  ten_nguoi_thu_huong?: string;
  ten_ngan_hang?: string;
  /** Mã ngân hàng (BIN) nếu lần trước chọn từ danh sách. */
  ma_ngan_hang?: string;
  dia_chi_nguoi_thu_huong?: string;
  ma_swift?: string;
  dia_chi_ngan_hang?: string;
  ngan_hang_trung_gian?: string;
}

export interface PaymentCostInput {
  /** Có id = chi phí đã nhập sẵn / đã thuộc đề nghị; không id = chi phí mới. */
  id?: string;
  categoryId: string;
  amount: string;
  container?: string;
  contract?: string;
  /** Nội dung / diễn giải khoản (chi phí vận hành nhập tay). */
  note?: string;
  /** % VAT (khoản có thuế). */
  vat?: string;
}

export interface PaymentRequestInput {
  content: string;
  currency: PaymentCurrency;
  paymentMethod: PaymentMethod;
  transferInfo: string;
  /** Mã ngân hàng (BIN) chọn từ danh sách — chuyển khoản trong nước, dùng tạo mã VietQR. */
  bankBin?: string;
  dueDate: string;
  costs: PaymentCostInput[];
}

export interface PaymentDocumentFile {
  fileId: string;
  fileName: string;
  fileUrl: string;
  uploadedAt: string;
  uploadedBy: string;
  kind: PaymentDocumentKind;
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
  /** Lọc đề nghị có ít nhất một chi phí thuộc mã phí này (vd CONT). */
  costCode?: string;
  sort?: PaymentRequestSortKey;
  dir?: "asc" | "desc";
}

/** Cột sắp xếp danh sách (BE chỉ nhận đúng các khoá này). */
export type PaymentRequestSortKey = "id" | "creator" | "content" | "cost" | "total" | "due" | "status";

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
    categoryName: str(row.ten_phi),
    amount: str(row.so_tien),
    note: str(row.noi_dung),
    taxed: row.co_thue === true,
    vat: str(row.phan_tram_vat),
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
    paymentMethod: (PAYMENT_METHODS as readonly string[]).includes(str(row.hinh_thuc_thanh_toan)) ? str(row.hinh_thuc_thanh_toan) as PaymentMethod : "",
    transferInfo: str(row.thong_tin_chuyen_khoan),
    bankBin: isRecord(row.chuyen_khoan) ? str(row.chuyen_khoan.ma_ngan_hang) : "",
    total: str(row.tong_tien),
    approverName: str(row.approver_name) || str(row.approver_username),
    createdAt: str(row.ngay_tao),
    updatedAt: str(row.ngay_cap_nhat),
    dueDate: str(row.han_thanh_toan),
    link: str(row.link),
    sent: row.da_gui === true,
    status: (PAYMENT_STATUSES as readonly number[]).includes(status) ? status as PaymentRequestStatus : 0,
    decisionNote: str(row.ghi_chu_duyet),
    hasRed: row.has_red === true,
    canDecide: row.can_decide === undefined || row.can_decide === null ? null : row.can_decide === true,
    canRecordPayment: row.can_record_payment === undefined || row.can_record_payment === null ? null : row.can_record_payment === true,
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
  hinh_thuc_thanh_toan: input.paymentMethod,
  thong_tin_chuyen_khoan: input.paymentMethod === "chuyen_khoan" ? input.transferInfo : null,
  ma_ngan_hang: input.paymentMethod === "chuyen_khoan" && input.bankBin ? input.bankBin : null,
  han_thanh_toan: input.dueDate,
  costs: input.costs.map((cost) => ({
    ...(cost.id ? { id_payment_cost: cost.id } : {}),
    id_payment_category: cost.categoryId,
    so_tien: cost.amount,
    id_container: cost.container || null,
    id_mua_hang: cost.contract || null,
    noi_dung: cost.note || null,
    phan_tram_vat: cost.vat || null,
  })),
});

export async function listPaymentRequests(query: PaymentRequestQuery, signal?: AbortSignal): Promise<{ requests: PaymentRequest[]; total: number; viewAll: boolean; costCodes: string[] }> {
  const params = new URLSearchParams({ limit: String(query.limit), offset: String(query.offset) });
  if (query.status !== undefined) params.set("status", String(query.status));
  if (query.q) params.set("q", query.q);
  if (query.mine) params.set("mine", "1");
  if (query.costCode) params.set("ma_phi", query.costCode);
  if (query.sort) {
    params.set("sort", query.sort);
    params.set("dir", query.dir === "asc" ? "asc" : "desc");
  }
  const payload = await request<unknown>("GET", `?${params.toString()}`, undefined, signal);
  const rows = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  const pagination = isRecord(payload) && isRecord(payload.pagination) ? payload.pagination : {};
  const requests = rows.map(normalizeRequest).filter((row): row is PaymentRequest => row !== null);
  return {
    requests,
    total: Number.isFinite(Number(pagination.total)) ? Number(pagination.total) : requests.length,
    viewAll: isRecord(payload) && payload.viewAll === true,
    costCodes: isRecord(payload) && Array.isArray(payload.costCodes) ? payload.costCodes.map(str).filter(Boolean) : [],
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
      taxed: row.co_thue === true,
    })).filter((row) => row.id),
    contracts: list(data.contracts).map((row) => ({ code: str(row.ma_hop_dong), date: str(row.ngay_hop_dong), supplier: str(row.ten_ncc) })).filter((row) => row.code),
    containers: list(data.containers).map((row) => ({ code: str(row.ma_container), contract: str(row.ma_hop_dong) })).filter((row) => row.code),
    availableCosts: list(data.availableCosts).map(normalizeCost).filter((cost): cost is PaymentCost => cost !== null),
    banks: list(data.banks).map((row) => ({ bin: str(row.bin), code: str(row.ma_ngan_hang), shortName: str(row.ten_viet_tat), name: str(row.ten_ngan_hang) }))
      .filter((bank) => /^\d{6}$/.test(bank.bin)),
  };
}

/** Mã VietQR chuyển khoản của đề nghị (BE tạo ảnh PNG). available = false: không tạo được, reason cho biết vì sao. */
export interface PaymentTransferQr {
  available: boolean;
  reason: string;
  bankName: string;
  account: string;
  accountName: string;
  amount: string;
  content: string;
  /** Ảnh PNG (data URL). */
  image: string;
}

export async function getPaymentTransferQr(id: string, signal?: AbortSignal): Promise<PaymentTransferQr> {
  const payload = await request<unknown>("GET", `/${encodeURIComponent(id)}/transfer-qr`, undefined, signal);
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
  return {
    available: data.available === true && str(data.image).startsWith("data:image/png;base64,"),
    reason: str(data.reason),
    bankName: str(data.bankName),
    account: str(data.account),
    accountName: str(data.accountName),
    amount: str(data.amount),
    content: str(data.content),
    image: str(data.image),
  };
}

export async function searchPaymentBeneficiaries(q: string, kind: TransferKind, signal?: AbortSignal): Promise<PaymentBeneficiarySuggestion[]> {
  if (q.trim().length < 2) return [];
  const payload = await request<unknown>("GET", `/beneficiaries?q=${encodeURIComponent(q)}&kind=${encodeURIComponent(kind)}`, undefined, signal);
  const rows = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  return rows.filter(isRecord).map((row) => ({
    so_tai_khoan: str(row.so_tai_khoan),
    ten_nguoi_thu_huong: str(row.ten_nguoi_thu_huong) || undefined,
    ten_ngan_hang: str(row.ten_ngan_hang) || undefined,
    ma_ngan_hang: str(row.ma_ngan_hang) || undefined,
    dia_chi_nguoi_thu_huong: str(row.dia_chi_nguoi_thu_huong) || undefined,
    ma_swift: str(row.ma_swift) || undefined,
    dia_chi_ngan_hang: str(row.dia_chi_ngan_hang) || undefined,
    ngan_hang_trung_gian: str(row.ngan_hang_trung_gian) || undefined,
  })).filter((row) => row.so_tai_khoan);
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

/**
 * Báo thiếu chứng từ: BE gửi vào hộp chat Google Chat cá nhân của người tạo đề nghị (webhook users.space_google; người đề
 * nghị không ở trong nhóm Chat duyệt). Người tạo chưa có webhook: lỗi 409 PAYMENT_REQUESTER_NO_CHAT.
 */
export async function notifyMissingPaymentDocuments(id: string, note: string): Promise<{ requesterName: string }> {
  const payload = await request<unknown>("POST", `/${encodeURIComponent(id)}/missing-documents`, { note });
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
  return { requesterName: str(data.requesterName) };
}

export async function approvePaymentRequest(id: string): Promise<PaymentRequest> {
  return requireRequest(await request<unknown>("POST", `/${encodeURIComponent(id)}/approve`));
}

export async function rejectPaymentRequest(id: string, note: string): Promise<PaymentRequest> {
  return requireRequest(await request<unknown>("POST", `/${encodeURIComponent(id)}/reject`, { note }));
}

function normalizeDocumentFile(row: unknown): PaymentDocumentFile | null {
  if (!isRecord(row) || !row.fileId || row.isFolder === true) return null;
  return {
    fileId: str(row.fileId),
    fileName: str(row.fileName),
    fileUrl: str(row.fileUrl),
    uploadedAt: str(row.uploadedAt),
    uploadedBy: str(row.uploadedBy),
    kind: row.kind === PAYMENT_PROOF ? PAYMENT_PROOF : null,
  };
}

/** Danh sách chứng từ (BE đọc bảng chứng từ); refresh = true: BE đọc lại thư mục Drive (file sửa thẳng trên Drive). */
export async function listPaymentDocuments(id: string, signal?: AbortSignal, options: { refresh?: boolean } = {}): Promise<PaymentDocuments> {
  const query = options.refresh ? "?refresh=1" : "";
  const payload = await request<unknown>("GET", `/${encodeURIComponent(id)}/documents${query}`, undefined, signal);
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
  return {
    folderName: str(data.folderName),
    folderUrl: str(data.folderUrl),
    files: (Array.isArray(data.files) ? data.files : []).map(normalizeDocumentFile).filter((file): file is PaymentDocumentFile => file !== null),
  };
}

/** Kiểm tra trùng tên trước khi upload (như chứng từ XNK). */
export async function checkPaymentDocumentNames(id: string, fileNames: string[], kind: PaymentDocumentKind = null): Promise<PaymentDocumentNameCheck[]> {
  const payload = await request<unknown>("POST", `/${encodeURIComponent(id)}/documents/check-names`, { fileNames, ...(kind ? { kind } : {}) });
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

/**
 * Upload một chứng từ thẳng lên Google Drive (như chứng từ XNK): BE mở phiên upload -> trình duyệt gửi file thẳng tới
 * Google (từng phần 8 MB, tự gửi tiếp khi rớt mạng) -> BE kiểm tra và ghi nhận. File không đi qua gateway / proxy nên
 * không bị giới hạn kích thước request ở các tầng đó (trước đây gửi Base64 qua gateway, file ~500 KB đã có thể bị 413).
 * kind = payment_proof: ủy nhiệm chi / ảnh chuyển tiền — BE chuyển đề nghị sang đã chi tiền; announce = false khi còn file
 * khác trong cùng lượt (BE chỉ báo "Đã chi tiền" lên Google Chat ở file cuối).
 */
export async function uploadPaymentDocument(
  id: string,
  file: File,
  mimeType: string,
  options: { onProgress?: (progress: UploadProgress) => void; signal?: AbortSignal; kind?: PaymentDocumentKind; announce?: boolean } = {},
): Promise<PaymentDocumentFile> {
  const base = `/${encodeURIComponent(id)}/documents`;
  const kind = options.kind ? { kind: options.kind } : {};
  const startPayload = await request<unknown>("POST", `${base}/start-upload`, { fileName: file.name, fileSize: file.size, mimeType, ...kind });
  const session = isRecord(startPayload) && isRecord(startPayload.data) ? startPayload.data : {};
  const uploadUrl = str(session.uploadUrl);
  const uploadToken = str(session.uploadToken);
  if (!uploadUrl || !uploadToken) throw new Error("Máy chủ chưa mở được phiên upload Google Drive");
  return sendPaymentDocument(id, { fileName: file.name, uploadUrl, uploadToken }, file, options);
}

/** Phiên upload Google Drive BE đã mở cho một file của lượt upload. */
export interface PaymentUploadSession {
  fileName: string;
  uploadUrl: string;
  uploadToken: string;
}

/**
 * Bước 1 cho cả lượt chọn file (một lần gọi BE): kiểm tra trùng tên (với thư mục + trong lượt) và mở phiên upload cho mọi
 * file. Có file trùng: duplicates khác rỗng, sessions rỗng. sessions cùng thứ tự với files.
 */
export async function startPaymentDocumentUploads(
  id: string,
  files: Array<{ file: File; mimeType: string }>,
  kind: PaymentDocumentKind = null,
): Promise<{ duplicates: string[]; sessions: PaymentUploadSession[] }> {
  const payload = await request<unknown>("POST", `/${encodeURIComponent(id)}/documents/start-uploads`, {
    files: files.map(({ file, mimeType }) => ({ fileName: file.name, fileSize: file.size, mimeType })),
    ...(kind ? { kind } : {}),
  });
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
  const duplicates = (Array.isArray(data.duplicates) ? data.duplicates : []).filter(isRecord).map((row) => str(row.fileName));
  const sessions = (Array.isArray(data.sessions) ? data.sessions : []).filter(isRecord).map((row) => ({
    fileName: str(row.fileName),
    uploadUrl: str(row.uploadUrl),
    uploadToken: str(row.uploadToken),
  }));
  if (!duplicates.length && (sessions.length !== files.length || sessions.some((session) => !session.uploadUrl || !session.uploadToken))) {
    throw new Error("Máy chủ chưa mở được phiên upload Google Drive");
  }
  return { duplicates, sessions };
}

/**
 * Bước 2 + 3 cho một file: gửi file thẳng tới phiên upload Google Drive (từng phần, tự gửi tiếp khi rớt mạng), rồi BE kiểm
 * tra và ghi nhận. announce = false: ủy nhiệm chi còn file khác trong lượt (BE chỉ báo "Đã chi tiền" ở file cuối).
 */
export async function sendPaymentDocument(
  id: string,
  session: PaymentUploadSession,
  file: File,
  options: { onProgress?: (progress: UploadProgress) => void; signal?: AbortSignal; announce?: boolean } = {},
): Promise<PaymentDocumentFile> {
  const uploaded = await uploadFileToDriveSession(session.uploadUrl, file, options);
  const payload = await request<unknown>("POST", `/${encodeURIComponent(id)}/documents/complete-upload`, {
    uploadToken: session.uploadToken,
    fileId: uploaded.id,
    ...(options.announce === false ? { announce: false } : {}),
  });
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
  const result = normalizeDocumentFile(data.file);
  if (!result) throw new Error("Phản hồi upload chứng từ không hợp lệ");
  return result;
}

/** Bản in Giấy đề nghị thanh toán (Mẫu 05-TT, layout công ty): trang HTML để xem trước rồi "In / Lưu PDF". */
export async function fetchPaymentRequestPrintHtml(id: string): Promise<string> {
  const apiPath = `/api/payment-requests/${encodeURIComponent(id)}/print`;
  const token = getStoredUser()?.token?.trim();
  let response: Response;
  try {
    response = await fetch(backendApiUrl(apiPath), {
      headers: { Accept: "text/html, application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof TypeError) throw createNetworkApiError(SCOPE, "GET", apiPath, error);
    throw error;
  }
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("xnk:auth-expired"));
    const { data, nonJsonPreview } = await parseApiResponse(response);
    throw createHttpApiError(SCOPE, "GET", apiPath, response, data, nonJsonPreview);
  }
  return response.text();
}
