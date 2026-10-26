"use client";

import {
  clearStoredUser,
  fetchCurrentUser,
  forgetGoogleReauth,
  getStoredUser,
  GOOGLE_DRIVE_AUTH_REQUIRED_EVENT,
  GOOGLE_MFA_STORAGE_KEY,
  isTokenExpired,
  refreshSession,
  saveRefreshedSession,
  sessionNeedsRefresh,
  startGoogleSignIn,
} from "@/services/authApi";
import type { AuthUser } from "@/types/auth";
import {
  completePermissions,
  fullPermissions,
  hasPermission,
  isAdminRole,
  type PermissionFunction,
  type PermissionLevel,
  type PermissionMap,
} from "@/config/shipmentActionPermissions";
import { PERMISSIONS_STALE_EVENT, type ApiError } from "@/utils/apiError";
import { usePathname } from "next/navigation";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

// Tải lại trang (F5): chờ BE trả role + quyền mới tối đa ngần này rồi mới hiện giao diện.
// Mạng chậm / BE lỗi thì dùng tạm quyền đã lưu, lần tải trang sau sẽ đọc lại.
const NAVIGATION_REFRESH_MS = 60 * 1000;
const INITIAL_REFRESH_TIMEOUT_MS = 6000;
// Giữ phiên nhờ token Google: kiểm tra hạn JWT định kỳ và mỗi lần quay lại tab, sắp hết thì gia hạn.
const SESSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;

interface AuthContextValue {
  user: AuthUser | null;
  isInitialized: boolean;
  /** Quyền thực tế theo chức năng (admin: toàn quyền). */
  permissions: PermissionMap;
  /** Có chức năng fn ở mức level trở lên không (edit bao gồm view). */
  can: (fn: PermissionFunction, level?: PermissionLevel) => boolean;
  /** Đọc lại role + quyền hiện tại từ BE. */
  refreshUser: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function sameUser(left: AuthUser | null, right: AuthUser | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Server và lần render client đầu tiên phải cùng bắt đầu với user = null.
  // localStorage chỉ được đọc sau khi component đã hydrate.
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  // Phiên hiện tại, đọc được ngay trong các hàm bất đồng bộ (gia hạn xong chỉ áp dụng nếu vẫn là phiên đó).
  const userRef = useRef<AuthUser | null>(null);
  // Token BE đã từ chối gia hạn (không có / mất quyền Google): không hỏi lại, phiên hết theo hạn JWT.
  const refreshDeniedToken = useRef<string | null>(null);
  const googleReauthStarted = useRef(false);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const pathname = usePathname();
  const lastPathname = useRef<string | null>(null);
  const lastUserRefreshAt = useRef(0);

  const setUser = useCallback((next: AuthUser | null) => {
    userRef.current = next;
    setUserState(next);
  }, []);

  const permissions = useMemo(
    () => (user && isAdminRole(user.role) ? fullPermissions() : completePermissions(user?.permissions)),
    [user],
  );
  const can = useCallback(
    (fn: PermissionFunction, level: PermissionLevel = "view") => hasPermission(user, fn, level),
    [user],
  );

  const clearSession = useCallback(() => {
    clearStoredUser();
    setUser(null);
  }, [setUser]);

  /**
   * Đổi token đang dùng lấy token mới nhờ quyền Google (BE kiểm tra). Trả phiên mới, hoặc null nếu không gia hạn được.
   * Người dùng đã đăng xuất / đổi tài khoản trong lúc chờ thì bỏ kết quả.
   */
  const renewSession = useCallback(async (token: string): Promise<AuthUser | null> => {
    if (refreshDeniedToken.current === token) return null;
    try {
      const fresh = await refreshSession(token);
      if (userRef.current?.token !== token) return null;
      setUser(saveRefreshedSession(fresh));
      return fresh;
    } catch (error) {
      if ((error as ApiError).status === 401) refreshDeniedToken.current = token;
      return null;
    }
  }, [setUser]);

  /** JWT sắp hết / đã hết hạn: gia hạn nhờ Google. Đã hết hạn mà không gia hạn được thì đăng xuất (về /signin). */
  const ensureFreshSession = useCallback(async () => {
    const token = userRef.current?.token;
    if (!token || !sessionNeedsRefresh(token)) return;
    const renewed = await renewSession(token);
    if (!renewed && isTokenExpired(token) && userRef.current?.token === token) clearSession();
  }, [clearSession, renewSession]);

  /** Role + quyền đổi (admin vừa sửa) có hiệu lực mà không phải đăng xuất. Gộp các lần gọi trùng nhau. */
  const refreshUser = useCallback(() => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const task = (async () => {
      const token = getStoredUser()?.token;
      if (!token) return;
      try {
        const fresh = await fetchCurrentUser();
        if (!sameUser(userRef.current, fresh)) setUser(fresh);
      } catch (error) {
        // Token hết hạn / tài khoản đã bị xoá: authApi đã xoá phiên trong trình duyệt. Thử giữ phiên nhờ Google trước.
        if ((error as ApiError).status === 401 && !(await renewSession(token))) setUser(null);
        // Lỗi mạng / BE tạm lỗi: giữ quyền đang có.
      }
    })().finally(() => {
      refreshInFlight.current = null;
    });
    refreshInFlight.current = task;
    return task;
  }, [renewSession, setUser]);

