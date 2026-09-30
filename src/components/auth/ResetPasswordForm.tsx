"use client";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import { canPerformShipmentAction } from "@/config/shipmentActionPermissions";
import { useAuth } from "@/context/AuthContext";
import { recordActivity } from "@/services/activityLogApi";
import { updateUserPassword } from "@/services/authApi";
import Link from "next/link";
import React, { useState } from "react";

export default function ResetPasswordForm() {
  const { user } = useAuth();
  const canUpdatePassword = canPerformShipmentAction(user, "updateUserPassword");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  if (!canUpdatePassword) {
    return <div className="flex w-full flex-1 items-center justify-center"><div className="w-full max-w-md rounded-2xl border border-error-200 bg-error-50 p-6 text-center dark:border-error-500/30 dark:bg-error-500/10"><h1 className="text-lg font-semibold text-error-700 dark:text-error-300">Không có quyền đổi mật khẩu</h1><p className="mt-2 text-sm text-error-600 dark:text-error-400">Chỉ tài khoản có role Admin và session manage mới được sử dụng chức năng này.</p><Link href={user ? "/" : "/signin"} className="mt-5 inline-flex rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white">Quay lại</Link></div></div>;
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(""); setSuccess("");
    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password || !confirmPassword) return setError("Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.");
    if (password !== confirmPassword) return setError("Mật khẩu xác nhận không khớp.");
    if (password.length < 6) return setError("Mật khẩu phải có ít nhất 6 ký tự.");
    setLoading(true);
    try {
      const result = await updateUserPassword(normalizedUsername, password);
      recordActivity(user, { action: "UPDATE_USER_PASSWORD", location: "Auth/ResetPassword", detail: `Cập nhật mật khẩu tài khoản ${normalizedUsername}` });
      setSuccess(result.message || `Đã cập nhật mật khẩu cho ${normalizedUsername}.`);
      setUsername(""); setPassword(""); setConfirmPassword("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Không thể cập nhật mật khẩu.");
    } finally { setLoading(false); }
  };

  return (
    <div className="flex w-full flex-1 flex-col lg:w-1/2">
      <div className="mx-auto mb-5 w-full max-w-md sm:pt-10"><Link href="/" className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">← Quay lại hệ thống</Link></div>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-6">
        <h1 className="text-title-sm font-semibold text-gray-800 dark:text-white/90 sm:text-title-md">Quên mật khẩu</h1>
        <p className="mb-6 mt-2 text-sm text-gray-500 dark:text-gray-400">Nhập chính xác tên đăng nhập để đặt lại mật khẩu.</p>
        <form onSubmit={handleSubmit} autoComplete="off" className="space-y-5">
          <div><Label>Tên đăng nhập <span className="text-error-500">*</span></Label><Input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" placeholder="Nhập tên đăng nhập cần đổi" /></div>
          <div><Label>Mật khẩu mới <span className="text-error-500">*</span></Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="Nhập mật khẩu mới" /></div>
          <div><Label>Xác nhận mật khẩu <span className="text-error-500">*</span></Label><Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" placeholder="Nhập lại mật khẩu mới" /></div>
          {error && <p role="alert" className="rounded-lg bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10 dark:text-error-400">{error}</p>}
          {success && <p role="status" className="rounded-lg bg-success-50 px-3 py-2 text-sm text-success-600 dark:bg-success-500/10 dark:text-success-400">{success}</p>}
          <button type="submit" disabled={loading} className="w-full rounded-lg bg-brand-500 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60">{loading ? "Đang cập nhật..." : "Cập nhật mật khẩu"}</button>
        </form>
      </div>
    </div>
  );
}
