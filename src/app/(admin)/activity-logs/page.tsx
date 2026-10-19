"use client";

import SearchSuggestions from "@/components/common/SearchSuggestions";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import {
  getActivityLogs,
  getEmailDeliveryLogs,
  type ActivityActor,
  type ActivityLog,
  type EmailActivityLog,
} from "@/services/activityLogApi";
import { activityLogSummary } from "@/utils/activityLogSummary";
import { activityDetailLines, activityLocationParts } from "@/utils/activityLogFormat";
import { paginateItems } from "@/utils/pagination";
import PaginationControls from "@/components/common/PaginationControls";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const DEFAULT_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;
const ACTION_LABEL_KEYS: Record<string, string> = {
  LOGIN: "logLogin",
  LOGIN_GOOGLE: "logLoginGoogle",
  LOGIN_FAILED: "logLoginFailed",
  LOGOUT: "logLogout",
  CREATE_SHIPMENT: "logCreateShipment",
  UPLOAD_DOCUMENT: "logUploadDocument",
  UPLOAD_OCR_DOCUMENT: "logUploadOcrDocument",
  PASS_DOCUMENT: "logPassDocument",
  ARCHIVE_DOCUMENTS: "logArchiveDocuments",
  EDIT_RETURN_ITEM: "logEditContainerTransport",
  EDIT_SHIPMENT_DETAILS: "logEditShipmentDetails",
  CANCEL_SHIPMENT: "logCancelShipment",
  EXPORT_EXCEL: "logExportExcel",
  AI_CHAT: "logAiChat",
  CREATE_MASTER_DATA: "logCreateMasterData",
  UPDATE_MASTER_DATA: "logUpdateMasterData",
  REGISTER_USER: "logRegisterUser",
  UPDATE_USER_PERMISSION: "logUpdatePermission",
  UPDATE_USER_PASSWORD: "logResetPassword",
  SEND_EMAIL: "logSendEmail",
  DOCUMENT_SYNC_SCAN: "logDocumentSyncScan",
  DOCUMENT_SYNC_ACCEPT: "logDocumentSyncAccept",
  DOCUMENT_SYNC_RENAME: "logDocumentSyncRename",
  DOCUMENT_SYNC_RESTORE: "logDocumentSyncRestore",
  PAYMENT_REQUEST_CREATE: "logPaymentCreate",
  PAYMENT_REQUEST_UPDATE: "logPaymentUpdate",
  PAYMENT_REQUEST_LINK: "logPaymentLink",
  PAYMENT_REQUEST_NOTIFY: "logPaymentNotify",
  PAYMENT_REQUEST_APPROVE: "logPaymentApprove",
  PAYMENT_REQUEST_REJECT: "logPaymentReject",
  PAYMENT_REQUEST_COMPLETE: "logPaymentComplete",
  PAYMENT_REQUEST_SEND: "logPaymentSend",
  PAYMENT_REQUEST_UPLOAD: "logPaymentUpload",
  PAYMENT_REQUEST_DOCUMENT_REMOVE: "logPaymentDocRemove",
  PAYMENT_COST_UPDATE: "logPaymentCostUpdate",
  PAYMENT_COST_DELETE: "logPaymentCostDelete",
  PAYMENT_REQUEST_CANCEL: "logPaymentCancel",
};
const ROLES = ["admin", "it", "logistic", "van_chuyen", "ke_toan"];
const SELECT_CLASS = "h-10 min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200";

function actionLabel(action: string, t: (key: string) => string): string {
  const key = ACTION_LABEL_KEYS[action.trim().toUpperCase()];
  return key ? t(key) : action || t("unknown");
}

function parseLogDate(value: string): Date {
  const raw = String(value || "").trim();
  // PostgreSQL timestamp without time zone is a wall-clock value. Keep it in local time.
  const postgresMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/);
  if (postgresMatch) {
    const milliseconds = (postgresMatch[3] || "").slice(0, 3).padEnd(3, "0");
    return new Date(`${postgresMatch[1]}T${postgresMatch[2]}.${milliseconds}`);
  }
  return new Date(raw);
}

