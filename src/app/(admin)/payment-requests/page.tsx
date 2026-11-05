"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import PaginationControls from "@/components/common/PaginationControls";
import { BankPaidHint, PaymentStatusBadge, RedFlowBadge, formatDateTime, formatDueDate, isOverdue } from "@/components/payment/PaymentRequestParts";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import {
  listPaymentRequests,
  type PaymentFlow,
  type PaymentRequester,
  type PaymentRequest,
  type PaymentRequestSortKey,
  type PaymentRequestState,
  type PaymentRequestStateTotal,
} from "@/services/paymentRequestApi";
import { canCreatePaymentRequests, canOpenPaymentRequests, costCodeName, formatMoney, sumAmounts } from "@/utils/paymentRequest";

// Danh sách đề nghị thanh toán: lọc (trạng thái, mã phí, từ khoá) + sắp xếp + phân trang đều phía server. Bấm một đề nghị -> trang quy trình /payment-requests/<mã>;
// link cũ ?id=DNTT-001 tự chuyển sang trang đó.

const DEFAULT_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;
// Ô lọc cùng kiểu thanh lọc đơn hàng XNK (components/shipment/ShipmentFilters): nhãn nhỏ phía trên, ô bo tròn.
const INPUT_CLASS = "h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-800 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-gray-700 dark:bg-gray-800/50 dark:text-white dark:focus:border-brand-500 dark:focus:ring-brand-500/20";
const LABEL_CLASS = "mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400";

/**
 * Thẻ lọc trạng thái (cùng kiểu thẻ số liệu đơn hàng XNK — components/shipment/ShipmentMetrics): Tất cả / Chưa duyệt (chi
 * phí chờ duyệt) / Đã duyệt (chi phí dự kiến chi) / Chưa hoàn thành chứng từ (đã chi tiền) / Hoàn thành chứng từ (hoàn tất
 * quy trình). Mỗi thẻ: số đề nghị + tổng tiền của nhóm.
 */
const STATE_CARDS: ReadonlyArray<{
  value: "" | PaymentRequestState;
  labelKey: string;
  hintKey: string;
  amountKey: string;
  color: string;
  bg: string;
  border: string;
  icon: string;
}> = [
  { value: "", labelKey: "prAllStatuses", hintKey: "prStateAllHint", amountKey: "prEstimatedSpend", color: "text-brand-600 dark:text-brand-300", bg: "bg-brand-50 dark:bg-brand-500/10", border: "border-brand-300 dark:border-brand-500/40", icon: "M4 6h16M4 12h16M4 18h10" },
  { value: "pending", labelKey: "prStatePendingCard", hintKey: "prStatePendingHint", amountKey: "prPendingSpend", color: "text-warning-600 dark:text-warning-300", bg: "bg-warning-50 dark:bg-warning-500/10", border: "border-warning-300 dark:border-warning-500/40", icon: "M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" },
  { value: "approved", labelKey: "prStateApprovedCard", hintKey: "prStateApprovedHint", amountKey: "prExpectedSpend", color: "text-blue-light-600 dark:text-blue-light-300", bg: "bg-blue-light-50 dark:bg-blue-light-500/10", border: "border-blue-light-300 dark:border-blue-light-500/40", icon: "M9 12l2 2 4-4M7 3h10a2 2 0 0 1 2 2v14l-3-2-2 2-2-2-2 2-2-2-3 2V5a2 2 0 0 1 2-2z" },
  { value: "paid", labelKey: "prStatePaidCard", hintKey: "prStatePaidHint", amountKey: "prPaidSpend", color: "text-orange-600 dark:text-orange-300", bg: "bg-orange-50 dark:bg-orange-500/10", border: "border-orange-300 dark:border-orange-500/40", icon: "M3 7h18v10H3zM3 10h18M7 15h3" },
  { value: "completed", labelKey: "prStateCompletedCard", hintKey: "prStateCompletedHint", amountKey: "prPaidSpend", color: "text-success-600 dark:text-success-300", bg: "bg-success-50 dark:bg-success-500/10", border: "border-success-300 dark:border-success-500/40", icon: "M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3" },
];
/**
 * Thời gian tạo đề nghị: tháng này / tháng trước / quý này / năm nay / tất cả / tùy chọn (từ ngày – đến ngày). Mốc ngày theo giờ
 * Việt Nam (BE so ngày tạo theo giờ Việt Nam), không phụ thuộc múi giờ máy người dùng.
 */
