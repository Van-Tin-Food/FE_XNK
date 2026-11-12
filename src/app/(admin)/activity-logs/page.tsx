"use client";

import SearchSuggestions from "@/components/common/SearchSuggestions";
import MobileFilterToggle from "@/components/common/MobileFilterToggle";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { RBAC_ROLES } from "@/config/shipmentActionPermissions";
import {
  getActivityLogBatch,
  getEmailDeliveryLogs,
  type ActivityActor,
  type ActivityLog,
  type ActivityLogFilters,
  type EmailActivityLog,
} from "@/services/activityLogApi";
import { activityLogSummary } from "@/utils/activityLogSummary";
import { activityDetailLines, activityLocationParts } from "@/utils/activityLogFormat";
import {
  ACTIVITY_GROUPS,
  ACTIVITY_PERIODS,
  activityActionLabel,
  activityActionQuery,
  activityGroupOf,
  activityPeriodRange,
  dateKey,
  groupActivityByDay,
  parseLogDate,
  relativeDay,
  type ActivityGroupKey,
  type ActivityPeriod,
} from "@/utils/activityLogCatalog";
import { paginateItems } from "@/utils/pagination";
import PaginationControls from "@/components/common/PaginationControls";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_PAGE_SIZE = 15;
// Lịch sử thao tác tải dần: mỗi lần 50 dòng, cuộn gần cuối danh sách (còn ~600px) thì tải tiếp.
const ACTIVITY_BATCH_SIZE = 50;
const LOAD_MORE_MARGIN = "600px";
const SEARCH_DEBOUNCE_MS = 350;
const SELECT_CLASS = "h-10 min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200";
const INPUT_CLASS = "h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-800 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-gray-700 dark:bg-gray-800/50 dark:text-white dark:focus:border-brand-500 dark:focus:ring-brand-500/20";
const LABEL_CLASS = "mb-1 block text-[11px] font-medium text-gray-500 md:mb-1.5 md:text-xs dark:text-gray-400";

/** Màu nhãn thao tác theo nhóm chức năng: nhìn màu là biết thao tác thuộc mảng nào. */
const GROUP_TONE: Record<ActivityGroupKey, string> = {
  shipment: "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300",
  payment: "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300",
  cost: "bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300",
  documentSync: "bg-blue-light-50 text-blue-light-700 dark:bg-blue-light-500/10 dark:text-blue-light-300",
  masterData: "bg-theme-purple-500/10 text-theme-purple-500",
  account: "bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300",
  auth: "bg-gray-100 text-gray-700 dark:bg-white/[0.06] dark:text-gray-300",
  system: "bg-theme-pink-500/10 text-theme-pink-500",
  other: "bg-gray-100 text-gray-700 dark:bg-white/[0.06] dark:text-gray-300",
};
const FAILED_TONE = "bg-error-50 text-error-700 dark:bg-error-500/10 dark:text-error-300";

type Translate = (key: string, variables?: Record<string, string | number>) => string;

function locale(language: "vi" | "en"): string {
  return language === "en" ? "en-GB" : "vi-VN";
}

