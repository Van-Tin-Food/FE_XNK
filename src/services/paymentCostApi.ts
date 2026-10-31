import type { CostKind, MonthlyCost, Payable, ShipmentCost, ShipmentInfo } from "@/utils/costStatistics";
import { getStoredUser } from "@/services/authApi";
import { backendApiUrl } from "@/services/backendApiUrl";
import { createHttpApiError, createInvalidResponseError, createNetworkApiError, parseApiResponse } from "@/utils/apiError";
import type { PaymentFlow, PaymentRequestStatus } from "@/services/paymentRequestApi";

// Tab "Chi phí" của đơn hàng (BE: /api/payment-costs): chi phí theo container và theo hợp đồng (mã HD), mỗi ô = một dòng
// payment_cost (container trống = phí theo hợp đồng). Kèm trạng thái thanh toán tiền hàng (cọc / còn lại) của hợp đồng cho tab Tổng quan.

export interface CostCategory {
  id: string;
  type: string;
  code: string;
  account: string;
  flow: PaymentFlow;
  name: string;
  /** Danh mục có thuế: tạo đề nghị phải nhập % VAT. */
  taxed: boolean;
}

export interface OrderCost {
  id: string;
  /** Rỗng = phí theo hợp đồng. */
  container: string;
  categoryId: string;
  amount: string;
  /** Nội dung / diễn giải khoản. */
  note: string;
  /** % VAT (rỗng = không thuế / chưa nhập); số tiền đã gồm VAT. */
  vat: string;
  requestId: string;
  requestStatus: PaymentRequestStatus | null;
}

export interface OrderCosts {
  contract: string;
  cancelled: boolean;
  /** Đơn đã qua vận chuyển biển (đã giao): không nhập thêm cọc / thanh toán còn lại. */
  seaPassed: boolean;
  /** Tổng tiền hàng (chỉ có khi được xem tiền hàng) để tính sẵn thanh toán còn lại = tiền hàng - cọc. */
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
  /** Nội dung / diễn giải khoản (trống = không ghi). */
  note?: string;
}

const SCOPE = "Chi phí đơn hàng";
type JsonRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const flag = (value: unknown) => value === true;

async function request(method: "GET" | "PUT" | "DELETE", path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
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
      signal,
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
      account: str(row.tai_khoang),
      flow: row.vung_phi === "do" || row.vung_phi === "vang" ? row.vung_phi : "xanh",
      name: str(row.noi_dung),
      taxed: row.co_thue === true,
    })).filter((row) => row.id),
    costs: list(data.costs).map((row) => ({
      id: str(row.id_payment_cost),
      container: str(row.id_container),
      categoryId: str(row.id_payment_category),
      amount: str(row.so_tien),
      note: str(row.noi_dung),
      vat: str(row.phan_tram_vat),
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
      noi_dung: change.note || null,
    })),
  }));
}

/**
 * Thanh toán tiền hàng (quốc tế) chia 2 đợt, mã HD, nhận theo đúng tên trong danh mục (khớp GOODS_PAYMENTS ở BE):
 * Cọc hàng + Thanh toán tiền còn lại = tiền hàng của hợp đồng.
 */
export type GoodsPaymentKind = "deposit" | "balance";
const GOODS_PAYMENT_NAMES: Record<GoodsPaymentKind, string> = { deposit: "cọc hàng", balance: "thanh toán tiền còn lại" };
export function goodsPaymentKind(category: { code: string; name: string } | null | undefined): GoodsPaymentKind | null {
  if (!category || category.code.trim().toUpperCase() !== "HD") return null;
  const name = category.name.trim().toLowerCase();
  return (Object.keys(GOODS_PAYMENT_NAMES) as GoodsPaymentKind[]).find((kind) => GOODS_PAYMENT_NAMES[kind] === name) || null;
}

/** delivered: chưa có đề nghị duyệt nhưng đơn đã qua vận chuyển biển (đã giao) — coi như đã thanh toán. */
export type GoodsPaymentState = "approved" | "delivered" | "not_approved";
type RequestRef = { id: string; status: PaymentRequestStatus };