type PaymentRequestPeriod = "currentMonth" | "previousMonth" | "currentQuarter" | "currentYear" | "all" | "custom";
const PERIODS: ReadonlyArray<{ value: PaymentRequestPeriod; labelKey: string }> = [
  { value: "currentMonth", labelKey: "prPeriodCurrentMonth" },
  { value: "previousMonth", labelKey: "prPeriodPreviousMonth" },
  { value: "currentQuarter", labelKey: "prPeriodCurrentQuarter" },
  { value: "currentYear", labelKey: "prPeriodCurrentYear" },
  { value: "all", labelKey: "prPeriodAll" },
  { value: "custom", labelKey: "prPeriodCustom" },
];
const DEFAULT_PERIOD: PaymentRequestPeriod = "currentMonth";

/** Hôm nay theo giờ Việt Nam: { year, month (0-11), day }. */
function todayVn(now = new Date()) {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(now).split("-").map(Number);
  return { year, month: month - 1, day };
}

const isoDate = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month, day));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
};

/** Khoảng ngày tạo (YYYY-MM-DD, gồm cả 2 đầu) của kỳ; "all" = không giới hạn; "custom" = ngày người dùng chọn. */
function getPeriodRange(period: PaymentRequestPeriod, custom: { from: string; to: string }): { createdFrom?: string; createdTo?: string } {
  if (period === "all") return {};
  if (period === "custom") return { createdFrom: custom.from || undefined, createdTo: custom.to || undefined };
  const { year, month } = todayVn();
  if (period === "previousMonth") return { createdFrom: isoDate(year, month - 1, 1), createdTo: isoDate(year, month, 0) };
  if (period === "currentQuarter") {
    const first = Math.floor(month / 3) * 3;
    return { createdFrom: isoDate(year, first, 1), createdTo: isoDate(year, first + 3, 0) };
  }
  if (period === "currentYear") return { createdFrom: isoDate(year, 0, 1), createdTo: isoDate(year, 11, 31) };
  return { createdFrom: isoDate(year, month, 1), createdTo: isoDate(year, month + 1, 0) };
}

/** "2026-11-01" -> "01/11". */
const shortDate = (value?: string) => (value ? `${value.slice(8, 10)}/${value.slice(5, 7)}` : "");

function SortIcon({ active, direction }: { active: boolean; direction: "asc" | "desc" }) {
  if (!active) return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300 dark:text-gray-600"><polyline points="7 15 12 20 17 15" /><polyline points="7 9 12 4 17 9" /></svg>;
  return direction === "asc"
    ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand-500"><polyline points="18 15 12 9 6 15" /></svg>
    : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand-500"><polyline points="6 9 12 15 18 9" /></svg>;
}