function dateTime(value: string, language: "vi" | "en", withSeconds = false): string {
  const date = parseLogDate(value);
  if (Number.isNaN(date.getTime())) return value || "—";
  return date.toLocaleString(locale(language), {
    hour: "2-digit", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}), day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function timeOnly(value: string, language: "vi" | "en"): string {
  const date = parseLogDate(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString(locale(language), { hour: "2-digit", minute: "2-digit" });
}

/** Tiêu đề nhóm ngày: "Hôm nay · Thứ Năm, 12/11/2026". */
function dayHeading(day: string, language: "vi" | "en", t: Translate): string {
  if (!day) return t("unknown");
  const [year, month, date] = day.split("-").map(Number);
  const label = new Date(year, month - 1, date).toLocaleDateString(locale(language), { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
  const relative = relativeDay(day);
  const text = label.charAt(0).toLocaleUpperCase() + label.slice(1);
  return relative ? `${t(relative === "today" ? "logToday" : "logYesterday")} · ${text}` : text;
}

function actor(log: ActivityLog): string {
  return log.userName || log.username || (log.userId ? `User #${log.userId}` : "—");
}

function roleLabel(role: string | undefined, t: Translate): string {
  if (!role) return "";
  return (RBAC_ROLES as readonly string[]).includes(role) ? t(`logRole_${role}`) : role;
}

function localDate(value: string): string {
  const date = parseLogDate(value);
  return Number.isNaN(date.getTime()) ? "" : dateKey(date);
}

type EmailDatePreset = "today" | "last7" | "last30";
const EMAIL_DATE_PRESETS: { value: EmailDatePreset; days: number; labelKey: string }[] = [
  { value: "today", days: 1, labelKey: "emailDateToday" },
  { value: "last7", days: 7, labelKey: "emailDateLast7" },
  { value: "last30", days: 30, labelKey: "emailDateLast30" },
];

/** Bỏ dấu, viết thường: tìm "nguyen" ra "Nguyễn". */
function normalizeText(value: unknown): string {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLocaleLowerCase("vi").trim();
}

/** Người gửi email: theo user id (tên có thể trùng), log cũ không có id thì theo tên đăng nhập. */
function emailSenderKey(log: EmailActivityLog): string {
  return log.userId ? `id:${log.userId}` : `name:${log.username || log.userName || ""}`;
}

function emailSenderLabel(log: EmailActivityLog): string {
  const name = log.userName || log.username || (log.userId ? `User #${log.userId}` : "—");
  return log.userName && log.username ? `${name} (${log.username})` : name;
}

function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * Một dòng nhật ký, đọc như một câu: [giờ] [Ai] [làm gì — màu theo nhóm] / [trên đối tượng nào] / [ở màn hình nào].
 * Bấm tên người / nhãn thao tác để lọc nhanh. "Chi tiết" mở bảng thay đổi Trước → Sau và thời gian chính xác, thiết bị, IP.
 */
function ActivityRow({ log, onFilterUser, onFilterAction }: {
  log: ActivityLog;
  onFilterUser?: (userId: number) => void;
  onFilterAction?: (action: string) => void;
}) {
  const { language, t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const failed = log.status === "failed";
  const action = log.action.trim().toUpperCase();
  const label = activityActionLabel(log.action, t);
  const summary = activityLogSummary(log.action, log.detail, log.location, language);
  const where = activityLocationParts(log.location, t).join(" › ");
  const lines = activityDetailLines(log.detail);
  const changes = lines.filter((line) => line.field !== undefined);
  const notes = lines.filter((line) => line.field === undefined && line.text && line.text !== summary);
  const name = actor(log);
  const role = roleLabel(log.role, t);
  const detailId = `activity-detail-${String(log.id)}`;

  return (
    // Mọi dòng cùng viền trái 3px (trong suốt khi thành công) để cột giờ thẳng hàng; dòng thất bại tô viền đỏ + nền đỏ nhạt.
    <article className={`flex gap-3 border-l-[3px] py-3 pl-[13px] pr-4 transition-colors sm:gap-4 sm:pl-[17px] sm:pr-5 ${failed
      ? "border-error-500 bg-error-50/40 hover:bg-error-50/70 dark:bg-error-500/[0.06] dark:hover:bg-error-500/10"
      : "border-transparent hover:bg-gray-50 dark:hover:bg-white/[0.03]"}`}>
      <time dateTime={log.createdAt} title={dateTime(log.createdAt, language, true)} className="w-11 shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-gray-700 dark:text-gray-200">
        {timeOnly(log.createdAt, language)}
      </time>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {onFilterUser && log.userId ? (
            <button type="button" onClick={() => onFilterUser(log.userId as number)} title={t("logFilterByUser", { name })}
              className="max-w-full truncate text-left font-semibold text-gray-800 hover:text-brand-600 hover:underline dark:text-white/90 dark:hover:text-brand-400">
              {name}
            </button>
          ) : (
            <span className="max-w-full truncate font-semibold text-gray-800 dark:text-white/90">{name}</span>
          )}
          {role && <span className="text-xs text-gray-500 dark:text-gray-400">{role}</span>}
          {onFilterAction ? (
            <button type="button" onClick={() => onFilterAction(action)} title={t("logFilterByAction", { action: label })}
              className={`rounded-full px-2 py-0.5 text-xs font-medium hover:ring-1 hover:ring-current ${GROUP_TONE[activityGroupOf(action)]}`}>
              {label}
            </button>
          ) : (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${GROUP_TONE[activityGroupOf(action)]}`}>{label}</span>
          )}
          {failed && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${FAILED_TONE}`}>{t("activityFailed")}</span>}
        </div>

        {summary && <p className="mt-1 break-words text-sm text-gray-700 dark:text-gray-200">{summary}</p>}

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          {where && (
            <span className="flex min-w-0 items-center gap-1" title={log.location}>
              <PinIcon />
              <span className="sr-only">{t("activityWhere")}:</span>
              <span className="break-words">{where}</span>
            </span>
          )}
          <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-controls={detailId}
            className="inline-flex min-h-8 items-center gap-1 font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400">
            {expanded ? t("activityHideDetail") : changes.length > 0 ? t("logShowChanges", { count: changes.length }) : t("activityShowDetail")}
            <ChevronIcon open={expanded} />
          </button>
        </div>

        {expanded && (
          <div id={detailId} className="mt-2 space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm dark:border-gray-800 dark:bg-white/[0.03]">
            {changes.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">{t("logChanges")}</p>
                {/* Điện thoại: mỗi thay đổi một khối; từ sm: bảng 3 cột Mục | Trước | Sau. */}
                <ul className="space-y-2 sm:hidden">
                  {changes.map((line, index) => (
                    <li key={index} className="rounded-lg bg-white p-2 dark:bg-gray-900">
                      <p className="font-medium text-gray-700 dark:text-gray-200">{line.field}</p>
                      <p className="mt-0.5 break-words text-xs text-gray-500 dark:text-gray-400">{t("logBefore")}: <span className="line-through">{line.before || "—"}</span></p>
                      <p className="break-words text-xs font-medium text-success-700 dark:text-success-400">{t("logAfter")}: {line.after || "—"}</p>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto custom-scrollbar sm:block">
                  <table className="w-full min-w-[420px] table-fixed text-left text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 dark:text-gray-400">
                        <th className="w-1/4 pb-1 pr-3 font-medium">{t("logField")}</th>
                        <th className="w-[37.5%] pb-1 pr-3 font-medium">{t("logBefore")}</th>
                        <th className="pb-1 font-medium">{t("logAfter")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200/70 dark:divide-gray-800">
                      {changes.map((line, index) => (
                        <tr key={index} className="align-top">
                          <td className="break-words py-1.5 pr-3 font-medium text-gray-700 dark:text-gray-200">{line.field}</td>
                          <td className="break-words py-1.5 pr-3 text-gray-400 line-through decoration-gray-300 dark:text-gray-500">{line.before || "—"}</td>
                          <td className="break-words py-1.5 font-medium text-success-700 dark:text-success-400">{line.after || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {notes.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold text-gray-600 dark:text-gray-300">{t("logContent")}</p>
                <ul className="list-disc space-y-1 pl-5 text-gray-600 dark:text-gray-300">
                  {notes.map((line, index) => <li key={index} className="break-words">{line.text}</li>)}
                </ul>
              </div>
            )}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              <dt className="text-gray-500 dark:text-gray-400">{t("logExactTime")}</dt>
              <dd className="text-gray-700 dark:text-gray-200">{dateTime(log.createdAt, language, true)}</dd>
              {log.username && (
                <>
                  <dt className="text-gray-500 dark:text-gray-400">{t("username")}</dt>
                  <dd className="break-all text-gray-700 dark:text-gray-200">{log.username}</dd>
                </>
              )}
              {log.device && (
                <>
                  <dt className="text-gray-500 dark:text-gray-400">{t("activityDevice")}</dt>
                  <dd className="break-words text-gray-700 dark:text-gray-200">{log.device}</dd>
                </>
              )}
              {log.ipAddress && (
                <>
                  <dt className="text-gray-500 dark:text-gray-400">{t("activityIp")}</dt>
                  <dd className="break-all text-gray-700 dark:text-gray-200">{log.ipAddress}</dd>
                </>
              )}
            </dl>
          </div>
        )}
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

  // ---------- Lịch sử thao tác: lọc phía server, cuộn tới đâu tải tới đó (không đếm tổng, không tải hết bảng) ----------
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Lỗi khi tải thêm: chỉ báo ở cuối danh sách (giữ các dòng đã tải), bấm để thử lại; không tự gọi lại liên tục.
  const [loadMoreError, setLoadMoreError] = useState("");
  // Đổi bộ lọc / tải lại: tăng số lượt để bỏ kết quả "tải thêm" của bộ lọc cũ còn đang chạy.
  const batchGenerationRef = useRef(0);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const [actors, setActors] = useState<ActivityActor[]>([]);
  const [activityUser, setActivityUser] = useState("");
  const [activityGroup, setActivityGroup] = useState<ActivityGroupKey | "">("");
  const [activityAction, setActivityAction] = useState("");
  const [activityStatus, setActivityStatus] = useState<"" | "success" | "failed">("");
  const [activityPeriod, setActivityPeriod] = useState<ActivityPeriod>("all");
  const [customRange, setCustomRange] = useState({ from: "", to: "" });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  // ---------- Nhật ký email: tải một lần, lọc phía client ----------
  const [emailLogs, setEmailLogs] = useState<EmailActivityLog[]>([]);
  const [emailLoaded, setEmailLoaded] = useState(false);
  const [emailStatus, setEmailStatus] = useState<"all" | "sent" | "not sent">("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [senderFilter, setSenderFilter] = useState("all");
  const [errorFilter, setErrorFilter] = useState("all");
  const [emailSort, setEmailSort] = useState<"newest" | "oldest">("newest");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Nút khoảng thời gian nhanh đang chọn; sửa tay ô ngày thì bỏ chọn.
  const [datePreset, setDatePreset] = useState<EmailDatePreset | "">("");

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

  // Khoảng ngày của lựa chọn thời gian (chuỗi YYYY-MM-DD nên dùng làm phụ thuộc được).
  const { from: activityFrom, to: activityTo } = activityPeriodRange(activityPeriod, customRange);
  const activityFilters = useMemo<ActivityLogFilters>(() => ({
    userId: activityUser ? Number(activityUser) : undefined,
    ...activityActionQuery(activityGroup, activityAction),
    status: activityStatus || undefined,
    from: activityFrom || undefined,
    to: activityTo || undefined,
    q: debouncedQuery || undefined,
  }), [activityAction, activityFrom, activityGroup, activityStatus, activityTo, activityUser, debouncedQuery]);

  useEffect(() => {
    if (!canViewLogs || activeTab !== "activity") return;
    const controller = new AbortController();
    const generation = ++batchGenerationRef.current;
    loadMoreAbortRef.current?.abort();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setLoadingMore(false);
      setLoadMoreError("");
      setError("");
      getActivityLogBatch({ limit: ACTIVITY_BATCH_SIZE, ...activityFilters }, controller.signal)
        .then((result) => {
          if (generation !== batchGenerationRef.current) return;
          setLogs(result.logs);
          setHasMore(result.hasMore);
          setNextCursor(result.nextCursor);
          if (result.actors.length) setActors(result.actors);
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
  }, [activeTab, activityFilters, canViewLogs, reloadKey, t]);

  /** Tải lô tiếp theo (cũ hơn) nối vào cuối danh sách. */
  const loadMoreActivity = useCallback(() => {
    if (loading || loadingMore || !hasMore || !nextCursor) return;
    const generation = batchGenerationRef.current;
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    setLoadingMore(true);
    setLoadMoreError("");
    getActivityLogBatch({ limit: ACTIVITY_BATCH_SIZE, cursor: nextCursor, ...activityFilters }, controller.signal)
      .then((result) => {
        if (generation !== batchGenerationRef.current) return;
        // Bỏ dòng trùng (phòng khi có log mới chen vào giữa hai lần tải).
        setLogs((current) => {
          const seen = new Set(current.map((log) => String(log.id)));
          return [...current, ...result.logs.filter((log) => !seen.has(String(log.id)))];
        });
        setHasMore(result.hasMore);
        setNextCursor(result.nextCursor);
      })
      .catch((loadError) => {
        if (controller.signal.aborted || generation !== batchGenerationRef.current) return;
        setLoadMoreError(loadError instanceof Error ? loadError.message : t("activityLogLoadError"));
      })
      .finally(() => {
        if (generation === batchGenerationRef.current) setLoadingMore(false);
      });
  }, [activityFilters, hasMore, loading, loadingMore, nextCursor, t]);

  // Cuộn tới gần cuối danh sách thì tự tải tiếp (vẫn có nút "Tải thêm" nếu trình duyệt không hỗ trợ).
  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (activeTab !== "activity" || !hasMore || loadMoreError || !sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMoreActivity();
    }, { rootMargin: LOAD_MORE_MARGIN });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeTab, hasMore, loadMoreActivity, loadMoreError]);

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

  // Lọc theo mọi bộ lọc trừ trạng thái: dùng để đếm số dòng trên từng nút trạng thái.
  const emailLogsBeforeStatus = useMemo(() => {
    const keyword = normalizeText(query);
    return emailLogs.filter((log) => {
      if (supplierFilter !== "all" && log.supplierName !== supplierFilter) return false;
      if (senderFilter !== "all" && emailSenderKey(log) !== senderFilter) return false;
      if (errorFilter !== "all" && (log.status === "sent" || (log.error || "") !== errorFilter)) return false;
      const sentDate = localDate(log.sentAt);
      if (dateFrom && sentDate < dateFrom) return false;
      if (dateTo && sentDate > dateTo) return false;
      if (!keyword) return true;
      return normalizeText([log.supplierName, log.supplierEmail, log.subject, log.error, log.userName, log.username].join(" ")).includes(keyword);
    });
  }, [emailLogs, query, supplierFilter, senderFilter, errorFilter, dateFrom, dateTo]);

  const emailStatusCounts = useMemo(() => {
    const sent = emailLogsBeforeStatus.filter((log) => log.status === "sent").length;
    return { all: emailLogsBeforeStatus.length, sent, "not sent": emailLogsBeforeStatus.length - sent };
  }, [emailLogsBeforeStatus]);

  const filteredEmailLogs = useMemo(() => {
    const rows = emailStatus === "all" ? [...emailLogsBeforeStatus] : emailLogsBeforeStatus.filter((log) => log.status === emailStatus);
    const time = (log: EmailActivityLog) => parseLogDate(log.sentAt).getTime() || 0;
    return rows.sort((a, b) => (emailSort === "newest" ? time(b) - time(a) : time(a) - time(b)));
  }, [emailLogsBeforeStatus, emailSort, emailStatus]);

  const suppliers = useMemo(() => Array.from(new Set(emailLogs.map((log) => log.supplierName).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [emailLogs]);
  const emailSenders = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const log of emailLogs) if (!byKey.has(emailSenderKey(log))) byKey.set(emailSenderKey(log), emailSenderLabel(log));
    return [...byKey.entries()].sort((a, b) => a[1].localeCompare(b[1], "vi"));
  }, [emailLogs]);
  // Lý do lỗi của các email gửi không thành công, lỗi gặp nhiều xếp trước.
  const emailErrors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const log of emailLogs) if (log.status !== "sent" && log.error) counts.set(log.error, (counts.get(log.error) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "vi"));
  }, [emailLogs]);

  const applyDatePreset = (preset: EmailDatePreset) => {
    if (datePreset === preset) {
      setDatePreset("");
      setDateFrom("");
      setDateTo("");
    } else {
      const days = EMAIL_DATE_PRESETS.find((item) => item.value === preset)?.days || 1;
      const from = new Date();
      from.setDate(from.getDate() - (days - 1));
      setDatePreset(preset);
      setDateFrom(dateKey(from));
      setDateTo(dateKey(new Date()));
    }
    setPage(1);
  };
  const emailPage = paginateItems(filteredEmailLogs, page, pageSize);

  const visibleCount = activeTab === "activity" ? logs.length : filteredEmailLogs.length;
  // Tải dần thì chưa biết tổng: còn dữ liệu thì ghi "Đã tải N", tải hết rồi mới ghi tổng.
  const countLabel = activeTab === "activity" && hasMore ? t("loadedRecordCount", { count: visibleCount }) : t("recordCount", { count: visibleCount });
  const isEmpty = activeTab === "activity" ? logs.length === 0 : emailPage.items.length === 0;

  const activitySuggestions = useMemo(() => Array.from(new Set([
    ...actors.flatMap((item) => [item.name, item.username]),
    ...logs.map((log) => activityLogSummary(log.action, log.detail, log.location, language)),
  ].filter((value): value is string => Boolean(value)))), [actors, language, logs]);
  const dayGroups = useMemo(() => groupActivityByDay(logs), [logs]);
  const actionOptions = activityGroup ? ACTIVITY_GROUPS.filter((group) => group.key === activityGroup) : ACTIVITY_GROUPS;

  const clearEmailFilters = () => {
    setQuery("");
    setEmailStatus("all");
    setSupplierFilter("all");
    setSenderFilter("all");
    setErrorFilter("all");
    setEmailSort("newest");
    setDatePreset("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const clearActivityFilters = () => {
    setQuery("");
    setActivityUser("");
    setActivityGroup("");
    setActivityAction("");
    setActivityStatus("");
    setActivityPeriod("all");
    setCustomRange({ from: "", to: "" });
  };

  const changeGroup = (group: ActivityGroupKey | "") => {
    setActivityGroup(group);
    // Thao tác đang chọn không thuộc nhóm mới thì bỏ.
    if (activityAction && group && activityGroupOf(activityAction) !== group) setActivityAction("");
  };
  // Chọn một thao tác thì nhóm đi theo thao tác đó (ô Thao tác chỉ còn các thao tác cùng nhóm).
  const changeAction = (action: string) => {
    setActivityAction(action);
    if (action) setActivityGroup(activityGroupOf(action));
  };

  // Các bộ lọc đang bật, hiện thành thẻ có nút bỏ: nhìn là biết danh sách đang bị lọc theo gì.
  const actorLabel = (id: string) => {
    const found = actors.find((item) => String(item.id) === id);
    return found ? found.name || found.username : `#${id}`;
  };
  const periodChipLabel = activityPeriod === "custom"
    ? `${activityFrom ? new Date(`${activityFrom}T00:00`).toLocaleDateString(locale(language)) : "…"} – ${activityTo ? new Date(`${activityTo}T00:00`).toLocaleDateString(locale(language)) : "…"}`
    : t(`logPeriod_${activityPeriod}`);
  const activeChips: { key: string; label: string; clear: () => void }[] = [
    ...(debouncedQuery ? [{ key: "q", label: `“${debouncedQuery}”`, clear: () => setQuery("") }] : []),
    ...(activityPeriod !== "all" ? [{ key: "period", label: periodChipLabel, clear: () => { setActivityPeriod("all"); setCustomRange({ from: "", to: "" }); } }] : []),
    ...(activityUser ? [{ key: "user", label: actorLabel(activityUser), clear: () => setActivityUser("") }] : []),
    ...(activityGroup && !activityAction ? [{ key: "group", label: t(`logGroup_${activityGroup}`), clear: () => setActivityGroup("") }] : []),
    ...(activityAction ? [{ key: "action", label: activityActionLabel(activityAction, t), clear: () => { setActivityAction(""); setActivityGroup(""); } }] : []),
    ...(activityStatus ? [{ key: "status", label: activityStatus === "failed" ? t("activityFailed") : t("activitySucceeded"), clear: () => setActivityStatus("") }] : []),
  ];
  // Số bộ lọc trên nút "Bộ lọc" ở điện thoại (ngoài ô tìm kiếm).
  const activeFilterCount = activeChips.filter((chip) => chip.key !== "q").length;
  const mobileShow = filtersOpen ? "" : "max-md:hidden";

  if (!canViewLogs) return <div className="flex min-h-[50vh] items-center justify-center"><div className="h-9 w-9 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>;

  return (
    <section className="space-y-3 md:space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 sm:items-end sm:gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold sm:text-xl md:text-2xl text-gray-800 dark:text-white/90">{activeTab === "activity" ? t("operationHistory") : t("emailLogs")}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-sm:hidden">{activeTab === "activity" ? t("activityLogsDetailedDescription") : t("activityLogsDescription")}</p>
        </div>
        <button type="button" onClick={refresh} disabled={loading} className="h-10 rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">{loading ? t("loading") : t("refreshData")}</button>
      </div>

      {activeTab === "activity" && (
        // Thanh lọc (cùng kiểu trang Đề nghị thanh toán): điện thoại chỉ hiện ô tìm + nút "Bộ lọc".
        <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900 md:rounded-2xl md:px-4 md:py-3.5">
          <div className="grid grid-cols-2 gap-2 md:flex md:flex-row md:flex-wrap md:items-end md:gap-3">
            <div className="col-span-2 min-w-0 md:w-80 md:flex-none">
              <span className={`${LABEL_CLASS} max-md:sr-only`}>{t("logFilterSearch")}</span>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <SearchSuggestions value={query} onChange={setQuery} suggestions={activitySuggestions}
                    placeholder={t("searchActivityLogs")} ariaLabel={t("logFilterSearch")} className={INPUT_CLASS} />
                </div>
                <MobileFilterToggle open={filtersOpen} onToggle={() => setFiltersOpen((open) => !open)} activeCount={activeFilterCount} controls="activity-filter-panel" />
              </div>
            </div>
            <div id="activity-filter-panel" className={`${mobileShow} col-span-2 min-w-0 md:w-44`}>
              <label htmlFor="activity-filter-period" className={LABEL_CLASS}>{t("logFilterPeriod")}</label>
              <select id="activity-filter-period" value={activityPeriod} onChange={(event) => setActivityPeriod(event.target.value as ActivityPeriod)} className={INPUT_CLASS}>
                {ACTIVITY_PERIODS.map((period) => <option key={period} value={period}>{t(`logPeriod_${period}`)}</option>)}
              </select>
            </div>
            {activityPeriod === "custom" && (
              <div className={`${mobileShow} col-span-2 grid grid-cols-2 gap-2 md:flex md:gap-3`}>
                <div className="min-w-0 md:w-40">
                  <label htmlFor="activity-filter-from" className={LABEL_CLASS}>{t("dateFrom")}</label>
                  <input id="activity-filter-from" type="date" value={customRange.from} max={customRange.to || undefined}
                    onChange={(event) => setCustomRange((range) => ({ ...range, from: event.target.value }))} className={INPUT_CLASS} />
                </div>
                <div className="min-w-0 md:w-40">
                  <label htmlFor="activity-filter-to" className={LABEL_CLASS}>{t("dateTo")}</label>
                  <input id="activity-filter-to" type="date" value={customRange.to} min={customRange.from || undefined}
                    onChange={(event) => setCustomRange((range) => ({ ...range, to: event.target.value }))} className={INPUT_CLASS} />
                </div>
              </div>
            )}
            <div className={`${mobileShow} col-span-2 min-w-0 md:w-52`}>
              <label htmlFor="activity-filter-user" className={LABEL_CLASS}>{t("logFilterUser")}</label>
              <select id="activity-filter-user" value={activityUser} onChange={(event) => setActivityUser(event.target.value)} className={INPUT_CLASS}>
                <option value="">{t("allUsers")}</option>
                {actors.map((item) => <option key={item.id} value={String(item.id)}>{item.name || item.username}{item.name && item.username ? ` · @${item.username}` : ""}</option>)}
              </select>
            </div>
            <div className={`${mobileShow} col-span-2 min-w-0 md:w-52`}>
              <label htmlFor="activity-filter-group" className={LABEL_CLASS}>{t("logFilterGroup")}</label>
              <select id="activity-filter-group" value={activityGroup} onChange={(event) => changeGroup(event.target.value as ActivityGroupKey | "")} className={INPUT_CLASS}>
                <option value="">{t("logAllGroups")}</option>
                {ACTIVITY_GROUPS.map((group) => <option key={group.key} value={group.key}>{t(`logGroup_${group.key}`)}</option>)}
              </select>
            </div>
            <div className={`${mobileShow} col-span-2 min-w-0 md:w-60`}>
              <label htmlFor="activity-filter-action" className={LABEL_CLASS}>{t("logFilterAction")}</label>
              <select id="activity-filter-action" value={activityAction} onChange={(event) => changeAction(event.target.value)} className={INPUT_CLASS}>
                <option value="">{activityGroup ? t("logAllActionsInGroup") : t("allActions")}</option>
                {actionOptions.map((group) => (
                  <optgroup key={group.key} label={t(`logGroup_${group.key}`)}>
                    {group.actions.map(([code, labelKey]) => <option key={code} value={code}>{t(labelKey)}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className={`${mobileShow} col-span-2 min-w-0 md:w-36`}>
              <label htmlFor="activity-filter-status" className={LABEL_CLASS}>{t("logFilterResult")}</label>
              <select id="activity-filter-status" value={activityStatus} onChange={(event) => setActivityStatus(event.target.value as "" | "success" | "failed")} className={INPUT_CLASS}>
                <option value="">{t("allResults")}</option>
                <option value="success">{t("activitySucceeded")}</option>
                <option value="failed">{t("activityFailed")}</option>
              </select>
            </div>
          </div>

          {activeChips.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{t("logActiveFilters")}</span>
              {activeChips.map((chip) => (
                <span key={chip.key} className="inline-flex max-w-full items-center gap-1 rounded-full border border-brand-200 bg-brand-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
                  <span className="truncate">{chip.label}</span>
                  <button type="button" onClick={chip.clear} aria-label={t("logRemoveFilter", { label: chip.label })} title={t("logRemoveFilter", { label: chip.label })}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-brand-100 dark:hover:bg-brand-500/20">
                    <span aria-hidden="true">×</span>
                  </button>
                </span>
              ))}
              <button type="button" onClick={clearActivityFilters} className="h-8 rounded-lg px-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.04]">{t("clearFilters")}</button>
            </div>
          )}
        </div>
      )}

      {/* Bỏ tab bar: mục nào trên sidebar được click thì hiện đúng mục đó — không cần chuyển tab trên trang.
          overflow-clip (không phải overflow-hidden) để tiêu đề ngày dính ở đầu màn hình khi cuộn. */}
      <div className="overflow-clip rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        {activeTab === "activity" ? (
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800 sm:px-5">
            <p className="text-xs text-gray-500 dark:text-gray-400">{countLabel}</p>
            {loading && !isEmpty && <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" aria-label={t("loading")} />}
          </div>
        ) : (
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 dark:border-gray-800 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-gray-800 dark:text-white/90">{t("emailHistory")}</h2>
              <p className="mt-0.5 text-xs text-gray-500">{countLabel}</p>
            </div>
            <SearchSuggestions
              value={query}
              onChange={(value) => { setQuery(value); setPage(1); }}
              suggestions={emailLogs.flatMap((log) => [log.supplierName, log.supplierEmail, log.subject, log.userName, log.username]).filter((value): value is string => Boolean(value))}
              placeholder={t("searchEmailLogs")}
              ariaLabel={t("searchEmailLogs")}
              className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-800 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white sm:max-w-sm"
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">{(["all", "sent", "not sent"] as const).map((status) => <button key={status} type="button" aria-pressed={emailStatus === status} onClick={() => { setEmailStatus(status); setPage(1); }} className={`h-9 rounded-lg border px-3 text-xs font-semibold ${emailStatus === status ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300" : "border-gray-200 text-gray-500 dark:border-gray-700"}`}>{status === "all" ? t("allStatuses") : status === "sent" ? t("emailSentStatus") : t("emailNotSentStatus")} ({emailStatusCounts[status]})</button>)}</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <select value={supplierFilter} onChange={(event) => { setSupplierFilter(event.target.value); setPage(1); }} aria-label={t("emailSupplierFilter")} className={SELECT_CLASS}>
                <option value="all">{t("allSuppliers")}</option>
                {suppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
              </select>
              <select value={senderFilter} onChange={(event) => { setSenderFilter(event.target.value); setPage(1); }} aria-label={t("emailSenderFilter")} className={SELECT_CLASS}>
                <option value="all">{t("allUsers")}</option>
                {emailSenders.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
              <select value={errorFilter} onChange={(event) => { setErrorFilter(event.target.value); setPage(1); }} aria-label={t("emailErrorFilter")} className={SELECT_CLASS}>
                <option value="all">{t("emailAllErrors")}</option>
                {emailErrors.map(([message, count]) => <option key={message} value={message}>{message} ({count})</option>)}
              </select>
              <select value={emailSort} onChange={(event) => { setEmailSort(event.target.value as "newest" | "oldest"); setPage(1); }} aria-label={t("emailSortLabel")} className={SELECT_CLASS}>
                <option value="newest">{t("emailSortNewest")}</option>
                <option value="oldest">{t("emailSortOldest")}</option>
              </select>
            </div>
            <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
              <div className="flex flex-wrap gap-2" role="group" aria-label={t("emailDatePresets")}>
                {EMAIL_DATE_PRESETS.map((preset) => (
                  <button key={preset.value} type="button" aria-pressed={datePreset === preset.value} onClick={() => applyDatePreset(preset.value)} className={`h-10 rounded-lg border px-3 text-xs font-semibold ${datePreset === preset.value ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300" : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.04]"}`}>{t(preset.labelKey)}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 md:flex">
                <input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setDatePreset(""); setPage(1); }} aria-label={t("emailDateFrom")} title={t("emailDateFrom")} className={`${SELECT_CLASS} w-full md:w-44`} />
                <input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setDatePreset(""); setPage(1); }} aria-label={t("emailDateTo")} title={t("emailDateTo")} className={`${SELECT_CLASS} w-full md:w-44`} />
              </div>
              <button type="button" onClick={clearEmailFilters} className="h-10 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50 md:ml-auto dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.04]">{t("clearFilters")}</button>
            </div>
          </div>
        </div>
        )}
        {error ? (
          <div className="m-4 rounded-xl border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400">{error}</div>
        ) : loading && isEmpty ? (
          <div className="flex min-h-52 items-center justify-center"><div className="h-9 w-9 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>
        ) : isEmpty ? (
          <div className="flex min-h-52 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-gray-500">
            <p>{activeTab === "email" ? t("noEmailLogs") : activeChips.length > 0 ? t("logNoMatch") : t("noActivityLogs")}</p>
            {activeTab === "activity" && activeChips.length > 0 && (
              <button type="button" onClick={clearActivityFilters} className="h-10 rounded-lg border border-gray-200 px-4 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.04]">{t("clearFilters")}</button>
            )}
          </div>
        ) : activeTab === "activity" ? (
          <div>
            <div className={`transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading || loadingMore}>
              {dayGroups.map((group, index) => (
                <section key={`${group.day}-${index}`} aria-label={dayHeading(group.day, language, t)} className="border-t border-gray-200 first:border-t-0 dark:border-gray-800">
                  {/* Tiêu đề ngày dính dưới header app khi cuộn: luôn biết đang xem ngày nào. */}
                  <h2 className="sticky top-[65px] z-10 border-b border-gray-200 bg-gray-50/95 px-4 py-2 text-xs font-semibold text-gray-600 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95 dark:text-gray-300 sm:px-5 lg:top-[73px]">
                    {dayHeading(group.day, language, t)}
                  </h2>
                  <div className="divide-y divide-gray-200/80 dark:divide-gray-800">
                    {group.items.map((log) => (
                      <ActivityRow key={log.id} log={log}
                        onFilterUser={String(log.userId) === activityUser ? undefined : (userId) => setActivityUser(String(userId))}
                        onFilterAction={log.action.trim().toUpperCase() === activityAction ? undefined : changeAction} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
            {/* Mốc cuối danh sách: lọt vào màn hình (còn ~600px) thì tải lô tiếp theo */}
            <div ref={loadMoreSentinelRef} className="flex min-h-14 items-center justify-center border-t border-gray-100 px-4 py-3 dark:border-gray-800">
              {loadingMore ? (
                <span className="flex items-center gap-2 text-xs text-gray-500"><span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />{t("loading")}</span>
              ) : hasMore ? (
                <div className="flex flex-col items-center gap-2 text-center">
                  {loadMoreError && <p className="break-words text-xs text-error-600 dark:text-error-400">{loadMoreError}</p>}
                  <button type="button" onClick={loadMoreActivity} className="h-10 rounded-lg border border-gray-200 px-4 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.04]">{t("loadMore")}</button>
                </div>
              ) : (
                <span className="text-xs text-gray-400">{t("allRecordsLoaded")}</span>
              )}
            </div>
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
        {!error && activeTab === "email" && visibleCount > 0 && <PaginationControls page={emailPage.safePage} totalPages={emailPage.totalPages} pageSize={pageSize} totalItems={visibleCount} from={emailPage.from} to={emailPage.to} summaryKey="showingRecords" onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />}
      </div>
    </section>
  );
}