export interface InternationalPaymentStatus {
  /** Trạng thái chung = đợt thanh toán còn lại (đã trả đủ tiền hàng). */
  status: GoodsPaymentState;
  requests: RequestRef[];
  /** Từng đợt: cọc hàng, thanh toán tiền còn lại. amount: chỉ có khi được xem tiền hàng (null = chưa nhập / không được xem). */
  items: Array<{ key: GoodsPaymentKind; status: GoodsPaymentState; requests: RequestRef[]; amount: string | null }>;
  /** Có khi được xem tiền hàng (quyền purchaseAmounts). */
  showAmounts: boolean;
  goodsTotal: string;
}

/** Trạng thái một đợt ở bảng danh sách đơn: đã duyệt / chờ duyệt / bị từ chối / đã giao (coi như đã trả) / chưa có đề nghị. */
export type GoodsPaymentListState = "approved" | "pending" | "rejected" | "delivered" | "none";
export type GoodsPaymentSummary = Record<string, Record<GoodsPaymentKind, GoodsPaymentListState>>;
const LIST_STATES: GoodsPaymentListState[] = ["approved", "pending", "rejected", "delivered", "none"];

/** Trang chủ: trạng thái cọc / còn lại của mọi đơn (theo mã hợp đồng) trong một request, cho cột "Thanh toán QT". */
// Trang chủ gọi trước (song song với danh sách đơn) rồi bảng dùng lại: đang tải thì chờ chung, vừa tải trong
// SUMMARY_FRESH_MS thì dùng lại (quay lại tab liên tục không tải lại cả bảng). Khoá theo token như cache danh sách đơn.
const SUMMARY_FRESH_MS = 30 * 1000;
let summaryCache: { token: string; at: number; promise: Promise<GoodsPaymentSummary> } | null = null;

export function getGoodsPaymentSummary({ force = false }: { force?: boolean } = {}): Promise<GoodsPaymentSummary> {
  const token = getStoredUser()?.token || "";
  if (!force && summaryCache && summaryCache.token === token && Date.now() - summaryCache.at < SUMMARY_FRESH_MS) {
    return summaryCache.promise;
  }
  const promise = loadGoodsPaymentSummary();
  const entry = { token, at: Date.now(), promise };
  summaryCache = entry;
  promise.catch(() => { if (summaryCache === entry) summaryCache = null; });
  return promise;
}

async function loadGoodsPaymentSummary(): Promise<GoodsPaymentSummary> {
  const payload = await request("GET", "/international-payment/summary");
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
  const state = (value: unknown): GoodsPaymentListState => (LIST_STATES.includes(value as GoodsPaymentListState) ? value as GoodsPaymentListState : "none");
  return Object.fromEntries(Object.entries(data).filter(([, row]) => isRecord(row)).map(([contract, row]) => {
    const item = row as JsonRecord;
    return [contract, { deposit: state(item.deposit), balance: state(item.balance) }];
  }));
}

