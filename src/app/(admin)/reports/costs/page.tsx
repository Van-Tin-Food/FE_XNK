"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import PaginationControls from "@/components/common/PaginationControls";
import { formatDueDate } from "@/components/payment/PaymentRequestParts";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import { recordActivity } from "@/services/activityLogApi";
import { exportCostOverviewExcel } from "@/services/costStatisticsExcel";
import { getCostOverview, type CostOverview } from "@/services/paymentCostApi";
import {
  COST_KINDS, SETTLEMENT_STAGES, agePayables, currentMonth, groupByRequest, isMonth, shiftMonth, stageMoney, sumMoney,
  summarizeCosts, summarizeShipments, todayVn,
  type AgedPayable, type ContainerTotals, type CostState, type Money, type SettlementStage, type ShipmentTotals,
} from "@/utils/costStatistics";
import { formatMoney } from "@/utils/paymentRequest";
import { paginateItems } from "@/utils/pagination";

// Báo cáo chi phí & công nợ phải trả (chỉ admin: chức năng costReports chỉ admin có). Cấu trúc báo cáo quản trị:
// I. Chỉ tiêu tổng hợp của kỳ; II. Tình hình thanh toán các khoản phát sinh trong kỳ (kèm dự kiến dòng tiền chi);
// III. Tuổi nợ phải trả (tính đến hôm nay, mọi kỳ); IV. Cơ cấu chi phí theo khoản mục; V. Giá vốn nhập khẩu (landed cost)
// theo lô hàng / container; VI. Bảng kê đề nghị thanh toán của kỳ. Số liệu theo nguyên tệ (VND, USD riêng), không quy đổi.
// Một lần gọi BE (/payment-costs/overview); tổng hợp, lọc, xuất Excel làm ở trình duyệt.

const PREVIEW = 10;
const DEFAULT_PAGE_SIZE = 20;
const CARD = "rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]";
const CONTROL = "h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white";
const BUTTON = "h-10 shrink-0 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800";
const LINK_BUTTON = "text-sm font-medium text-brand-600 hover:underline dark:text-brand-400";
const ROW_LABEL = "text-xs text-gray-500 dark:text-gray-400 sm:hidden";
const REQUEST_FILTERS: Array<"" | CostState> = ["", "pending", "approved", "paid", "completed", "rejected", "draft", "cancelled"];
const OPEN_STATES: CostState[] = ["draft", "pending", "approved"];
const OVERDUE_BUCKETS = ["overdue30", "overdue60", "overdue90", "overdueOver90"];
const ROMAN = ["I", "II", "III", "IV", "V", "VI"];

