"use client";

import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import SignatureSettings from "@/components/profile/SignatureSettings";
import { getMySignature, saveMySignature, updateMyProfile } from "@/services/authApi";
import { useEffect, useState } from "react";

// Thông tin cá nhân của tài khoản đang đăng nhập: họ và tên đầy đủ (users.full_name — in trên Giấy đề nghị thanh toán, lưu
// qua PUT /api/auth/me/signature), tên hiển thị / tên đăng nhập / email (PATCH /api/auth/me), vai trò (chỉ xem) và chữ ký.
// Bấm Lưu chỉ gọi API của phần có thay đổi.

const MAX_FULL_NAME_LENGTH = 100;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INPUT = "h-11 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-950 dark:text-white";
const LABEL = "mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300";
const HINT = "mt-1 block text-xs text-gray-500 dark:text-gray-400";

const cleanName = (value: string) => value.replace(/\s+/g, " ").trim();

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const { t } = useLanguage();
  const { notify } = useSystemNotification();
  const [fullName, setFullName] = useState("");
  const [savedFullName, setSavedFullName] = useState("");
  const [signatureImage, setSignatureImage] = useState("");
  const [loadingSignature, setLoadingSignature] = useState(true);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(user?.name || "");
    setUsername(user?.username || "");
    setEmail(user?.email || "");
  }, [user]);

  // Họ và tên đầy đủ + ảnh chữ ký đọc một lần (ảnh truyền xuống mục Chữ ký).
  useEffect(() => {
    let active = true;
    getMySignature()
      .then((signature) => {
        if (!active) return;
        setFullName(signature.fullName);
        setSavedFullName(signature.fullName);
        setSignatureImage(signature.image);
      })
      .catch((error) => { if (active) notify(error instanceof Error ? error.message : String(error), "error"); })
      .finally(() => { if (active) setLoadingSignature(false); });
    return () => { active = false; };
  }, [notify]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextFullName = cleanName(fullName);
    const nextName = name.trim();
    const nextUsername = username.trim();
    const nextEmail = email.trim().toLowerCase();
    if (!nextName || !nextUsername) {
      notify(t("profileRequiredNameUsername"), "warning");
      return;
    }
    if (nextEmail && !EMAIL_PATTERN.test(nextEmail)) {
      notify(t("profileInvalidEmail"), "warning");
      return;
    }
    if (nextFullName.length > MAX_FULL_NAME_LENGTH) {
      notify(t("profileFullNameTooLong"), "warning");
      return;
    }
    const accountChanged = nextName !== (user?.name || "") || nextUsername !== (user?.username || "") || nextEmail !== (user?.email || "").toLowerCase();
    const fullNameChanged = !loadingSignature && nextFullName !== savedFullName;
    if (!accountChanged && !fullNameChanged) {
      notify(t("profileNoChanges"), "info");
      return;
    }
    setSaving(true);
    try {
      if (accountChanged) {
        const updated = await updateMyProfile({ name: nextName, username: nextUsername, email: nextEmail });
        setName(updated.name);
        setUsername(updated.username);
        setEmail(updated.email || "");
      }
      if (fullNameChanged) {
        const signature = await saveMySignature({ fullName: nextFullName });
        setFullName(signature.fullName);
        setSavedFullName(signature.fullName);
      }
      if (accountChanged) await refreshUser();
      notify(t("profileSaved"), "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : t("profileSaveFailed"), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-800 sm:text-2xl dark:text-white/90">{t("myProfile")}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("myProfileDescription")}</p>
      </div>
      <form onSubmit={save} className="space-y-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6 dark:border-gray-800 dark:bg-gray-900">
        <dl className="grid grid-cols-2 gap-3 rounded-xl bg-gray-50 px-4 py-3 text-sm dark:bg-white/[0.03]">
          <div className="min-w-0">
            <dt className="text-xs text-gray-500 dark:text-gray-400">{t("profileRole")}</dt>
            <dd className="truncate font-medium text-gray-800 dark:text-white/90">{user?.role || "—"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-gray-500 dark:text-gray-400">{t("profileAccountId")}</dt>
            <dd className="font-medium tabular-nums text-gray-800 dark:text-white/90">{user?.id ?? "—"}</dd>
          </div>
        </dl>

        <label className="block">
          <span className={LABEL}>{t("profileFullName")}</span>
          <input value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={MAX_FULL_NAME_LENGTH}
            disabled={loadingSignature} autoComplete="name" placeholder={t("profileFullNamePlaceholder")} className={`${INPUT} disabled:opacity-60`} />
          <span className={HINT}>{t("profileFullNameHint")}</span>
        </label>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block min-w-0">
            <span className={LABEL}>{t("displayName")}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="nickname" className={INPUT} />
            <span className={HINT}>{t("profileDisplayNameHint")}</span>
          </label>
          <label className="block min-w-0">
            <span className={LABEL}>{t("username")}</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" className={INPUT} />
          </label>
        </div>

        <label className="block">
          <span className={LABEL}>Email</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className={INPUT} />
          <span className={HINT}>{t("profileEmailHint")}</span>
        </label>

        <div className="flex justify-end">
          <button type="submit" disabled={saving}
            className="h-11 w-full rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
            {saving ? t("profileSaving") : t("profileSave")}
          </button>
        </div>
      </form>
      <SignatureSettings initialImage={signatureImage} loading={loadingSignature} signerName={cleanName(fullName) || user?.name || ""} />
    </section>
  );
}
