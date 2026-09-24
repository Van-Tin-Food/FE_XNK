import { getStoredUser } from "@/services/authApi";

export interface EmailRecipient {
  email: string;
  name: string;
}

export interface SendEmailPayload {
  subject: string;
  message: string;
  recipients: EmailRecipient[];
  senderName: string;
}

export interface SendEmailFailure {
  email: string;
  error: string;
}

export interface SendEmailResult {
  success: boolean;
  message: string;
  sentCount?: number;
  failedCount?: number;
  failures?: SendEmailFailure[];
}

/** Gửi email qua API route /api/email/send (server-side EmailJS, key nằm trong env). */
export async function sendContactEmail(payload: SendEmailPayload): Promise<SendEmailResult> {
  const token = getStoredUser()?.token?.trim();
  const response = await fetch("/api/email/send", {
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
    throw new Error(result?.message || "Không thể gửi email. Vui lòng thử lại sau.");
  }
  return result;
}
