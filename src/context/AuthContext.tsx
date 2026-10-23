"use client";

import {
  clearStoredUser,
  fetchCurrentUser,
  forgetGoogleReauth,
  getStoredUser,
  GOOGLE_DRIVE_AUTH_REQUIRED_EVENT,
  GOOGLE_MFA_STORAGE_KEY,
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
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const googleReauthStarted = useRef(false);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const pathname = usePathname();
  const lastPathname = useRef<string | null>(null);
  const lastUserRefreshAt = useRef(0);

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
  }, []);

  /** Role + quyền đổi (admin vừa sửa) có hiệu lực mà không phải đăng xuất. Gộp các lần gọi trùng nhau. */
  const refreshUser = useCallback(() => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const task = (async () => {
      if (!getStoredUser()?.token) return;
      try {
        const fresh = await fetchCurrentUser();
        setUser((current) => (sameUser(current, fresh) ? current : fresh));
      } catch (error) {
        // Token hết hạn / tài khoản đã bị xoá: authApi đã xoá phiên trong trình duyệt.
        if ((error as ApiError).status === 401) setUser(null);
        // Lỗi mạng / BE tạm lỗi: giữ quyền đang có.
      }
    })().finally(() => {
      refreshInFlight.current = null;
    });
    refreshInFlight.current = task;
    return task;
  }, []);

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
      // Tải lại trang: lấy role + quyền mới nhất từ BE trước khi hiện menu / nút thao tác.
      fallbackTimer = window.setTimeout(() => {
        if (active) setIsInitialized(true);
      }, INITIAL_REFRESH_TIMEOUT_MS);
      lastUserRefreshAt.current = Date.now();
      void refreshUser().finally(() => {
        window.clearTimeout(fallbackTimer);
        if (active) setIsInitialized(true);
      });
    }, 0);

    // Phiên hết hạn: token không còn hợp lệ nên không ghi nhật ký, chỉ xoá phiên.
    const handleExpiredSession = () => clearSession();
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
    return () => {
      active = false;
      window.clearTimeout(startTimer);
      window.clearTimeout(fallbackTimer);
      window.removeEventListener("xnk:auth-expired", handleExpiredSession);
      window.removeEventListener(PERMISSIONS_STALE_EVENT, handlePermissionsStale);
      window.removeEventListener(GOOGLE_DRIVE_AUTH_REQUIRED_EVENT, handleGoogleDriveAuthRequired);
    };
  }, [clearSession, refreshUser]);

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
