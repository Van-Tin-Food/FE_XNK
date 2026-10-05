"use client";

import { useAuth } from "@/context/AuthContext";
import { completeGoogleSignIn, GOOGLE_MFA_STORAGE_KEY } from "@/services/authApi";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

interface PendingMfa {
  pendingToken?: string;
  state: string;
  mode?: "mfa" | "direct";
  createdAt: number;
}

const PENDING_TTL_MS = 10 * 60 * 1000;

function readPendingMfa(): PendingMfa | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(GOOGLE_MFA_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingMfa;
    if (!parsed?.state || (!parsed.pendingToken && parsed.mode !== "direct")) return null;
    if (Date.now() - (parsed.createdAt || 0) > PENDING_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function GoogleCallback() {
  const searchParams = useSearchParams();
  const { setUser } = useAuth();
  const [error, setError] = useState("");
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const code = searchParams.get("code") || "";
    const state = searchParams.get("state") || "";
    const googleError = searchParams.get("error");

    const pending = readPendingMfa();
    window.sessionStorage.removeItem(GOOGLE_MFA_STORAGE_KEY);

    const fail = (message: string) => {
      // setTimeout để không gọi setState đồng bộ trong effect (cascading render).
      window.setTimeout(() => setError(message), 0);
    };

    if (googleError) {
      fail(
        googleError === "access_denied"
          ? "Bạn đã từ chối cấp quyền đăng nhập Google."
          : `Google từ chối yêu cầu đăng nhập (${googleError}).`,
      );
      return;
    }
    if (!code || !state) {
      fail("Google không trả về mã ủy quyền. Vui lòng đăng nhập lại.");
      return;
    }
    if (!pending) {
      fail("Không tìm thấy phiên đăng nhập Google. Vui lòng đăng nhập lại từ đầu.");
      return;
    }
    if (pending.state !== state) {
      fail("Phiên xác thực Google không khớp (state). Vui lòng đăng nhập lại.");
      return;
    }

    completeGoogleSignIn({ code, state, ...(pending.pendingToken ? { pendingToken: pending.pendingToken } : {}) })
      .then((user) => {
        setUser(user);
        window.location.replace("/");
      })
      .catch((err) => {
        fail(err instanceof Error ? err.message : "Không thể xác thực đăng nhập Google.");
      });
  }, [searchParams, setUser]);

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <h1 className="text-title-sm font-semibold text-gray-800 dark:text-white/90 sm:text-title-md">
          Xác thực Google thất bại
        </h1>
        <p className="mt-3 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10 dark:text-error-400">
          {error}
        </p>
        <Link
          href="/signin"
          className="mt-6 inline-flex justify-center rounded-lg bg-brand-500 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-600"
        >
          Quay lại đăng nhập
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      <p className="mt-5 text-sm text-gray-500 dark:text-gray-400">
        Đang xác thực tài khoản Google, vui lòng đợi...
      </p>
    </div>
  );
}

export default function GoogleSignInCallbackPage() {
  return (
    <Suspense fallback={
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    }>
      <GoogleCallback />
    </Suspense>
  );
}
