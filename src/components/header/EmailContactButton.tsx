"use client";

import { Modal } from "@/components/ui/modal";
import { sendContactEmail } from "@/services/emailApi";
import { listDatabaseRows, databaseEndpoints } from "@/services/postgresShipmentApi";
import type { SupplierRecord } from "@/types/postgresShipment";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import React, { useMemo, useState } from "react";

/**
 * Nút email nổi góc phải dưới màn hình: mở popup soạn email (tiêu đề, nội dung),
 * chọn người nhận bằng checkbox tick từng nhà cung cấp hoặc tick tất cả,
 * gửi qua Gmail SMTP (mỗi người nhận một email riêng).
 */
export default function EmailContactButton() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { notify } = useSystemNotification();
  const canSendEmail = user?.role.trim().toLowerCase() === "admin"
    && user.session?.trim().toLowerCase() === "all";

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const suppliersWithAddress = useMemo(
    () => suppliers.filter((item) => String(item.email || "").trim()),
    [suppliers],
  );
  const suppliersWithoutAddress = useMemo(
    () => suppliers.filter((item) => !String(item.email || "").trim()),
    [suppliers],
  );

  const loadSuppliers = () => {
    setLoadingSuppliers(true);
    listDatabaseRows<SupplierRecord>(databaseEndpoints.suppliers)
      .then((rows) => {
        setSuppliers(rows.filter((row) => String(row.ten_ncc || "").trim()));
        setError("");
      })
      .catch(() => {
        setSuppliers([]);
        setError(t("emailSupplierLoadError"));
      })
      .finally(() => setLoadingSuppliers(false));
  };

  const handleOpen = () => {
    setIsModalOpen(true);
    setSubject("");
    setMessage("");
    setSelectedIds([]);
    setError("");
    loadSuppliers();
  };

  const handleClose = () => {
    if (sending) return;
    setIsModalOpen(false);
  };

  const allSelected = suppliersWithAddress.length > 0 && selectedIds.length === suppliersWithAddress.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < suppliersWithAddress.length;

  const handleToggleAll = () => {
    setError("");
    setSelectedIds(allSelected ? [] : suppliersWithAddress.map((item) => item.id_ncc));
  };

  const handleToggleOne = (id: string) => {
    setError("");
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const selectedSuppliers = suppliers.filter((item) => selectedIds.includes(item.id_ncc));
  const canSubmit = Boolean(subject.trim() && message.trim() && selectedSuppliers.length > 0) && !sending;

  const handleSubmit = async () => {
    const recipients = selectedSuppliers
      .map((item) => ({ email: String(item.email || "").trim(), name: item.ten_ncc }))
      .filter((item) => item.email);
    if (recipients.length === 0) {
      setError(t("emailSelectOneSupplier"));
      return;
    }
    setSending(true);
    setError("");
    try {
      const result = await sendContactEmail({
        subject: subject.trim(),
        message: message.trim(),
        recipients,
        senderName: user?.name || user?.username || "",
      });
      const sentCount = result.sentCount ?? recipients.length;
      const failedCount = result.failedCount ?? 0;
      if (failedCount > 0) {
        notify(t("emailPartialSuccess", { sent: sentCount, failed: failedCount }), "warning");
        setError(result.message || t("emailPartialSuccess", { sent: sentCount, failed: failedCount }));
      } else {
        setIsModalOpen(false);
        notify(t("emailSentSuccessCount", { count: sentCount }), "success");
      }
    } catch (sendError) {
      const text = sendError instanceof Error ? sendError.message : t("emailSendError");
      setError(text);
      notify(text, "error");
    } finally {
      setSending(false);
    }
  };

  if (!canSendEmail) return null;

  return (
    <>
      {/* Nút nổi góc phải dưới màn hình */}
      <button
        type="button"
        onClick={handleOpen}
        title={t("emailContactTitle")}
        aria-label={t("emailContactTitle")}
        className="fixed bottom-6 right-6 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-white shadow-theme-lg transition-all hover:scale-105 hover:bg-brand-600 active:scale-95"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M3.5 5.5C2.67157 5.5 2 6.17157 2 7V17C2 17.8284 2.67157 18.5 3.5 18.5H20.5C21.3284 18.5 22 17.8284 22 17V7C22 6.17157 21.3284 5.5 20.5 5.5H3.5ZM4.35352 7.5H19.6465L12 12.7433L4.35352 7.5ZM20 9.58936V16.5H4V9.58936L11.4801 14.7237C11.7982 14.9416 12.2182 14.9416 12.5363 14.7237L20 9.58936Z"
            fill="currentColor"
          />
        </svg>
      </button>

      <Modal
        isOpen={isModalOpen}
        onClose={handleClose}
        className="mx-4 my-4 flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden"
        contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div className="shrink-0 border-b border-gray-100 px-6 pb-4 pt-6 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t("emailContactTitle")}</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("emailContactDescription")}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 custom-scrollbar">
          {error && (
            <div className="mb-4 rounded-lg border border-error-200 bg-error-50 px-3 py-2 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">
              {error}
            </div>
          )}

          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("emailRecipientSupplier")} <span className="text-error-500">*</span>
            </label>
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {t("emailSelectedCount", { count: selectedIds.length })}
            </span>
          </div>

          {/* Tick tất cả */}
          <label className="mb-2 flex cursor-pointer items-center gap-2.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(element) => { if (element) element.indeterminate = someSelected; }}
              onChange={handleToggleAll}
              disabled={loadingSuppliers || sending || suppliersWithAddress.length === 0}
              className="h-4 w-4 shrink-0 cursor-pointer accent-brand-500"
            />
            <span className="text-sm font-medium text-gray-800 dark:text-white/90">{t("emailSelectAll")}</span>
          </label>

          {/* Danh sách tick từng nhà cung cấp */}
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1 custom-scrollbar">
            {loadingSuppliers ? (
              <div className="rounded-lg bg-gray-50 px-3 py-4 text-sm text-gray-500 dark:bg-white/[0.02] dark:text-gray-400">
                {t("emailLoadingSuppliers")}
              </div>
            ) : suppliers.length === 0 ? (
              <div className="rounded-lg bg-gray-50 px-3 py-4 text-sm text-gray-500 dark:bg-white/[0.02] dark:text-gray-400">
                {t("noData")}
              </div>
            ) : (
              suppliers.map((item) => {
                const hasAddress = Boolean(String(item.email || "").trim());
                return (
                  <label
                    key={item.id_ncc}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
                      selectedIds.includes(item.id_ncc)
                        ? "border-brand-300 bg-brand-50 dark:border-brand-500/40 dark:bg-brand-500/10"
                        : "border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-white/[0.03]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id_ncc)}
                      onChange={() => handleToggleOne(item.id_ncc)}
                      disabled={!hasAddress || sending}
                      className="h-4 w-4 shrink-0 cursor-pointer accent-brand-500"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-gray-800 dark:text-white/90">{item.ten_ncc}</span>
                      <span className={`block truncate text-xs ${hasAddress ? "text-gray-500 dark:text-gray-400" : "text-amber-600 dark:text-amber-400"}`}>
                        {hasAddress
                          ? String(item.email).trim()
                          : t("emailSupplierNoAddress")}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
          {suppliersWithoutAddress.length > 0 && (
            <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
              {t("emailSuppliersWithoutAddress", { count: suppliersWithoutAddress.length })}
            </p>
          )}

          <label className="mb-1.5 mt-5 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("emailSubjectLabel")} <span className="text-error-500">*</span>
          </label>
          <input
            type="text"
            value={subject}
            onChange={(event) => { setSubject(event.target.value); setError(""); }}
            disabled={sending}
            placeholder={t("emailSubjectPlaceholder")}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
          />

          <label className="mb-1.5 mt-4 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("emailMessageLabel")} <span className="text-error-500">*</span>
          </label>
          <textarea
            value={message}
            onChange={(event) => { setMessage(event.target.value); setError(""); }}
            disabled={sending}
            rows={6}
            placeholder={t("emailMessagePlaceholder")}
            className="w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
          />
        </div>

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-gray-100 px-6 py-4 dark:border-gray-800">
          <button
            type="button"
            onClick={handleClose}
            disabled={sending}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white shadow-theme-xs transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
            {sending ? t("emailSending") : t("emailSendButton")}
          </button>
        </div>
      </Modal>
    </>
  );
}
