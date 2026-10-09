import type { AuthUser, LoginMfaInfo, LoginResponse } from "@/types/auth";
import { backendApiUrl } from "@/services/backendApiUrl";
import { createHttpApiError, createInvalidResponseError, createNetworkApiError, parseApiResponse } from "@/utils/apiError";

const AUTH_STORAGE_KEY = "dashboard_auth_user";
export const AUTH_TOKEN_COOKIE_KEY = "xnk_auth_token";
/** sessionStorage giữ state giữa luồng Google trực tiếp hoặc bước MFA Google. */
export const GOOGLE_MFA_STORAGE_KEY = "xnk_google_mfa_pending";
export const GOOGLE_DRIVE_AUTH_REQUIRED_EVENT = "xnk:google-drive-auth-required";

export async function startGoogleSignIn(): Promise<{ googleAuthUrl: string; state: string }> {
  const apiPath = "/api/auth/google/start";
  const res = await fetch(backendApiUrl(apiPath), { method: "GET" });
  const { data, nonJsonPreview } = await parseApiResponse(res);
  const json = (data || {}) as { googleAuthUrl?: string; state?: string };
  if (!res.ok) throw createHttpApiError("Đăng nhập Google", "GET", apiPath, res, data, nonJsonPreview);
  if (!json.googleAuthUrl || !json.state) throw new Error("Máy chủ chưa trả về đường dẫn đăng nhập Google");
  return { googleAuthUrl: json.googleAuthUrl, state: json.state };
}

