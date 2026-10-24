"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PaginationControls from "@/components/common/PaginationControls";
import CostTrendChart, { KIND_BG } from "@/components/cost/CostTrendChart";
import { PaymentFlowBadge, formatDateTime, formatDueDate } from "@/components/payment/PaymentRequestParts";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import { recordActivity } from "@/services/activityLogApi";
import { exportCostOverviewExcel } from "@/services/costStatisticsExcel";
import { getCostOverview, type CostOverview } from "@/services/paymentCostApi";
import type { PaymentFlow } from "@/services/paymentRequestApi";
import {
  COST_BASES, COST_KINDS, COST_STATES, changePercent, compareCurrency, costState, currentMonth, isMonth, kindTotal, rankContracts,
  shiftMonth, summarizeCosts, summarizePayables, toCents, todayVn, topIncidents, trendMatrix, trendMonths,
  type CostBasis, type CostKind, type CostState, type MonthlyCost, type OpenRequest,
} from "@/utils/costStatistics";
import { formatMoney } from "@/utils/paymentRequest";
import { paginateItems } from "@/utils/pagination";

// Quản lý chi phí: trang tổng quan cho người quản lý / ban giám đốc (và kế toán đối soát). Trả lời theo thứ tự:
// 1. Tháng này tốn bao nhiêu, tăng / giảm so với tháng trước — tách chi phí vận hành, phát sinh, tiền hàng (tiền mua hàng).
// 2. Đang phải xử lý / trả bao nhiêu, khoản nào quá hạn, sắp đến hạn.  3. Xu hướng 6 tháng.
// 4. Tiền đi đâu: theo khoản phí, theo hợp đồng (bình quân mỗi container), phát sinh lớn.  5. Chi tiết + Xuất Excel.
// Một lần gọi BE (/payment-costs/overview) cho cả trang; tổng hợp, lọc, xuất Excel làm ở trình duyệt.

const DEFAULT_PAGE_SIZE = 20;
const TREND_MONTHS = 6;
const RATE_STORAGE_KEY = "xnk-cost-usd-rate";
const FLOWS: PaymentFlow[] = ["xanh", "vang", "do"];
const CARD = "rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]";
const CONTROL = "h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white";
const SECTION_TITLE = "text-base font-semibold text-gray-800 dark:text-white/90";
const STATE_STYLES: Record<CostState, string> = {
  none: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  draft: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  pending: "bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300",
  rejected: "bg-error-50 text-error-700 dark:bg-error-500/10 dark:text-error-300",
  approved: "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300",
  completed: "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300",
  cancelled: "bg-gray-100 text-gray-400 line-through dark:bg-gray-800 dark:text-gray-500",
};