function Section({ index, title, hint, actions, children }: { index: number; title: string; hint?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className={`${CARD} min-w-0`}>
      <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800 sm:px-5 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">{ROMAN[index]}. {title}</h2>
          {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export default function CostReportPage() {
  const { t, language } = useLanguage();
  const { can, user } = useAuth();
  const { notify } = useSystemNotification();
  const canView = can("costReports");

  const [month, setMonth] = useState(() => currentMonth());
  const [data, setData] = useState<CostOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [requestFilter, setRequestFilter] = useState<"" | CostState>("");
  const [showAllRequests, setShowAllRequests] = useState(false);
  const [showAllPayables, setShowAllPayables] = useState(false);
  const [shipmentView, setShipmentView] = useState<"lots" | "containers">("lots");
  const [shipmentQuery, setShipmentQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    if (!canView || !isMonth(month)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      getCostOverview(month, controller.signal)
        .then((result) => {
          setData(result);
          setPage(1);
          setShowAllRequests(false);
          setShowAllPayables(false);
        })
        .catch((loadError: unknown) => {
          if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : t("rpLoadError"));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [canView, month, reloadKey, t]);

  const costs = useMemo(() => data?.costs ?? [], [data]);
  const summary = useMemo(() => summarizeCosts(costs), [costs]);
  const byRequest = useMemo(() => groupByRequest(costs), [costs]);
  const asOf = data?.payables.asOf || todayVn();
  const aging = useMemo(() => agePayables(data?.payables.rows ?? [], asOf), [data, asOf]);
  const shipments = useMemo(() => summarizeShipments(data?.shipments ?? [], data?.shipmentCosts ?? []), [data]);
  const term = shipmentQuery.trim().toLocaleLowerCase("vi");
  const lots = shipments.lots.filter((item) => !term || `${item.contract} ${item.supplier}`.toLocaleLowerCase("vi").includes(term));
  const containers = shipments.containers.filter((item) => !term || `${item.container} ${item.contract} ${item.supplier}`.toLocaleLowerCase("vi").includes(term));
  const lotPage = paginateItems<ShipmentTotals>(lots, page, pageSize);
  const containerPage = paginateItems<ContainerTotals>(containers, page, pageSize);
  const shipmentPage = shipmentView === "lots" ? lotPage : containerPage;

  if (!canView) {
    return <div className={`${CARD} p-8 text-center text-sm text-gray-600 dark:text-gray-300`}>{t("rpAdminOnly")}</div>;
  }

  const today = todayVn();
  const monthLabel = (value: string) => `${value.slice(5, 7)}/${value.slice(0, 4)}`;
  const money = (list: Money) => (list.length ? list.map((item) => formatMoney(item.total, item.currency, language)).join(" + ") : "—");
  const pick = (items: typeof summary.costs, field: "total" | "base" | "tax") => sumMoney(items.map((item) => ({ currency: item.currency, total: item[field] })));
  const stage = (s: SettlementStage) => {
    const expense = stageMoney(summary.costs, s);
    const purchases = stageMoney(summary.goods, s);
    return { count: expense.count + purchases.count, expense: expense.total, purchases: purchases.total, all: sumMoney(expense.total, purchases.total) };
  };
  const settled = stage("settled");
  const outstanding = SETTLEMENT_STAGES.filter((s) => s !== "settled").map(stage);
  const outstandingTotal = sumMoney(...outstanding.map((item) => item.all));
  const outstandingCount = outstanding.reduce((sum, item) => sum + item.count, 0);
  const costCount = summary.costs.reduce((sum, item) => sum + item.count, 0);
  const goodsCount = summary.goods.reduce((sum, item) => sum + item.count, 0);
  const requestRows = byRequest.requests.filter((item) => !requestFilter || item.state === requestFilter);
  const attention = showAllPayables ? aging.attention : aging.attention.slice(0, PREVIEW);
  const notes = [
    t("rpBasisNote"),
    t("rpCurrencyNote"),
    data?.truncated ? t("rpTruncatedNote") : "",
    data?.payables.truncated ? t("rpPayablesTruncatedNote") : "",
    summary.hiddenCount > 0 ? t("rpHiddenNote") : "",
    summary.cancelledCount > 0 ? t("rpCancelledNote", { count: summary.cancelledCount }) : "",
    costs.some((cost) => cost.currencyInferred) ? t("rpInferredNote") : "",
  ].filter(Boolean);

  const changeMonth = (value: string) => {
    if (!isMonth(value)) return;
    setMonth(value);
    setRequestFilter("");
    setShipmentQuery("");
  };

  const exportExcel = async () => {
    if (exporting || loading || !data) return;
    if (costs.length === 0 && aging.count === 0) return notify(t("exportExcelEmpty"), "warning");
    setExporting(true);
    try {
      const fileName = await exportCostOverviewExcel({ overview: data, t });
      notify(t("rpExported", { file: fileName }), "success");
      recordActivity(user, { action: "EXPORT_EXCEL", location: "CostReport", detail: `Báo cáo chi phí & công nợ phải trả tháng ${monthLabel(month)}; ${costs.length} khoản` });
    } catch (exportError) {
      notify(exportError instanceof Error ? exportError.message : t("exportExcelError"), "error");
    } finally {
      setExporting(false);
    }
  };

  const figure = (label: string, value: string, hint?: string) => (
    <div className="min-w-0 px-4 py-3 sm:px-5">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 break-words text-lg font-bold tabular-nums text-gray-900 dark:text-white sm:text-xl">{value}</p>
      {hint && <p className="mt-0.5 break-words text-xs text-gray-400">{hint}</p>}
    </div>
  );
  const amountCell = (label: string, value: string, strong = false) => (
    <div className="min-w-0 text-left sm:text-right">
      <p className={ROW_LABEL}>{label}</p>
      <p className={`break-words tabular-nums ${strong ? "font-semibold text-gray-900 dark:text-white" : "text-gray-700 dark:text-gray-300"}`}>{value}</p>
    </div>
  );
  const empty = <p className="px-5 py-6 text-sm text-gray-500">{t("rpNone")}</p>;
  const dueText = (item: AgedPayable) => {
    if (item.daysOverdue === null) return t("rpNoDueDate");
    if (item.daysOverdue > 0) return t("rpDaysOverdue", { days: item.daysOverdue });
    return item.daysOverdue === 0 ? t("rpDueToday") : t("rpDaysLeft", { days: -item.daysOverdue });
  };

  return (
    <div className="space-y-5">
      <header className={`${CARD} flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between`}>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t("rpTitle")}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("rpSubtitle", { month: monthLabel(month) })}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => changeMonth(shiftMonth(month, -1))} aria-label={t("rpPrevMonth")} title={t("rpPrevMonth")} className={`${BUTTON} w-10 px-0`}>‹</button>
            <input type="month" value={month} onChange={(event) => changeMonth(event.target.value)} aria-label={t("rpPeriod")} className={`${CONTROL} sm:w-44`} />
            <button type="button" onClick={() => changeMonth(shiftMonth(month, 1))} aria-label={t("rpNextMonth")} title={t("rpNextMonth")} className={`${BUTTON} w-10 px-0`}>›</button>
          </div>
          <button type="button" onClick={() => void exportExcel()} disabled={exporting || loading || !data}
            className="h-10 shrink-0 whitespace-nowrap rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
            {exporting ? t("rpExporting") : t("rpExport")}
          </button>
        </div>
      </header>

      {error ? (
        <div className={`${CARD} p-6 text-center`}>
          <p className="break-words text-sm text-error-600 dark:text-error-400">{error}</p>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)} className={`${BUTTON} mt-3`}>{t("prRetry")}</button>
        </div>
      ) : !data ? (
        <div className={`${CARD} flex justify-center py-16`}><div className="h-9 w-9 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>
      ) : (
        <div className={`space-y-5 ${loading ? "opacity-60 transition-opacity" : ""}`} aria-busy={loading}>
          {/* I. Chỉ tiêu tổng hợp */}
          <Section index={0} title={t("rpKeyFigures", { month: monthLabel(month) })}>
            {costs.length === 0 ? <p className="px-5 py-6 text-sm text-gray-500">{t("rpEmpty", { month: monthLabel(month) })}</p> : (
              <div className="grid grid-cols-1 divide-y divide-gray-100 dark:divide-gray-800 sm:grid-cols-2 xl:grid-cols-4 xl:divide-x xl:divide-y-0">
                {figure(t("rpExpense"), money(pick(summary.costs, "total")), t("rpExpenseHint", { base: money(pick(summary.costs, "base")), tax: money(pick(summary.costs, "tax")), count: costCount }))}
                {figure(t("rpPurchases"), summary.goods.length ? money(pick(summary.goods, "total")) : summary.hiddenCount ? t("rpHidden") : "—", t("rpPurchasesHint", { count: goodsCount }))}
                {figure(t("rpSettled"), money(settled.all), t("rpCountLine", { count: settled.count }))}
                {figure(t("rpOutstanding"), money(outstandingTotal), t("rpOutstandingHint", { count: outstandingCount }))}
              </div>
            )}
          </Section>

          {/* II. Tình hình thanh toán các khoản phát sinh trong kỳ */}
          <Section index={1} title={t("rpSettlement")} hint={t("rpSettlementHint")}>
            {costs.length === 0 ? empty : (
              <div className="text-sm">
                <div className="hidden grid-cols-[minmax(0,1.6fr)_80px_minmax(0,1fr)_minmax(0,1fr)] gap-3 bg-gray-50 px-5 py-2.5 text-xs font-semibold text-gray-500 dark:bg-gray-900 dark:text-gray-400 sm:grid">
                  <span>{t("rpStage")}</span><span className="text-right">{t("rpCount")}</span><span className="text-right">{t("rpExpenseShort")}</span><span className="text-right">{t("rpPurchasesShort")}</span>
                </div>
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {SETTLEMENT_STAGES.map((s) => {
                    const row = stage(s);
                    return (
                      <li key={s} className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-2.5 sm:grid-cols-[minmax(0,1.6fr)_80px_minmax(0,1fr)_minmax(0,1fr)] sm:px-5">
                        <div className="col-span-2 min-w-0 sm:col-span-1">
                          <p className="font-medium text-gray-800 dark:text-white/90">{t(`rpStage_${s}`)} <span className="text-xs font-normal text-gray-400 sm:hidden">· {t("rpCountLine", { count: row.count })}</span></p>
                          <p className="text-xs text-gray-400">{t(`rpStageHint_${s}`)}</p>
                        </div>
                        <p className="hidden text-right tabular-nums text-gray-600 dark:text-gray-300 sm:block">{row.count}</p>
                        {amountCell(t("rpExpenseShort"), money(row.expense))}
                        {amountCell(t("rpPurchasesShort"), money(row.purchases))}
                      </li>
                    );
                  })}
                  <li className="grid grid-cols-2 gap-x-3 gap-y-1 bg-gray-50 px-4 py-2.5 font-semibold dark:bg-white/[0.02] sm:grid-cols-[minmax(0,1.6fr)_80px_minmax(0,1fr)_minmax(0,1fr)] sm:px-5">
                    <p className="col-span-2 text-gray-800 dark:text-white/90 sm:col-span-1">{t("rpGrandTotal")} <span className="text-xs font-normal text-gray-400 sm:hidden">· {t("rpCountLine", { count: costCount + goodsCount })}</span></p>
                    <p className="hidden text-right tabular-nums text-gray-800 dark:text-white/90 sm:block">{costCount + goodsCount}</p>
                    {amountCell(t("rpExpenseShort"), money(pick(summary.costs, "total")), true)}
                    {amountCell(t("rpPurchasesShort"), money(pick(summary.goods, "total")), true)}
                  </li>
                </ul>
              </div>
            )}
          </Section>

          {/* III. Tuổi nợ phải trả */}
          <Section index={2} title={t("rpAging", { date: formatDueDate(asOf) })} hint={t("rpAgingHint")}>
            {aging.count === 0 ? <p className="px-5 py-6 text-sm text-gray-500">{t("rpNoPayables")}</p> : (
              <>
                <div className="text-sm">
                  <div className="hidden grid-cols-[minmax(0,1.6fr)_100px_minmax(0,1.4fr)] gap-3 bg-gray-50 px-5 py-2.5 text-xs font-semibold text-gray-500 dark:bg-gray-900 dark:text-gray-400 sm:grid">
                    <span>{t("rpAgingBucket")}</span><span className="text-right">{t("rpRequestCount")}</span><span className="text-right">{t("rpAmount")}</span>
                  </div>
                  <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                    {aging.rows.map((row) => (
                      <li key={row.bucket} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 px-4 py-2.5 sm:grid-cols-[minmax(0,1.6fr)_100px_minmax(0,1.4fr)] sm:px-5">
                        <p className={`min-w-0 ${OVERDUE_BUCKETS.includes(row.bucket) && row.count ? "font-medium text-error-600 dark:text-error-400" : "text-gray-800 dark:text-white/90"}`}>
                          {t(`rpBucket_${row.bucket}`)} <span className="text-xs font-normal text-gray-400 sm:hidden">· {t("rpRequestCountLine", { count: row.count })}</span>
                        </p>
                        <p className="hidden text-right tabular-nums text-gray-600 dark:text-gray-300 sm:block">{row.count}</p>
                        <p className="break-words text-right tabular-nums text-gray-800 dark:text-white/90">{row.hiddenCount && !row.total.length ? t("rpHidden") : money(row.total)}</p>
                      </li>
                    ))}
                    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 bg-gray-50 px-4 py-2.5 font-semibold dark:bg-white/[0.02] sm:grid-cols-[minmax(0,1.6fr)_100px_minmax(0,1.4fr)] sm:px-5">
                      <p className="text-gray-800 dark:text-white/90">{t("rpTotalPayables")} <span className="text-xs font-normal text-gray-400 sm:hidden">· {t("rpRequestCountLine", { count: aging.count })}</span></p>
                      <p className="hidden text-right tabular-nums text-gray-800 dark:text-white/90 sm:block">{aging.count}</p>
                      <p className="break-words text-right tabular-nums text-gray-900 dark:text-white">{money(aging.total)}</p>
                    </li>
                  </ul>
                </div>
                <div className="border-t border-gray-100 dark:border-gray-800">
                  <h3 className="px-4 pb-1 pt-3 text-sm font-semibold text-gray-800 dark:text-white/90 sm:px-5">{t("rpAttention")} <span className="font-normal text-gray-500">({aging.attention.length})</span></h3>
                  {aging.attention.length === 0 ? <p className="px-4 pb-4 text-sm text-gray-500 sm:px-5">{t("rpNoAttention")}</p> : (
                    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                      {attention.map((item) => (
                        <li key={item.requestId} className="flex min-w-0 items-start justify-between gap-3 px-4 py-2.5 sm:px-5">
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-baseline gap-x-2">
                              <Link href={`/payment-requests/${encodeURIComponent(item.requestId)}`} className="font-mono text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">{item.requestId}</Link>
                              <span className="text-xs text-gray-500">{t(`rpState_${item.state}`)}</span>
                            </p>
                            <p className="truncate text-sm text-gray-700 dark:text-gray-300" title={item.content}>{item.content || "—"}</p>
                            <p className="text-xs text-gray-400">
                              {item.requester} · {t("prDueDate")}: {formatDueDate(item.dueDate)}{" "}
                              <span className={item.daysOverdue !== null && item.daysOverdue > 0 ? "font-semibold text-error-600 dark:text-error-400" : "font-medium text-warning-600 dark:text-warning-400"}>({dueText(item)})</span>
                            </p>
                          </div>
                          <p className="shrink-0 text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{item.amount === null ? t("rpHidden") : formatMoney(item.amount, item.currency, language)}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {aging.attention.length > PREVIEW && (
                    <div className="border-t border-gray-100 px-4 py-2.5 dark:border-gray-800 sm:px-5">
                      <button type="button" onClick={() => setShowAllPayables((value) => !value)} className={LINK_BUTTON}>
                        {showAllPayables ? t("rpShowLess") : t("rpShowAll", { count: aging.attention.length })}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </Section>

          {/* IV. Cơ cấu chi phí theo khoản mục */}
          <Section index={3} title={t("rpStructure")} hint={t("rpStructureHint")}>
            {summary.byFee.length === 0 ? empty : (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {COST_KINDS.map((kind) => {
                  const fees = summary.byFee.filter((fee) => fee.kind === kind);
                  if (fees.length === 0) return null;
                  const subtotal = sumMoney(fees.map((fee) => ({ currency: fee.currency, total: fee.total })));
                  return (
                    <div key={kind} className="px-4 py-3 sm:px-5">
                      <p className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        <span>{t(`rpKind_${kind}`)}</span>
                        <span className="normal-case tabular-nums text-gray-700 dark:text-gray-300">{money(subtotal)}</span>
                      </p>
                      <ul className="space-y-2">
                        {fees.map((fee) => (
                          <li key={fee.key} className="min-w-0 text-sm">
                            <div className="flex min-w-0 items-baseline justify-between gap-3">
                              <span className="min-w-0 truncate text-gray-700 dark:text-gray-300" title={fee.name}>
                                {fee.name}
                                <span className="text-xs text-gray-400"> · {fee.code}{fee.account ? ` · ${t("rpAccountShort")} ${fee.account}` : ""} · {t("rpCountLine", { count: fee.count })}</span>
                              </span>
                              <span className="shrink-0 font-semibold tabular-nums text-gray-900 dark:text-white">{formatMoney(fee.total, fee.currency, language)}</span>
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                                <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, fee.share)}%` }} />
                              </div>
                              <span className="w-14 shrink-0 text-right text-xs tabular-nums text-gray-500">{fee.share.toLocaleString(language === "en" ? "en-US" : "vi-VN")}%</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* V. Giá vốn nhập khẩu theo lô hàng / container */}
          <Section index={4} title={t("rpLanded")} hint={t("rpLandedHint")} actions={(
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div role="radiogroup" aria-label={t("rpLanded")} className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
                {(["lots", "containers"] as const).map((view) => (
                  <button key={view} type="button" role="radio" aria-checked={shipmentView === view} onClick={() => { setShipmentView(view); setPage(1); }}
                    className={`min-h-8 whitespace-nowrap rounded-md px-3 text-sm font-medium ${shipmentView === view ? "bg-white text-gray-900 shadow-theme-xs dark:bg-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-300"}`}>
                    {t(view === "lots" ? "rpByLot" : "rpByContainer")}
                  </button>
                ))}
              </div>
              <input type="search" value={shipmentQuery} onChange={(event) => { setShipmentQuery(event.target.value); setPage(1); }}
                placeholder={t("rpShipmentSearch")} aria-label={t("rpShipmentSearch")} className={`${CONTROL} sm:w-56`} />
            </div>
          )}>
            {shipmentPage.total === 0 ? empty : (
              <>
                {/* Mobile / tablet: thẻ */}
                <ul className="divide-y divide-gray-100 dark:divide-gray-800 lg:hidden">
                  {shipmentView === "lots" ? lotPage.items.map((item) => (
                    <li key={item.contract} className="space-y-2 px-4 py-3 text-sm sm:px-5">
                      <div className="min-w-0">
                        <p className="font-mono font-semibold text-gray-800 dark:text-white/90">{item.contract} <span className="font-sans text-xs font-normal text-gray-500">· {t("rpContainerCount", { count: item.containerCount })}</span></p>
                        {item.supplier && <p className="truncate text-xs text-gray-500" title={item.supplier}>{item.supplier}</p>}
                      </div>
                      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 xsm:grid-cols-2">
                        {[
                          [t("rpGoodsValue"), item.hidden && !item.goods.length ? t("rpHidden") : money(item.goods)],
                          [t("rpImportCost"), money(item.cost)],
                          [t("rpLandedCost"), money(item.landed)],
                          [t("rpLandedPerContainer"), money(item.landedPerContainer)],
                        ].map(([label, value], index) => (
                          <div key={label} className="min-w-0">
                            <dt className="text-xs text-gray-500">{label}</dt>
                            <dd className={`break-words tabular-nums ${index >= 2 ? "font-semibold text-gray-900 dark:text-white" : "text-gray-700 dark:text-gray-300"}`}>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </li>
                  )) : containerPage.items.map((item) => (
                    <li key={`${item.contract}-${item.container}`} className="space-y-2 px-4 py-3 text-sm sm:px-5">
                      <div className="min-w-0">
                        <p className="break-all font-mono font-semibold text-gray-800 dark:text-white/90">{item.container}</p>
                        <p className="truncate text-xs text-gray-500" title={item.supplier}>{item.contract}{item.supplier ? ` · ${item.supplier}` : ""}</p>
                      </div>
                      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 xsm:grid-cols-2">
                        {[
                          [t("rpDirectCost"), money(item.direct)],
                          [t("rpAllocatedCost"), money(item.shared)],
                          [t("rpGoodsAllocated"), money(item.goodsShare)],
                          [t("rpLandedCost"), money(item.landed)],
                        ].map(([label, value], index) => (
                          <div key={label} className="min-w-0">
                            <dt className="text-xs text-gray-500">{label}</dt>
                            <dd className={`break-words tabular-nums ${index === 3 ? "font-semibold text-gray-900 dark:text-white" : "text-gray-700 dark:text-gray-300"}`}>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </li>
                  ))}
                </ul>
                {/* Desktop: bảng */}
                <div className="hidden overflow-x-auto custom-scrollbar lg:block">
                  {shipmentView === "lots" ? (
                    <table className="w-full min-w-[900px] text-left text-sm">
                      <thead className="bg-gray-50 text-xs font-semibold text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                        <tr>
                          <th className="px-4 py-2.5">{t("rpLot")}</th>
                          <th className="px-4 py-2.5 text-right">{t("rpContainers")}</th>
                          <th className="px-4 py-2.5 text-right">{t("rpGoodsValue")}</th>
                          <th className="px-4 py-2.5 text-right">{t("rpImportCost")}</th>
                          <th className="px-4 py-2.5 text-right">{t("rpCostPerContainer")}</th>
                          <th className="px-4 py-2.5 text-right">{t("rpLandedCost")}</th>
                          <th className="px-4 py-2.5 text-right">{t("rpLandedPerContainer")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 tabular-nums dark:divide-gray-800">
                        {lotPage.items.map((item) => (
                          <tr key={item.contract}>
                            <td className="px-4 py-2.5">
                              <p className="font-mono font-semibold text-gray-800 dark:text-white/90">{item.contract}</p>
                              {item.supplier && <p className="max-w-[240px] truncate text-xs text-gray-500" title={item.supplier}>{item.supplier}</p>}
                            </td>
                            <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-300">{item.containerCount || "—"}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{item.hidden && !item.goods.length ? t("rpHidden") : money(item.goods)}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{money(item.cost)}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{money(item.costPerContainer)}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-white">{money(item.landed)}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-white">{money(item.landedPerContainer)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <table className="w-full min-w-[900px] text-left text-sm">
                      <thead className="bg-gray-50 text-xs font-semibold text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                        <tr>
                          <th className="px-4 py-2.5">{t("rpContainer")}</th>
                          <th className="px-4 py-2.5">{t("rpLot")}</th>
                          <th className="px-4 py-2.5 text-right">{t("rpDirectCost")}</th>
                          <th className="px-4 py-2.5 text-right">{t("rpAllocatedCost")}</th>
                          <th className="px-4 py-2.5 text-right">{t("rpContainerCost")}</th>
                          <th className="px-4 py-2.5 text-right">{t("rpGoodsAllocated")}</th>
                          <th className="px-4 py-2.5 text-right">{t("rpLandedCost")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 tabular-nums dark:divide-gray-800">
                        {containerPage.items.map((item) => (
                          <tr key={`${item.contract}-${item.container}`}>
                            <td className="px-4 py-2.5 font-mono font-semibold text-gray-800 dark:text-white/90">{item.container}</td>
                            <td className="px-4 py-2.5">
                              <p className="font-mono text-gray-700 dark:text-gray-300">{item.contract}</p>
                              {item.supplier && <p className="max-w-[200px] truncate text-xs text-gray-500" title={item.supplier}>{item.supplier}</p>}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{money(item.direct)}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{money(item.shared)}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{money(item.total)}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{money(item.goodsShare)}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-white">{money(item.landed)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <PaginationControls page={shipmentPage.safePage} totalPages={shipmentPage.totalPages} pageSize={pageSize} totalItems={shipmentPage.total} from={shipmentPage.from} to={shipmentPage.to}
                  summaryKey="showingRecords" idPrefix="cost-shipments" onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(value); setPage(1); }} />
              </>
            )}
          </Section>

          {/* VI. Bảng kê đề nghị thanh toán của kỳ */}
          <Section index={5} title={`${t("rpRegister")} (${byRequest.requests.length})`} hint={t("rpRegisterHint")} actions={(
            <select value={requestFilter} onChange={(event) => { setRequestFilter(event.target.value as "" | CostState); setShowAllRequests(false); }} aria-label={t("rpStatus")}
              className="h-10 w-full rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-800 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white md:w-56">
              {REQUEST_FILTERS.map((value) => <option key={value || "all"} value={value}>{value ? t(`rpState_${value}`) : t("rpAllStates")}</option>)}
            </select>
          )}>
            {requestRows.length === 0 && (requestFilter || byRequest.unrequested.count === 0) ? empty : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {(showAllRequests ? requestRows : requestRows.slice(0, PREVIEW)).map((item) => {
                  const overdue = Boolean(item.dueDate) && item.dueDate < today && OPEN_STATES.includes(item.state);
                  return (
                    <li key={item.requestId} className="flex min-w-0 items-start justify-between gap-3 px-4 py-2.5 sm:px-5">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-baseline gap-x-2">
                          <Link href={`/payment-requests/${encodeURIComponent(item.requestId)}`} className="font-mono text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">{item.requestId}</Link>
                          <span className="text-xs text-gray-500">{t(`rpState_${item.state}`)}</span>
                        </p>
                        <p className="truncate text-sm text-gray-700 dark:text-gray-300" title={item.content}>{item.content || "—"}</p>
                        <p className="text-xs text-gray-400">
                          {item.requester}{item.dueDate ? ` · ${t("prDueDate")}: ` : ""}
                          {item.dueDate && <span className={overdue ? "font-semibold text-error-600 dark:text-error-400" : ""}>{formatDueDate(item.dueDate)}{overdue ? ` (${t("rpOverdue")})` : ""}</span>}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{item.total.length ? money(item.total) : item.hiddenCount ? t("rpHidden") : "—"}</p>
                        <p className="text-xs text-gray-400">{t("rpCountLine", { count: item.count })}</p>
                      </div>
                    </li>
                  );
                })}
                {!requestFilter && byRequest.unrequested.count > 0 && (
                  <li className="flex items-center justify-between gap-3 bg-gray-50 px-4 py-2.5 text-sm dark:bg-white/[0.02] sm:px-5">
                    <span className="min-w-0 text-gray-600 dark:text-gray-300">{t("rpStage_unrequested")} · {t("rpCountLine", { count: byRequest.unrequested.count })}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-gray-900 dark:text-white">{money(byRequest.unrequested.total)}</span>
                  </li>
                )}
              </ul>
            )}
            {requestRows.length > PREVIEW && (
              <div className="border-t border-gray-100 px-4 py-2.5 dark:border-gray-800 sm:px-5">
                <button type="button" onClick={() => setShowAllRequests((value) => !value)} className={LINK_BUTTON}>
                  {showAllRequests ? t("rpShowLess") : t("rpShowAll", { count: requestRows.length })}
                </button>
              </div>
            )}
          </Section>

          {/* Cơ sở lập báo cáo / ghi chú */}
          <section className={`${CARD} px-4 py-3 sm:px-5`}>
            <h2 className="text-sm font-semibold text-gray-800 dark:text-white/90">{t("rpNotes")}</h2>
            <ul className="mt-1.5 space-y-0.5 text-xs text-gray-500">
              {notes.map((note) => <li key={note} className="break-words">• {note}</li>)}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
