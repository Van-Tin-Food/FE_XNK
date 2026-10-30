import { fetchPaymentRequestPrintHtml, SIGNED_FORM, uploadPaymentDocument, type PaymentDocumentFile } from "@/services/paymentRequestApi";

// Giấy đề nghị đã ký: ngay sau khi upload ủy nhiệm chi (đề nghị sang đã chi tiền, đủ chữ ký người đề nghị / người duyệt / kế
// toán trưởng), trình duyệt của người upload tạo PDF từ chính bản in (BE GET /print) và upload vào thư mục hồ sơ của đề
// nghị (kind signed_form) bằng tài khoản người đó. Tạo PDF trên trình duyệt (html2pdf trong trang bản in, hàm
// window.buildPdfBlob) để server không phải cài thêm công cụ.

const RENDER_TIMEOUT_MS = 60_000;
const FILE_SUFFIX = "_Giay-de-nghi-da-ky";

type PrintWindow = Window & { buildPdfBlob?: () => Promise<Blob> };

/** Tạo PDF bản in trong iframe ẩn (cùng origin, srcdoc) rồi gỡ iframe. */
async function renderSignedPdf(id: string): Promise<Blob> {
  const html = await fetchPaymentRequestPrintHtml(id);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  // Đặt ngoài màn hình (không dùng display:none / visibility:hidden vì html2canvas cần trang được dựng thật).
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1100px;height:1600px;border:0;opacity:0;pointer-events:none;";
  try {
    const loaded = new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
    frame.srcdoc = html;
    document.body.appendChild(frame);
    await loaded;
    const build = (frame.contentWindow as PrintWindow | null)?.buildPdfBlob;
    if (typeof build !== "function") throw new Error("Bản in chưa hỗ trợ tạo PDF tự động");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Tạo PDF quá lâu")), RENDER_TIMEOUT_MS); });
    try {
      return await Promise.race([build(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    frame.remove();
  }
}

const isDuplicateName = (error: unknown) => (error as { code?: unknown } | null)?.code === "DUPLICATE_FILE_NAME";

/**
 * Tạo và lưu giấy đề nghị đã ký (DNTT-xxx_Giay-de-nghi-da-ky.pdf) vào hồ sơ đề nghị. Đã có file cùng tên (ủy nhiệm chi bị
 * gỡ rồi upload lại) thì thêm giờ phút giây vào tên. Lỗi ném ra để trang báo người dùng.
 */
export async function saveSignedPaymentRequestPdf(id: string): Promise<PaymentDocumentFile> {
  const blob = await renderSignedPdf(id);
  const upload = (name: string) => uploadPaymentDocument(id, new File([blob], name, { type: "application/pdf" }), "application/pdf", { kind: SIGNED_FORM });
  try {
    return await upload(`${id}${FILE_SUFFIX}.pdf`);
  } catch (error) {
    if (!isDuplicateName(error)) throw error;
    const now = new Date();
    const stamp = [now.getHours(), now.getMinutes(), now.getSeconds()].map((part) => String(part).padStart(2, "0")).join("");
    return upload(`${id}${FILE_SUFFIX}_${stamp}.pdf`);
  }
}
