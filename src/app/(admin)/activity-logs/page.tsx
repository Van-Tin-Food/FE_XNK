"use client";

import { canPerformShipmentAction } from "@/config/shipmentActionPermissions";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { getActivityLogs, getEmailDeliveryLogs, type ActivityLog, type EmailActivityLog } from "@/services/activityLogApi";
import { activityLogSummary } from "@/utils/activityLogSummary";
import { paginateItems } from "@/utils/pagination";
import PaginationControls from "@/components/common/PaginationControls";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const DEFAULT_PAGE_SIZE = 15;
const ACTION_LABEL_KEYS: Record<string, string> = {
  CREATE_SHIPMENT: "logCreateShipment",
  UPLOAD_DOCUMENT: "logUploadDocument",
  UPLOAD_OCR_DOCUMENT: "logUploadOcrDocument",
  PASS_DOCUMENT: "logPassDocument",
  ARCHIVE_DOCUMENTS: "logArchiveDocuments",
  EDIT_RETURN_ITEM: "logEditContainerTransport",
  EDIT_SHIPMENT_DETAILS: "logEditShipmentDetails",
  CANCEL_SHIPMENT: "logCancelShipment",
  CREATE_MASTER_DATA: "logCreateMasterData",
  UPDATE_MASTER_DATA: "logUpdateMasterData",
  REGISTER_USER: "logRegisterUser",
  UPDATE_USER_PERMISSION: "logUpdatePermission",
  UPDATE_USER_PASSWORD: "logResetPassword",
  SEND_EMAIL: "logSendEmail",
};

function actionLabel(action: string, t: (key: string) => string): string {
  const key = ACTION_LABEL_KEYS[action.trim().toUpperCase()];
  return key ? t(key) : action || t("unknown");
}

