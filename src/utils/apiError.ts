type ApiPayload = Record<string, unknown>;

/**
 * BE từ chối vì thiếu quyền: quyền đang hiển thị ở FE có thể đã cũ (admin vừa đổi role / quyền).
 * AuthContext nghe sự kiện này để tải lại quyền mới, ẩn các nút không còn dùng được.
 */
export const PERMISSIONS_STALE_EVENT = "xnk:permissions-stale";

export type ApiError = Error & {
  /** HTTP status khi lỗi đến từ response của backend. */
  status?: number;
  code?: string;
  detail?: unknown;
  technicalMessage?: string;
};

export interface ParsedApiResponse {
  data: unknown;
  nonJsonPreview: string;
}

function isRecord(value: unknown): value is ApiPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function parseApiResponse(response: Response): Promise<ParsedApiResponse> {
  const text = await response.text();
  if (!text.trim()) return { data: null, nonJsonPreview: "" };
  try {
    return { data: JSON.parse(text) as unknown, nonJsonPreview: "" };
  } catch {
    return { data: null, nonJsonPreview: text.replace(/\s+/g, " ").trim().slice(0, 180) };
  }
}

export function getApiPayloadMessage(payload: unknown): string {
  if (!isRecord(payload)) return "";
  return String(payload.message ?? payload.error ?? payload.detail ?? "").trim();
}

