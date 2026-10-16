import type { AuthUser } from "@/types/auth";
import { getStoredUser } from "@/services/authApi";
import { backendApiUrl } from "@/services/backendApiUrl";
import { createHttpApiError, createInvalidResponseError, createNetworkApiError, parseApiResponse } from "@/utils/apiError";


export interface ActivityLogPayload {
  action: string;
  /** Mã màn hình nơi thao tác (vd "ShipmentDetailModal/Documents/CO"); trang Nhật ký đổi thành tên dễ đọc. */
  location?: string;
  /** Nội dung chi tiết: đối tượng + thay đổi "trường: cũ → mới" ngăn cách bằng " | ". */
  detail?: string;
  status?: "success" | "failed";
}

/** BE giữ tối đa 4000 ký tự nội dung. */
const MAX_DETAIL_LENGTH = 4000;

export interface ActivityLog {
  id: number | string;
  userId?: number;
  username?: string;
  userName?: string;
  role?: string;
  action: string;
  location: string;
  detail: string;
  createdAt: string;
  ipAddress?: string;
  /** Trình duyệt · hệ điều hành, BE tóm tắt từ User-Agent (vd "Chrome · Windows"). */
  device?: string;
  status?: "success" | "failed";
}

export interface ActivityActor {
  id: number;
  name: string;
  username: string;
  role?: string;
}

export interface ActivityLogQuery {
  limit: number;
  offset: number;
  userId?: number;
  action?: string;
  role?: string;
  status?: "success" | "failed";
  from?: string;
  to?: string;
  q?: string;
}

export interface ActivityLogPage {
  logs: ActivityLog[];
  total: number;
  actors: ActivityActor[];
}

export type EmailDeliveryStatus = "sent" | "not sent";

export interface EmailActivityLog {
  id: number | string;
  userId?: number;
  userName?: string;
  username?: string;
  sentAt: string;
  subject: string;
  supplierName: string;
  supplierEmail: string;
  status: EmailDeliveryStatus;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function findLogRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.logs)) return payload.logs;
  if (isRecord(payload.data) && Array.isArray(payload.data.logs)) return payload.data.logs;
  return [];
}

function normalizeLog(row: unknown, index: number): ActivityLog | null {
  if (!isRecord(row)) return null;
  const nestedUser = isRecord(row.user) ? row.user : {};
  const rawUserId = row.user_id ?? row.userId ?? nestedUser.id;
  const userId = Number(rawUserId);
  const createdAt = String(row.created_at ?? row.createdAt ?? "").trim();

  return {
    id: (row.id as number | string | undefined) ?? `${createdAt}-${index}`,
    userId: Number.isInteger(userId) && userId > 0 ? userId : undefined,
    username: String(row.username ?? row.user_name ?? nestedUser.username ?? "").trim() || undefined,
    userName: String(row.name ?? row.full_name ?? row.fullName ?? nestedUser.name ?? "").trim() || undefined,
    role: String(row.role ?? row.user_role ?? row.userRole ?? nestedUser.role ?? "").trim() || undefined,
    action: String(row.action ?? "").trim(),
    location: String(row.location ?? "").trim(),
    detail: String(row.detail ?? "").trim(),
    createdAt,
    ipAddress: String(row.ip_address ?? "").trim() || undefined,
    device: String(row.device ?? "").trim() || undefined,
    status: row.status === "failed" ? "failed" : "success",
  };
}

function normalizeActor(row: unknown): ActivityActor | null {
  if (!isRecord(row)) return null;
  const id = Number(row.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    id,
    name: String(row.name ?? "").trim(),
    username: String(row.username ?? "").trim(),
    role: String(row.role ?? "").trim() || undefined,
  };
}

