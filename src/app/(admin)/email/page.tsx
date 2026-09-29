"use client";

import { canPerformShipmentAction } from "@/config/shipmentActionPermissions";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import { getEmailDeliveryLogs, type EmailActivityLog } from "@/services/activityLogApi";
import { sendContactEmail } from "@/services/emailApi";
import { databaseEndpoints, listDatabaseRows } from "@/services/postgresShipmentApi";
import type { SupplierRecord } from "@/types/postgresShipment";
import EmailSendingIndicator from "@/components/email/EmailSendingIndicator";
import PaginationControls from "@/components/common/PaginationControls";
import { paginateItems } from "@/utils/pagination";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const SUBJECT_TEMPLATE = "VTF/ {Tên nhà cung cấp} - Inquiry on pork items for CFR Vietnam";

const MAX_EMAIL_RECIPIENTS = 15;

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value || "-" : date.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });
}
export default function EmailPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { notify } = useSystemNotification();
  const router = useRouter();
  const canSend = canPerformShipmentAction(user, "sendEmail");
  const canViewLogs = canPerformShipmentAction(user, "viewEmailLogs");
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [logs, setLogs] = useState<EmailActivityLog[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [supplierQuery, setSupplierQuery] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [supplierPage, setSupplierPage] = useState(1);
  const [supplierPageSize, setSupplierPageSize] = useState(10);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);
  const [status, setStatus] = useState<"all" | "sent" | "not sent">("all");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    if (!canSend && !canViewLogs) return;
    setLoading(true);
    setError("");
    try {
      const [supplierRows, emailLogs] = await Promise.all([
        listDatabaseRows<SupplierRecord>(databaseEndpoints.suppliers),
        canViewLogs ? getEmailDeliveryLogs() : Promise.resolve([] as EmailActivityLog[]),
      ]);
      setSuppliers(supplierRows.filter((row) => String(row.ten_ncc || "").trim()));
      setLogs(emailLogs);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("emailSupplierLoadError"));
    } finally {
      setLoading(false);
    }
  }, [canSend, canViewLogs, t]);

  useEffect(() => {
    if (!canSend && !canViewLogs) {
      router.replace("/");
      return;
    }
    void loadData();
  }, [canSend, canViewLogs, loadData, router]);

  const filteredSuppliers = useMemo(() => {
    const query = supplierQuery.trim().toLocaleLowerCase("vi");
    return suppliers.filter((supplier) => !query || [supplier.ten_ncc, supplier.email].join(" ").toLocaleLowerCase("vi").includes(query));
  }, [supplierQuery, suppliers]);
  const suppliersWithEmail = useMemo(() => suppliers.filter((supplier) => String(supplier.email || "").trim()), [suppliers]);
  const selectedSuppliers = useMemo(() => suppliers.filter((supplier) => selectedIds.includes(supplier.id_ncc)), [selectedIds, suppliers]);
  const selectableSuppliers = filteredSuppliers.filter((supplier) => String(supplier.email || "").trim());
  const allVisibleSelected = selectableSuppliers.slice(0, MAX_EMAIL_RECIPIENTS).every((supplier) => selectedIds.includes(supplier.id_ncc)) && selectableSuppliers.length > 0;
  const successfulEmails = useMemo(() => new Set(logs.filter((log) => log.status === "sent").map((log) => log.supplierEmail.toLowerCase())), [logs]);
  const missingSuppliers = useMemo(() => suppliersWithEmail.filter((supplier) => !successfulEmails.has(String(supplier.email).trim().toLowerCase())), [successfulEmails, suppliersWithEmail]);
  const visibleLogs = useMemo(() => logs.filter((log) => {
    const query = historyQuery.trim().toLocaleLowerCase("vi");
    const haystack = [log.supplierName, log.supplierEmail, log.subject, log.error].join(" ").toLocaleLowerCase("vi");
    return (status === "all" || log.status === status) && (!query || haystack.includes(query));
  }), [historyQuery, logs, status]);
  const canSubmit = canSend && selectedSuppliers.some((supplier) => String(supplier.email || "").trim()) && Boolean(message.trim()) && !sending;
  const supplierPagination = paginateItems(filteredSuppliers, supplierPage, supplierPageSize);
  const historyPagination = paginateItems(visibleLogs, historyPage, historyPageSize);

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
    const recipients = selectedSuppliers.map((supplier) => ({ email: String(supplier.email || "").trim(), name: supplier.ten_ncc })).filter((recipient) => recipient.email);
    if (!canSubmit || recipients.length === 0) return;
    setSending(true);
    try {
      const result = await sendContactEmail({ message: message.trim(), recipients });
      notify(result.failedCount ? t("emailPartialSuccess", { sent: result.sentCount || 0, failed: result.failedCount }) : t("emailSentSuccessCount", { count: result.sentCount || recipients.length }), result.failedCount ? "warning" : "success");
      setMessage("");
      setSelectedIds([]);
      await loadData();
    } catch (sendError) {
      notify(sendError instanceof Error ? sendError.message : t("emailSendError"), "error");
    } finally {
      setSending(false);
    }
  };

  if (!canSend && !canViewLogs) return null;
  return <section className="space-y-5">
    <EmailSendingIndicator sending={sending} total={selectedSuppliers.length} />
    {canSend && <p className="-mt-3 text-xs text-gray-500 dark:text-gray-400">{t("emailMaxRecipients", { count: MAX_EMAIL_RECIPIENTS })}</p>}
    <div><h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">{t("emailPageTitle")}</h1><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("emailPageDescription")}</p></div>
    {error && <div className="rounded-xl border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">{error}</div>}
    <div className="grid min-w-0 gap-5 xl:grid-cols-[250px_minmax(360px,0.9fr)_minmax(390px,1.1fr)]">
      <div className="min-w-0"><SupplierList suppliers={supplierPagination.items} query={supplierQuery} selectedIds={selectedIds} allSelected={allVisibleSelected} loading={loading} canSend={canSend} onQuery={(value) => { setSupplierQuery(value); setSupplierPage(1); }} onToggleAll={toggleAll} onToggle={toggleSupplier} /><PaginationControls page={supplierPagination.safePage} totalPages={supplierPagination.totalPages} pageSize={supplierPageSize} totalItems={supplierPagination.total} from={supplierPagination.from} to={supplierPagination.to} summaryKey="showingRecords" idPrefix="email-suppliers" onPageChange={setSupplierPage} onPageSizeChange={(value) => { setSupplierPageSize(value); setSupplierPage(1); }} /></div>
      <Compose selectedSuppliers={selectedSuppliers} message={message} sending={sending} canSend={canSend} canSubmit={canSubmit} onMessage={setMessage} onSend={() => void send()} />
      {canViewLogs ? <div className="min-w-0"><History logs={historyPagination.items} missing={missingSuppliers} loading={loading} status={status} query={historyQuery} onRefresh={() => void loadData()} onStatus={(value) => { setStatus(value); setHistoryPage(1); }} onQuery={(value) => { setHistoryQuery(value); setHistoryPage(1); }} /><PaginationControls page={historyPagination.safePage} totalPages={historyPagination.totalPages} pageSize={historyPageSize} totalItems={historyPagination.total} from={historyPagination.from} to={historyPagination.to} summaryKey="showingRecords" idPrefix="email-history" onPageChange={setHistoryPage} onPageSizeChange={(value) => { setHistoryPageSize(value); setHistoryPage(1); }} /></div> : <div className="rounded-2xl border border-dashed border-gray-300 p-6 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">{t("emailHistoryPermissionDenied")}</div>}
    </div>
  </section>;
}
function SupplierList({ suppliers, query, selectedIds, allSelected, loading, canSend, onQuery, onToggleAll, onToggle }: { suppliers: SupplierRecord[]; query: string; selectedIds: string[]; allSelected: boolean; loading: boolean; canSend: boolean; onQuery: (value: string) => void; onToggleAll: () => void; onToggle: (id: string) => void }) {
  const { t } = useLanguage();
  return <div className="flex min-h-[520px] min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"><div className="border-b border-gray-100 p-4 dark:border-gray-800"><h2 className="font-semibold text-gray-800 dark:text-white/90">{t("suppliers")}</h2><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={t("emailSearchSupplier")} className="mt-3 h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-xs outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white" /></div><div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800"><label className="flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-gray-300"><input type="checkbox" checked={allSelected} onChange={onToggleAll} disabled={!canSend || loading} className="h-4 w-4 accent-brand-500" /> {t("emailSelectAllWithEmail")}</label><p className="mt-1 text-[11px] text-gray-400">{t("emailSelectedSuppliersCount", { count: selectedIds.length })}</p></div><div className="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">{loading ? <p className="p-3 text-xs text-gray-500">{t("emailLoading")}</p> : suppliers.length === 0 ? <p className="p-3 text-xs text-gray-500">{t("emailNoSuppliers")}</p> : suppliers.map((supplier) => { const hasEmail = Boolean(String(supplier.email || "").trim()); return <label key={supplier.id_ncc} className={`flex items-start gap-2 rounded-lg px-2.5 py-2 ${selectedIds.includes(supplier.id_ncc) ? "bg-brand-50 dark:bg-brand-500/10" : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"}`}><input type="checkbox" checked={selectedIds.includes(supplier.id_ncc)} onChange={() => onToggle(supplier.id_ncc)} disabled={!canSend || !hasEmail} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500" /><span className="min-w-0"><span className="block truncate text-xs font-semibold text-gray-800 dark:text-white/90">{supplier.ten_ncc}</span><span className={`block truncate text-[11px] ${hasEmail ? "text-gray-500 dark:text-gray-400" : "text-amber-600"}`}>{hasEmail ? supplier.email : t("emailSupplierNoAddress")}</span></span></label>; })}</div></div>;
}

function Compose({ selectedSuppliers, message, sending, canSend, canSubmit, onMessage, onSend }: { selectedSuppliers: SupplierRecord[]; message: string; sending: boolean; canSend: boolean; canSubmit: boolean; onMessage: (value: string) => void; onSend: () => void }) {
  const { t } = useLanguage();
  return <div className="flex max-h-[720px] min-w-0 flex-col rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]"><div className="border-b border-gray-100 pb-4 dark:border-gray-800"><h2 className="font-semibold text-gray-800 dark:text-white/90">{t("emailComposeTitle")}</h2><p className="mt-1 text-xs text-gray-500">{t("emailPerSupplier")}</p></div><div className="space-y-4 pt-4"><div><label className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-300">{t("emailRecipientSupplier")}</label><div className="min-h-10 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">{selectedSuppliers.length ? selectedSuppliers.map((supplier) => supplier.ten_ncc).join(", ") : t("emailNoSelectedSuppliers")}</div></div><div><label className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-300">{t("emailSubjectLabel")}</label><div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">{SUBJECT_TEMPLATE}</div></div><textarea value={message} onChange={(event) => onMessage(event.target.value)} disabled={!canSend || sending} rows={17} placeholder={t("emailMessagePlaceholder")} className="min-h-[280px] w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none focus:border-brand-400 disabled:cursor-not-allowed disabled:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-white" /></div><div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-3 dark:border-gray-800"><span className="text-xs text-gray-400">{t("emailSelectedRecipientsCount", { count: selectedSuppliers.length })}</span><button type="button" onClick={onSend} disabled={!canSubmit} className="h-10 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50">{sending ? t("emailSending") : t("emailSendButton")}</button></div></div>;
}

function History({ logs, missing, loading, status, query, onRefresh, onStatus, onQuery }: { logs: EmailActivityLog[]; missing: SupplierRecord[]; loading: boolean; status: "all" | "sent" | "not sent"; query: string; onRefresh: () => void; onStatus: (value: "all" | "sent" | "not sent") => void; onQuery: (value: string) => void }) {
  const { t } = useLanguage();
  return <div className="flex min-h-[520px] min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"><div className="border-b border-gray-100 p-4 dark:border-gray-800"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-gray-800 dark:text-white/90">{t("emailHistory")}</h2><p className="mt-1 text-xs text-gray-500">{t("emailHistoryPerSupplier")}</p></div><button type="button" onClick={onRefresh} disabled={loading} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-300">{t("emailRefresh")}</button></div><div className="mt-3 grid grid-cols-2 gap-2"><select value={status} onChange={(event) => onStatus(event.target.value as typeof status)} className="h-9 rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-xs outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"><option value="all">{t("emailAllStatuses")}</option><option value="sent">{t("emailSentStatus")}</option><option value="not sent">{t("emailNotSentStatus")}</option></select><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={t("searchEmailLogs")} className="h-9 min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-xs outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white" /></div></div>{missing.length > 0 && <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10"><p className="text-xs font-semibold text-amber-900 dark:text-amber-200">{t("emailMissingSuccess", { count: missing.length })}</p><div className="mt-2 flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">{missing.map((supplier) => <span key={supplier.id_ncc} className="rounded-full bg-white px-2 py-1 text-[11px] text-amber-800 dark:bg-gray-900/50 dark:text-amber-200">{supplier.ten_ncc}</span>)}</div></div>}<div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">{loading ? <p className="p-4 text-xs text-gray-500">{t("emailLoadingHistory")}</p> : logs.length === 0 ? <p className="p-6 text-center text-xs text-gray-500">{t("emailNoHistory")}</p> : logs.map((log) => <article key={String(log.id)} className="border-b border-gray-100 p-3.5 last:border-b-0 dark:border-gray-800"><div className="flex items-start gap-2"><span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${log.status === "sent" ? "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300" : "bg-error-50 text-error-700 dark:bg-error-500/10 dark:text-error-300"}`}>{log.status === "sent" ? "OK" : "!"}</span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className="truncate text-xs font-semibold text-gray-800 dark:text-white/90">{log.supplierName || t("suppliers")}</p><time className="shrink-0 text-[10px] text-gray-400">{formatDate(log.sentAt)}</time></div><p className="mt-0.5 break-all text-[11px] text-gray-500 dark:text-gray-400">{log.supplierEmail || t("emailSupplierNoAddress")}</p><span className={`mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${log.status === "sent" ? "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300" : "bg-error-50 text-error-700 dark:bg-error-500/10 dark:text-error-300"}`}>{log.status === "sent" ? t("emailSentStatus") : t("emailNotSentStatus")}</span>{log.error && <p className="mt-1 text-[10px] text-error-600 dark:text-error-400">{log.error}</p>}</div></div></article>)}</div></div>;
}
