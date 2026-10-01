export interface AuthUser {
  id?: number;
  username: string;
  name: string;
  role: string;
  session?: string;
  token?: string;
  /** Email đã liên kết với tài khoản (dùng để xác thực Google bước 2). */
  email?: string;
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
  data?: unknown;
  user?: unknown;
  token?: string;
  accessToken?: string;
  access_token?: string;
  session?: string;
  sessionId?: string;
  session_id?: string;
  mfaRequired?: boolean;
  pendingToken?: string;
  googleAuthUrl?: string;
  state?: string;
}