function readRate(): string {
  try {
    return window.localStorage.getItem(RATE_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export default function CostManagementPage() {
  const { t, language } = useLanguage();
  const { can, user } = useAuth();
  const { notify } = useSystemNotification();
  const canView = can("costReports") || can("paymentRequestsAll");

  const [month, setMonth] = useState(() => currentMonth());
  const [basis, setBasis] = useState<CostBasis>("created");
  const [data, setData] = useState<CostOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [trendCurrency, setTrendCurrency] = useState("VND");
  const [rate, setRate] = useState("");
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<"" | CostState>("");
  const [kindFilter, setKindFilter] = useState<"" | CostKind>("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // Tỷ giá quy đổi USD -> VND (tuỳ chọn, chỉ để xem tổng quy đổi): nhớ trong trình duyệt của người dùng.
  useEffect(() => {
    const timer = window.setTimeout(() => setRate(readRate()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!canView || !isMonth(month)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      getCostOverview(month, basis, controller.signal)
        .then((result) => {
          setData(result);
          setPage(1);
        })
        .catch((loadError: unknown) => {
          if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : t("cmLoadError"));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [basis, canView, month, reloadKey, t]);

  const costs = useMemo(() => data?.costs ?? [], [data]);
  const summary = useMemo(() => summarizeCosts(costs), [costs]);
  const months = useMemo(() => trendMonths(month, TREND_MONTHS), [month]);
  const trendCurrencies = useMemo(() => [...new Set([...(data?.trend ?? []).map((point) => point.currency), ...summary.currencies.map((item) => item.currency)])].sort(compareCurrency), [data, summary]);
  const chartCurrency = trendCurrencies.includes(trendCurrency) ? trendCurrency : trendCurrencies[0] || "VND";
  const chartMatrix = useMemo(() => trendMatrix(data?.trend ?? [], months, chartCurrency), [chartCurrency, data, months]);
  const chartKinds = COST_KINDS.filter((kind) => months.some((item) => chartMatrix[item][kind] > BigInt(0)));
  const payables = useMemo(() => summarizePayables(data?.payables ?? [], todayVn()), [data]);
  const contracts = useMemo(() => rankContracts(costs, data?.contracts ?? []), [costs, data]);
  const incidents = useMemo(() => topIncidents(costs), [costs]);
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("vi");
    return costs.filter((cost) => {
      if (stateFilter && costState(cost) !== stateFilter) return false;
      if (kindFilter && cost.kind !== kindFilter) return false;
      if (!term) return true;
      return [cost.categoryName, cost.code, cost.contract, cost.container, cost.requestId, cost.userName, cost.note, cost.id]
        .some((value) => value.toLocaleLowerCase("vi").includes(term));
    });
  }, [costs, kindFilter, query, stateFilter]);
  const pageData = paginateItems(filtered, page, pageSize);

  if (!canView) {
    return <div className={`${CARD} p-8 text-center text-sm text-gray-600 dark:text-gray-300`}>{t("prNoPermission")}</div>;
  }

  const locale = language === "en" ? "en-US" : "vi-VN";
  const monthLabel = (value: string) => `${value.slice(5, 7)}/${value.slice(0, 4)}`;
  const shortMonth = (value: string) => `${t("cmMonthShort")}${Number(value.slice(5, 7))}`;
  const money = (value: string | null, currency: string) => (value === null ? t("cmHidden") : formatMoney(value, currency, language));
  const centsMoney = (cents: bigint, currency: string) => formatMoney(`${cents / BigInt(100)}.${(cents % BigInt(100)).toString().padStart(2, "0")}`, currency, language);
  const compact = (value: number, currency: string) => {
    if (currency === "USD") return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
    if (value >= 1e9) return `${(value / 1e9).toLocaleString(locale, { maximumFractionDigits: 1 })} ${t("cmBillionShort")}`;
    if (value >= 1e6) return `${(value / 1e6).toLocaleString(locale, { maximumFractionDigits: 1 })} ${t("cmMillionShort")}`;
    if (value >= 1e3) return `${(value / 1e3).toLocaleString(locale, { maximumFractionDigits: 0 })}K`;
    return String(Math.round(value));
  };
  const kindLabel = (kind: CostKind) => t(`cmKind_${kind}`);
  const targetLabel = (cost: MonthlyCost) => [cost.contract && `${t("prContract")} ${cost.contract}`, cost.container && `${t("prContainer")} ${cost.container}`].filter(Boolean).join(" · ");
  const previous = shiftMonth(month, -1);
  const usdRate = Number(rate.replace(/[.,\s]/g, "")) || 0;
  const amountsHiddenForGoods = Boolean(data?.amountsHidden) && costs.some((cost) => cost.kind === "goods");
  const operatingVnd = toCents(kindTotal(summary, "operating", "VND").total);
  const incidentVnd = toCents(kindTotal(summary, "incident", "VND").total);
  const incidentShare = operatingVnd + incidentVnd > BigInt(0) ? Math.round(Number((incidentVnd * BigInt(1000)) / (operatingVnd + incidentVnd))) / 10 : null;
  const convertedTotal = (kinds: CostKind[]) => kinds.reduce((sum, kind) => sum + toCents(kindTotal(summary, kind, "VND").total) + toCents(kindTotal(summary, kind, "USD").total) * BigInt(usdRate), BigInt(0));
  const totalsLine = (totals: Array<{ currency: string; total: string }>) => totals.map((item) => formatMoney(item.total, item.currency, language)).join(" + ") || "—";
  const notes = [
    data?.truncated ? t("cmTruncatedNote") : "",
    summary.hiddenCount > 0 ? t("cmHiddenNote") : "",
    summary.cancelledCount > 0 ? t("cmCancelledNote", { count: summary.cancelledCount }) : "",
    costs.some((cost) => cost.currencyInferred) ? t("cmInferredNote") : "",
  ].filter(Boolean);

  const exportExcel = async () => {
    if (exporting || loading || !data) return;
    if (costs.length === 0 && data.payables.length === 0) return notify(t("exportExcelEmpty"), "warning");
    setExporting(true);
    try {
      const fileName = await exportCostOverviewExcel({ overview: data, t, basisLabel: t(`cmBasis_${basis}`) });
      notify(t("cmExported", { file: fileName }), "success");
      recordActivity(user, { action: "EXPORT_EXCEL", location: "CostManagement", detail: `Thống kê chi phí tháng ${monthLabel(month)} (theo ${t(`cmBasis_${basis}`)}); ${costs.length} khoản` });
    } catch (exportError) {
      notify(exportError instanceof Error ? exportError.message : t("exportExcelError"), "error");
    } finally {
      setExporting(false);
    }
  };

  const changeMonth = (value: string) => {
    if (!isMonth(value)) return;
    setMonth(value);
    setQuery("");
    setStateFilter("");
    setKindFilter("");
  };
  const saveRate = (value: string) => {
    setRate(value);
    try {
      window.localStorage.setItem(RATE_STORAGE_KEY, value);
    } catch {
      // Trình duyệt chặn lưu: vẫn dùng được trong phiên.
    }
  };

  /** So với tháng trước (cùng loại tiền, cùng mốc thời gian): tăng chi phí = đỏ ▲, giảm = xanh ▼, luôn kèm chữ. */
  const delta = (kind: CostKind, currency: string) => {
    const matrix = trendMatrix(data?.trend ?? [], [previous, month], currency);
    const percent = changePercent(matrix[month][kind], matrix[previous][kind]);
    if (percent === null) return <span className="text-xs text-gray-400">{t("cmNoCompare")}</span>;
    const up = percent > 0;
    const tone = percent === 0 ? "text-gray-500" : up ? "text-error-600 dark:text-error-400" : "text-success-600 dark:text-success-400";
    return (
      <span className={`text-xs font-semibold ${tone}`}>
        {percent === 0 ? "=" : up ? "▲" : "▼"} {Math.abs(percent).toLocaleString(locale)}% <span className="font-normal text-gray-500">{t("cmVsMonth", { month: monthLabel(previous) })}</span>
      </span>
    );
  };

  /** Ô số liệu của một nhóm: giá trị (VND trước, loại tiền khác dòng phụ), so tháng trước, phần đã duyệt. */
  const kindTile = (kind: CostKind, extra?: React.ReactNode) => {
    const lines = summary.currencies.map((item) => kindTotal(summary, kind, item.currency)).filter((item) => item.count > 0);
    const main = lines[0];
    return (
      <article className={`${CARD} min-w-0 p-4 sm:p-5`}>
        <p className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300"><span className={`h-2.5 w-2.5 rounded-sm ${KIND_BG[kind]}`} aria-hidden="true" />{kindLabel(kind)}</p>
        <p className="mt-2 break-words text-2xl font-bold tabular-nums text-gray-900 dark:text-white">{main ? formatMoney(main.total, main.currency, language) : formatMoney("0", "VND", language)}</p>
        {lines.slice(1).map((item) => <p key={item.currency} className="break-words text-sm font-semibold tabular-nums text-gray-700 dark:text-gray-200">+ {formatMoney(item.total, item.currency, language)}</p>)}
        <div className="mt-1.5">{kind === "goods" && amountsHiddenForGoods ? <span className="text-xs text-gray-400">{t("cmHiddenShort")}</span> : delta(kind, main?.currency || "VND")}</div>
        {main && <p className="mt-2 text-xs text-gray-500">{t("cmPaidOf", { paid: formatMoney(main.paid, main.currency, language), count: main.count })}</p>}
        {extra}
      </article>
    );
  };

  const requestRow = (request: OpenRequest) => (
    <li key={request.id} className="flex min-w-0 items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <Link href={`/payment-requests/${encodeURIComponent(request.id)}`} className="font-mono text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">{request.id}</Link>
        {request.hasRed && <span className="ml-1.5 rounded bg-error-50 px-1 text-[10px] font-semibold text-error-700 dark:bg-error-500/10 dark:text-error-300">{t("cmRedFlow")}</span>}
        <p className="truncate text-xs text-gray-600 dark:text-gray-300" title={request.content}>{request.content}</p>
        <p className="text-[11px] text-gray-400">{request.requester} · {request.status === 0 ? t("cmState_pending") : t("cmState_approved")}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{money(request.total, request.currency)}</p>
        <p className="text-[11px] text-gray-500">{t("prDueDate")}: {formatDueDate(request.dueDate)}</p>
      </div>
    </li>
  );

  return (
    <div className="space-y-5">
      {/* Bộ lọc: một khối, áp cho cả trang */}
      <header className={`${CARD} space-y-4 p-4 sm:p-6`}>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t("cmTitle")}</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("cmDescription")}</p>
          </div>
          <button type="button" onClick={() => void exportExcel()} disabled={exporting || loading || !data}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-success-600 px-4 text-sm font-semibold text-white hover:bg-success-700 disabled:opacity-50">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
            {exporting ? t("cmExporting") : t("cmExport", { month: monthLabel(month) })}
          </button>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
          <div className="min-w-0">
            <p className="mb-1 text-xs font-medium text-gray-500">{t("cmMonth")}</p>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => changeMonth(shiftMonth(month, -1))} aria-label={t("cmPrevMonth")} title={t("cmPrevMonth")}
                className="h-10 w-10 shrink-0 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">‹</button>
              <input type="month" value={month} onChange={(event) => changeMonth(event.target.value)} aria-label={t("cmMonth")} className={`${CONTROL} sm:w-44`} />
              <button type="button" onClick={() => changeMonth(shiftMonth(month, 1))} aria-label={t("cmNextMonth")} title={t("cmNextMonth")}
                className="h-10 w-10 shrink-0 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">›</button>
            </div>
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-xs font-medium text-gray-500">{t("cmBasis")}</p>
            <div role="radiogroup" aria-label={t("cmBasis")} className="grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
              {COST_BASES.map((value) => (
                <button key={value} type="button" role="radio" aria-checked={basis === value} onClick={() => setBasis(value)} title={t(`cmBasisHint_${value}`)}
                  className={`min-h-8 whitespace-nowrap rounded-lg px-2 text-[13px] font-medium sm:px-3 sm:text-sm ${basis === value ? "bg-white text-brand-700 shadow-theme-xs dark:bg-gray-900 dark:text-brand-300" : "text-gray-600 dark:text-gray-300"}`}>
                  {t(`cmBasis_${value}`)}
                </button>
              ))}
            </div>
          </div>
          <label className="min-w-0 lg:w-52">
            <span className="mb-1 block text-xs font-medium text-gray-500">{t("cmRate")}</span>
            <input inputMode="numeric" value={rate} onChange={(event) => saveRate(event.target.value)} placeholder={t("cmRatePlaceholder")} className={CONTROL} />
          </label>
        </div>
        <p className="text-xs text-gray-500">{t(`cmBasisHint_${basis}`)}</p>
      </header>

      {error ? (
        <div className={`${CARD} p-6 text-center`}>
          <p className="break-words text-sm text-error-600 dark:text-error-400">{error}</p>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="mt-3 h-10 rounded-lg border border-gray-200 px-4 text-sm font-medium dark:border-gray-700 dark:text-gray-200">{t("prRetry")}</button>
        </div>
      ) : !data ? (
        <div className={`${CARD} flex justify-center py-16`}><div className="h-9 w-9 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>
      ) : (
        // Đang tải lại (đổi tháng / mốc): giữ khung cũ, mờ đi, không nhảy bố cục.
        <div className={`space-y-5 ${loading ? "opacity-60 transition-opacity" : ""}`} aria-busy={loading}>
          {/* 1. Tháng này tốn bao nhiêu (tách vận hành / phát sinh / tiền hàng) + đề nghị cần xử lý */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={t("cmKpiSection")}>
            {kindTile("operating")}
            {kindTile("incident", incidentShare !== null && <p className="mt-1 text-xs text-gray-500">{t("cmIncidentShare", { percent: incidentShare.toLocaleString(locale) })}</p>)}
            {kindTile("goods")}
            <article className={`${CARD} min-w-0 p-4 sm:p-5`}>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{t("cmOpenRequests")}</p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">{payables.all.requests.length}</p>
              <p className="break-words text-sm font-semibold tabular-nums text-gray-700 dark:text-gray-200">{totalsLine(payables.all.totals)}</p>
              <dl className="mt-2 space-y-1 text-xs">
                <div className="flex justify-between gap-2"><dt className="text-gray-500">{t("cmState_pending")}</dt><dd className="font-semibold tabular-nums text-gray-800 dark:text-white/90">{payables.pending.requests.length}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-gray-500">{t("cmApprovedOpen")}</dt><dd className="font-semibold tabular-nums text-gray-800 dark:text-white/90">{payables.approved.requests.length}</dd></div>
                <div className="flex justify-between gap-2">
                  <dt className={payables.overdue.requests.length ? "font-semibold text-error-600 dark:text-error-400" : "text-gray-500"}>{payables.overdue.requests.length ? "⚠ " : ""}{t("cmOverdue")}</dt>
                  <dd className={`font-semibold tabular-nums ${payables.overdue.requests.length ? "text-error-600 dark:text-error-400" : "text-gray-800 dark:text-white/90"}`}>{payables.overdue.requests.length}</dd>
                </div>
              </dl>
            </article>
          </section>

          {usdRate > 0 && (
            <p className={`${CARD} px-4 py-3 text-sm text-gray-700 dark:text-gray-300`}>
              {t("cmConverted", {
                rate: usdRate.toLocaleString(locale),
                costs: centsMoney(convertedTotal(["operating", "incident"]), "VND"),
                goods: centsMoney(convertedTotal(["goods"]), "VND"),
                total: centsMoney(convertedTotal([...COST_KINDS]), "VND"),
              })}
            </p>
          )}

          {notes.length > 0 && (
            <ul className="space-y-1 rounded-xl bg-gray-50 px-4 py-3 text-xs text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
              {notes.map((note) => <li key={note} className="break-words">• {note}</li>)}
            </ul>
          )}

          {/* 2–3. Xu hướng 6 tháng + cần chú ý */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <section className={`${CARD} min-w-0 p-4 sm:p-5`}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className={SECTION_TITLE}>{t("cmTrend", { count: TREND_MONTHS })}</h2>
                {trendCurrencies.length > 1 && (
                  <div role="radiogroup" aria-label={t("cmCurrency")} className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
                    {trendCurrencies.map((currency) => (
                      <button key={currency} type="button" role="radio" aria-checked={chartCurrency === currency} onClick={() => setTrendCurrency(currency)}
                        className={`min-h-7 rounded-md px-2.5 text-xs font-semibold ${chartCurrency === currency ? "bg-white text-brand-700 shadow-theme-xs dark:bg-gray-900 dark:text-brand-300" : "text-gray-600 dark:text-gray-300"}`}>{currency}</button>
                    ))}
                  </div>
                )}
              </div>
              <CostTrendChart months={months} matrix={chartMatrix} kinds={chartKinds.length ? chartKinds : ["operating"]} current={month}
                kindLabel={kindLabel} monthLabel={shortMonth} formatValue={(cents) => centsMoney(cents, chartCurrency)} compact={(value) => compact(value, chartCurrency)}
                totalLabel={t("cmTotal")} tableLabel={t("cmTrendTable")} monthHeader={t("cmMonth")} emptyLabel={t("cmTrendEmpty")} />
            </section>

            <section className={`${CARD} min-w-0 p-4 sm:p-5`}>
              <h2 className={SECTION_TITLE}>{t("cmAttention")}</h2>
              <div className="mt-3 space-y-4">
                <div>
                  <p className={`text-sm font-semibold ${payables.overdue.requests.length ? "text-error-600 dark:text-error-400" : "text-gray-700 dark:text-gray-200"}`}>
                    {t("cmOverdueTitle", { count: payables.overdue.requests.length })} <span className="font-normal text-gray-500">· {totalsLine(payables.overdue.totals)}</span>
                  </p>
                  {payables.overdue.requests.length ? <ul className="divide-y divide-gray-100 dark:divide-gray-800">{payables.overdue.requests.slice(0, 5).map(requestRow)}</ul> : <p className="text-xs text-gray-400">{t("cmNone")}</p>}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t("cmDueSoonTitle", { count: payables.dueSoon.requests.length })} <span className="font-normal text-gray-500">· {totalsLine(payables.dueSoon.totals)}</span></p>
                  {payables.dueSoon.requests.length ? <ul className="divide-y divide-gray-100 dark:divide-gray-800">{payables.dueSoon.requests.slice(0, 5).map(requestRow)}</ul> : <p className="text-xs text-gray-400">{t("cmNone")}</p>}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t("cmTopIncidents")}</p>
                  {incidents.length ? (
                    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                      {incidents.map((cost) => (
                        <li key={cost.id} className="flex min-w-0 items-start justify-between gap-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm text-gray-800 dark:text-white/90" title={cost.categoryName}>{cost.categoryName}</p>
                            <p className="truncate text-[11px] text-gray-400">{[targetLabel(cost), cost.requestId].filter(Boolean).join(" · ") || cost.userName}</p>
                          </div>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{money(cost.amount, cost.currency)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-xs text-gray-400">{t("cmNone")}</p>}
                </div>
              </div>
            </section>
          </div>

          {/* 4. Tiền đi đâu */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <section className={`${CARD} min-w-0 p-4 sm:p-5`}>
              <h2 className={SECTION_TITLE}>{t("cmStructure")}</h2>
              {summary.byKind.length === 0 ? <p className="mt-3 text-sm text-gray-400">{t("cmEmpty", { month: monthLabel(month) })}</p> : (
                <div className="mt-3 space-y-4">
                  {summary.byKind.map((group) => {
                    const fees = summary.byFee.filter((fee) => fee.kind === group.kind && fee.currency === group.currency);
                    const groupCents = toCents(group.total);
                    return (
                      <div key={`${group.kind}-${group.currency}`}>
                        <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                          <span className="flex items-center gap-2 font-semibold text-gray-700 dark:text-gray-200"><span className={`h-2.5 w-2.5 rounded-sm ${KIND_BG[group.kind]}`} aria-hidden="true" />{kindLabel(group.kind)} · {group.currency}</span>
                          <span className="font-semibold tabular-nums text-gray-900 dark:text-white">{formatMoney(group.total, group.currency, language)}</span>
                        </p>
                        <ul className="mt-1.5 space-y-1.5">
                          {fees.slice(0, 6).map((fee) => {
                            const share = groupCents > BigInt(0) ? Number((toCents(fee.total) * BigInt(1000)) / groupCents) / 10 : 0;
                            return (
                              <li key={fee.key} className="text-xs">
                                <div className="flex justify-between gap-2">
                                  <span className="min-w-0 truncate text-gray-600 dark:text-gray-300" title={fee.name}>{fee.name} <span className="text-gray-400">({fee.count})</span></span>
                                  <span className="shrink-0 tabular-nums text-gray-700 dark:text-gray-200">{formatMoney(fee.total, fee.currency, language)} · {share.toLocaleString(locale)}%</span>
                                </div>
                                <div className="mt-0.5 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800"><div className={`h-1.5 rounded-full ${KIND_BG[group.kind]}`} style={{ width: `${Math.max(share, 1)}%` }} /></div>
                              </li>
                            );
                          })}
                          {fees.length > 6 && <li className="text-[11px] text-gray-400">{t("cmMoreFees", { count: fees.length - 6 })}</li>}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className={`${CARD} min-w-0`}>
              <div className="p-4 sm:p-5">
                <h2 className={SECTION_TITLE}>{t("cmByContract")}</h2>
                <p className="mt-0.5 text-xs text-gray-500">{t("cmByContractHint")}</p>
              </div>
              {contracts.length === 0 ? <p className="px-5 pb-5 text-sm text-gray-400">{t("cmNone")}</p> : (
                <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                      <tr>
                        <th className="px-4 py-2.5">{t("cmContract")}</th>
                        <th className="px-4 py-2.5 text-right">{t("cmTotal")}</th>
                        <th className="px-4 py-2.5 text-right">{t("cmContainers")}</th>
                        <th className="px-4 py-2.5 text-right">{t("cmPerContainer")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {contracts.map((item) => (
                        <tr key={`${item.contract}-${item.currency}`}>
                          <td className="px-4 py-2.5">
                            <p className="font-mono font-semibold text-gray-800 dark:text-white/90">{item.contract}</p>
                            {item.supplier && <p className="max-w-[220px] truncate text-xs text-gray-500" title={item.supplier}>{item.supplier}</p>}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold tabular-nums text-gray-900 dark:text-white">{formatMoney(item.total, item.currency, language)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-300">{item.containers || "—"}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-200">{item.perContainer ? formatMoney(item.perContainer, item.currency, language) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          {/* 5. Chi tiết từng khoản (kế toán đối soát) */}
          <section className={CARD}>
            <div className="flex flex-col gap-3 border-b border-gray-100 p-4 dark:border-gray-800 sm:px-5">
              <h2 className={SECTION_TITLE}>{t("cmDetail")} <span className="text-sm font-normal text-gray-500">({filtered.length})</span></h2>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_200px_200px]">
                <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={t("cmSearch")} aria-label={t("cmSearch")} className={CONTROL} />
                <select value={stateFilter} onChange={(event) => { setStateFilter(event.target.value as "" | CostState); setPage(1); }} aria-label={t("cmState")} className={CONTROL}>
                  <option value="">{t("cmAllStates")}</option>
                  {COST_STATES.map((state) => <option key={state} value={state}>{t(`cmState_${state}`)}</option>)}
                </select>
                <select value={kindFilter} onChange={(event) => { setKindFilter(event.target.value as "" | CostKind); setPage(1); }} aria-label={t("cmKind")} className={CONTROL}>
                  <option value="">{t("cmAllKinds")}</option>
                  {COST_KINDS.map((kind) => <option key={kind} value={kind}>{kindLabel(kind)}</option>)}
                </select>
              </div>
            </div>
            {filtered.length === 0 ? (
              <p className="py-12 text-center text-sm text-gray-500">{costs.length ? t("mcEmpty") : t("cmEmpty", { month: monthLabel(month) })}</p>
            ) : (
              <>
                <ul className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 lg:hidden">
                  {pageData.items.map((cost) => (
                    <li key={cost.id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 break-words text-sm font-medium text-gray-800 dark:text-white/90"><span className={`h-2 w-2 shrink-0 rounded-sm ${KIND_BG[cost.kind]}`} aria-hidden="true" />{cost.categoryName}</p>
                          {cost.note && <p className="break-words text-xs text-gray-600 dark:text-gray-300">{cost.note}</p>}
                          <p className="truncate text-xs text-gray-500">{kindLabel(cost.kind)}{targetLabel(cost) ? ` · ${targetLabel(cost)}` : ""}</p>
                        </div>
                        <span className="shrink-0 text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{money(cost.amount, cost.currency)}</span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATE_STYLES[costState(cost)]}`}>{t(`cmState_${costState(cost)}`)}</span>
                          {cost.requestId && <Link href={`/payment-requests/${encodeURIComponent(cost.requestId)}`} className="font-mono text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">{cost.requestId}</Link>}
                        </span>
                        <span className="truncate text-xs text-gray-400">{cost.userName} · {formatDateTime(cost.basisDate, language)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto custom-scrollbar lg:block">
                  <table className="w-full min-w-[1100px] table-fixed text-left">
                    <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                      <tr>
                        <th className="w-[11%] px-4 py-3">{t(`cmBasis_${basis}`)}</th>
                        <th className="w-[22%] px-4 py-3">{t("mcFee")}</th>
                        <th className="w-[17%] px-4 py-3">{t("mcTarget")}</th>
                        <th className="w-[15%] px-4 py-3 text-right">{t("cmAmount")}</th>
                        <th className="w-[12%] px-4 py-3">{t("cmState")}</th>
                        <th className="w-[11%] px-4 py-3">{t("cmRequest")}</th>
                        <th className="w-[12%] px-4 py-3">{t("cmEnteredBy")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {pageData.items.map((cost) => (
                        <tr key={cost.id} className="align-top">
                          <td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(cost.basisDate, language)}</td>
                          <td className="px-4 py-3">
                            <p className="flex items-center gap-1.5 truncate text-sm font-medium text-gray-800 dark:text-white/90" title={cost.categoryName}><span className={`h-2 w-2 shrink-0 rounded-sm ${KIND_BG[cost.kind]}`} aria-hidden="true" />{cost.categoryName}</p>
                            {cost.note && <p className="line-clamp-2 break-words text-xs text-gray-600 dark:text-gray-300" title={cost.note}>{cost.note}</p>}
                            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-400">
                              {cost.code} · {kindLabel(cost.kind)}
                              {FLOWS.includes(cost.flow as PaymentFlow) && <PaymentFlowBadge flow={cost.flow as PaymentFlow} />}
                            </p>
                          </td>
                          <td className="px-4 py-3"><p className="truncate font-mono text-xs text-gray-600 dark:text-gray-300" title={targetLabel(cost)}>{targetLabel(cost) || "—"}</p></td>
                          <td className="px-4 py-3 text-right text-sm">
                            <span className="font-semibold tabular-nums text-gray-900 dark:text-white">{money(cost.amount, cost.currency)}</span>
                            {cost.currencyInferred && cost.amount !== null && <span className="ml-1 text-[11px] text-gray-400" title={t("cmInferredNote")}>({t("cmInferredBadge")})</span>}
                            {cost.vat && <span className="block text-[11px] text-gray-500">{t("prVatIncludedRate", { rate: String(Number(cost.vat)) })}</span>}
                          </td>
                          <td className="px-4 py-3"><span className={`inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATE_STYLES[costState(cost)]}`}><span className="truncate">{t(`cmState_${costState(cost)}`)}</span></span></td>
                          <td className="px-4 py-3">{cost.requestId ? <Link href={`/payment-requests/${encodeURIComponent(cost.requestId)}`} className="font-mono text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">{cost.requestId}</Link> : <span className="text-sm text-gray-400">—</span>}</td>
                          <td className="truncate px-4 py-3 text-sm text-gray-700 dark:text-gray-300" title={cost.userName}>{cost.userName || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <PaginationControls page={pageData.safePage} totalPages={pageData.totalPages} pageSize={pageSize} totalItems={pageData.total} from={pageData.from} to={pageData.to}
                  summaryKey="showingRecords" idPrefix="cost-management" onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