/** Nhật ký thao tác, lọc + phân trang phía server (mới nhất trước). */
export async function getActivityLogs(query: ActivityLogQuery, signal?: AbortSignal): Promise<ActivityLogPage> {
  const params = new URLSearchParams({ limit: String(query.limit), offset: String(query.offset) });
  for (const key of ["userId", "action", "role", "status", "from", "to", "q"] as const) {
    const value = query[key];
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const pagePath = `/api/auth/activity-logs?${params.toString()}`;
  const token = getStoredUser()?.token?.trim();
  let response: Response;
  try {
    response = await fetch(backendApiUrl(pagePath), {
      method: "GET",
      headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (error instanceof TypeError) throw createNetworkApiError("Nhật ký", "GET", pagePath, error);
    throw error;
  }

  const { data: result, nonJsonPreview } = await parseApiResponse(response);
  if (!response.ok) throw createHttpApiError("Nhật ký", "GET", pagePath, response, result, nonJsonPreview);
  if (result === null) throw createInvalidResponseError("Nhật ký", "GET", pagePath, nonJsonPreview);
  const logs = findLogRows(result).map((row, index) => normalizeLog(row, index)).filter((log): log is ActivityLog => log !== null);
  const pagination = isRecord(result) && isRecord(result.pagination) ? result.pagination : {};
  const total = Number(pagination.total);
  const actors = isRecord(result) && Array.isArray(result.actors)
    ? result.actors.map(normalizeActor).filter((actor): actor is ActivityActor => actor !== null)
    : [];
  return { logs, total: Number.isFinite(total) ? total : logs.length, actors };
}

export async function getEmailActivityLogs(): Promise<ActivityLog[]> {
  const apiPath = "/api/email/logs?limit=500&offset=0";
  const token = getStoredUser()?.token?.trim();
  let response: Response;
  try {
    response = await fetch(backendApiUrl(apiPath), {
      method: "GET",
      headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof TypeError) throw createNetworkApiError("Nhật ký email", "GET", apiPath, error);
    throw error;
  }
  const { data: result, nonJsonPreview } = await parseApiResponse(response);
  if (!response.ok) throw createHttpApiError("Nhật ký email", "GET", apiPath, response, result, nonJsonPreview);
  if (result === null) throw createInvalidResponseError("Nhật ký email", "GET", apiPath, nonJsonPreview);

  return findLogRows(result).map((row, index) => {
    if (!isRecord(row)) return null;
    const supplier = String(row.supplier_name ?? "").trim() || "Nhà cung cấp";
    const email = String(row.supplier_email ?? "").trim();
    const subject = String(row.subject ?? "").trim();
    const status = String(row.status ?? "").trim().toLowerCase();
    const error = String(row.error ?? "").trim();
    const statusText = status === "sent" ? "Đã gửi" : `not sent${error ? `: ${error}` : ""}`;
    return normalizeLog({
      ...row,
      id: `email-${String(row.id ?? index)}`,
      action: "SEND_EMAIL",
      location: "Email",
      detail: `${supplier}${email ? ` <${email}>` : ""} — ${subject} — ${statusText}`,
      created_at: row.sent_at,
    }, index);
  }).filter((log): log is ActivityLog => log !== null);
}

export async function getEmailDeliveryLogs(): Promise<EmailActivityLog[]> {
  const apiPath = "/api/email/logs?limit=500&offset=0";
  const token = getStoredUser()?.token?.trim();
  let response: Response;
  try {
    response = await fetch(backendApiUrl(apiPath), {
      method: "GET",
      headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof TypeError) throw createNetworkApiError("Email logs", "GET", apiPath, error);
    throw error;
  }

  const { data: result, nonJsonPreview } = await parseApiResponse(response);
  if (!response.ok) throw createHttpApiError("Email logs", "GET", apiPath, response, result, nonJsonPreview);
  if (result === null) throw createInvalidResponseError("Email logs", "GET", apiPath, nonJsonPreview);

  return findLogRows(result).map((row, index): EmailActivityLog | null => {
    if (!isRecord(row)) return null;
    const rawStatus = String(row.status ?? "not sent").trim().toLowerCase();
    const userId = Number(row.user_id);
    return {
      id: (row.id as number | string | undefined) ?? `email-${index}`,
      userId: Number.isInteger(userId) && userId > 0 ? userId : undefined,
      userName: String(row.name ?? "").trim() || undefined,
      username: String(row.username ?? "").trim() || undefined,
      sentAt: String(row.sent_at ?? "").trim(),
      subject: String(row.subject ?? "").trim(),
      supplierName: String(row.supplier_name ?? "").trim(),
      supplierEmail: String(row.supplier_email ?? "").trim(),
      status: rawStatus === "sent" ? "sent" : "not sent",
      error: String(row.error ?? "").trim() || undefined,
    };
  }).filter((log): log is EmailActivityLog => log !== null);
}

export async function createActivityLog(user: AuthUser | null, payload: ActivityLogPayload): Promise<void> {
  if (!user?.id) {
    console.warn("Không ghi activity log vì response đăng nhập chưa có user id.");
    return;
  }

  const apiPath = "/api/auth/activity-logs";
  let response: Response;
  try {
    response = await fetch(backendApiUrl(apiPath), {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        ...(user.token ? { Authorization: `Bearer ${user.token}` } : {}),
      },
      // Người thực hiện do BE lấy từ token; IP/thiết bị do gateway chuyển tiếp.
      body: JSON.stringify({
        action: payload.action.slice(0, 64),
        location: (payload.location || "").slice(0, 255),
        // Giữ nguyên tên file và giá trị trước → sau để tra cứu khi có sự cố.
        detail: (payload.detail || "").slice(0, MAX_DETAIL_LENGTH),
        ...(payload.status ? { status: payload.status } : {}),
      }),
    });
  } catch (error) {
    if (error instanceof TypeError) throw createNetworkApiError("Nhật ký", "POST", apiPath, error);
    throw error;
  }

  const { data: result, nonJsonPreview } = await parseApiResponse(response);
  if (!response.ok) throw createHttpApiError("Nhật ký", "POST", apiPath, response, result, nonJsonPreview);
  if (result === null) throw createInvalidResponseError("Nhật ký", "POST", apiPath, nonJsonPreview);
}

/** Ghi log nền để lỗi log không làm người dùng lặp lại một nghiệp vụ đã thành công. */
export function recordActivity(user: AuthUser | null, payload: ActivityLogPayload): void {
  void createActivityLog(user, payload).catch((error) => {
    console.error("Activity log error:", error);
  });
}