function getFriendlyMessage(scope: string, status: number, code: string, backendMessage = ""): string {
  if (scope === "Xác thực Google" && (status === 400 || status === 401) && backendMessage) {
    return backendMessage;
  }
  if (scope === "Đăng nhập" && status === 401) {
    return "Tên đăng nhập hoặc mật khẩu không đúng.";
  }
  if (scope === "Xác thực Google" && status === 401) {
    return "Xác thực Google không thành công hoặc phiên xác thực đã hết hạn. Vui lòng đăng nhập lại.";
  }

  switch (code) {
    case "GOOGLE_DRIVE_FOLDER_NOT_FOUND":
      return "Tài khoản Google chưa được cấp quyền truy cập thư mục chứng từ. Vui lòng liên hệ quản trị viên.";
    case "GOOGLE_FILE_UNAVAILABLE":
      return "File không còn tồn tại hoặc không thể truy cập trên Google Drive.";
    case "GOOGLE_FILE_LOCATION_CHANGED":
      return "File đã bị chuyển khỏi thư mục chứng từ. Vui lòng kiểm tra lại trên Google Drive.";
    case "INVALID_FILE_TYPE":
      return "Định dạng file chưa được hỗ trợ. Vui lòng chọn file PDF hoặc định dạng được cho phép.";
    case "INVALID_DOCUMENT_CODE":
      return "Loại chứng từ không hợp lệ. Vui lòng chọn lại chứng từ.";
    case "MISSING_UPLOAD_FIELDS":
      return "Thông tin upload chưa đầy đủ. Vui lòng chọn lại file và thử lại.";
    case "SYNC_CANDIDATE_NOT_FOUND":
      return "File không còn trong phiên quét hiện tại. Vui lòng quét lại danh sách.";
    case "INVALID_DOCUMENT_FILE_NAME":
      return "Tên file chưa đúng định dạng. Vui lòng đổi tên file rồi thử lại.";
    case "GOOGLE_DRIVE_AUTH_FAILED":
      return "Tài khoản Google chưa được xác thực hoặc không có quyền truy cập. Vui lòng liên hệ quản trị viên.";
    case "GOOGLE_DRIVE_AUTH_REQUIRED":
      return "Quyền truy cập Google Drive đã hết hạn. Vui lòng đăng nhập lại bằng Google.";
    case "GOOGLE_DRIVE_PERMISSION_DENIED":
      return "Tài khoản Google không có quyền thao tác với thư mục chứng từ. Vui lòng liên hệ quản trị viên.";
    case "GOOGLE_DRIVE_TIMEOUT":
      return "Google Drive phản hồi quá lâu. Vui lòng thử lại sau.";
    case "ORDER_CODE_REQUIRED":
    case "MISSING_ORDER_CODE":
      return "Chưa có mã đơn hàng. Vui lòng kiểm tra lại thông tin đơn hàng.";
    case "RESTORE_FIELDS_REQUIRED":
      return "Chưa đủ thông tin để khôi phục file. Vui lòng thử lại từ danh sách file.";
    case "RENAME_FIELDS_REQUIRED":
      return "Chưa nhập đủ thông tin đổi tên file.";
    case "ORDER_ARCHIVED":
      return "Đơn hàng đã hoàn thành và được lưu trữ, không thể bổ sung thêm file.";
    case "INVALID_DOCUMENT_DELETE":
      return "Thiếu thông tin file cần xoá. Vui lòng mở lại file rồi thử lại.";
    case "DOCUMENT_FILE_NOT_FOUND":
      return "File không còn trong chứng từ của đơn (có thể vừa bị xoá). Vui lòng tải lại trang.";
    case "DOCUMENT_ORDER_ARCHIVED":
      return "Hồ sơ đơn đã lưu trữ, không xoá được file chứng từ.";
    case "DOCUMENT_FILE_NOT_ON_DRIVE":
      return "File không còn trên Google Drive (đã bị xoá hoặc đang nằm trong thùng rác). Hệ thống chưa xoá gì.";
    // Thông báo backend đã kèm tên file/thư mục cụ thể nên giữ nguyên để người dùng biết cần đổi tên gì.
    case "DUPLICATE_FILE_NAME":
      return backendMessage || "Tên file đã tồn tại trong thư mục chứng từ. Vui lòng đổi tên file rồi thử lại.";
    case "MISSING_TRANSPORT_CODE":
      return backendMessage || "Vui lòng chọn số container trước khi upload.";
    case "INVALID_CONTAINER_FOLDER":
    case "CONTAINER_FOLDER_RENAME_REQUIRED":
      return backendMessage || "Thư mục container không đúng định dạng. Vui lòng kiểm tra lại.";
    case "AI_CHAT_NOT_CONFIGURED":
      return "Chatbox AI chưa được cấu hình. Vui lòng liên hệ quản trị viên.";
    case "AI_CHAT_TIMEOUT":
      return "Chatbox AI phản hồi quá lâu. Vui lòng thử lại.";
    case "AI_CHAT_RATE_LIMITED":
      return "Bạn hỏi quá nhanh hoặc dịch vụ AI đang quá tải. Vui lòng chờ một chút rồi thử lại.";
    case "AI_CHAT_UPSTREAM_ERROR":
    case "AI_CHAT_INVALID_RESPONSE":
    case "AI_CHAT_FAILED":
      return "Chatbox AI tạm thời gặp lỗi. Vui lòng thử lại sau.";
    case "AI_CHAT_QUESTION_REQUIRED":
    case "AI_CHAT_QUESTION_TOO_LONG":
      return backendMessage || "Câu hỏi chưa hợp lệ.";
    case "EMAIL_CONFIG_MISSING":
      return "Chức năng gửi email chưa được cấu hình. Vui lòng liên hệ quản trị viên.";
    case "FILE_TOO_LARGE":
      return backendMessage || "File vượt quá dung lượng cho phép.";
    case "INVALID_FILE_SIZE":
      return "Dung lượng file không hợp lệ. Vui lòng chọn lại file.";
    case "UPLOAD_SESSION_FAILED":
    case "MISSING_UPLOAD_ORIGIN":
      return "Không mở được phiên upload Google Drive. Vui lòng thử lại.";
    case "UPLOAD_TOKEN_INVALID":
      return "Phiên upload đã hết hạn hoặc không hợp lệ. Vui lòng upload lại.";
    case "UPLOAD_FILE_MISMATCH":
      return "File trên Google Drive không khớp với phiên upload. Vui lòng upload lại.";
    case "PERMISSION_DENIED":
      return "Tài khoản không có quyền thực hiện thao tác này. Quyền có thể vừa được thay đổi, giao diện đã cập nhật lại.";
    case "ADMIN_ONLY":
      return backendMessage || "Chỉ tài khoản admin được thực hiện thao tác này.";
    case "SELF_PERMISSION_CHANGE":
      return "Không thể tự đổi role hoặc quyền của chính mình.";
    case "PERMISSION_ESCALATION":
      return backendMessage || "Không thể cấp quyền cao hơn quyền của chính bạn.";
    case "INVALID_PERMISSION":
      return backendMessage || "Quyền chọn chưa hợp lệ. Vui lòng kiểm tra lại.";
    case "INVALID_ROLE":
      return "Role không hợp lệ.";
    case "ACCOUNT_NOT_FOUND":
      return "Tài khoản không còn tồn tại. Vui lòng đăng nhập lại.";
    case "AUTH_LOOKUP_FAILED":
      return "Không kiểm tra được tài khoản đăng nhập. Vui lòng thử lại sau.";
    case "SESSION_REFRESH_DENIED":
      return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
    case "INVALID_PAYMENT_REQUEST":
    case "INVALID_PAYMENT_CATEGORY":
      return backendMessage || "Dữ liệu đề nghị thanh toán chưa hợp lệ.";
    case "PAYMENT_REQUEST_NOT_FOUND":
      return "Không tìm thấy đề nghị thanh toán (có thể bạn không có quyền xem).";
    case "PAYMENT_REQUEST_FORBIDDEN":
      return "Chỉ người tạo đề nghị hoặc kế toán được thao tác.";
    case "PAYMENT_REQUEST_CANCELLED":
    case "PAYMENT_REQUEST_LOCKED":
    case "PAYMENT_REQUEST_ALREADY_DECIDED":
    case "PAYMENT_REQUEST_NOT_APPROVED":
    case "PAYMENT_REQUEST_LINK_REQUIRED":
      return backendMessage || "Trạng thái đề nghị đã thay đổi. Vui lòng tải lại.";
    case "PAYMENT_DOCUMENT_NOT_FOUND":
      return "Chứng từ không còn trong hồ sơ đề nghị. Vui lòng tải lại.";
    case "INVALID_FILE_ID":
      return "Mã file chứng từ không hợp lệ.";
    case "PAYMENT_COST_NOT_FOUND":
      return "Không tìm thấy chi phí của bạn (có thể đã bị xóa). Vui lòng tải lại.";
    case "PAYMENT_COST_LOCKED":
      return backendMessage || "Chi phí đã nằm trong đề nghị, không sửa / xóa được.";
    case "PAYMENT_COST_UNAVAILABLE":
      return backendMessage || "Chi phí đã được đưa vào đề nghị khác. Vui lòng tải lại danh sách chi phí.";
    case "PAYMENT_CATEGORY_DUPLICATE":
    case "PAYMENT_CATEGORY_PROTECTED":
    case "PAYMENT_CATEGORY_IN_USE":
      return backendMessage || "Không lưu được khoản phí này. Vui lòng kiểm tra lại.";
    case "PAYMENT_CATEGORY_NOT_FOUND":
      return "Không tìm thấy khoản phí (có thể đã bị đổi). Vui lòng tải lại danh mục.";
    case "GOODS_PAYMENT_MISMATCH":
      return backendMessage || "Cọc hàng + thanh toán tiền còn lại phải bằng tiền hàng của hợp đồng.";
    case "GOOGLE_CHAT_NOT_CONFIGURED":
      return "Google Chat chưa được cấu hình. Vui lòng liên hệ quản trị viên.";
    case "GOOGLE_CHAT_REQUEST_FAILED":
      return "Không gửi được lên Google Chat. Vui lòng thử lại sau.";
    // Lỗi ràng buộc PostgreSQL từ API bảng nghiệp vụ: BE đã ghi rõ trường + giá trị sai (databaseErrorMessage.js).
    case "23505":
      return backendMessage || "Dữ liệu bị trùng với bản ghi đã có. Vui lòng nhập giá trị khác.";
    case "23503":
      return backendMessage || "Dữ liệu liên kết không hợp lệ (danh mục không có hoặc đang được dùng).";
    case "23502":
      return backendMessage || "Còn trường bắt buộc chưa nhập.";
    case "23514":
    case "22001":
    case "22003":
    case "22P02":
    case "22007":
    case "22008":
      return backendMessage || "Có giá trị chưa đúng định dạng hoặc quá giới hạn. Vui lòng kiểm tra lại.";
    default:
      break;
  }

  if (status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  if (status === 403) return "Bạn không có quyền thực hiện thao tác này.";
  if (status === 404) return "Không tìm thấy dữ liệu cần xử lý.";
  if (status === 413) return "File quá lớn để gửi lên máy chủ. Vui lòng nén file rồi thử lại.";
  if (status === 409) return "Dữ liệu đã tồn tại hoặc đang được sử dụng. Vui lòng kiểm tra lại.";
  if (status === 422) return "Thông tin chưa đúng định dạng. Vui lòng kiểm tra lại.";
  if (status === 429) return "Bạn thao tác quá nhanh. Vui lòng chờ một chút rồi thử lại.";
  if (status >= 500) {
    if (scope === "Drive") return "Không thể xử lý file trên Google Drive. Vui lòng thử lại hoặc liên hệ quản trị viên.";
    if (scope === "PostgreSQL") return "Không thể tải hoặc cập nhật dữ liệu. Vui lòng thử lại.";
    return "Máy chủ đang gặp sự cố. Vui lòng thử lại sau.";
  }
  return "Không thể hoàn tất yêu cầu. Vui lòng kiểm tra thông tin và thử lại.";
}

export function createHttpApiError(
  scope: string,
  method: string,
  path: string,
  response: Response,
  payload: unknown,
  nonJsonPreview = "",
): ApiError {
  const message = getApiPayloadMessage(payload);
  const detail = message
    || (nonJsonPreview ? `Backend trả dữ liệu không phải JSON: ${nonJsonPreview}` : response.statusText)
    || "Không có nội dung lỗi từ backend";
  const code = isRecord(payload)
    ? String(payload.code ?? payload.errorCode ?? "")
    : "";
  const technicalMessage = `[${scope}] ${method} ${path} thất bại (HTTP ${response.status}): ${detail}`;
  console.error("[Backend API]", {
    scope,
    method,
    path,
    status: response.status,
    code: code || undefined,
    message: detail,
  });
  if (response.status === 403 && code === "PERMISSION_DENIED" && typeof window !== "undefined") {
    window.dispatchEvent(new Event(PERMISSIONS_STALE_EVENT));
  }
  const error = new Error(getFriendlyMessage(scope, response.status, code, message)) as ApiError;
  error.technicalMessage = technicalMessage;
  error.status = response.status;
  if (isRecord(payload)) {
    if (typeof payload.code === "string") error.code = payload.code;
    else if (typeof payload.errorCode === "string") error.code = payload.errorCode;
    if (payload.google_drive !== undefined) error.detail = payload.google_drive;
  }
  return error;
}

export function createInvalidResponseError(scope: string, method: string, path: string, preview: string): Error {
  const detail = preview ? `Nội dung nhận được: ${preview}` : "Response rỗng";
  const technicalMessage = `[${scope}] ${method} ${path} trả về response không phải JSON. ${detail}`;
  console.error("[Backend API invalid response]", technicalMessage);
  const error = new Error("Máy chủ trả về dữ liệu không hợp lệ. Vui lòng thử lại sau.") as ApiError;
  error.technicalMessage = technicalMessage;
  return error;
}

export function createNetworkApiError(scope: string, method: string, path: string, error: TypeError): Error {
  const technicalMessage = `[${scope}] Không thể kết nối khi gọi ${method} ${path}. Chi tiết: ${error.message}`;
  console.error("[Backend API network]", technicalMessage, error);
  const friendly = new Error("Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối mạng và thử lại.") as ApiError;
  friendly.technicalMessage = technicalMessage;
  return friendly;
}
