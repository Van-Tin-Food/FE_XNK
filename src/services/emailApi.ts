import { getStoredUser } from "@/services/authApi";
import { backendApiUrl } from "@/services/backendApiUrl";
import {
  type ApiError,
  createHttpApiError,
  createInvalidResponseError,
  createNetworkApiError,
  parseApiResponse,
} from "@/utils/apiError";

export interface EmailRecipient {
  email: string;
  name: string;
}

export interface SendEmailPayload {
  message: string;
  recipients: EmailRecipient[];
}

export type EmailJobRecipientStatus = "pending" | "sent" | "not sent";

export interface EmailJobRecipient {
  email: string;
  name: string;
  subject: string;
  status: EmailJobRecipientStatus;
  error?: string;
  sentAt?: string;
}

/** Lượt gửi chạy nền trên BE (POST /api/email/jobs), hỏi tiến độ bằng getEmailJob. */
export interface EmailJob {
  id: string;
  status: "running" | "done";
  total: number;
  sentCount: number;
  failedCount: number;
  sendIntervalMs: number;
  createdAt: string;
  finishedAt: string | null;
  recipients: EmailJobRecipient[];
}

export interface EmailLastSent {
  email: string;
  lastSentAt: string;
  sentCount: number;
}

/** Lỗi khi bắt đầu gửi; có lượt đang chạy (409 EMAIL_JOB_RUNNING) thì kèm lượt đó để theo dõi tiếp. */
export type EmailJobError = ApiError & { job?: EmailJob };

const SCOPE = "Email";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeJob(value: unknown): EmailJob | null {
  if (!isRecord(value) || typeof value.id !== "string" || !Array.isArray(value.recipients)) return null;
  const recipients = value.recipients.filter(isRecord).map((row): EmailJobRecipient => {
    const status = String(row.status ?? "");
    return {
      email: String(row.email ?? ""),
      name: String(row.name ?? ""),
      subject: String(row.subject ?? ""),
      status: status === "sent" || status === "not sent" ? status : "pending",
      error: row.error ? String(row.error) : undefined,
      sentAt: row.sentAt ? String(row.sentAt) : undefined,
    };
  });
  return {
    id: value.id,
    status: value.status === "done" ? "done" : "running",
    total: Number(value.total) || recipients.length,
    sentCount: Number(value.sentCount) || 0,
    failedCount: Number(value.failedCount) || 0,
    sendIntervalMs: Number(value.sendIntervalMs) || 3000,
    createdAt: String(value.createdAt ?? ""),
    finishedAt: value.finishedAt ? String(value.finishedAt) : null,
    recipients,
  };
}

async function requestEmailApi(method: "GET" | "POST", apiPath: string, body?: unknown): Promise<Record<string, unknown>> {
  const token = getStoredUser()?.token?.trim();
  let response: Response;
  try {
    response = await fetch(backendApiUrl(apiPath), {
      method,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof TypeError) throw createNetworkApiError(SCOPE, method, apiPath, error);
    throw error;
  }
  const { data, nonJsonPreview } = await parseApiResponse(response);
  if (!response.ok) {
    const error = createHttpApiError(SCOPE, method, apiPath, response, data, nonJsonPreview) as EmailJobError;
    if (isRecord(data)) error.job = normalizeJob(data.job) ?? undefined;
    throw error;
  }
  if (!isRecord(data)) throw createInvalidResponseError(SCOPE, method, apiPath, nonJsonPreview);
  return data;
}

/** Bắt đầu lượt gửi: BE trả về ngay, email gửi nền lần lượt (mỗi email cách nhau vài giây). */
export async function startEmailJob(payload: SendEmailPayload): Promise<EmailJob> {
  const data = await requestEmailApi("POST", "/api/email/jobs", payload);
  const job = normalizeJob(data.job);
  if (!job) throw createInvalidResponseError(SCOPE, "POST", "/api/email/jobs", "");
  return job;
}

export async function getEmailJob(id: string): Promise<EmailJob> {
  const apiPath = `/api/email/jobs/${encodeURIComponent(id)}`;
  const data = await requestEmailApi("GET", apiPath);
  const job = normalizeJob(data.job);
  if (!job) throw createInvalidResponseError(SCOPE, "GET", apiPath, "");
  return job;
}

/** Lượt gửi đang chạy của tài khoản (mở lại trang giữa chừng vẫn theo dõi được); không có thì null. */
export async function getCurrentEmailJob(): Promise<EmailJob | null> {
  const data = await requestEmailApi("GET", "/api/email/jobs/current");
  return normalizeJob(data.job);
}

/** Lần gửi thành công gần nhất theo từng email (email đã viết thường). */
export async function getEmailLastSent(): Promise<EmailLastSent[]> {
  const data = await requestEmailApi("GET", "/api/email/last-sent");
  if (!Array.isArray(data.data)) return [];
  return data.data.filter(isRecord).map((row) => ({
    email: String(row.email ?? "").trim().toLowerCase(),
    lastSentAt: String(row.lastSentAt ?? ""),
    sentCount: Number(row.sentCount) || 0,
  })).filter((row) => row.email && row.lastSentAt);
}
