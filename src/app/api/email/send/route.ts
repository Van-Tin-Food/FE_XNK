import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

interface SendEmailPayload {
  subject?: string;
  message?: string;
  /** Danh sách người nhận, mỗi phần tử một email riêng qua EmailJS. */
  recipients?: Array<{ email?: string; name?: string }>;
  /** Tương thích ngược: gửi cho một người nhận duy nhất. */
  supplierEmail?: string;
  supplierName?: string;
  senderName?: string;
}

/** EmailJS REST API yêu cầu Access Token (private key) — chỉ gọi từ server. */
export async function POST(request: NextRequest) {
  const serviceId = process.env.EMAILJS_SERVICE_ID?.trim();
  const templateId = process.env.EMAILJS_TEMPLATE_ID?.trim();
  const publicKey = process.env.EMAILJS_PUBLIC_KEY?.trim();
  const privateKey = process.env.EMAILJS_PRIVATE_KEY?.trim();

  if (!serviceId || !templateId || !publicKey || !privateKey) {
    return NextResponse.json(
      { success: false, message: "Thiếu cấu hình EmailJS trên server (EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY)" },
      { status: 500 },
    );
  }

  let payload: SendEmailPayload;
  try {
    payload = (await request.json()) as SendEmailPayload;
  } catch {
    return NextResponse.json({ success: false, message: "Dữ liệu không hợp lệ" }, { status: 400 });
  }

  const subject = String(payload.subject || "").trim();
  const message = String(payload.message || "").trim();
  const senderName = String(payload.senderName || "").trim();

  const recipients = (Array.isArray(payload.recipients) && payload.recipients.length > 0
    ? payload.recipients
    : [{ email: payload.supplierEmail, name: payload.supplierName }]
  )
    .map((recipient) => ({
      email: String(recipient?.email || "").trim(),
      name: String(recipient?.name || "").trim(),
    }))
    .filter((recipient) => recipient.email);

  if (!subject || !message || recipients.length === 0) {
    return NextResponse.json(
      { success: false, message: "Vui lòng điền tiêu đề, nội dung và chọn ít nhất một nhà cung cấp có email" },
      { status: 400 },
    );
  }

  // Gửi lần lượt, mỗi người nhận một email riêng (template {{to_email}} nhận một địa chỉ).
  const failed: Array<{ email: string; error: string }> = [];
  for (const recipient of recipients) {
    const body = JSON.stringify({
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      accessToken: privateKey,
      template_params: {
        to_email: recipient.email,
        to_name: recipient.name,
        subject,
        title: subject,
        message,
        from_name: senderName,
        reply_to: "",
      },
    });

    try {
      const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${privateKey}`,
        },
        body,
        cache: "no-store",
      });

      const responseText = (await response.text()).trim();
      if (!response.ok) {
        failed.push({ email: recipient.email, error: `EmailJS ${response.status}: ${responseText || "không rõ nguyên nhân"}` });
        continue;
      }
      if (responseText.includes("User not found") || responseText.toLowerCase().includes("invalid")) {
        failed.push({ email: recipient.email, error: `EmailJS từ chối yêu cầu: ${responseText}` });
      }
    } catch {
      failed.push({ email: recipient.email, error: "Không thể kết nối tới EmailJS" });
    }
  }

  const sentCount = recipients.length - failed.length;
  if (failed.length === 0) {
    return NextResponse.json({ success: true, sentCount, failedCount: 0, message: `Đã gửi email tới ${sentCount} nhà cung cấp` });
  }
  if (sentCount === 0) {
    return NextResponse.json(
      { success: false, sentCount: 0, failedCount: failed.length, message: `Không gửi được email nào: ${failed.map((item) => item.error).join("; ")}` },
      { status: 502 },
    );
  }
  return NextResponse.json({
    success: true,
    sentCount,
    failedCount: failed.length,
    message: `Đã gửi ${sentCount} email, ${failed.length} thất bại`,
    failures: failed,
  });
}
