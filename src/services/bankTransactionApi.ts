import { getStoredUser } from "@/services/authApi";
import { backendApiUrl } from "@/services/backendApiUrl";
import type { PaymentRequestStatus } from "@/services/paymentRequestApi";
import { createHttpApiError, createInvalidResponseError, createNetworkApiError, parseApiResponse } from "@/utils/apiError";

// Giao dịch ngân hàng (BE: GET /api/bank-transactions, quyền bankTransactions): giao dịch SePay gửi về từ tài khoản ngân
// hàng của công ty, kèm đề nghị thanh toán nhận ra từ mã DNTT trong nội dung chuyển khoản. Bản thử nghiệm đối soát.

export type BankTransferType = "in" | "out";

export interface BankTransactionRequest {
  /** Mã đề nghị nhận ra từ nội dung, ví dụ DNTT-049. */
  id: string;
  /** false = mã không có trong hệ thống. */
  found: boolean;
  status: PaymentRequestStatus | null;
  total: string;
  currency: string;
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
  requests: BankTransactionRequest[];
}

const SCOPE = "Giao dịch ngân hàng";
type JsonRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown) => (value === null || value === undefined ? "" : String(value));

export async function listBankTransactions(
  { type = "", limit = 50, offset = 0 }: { type?: "" | BankTransferType; limit?: number; offset?: number } = {},
  signal?: AbortSignal,
): Promise<{ rows: BankTransaction[]; total: number }> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset), ...(type ? { type } : {}) });
  const apiPath = `/api/bank-transactions?${params}`;
  const token = getStoredUser()?.token?.trim();
  let response: Response;
  try {
    response = await fetch(backendApiUrl(apiPath), {
      headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (error instanceof TypeError) throw createNetworkApiError(SCOPE, "GET", apiPath, error);
    throw error;
  }
  const { data, nonJsonPreview } = await parseApiResponse(response);
  if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("xnk:auth-expired"));
  if (!response.ok || (isRecord(data) && data.success === false)) throw createHttpApiError(SCOPE, "GET", apiPath, response, data, nonJsonPreview);
  if (!isRecord(data)) throw createInvalidResponseError(SCOPE, "GET", apiPath, nonJsonPreview);
  const rows = (Array.isArray(data.data) ? data.data : []).filter(isRecord).map((row): BankTransaction => ({
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
    requests: (Array.isArray(row.requests) ? row.requests : []).filter(isRecord).map((item) => ({
      id: str(item.id),
      found: item.found === true,
      status: item.status === null || item.status === undefined ? null : Number(item.status) as PaymentRequestStatus,
      total: str(item.total),
      currency: str(item.currency),
    })),
  }));
  const pagination = isRecord(data.pagination) ? data.pagination : {};
  return { rows, total: Number(pagination.total) || rows.length };
}
