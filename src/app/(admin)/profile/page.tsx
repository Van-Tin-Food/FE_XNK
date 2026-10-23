"use client";

import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import { updateMyProfile } from "@/services/authApi";
import { useEffect, useState } from "react";

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const { t } = useLanguage();
  const { notify } = useSystemNotification();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(user?.name || "");
    setUsername(user?.username || "");
    setEmail(user?.email || "");
  }, [user]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = name.trim();
    const nextUsername = username.trim();
    const nextEmail = email.trim().toLowerCase();
    if (!nextName || !nextUsername) {
      notify("Vui lòng nhập tên và username.", "warning");
      return;
    }
    if (nextEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      notify("Email không hợp lệ.", "warning");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateMyProfile({ name: nextName, username: nextUsername, email: nextEmail });
      setName(updated.name);
      setUsername(updated.username);
      setEmail(updated.email || "");
      await refreshUser();
      notify("Đã cập nhật thông tin tài khoản.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể cập nhật thông tin tài khoản.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">{t("myProfile")}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("myProfileDescription")}</p>
      </div>
      <form onSubmit={save} className="space-y-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">{t("displayName")}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">{t("username")}</span>
          <input value={username} onChange={(event) => setUsername(event.target.value)} className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Email</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
        </label>
        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? "Đang lưu..." : "Lưu thay đổi"}
          </button>
        </div>
      </form>
    </section>
  );
}
