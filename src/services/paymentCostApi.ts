import { getStoredUser } from "@/services/authApi";
import { backendApiUrl } from "@/services/backendApiUrl";
import { createHttpApiError, createInvalidResponseError, createNetworkApiError, parseApiResponse } from "@/utils/apiError";
import type { PaymentFlow, PaymentRequestStatus } from "@/services/paymentRequestApi";

// Tab "Chi phí" của đơn hàng (BE: /api/payment-costs): chi phí theo container và theo hợp đồng (mã HD), mỗi ô = một dòng
// payment_cost (container trống = phí theo hợp đồng). Kèm trạng thái thanh toán quốc tế của hợp đồng cho tab Tổng quan.

export interface CostCategory {
  id: string;
  type: string;
  code: string;
  flow: PaymentFlow;
  name: string;
}

export interface OrderCost {
  id: string;
  /** Rỗng = phí theo hợp đồng. */
  container: string;
  categoryId: string;
  amount: string;
  requestId: string;
  requestStatus: PaymentRequestStatus | null;
}

export interface OrderCosts {
  contract: string;
  cancelled: boolean;
  /** Đơn đã qua vận chuyển biển (đã giao): không nhập thêm thanh toán quốc tế. */
  seaPassed: boolean;
  /** Tổng tiền hàng (chỉ có khi được xem tiền hàng) để điền sẵn thanh toán quốc tế. */
  goodsTotal: string;
  containers: string[];
  categories: CostCategory[];
  costs: OrderCost[];
  access: { container: { view: boolean; edit: boolean } };
}

export interface OrderCostChange {
  /** Rỗng = chi phí theo hợp đồng. */
  container: string;
  categoryId: string;
  /** null = xoá ô. */
  amount: string | null;
}

const SCOPE = "Chi phí đơn hàng";
type JsonRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const flag = (value: unknown) => value === true;

async function request(method: "GET" | "PUT" | "DELETE", path: string, body?: unknown): Promise<unknown> {
  const apiPath = `/api/payment-costs${path}`;
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
    });
  } catch (error) {
    if (error instanceof TypeError) throw createNetworkApiError(SCOPE, method, apiPath, error);
    throw error;
  }
  const { data, nonJsonPreview } = await parseApiResponse(response);
  if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("xnk:auth-expired"));
  if (!response.ok || (isRecord(data) && data.success === false)) throw createHttpApiError(SCOPE, method, apiPath, response, data, nonJsonPreview);
  if (data === null) throw createInvalidResponseError(SCOPE, method, apiPath, nonJsonPreview);
  return data;
}

function normalize(payload: unknown): OrderCosts {
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
  const access = isRecord(data.access) ? data.access : {};
  const right = (value: unknown) => ({ view: flag(isRecord(value) && value.view), edit: flag(isRecord(value) && value.edit) });
  const list = (value: unknown) => (Array.isArray(value) ? value.filter(isRecord) : []);
  return {
    contract: str(data.contract),
    cancelled: data.cancelled === true,
    seaPassed: data.qua_van_chuyen_bien === true,
    goodsTotal: str(data.tong_tien_hang),
    containers: (Array.isArray(data.containers) ? data.containers : []).map(str).filter(Boolean),
    categories: list(data.categories).map((row): CostCategory => ({
      id: str(row.id_payment_category),
      type: str(row.loai_phi),
      code: str(row.ma_phi),
      flow: row.vung_phi === "do" || row.vung_phi === "vang" ? row.vung_phi : "xanh",
      name: str(row.noi_dung),
    })).filter((row) => row.id),
    costs: list(data.costs).map((row) => ({
      id: str(row.id_payment_cost),
      container: str(row.id_container),
      categoryId: str(row.id_payment_category),
      amount: str(row.so_tien),
      requestId: str(row.id_payment_request),
      requestStatus: row.request_status === null || row.request_status === undefined ? null : Number(row.request_status) as PaymentRequestStatus,
    })),
    access: { container: right(access.container) },
  };
}

