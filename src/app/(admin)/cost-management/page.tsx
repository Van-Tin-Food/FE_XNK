"use client";

import { useEffect, useMemo, useState } from "react";
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
  COST_KINDS, currentMonth, fromCents, groupByRequest, isMonth, shiftMonth, summarizeCosts, summarizeShipments, toCents, todayVn,
  type ContainerTotals, type CostState, type Money, type ShipmentTotals,
} from "@/utils/costStatistics";
import { formatMoney } from "@/utils/paymentRequest";
import { paginateItems } from "@/utils/pagination";

// Quản lý chi phí (đơn giản, cho người quản lý): 1. tổng chi phí của tháng; 2. theo đề nghị thanh toán | theo khoản chi
// phí; 3. chi phí theo lô hàng / container (lũy kế, chi phí chung chia đều cho container) để làm căn cứ giá bán.
// Một lần gọi BE (/payment-costs/overview); tổng hợp, lọc, xuất Excel làm ở trình duyệt.

const REQUEST_PREVIEW = 10;
const DEFAULT_PAGE_SIZE = 20;
const CARD = "rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]";
const CONTROL = "h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white";
const TITLE = "text-base font-semibold text-gray-800 dark:text-white/90";
const BUTTON = "h-10 shrink-0 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800";
const REQUEST_FILTERS: Array<"" | CostState> = ["", "pending", "approved", "completed", "rejected", "draft", "cancelled"];
const OPEN_STATES: CostState[] = ["draft", "pending", "approved"];