function dateTime(value: string, language: "vi" | "en"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "—";
  return date.toLocaleString(language === "en" ? "en-GB" : "vi-VN", {
    hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function actor(log: ActivityLog): string {
  return log.userName || log.username || (log.userId ? `User #${log.userId}` : "—");
}

function localDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function ActivityLogsPage() {
  const { user } = useAuth();
  const { language, t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canViewLogs = canPerformShipmentAction(user, "viewActivityLogs");
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [emailLogs, setEmailLogs] = useState<EmailActivityLog[]>([]);
  // Tab (Lịch sử thao tác / Nhật kí email) lấy trực tiếp từ URL (?tab=). Sidebar là nơi duy nhất
  // chuyển mục — vào mục nào hiện đúng mục đó, không còn state riêng nên không thể lệch tab.
  const activeTab: "activity" | "email" = searchParams.get("tab") === "email" ? "email" : "activity";
  const [activityAction, setActivityAction] = useState("all");
  const [activityRole, setActivityRole] = useState("all");
  const [activitySession, setActivitySession] = useState("all");
  const [activityDateFrom, setActivityDateFrom] = useState("");
  const [activityDateTo, setActivityDateTo] = useState("");
  const [emailStatus, setEmailStatus] = useState<"all" | "sent" | "not sent">("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const loadLogs = useCallback(async () => {
    if (!canViewLogs) return;
    setLoading(true);
    setError("");
    try {
      const [activityLogs, deliveryLogs] = await Promise.all([getActivityLogs(), getEmailDeliveryLogs()]);
      setLogs(activityLogs);
      setEmailLogs(deliveryLogs);
    }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : t("activityLogLoadError")); }
    finally { setLoading(false); }
  }, [canViewLogs, t]);

  useEffect(() => {
    if (!canViewLogs) { router.replace("/"); return; }
    void loadLogs();
  }, [canViewLogs, loadLogs, router]);

  const filteredLogs = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("vi");
    return logs.filter((log) => {
      const createdDate = localDate(log.createdAt);
      const matchesAction = activityAction === "all" || log.action.trim().toUpperCase() === activityAction;
      const matchesRole = activityRole === "all" || log.role === activityRole;
      const matchesSession = activitySession === "all" || log.session === activitySession;
      const matchesFrom = !activityDateFrom || createdDate >= activityDateFrom;
      const matchesTo = !activityDateTo || createdDate <= activityDateTo;
      const matchesQuery = !keyword || [actor(log), log.role, log.session, log.action, actionLabel(log.action, t), activityLogSummary(log.action, log.detail, log.location, language), log.location, log.detail]
        .join(" ").toLocaleLowerCase("vi").includes(keyword);
      return matchesAction && matchesRole && matchesSession && matchesFrom && matchesTo && matchesQuery;
    });
  }, [activityAction, activityDateFrom, activityDateTo, activityRole, activitySession, logs, query, t, language]);

  const filteredEmailLogs = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("vi");
    return emailLogs.filter((log) => {
      const matchesStatus = emailStatus === "all" || log.status === emailStatus;
      const matchesSupplier = supplierFilter === "all" || log.supplierName === supplierFilter;
      const sentDate = localDate(log.sentAt);
      const matchesFrom = !dateFrom || sentDate >= dateFrom;
      const matchesTo = !dateTo || sentDate <= dateTo;
      const haystack = [log.supplierName, log.supplierEmail, log.subject, log.error, log.userName, log.username].join(" ").toLocaleLowerCase("vi");
      return matchesStatus && matchesSupplier && matchesFrom && matchesTo && (!keyword || haystack.includes(keyword));
    });
  }, [emailLogs, query, emailStatus, supplierFilter, dateFrom, dateTo]);

  const suppliers = useMemo(() => Array.from(new Set(emailLogs.map((log) => log.supplierName).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [emailLogs]);
  const activityActions = useMemo(() => Array.from(new Set(logs.map((log) => log.action.trim().toUpperCase()).filter(Boolean))).sort(), [logs]);
  const activityRoles = useMemo(() => Array.from(new Set(logs.map((log) => log.role).filter(Boolean))).sort(), [logs]);
  const activitySessions = useMemo(() => Array.from(new Set(logs.map((log) => log.session).filter(Boolean))).sort(), [logs]);
  const activityPage = paginateItems(filteredLogs, page, pageSize);
  const emailDisplayLogs = filteredEmailLogs.map((log, index): ActivityLog => ({
    id: `email-${String(log.id)}-${index}`,
    userId: log.userId,
    userName: log.userName,
    username: log.username,
    action: "SEND_EMAIL",
    location: "Email",
    detail: `${log.supplierName || t("emailRecipient")} <${log.supplierEmail || "-"}> - ${log.subject || "-"} - ${log.status === "sent" ? "sent" : "not sent"}${log.error ? `: ${log.error}` : ""}`,
    createdAt: log.sentAt,
  }));
  const emailPage = paginateItems(emailDisplayLogs, page, pageSize);
  const activePage = activeTab === "activity" ? activityPage : emailPage;
  const visibleCount = activeTab === "activity" ? filteredLogs.length : filteredEmailLogs.length;
  const displayedLogs = activePage.items;
  const currentPage = activePage.safePage;
  const totalPages = activePage.totalPages;
  const from = activePage.from;
  const to = activePage.to;

  const clearEmailFilters = () => {
    setQuery("");
    setEmailStatus("all");
    setSupplierFilter("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const clearActivityFilters = () => {
    setQuery("");
    setActivityAction("all");
    setActivityRole("all");
    setActivitySession("all");
    setActivityDateFrom("");
    setActivityDateTo("");
    setPage(1);
  };

  if (!canViewLogs) return <div className="flex min-h-[50vh] items-center justify-center"><div className="h-9 w-9 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>;

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">{t("activityLogs")}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("activityLogsDescription")}</p>
        </div>
        <button type="button" onClick={() => void loadLogs()} disabled={loading} className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">{loading ? t("loading") : t("refreshData")}</button>
      </div>
      {/* Bỏ tab bar: mục nào trên sidebar được click thì hiện đúng mục đó — không cần chuyển tab trên trang */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 dark:border-gray-800 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-gray-800 dark:text-white/90">{activeTab === "activity" ? t("operationHistory") : t("emailHistory")}</h2>
            <p className="mt-0.5 text-xs text-gray-500">{t("recordCount", { count: visibleCount })}</p>
          </div>
          <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={activeTab === "activity" ? t("searchActivityLogs") : t("searchEmailLogs")} aria-label={activeTab === "activity" ? t("searchActivityLogs") : t("searchEmailLogs")} className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-800 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white sm:max-w-sm" />
          </div>
          {activeTab === "email" && <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">{(["all", "sent", "not sent"] as const).map((status) => <button key={status} type="button" onClick={() => { setEmailStatus(status); setPage(1); }} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${emailStatus === status ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300" : "border-gray-200 text-gray-500 dark:border-gray-700"}`}>{status === "all" ? t("allStatuses") : status === "sent" ? t("emailSentStatus") : t("emailNotSentStatus")}</button>)}</div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
              <select value={supplierFilter} onChange={(event) => { setSupplierFilter(event.target.value); setPage(1); }} aria-label={t("emailSupplierFilter")} className="h-10 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
                <option value="all">{t("allSuppliers")}</option>
                {suppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
              </select>
              <input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} aria-label={t("emailDateFrom")} title={t("emailDateFrom")} className="h-10 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200" />
              <input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} aria-label={t("emailDateTo")} title={t("emailDateTo")} className="h-10 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200" />
              <button type="button" onClick={clearEmailFilters} className="h-10 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.04]">{t("clearFilters")}</button>
            </div>
          </div>}
          {activeTab === "activity" && <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto]">
            <select value={activityAction} onChange={(event) => { setActivityAction(event.target.value); setPage(1); }} aria-label={t("activityActionFilter")} className="h-10 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
              <option value="all">{t("allActions")}</option>
              {activityActions.map((action) => <option key={action} value={action}>{actionLabel(action, t)}</option>)}
            </select>
            <select value={activityRole} onChange={(event) => { setActivityRole(event.target.value); setPage(1); }} aria-label={t("activityRoleFilter")} className="h-10 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
              <option value="all">{t("allRoles")}</option>
              {activityRoles.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
            <select value={activitySession} onChange={(event) => { setActivitySession(event.target.value); setPage(1); }} aria-label={t("activitySessionFilter")} className="h-10 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
              <option value="all">{t("allSessions")}</option>
              {activitySessions.map((session) => <option key={session} value={session}>{session}</option>)}
            </select>
            <input type="date" value={activityDateFrom} onChange={(event) => { setActivityDateFrom(event.target.value); setPage(1); }} aria-label={t("dateFrom")} title={t("dateFrom")} className="h-10 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200" />
            <input type="date" value={activityDateTo} onChange={(event) => { setActivityDateTo(event.target.value); setPage(1); }} aria-label={t("dateTo")} title={t("dateTo")} className="h-10 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200" />
            <button type="button" onClick={clearActivityFilters} className="h-10 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.04]">{t("clearFilters")}</button>
          </div>}
        </div>
        {error ? (
          <div className="m-4 rounded-xl border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400">{error}</div>
        ) : loading ? (
          <div className="flex min-h-52 items-center justify-center"><div className="h-9 w-9 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>
        ) : activePage.items.length === 0 ? (
          <div className="flex min-h-52 items-center justify-center px-4 text-center text-sm text-gray-500">{activeTab === "email" ? t("noEmailLogs") : t("noActivityLogs")}</div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {displayedLogs.map((log, index) => {
              const summary = activityLogSummary(log.action, log.detail, log.location, language);
              const visibleDetail = log.detail || summary;
              const emailNotSent = activeTab === "email" && log.detail.includes("not sent");
              return (
                <article key={log.id || `log-${currentPage}-${index}`} className="px-4 py-4 transition-colors hover:bg-gray-50/60 dark:hover:bg-white/[0.02] sm:px-5">
                  <div className="flex gap-3">
                    <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${activeTab === "email" ? (emailNotSent ? "bg-error-50 text-error-700 dark:bg-error-500/10 dark:text-error-300" : "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300") : "bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"}`}>{activeTab === "email" ? (emailNotSent ? "!" : "✓") : actor(log).charAt(0).toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold text-gray-800 dark:text-white/90">{actor(log)}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${activeTab === "email" ? (emailNotSent ? "bg-error-50 text-error-700 dark:bg-error-500/10 dark:text-error-300" : "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300") : "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"}`}>{activeTab === "email" ? (emailNotSent ? t("emailNotSentStatus") : t("emailSentStatus")) : actionLabel(log.action, t)}</span>
                        <time dateTime={log.createdAt} className="text-xs text-gray-500 sm:ml-auto">{dateTime(log.createdAt, language)}</time>
                      </div>
                      {visibleDetail && <p className="mt-1 break-words text-sm leading-6 text-gray-600 dark:text-gray-300">{visibleDetail}</p>}
                      {(log.role || log.session) && <p className="mt-1 text-xs text-gray-400">{[log.role, log.session].filter(Boolean).join(" · ")}</p>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {!loading && !error && visibleCount > 0 && <PaginationControls page={currentPage} totalPages={totalPages} pageSize={pageSize} totalItems={visibleCount} from={from} to={to} summaryKey="showingRecords" onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />}
      </div>
    </section>
  );
}
