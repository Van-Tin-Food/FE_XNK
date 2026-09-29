"use client";

import { canPerformShipmentAction } from "@/config/shipmentActionPermissions";
import { useAuth } from "@/context/AuthContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import { getEmailDeliveryLogs, type EmailActivityLog } from "@/services/activityLogApi";
import { sendContactEmail } from "@/services/emailApi";
import { databaseEndpoints, listDatabaseRows } from "@/services/postgresShipmentApi";
import type { SupplierRecord } from "@/types/postgresShipment";
import PaginationControls from "@/components/common/PaginationControls";
import { paginateItems } from "@/utils/pagination";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const SUBJECT_TEMPLATE = "VTF/ {Tên nhà cung cấp} - Inquiry on pork items for CFR Vietnam";

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value || "-" : date.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function EmailPage() {
  const { user } = useAuth();
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
      setError(loadError instanceof Error ? loadError.message : "Không thể tải dữ liệu email");
    } finally {
      setLoading(false);
    }
  }, [canSend, canViewLogs]);

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
  const allVisibleSelected = filteredSuppliers.filter((supplier) => String(supplier.email || "").trim()).every((supplier) => selectedIds.includes(supplier.id_ncc)) && filteredSuppliers.some((supplier) => String(supplier.email || "").trim());
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
    const ids = filteredSuppliers.filter((supplier) => String(supplier.email || "").trim()).map((supplier) => supplier.id_ncc);
    setSelectedIds((current) => allVisibleSelected ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])]);
  };
  const toggleSupplier = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const send = async () => {
    const recipients = selectedSuppliers.map((supplier) => ({ email: String(supplier.email || "").trim(), name: supplier.ten_ncc })).filter((recipient) => recipient.email);
    if (!canSubmit || recipients.length === 0) return;
    setSending(true);
    try {
      const result = await sendContactEmail({ message: message.trim(), recipients });
      notify(result.failedCount ? `Đã gửi ${result.sentCount || 0}, lỗi ${result.failedCount} email` : `Đã gửi thành công ${result.sentCount || recipients.length} email`, result.failedCount ? "warning" : "success");
      setMessage("");
      setSelectedIds([]);
      await loadData();
    } catch (sendError) {
      notify(sendError instanceof Error ? sendError.message : "Không thể gửi email", "error");
    } finally {
      setSending(false);
    }
  };

  if (!canSend && !canViewLogs) return null;
  return <section className="space-y-5">
    <div><h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">Gửi email</h1><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Chọn nhà cung cấp, soạn nội dung và theo dõi lịch sử từng email.</p></div>
    {error && <div className="rounded-xl border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">{error}</div>}
    <div className="grid min-w-0 gap-5 xl:grid-cols-[250px_minmax(360px,0.9fr)_minmax(390px,1.1fr)]">
      <div className="min-w-0"><SupplierList suppliers={supplierPagination.items} query={supplierQuery} selectedIds={selectedIds} allSelected={allVisibleSelected} loading={loading} canSend={canSend} onQuery={(value) => { setSupplierQuery(value); setSupplierPage(1); }} onToggleAll={toggleAll} onToggle={toggleSupplier} /><PaginationControls page={supplierPagination.safePage} totalPages={supplierPagination.totalPages} pageSize={supplierPageSize} totalItems={supplierPagination.total} from={supplierPagination.from} to={supplierPagination.to} summaryKey="showingRecords" idPrefix="email-suppliers" onPageChange={setSupplierPage} onPageSizeChange={(value) => { setSupplierPageSize(value); setSupplierPage(1); }} /></div>
      <Compose selectedSuppliers={selectedSuppliers} message={message} sending={sending} canSend={canSend} canSubmit={canSubmit} onMessage={setMessage} onSend={() => void send()} />
      {canViewLogs ? <div className="min-w-0"><History logs={historyPagination.items} missing={missingSuppliers} loading={loading} status={status} query={historyQuery} onRefresh={() => void loadData()} onStatus={(value) => { setStatus(value); setHistoryPage(1); }} onQuery={(value) => { setHistoryQuery(value); setHistoryPage(1); }} /><PaginationControls page={historyPagination.safePage} totalPages={historyPagination.totalPages} pageSize={historyPageSize} totalItems={historyPagination.total} from={historyPagination.from} to={historyPagination.to} summaryKey="showingRecords" idPrefix="email-history" onPageChange={setHistoryPage} onPageSizeChange={(value) => { setHistoryPageSize(value); setHistoryPage(1); }} /></div> : <div className="rounded-2xl border border-dashed border-gray-300 p-6 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">Tài khoản này không có quyền xem lịch sử email.</div>}
    </div>
  </section>;
}

