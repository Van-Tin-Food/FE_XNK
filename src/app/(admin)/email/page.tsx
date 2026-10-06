"use client";

import { canPerformShipmentAction } from "@/config/shipmentActionPermissions";
import SearchSuggestions from "@/components/common/SearchSuggestions";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import { sendContactEmail } from "@/services/emailApi";
import { databaseEndpoints, listDatabaseRows } from "@/services/postgresShipmentApi";
import type { SupplierRecord } from "@/types/postgresShipment";
import EmailSendingIndicator from "@/components/email/EmailSendingIndicator";
import PaginationControls from "@/components/common/PaginationControls";
import { paginateItems } from "@/utils/pagination";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const MAX_EMAIL_RECIPIENTS = 15;

export default function EmailPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { notify } = useSystemNotification();
  const router = useRouter();
  const canSend = canPerformShipmentAction(user, "sendEmail");
  const canView = canPerformShipmentAction(user, "viewEmailTools") || canSend;
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [supplierQuery, setSupplierQuery] = useState("");
  const [supplierPage, setSupplierPage] = useState(1);
  const [supplierPageSize, setSupplierPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const loadSuppliers = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError("");
    try {
      const rows = await listDatabaseRows<SupplierRecord>(databaseEndpoints.suppliers);
      setSuppliers(rows.filter((row) => String(row.ten_ncc || "").trim()));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("emailSupplierLoadError"));
    } finally {
      setLoading(false);
    }
  }, [canView, t]);

  useEffect(() => {
    if (!canView) {
      router.replace("/");
      return;
    }
    void loadSuppliers();
  }, [canView, loadSuppliers, router]);

  const filteredSuppliers = useMemo(() => {
    const query = supplierQuery.trim().toLocaleLowerCase("vi");
    return suppliers.filter((supplier) => !query || [supplier.ten_ncc, supplier.email].join(" ").toLocaleLowerCase("vi").includes(query));
  }, [supplierQuery, suppliers]);
  const selectedSuppliers = useMemo(() => suppliers.filter((supplier) => selectedIds.includes(supplier.id_ncc)), [selectedIds, suppliers]);
  const selectableSuppliers = filteredSuppliers.filter((supplier) => String(supplier.email || "").trim());
  const allVisibleSelected = selectableSuppliers.slice(0, MAX_EMAIL_RECIPIENTS).every((supplier) => selectedIds.includes(supplier.id_ncc)) && selectableSuppliers.length > 0;
  const canSubmit = canSend && selectedSuppliers.some((supplier) => String(supplier.email || "").trim()) && Boolean(message.trim()) && !sending;
  const supplierPagination = paginateItems(filteredSuppliers, supplierPage, supplierPageSize);

  const toggleAll = () => {
    const allIds = selectableSuppliers.map((supplier) => supplier.id_ncc);
    const ids = allIds.slice(0, MAX_EMAIL_RECIPIENTS);
    if (allIds.length > MAX_EMAIL_RECIPIENTS) notify(t("emailSelectLimit", { count: MAX_EMAIL_RECIPIENTS }), "warning");
    setSelectedIds((current) => allVisibleSelected ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])]);
  };

  const toggleSupplier = (id: string) => {
    if (!selectedIds.includes(id) && selectedIds.length >= MAX_EMAIL_RECIPIENTS) {
      notify(t("emailSendLimit", { count: MAX_EMAIL_RECIPIENTS }), "warning");
      return;
    }
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const send = async () => {
    const recipients = selectedSuppliers
      .map((supplier) => ({ email: String(supplier.email || "").trim(), name: supplier.ten_ncc }))
      .filter((recipient) => recipient.email);
    if (!canSubmit || recipients.length === 0) return;

    setSending(true);
    try {
      const result = await sendContactEmail({ message: message.trim(), recipients });
      notify(
        result.failedCount
          ? t("emailPartialSuccess", { sent: result.sentCount || 0, failed: result.failedCount })
          : t("emailSentSuccessCount", { count: result.sentCount || recipients.length }),
        result.failedCount ? "warning" : "success",
      );
      setMessage("");
      setSelectedIds([]);
    } catch (sendError) {
      notify(sendError instanceof Error ? sendError.message : t("emailSendError"), "error");
    } finally {
      setSending(false);
    }
  };

  if (!canView) return null;

  return (
    <section className="space-y-5">
      <EmailSendingIndicator sending={sending} total={selectedSuppliers.length} />
      <p className="-mt-3 text-xs text-gray-500 dark:text-gray-400">{t("emailMaxRecipients", { count: MAX_EMAIL_RECIPIENTS })}</p>
      <div>
        <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">{t("emailPageTitle")}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("emailPageDescription")}</p>
      </div>
      {error && <div className="rounded-xl border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">{error}</div>}
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(360px,1.1fr)_minmax(360px,0.9fr)]">
        <div className="min-w-0">
          <SupplierList
            suppliers={supplierPagination.items}
            suggestionSuppliers={suppliers}
            query={supplierQuery}
            selectedIds={selectedIds}
            allSelected={allVisibleSelected}
            loading={loading}
            canSend={canSend}
            onQuery={(value) => { setSupplierQuery(value); setSupplierPage(1); }}
            onToggleAll={toggleAll}
            onToggle={toggleSupplier}
          />
          <PaginationControls
            page={supplierPagination.safePage}
            totalPages={supplierPagination.totalPages}
            pageSize={supplierPageSize}
            totalItems={supplierPagination.total}
            from={supplierPagination.from}
            to={supplierPagination.to}
            summaryKey="showingRecords"
            idPrefix="email-suppliers"
            onPageChange={setSupplierPage}
            onPageSizeChange={(value) => { setSupplierPageSize(value); setSupplierPage(1); }}
          />
        </div>
        <Compose
          selectedSuppliers={selectedSuppliers}
          message={message}
          sending={sending}
          canSend={canSend}
          canSubmit={canSubmit}
          subject={t("emailSubjectTemplate")}
          onMessage={setMessage}
          onSend={() => void send()}
        />
      </div>
    </section>
  );
}

