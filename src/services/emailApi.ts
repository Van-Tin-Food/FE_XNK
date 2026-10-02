import { getStoredUser } from "@/services/authApi";
import { backendApiUrl } from "@/services/backendApiUrl";

export interface EmailRecipient {
  email: string;
  name: string;
}

export interface SendEmailPayload {
  subject?: string;
  message: string;
  recipients: EmailRecipient[];
}

export interface SendEmailFailure {
  email: string;
  error: string;
}

export interface EmailDraft {
  email: string;
  name: string;
  subject: string;
  message: string;
  error: string;
  status: "draft";
}

export interface SendEmailResult {
  success: boolean;
  message: string;
  sentCount?: number;
  failedCount?: number;
  failures?: SendEmailFailure[];
}

/** Gửi email qua BE SMTP thông qua API route của Next. */
export async function sendContactEmail(payload: SendEmailPayload): Promise<SendEmailResult> {
  const token = getStoredUser()?.token?.trim();
  const response = await fetch(backendApiUrl("/api/email/send"), {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  const result = (await response.json().catch(() => null)) as (SendEmailResult & { message?: string }) | null;
  if (!response.ok || !result || result.success === false) {
    console.error("[Backend API email]", {
      status: response.status,
      message: result?.message,
    });
    throw new Error("Không thể gửi email. Vui lòng kiểm tra thông tin người nhận và thử lại.");
  }
  return result;
}
