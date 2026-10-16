import type { PermissionMap } from "@/config/shipmentActionPermissions";

export interface AuthUser {
  id?: number;
  username: string;
  name: string;
  role: string;
  token?: string;
  /** Email đã liên kết với tài khoản (dùng để xác thực Google bước 2). */
  email?: string;
  /** Quyền thực tế theo chức năng do BE tính (chuẩn của role + tùy chỉnh riêng). */
  permissions?: Partial<PermissionMap>;
}

export interface LoginMfaInfo {
  /** Tài khoản có email + server đã bật Google OAuth -> cần xác thực bước 2. */
  mfaRequired: boolean;
  /** JWT ngắn hạn, chỉ dùng để gọi /api/auth/google/verify. */
  pendingToken: string;
  /** URL Authorization Endpoint của Google (đã kèm state/nonce). */
  googleAuthUrl: string;
  /** Chống CSRF; phải gửi kèm khi verify. */
  state: string;
}


export interface LoginResponse {
  success?: boolean;
  message?: string;
  /** Mã lỗi BE, ví dụ GOOGLE_CONSENT_REQUIRED (kèm googleAuthUrl + state để cấp quyền lại). */
  code?: string;
  data?: unknown;
  user?: unknown;
  token?: string;
  accessToken?: string;
  access_token?: string;
  mfaRequired?: boolean;
  pendingToken?: string;
  googleAuthUrl?: string;
  state?: string;
}
