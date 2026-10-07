import type { AuthUser } from "@/types/auth";
import { getStoredUser } from "@/services/authApi";
import { backendApiUrl } from "@/services/backendApiUrl";
import { createHttpApiError, createInvalidResponseError, createNetworkApiError, parseApiResponse } from "@/utils/apiError";


export interface ActivityLogPayload {
  action: string;
  location?: string;
  detail?: string;
}

export interface ActivityLog {
  id: number | string;
  userId?: number;
  username?: string;
  userName?: string;
  role?: string;
  session?: string;
  action: string;
  location: string;
  detail: string;
  createdAt: string;
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
    session: String(row.session ?? row.user_session ?? row.userSession ?? row.session_id ?? nestedUser.session ?? "").trim() || undefined,
    action: String(row.action ?? "").trim(),
    location: String(row.location ?? "").trim(),
    detail: String(row.detail ?? "").trim(),
    createdAt,
  };
}

export async function getActivityLogs(): Promise<ActivityLog[]> {
  const apiPath = "/api/auth/activity-logs";
  const token = getStoredUser()?.token?.trim();
  const pagePath = `${apiPath}?limit=100&offset=0`;
  let response: Response;
  try {
    response = await fetch(backendApiUrl(pagePath), {
      method: "GET",
      headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof TypeError) throw createNetworkApiError("Nhật ký", "GET", pagePath, error);
    throw error;
  }

  const { data: result, nonJsonPreview } = await parseApiResponse(response);
  if (!response.ok) throw createHttpApiError("Nhật ký", "GET", pagePath, response, result, nonJsonPreview);
  if (result === null) throw createInvalidResponseError("Nhật ký", "GET", pagePath, nonJsonPreview);
  const logs = findLogRows(result).map((row, index) => normalizeLog(row, index)).filter((log): log is ActivityLog => log !== null);
  return logs.sort((a, b) => {
    const timeA = Date.parse(a.createdAt);
    const timeB = Date.parse(b.createdAt);
    return (Number.isFinite(timeB) ? timeB : 0) - (Number.isFinite(timeA) ? timeA : 0);
  });
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
      body: JSON.stringify({
        userId: user.id,
        action: payload.action.slice(0, 255),
        location: (payload.location || "").slice(0, 255),
        // Keep the original audit detail. The activity page can still derive a
        // compact subject for filtering, but the database must retain the
        // exact file names and before/after values for troubleshooting.
        detail: (payload.detail || "").slice(0, 255),
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