export default function CostManagementPage() {
  const { t, language } = useLanguage();
  const { can, user } = useAuth();
  const { notify } = useSystemNotification();
  const canView = can("costReports") || can("paymentRequestsAll");

  const [month, setMonth] = useState(() => currentMonth());
  const [data, setData] = useState<CostOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [requestFilter, setRequestFilter] = useState<"" | CostState>("");
  const [showAllRequests, setShowAllRequests] = useState(false);
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
  }, [canView, month, reloadKey, t]);

  const costs = useMemo(() => data?.costs ?? [], [data]);
  const summary = useMemo(() => summarizeCosts(costs), [costs]);
  const byRequest = useMemo(() => groupByRequest(costs), [costs]);
  const shipments = useMemo(() => summarizeShipments(data?.shipments ?? [], data?.shipmentCosts ?? []), [data]);
  const term = shipmentQuery.trim().toLocaleLowerCase("vi");
  const lots = shipments.lots.filter((item) => !term || `${item.contract} ${item.supplier}`.toLocaleLowerCase("vi").includes(term));
  const containers = shipments.containers.filter((item) => !term || `${item.container} ${item.contract} ${item.supplier}`.toLocaleLowerCase("vi").includes(term));
  const lotPage = paginateItems<ShipmentTotals>(lots, page, pageSize);
  const containerPage = paginateItems<ContainerTotals>(containers, page, pageSize);
  const shipmentPage = shipmentView === "lots" ? lotPage : containerPage;

  if (!canView) {
    return <div className={`${CARD} p-8 text-center text-sm text-gray-600 dark:text-gray-300`}>{t("prNoPermission")}</div>;
  }

  const today = todayVn();
  const requestRows = byRequest.requests.filter((item) => !requestFilter || item.state === requestFilter);
  const monthLabel = (value: string) => `${value.slice(5, 7)}/${value.slice(0, 4)}`;
  const money = (list: Money) => (list.length ? list.map((item) => formatMoney(item.total, item.currency, language)).join(" + ") : "—");
  /** Tổng theo loại tiền của một cột (bỏ loại tiền = 0). */
  const sumOf = (items: Array<{ currency: string; total: string; paid: string; processing: string; unrequested: string }>, pick: (item: { total: string; paid: string; processing: string; unrequested: string }) => bigint) =>
    money(items.map((item) => ({ currency: item.currency, cents: pick(item) })).filter((item) => item.cents !== BigInt(0)).map((item) => ({ currency: item.currency, total: fromCents(item.cents) })));
  const costCount = summary.costs.reduce((sum, item) => sum + item.count, 0);
  const notes = [
    data?.truncated ? t("cmTruncatedNote") : "",
    summary.hiddenCount > 0 ? t("cmHiddenNote") : "",
    summary.cancelledCount > 0 ? t("cmCancelledNote", { count: summary.cancelledCount }) : "",
    costs.some((cost) => cost.currencyInferred) ? t("cmInferredNote") : "",
  ].filter(Boolean);

  const changeMonth = (value: string) => {
    if (!isMonth(value)) return;
    setMonth(value);
    setRequestFilter("");
    setShipmentQuery("");
  };

  const exportExcel = async () => {
    if (exporting || loading || !data) return;
    if (costs.length === 0) return notify(t("exportExcelEmpty"), "warning");
    setExporting(true);
    try {
      const fileName = await exportCostOverviewExcel({ overview: data, t });
      notify(t("cmExported", { file: fileName }), "success");
      recordActivity(user, { action: "EXPORT_EXCEL", location: "CostManagement", detail: `Thống kê chi phí tháng ${monthLabel(month)}; ${costs.length} khoản` });
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
      {hint && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}
    </div>
  );

  return (
    <div className="space-y-5">
      <header className={`${CARD} flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between`}>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t("cmTitle")}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("cmDescription")}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => changeMonth(shiftMonth(month, -1))} aria-label={t("cmPrevMonth")} title={t("cmPrevMonth")} className={`${BUTTON} w-10 px-0`}>‹</button>
            <input type="month" value={month} onChange={(event) => changeMonth(event.target.value)} aria-label={t("cmMonth")} className={`${CONTROL} sm:w-44`} />
            <button type="button" onClick={() => changeMonth(shiftMonth(month, 1))} aria-label={t("cmNextMonth")} title={t("cmNextMonth")} className={`${BUTTON} w-10 px-0`}>›</button>
          </div>
          <button type="button" onClick={() => void exportExcel()} disabled={exporting || loading || !data || costs.length === 0}
            className="h-10 shrink-0 whitespace-nowrap rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
            {exporting ? t("cmExporting") : t("cmExport", { month: monthLabel(month) })}
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
          {/* 1. Tổng chi phí của tháng */}
          <section className={CARD}>
            <h2 className={`${TITLE} border-b border-gray-100 px-4 py-3 dark:border-gray-800 sm:px-5`}>{t("cmMonthTotal", { month: monthLabel(month) })}</h2>
            {costs.length === 0 ? <p className="px-5 py-6 text-sm text-gray-500">{t("cmEmpty", { month: monthLabel(month) })}</p> : (
              <>
                <div className="grid grid-cols-1 divide-y divide-gray-100 dark:divide-gray-800 sm:grid-cols-2 xl:grid-cols-4 xl:divide-x xl:divide-y-0">
                  {figure(t("cmTotalCost"), sumOf(summary.costs, (item) => toCents(item.total)), t("cmCountLine", { count: costCount }))}
                  {figure(t("cmGroup_paid"), sumOf(summary.costs, (item) => toCents(item.paid)))}
                  {figure(t("cmNotPaid"), sumOf(summary.costs, (item) => toCents(item.processing) + toCents(item.unrequested)), t("cmNotPaidHint"))}
                  {figure(t("cmGoods"), summary.goods.length ? sumOf(summary.goods, (item) => toCents(item.total)) : summary.hiddenCount ? t("cmHidden") : "—", t("cmGoodsHint"))}
                </div>
                {notes.length > 0 && (
                  <ul className="space-y-0.5 border-t border-gray-100 px-4 py-2.5 text-xs text-gray-500 dark:border-gray-800 sm:px-5">
                    {notes.map((note) => <li key={note} className="break-words">• {note}</li>)}
                  </ul>
                )}
              </>
            )}
          </section>

          {/* 2. Theo đề nghị | theo khoản chi phí */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <section className={`${CARD} min-w-0`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800 sm:px-5">
                <h2 className={TITLE}>{t("cmByRequest")} <span className="text-sm font-normal text-gray-500">({byRequest.requests.length})</span></h2>
                <select value={requestFilter} onChange={(event) => { setRequestFilter(event.target.value as "" | CostState); setShowAllRequests(false); }} aria-label={t("cmState")} className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-800 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white">
                  {REQUEST_FILTERS.map((value) => <option key={value || "all"} value={value}>{value ? t(`cmState_${value}`) : t("cmAllStates")}</option>)}
                </select>
              </div>
              {requestRows.length === 0 && (requestFilter || byRequest.unrequested.count === 0) ? <p className="px-5 py-6 text-sm text-gray-500">{t("cmNone")}</p> : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {(showAllRequests ? requestRows : requestRows.slice(0, REQUEST_PREVIEW)).map((item) => {
                    const overdue = Boolean(item.dueDate) && item.dueDate < today && OPEN_STATES.includes(item.state);
                    return (
                      <li key={item.requestId} className="flex min-w-0 items-start justify-between gap-3 px-4 py-2.5 sm:px-5">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-baseline gap-x-2">
                            <Link href={`/payment-requests/${encodeURIComponent(item.requestId)}`} className="font-mono text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">{item.requestId}</Link>
                            <span className="text-xs text-gray-500">{t(`cmState_${item.state}`)}</span>
                          </p>
                          <p className="truncate text-sm text-gray-700 dark:text-gray-300" title={item.content}>{item.content || "—"}</p>
                          <p className="text-xs text-gray-400">
                            {item.requester}{item.dueDate ? ` · ${t("prDueDate")}: ` : ""}
                            {item.dueDate && <span className={overdue ? "font-semibold text-error-600 dark:text-error-400" : ""}>{formatDueDate(item.dueDate)}{overdue ? ` (${t("cmOverdue")})` : ""}</span>}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{item.total.length ? money(item.total) : item.hiddenCount ? t("cmHidden") : "—"}</p>
                          <p className="text-xs text-gray-400">{t("cmCountLine", { count: item.count })}</p>
                        </div>
                      </li>
                    );
                  })}
                  {!requestFilter && byRequest.unrequested.count > 0 && (
                    <li className="flex items-center justify-between gap-3 bg-gray-50 px-4 py-2.5 text-sm dark:bg-white/[0.02] sm:px-5">
                      <span className="text-gray-600 dark:text-gray-300">{t("cmUnrequested")} · {t("cmCountLine", { count: byRequest.unrequested.count })}</span>
                      <span className="font-semibold tabular-nums text-gray-900 dark:text-white">{money(byRequest.unrequested.total)}</span>
                    </li>
                  )}
                </ul>
              )}
              {requestRows.length > REQUEST_PREVIEW && (
                <div className="border-t border-gray-100 px-4 py-2.5 dark:border-gray-800 sm:px-5">
                  <button type="button" onClick={() => setShowAllRequests((value) => !value)} className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
                    {showAllRequests ? t("cmShowLess") : t("cmShowAll", { count: requestRows.length })}
                  </button>
                </div>
              )}
            </section>

            <section className={`${CARD} min-w-0`}>
              <h2 className={`${TITLE} border-b border-gray-100 px-4 py-3 dark:border-gray-800 sm:px-5`}>{t("cmByFee")}</h2>
              {summary.byFee.length === 0 ? <p className="px-5 py-6 text-sm text-gray-500">{t("cmNone")}</p> : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {COST_KINDS.map((kind) => {
                    const fees = summary.byFee.filter((fee) => fee.kind === kind);
                    if (fees.length === 0) return null;
                    return (
                      <div key={kind} className="px-4 py-3 sm:px-5">
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">{t(`cmKind_${kind}`)}</p>
                        <ul className="space-y-1.5">
                          {fees.map((fee) => (
                            <li key={fee.key} className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
                              <span className="min-w-0 truncate text-gray-700 dark:text-gray-300" title={fee.name}>{fee.name} <span className="text-xs text-gray-400">· {fee.code} · {t("cmCountLine", { count: fee.count })}</span></span>
                              <span className="shrink-0 font-semibold tabular-nums text-gray-900 dark:text-white">{formatMoney(fee.total, fee.currency, language)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* 3. Chi phí theo lô hàng / container (lũy kế) — căn cứ giá bán */}
          <section className={CARD}>
            <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800 sm:px-5 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <h2 className={TITLE}>{t("cmShipmentTitle")}</h2>
                <p className="mt-0.5 text-xs text-gray-500">{t("cmShipmentHint")}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div role="radiogroup" aria-label={t("cmShipmentTitle")} className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
                  {(["lots", "containers"] as const).map((view) => (
                    <button key={view} type="button" role="radio" aria-checked={shipmentView === view} onClick={() => { setShipmentView(view); setPage(1); }}
                      className={`min-h-8 whitespace-nowrap rounded-md px-3 text-sm font-medium ${shipmentView === view ? "bg-white text-gray-900 shadow-theme-xs dark:bg-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-300"}`}>
                      {t(view === "lots" ? "cmByLot" : "cmByContainer")}
                    </button>
                  ))}
                </div>
                <input type="search" value={shipmentQuery} onChange={(event) => { setShipmentQuery(event.target.value); setPage(1); }}
                  placeholder={t("cmShipmentSearch")} aria-label={t("cmShipmentSearch")} className={`${CONTROL} sm:w-56`} />
              </div>
            </div>
            {shipmentPage.total === 0 ? <p className="px-5 py-6 text-sm text-gray-500">{t("cmNone")}</p> : (
              <>
                <div className="overflow-x-auto custom-scrollbar">
                  {shipmentView === "lots" ? (
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="bg-gray-50 text-xs font-semibold text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                        <tr>
                          <th className="px-4 py-2.5">{t("cmLot")}</th>
                          <th className="px-4 py-2.5 text-right">{t("cmContainers")}</th>
                          <th className="px-4 py-2.5 text-right">{t("cmLotCost")}</th>
                          <th className="px-4 py-2.5 text-right">{t("cmCostPerContainer")}</th>
                          <th className="px-4 py-2.5 text-right">{t("cmGoods")}</th>
                          <th className="px-4 py-2.5 text-right">{t("cmGoodsPerContainer")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 tabular-nums dark:divide-gray-800">
                        {lotPage.items.map((item) => (
                          <tr key={item.contract}>
                            <td className="px-4 py-2.5">
                              <p className="font-mono font-semibold text-gray-800 dark:text-white/90">{item.contract}</p>
                              {item.supplier && <p className="max-w-[260px] truncate text-xs text-gray-500" title={item.supplier}>{item.supplier}</p>}
                            </td>
                            <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-300">{item.containerCount || "—"}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-white">{money(item.cost)}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-white">{money(item.costPerContainer)}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{item.hidden && !item.goods.length ? t("cmHidden") : money(item.goods)}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{item.hidden && !item.goods.length ? t("cmHidden") : money(item.goodsPerContainer)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="bg-gray-50 text-xs font-semibold text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                        <tr>
                          <th className="px-4 py-2.5">{t("cmContainer")}</th>
                          <th className="px-4 py-2.5">{t("cmLot")}</th>
                          <th className="px-4 py-2.5 text-right">{t("cmDirectCost")}</th>
                          <th className="px-4 py-2.5 text-right">{t("cmSharedCost")}</th>
                          <th className="px-4 py-2.5 text-right">{t("cmContainerTotal")}</th>
                          <th className="px-4 py-2.5 text-right">{t("cmGoodsPerContainer")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 tabular-nums dark:divide-gray-800">
                        {containerPage.items.map((item) => (
                          <tr key={`${item.contract}-${item.container}`}>
                            <td className="px-4 py-2.5 font-mono font-semibold text-gray-800 dark:text-white/90">{item.container}</td>
                            <td className="px-4 py-2.5">
                              <p className="font-mono text-gray-700 dark:text-gray-300">{item.contract}</p>
                              {item.supplier && <p className="max-w-[220px] truncate text-xs text-gray-500" title={item.supplier}>{item.supplier}</p>}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{money(item.direct)}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{money(item.shared)}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right font-semibold text-gray-900 dark:text-white">{money(item.total)}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{money(item.goodsShare)}</td>
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
          </section>
        </div>
      )}
    </div>
  );
}