function dateTime(value: string, language: "vi" | "en", withSeconds = false): string {
  const date = parseLogDate(value);
  if (Number.isNaN(date.getTime())) return value || "—";
  return date.toLocaleString(language === "en" ? "en-GB" : "vi-VN", {
    hour: "2-digit", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}), day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function actor(log: ActivityLog): string {
  return log.userName || log.username || (log.userId ? `User #${log.userId}` : "—");
}

function localDate(value: string): string {
  const date = parseLogDate(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function DeviceIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

/** Một dòng nhật ký thao tác: ai - làm gì - ở đâu (màn hình, thiết bị, IP) - khi nào, mở rộng xem từng thay đổi. */
function ActivityRow({ log }: { log: ActivityLog }) {
  const { language, t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const failed = log.status === "failed";
  const summary = activityLogSummary(log.action, log.detail, log.location, language);
  const where = activityLocationParts(log.location, t).join(" › ");
  const device = log.device || "";
  const lines = activityDetailLines(log.detail);
  // Chỉ cần nút "Xem chi tiết" khi nội dung đầy đủ khác dòng tóm tắt.
  const hasMore = lines.length > 1 || (lines.length === 1 && (lines[0].text || "") !== summary);

  return (
    <article className="px-4 py-4 transition-colors hover:bg-gray-50/60 dark:hover:bg-white/[0.02] sm:px-5">
      <div className="flex gap-3">
        <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${failed ? "bg-error-50 text-error-700 dark:bg-error-500/10 dark:text-error-300" : "bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"}`}>
          {actor(log).charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-gray-800 dark:text-white/90">{actor(log)}</span>
            {log.username && log.username !== log.userName && <span className="text-xs text-gray-500 dark:text-gray-400">@{log.username}</span>}
            {log.role && <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-white/[0.06] dark:text-gray-300">{log.role}</span>}
            <time dateTime={log.createdAt} title={dateTime(log.createdAt, language, true)} className="w-full text-xs text-gray-500 sm:ml-auto sm:w-auto">{dateTime(log.createdAt, language, true)}</time>
          </div>

          <div className="mt-1.5 flex flex-wrap items-start gap-x-2 gap-y-1">
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${failed ? "bg-error-50 text-error-700 dark:bg-error-500/10 dark:text-error-300" : "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"}`}>
              {actionLabel(log.action, t)}{failed ? ` · ${t("activityFailed")}` : ""}
            </span>
            {summary && <span className="min-w-0 break-words text-sm font-medium text-gray-700 dark:text-gray-200">{summary}</span>}
          </div>

          <div className="mt-1.5 flex flex-col gap-1 text-xs text-gray-500 dark:text-gray-400 sm:flex-row sm:flex-wrap sm:gap-x-4">
            {where && (
              <span className="flex min-w-0 items-center gap-1" title={log.location}>
                <PinIcon />
                <span className="sr-only">{t("activityWhere")}:</span>
                <span className="break-words">{where}</span>
              </span>
            )}
            {(device || log.ipAddress) && (
              <span className="flex min-w-0 items-center gap-1">
                <DeviceIcon />
                <span className="sr-only">{t("activityDevice")}:</span>
                <span className="break-all">{[device, log.ipAddress ? `${t("activityIp")} ${log.ipAddress}` : ""].filter(Boolean).join(" · ")}</span>
              </span>
            )}
          </div>

          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400"
            >
              {expanded ? t("activityHideDetail") : t("activityShowDetail")}
            </button>
          )}
          {expanded && (
            <ul className="mt-2 space-y-1.5 rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm dark:border-gray-800 dark:bg-white/[0.03]">
              {lines.map((line, index) => (
                <li key={index} className="break-words">
                  {line.field !== undefined ? (
                    <span className="flex flex-col gap-0.5 sm:flex-row sm:flex-wrap sm:gap-x-2">
                      <span className="font-medium text-gray-700 dark:text-gray-200">{line.field}:</span>
                      <span className="flex flex-wrap items-center gap-x-1.5">
                        <span className="text-gray-400 line-through decoration-gray-300 dark:text-gray-500">{line.before || "—"}</span>
                        <span aria-hidden="true" className="text-gray-400">→</span>
                        <span className="font-medium text-success-700 dark:text-success-400">{line.after || "—"}</span>
                      </span>
                    </span>
                  ) : (
                    <span className="text-gray-600 dark:text-gray-300">{line.text}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </article>
  );
}

export default function ActivityLogsPage() {
  const { can } = useAuth();
  const { language, t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canViewLogs = can("activityLogs");
  // Tab (Lịch sử thao tác / Nhật kí email) lấy trực tiếp từ URL (?tab=). Sidebar là nơi duy nhất
  // chuyển mục — vào mục nào hiện đúng mục đó, không còn state riêng nên không thể lệch tab.
  const activeTab: "activity" | "email" = searchParams.get("tab") === "email" ? "email" : "activity";

  // ---------- Lịch sử thao tác: lọc + phân trang phía server ----------
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [total, setTotal] = useState(0);
  const [actors, setActors] = useState<ActivityActor[]>([]);
  const [activityUser, setActivityUser] = useState("all");
  const [activityAction, setActivityAction] = useState("all");
  const [activityRole, setActivityRole] = useState("all");
  const [activityStatus, setActivityStatus] = useState<"all" | "success" | "failed">("all");
  const [activityDateFrom, setActivityDateFrom] = useState("");
  const [activityDateTo, setActivityDateTo] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  // ---------- Nhật ký email: tải một lần, lọc phía client ----------
  const [emailLogs, setEmailLogs] = useState<EmailActivityLog[]>([]);
  const [emailLoaded, setEmailLoaded] = useState(false);
  const [emailStatus, setEmailStatus] = useState<"all" | "sent" | "not sent">("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    if (!canViewLogs) router.replace("/");
  }, [canViewLogs, router]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!canViewLogs || activeTab !== "activity") return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      getActivityLogs({
        limit: pageSize,
        offset: (page - 1) * pageSize,
        userId: activityUser === "all" ? undefined : Number(activityUser),
        action: activityAction === "all" ? undefined : activityAction,
        role: activityRole === "all" ? undefined : activityRole,
        status: activityStatus === "all" ? undefined : activityStatus,
        from: activityDateFrom || undefined,
        to: activityDateTo || undefined,
        q: debouncedQuery || undefined,
      }, controller.signal)
        .then((result) => {
          setLogs(result.logs);
          setTotal(result.total);
          if (result.actors.length) setActors(result.actors);
          // Trang hiện tại vượt quá số trang (vd vừa đổi bộ lọc): quay về trang cuối còn dữ liệu.
          const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
          if (page > lastPage) setPage(lastPage);
        })
        .catch((loadError) => {
          if (loadError instanceof DOMException && loadError.name === "AbortError") return;
          setError(loadError instanceof Error ? loadError.message : t("activityLogLoadError"));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeTab, activityAction, activityDateFrom, activityDateTo, activityRole, activityStatus, activityUser, canViewLogs, debouncedQuery, page, pageSize, reloadKey, t]);

  const loadEmailLogs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setEmailLogs(await getEmailDeliveryLogs());
      setEmailLoaded(true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("activityLogLoadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!canViewLogs || activeTab !== "email" || emailLoaded) return;
    const timer = window.setTimeout(() => { void loadEmailLogs(); }, 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, canViewLogs, emailLoaded, loadEmailLogs]);

  const refresh = () => {
    if (activeTab === "email") void loadEmailLogs();
    else setReloadKey((value) => value + 1);
  };

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
  const emailPage = paginateItems(filteredEmailLogs, page, pageSize);

  const activityTotalPages = Math.max(1, Math.ceil(total / pageSize));
  const activityPage = Math.min(page, activityTotalPages);
  const visibleCount = activeTab === "activity" ? total : filteredEmailLogs.length;
  const currentPage = activeTab === "activity" ? activityPage : emailPage.safePage;
  const totalPages = activeTab === "activity" ? activityTotalPages : emailPage.totalPages;
  const from = activeTab === "activity" ? (total === 0 ? 0 : (activityPage - 1) * pageSize + 1) : emailPage.from;
  const to = activeTab === "activity" ? Math.min(total, activityPage * pageSize) : emailPage.to;
  const isEmpty = activeTab === "activity" ? logs.length === 0 : emailPage.items.length === 0;

  const activitySuggestions = useMemo(() => Array.from(new Set([
    ...actors.flatMap((item) => [item.name, item.username]),
    ...logs.flatMap((log) => [actionLabel(log.action, t), activityLogSummary(log.action, log.detail, log.location, language)]),
  ].filter((value): value is string => Boolean(value)))), [actors, language, logs, t]);

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
    setActivityUser("all");
    setActivityAction("all");
    setActivityRole("all");
    setActivityStatus("all");
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
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{activeTab === "activity" ? t("activityLogsDetailedDescription") : t("activityLogsDescription")}</p>
        </div>
        <button type="button" onClick={refresh} disabled={loading} className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">{loading ? t("loading") : t("refreshData")}</button>
      </div>
      {/* Bỏ tab bar: mục nào trên sidebar được click thì hiện đúng mục đó — không cần chuyển tab trên trang */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 dark:border-gray-800 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-gray-800 dark:text-white/90">{activeTab === "activity" ? t("operationHistory") : t("emailHistory")}</h2>
              <p className="mt-0.5 text-xs text-gray-500">{t("recordCount", { count: visibleCount })}</p>
            </div>
            <SearchSuggestions
              value={query}
              onChange={(value) => { setQuery(value); setPage(1); }}
              suggestions={activeTab === "activity"
                ? activitySuggestions
                : emailLogs.flatMap((log) => [log.supplierName, log.supplierEmail, log.subject, log.userName, log.username]).filter((value): value is string => Boolean(value))}
              placeholder={activeTab === "activity" ? t("searchActivityLogs") : t("searchEmailLogs")}
              ariaLabel={activeTab === "activity" ? t("searchActivityLogs") : t("searchEmailLogs")}
              className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-800 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white sm:max-w-sm"
            />
          </div>
          {activeTab === "email" && <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">{(["all", "sent", "not sent"] as const).map((status) => <button key={status} type="button" onClick={() => { setEmailStatus(status); setPage(1); }} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${emailStatus === status ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300" : "border-gray-200 text-gray-500 dark:border-gray-700"}`}>{status === "all" ? t("allStatuses") : status === "sent" ? t("emailSentStatus") : t("emailNotSentStatus")}</button>)}</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
              <select value={supplierFilter} onChange={(event) => { setSupplierFilter(event.target.value); setPage(1); }} aria-label={t("emailSupplierFilter")} className={SELECT_CLASS}>
                <option value="all">{t("allSuppliers")}</option>
                {suppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
              </select>
              <input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} aria-label={t("emailDateFrom")} title={t("emailDateFrom")} className={SELECT_CLASS} />
              <input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} aria-label={t("emailDateTo")} title={t("emailDateTo")} className={SELECT_CLASS} />
              <button type="button" onClick={clearEmailFilters} className="h-10 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.04]">{t("clearFilters")}</button>
            </div>
          </div>}
          {activeTab === "activity" && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-[repeat(4,minmax(0,1fr))_auto_auto_auto]">
            <select value={activityUser} onChange={(event) => { setActivityUser(event.target.value); setPage(1); }} aria-label={t("activityUserFilter")} className={SELECT_CLASS}>
              <option value="all">{t("allUsers")}</option>
              {actors.map((item) => <option key={item.id} value={String(item.id)}>{item.name || item.username}{item.name && item.username ? ` (${item.username})` : ""}</option>)}
            </select>
            <select value={activityAction} onChange={(event) => { setActivityAction(event.target.value); setPage(1); }} aria-label={t("activityActionFilter")} className={SELECT_CLASS}>
              <option value="all">{t("allActions")}</option>
              {Object.keys(ACTION_LABEL_KEYS).filter((action) => action !== "SEND_EMAIL").map((action) => <option key={action} value={action}>{actionLabel(action, t)}</option>)}
            </select>
            <select value={activityRole} onChange={(event) => { setActivityRole(event.target.value); setPage(1); }} aria-label={t("activityRoleFilter")} className={SELECT_CLASS}>
              <option value="all">{t("allRoles")}</option>
              {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
            <select value={activityStatus} onChange={(event) => { setActivityStatus(event.target.value as "all" | "success" | "failed"); setPage(1); }} aria-label={t("activityStatusFilter")} className={SELECT_CLASS}>
              <option value="all">{t("allResults")}</option>
              <option value="success">{t("activitySucceeded")}</option>
              <option value="failed">{t("activityFailed")}</option>
            </select>
            <input type="date" value={activityDateFrom} onChange={(event) => { setActivityDateFrom(event.target.value); setPage(1); }} aria-label={t("dateFrom")} title={t("dateFrom")} className={SELECT_CLASS} />
            <input type="date" value={activityDateTo} onChange={(event) => { setActivityDateTo(event.target.value); setPage(1); }} aria-label={t("dateTo")} title={t("dateTo")} className={SELECT_CLASS} />
            <button type="button" onClick={clearActivityFilters} className="h-10 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.04]">{t("clearFilters")}</button>
          </div>}
        </div>
        {error ? (
          <div className="m-4 rounded-xl border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400">{error}</div>
        ) : loading && isEmpty ? (
          <div className="flex min-h-52 items-center justify-center"><div className="h-9 w-9 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>
        ) : isEmpty ? (
          <div className="flex min-h-52 items-center justify-center px-4 text-center text-sm text-gray-500">{activeTab === "email" ? t("noEmailLogs") : t("noActivityLogs")}</div>
        ) : activeTab === "activity" ? (
          <div className={`divide-y divide-gray-100 transition-opacity dark:divide-gray-800 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
            {logs.map((log) => <ActivityRow key={log.id} log={log} />)}
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {emailPage.items.map((log, index) => {
              const notSent = log.status !== "sent";
              const detail = `${log.supplierName || t("emailRecipient")} <${log.supplierEmail || "-"}> - ${log.subject || "-"}${log.error ? ` - ${log.error}` : ""}`;
              const sender = log.userName || log.username || (log.userId ? `User #${log.userId}` : "—");
              return (
                <article key={`email-${String(log.id)}-${index}`} className="px-4 py-4 transition-colors hover:bg-gray-50/60 dark:hover:bg-white/[0.02] sm:px-5">
                  <div className="flex gap-3">
                    <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${notSent ? "bg-error-50 text-error-700 dark:bg-error-500/10 dark:text-error-300" : "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300"}`}>{notSent ? "!" : "✓"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold text-gray-800 dark:text-white/90">{sender}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${notSent ? "bg-error-50 text-error-700 dark:bg-error-500/10 dark:text-error-300" : "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300"}`}>{notSent ? t("emailNotSentStatus") : t("emailSentStatus")}</span>
                        <time dateTime={log.sentAt} className="text-xs text-gray-500 sm:ml-auto">{dateTime(log.sentAt, language)}</time>
                      </div>
                      <p className="mt-1 break-words text-sm leading-6 text-gray-600 dark:text-gray-300">{detail}</p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {!error && visibleCount > 0 && <PaginationControls page={currentPage} totalPages={totalPages} pageSize={pageSize} totalItems={visibleCount} from={from} to={to} summaryKey="showingRecords" onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />}
      </div>
    </section>
  );
}