function SupplierList({ suppliers, query, selectedIds, allSelected, loading, canSend, onQuery, onToggleAll, onToggle }: { suppliers: SupplierRecord[]; query: string; selectedIds: string[]; allSelected: boolean; loading: boolean; canSend: boolean; onQuery: (value: string) => void; onToggleAll: () => void; onToggle: (id: string) => void }) {
  return <div className="flex min-h-[520px] min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"><div className="border-b border-gray-100 p-4 dark:border-gray-800"><h2 className="font-semibold text-gray-800 dark:text-white/90">Nhà cung cấp</h2><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Tìm nhà cung cấp" className="mt-3 h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-xs outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white" /></div><div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800"><label className="flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-gray-300"><input type="checkbox" checked={allSelected} onChange={onToggleAll} disabled={!canSend || loading} className="h-4 w-4 accent-brand-500" /> Chọn tất cả có email</label><p className="mt-1 text-[11px] text-gray-400">Đã chọn {selectedIds.length} nhà cung cấp</p></div><div className="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">{loading ? <p className="p-3 text-xs text-gray-500">Đang tải...</p> : suppliers.length === 0 ? <p className="p-3 text-xs text-gray-500">Không có nhà cung cấp.</p> : suppliers.map((supplier) => { const hasEmail = Boolean(String(supplier.email || "").trim()); return <label key={supplier.id_ncc} className={`flex items-start gap-2 rounded-lg px-2.5 py-2 ${selectedIds.includes(supplier.id_ncc) ? "bg-brand-50 dark:bg-brand-500/10" : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"}`}><input type="checkbox" checked={selectedIds.includes(supplier.id_ncc)} onChange={() => onToggle(supplier.id_ncc)} disabled={!canSend || !hasEmail} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500" /><span className="min-w-0"><span className="block truncate text-xs font-semibold text-gray-800 dark:text-white/90">{supplier.ten_ncc}</span><span className={`block truncate text-[11px] ${hasEmail ? "text-gray-500 dark:text-gray-400" : "text-amber-600"}`}>{hasEmail ? supplier.email : "Chưa có email"}</span></span></label>; })}</div></div>;
}

function Compose({ selectedSuppliers, message, sending, canSend, canSubmit, onMessage, onSend }: { selectedSuppliers: SupplierRecord[]; message: string; sending: boolean; canSend: boolean; canSubmit: boolean; onMessage: (value: string) => void; onSend: () => void }) {
  return <div className="flex min-h-[520px] min-w-0 flex-col rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]"><div className="border-b border-gray-100 pb-4 dark:border-gray-800"><h2 className="font-semibold text-gray-800 dark:text-white/90">Soạn email</h2><p className="mt-1 text-xs text-gray-500">Mỗi nhà cung cấp nhận một email riêng.</p></div><div className="space-y-4 pt-4"><div><label className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-300">Người nhận</label><div className="min-h-10 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">{selectedSuppliers.length ? selectedSuppliers.map((supplier) => supplier.ten_ncc).join(", ") : "Chưa chọn nhà cung cấp"}</div></div><div><label className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-300">Tiêu đề</label><div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">{SUBJECT_TEMPLATE}</div></div><textarea value={message} onChange={(event) => onMessage(event.target.value)} disabled={!canSend || sending} rows={17} placeholder="Nhập nội dung email..." className="min-h-[280px] w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none focus:border-brand-400 disabled:cursor-not-allowed disabled:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-white" /></div><div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-3 dark:border-gray-800"><span className="text-xs text-gray-400">{selectedSuppliers.length} người nhận</span><button type="button" onClick={onSend} disabled={!canSubmit} className="h-10 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50">{sending ? "Đang gửi..." : "Gửi email"}</button></div></div>;
}

function History({ logs, missing, loading, status, query, onRefresh, onStatus, onQuery }: { logs: EmailActivityLog[]; missing: SupplierRecord[]; loading: boolean; status: "all" | "sent" | "not sent"; query: string; onRefresh: () => void; onStatus: (value: "all" | "sent" | "not sent") => void; onQuery: (value: string) => void }) {
  return <div className="flex min-h-[520px] min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"><div className="border-b border-gray-100 p-4 dark:border-gray-800"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-gray-800 dark:text-white/90">Lịch sử email</h2><p className="mt-1 text-xs text-gray-500">Mỗi dòng là một nhà cung cấp</p></div><button type="button" onClick={onRefresh} disabled={loading} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-300">Làm mới</button></div><div className="mt-3 grid grid-cols-2 gap-2"><select value={status} onChange={(event) => onStatus(event.target.value as typeof status)} className="h-9 rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-xs outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"><option value="all">Tất cả</option><option value="sent">Đã gửi</option><option value="not sent">Chưa gửi</option></select><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Tìm email" className="h-9 min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-xs outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white" /></div></div>{missing.length > 0 && <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10"><p className="text-xs font-semibold text-amber-900 dark:text-amber-200">Chưa từng gửi thành công: {missing.length}</p><div className="mt-2 flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">{missing.map((supplier) => <span key={supplier.id_ncc} className="rounded-full bg-white px-2 py-1 text-[11px] text-amber-800 dark:bg-gray-900/50 dark:text-amber-200">{supplier.ten_ncc}</span>)}</div></div>}<div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">{loading ? <p className="p-4 text-xs text-gray-500">Đang tải lịch sử...</p> : logs.length === 0 ? <p className="p-6 text-center text-xs text-gray-500">Chưa có lịch sử email.</p> : logs.map((log) => <article key={String(log.id)} className="border-b border-gray-100 p-3.5 last:border-b-0 dark:border-gray-800"><div className="flex items-start gap-2"><span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${log.status === "sent" ? "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300" : "bg-error-50 text-error-700 dark:bg-error-500/10 dark:text-error-300"}`}>{log.status === "sent" ? "✓" : "!"}</span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className="truncate text-xs font-semibold text-gray-800 dark:text-white/90">{log.supplierName || "Nhà cung cấp"}</p><time className="shrink-0 text-[10px] text-gray-400">{formatDate(log.sentAt)}</time></div><p className="mt-0.5 break-all text-[11px] text-gray-500 dark:text-gray-400">{log.supplierEmail || "Không có email"}</p><span className={`mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${log.status === "sent" ? "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300" : "bg-error-50 text-error-700 dark:bg-error-500/10 dark:text-error-300"}`}>{log.status === "sent" ? "Đã gửi" : "Chưa gửi"}</span>{log.error && <p className="mt-1 text-[10px] text-error-600 dark:text-error-400">{log.error}</p>}</div></div></article>)}</div></div>;
}