function storeTokenCookie(token: string): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${AUTH_TOKEN_COOKIE_KEY}=${encodeURIComponent(token)}; Path=/; SameSite=Lax; Max-Age=28800${secure}`;
}

function clearTokenCookie(): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${AUTH_TOKEN_COOKIE_KEY}=; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}

function getTokenCookie(): string {
  if (typeof document === "undefined") return "";
  const prefix = `${AUTH_TOKEN_COOKIE_KEY}=`;
  const value = document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : "";
}

function storeUser(user: AuthUser): AuthUser {
  if (typeof window !== "undefined") {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    storeTokenCookie(user.token || "");
  }
  return user;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeUser(payload: unknown, fallbackUsername: string): AuthUser {
  if (isRecord(payload)) {
    const rawId = payload.id ?? payload.userId ?? payload.user_id;
    const id = Number(rawId);
    const username = String(payload.username ?? payload.userName ?? fallbackUsername).trim() || fallbackUsername;
    const name = String(payload.name ?? payload.fullName ?? payload.full_name ?? username).trim() || username;
    const role = String(payload.role ?? payload.userRole ?? payload.position ?? "User").trim() || "User";
    const session = String(payload.session ?? payload.sessionId ?? payload.session_id ?? "").trim() || undefined;
    const email = String(payload.email ?? "").trim() || undefined;
    const token = String(payload.token ?? payload.accessToken ?? payload.access_token ?? "").trim() || undefined;
    return { id: Number.isInteger(id) && id > 0 ? id : undefined, username, name, role, session, email, token };
  }

  return {
    username: fallbackUsername,
    name: fallbackUsername,
    role: "User",
  };
}

function extractUser(json: LoginResponse, fallbackUsername: string): AuthUser {
  let user: AuthUser;
  if (isRecord(json.data) && isRecord(json.data.user)) {
    user = normalizeUser(json.data.user, fallbackUsername);
  } else if (isRecord(json.data)) {
    user = normalizeUser(json.data, fallbackUsername);
  } else if (Array.isArray(json.data) && json.data.length > 0) {
    user = normalizeUser(json.data[0], fallbackUsername);
  } else if (isRecord(json.user)) {
    user = normalizeUser(json.user, fallbackUsername);
  } else {
    user = normalizeUser(json, fallbackUsername);
  }
  const data = isRecord(json.data) ? json.data : {};
  const topLevelToken = String(
    json.token ?? json.accessToken ?? json.access_token ?? data.token ?? data.accessToken ?? data.access_token ?? "",
  ).trim() || undefined;
  const topLevelSession = String(
    json.session ?? json.sessionId ?? json.session_id ?? data.session ?? data.sessionId ?? data.session_id ?? "",
  ).trim() || undefined;
  return {
    ...user,
    token: user.token || topLevelToken,
    session: user.session || topLevelSession,
  };
}

export async function login(username: string, password: string): Promise<AuthUser | LoginMfaInfo> {
  const apiPath = "/api/auth/login";
  try {
    const res = await fetch(backendApiUrl(apiPath), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });

    const { data, nonJsonPreview } = await parseApiResponse(res);
    const json = (data || {}) as LoginResponse;

    if (!res.ok) {
      throw createHttpApiError("Đăng nhập", "POST", apiPath, res, data, nonJsonPreview);
    }
    if (data === null) throw createInvalidResponseError("Đăng nhập", "POST", apiPath, nonJsonPreview);

    // Tài khoản có email + server đã bật Google OAuth: chưa cấp token phiên,
    // trả về thông tin để FE chuyển hướng người dùng sang Google (bước 2).
    if (json.mfaRequired && json.pendingToken && json.googleAuthUrl) {
      const mfa: LoginMfaInfo = {
        mfaRequired: true,
        pendingToken: String(json.pendingToken),
        googleAuthUrl: String(json.googleAuthUrl),
        state: String(json.state || ""),
      };
      return mfa;
    }

    const user = extractUser(json, username);
    if (!user.token) {
      throw new Error("Máy chủ chưa trả về token đăng nhập");
    }
    return storeUser(user);
  } catch (error) {
    if (error instanceof TypeError) {
      throw createNetworkApiError("Đăng nhập", "POST", apiPath, error);
    }
    throw error;
  }
}

export interface AuthActionResponse {
  success?: boolean;
  message?: string;
  error?: string;
  data?: unknown;
}export interface ManagedUser {
  id: number;      
  username: string;
  name: string;
  role: string;
  session: string;
  email?: string;
}

function findUserRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.users)) return payload.users;
  if (isRecord(payload.data) && Array.isArray(payload.data.users)) return payload.data.users;
  return [];
}

function normalizeManagedUser(payload: unknown): ManagedUser | null {
  if (!isRecord(payload)) return null;
  const nestedUser = isRecord(payload.user) ? payload.user : {};
  const id = Number(payload.id ?? payload.userId ?? payload.user_id ?? nestedUser.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const username = String(payload.username ?? payload.user_name ?? nestedUser.username ?? "").trim();
  return {
    id,
    username,
    name: String(payload.name ?? payload.fullName ?? payload.full_name ?? nestedUser.name ?? username).trim() || username,
    role: String(payload.role ?? payload.userRole ?? payload.user_role ?? nestedUser.role ?? "").trim(),
    session: String(payload.session ?? payload.sessionId ?? payload.session_id ?? nestedUser.session ?? "").trim(),
    email: String(payload.email ?? nestedUser.email ?? "").trim() || undefined,
  };
}

async function authRequest(path: string, init: RequestInit): Promise<unknown> {
  const token = getStoredUser()?.token?.trim();
  const method = String(init.method || "GET").toUpperCase();
  const apiPath = `/api/auth/${path}`;
  try {
    const response = await fetch(backendApiUrl(apiPath), {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
      cache: "no-store",
    });
    const { data: result, nonJsonPreview } = await parseApiResponse(response);
    if (response.status === 401) clearStoredUser();
    if (!response.ok || (isRecord(result) && result.success === false)) {
      throw createHttpApiError("Tài khoản", method, apiPath, response, result, nonJsonPreview);
    }
    if (result === null) throw createInvalidResponseError("Tài khoản", method, apiPath, nonJsonPreview);
    return result;
  } catch (error) {
    if (error instanceof TypeError) throw createNetworkApiError("Tài khoản", method, apiPath, error);
    throw error;
  }
}

async function postAuthAction(path: string, body: Record<string, string>): Promise<AuthActionResponse> {
  const token = getStoredUser()?.token?.trim();
  const apiPath = `/api/auth/${path}`;
  try {
    const response = await fetch(backendApiUrl(apiPath), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const { data, nonJsonPreview } = await parseApiResponse(response);
    const result = (data || {}) as AuthActionResponse;
    if (response.status === 401) clearStoredUser();
    if (!response.ok || result.success === false) {
      throw createHttpApiError("Tài khoản", "POST", apiPath, response, data, nonJsonPreview);
    }
    if (data === null) throw createInvalidResponseError("Tài khoản", "POST", apiPath, nonJsonPreview);
    return result;
  } catch (error) {
    if (error instanceof TypeError) throw createNetworkApiError("Tài khoản", "POST", apiPath, error);
    throw error;
  }
}

export interface RegisterUserPayload {
  username: string;
  name: string;
  password: string;
  role: string;
  session: string;
  /** Email Google dùng cho bước xác thực 2 của đăng nhập. */
  email?: string;
}

export function registerUser(payload: RegisterUserPayload): Promise<AuthActionResponse> {
  return postAuthAction("register", { ...payload });
}

export function updateUserPassword(username: string, password: string): Promise<AuthActionResponse> {
  return postAuthAction("update-password", { username, password });
}

export async function getUsers(): Promise<ManagedUser[]> {
  const result = await authRequest("users", { method: "GET" });
  return findUserRows(result)
    .map(normalizeManagedUser)
    .filter((user): user is ManagedUser => user !== null);
}

export async function getUserById(id: number): Promise<ManagedUser> {
  const result = await authRequest(`users/${id}`, { method: "GET" });
  const source = isRecord(result) && result.data !== undefined ? result.data : result;
  const user = normalizeManagedUser(source)
    || (isRecord(source) ? normalizeManagedUser(source.user) : null);
  if (!user) throw new Error("Dữ liệu tài khoản từ máy chủ không hợp lệ");
  return user;
}

export async function updateUser(
  id: number,
  changes: Pick<ManagedUser, "role" | "session"> & { email?: string },
): Promise<AuthActionResponse> {
  return await authRequest(`users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  }) as AuthActionResponse;
}