  // Đăng xuất không ghi nhật ký thao tác (nhật ký chỉ ghi thao tác nghiệp vụ).
  const logout = useCallback(() => {
    // Tự đăng xuất thì không tự đăng nhập lại bằng Google (chỉ áp dụng khi phiên hết hạn).
    forgetGoogleReauth();
    clearSession();
  }, [clearSession]);

  useEffect(() => {
    let active = true;
    let fallbackTimer: number | undefined;
    const startTimer = window.setTimeout(() => {
      const stored = getStoredUser();
      setUser(stored);
      if (!stored?.token) {
        setIsInitialized(true);
        return;
      }
      // Tải lại trang: gia hạn phiên nếu JWT sắp / đã hết hạn, rồi lấy role + quyền mới nhất từ BE trước khi hiện menu.
      fallbackTimer = window.setTimeout(() => {
        if (active) setIsInitialized(true);
      }, INITIAL_REFRESH_TIMEOUT_MS);
      lastUserRefreshAt.current = Date.now();
      void ensureFreshSession()
        .then(() => refreshUser())
        .finally(() => {
          window.clearTimeout(fallbackTimer);
          if (active) setIsInitialized(true);
        });
    }, 0);

    const sessionTimer = window.setInterval(() => void ensureFreshSession(), SESSION_CHECK_INTERVAL_MS);
    // Máy ngủ / tab ẩn lâu thì interval bị trễ: quay lại tab là kiểm tra ngay.
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void ensureFreshSession();
    };

    // BE trả 401: thử giữ phiên nhờ Google; không được thì xoá phiên (không ghi nhật ký vì token đã hết hiệu lực).
    const handleExpiredSession = () => {
      const token = userRef.current?.token;
      if (!token) return;
      void renewSession(token).then((renewed) => {
        if (!renewed && userRef.current?.token === token) clearSession();
      });
    };
    // BE từ chối vì thiếu quyền: quyền đang hiển thị đã cũ, đọc lại để ẩn các nút không còn dùng được.
    const handlePermissionsStale = () => void refreshUser();
    const handleGoogleDriveAuthRequired = () => {
      if (googleReauthStarted.current) return;
      googleReauthStarted.current = true;
      // Token Drive đã bị BE xoá vì hết hạn/lỗi: phải qua màn hình cấp quyền để lấy token mới.
      void startGoogleSignIn(true)
        .then(({ googleAuthUrl, state }) => {
          sessionStorage.setItem(GOOGLE_MFA_STORAGE_KEY, JSON.stringify({
            state,
            mode: "direct",
            createdAt: Date.now(),
          }));
          window.location.href = googleAuthUrl;
        })
        .catch(() => {
          googleReauthStarted.current = false;
        });
    };
    window.addEventListener("xnk:auth-expired", handleExpiredSession);
    window.addEventListener(PERMISSIONS_STALE_EVENT, handlePermissionsStale);
    window.addEventListener(GOOGLE_DRIVE_AUTH_REQUIRED_EVENT, handleGoogleDriveAuthRequired);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      active = false;
      window.clearTimeout(startTimer);
      window.clearTimeout(fallbackTimer);
      window.clearInterval(sessionTimer);
      window.removeEventListener("xnk:auth-expired", handleExpiredSession);
      window.removeEventListener(PERMISSIONS_STALE_EVENT, handlePermissionsStale);
      window.removeEventListener(GOOGLE_DRIVE_AUTH_REQUIRED_EVENT, handleGoogleDriveAuthRequired);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [clearSession, ensureFreshSession, refreshUser, renewSession, setUser]);

  // Chuyển trang trong app: đọc lại role + quyền, tối đa một lần mỗi NAVIGATION_REFRESH_MS (trước đây mỗi lần chuyển
  // trang là một request /me đọc DB). Quyền bị thu hồi giữa chừng vẫn được cập nhật ngay: BE trả 403 -> PERMISSIONS_STALE_EVENT.
  // Lần đầu đã đọc ở effect khởi tạo phía trên.
  useEffect(() => {
    if (lastPathname.current === null || lastPathname.current === pathname) {
      lastPathname.current = pathname;
      return;
    }
    lastPathname.current = pathname;
    if (Date.now() - lastUserRefreshAt.current < NAVIGATION_REFRESH_MS) return;
    lastUserRefreshAt.current = Date.now();
    void refreshUser();
  }, [pathname, refreshUser]);

  return (
    <AuthContext.Provider value={{ user, isInitialized, permissions, can, refreshUser, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