export async function getOrderCosts(contract: string): Promise<OrderCosts> {
  return normalize(await request("GET", `?contract=${encodeURIComponent(contract)}`));
}

export async function saveOrderCosts(contract: string, changes: OrderCostChange[]): Promise<OrderCosts> {
  return normalize(await request("PUT", "", {
    contract,
    items: changes.map((change) => ({
      id_container: change.container || null,
      id_payment_category: change.categoryId,
      so_tien: change.amount,
    })),
  }));
}

export interface InternationalPaymentStatus {
  /** delivered: chưa có đề nghị duyệt nhưng đơn đã qua vận chuyển biển (đã giao) — coi như đã thanh toán. */
  status: "approved" | "delivered" | "not_approved";
  requests: Array<{ id: string; status: PaymentRequestStatus }>;
}

/** Hợp đồng đã được duyệt thanh toán quốc tế chưa (tab Tổng quan, không có số tiền). */
export async function getInternationalPaymentStatus(contract: string): Promise<InternationalPaymentStatus> {
  const payload = await request("GET", `/international-payment?contract=${encodeURIComponent(contract)}`);
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
  return {
    status: data.status === "approved" || data.status === "delivered" ? data.status : "not_approved",
    requests: (Array.isArray(data.requests) ? data.requests : []).filter(isRecord).map((row) => ({ id: str(row.id), status: Number(row.status) as PaymentRequestStatus })),
  };
}

// ---------- Chi phí của tôi (GET/PUT/DELETE /api/payment-costs/mine) ----------

export type MyCostScope = "all" | "free" | "used";

export interface MyCost {
  id: string;
  /** Rỗng cả hai = chi phí vận hành; chỉ contract = phí theo hợp đồng; có container = phí container. */
  contract: string;
  container: string;
  categoryId: string;
  categoryName: string;
  code: string;
  amount: string;
  createdAt: string;
  /** Rỗng = chưa thuộc đề nghị nào (sửa / xóa được). */
  requestId: string;
  requestStatus: PaymentRequestStatus | null;
  requestSent: boolean;
}

export interface MyCostPage {
  costs: MyCost[];
  total: number;
  totalAmount: string;
}

export async function listMyCosts(params: { scope: MyCostScope; q?: string; limit: number; offset: number }): Promise<MyCostPage> {
  const query = new URLSearchParams({ scope: params.scope, limit: String(params.limit), offset: String(params.offset) });
  if (params.q) query.set("q", params.q);
  const payload = await request("GET", `/mine?${query.toString()}`);
  const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data.filter(isRecord) : [];
  const pagination = isRecord(payload) && isRecord(payload.pagination) ? payload.pagination : {};
  return {
    costs: data.map((row) => ({
      id: str(row.id_payment_cost),
      contract: str(row.id_mua_hang),
      container: str(row.id_container),
      categoryId: str(row.id_payment_category),
      categoryName: str(row.ten_phi),
      code: str(row.ma_phi),
      amount: str(row.so_tien),
      createdAt: str(row.ngay_tao),
      requestId: str(row.id_payment_request),
      requestStatus: row.request_status === null || row.request_status === undefined ? null : Number(row.request_status) as PaymentRequestStatus,
      requestSent: row.request_sent === true,
    })).filter((cost) => cost.id),
    total: Number(pagination.total) || 0,
    totalAmount: isRecord(payload) ? str(payload.totalAmount) : "0",
  };
}

/** Sửa số tiền chi phí của mình (chưa thuộc đề nghị nào). */
export async function updateMyCost(id: string, amount: string): Promise<void> {
  await request("PUT", `/mine/${encodeURIComponent(id)}`, { so_tien: amount });
}

/** Xóa chi phí của mình (chỉ khi chưa thuộc đề nghị nào). */
export async function deleteMyCost(id: string): Promise<void> {
  await request("DELETE", `/mine/${encodeURIComponent(id)}`);
}