function SupplierList({ suppliers, suggestionSuppliers, query, selectedIds, allSelected, loading, canSend, onQuery, onToggleAll, onToggle }: {
  suppliers: SupplierRecord[];
  suggestionSuppliers: SupplierRecord[];
  query: string;
  selectedIds: string[];
  allSelected: boolean;
  loading: boolean;
  canSend: boolean;
  onQuery: (value: string) => void;
  onToggleAll: () => void;
  onToggle: (id: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex min-h-[520px] min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="border-b border-gray-100 p-4 dark:border-gray-800">
        <h2 className="font-semibold text-gray-800 dark:text-white/90">{t("suppliers")}</h2>
        <SearchSuggestions value={query} onChange={onQuery} suggestions={suggestionSuppliers.flatMap((supplier) => [supplier.ten_ncc, supplier.email]).filter((value): value is string => Boolean(value))} placeholder={t("emailSearchSupplier")} ariaLabel={t("emailSearchSupplier")} className="mt-3 h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-xs outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white" />
      </div>
      <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <label className="flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
          <input type="checkbox" checked={allSelected} onChange={onToggleAll} disabled={!canSend || loading} className="h-4 w-4 accent-brand-500" />
          {t("emailSelectAllWithEmail")}
        </label>
        <p className="mt-1 text-[11px] text-gray-400">{t("emailSelectedSuppliersCount", { count: selectedIds.length })}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
        {loading ? <p className="p-3 text-xs text-gray-500">{t("emailLoading")}</p> : suppliers.length === 0 ? <p className="p-3 text-xs text-gray-500">{t("emailNoSuppliers")}</p> : suppliers.map((supplier) => {
          const hasEmail = Boolean(String(supplier.email || "").trim());
          return (
            <label key={supplier.id_ncc} className={`flex items-start gap-2 rounded-lg px-2.5 py-2 ${selectedIds.includes(supplier.id_ncc) ? "bg-brand-50 dark:bg-brand-500/10" : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"}`}>
              <input type="checkbox" checked={selectedIds.includes(supplier.id_ncc)} onChange={() => onToggle(supplier.id_ncc)} disabled={!canSend || !hasEmail} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500" />
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-gray-800 dark:text-white/90">{supplier.ten_ncc}</span>
                <span className={`block truncate text-[11px] ${hasEmail ? "text-gray-500 dark:text-gray-400" : "text-amber-600"}`}>{hasEmail ? supplier.email : t("emailSupplierNoAddress")}</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function Compose({ selectedSuppliers, message, sending, canSend, canSubmit, subject, onMessage, onSend }: {
  selectedSuppliers: SupplierRecord[];
  message: string;
  sending: boolean;
  canSend: boolean;
  canSubmit: boolean;
  subject: string;
  onMessage: (value: string) => void;
  onSend: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex min-h-[520px] min-w-0 flex-col rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="border-b border-gray-100 pb-4 dark:border-gray-800">
        <h2 className="font-semibold text-gray-800 dark:text-white/90">{t("emailComposeTitle")}</h2>
        <p className="mt-1 text-xs text-gray-500">{t("emailPerSupplier")}</p>
      </div>
      <div className="space-y-4 pt-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-300">{t("emailRecipientSupplier")}</label>
          <div className="min-h-10 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">{selectedSuppliers.length ? selectedSuppliers.map((supplier) => supplier.ten_ncc).join(", ") : t("emailNoSelectedSuppliers")}</div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-300">{t("emailSubjectLabel")}</label>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">{subject}</div>
        </div>
        <textarea value={message} onChange={(event) => onMessage(event.target.value)} disabled={!canSend || sending} rows={17} placeholder={t("emailMessagePlaceholder")} className="min-h-[280px] w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none focus:border-brand-400 disabled:cursor-not-allowed disabled:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-3 dark:border-gray-800">
        <span className="text-xs text-gray-400">{t("emailSelectedRecipientsCount", { count: selectedSuppliers.length })}</span>
        <button type="button" onClick={onSend} disabled={!canSubmit} className="h-10 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50">{sending ? t("emailSending") : t("emailSendButton")}</button>
      </div>
    </div>
  );
}
