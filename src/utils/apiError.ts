type ApiPayload = Record<string, unknown>;

export type ApiError = Error & {
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
    case "EMAIL_CONFIG_MISSING":
      return "Chức năng gửi email chưa được cấu hình. Vui lòng liên hệ quản trị viên.";
    default:
      break;
  }

  if (status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  if (status === 403) return "Bạn không có quyền thực hiện thao tác này.";
  if (status === 404) return "Không tìm thấy dữ liệu cần xử lý.";
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
  const code = isRecord(payload) && typeof payload.code === "string" ? payload.code : "";
  const technicalMessage = `[${scope}] ${method} ${path} thất bại (HTTP ${response.status}): ${detail}`;
  console.error("[Backend API]", {
    scope,
    method,
    path,
    status: response.status,
    code: code || undefined,
    message: detail,
  });
  const error = new Error(getFriendlyMessage(scope, response.status, code, message)) as ApiError;
  error.technicalMessage = technicalMessage;
  if (isRecord(payload)) {
    if (typeof payload.code === "string") error.code = payload.code;
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
