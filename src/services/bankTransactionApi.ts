import { getStoredUser } from "@/services/authApi";
import { backendApiUrl } from "@/services/backendApiUrl";
import type { PaymentRequestStatus } from "@/services/paymentRequestApi";
import { createHttpApiError, createInvalidResponseError, createNetworkApiError, parseApiResponse } from "@/utils/apiError";

// Đối soát tiền chi — nhắc tiền đã đi mà chưa upload UNC (BE: /api/bank-transactions, quyền bankTransactions — view xem, edit
// gắn / gỡ / bỏ qua; gắn không đổi trạng thái đề nghị): giao dịch tiền ra
// SePay gửi về từ tài khoản ngân hàng công ty, đề nghị đã gắn (hệ thống tự gắn khi có đúng 1 đề nghị đã duyệt cùng số tiền,
// hoặc kế toán gắn tay) và đề nghị ứng viên cho giao dịch chưa gắn. Một giao dịch = một đề nghị, số tiền bằng đúng tổng đề nghị.

export type BankTransferType = "in" | "out";
/** Lọc theo đối soát: "" tất cả, pending chờ xử lý (tiền ra chưa gắn, chưa bỏ qua), matched đã gắn, ignored đã bỏ qua. */
export type BankMatchState = "" | "pending" | "matched" | "ignored";

export interface BankMatch {
  id: string;
  requestId: string;
  amount: string;
  /** auto = hệ thống tự gắn; manual = kế toán gắn tay. */
  method: "auto" | "manual";
  by: string;
  at: string;
  status: PaymentRequestStatus;
  requestTotal: string;
}

export interface BankCandidate {
  id: string;
  total: string;
  content: string;
  beneficiary: string;
  creator: string;
  approvedAt: string;
}

export interface BankTransaction {
  id: string;
  gateway: string;
  accountNumber: string;
  type: BankTransferType;
  amount: string;
  /** Số dư sau giao dịch (rỗng = ngân hàng không gửi). */
  balance: string;
  content: string;
  description: string;
  reference: string;
  transactionDate: string;
  receivedAt: string;
  ignoredReason: string;
  ignoredBy: string;
  ignoredAt: string;
  matches: BankMatch[];
  candidates: BankCandidate[];
}

export interface LinkableRequest {
  id: string;
  status: PaymentRequestStatus;
  total: string;
  content: string;
  beneficiary: string;
  approvedAt: string;
}

const SCOPE = "Giao dịch ngân hàng";
type JsonRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const list = (value: unknown) => (Array.isArray(value) ? value.filter(isRecord) : []);

async function request(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown, signal?: AbortSignal): Promise<JsonRecord> {
  const apiPath = `/api/bank-transactions${path}`;
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
  if (!isRecord(data)) throw createInvalidResponseError(SCOPE, method, apiPath, nonJsonPreview);
  return data;
}

const statusOf = (value: unknown) => Number(value) as PaymentRequestStatus;

export async function listBankTransactions(
  { state = "", limit = 100, offset = 0 }: { state?: BankMatchState; limit?: number; offset?: number } = {},
  signal?: AbortSignal,
): Promise<{ rows: BankTransaction[]; total: number }> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset), ...(state ? { state } : {}) });
  const data = await request("GET", `?${params}`, undefined, signal);
  const rows = list(data.data).map((row): BankTransaction => ({
    id: str(row.id),
    gateway: str(row.gateway),
    accountNumber: str(row.account_number),
    type: row.transfer_type === "in" ? "in" : "out",
    amount: str(row.amount),
    balance: str(row.accumulated),
    content: str(row.content),
    description: str(row.description),
    reference: str(row.reference_code),
    transactionDate: str(row.transaction_date),
    receivedAt: str(row.received_at),
    ignoredReason: str(row.ignored_reason),
    ignoredBy: str(row.ignored_by_name),
    ignoredAt: str(row.ignored_at),
    matches: list(row.matches).map((match) => ({
      id: str(match.id),
      requestId: str(match.requestId),
      amount: str(match.amount),
      method: match.method === "manual" ? "manual" : "auto",
      by: str(match.by),
      at: str(match.at),
      status: statusOf(match.status),
      requestTotal: str(match.requestTotal),
    })),
    candidates: list(row.candidates).map((candidate) => ({
      id: str(candidate.id),
      total: str(candidate.total),
      content: str(candidate.content),
      beneficiary: str(candidate.beneficiary),
      creator: str(candidate.creator),
      approvedAt: str(candidate.approvedAt),
    })),
  }));
  const pagination = isRecord(data.pagination) ? data.pagination : {};
  return { rows, total: Number(pagination.total) || rows.length };
}

/** Đề nghị gắn tay được cho giao dịch: đã duyệt / đã chi tiền, VND, CÙNG số tiền, chưa gắn giao dịch nào; lọc theo mã / nội dung / người thụ hưởng. */
export async function searchLinkableRequests(transactionId: string, query: string, signal?: AbortSignal): Promise<LinkableRequest[]> {
  const data = await request("GET", `/${encodeURIComponent(transactionId)}/requests?q=${encodeURIComponent(query)}`, undefined, signal);
  return list(data.data).map((row) => ({
    id: str(row.id),
    status: statusOf(row.status),
    total: str(row.total),
    content: str(row.content),
    beneficiary: str(row.beneficiary),
    approvedAt: str(row.approvedAt),
  }));
}

/** Gắn tay giao dịch vào một đề nghị (không đổi trạng thái đề nghị). Trả cảnh báo (tiền đi trước khi duyệt). */
export async function linkBankTransaction(transactionId: string, requestId: string): Promise<{ warnings: string[] }> {
  const data = await request("POST", `/${encodeURIComponent(transactionId)}/links`, { requestId });
  const result = isRecord(data.data) ? data.data : {};
  return { warnings: (Array.isArray(result.warnings) ? result.warnings : []).map(str) };
}

/** Gỡ một lần gắn nhầm (trạng thái đề nghị không đổi). */
export async function unlinkBankMatch(matchId: string): Promise<{ requestId: string }> {
  const data = await request("DELETE", `/links/${encodeURIComponent(matchId)}`);
  const result = isRecord(data.data) ? data.data : {};
  return { requestId: str(result.requestId) };
}

/** Đánh dấu giao dịch không thuộc đề nghị (lương, thuế...) kèm lý do; reason rỗng = bỏ đánh dấu. */
export async function setBankTransactionIgnored(transactionId: string, reason: string): Promise<void> {
  await request("PUT", `/${encodeURIComponent(transactionId)}/ignore`, { reason });
}