/**
 * Gửi authorization code + state, kèm pendingToken nếu đây là bước MFA.
 * Backend đối chiếu email Google với tài khoản rồi cấp token phiên.
 */
export async function completeGoogleSignIn(params: {
  code: string;
  state: string;
  pendingToken?: string;
}): Promise<AuthUser> {
  const apiPath = "/api/auth/google/verify";
  try {
    const res = await fetch(backendApiUrl(apiPath), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const { data, nonJsonPreview } = await parseApiResponse(res);
    const json = (data || {}) as LoginResponse;
    if (!res.ok) {
      throw createHttpApiError("Xác thực Google", "POST", apiPath, res, data, nonJsonPreview);
    }
    if (data === null) throw createInvalidResponseError("Xác thực Google", "POST", apiPath, nonJsonPreview);

    const user = extractUser(json, "google");
    if (!user.token) {
      throw new Error("Máy chủ chưa trả về token đăng nhập sau khi xác thực Google");
    }
    return storeUser(user);
  } catch (error) {
    if (error instanceof TypeError) {
      throw createNetworkApiError("Xác thực Google", "POST", apiPath, error);
    }
    throw error;
  }
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;

  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;

  try {
    const user = JSON.parse(raw) as AuthUser;
    const token = String(user?.token || "").trim();
    if (!user || typeof user !== "object" || !token || getTokenCookie() !== token) {
      clearStoredUser();
      return null;
    }
    return user;
  } catch {
    return null;
  }
}

export function clearStoredUser() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  clearTokenCookie();
}