/** Hợp đồng đã được duyệt thanh toán tiền hàng (cọc / còn lại) chưa (tab Tổng quan, không có số tiền). */
export async function getInternationalPaymentStatus(contract: string): Promise<InternationalPaymentStatus> {
  const payload = await request("GET", `/international-payment?contract=${encodeURIComponent(contract)}`);
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
  const state = (value: unknown): GoodsPaymentState => (value === "approved" || value === "delivered" ? value : "not_approved");
  const refs = (value: unknown): RequestRef[] => (Array.isArray(value) ? value : []).filter(isRecord).map((row) => ({ id: str(row.id), status: Number(row.status) as PaymentRequestStatus }));
  return {
    status: state(data.status),
    requests: refs(data.requests),
    items: (Array.isArray(data.items) ? data.items : []).filter(isRecord)
      .filter((row) => row.key === "deposit" || row.key === "balance")
      .map((row) => ({ key: row.key as GoodsPaymentKind, status: state(row.status), requests: refs(row.requests), amount: row.so_tien === null || row.so_tien === undefined ? null : str(row.so_tien) })),
    showAmounts: "tong_tien_hang" in data,
    goodsTotal: str(data.tong_tien_hang),
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
  /** Nội dung / diễn giải khoản. */
  note: string;
  /** % VAT (rỗng = không thuế); số tiền đã gồm VAT. */
  vat: string;
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
      note: str(row.noi_dung),
      vat: str(row.phan_tram_vat),
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

/** Sửa số tiền + nội dung chi phí của mình (chưa thuộc đề nghị nào). */
export async function updateMyCost(id: string, amount: string, note: string): Promise<void> {
  await request("PUT", `/mine/${encodeURIComponent(id)}`, { so_tien: amount, noi_dung: note });
}

/** Xóa chi phí của mình (chỉ khi chưa thuộc đề nghị nào). */
export async function deleteMyCost(id: string): Promise<void> {
  await request("DELETE", `/mine/${encodeURIComponent(id)}`);
}

export interface CostOverview {
  month: string;
  costs: MonthlyCost[];
  shipments: ShipmentInfo[];
  shipmentCosts: ShipmentCost[];
  /** Công nợ phải trả tính đến asOf (YYYY-MM-DD, giờ Việt Nam): đề nghị đã trình chưa chi tiền, mọi kỳ. */
  payables: { asOf: string; rows: Payable[]; truncated: boolean };
  /** Không có quyền xem tiền hàng: số tiền cọc / còn lại bị ẩn (null). */
  amountsHidden: boolean;
  /** Tháng có quá nhiều khoản, BE chỉ trả 10.000 khoản mới nhất. */
  truncated: boolean;
}

const kindOf = (value: unknown): CostKind => (value === "goods" || value === "incident" ? value : "operating");
const nullableAmount = (value: unknown) => (value === null || value === undefined ? null : str(value));

/**
 * Báo cáo chi phí & công nợ phải trả (chỉ admin): các khoản chi phí phát sinh trong kỳ (YYYY-MM) kèm đề nghị chứa khoản +
 * chi phí lũy kế của các lô hàng có chi phí trong kỳ (theo container) + công nợ phải trả tính đến hôm nay — một lần gọi.
 */
export async function getCostOverview(month: string, signal?: AbortSignal): Promise<CostOverview> {
  const payload = await request("GET", `/overview?month=${encodeURIComponent(month)}`, undefined, signal);
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
  const list = (value: unknown) => (Array.isArray(value) ? value.filter(isRecord) : []);
  const payables = isRecord(data.payables) ? data.payables : {};
  return {
    month: str(data.month) || month,
    amountsHidden: data.amountsHidden === true,
    truncated: data.truncated === true,
    costs: list(data.rows).map((row): MonthlyCost => ({
      id: str(row.id_payment_cost),
      createdAt: str(row.ngay_tao),
      contract: str(row.id_mua_hang),
      container: str(row.id_container),
      amount: nullableAmount(row.so_tien),
      vat: str(row.phan_tram_vat),
      note: str(row.noi_dung),
      type: str(row.loai_phi),
      code: str(row.ma_phi).toUpperCase(),
      categoryName: str(row.ten_phi),
      account: str(row.tai_khoang),
      flow: str(row.vung_phi),
      userName: str(row.nguoi_nhap),
      requestId: str(row.id_payment_request),
      requestStatus: row.request_status === null || row.request_status === undefined ? null : Number(row.request_status),
      requestSent: row.request_sent === true,
      requestContent: str(row.request_content),
      requestDue: str(row.request_due),
      requestBy: str(row.request_by),
      currency: str(row.currency) || "VND",
      currencyInferred: row.currency_inferred === true,
      kind: kindOf(row.nhom),
    })).filter((cost) => cost.id),
    shipments: list(data.shipments).map((row): ShipmentInfo => ({
      contract: str(row.ma_hop_dong),
      supplier: str(row.ten_ncc),
      containers: Array.isArray(row.containers) ? row.containers.map(str).filter(Boolean) : [],
    })).filter((item) => item.contract),
    shipmentCosts: list(data.shipmentCosts).map((row): ShipmentCost => ({
      contract: str(row.ma_hop_dong),
      container: str(row.id_container),
      kind: kindOf(row.nhom),
      currency: str(row.currency) || "VND",
      count: Number(row.so_khoan) || 0,
      amount: nullableAmount(row.so_tien),
    })).filter((item) => item.contract),
    payables: {
      asOf: str(payables.asOf),
      truncated: payables.truncated === true,
      rows: list(payables.rows).map((row): Payable => ({
        requestId: str(row.id_payment_request),
        content: str(row.noi_dung),
        requester: str(row.nguoi_de_nghi),
        state: Number(row.status) === 1 ? "approved" : "pending",
        currency: str(row.loai_tien) || "VND",
        amount: nullableAmount(row.tong_tien),
        dueDate: str(row.han_thanh_toan),
        requestDate: str(row.ngay_de_nghi),
      })).filter((item) => item.requestId),
    },
  };
}
