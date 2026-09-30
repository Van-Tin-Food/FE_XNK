"use client";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import { canPerformShipmentAction, RBAC_ROLES, RBAC_SESSIONS } from "@/config/shipmentActionPermissions";
import { useAuth } from "@/context/AuthContext";
import { recordActivity } from "@/services/activityLogApi";
import { registerUser } from "@/services/authApi";
import Link from "next/link";
import React, { useState } from "react";

const EMPTY_FORM = { username: "", name: "", password: "", confirmPassword: "", role: "van_chuyen", session: "view" };

export default function SignUpForm() {
  const { user } = useAuth();
  const canRegister = canPerformShipmentAction(user, "registerUser");
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  if (!canRegister) {
    return <AccessDenied title="Không có quyền đăng ký tài khoản" userExists={Boolean(user)} />;
  }

  const updateField = (field: keyof typeof form, value: string) => setForm((current) => (
    field === "role"
      ? { ...current, role: value, session: value === "admin" ? "manage" : current.session }
      : { ...current, [field]: value }
  ));

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    const values = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()])) as typeof form;
    if (Object.values(values).some((value) => !value)) return setError("Vui lòng nhập đầy đủ tất cả thông tin.");
    if (values.password !== values.confirmPassword) return setError("Mật khẩu xác nhận không khớp.");
    if (values.password.length < 6) return setError("Mật khẩu phải có ít nhất 6 ký tự.");

    setLoading(true);
    try {
      const result = await registerUser({ username: values.username, name: values.name, password: values.password, role: values.role, session: values.session });
      recordActivity(user, { action: "REGISTER_USER", location: "Auth/SignUp", detail: `Tạo tài khoản ${values.username}; role ${values.role}; session ${values.session}` });
      setSuccess(result.message || `Đã tạo tài khoản ${values.username}.`);
      setForm(EMPTY_FORM);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Không thể tạo tài khoản.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthFormShell title="Đăng ký tài khoản" description="Tạo tài khoản mới và phân quyền truy cập hệ thống.">
      <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
        <Field label="Tên đăng nhập"><Input type="text" value={form.username} onChange={(e) => updateField("username", e.target.value)} autoComplete="off" placeholder="Nhập tên đăng nhập" /></Field>
        <Field label="Tên hiển thị"><Input type="text" value={form.name} onChange={(e) => updateField("name", e.target.value)} placeholder="Nhập tên người dùng" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Role"><select value={form.role} onChange={(e) => updateField("role", e.target.value)} className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 outline-none focus:border-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white">{RBAC_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}</select></Field>
          <Field label="Session"><select value={form.session} disabled={form.role === "admin"} onChange={(e) => updateField("session", e.target.value)} className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 outline-none focus:border-brand-500 disabled:cursor-not-allowed disabled:opacity-60 focus:border-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white">{(form.role === "admin" ? ["manage"] : RBAC_SESSIONS).map((session) => <option key={session} value={session}>{session}</option>)}</select></Field>
        </div>
        <Field label="Mật khẩu"><Input type="password" value={form.password} onChange={(e) => updateField("password", e.target.value)} autoComplete="new-password" placeholder="Nhập mật khẩu" /></Field>
        <Field label="Xác nhận mật khẩu"><Input type="password" value={form.confirmPassword} onChange={(e) => updateField("confirmPassword", e.target.value)} autoComplete="new-password" placeholder="Nhập lại mật khẩu" /></Field>
        <Feedback error={error} success={success} />
        <button type="submit" disabled={loading} className="w-full rounded-lg bg-brand-500 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60">{loading ? "Đang tạo..." : "Tạo tài khoản"}</button>
      </form>
    </AuthFormShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label>{label} <span className="text-error-500">*</span></Label>{children}</div>;
}

function Feedback({ error, success }: { error: string; success: string }) {
  if (error) return <p role="alert" className="rounded-lg bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10 dark:text-error-400">{error}</p>;
  if (success) return <p role="status" className="rounded-lg bg-success-50 px-3 py-2 text-sm text-success-600 dark:bg-success-500/10 dark:text-success-400">{success}</p>;
  return null;
}

function AuthFormShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <div className="flex w-full flex-1 flex-col overflow-y-auto no-scrollbar lg:w-1/2"><div className="mx-auto mb-5 w-full max-w-md sm:pt-10"><Link href="/" className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">← Quay lại hệ thống</Link></div><div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-6"><h1 className="text-title-sm font-semibold text-gray-800 dark:text-white/90 sm:text-title-md">{title}</h1><p className="mb-6 mt-2 text-sm text-gray-500 dark:text-gray-400">{description}</p>{children}</div></div>;
}

function AccessDenied({ title, userExists }: { title: string; userExists: boolean }) {
  return <div className="flex w-full flex-1 items-center justify-center"><div className="w-full max-w-md rounded-2xl border border-error-200 bg-error-50 p-6 text-center dark:border-error-500/30 dark:bg-error-500/10"><h1 className="text-lg font-semibold text-error-700 dark:text-error-300">{title}</h1><p className="mt-2 text-sm text-error-600 dark:text-error-400">Tài khoản hiện tại chưa có quyền quản lý tài khoản.</p><Link href={userExists ? "/" : "/signin"} className="mt-5 inline-flex rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600">Quay lại</Link></div></div>;
}