function PaymentRequestsContent() {
  const { t, language } = useLanguage();
  const { can } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canView = canOpenPaymentRequests(can);
  const canCreate = canCreatePaymentRequests(can);

  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [requestState, setRequestState] = useState<"" | PaymentRequestState>("");
  const [periodFilter, setPeriodFilter] = useState<PaymentRequestPeriod>(DEFAULT_PERIOD);
  const [customRange, setCustomRange] = useState({ from: "", to: "" });
  const [flowFilter, setFlowFilter] = useState<"" | PaymentFlow>("");
  const [stateTotals, setStateTotals] = useState<Partial<Record<PaymentRequestState, PaymentRequestStateTotal[]>>>({});
  const [flowCounts, setFlowCounts] = useState<Partial<Record<PaymentFlow, number>>>({});
  const [requesterFilter, setRequesterFilter] = useState("");
  const [requesters, setRequesters] = useState<PaymentRequester[]>([]);
  // null = mặc định của BE (mới tạo trước).
  const [sort, setSort] = useState<{ key: PaymentRequestSortKey; direction: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [reloadKey, setReloadKey] = useState(0);
  const legacyId = searchParams.get("id");

  const openDetail = useCallback((id: string) => router.push(`/payment-requests/${encodeURIComponent(id)}`), [router]);

  useEffect(() => {
    if (legacyId) router.replace(`/payment-requests/${encodeURIComponent(legacyId)}`);
  }, [legacyId, router]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      const periodRange = getPeriodRange(periodFilter, customRange);
      listPaymentRequests({
        limit: pageSize,
        offset: (page - 1) * pageSize,
        state: requestState || undefined,
        flow: flowFilter || undefined,
        requesterId: requesterFilter || undefined,
        ...periodRange,
        q: debouncedQuery || undefined,
        sort: sort?.key,
        dir: sort?.direction,
      }, controller.signal)
        .then((result) => {
          setRequests(result.requests);
          setTotal(result.total);
          setStateTotals(result.stateTotals);
          setFlowCounts(result.flowCounts);
          setRequesters((current) => {
            const selected = current.find((requester) => requester.id === requesterFilter);
            return selected && !result.requesters.some((requester) => requester.id === selected.id)
              ? [...result.requesters, selected]
              : result.requesters;
          });
          // Trang hiện tại vượt quá số trang (vừa đổi bộ lọc): quay về trang cuối còn dữ liệu.
          const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
          if (page > lastPage) setPage(lastPage);
        })
        .catch((loadError: unknown) => {
          if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : t("prLoadError"));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [canView, customRange, debouncedQuery, flowFilter, page, pageSize, periodFilter, reloadKey, requesterFilter, requestState, sort, t]);

  const reload = () => setReloadKey((key) => key + 1);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const from = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to = Math.min(total, currentPage * pageSize);

  if (!canView) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300">
        {t("prNoPermission")}
      </div>
    );
  }

  const money = (request: PaymentRequest) => formatMoney(request.total, request.currency, language);
  const dueClass = (request: PaymentRequest) => (isOverdue(request.dueDate, request.status) ? "text-error-600 dark:text-error-400" : "text-gray-700 dark:text-gray-300");
  const costCodeLabel = (code: string) => {
    const normalized = code.toUpperCase();
    if (normalized === "VH") return `${normalized} · ${t("prType_van_hanh")}`;
    if (normalized === "MH") return `${normalized} · ${t("prType_mua_hang")}`;
    return code;
  };
  const costGroups = (request: PaymentRequest) => [...new Set(request.costs.map((cost) => cost.code || "—"))].map(costCodeLabel);
  const costTargets = (request: PaymentRequest) => ({
    contracts: [...new Set(request.costs.map((cost) => cost.contract).filter(Boolean))],
    containers: [...new Set(request.costs.map((cost) => cost.container).filter(Boolean))],
  });
  const costTargetText = (request: PaymentRequest) => [...costTargets(request).contracts, ...costTargets(request).containers].join(", ");
  const costNames = (request: PaymentRequest) => [...new Set(request.costs.map((cost) => costCodeName(cost.code, cost.categoryName)).filter(Boolean))];
  const flowCountTotal = Object.values(flowCounts).reduce((sum, count) => sum + (count || 0), 0);
  const availableFlows = (["do", "xanh", "vang"] as const).filter((value) => (flowCounts[value] ?? 0) > 0 || flowFilter === value);
  const summarizeStates = (states?: PaymentRequestState[]) => {
    const rows = states ? states.flatMap((state) => stateTotals[state] ?? []) : Object.values(stateTotals).flat();
    const byCurrency = new Map<string, string[]>();
    for (const row of rows) byCurrency.set(row.currency, [...(byCurrency.get(row.currency) ?? []), row.total]);
    const amountLines = [...byCurrency.entries()].map(([currency, amounts]) => formatMoney(sumAmounts(amounts), currency, language));
    return {
      count: rows.reduce((sum, row) => sum + row.count, 0),
      amountLines: amountLines.length ? amountLines : [formatMoney("0", "VND", language)],
      amount: amountLines.join(" + ") || formatMoney("0", "VND", language),
    };
  };
  const hasActiveFilter = Boolean(query || requesterFilter || flowFilter || periodFilter !== DEFAULT_PERIOD || requestState);
  // Ngày tùy chọn: "đến ngày" trước "từ ngày" thì BE báo lỗi — chặn sớm ở ô nhập (min / max).
  const periodHint = (() => {
    const range = getPeriodRange(periodFilter, customRange);
    if (!range.createdFrom && !range.createdTo) return periodFilter === "all" ? "" : t("prPeriodPickDates");
    return `${shortDate(range.createdFrom) || "…"} – ${shortDate(range.createdTo) || "…"}`;
  })();
  const clearFilters = () => {
    setQuery("");
    setRequesterFilter("");
    setFlowFilter("");
    setPeriodFilter(DEFAULT_PERIOD);
    setCustomRange({ from: "", to: "" });
    setRequestState("");
    setPage(1);
  };
  const toggleSort = (key: PaymentRequestSortKey) => {
    setSort((current) => (current?.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }));
    setPage(1);
  };
  const sortLabel = (key: PaymentRequestSortKey, label: string) => (
    <button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1.5 text-left hover:text-brand-600">
      {label}<SortIcon active={sort?.key === key} direction={sort?.direction ?? "desc"} />
    </button>
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03] sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t("paymentRequests")}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("prDescription")}</p>
        </div>
        {canCreate && (
          <Link href="/payment-requests/new"
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg bg-brand-500 px-5 text-sm font-semibold text-white hover:bg-brand-600">
            + {t("prCreate")}
          </Link>
        )}
      </header>

      {/* Thẻ lọc trạng thái (kiểu thẻ số liệu đơn hàng XNK) */}
      <div role="group" aria-label={t("status")} className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5 xl:gap-4">
        {STATE_CARDS.map((card) => {
          const summary = card.value ? summarizeStates([card.value]) : summarizeStates();
          const selected = requestState === card.value;
          const showAmount = card.value !== "paid" && card.value !== "completed";
          return (
            <button key={card.value || "all"} type="button" aria-pressed={selected} title={t(card.hintKey)} onClick={() => { setRequestState(card.value); setPage(1); }}
              className={`relative flex min-h-[126px] w-full min-w-0 flex-col gap-3 rounded-2xl border px-5 py-4 text-left transition-all duration-200 hover:shadow-md ${selected
                ? `${card.border} ${card.bg} shadow-sm`
                : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"}`}>
              {selected && <span className={`absolute right-4 top-4 h-2.5 w-2.5 animate-pulse rounded-full bg-current ${card.color}`} aria-hidden="true" />}
              <span className="flex min-w-0 items-center gap-2.5 pr-4">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${selected ? `${card.bg} ${card.color}` : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"}`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={card.icon} /></svg>
                </span>
                <span className={`min-w-0 truncate text-sm font-semibold uppercase tracking-wide ${selected ? card.color : "text-gray-600 dark:text-gray-300"}`}>{t(card.labelKey)}</span>
              </span>
              <span className="flex min-w-0 items-start justify-between gap-2">
                <span className={`text-2xl font-bold leading-none tabular-nums ${selected ? card.color : "text-gray-800 dark:text-white/90"}`}>{summary.count}</span>
                {showAmount && (
                  <span className="flex min-w-0 flex-col items-end gap-0.5 text-right text-sm font-semibold leading-tight tabular-nums text-gray-700 dark:text-gray-200" title={`${t(card.amountKey)}: ${summary.amount}`}>
                    {summary.amountLines.map((amount) => <span key={amount} className="truncate">{amount}</span>)}
                  </span>
                )}
              </span>
              <span className="truncate text-[11px] text-gray-400 dark:text-gray-500">{t(card.amountKey)} · {t(card.hintKey)}</span>
            </button>
          );
        })}
      </div>

      {/* Thanh lọc (kiểu thanh lọc đơn hàng XNK) */}
      <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3.5 dark:border-gray-800 dark:bg-gray-900 md:flex-row md:flex-wrap md:items-end">
        <div className="min-w-0 md:w-72 md:flex-none">
          <label htmlFor="pr-filter-search" className={LABEL_CLASS}>{t("prSearchLabel")}</label>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input id="pr-filter-search" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={t("prSearch")}
              className={`${INPUT_CLASS} pl-9`} />
          </div>
        </div>
        <div className="w-full md:w-52">
          <label htmlFor="pr-filter-requester" className={LABEL_CLASS}>{t("prCreator")}</label>
          <select id="pr-filter-requester" value={requesterFilter} onChange={(event) => { setRequesterFilter(event.target.value); setPage(1); }} className={INPUT_CLASS}>
            <option value="">{t("prAllRequesters")}</option>
            {requesters.map((requester) => <option key={requester.id} value={requester.id}>{requester.username ? `${requester.name} · @${requester.username}` : requester.name}</option>)}
          </select>
        </div>
        <div className="w-full md:w-44">
          <label htmlFor="pr-filter-flow" className={LABEL_CLASS}>{t("prFlowFilter")}</label>
          <select id="pr-filter-flow" value={flowFilter} onChange={(event) => { setFlowFilter(event.target.value as "" | PaymentFlow); setPage(1); }} className={INPUT_CLASS}>
            <option value="">{t("prAllFlows")} ({flowCountTotal})</option>
            {availableFlows.map((flow) => <option key={flow} value={flow}>{t(`prFlow_${flow}`)} ({flowCounts[flow] ?? 0})</option>)}
          </select>
        </div>
        <div className="w-full md:w-48">
          <label htmlFor="pr-filter-period" className={LABEL_CLASS}>
            {t("prPeriodFilter")}
            {periodHint && <span className="ml-1 font-normal text-gray-400">· {periodHint}</span>}
          </label>
          <select id="pr-filter-period" value={periodFilter} onChange={(event) => { setPeriodFilter(event.target.value as PaymentRequestPeriod); setPage(1); }} className={INPUT_CLASS}>
            {PERIODS.map((period) => <option key={period.value} value={period.value}>{t(period.labelKey)}</option>)}
          </select>
        </div>
        {periodFilter === "custom" && (
          <div className="grid w-full grid-cols-2 gap-2 md:w-auto">
            <div className="min-w-0 md:w-40">
              <label htmlFor="pr-filter-from" className={LABEL_CLASS}>{t("prPeriodFrom")}</label>
              <input id="pr-filter-from" type="date" value={customRange.from} max={customRange.to || undefined}
                onChange={(event) => { setCustomRange((range) => ({ ...range, from: event.target.value })); setPage(1); }} className={INPUT_CLASS} />
            </div>
            <div className="min-w-0 md:w-40">
              <label htmlFor="pr-filter-to" className={LABEL_CLASS}>{t("prPeriodTo")}</label>
              <input id="pr-filter-to" type="date" value={customRange.to} min={customRange.from || undefined}
                onChange={(event) => { setCustomRange((range) => ({ ...range, to: event.target.value })); setPage(1); }} className={INPUT_CLASS} />
            </div>
          </div>
        )}
        {hasActiveFilter && (
          <button type="button" onClick={clearFilters}
            className="h-10 shrink-0 rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]">
            {t("prClearFilters")}
          </button>
        )}
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">

        {loading && requests.length > 0 && (
          <div role="status" aria-live="polite" className="flex items-center gap-2 border-b border-gray-100 bg-brand-50/60 px-4 py-2 text-xs font-medium text-brand-700 dark:border-gray-800 dark:bg-brand-500/10 dark:text-brand-300">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
            {t("loading")}
          </div>
        )}

        {error ? (
          <div className="p-6 text-center">
            <p className="break-words text-sm text-error-600 dark:text-error-400">{error}</p>
            <button type="button" onClick={reload} className="mt-3 h-10 rounded-lg border border-gray-200 px-4 text-sm font-medium dark:border-gray-700 dark:text-gray-200">{t("prRetry")}</button>
          </div>
        ) : loading && requests.length === 0 ? (
          <div className="flex justify-center py-16"><div className="h-9 w-9 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>
        ) : requests.length === 0 ? (
          <p className="py-16 text-center text-sm text-gray-500">{t("prEmpty")}</p>
        ) : (
          <div aria-busy={loading} className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            {/* Điện thoại / tablet: thẻ */}
            <ul className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 lg:hidden">
              {requests.map((request) => (
                <li key={request.id}>
                  <button type="button" onClick={() => openDetail(request.id)}
                    className="flex h-full w-full min-w-0 flex-col gap-2 rounded-xl border border-gray-200 p-4 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/30 dark:border-gray-700 dark:hover:border-brand-500/50">
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="font-mono text-sm font-semibold text-brand-600 dark:text-brand-400">{request.id}</span>
                      <PaymentStatusBadge status={request.status} draft={!request.sent} />
                    </span>
                    <BankPaidHint status={request.status} bankPayment={request.bankPayment} />
                    <span className="line-clamp-2 break-words text-sm font-medium text-gray-800 dark:text-white/90">{request.content}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold tabular-nums text-gray-900 dark:text-white">{money(request)}</span>
                      {request.hasRed && <RedFlowBadge />}
                    </span>
                    <span className="flex w-full flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-gray-500">
                      <span className="truncate">{request.creatorName} · {t("prCostCount", { count: request.costCount })}</span>
                      <span className={dueClass(request)}>{t("prDueDate")}: {formatDueDate(request.dueDate)}</span>
                    </span>
                    <span className="w-full space-y-0.5 border-t border-gray-100 pt-2 text-left text-xs text-gray-500 dark:border-gray-800">
                      <span className="block truncate" title={costGroups(request).join(", ")}>{t("prCostTypeLabel")}: {costGroups(request).join(", ") || "—"}</span>
                      <span className="block truncate" title={costTargetText(request)}>{t("prContractNumber")}: {costTargets(request).contracts.join(", ") || "—"}</span>
                      <span className="block truncate text-gray-400" title={costTargetText(request)}>{t("prContainer")}: {costTargets(request).containers.join(", ") || "—"}</span>
                      <span className="block truncate" title={costNames(request).join(", ")}>{t("prCosts")}: {costNames(request).join(", ") || "—"}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {/* Màn lớn: bảng */}
            <div className="hidden overflow-x-auto custom-scrollbar lg:block">
              <table className="w-full min-w-[1280px] table-fixed text-left">
                <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                  <tr>
                    <th className="w-[12%] px-4 py-3">{sortLabel("id", t("prCode"))}</th>
                    <th className="w-[12%] px-4 py-3">{sortLabel("creator", t("prCreator"))}</th>
                    <th className="w-[22%] px-4 py-3">{sortLabel("content", t("prContent"))}</th>
                    <th className="w-[14%] px-4 py-3">{sortLabel("cost", t("prCostTypeLabel"))}</th>
                    <th className="w-[16%] px-4 py-3">{t("prContractNumber")}</th>
                    <th className="w-[18%] px-4 py-3">{t("prCosts")}</th>
                    <th className="w-[15%] px-4 py-3 text-right">{sortLabel("total", t("prTotal"))}</th>
                    <th className="w-[10%] px-4 py-3">{sortLabel("due", t("prDueDate"))}</th>
                    <th className="w-[15%] px-4 py-3">{sortLabel("status", t("status"))}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {requests.map((request) => (
                    <tr key={request.id} onClick={() => openDetail(request.id)} className="cursor-pointer hover:bg-brand-50/40 dark:hover:bg-brand-500/5">
                      <td className="px-4 py-3">
                        <button type="button" onClick={(event) => { event.stopPropagation(); openDetail(request.id); }} className="font-mono text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">{request.id}</button>
                        <p className="text-xs text-gray-400">{formatDateTime(request.createdAt, language)}</p>
                      </td>
                      <td className="truncate px-4 py-3 text-sm text-gray-700 dark:text-gray-300" title={request.creatorName}>{request.creatorName || "—"}</td>
                      <td className="px-4 py-3">
                        <p className="truncate text-sm font-medium text-gray-800 dark:text-white/90" title={request.content}>{request.content}</p>
                        <p className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">{t("prCostCount", { count: request.costCount })}{request.hasRed && <RedFlowBadge />}</p>
                      </td>
                      <td className="px-4 py-3 align-top text-sm text-gray-700 dark:text-gray-300">
                        <p className="line-clamp-2" title={costGroups(request).join(", ")}>{costGroups(request).join(", ") || "—"}</p>
                      </td>
                      <td className="px-4 py-3 align-top text-sm text-gray-700 dark:text-gray-300">
                        <p className="truncate" title={costTargetText(request)}>{costTargets(request).contracts.join(", ") || "—"}</p>
                        <p className="truncate text-xs text-gray-500" title={costTargetText(request)}>{costTargets(request).containers.join(", ") || "—"}</p>
                      </td>
                      <td className="px-4 py-3 align-top text-sm text-gray-700 dark:text-gray-300">
                        <p className="line-clamp-2" title={costNames(request).join(", ")}>{costNames(request).join(", ") || "—"}</p>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{money(request)}</td>
                      <td className={`px-4 py-3 text-sm ${dueClass(request)}`}>{formatDueDate(request.dueDate)}</td>
                      <td className="px-4 py-3">
                        <PaymentStatusBadge status={request.status} draft={!request.sent} />
                        <BankPaidHint status={request.status} bankPayment={request.bankPayment} />
                        {request.approverName && <p className="mt-1 truncate text-xs text-gray-500" title={request.approverName}>{request.approverName}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!error && total > 0 && (
          <PaginationControls page={currentPage} totalPages={totalPages} pageSize={pageSize} totalItems={total} from={from} to={to} summaryKey="showingRecords" idPrefix="payment-requests"
            onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(Math.min(value, 100)); setPage(1); }} />
        )}
      </section>

    </div>
  );
}

export default function PaymentRequestsPage() {
  return (
    <Suspense fallback={null}>
      <PaymentRequestsContent />
    </Suspense>
  );
}
