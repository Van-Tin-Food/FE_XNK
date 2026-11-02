"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
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
  COST_KINDS, currentMonth, daysBetween, groupByRequest, isMonth, isPurchaseCost, parseRate, shiftMonth, stageMoney, sumMoney, summarizeCosts,
  summarizeDeposits, summarizeOrders, todayVn, withoutDeposits,
  type CostKind, type CostState, type Money, type MonthlyCost, type OrderTotals, type RequestTotals,
} from "@/utils/costStatistics";
import { formatMoney } from "@/utils/paymentRequest";
import { paginateItems } from "@/utils/pagination";

// Báo cáo chi phí (chỉ admin: chức năng costReports chỉ admin có), 5 mục:
// 1. Chỉ tiêu tổng hợp của kỳ: chi phí mua hàng (tiền hàng + vận chuyển & phí gắn đơn hàng), chi phí vận hành (khoản không
//    gắn đơn hàng), đã thanh toán, cần thanh toán;
// 2. Đề nghị thanh toán của kỳ — bảng, mở từng đề nghị xem các khoản phí bên trong;
// 3. Nợ phải thu: phí cược cont đã chi − phí sửa cont = nợ phải thu hãng tàu (tính đến hôm nay, hệ thống không quản lý thu
//    tiền);
// 4. Cơ cấu chi phí theo khoản mục;
// 5. Giá vốn đơn hàng (lũy kế): số cont, NET (kg), tiền hàng (thanh toán quốc tế), thuế & phí theo đơn, phí cont, giá vốn
//    trung bình / kg — quy đổi VND theo tỷ giá USD/VND người xem nhập (trình duyệt nhớ).
// Tiền cược container là khoản tạm ứng: không tính vào số liệu nào ngoài mục 3. Số liệu theo nguyên tệ (VND, USD riêng).
// Một lần gọi BE (/payment-costs/overview); tổng hợp, lọc, xuất Excel làm ở trình duyệt.

const DEFAULT_PAGE_SIZE = 10;
const PREVIEW = 10;
const RATE_STORAGE_KEY = "xnk.costReport.usdRate";
const CARD = "rounded-2xl border border-gray-200 bg-white shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]";
const CONTROL = "h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white";
// Ô lọc trong các mục (tìm kiếm, trạng thái, tỷ giá): gọn hơn ô chọn kỳ ở đầu trang.
const FILTER = "h-9 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-2.5 text-xs text-gray-800 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white";
const BUTTON = "h-10 shrink-0 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800";
const LINK_BUTTON = "text-sm font-medium text-brand-600 hover:underline dark:text-brand-400";
const REQUEST_FILTERS: Array<"" | CostState> = ["", "pending", "approved", "paid", "completed", "rejected", "draft", "cancelled"];

/** Màu nhãn trạng thái đề nghị. */
const STATE_BADGE: Record<CostState, string> = {
  none: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  draft: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  pending: "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-300",
  rejected: "bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-300",
  approved: "bg-blue-light-50 text-blue-light-700 dark:bg-blue-light-500/15 dark:text-blue-light-300",
  paid: "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-300",
  completed: "bg-success-100 text-success-800 dark:bg-success-500/25 dark:text-success-200",
  cancelled: "bg-gray-100 text-gray-500 line-through dark:bg-gray-800 dark:text-gray-400",
};
/** Màu thanh tỷ trọng theo nhóm chi phí. */
const KIND_BAR: Record<CostKind, string> = {
  operating: "bg-orange-500",
  incident: "bg-theme-purple-500",
  goods: "bg-brand-500",
  deposit: "bg-gray-400",
};

/** Khối mục báo cáo: số thứ tự trong vòng tròn màu, tiêu đề, mô tả, nút thao tác. */
function Section({ index, title, hint, actions, children }: { index: number; title: string; hint?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className={`${CARD} min-w-0 overflow-hidden`}>
      <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-4 dark:border-gray-800 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">{index}</span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h2>
            {hint && <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{hint}</p>}
          </div>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Thẻ chỉ tiêu: dải màu bên trái, nhãn, số tiền, dòng phụ. */
function KpiCard({ tone, icon, label, value, hint }: { tone: "brand" | "orange" | "success" | "warning"; icon: string; label: string; value: string; hint?: string }) {
  const tones = {
    brand: "border-l-brand-500 bg-brand-50/60 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300",
    orange: "border-l-orange-500 bg-orange-50/60 text-orange-600 dark:bg-orange-500/10 dark:text-orange-300",
    success: "border-l-success-500 bg-success-50/60 text-success-600 dark:bg-success-500/10 dark:text-success-300",
    warning: "border-l-warning-500 bg-warning-50/60 text-warning-600 dark:bg-warning-500/10 dark:text-warning-300",
  }[tone];
  return (
    <div className={`${CARD} min-w-0 border-l-4 p-4 ${tones.split(" ")[0]}`}>
      <div className="flex items-center gap-2">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base ${tones.split(" ").slice(1).join(" ")}`} aria-hidden="true">{icon}</span>
        <p className="min-w-0 text-sm font-medium text-gray-600 dark:text-gray-300">{label}</p>
      </div>
      <p className="mt-3 break-words text-xl font-bold tabular-nums text-gray-900 dark:text-white sm:text-2xl">{value}</p>
      {hint && <p className="mt-1 break-words text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
    </div>
  );
}

/** Ô số nhỏ (nhãn trên, giá trị dưới) trong thẻ đơn hàng / nợ phải thu. */
function Stat({ label, value, strong = false, tone = "" }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-0.5 break-words tabular-nums ${strong ? "text-base font-bold" : "text-sm font-semibold"} ${tone || "text-gray-900 dark:text-white"}`}>{value}</p>
    </div>
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
  const [requestQuery, setRequestQuery] = useState("");
  const [requestPage, setRequestPage] = useState(1);
  const [requestPageSize, setRequestPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [openRequests, setOpenRequests] = useState<Set<string>>(() => new Set());
  const [showAllDeposits, setShowAllDeposits] = useState(false);
  const [orderQuery, setOrderQuery] = useState("");
  const [orderPage, setOrderPage] = useState(1);
  const [orderPageSize, setOrderPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [openOrders, setOpenOrders] = useState<Set<string>>(() => new Set());
  // Tỷ giá USD/VND để quy đổi giá vốn: trình duyệt nhớ (chỉ là tiện ích của người xem, không lưu BE).
  const [rateText, setRateText] = useState("");

  // Đọc tỷ giá đã nhớ sau khi trang hiện (server không có localStorage — đọc lúc khởi tạo sẽ lệch HTML).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setRateText(window.localStorage.getItem(RATE_STORAGE_KEY) || "");
      } catch {
        // Trình duyệt chặn localStorage: để trống, người xem nhập lại.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!canView || !isMonth(month)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      getCostOverview(month, controller.signal)
        .then((result) => {
          setData(result);
          setRequestPage(1);
          setOrderPage(1);
          setOpenRequests(new Set());
          setOpenOrders(new Set());
          setShowAllDeposits(false);
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

  const changeRate = (value: string) => {
    setRateText(value);
    try {
      window.localStorage.setItem(RATE_STORAGE_KEY, value);
    } catch {
      // Không lưu được (chế độ riêng tư...): vẫn dùng trong phiên này.
    }
  };

  // Tiền cược container không tính vào số liệu của kỳ (chỉ ở mục nợ phải thu).
  const costs = useMemo(() => withoutDeposits(data?.costs ?? []), [data]);
  const summary = useMemo(() => summarizeCosts(costs), [costs]);
  // Chi phí mua hàng = tiền hàng + khoản gắn đơn hàng; chi phí vận hành = khoản không gắn đơn hàng.
  const purchase = useMemo(() => summarizeCosts(costs.filter(isPurchaseCost)), [costs]);
  const operating = useMemo(() => summarizeCosts(costs.filter((cost) => !isPurchaseCost(cost))), [costs]);
  const byRequest = useMemo(() => groupByRequest(costs), [costs]);
  const depositLedger = useMemo(() => summarizeDeposits(data?.deposits.rows ?? []), [data]);
  const usdRate = useMemo(() => parseRate(rateText), [rateText]);
  const orders = useMemo(() => summarizeOrders(data?.shipments ?? [], data?.shipmentCosts ?? [], usdRate), [data, usdRate]);

  if (!canView) {
    return <div className={`${CARD} p-8 text-center text-sm text-gray-600 dark:text-gray-300`}>{t("rpAdminOnly")}</div>;
  }

  const today = todayVn();
  const monthLabel = (value: string) => `${value.slice(5, 7)}/${value.slice(0, 4)}`;
  // Số âm (nợ phải thu khi phí sửa cont vượt tiền cược): formatMoney chỉ nhận số không âm, thêm dấu trừ ở đây.
  const moneyText = (total: string, currency: string) => (total.startsWith("-") ? `−${formatMoney(total.slice(1), currency, language)}` : formatMoney(total, currency, language));
  const money = (list: Money) => (list.length ? list.map((item) => moneyText(item.total, item.currency)).join(" + ") : "—");
  const kg = (value: number) => new Intl.NumberFormat(language === "en" ? "en-US" : "vi-VN", { maximumFractionDigits: 3 }).format(value);
  const pick = (items: typeof summary.costs, field: "total" | "base" | "tax") => sumMoney(items.map((item) => ({ currency: item.currency, total: item[field] })));
  const both = (s: "settled" | "approved" | "pending" | "unsubmitted" | "unrequested") => {
    const expense = stageMoney(summary.costs, s);
    const purchases = stageMoney(summary.goods, s);
    return { count: expense.count + purchases.count, total: sumMoney(expense.total, purchases.total) };
  };
  const settled = both("settled");
  const outstandingParts = (["approved", "pending", "unsubmitted", "unrequested"] as const).map(both);
  const outstanding = { count: outstandingParts.reduce((sum, item) => sum + item.count, 0), total: sumMoney(...outstandingParts.map((item) => item.total)) };
  const countOf = (items: typeof summary.costs) => items.reduce((sum, item) => sum + item.count, 0);
  const purchaseGoods = pick(purchase.goods, "total");
  const purchaseFees = pick(purchase.costs, "total");
  const purchaseTotal = sumMoney(purchaseGoods, purchaseFees);

  // ---- Mục 2: đề nghị thanh toán (+ dòng "chưa lập đề nghị") ----
  const looseRow: RequestTotals | null = byRequest.unrequested.count
    ? { requestId: "", content: t("rpUnrequestedRow"), requester: "", dueDate: "", state: "none", count: byRequest.unrequested.count, total: byRequest.unrequested.total, hiddenCount: 0, items: byRequest.unrequested.items }
    : null;
  const requestTerm = requestQuery.trim().toLocaleLowerCase("vi");
  const requestRows = [...byRequest.requests, ...(looseRow ? [looseRow] : [])]
    .filter((item) => !requestFilter || item.state === requestFilter)
    .filter((item) => !requestTerm || [item.requestId, item.content, item.requester, ...item.items.map((cost) => `${cost.categoryName} ${cost.container} ${cost.contract} ${cost.note}`)]
      .join(" ").toLocaleLowerCase("vi").includes(requestTerm));
  const requestPageData = paginateItems<RequestTotals>(requestRows, requestPage, requestPageSize);
  const toggle = (setter: typeof setOpenRequests, key: string) => setter((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const dueInfo = (item: RequestTotals) => {
    if (!item.dueDate || !["pending", "approved", "draft"].includes(item.state)) return null;
    const overdue = daysBetween(item.dueDate, today);
    if (overdue > 0) return <span className="font-semibold text-error-600 dark:text-error-400">{t("rpDaysOverdue", { days: overdue })}</span>;
    if (overdue === 0) return <span className="font-medium text-warning-600 dark:text-warning-400">{t("rpDueToday")}</span>;
    return <span className="text-gray-400">{t("rpDaysLeft", { days: -overdue })}</span>;
  };
  const feePlace = (cost: MonthlyCost) => (cost.container ? `${t("rpContainer")} ${cost.container}` : cost.contract ? `${t("rpOrderShort")} ${cost.contract}` : t("rpOperatingCost"));
  const feeAmount = (cost: MonthlyCost) => (cost.amount === null ? t("rpHidden") : moneyText(cost.amount, cost.currency));
  const stateBadge = (state: CostState) => (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATE_BADGE[state]}`}>{t(`rpState_${state}`)}</span>
  );
  /** Danh sách khoản phí của một đề nghị (bảng trên desktop, dòng trên mobile). */
  const feeTable = (items: MonthlyCost[]) => (
    <div className="bg-gray-50/80 px-4 py-3 dark:bg-white/[0.02] sm:px-5">
      <ul className="space-y-2 md:hidden">
        {items.map((cost) => (
          <li key={cost.id} className="rounded-lg border border-gray-200 bg-white p-3 text-sm dark:border-gray-700 dark:bg-gray-900">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 font-medium text-gray-800 dark:text-white/90">{cost.categoryName}</p>
              <p className="shrink-0 font-semibold tabular-nums text-gray-900 dark:text-white">{feeAmount(cost)}</p>
            </div>
            <p className="mt-0.5 text-xs text-gray-500">{[feePlace(cost), cost.vat ? `VAT ${cost.vat}%` : "", cost.note].filter(Boolean).join(" · ")}</p>
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-left text-sm md:table">
        <thead className="text-xs text-gray-500 dark:text-gray-400">
          <tr>
            <th className="py-1.5 pr-3 font-medium">{t("rpCostItem")}</th>
            <th className="py-1.5 pr-3 font-medium">{t("rpAppliesTo")}</th>
            <th className="py-1.5 pr-3 font-medium">{t("prCostNote")}</th>
            <th className="py-1.5 pr-3 text-right font-medium">VAT</th>
            <th className="py-1.5 text-right font-medium">{t("rpAmount")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200/70 dark:divide-gray-700/60">
          {items.map((cost) => (
            <tr key={cost.id}>
              <td className="py-2 pr-3 text-gray-800 dark:text-white/90">
                {cost.categoryName}
                <span className="ml-1 text-xs text-gray-400">{cost.code}{cost.account ? ` · ${t("rpAccountShort")} ${cost.account}` : ""}</span>
              </td>
              <td className="py-2 pr-3 font-mono text-xs text-gray-600 dark:text-gray-300">{feePlace(cost)}</td>
              <td className="max-w-[260px] truncate py-2 pr-3 text-gray-600 dark:text-gray-300" title={cost.note}>{cost.note || "—"}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-gray-500">{cost.vat ? `${cost.vat}%` : "—"}</td>
              <td className="whitespace-nowrap py-2 text-right font-semibold tabular-nums text-gray-900 dark:text-white">{feeAmount(cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // ---- Mục 5: giá vốn đơn hàng ----
  const orderTerm = orderQuery.trim().toLocaleLowerCase("vi");
  const orderRows = orders.filter((item) => !orderTerm || `${item.contract} ${item.supplier} ${item.containers.map((c) => c.container).join(" ")}`.toLocaleLowerCase("vi").includes(orderTerm));
  const orderPageData = paginateItems<OrderTotals>(orderRows, orderPage, orderPageSize);
  const hasForeign = orders.some((item) => item.total.some((entry) => entry.currency !== "VND"));
  const rateInvalid = rateText.trim() !== "" && usdRate === null;

  const depositItems = showAllDeposits ? depositLedger.items : depositLedger.items.slice(0, PREVIEW);
  const notes = [
    t("rpBasisNote"),
    t("rpCurrencyNote"),
    data?.truncated ? t("rpTruncatedNote") : "",
    summary.hiddenCount > 0 ? t("rpHiddenNote") : "",
    summary.cancelledCount > 0 ? t("rpCancelledNote", { count: summary.cancelledCount }) : "",
    costs.some((cost) => cost.currencyInferred) ? t("rpInferredNote") : "",
    depositLedger.items.length > 0 || (data?.costs ?? []).some((cost) => cost.kind === "deposit") ? t("rpDepositNote") : "",
    data?.deposits.truncated ? t("rpDepositTruncatedNote") : "",
  ].filter(Boolean);

  const changeMonth = (value: string) => {
    if (!isMonth(value)) return;
    setMonth(value);
    setRequestFilter("");
    setRequestQuery("");
    setOrderQuery("");
  };

  const exportExcel = async () => {
    if (exporting || loading || !data) return;
    if (costs.length === 0 && depositLedger.items.length === 0) return notify(t("exportExcelEmpty"), "warning");
    setExporting(true);
    try {
      const fileName = await exportCostOverviewExcel({ overview: data, t, usdRate, rateText: usdRate ? rateText.trim() : "" });
      notify(t("rpExported", { file: fileName }), "success");
      recordActivity(user, { action: "EXPORT_EXCEL", location: "CostReport", detail: `Báo cáo chi phí tháng ${monthLabel(month)}; ${costs.length} khoản` });
    } catch (exportError) {
      notify(exportError instanceof Error ? exportError.message : t("exportExcelError"), "error");
    } finally {
      setExporting(false);
    }
  };

  const empty = <p className="px-5 py-8 text-center text-sm text-gray-500">{t("rpNone")}</p>;

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
          {/* 1. Chỉ tiêu tổng hợp */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard tone="brand" icon="📦" label={t("rpPurchases")} value={purchaseTotal.length ? money(purchaseTotal) : purchase.hiddenCount ? t("rpHidden") : "—"}
              hint={t("rpPurchasesHint", { goods: purchase.goods.length ? money(purchaseGoods) : purchase.hiddenCount ? t("rpHidden") : "—", fees: money(purchaseFees), count: countOf(purchase.goods) + countOf(purchase.costs) })} />
            <KpiCard tone="orange" icon="🏢" label={t("rpExpense")} value={money(pick(operating.costs, "total"))} hint={t("rpExpenseHint", { base: money(pick(operating.costs, "base")), tax: money(pick(operating.costs, "tax")), count: countOf(operating.costs) })} />
            <KpiCard tone="success" icon="✅" label={t("rpSettled")} value={money(settled.total)} hint={t("rpCountLine", { count: settled.count })} />
            <KpiCard tone="warning" icon="⏳" label={t("rpOutstanding")} value={money(outstanding.total)} hint={t("rpOutstandingHint", { count: outstanding.count })} />
          </div>

          {/* 2. Đề nghị thanh toán của kỳ, chi tiết khoản phí */}
          <Section index={1} title={`${t("rpRequests", { month: monthLabel(month) })} (${byRequest.requests.length})`} hint={t("rpRequestsHint")} actions={(
            <div className="flex flex-col gap-2 sm:flex-row">
              <input type="search" value={requestQuery} onChange={(event) => { setRequestQuery(event.target.value); setRequestPage(1); }}
                placeholder={t("rpRequestSearch")} aria-label={t("rpRequestSearch")} className={`${FILTER} sm:w-48`} />
              <select value={requestFilter} onChange={(event) => { setRequestFilter(event.target.value as "" | CostState); setRequestPage(1); }} aria-label={t("rpStatus")}
                className={`${FILTER} sm:w-36`}>
                {REQUEST_FILTERS.map((value) => <option key={value || "all"} value={value}>{value ? t(`rpState_${value}`) : t("rpAllStates")}</option>)}
              </select>
            </div>
          )}>
            {requestPageData.total === 0 ? empty : (
              <>
                {/* Mobile / tablet: thẻ */}
                <ul className="divide-y divide-gray-100 dark:divide-gray-800 lg:hidden">
                  {requestPageData.items.map((item) => {
                    const key = item.requestId || "_loose";
                    const open = openRequests.has(key);
                    return (
                      <li key={key}>
                        <button type="button" onClick={() => toggle(setOpenRequests, key)} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-white/[0.02] sm:px-5">
                          <span className={`mt-0.5 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true">›</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-sm font-semibold text-gray-900 dark:text-white">{item.requestId || t("rpUnrequestedShort")}</span>
                              {stateBadge(item.state)}
                            </div>
                            <p className="mt-0.5 truncate text-sm text-gray-700 dark:text-gray-300">{item.content || "—"}</p>
                            <p className="text-xs text-gray-500">
                              {[item.requester, item.dueDate ? `${t("prDueDate")}: ${formatDueDate(item.dueDate)}` : "", t("rpCountLine", { count: item.count })].filter(Boolean).join(" · ")} {dueInfo(item)}
                            </p>
                          </div>
                          <p className="shrink-0 text-right text-sm font-bold tabular-nums text-gray-900 dark:text-white">{money(item.total)}</p>
                        </button>
                        {open && feeTable(item.items)}
                      </li>
                    );
                  })}
                </ul>
                {/* Desktop: bảng */}
                <div className="hidden overflow-x-auto custom-scrollbar lg:block">
                  <table className="w-full min-w-[900px] text-left text-sm">
                    <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                      <tr>
                        <th className="w-10 px-4 py-3" aria-label={t("rpDetails")} />
                        <th className="px-3 py-3">{t("rpRequest")}</th>
                        <th className="px-3 py-3">{t("prContent")}</th>
                        <th className="px-3 py-3">{t("prDueDate")}</th>
                        <th className="px-3 py-3">{t("rpStatus")}</th>
                        <th className="px-3 py-3 text-right">{t("rpFeeCount")}</th>
                        <th className="px-4 py-3 text-right">{t("rpAmountInPeriod")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {requestPageData.items.map((item, index) => {
                        const key = item.requestId || "_loose";
                        const open = openRequests.has(key);
                        return (
                          <Fragment key={key}>
                            <tr onClick={() => toggle(setOpenRequests, key)} className={`cursor-pointer hover:bg-brand-50/40 dark:hover:bg-white/[0.03] ${index % 2 ? "bg-gray-50/40 dark:bg-white/[0.01]" : ""}`}>
                              <td className="px-4 py-3">
                                <button type="button" aria-expanded={open} aria-label={t("rpDetails")} onClick={(event) => { event.stopPropagation(); toggle(setOpenRequests, key); }}
                                  className={`flex h-6 w-6 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 ${open ? "rotate-90" : ""} transition-transform`}>›</button>
                              </td>
                              <td className="whitespace-nowrap px-3 py-3">
                                {item.requestId
                                  ? <Link href={`/payment-requests/${encodeURIComponent(item.requestId)}`} onClick={(event) => event.stopPropagation()} className="font-mono font-semibold text-brand-600 hover:underline dark:text-brand-400">{item.requestId}</Link>
                                  : <span className="font-semibold text-gray-700 dark:text-gray-300">{t("rpUnrequestedShort")}</span>}
                              </td>
                              <td className="max-w-[360px] px-3 py-3">
                                <p className="truncate text-gray-800 dark:text-white/90" title={item.content}>{item.content || "—"}</p>
                                {item.requester && <p className="text-xs text-gray-500">{item.requester}</p>}
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 text-gray-700 dark:text-gray-300">
                                {item.dueDate ? formatDueDate(item.dueDate) : "—"}
                                <p className="text-xs">{dueInfo(item)}</p>
                              </td>
                              <td className="px-3 py-3">{stateBadge(item.state)}</td>
                              <td className="px-3 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{item.count}</td>
                              <td className="whitespace-nowrap px-4 py-3 text-right font-bold tabular-nums text-gray-900 dark:text-white">{money(item.total)}</td>
                            </tr>
                            {open && <tr><td colSpan={7} className="p-0">{feeTable(item.items)}</td></tr>}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <PaginationControls page={requestPageData.safePage} totalPages={requestPageData.totalPages} pageSize={requestPageSize} totalItems={requestPageData.total} from={requestPageData.from} to={requestPageData.to}
                  summaryKey="showingRecords" idPrefix="cost-requests" onPageChange={setRequestPage} onPageSizeChange={(value) => { setRequestPageSize(value); setRequestPage(1); }} />
              </>
            )}
          </Section>

          {/* 3. Nợ phải thu: phí cược cont − phí sửa cont */}
          <Section index={2} title={t("rpReceivableTitle", { date: formatDueDate(data.deposits.asOf || today) })} hint={t("rpReceivableSectionHint")}>
            <div className="p-4 sm:p-5">
              <div className="grid grid-cols-1 items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
                <div className="rounded-xl bg-blue-light-50 p-3 dark:bg-blue-light-500/10">
                  <Stat label={t("rpDepositPaid")} value={money(depositLedger.totals.paid)} strong tone="text-blue-light-700 dark:text-blue-light-300" />
                </div>
                <span className="flex items-center justify-center text-2xl font-bold text-gray-400" aria-hidden="true">−</span>
                <div className="rounded-xl bg-orange-50 p-3 dark:bg-orange-500/10">
                  <Stat label={t("rpRepairCost")} value={money(depositLedger.totals.repair)} strong tone="text-orange-700 dark:text-orange-300" />
                </div>
                <span className="flex items-center justify-center text-2xl font-bold text-gray-400" aria-hidden="true">=</span>
                <div className="rounded-xl bg-success-50 p-3 ring-1 ring-success-200 dark:bg-success-500/10 dark:ring-success-500/30">
                  <Stat label={t("rpReceivable")} value={money(depositLedger.totals.receivable)} strong tone="text-success-700 dark:text-success-300" />
                </div>
              </div>
              {depositLedger.totals.unpaid.length > 0 && <p className="mt-3 text-xs text-warning-700 dark:text-warning-300">{t("rpDepositUnpaidTotal", { amount: money(depositLedger.totals.unpaid) })}</p>}
            </div>
            {depositLedger.items.length === 0 ? <p className="border-t border-gray-100 px-5 py-6 text-sm text-gray-500 dark:border-gray-800">{t("rpNoDeposits")}</p> : (
              <div className="border-t border-gray-100 text-sm dark:border-gray-800">
                <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 bg-gray-50 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400 sm:grid">
                  <span>{t("rpContainer")}</span><span className="text-right">{t("rpDepositPaid")}</span><span className="text-right">{t("rpRepairCost")}</span><span className="text-right">{t("rpReceivable")}</span>
                </div>
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {depositItems.map((item) => {
                    const negative = item.receivable.startsWith("-");
                    return (
                      <li key={`${item.contract}|${item.container}|${item.currency}`} className="grid grid-cols-3 gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:px-5">
                        <div className="col-span-3 min-w-0 sm:col-span-1">
                          <p className="truncate font-mono font-semibold text-gray-800 dark:text-white/90">{item.container || t("rpNoContainer")}</p>
                          <p className="text-xs text-gray-400">
                            {item.contract ? `${t("rpOrderShort")} ${item.contract} · ` : ""}{t("rpDepositSince", { date: formatDueDate(item.since) })}
                            {Number(item.unpaid) > 0 && <span className="text-warning-600 dark:text-warning-400"> · {t("rpDepositUnpaidLine", { amount: moneyText(item.unpaid, item.currency) })}</span>}
                          </p>
                        </div>
                        <Stat label={t("rpDepositPaidShort")} value={moneyText(item.paid, item.currency)} tone="text-gray-700 dark:text-gray-300 sm:text-right" />
                        <Stat label={t("rpRepairShort")} value={moneyText(item.repair, item.currency)} tone="text-gray-700 dark:text-gray-300 sm:text-right" />
                        <div className="min-w-0 sm:text-right">
                          <p className="text-xs text-gray-500 sm:hidden">{t("rpReceivable")}</p>
                          <p className={`break-words font-bold tabular-nums ${negative ? "text-error-600 dark:text-error-400" : "text-success-700 dark:text-success-300"}`}>{moneyText(item.receivable, item.currency)}</p>
                          {negative && <p className="text-xs text-error-600 dark:text-error-400">{t("rpRepairOverDeposit")}</p>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {depositLedger.items.length > PREVIEW && (
                  <div className="border-t border-gray-100 px-4 py-2.5 dark:border-gray-800 sm:px-5">
                    <button type="button" onClick={() => setShowAllDeposits((value) => !value)} className={LINK_BUTTON}>
                      {showAllDeposits ? t("rpShowLess") : t("rpShowAll", { count: depositLedger.items.length })}
                    </button>
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* 4. Cơ cấu chi phí theo khoản mục */}
          <Section index={3} title={t("rpStructure")} hint={t("rpStructureHint")}>
            {summary.byFee.length === 0 ? empty : (
              <div className="grid grid-cols-1 divide-y divide-gray-100 dark:divide-gray-800 xl:grid-cols-2 xl:divide-x xl:divide-y-0">
                {COST_KINDS.map((kind) => {
                  const fees = summary.byFee.filter((fee) => fee.kind === kind);
                  if (fees.length === 0) return null;
                  const subtotal = sumMoney(fees.map((fee) => ({ currency: fee.currency, total: fee.total })));
                  return (
                    <div key={kind} className="px-4 py-4 sm:px-5">
                      <p className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-white/90"><span className={`h-2.5 w-2.5 rounded-full ${KIND_BAR[kind]}`} aria-hidden="true" />{t(`rpKind_${kind}`)}</span>
                        <span className="text-sm font-bold tabular-nums text-gray-900 dark:text-white">{money(subtotal)}</span>
                      </p>
                      <ul className="space-y-2.5">
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
                              <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                                <div className={`h-full rounded-full ${KIND_BAR[kind]}`} style={{ width: `${Math.min(100, fee.share)}%` }} />
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

          {/* 5. Giá vốn đơn hàng */}
          <Section index={4} title={t("rpOrderCost")} hint={t("rpOrderCostHint")} actions={(
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <label className="block min-w-0 sm:w-36">
                <span className="sr-only">{t("rpUsdRate")}</span>
                <input type="text" inputMode="decimal" value={rateText} onChange={(event) => changeRate(event.target.value)} placeholder={t("rpUsdRatePlaceholder")} aria-label={t("rpUsdRate")}
                  className={`${FILTER} ${rateInvalid ? "border-error-400" : ""}`} />
                {rateInvalid && <span className="mt-1 block text-xs text-error-600">{t("rpUsdRateInvalid")}</span>}
              </label>
              <input type="search" value={orderQuery} onChange={(event) => { setOrderQuery(event.target.value); setOrderPage(1); }}
                placeholder={t("rpOrderSearch")} aria-label={t("rpOrderSearch")} className={`${FILTER} sm:w-48`} />
            </div>
          )}>
            {hasForeign && !usdRate && <p className="border-b border-warning-100 bg-warning-50 px-4 py-2.5 text-xs text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-300 sm:px-5">{t("rpUsdRateMissing")}</p>}
            {orderPageData.total === 0 ? empty : (
              <>
                <div className="grid grid-cols-1 gap-4 p-4 sm:p-5 2xl:grid-cols-2">
                  {orderPageData.items.map((order) => {
                    const open = openOrders.has(order.contract);
                    return (
                      <article key={order.contract} className="min-w-0 rounded-xl border border-gray-200 dark:border-gray-700">
                        <div className="flex flex-col gap-2 border-b border-gray-100 p-4 dark:border-gray-800 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="font-mono text-base font-bold text-gray-900 dark:text-white">{order.contract}</p>
                            {order.supplier && <p className="truncate text-xs text-gray-500" title={order.supplier}>{order.supplier}</p>}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">{t("rpContainerCount", { count: order.containerCount })}</span>
                            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">{order.netKg > 0 ? t("rpNetKg", { kg: kg(order.netKg) }) : t("rpNoNet")}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 gap-3 p-4 xsm:grid-cols-3">
                          <Stat label={t("rpGoodsIntl")} value={order.hidden && !order.goods.length ? t("rpHidden") : money(order.goods)} tone="text-brand-700 dark:text-brand-300" />
                          <Stat label={t("rpOrderFees")} value={money(order.orderFees)} tone="text-orange-700 dark:text-orange-300" />
                          <Stat label={t("rpContainerFees")} value={money(order.containerFees)} tone="text-theme-purple-500" />
                        </div>
                        <div className="mx-4 mb-4 grid grid-cols-1 gap-3 rounded-xl bg-gray-50 p-3 dark:bg-white/[0.03] sm:grid-cols-2">
                          <Stat label={t("rpOrderTotal")} value={order.totalVnd !== null ? formatMoney(order.totalVnd, "VND", language) : money(order.total)} strong />
                          <div className="min-w-0 rounded-lg bg-success-50 p-2.5 dark:bg-success-500/10">
                            <p className="text-xs font-medium text-success-700 dark:text-success-300">{t("rpAvgPerKg")}</p>
                            <p className="mt-0.5 break-words text-lg font-bold tabular-nums text-success-700 dark:text-success-300">
                              {order.perKgVnd !== null ? `${formatMoney(order.perKgVnd, "VND", language)}/kg` : "—"}
                            </p>
                            {order.perKgVnd === null && <p className="text-xs text-gray-500">{order.netKg <= 0 ? t("rpAvgNeedsNet") : t("rpAvgNeedsRate")}</p>}
                          </div>
                        </div>
                        {order.containers.length > 0 && (
                          <div className="border-t border-gray-100 dark:border-gray-800">
                            <button type="button" onClick={() => toggle(setOpenOrders, order.contract)} aria-expanded={open}
                              className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium text-brand-600 hover:bg-gray-50 dark:text-brand-400 dark:hover:bg-white/[0.02]">
                              <span>{t("rpContainerDetail", { count: order.containers.length })}</span>
                              <span className={`transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true">›</span>
                            </button>
                            {open && (
                              <ul className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
                                {order.containers.map((item) => (
                                  <li key={item.container} className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm">
                                    <span className="min-w-0 break-all font-mono text-gray-700 dark:text-gray-300">{item.container}</span>
                                    <span className="shrink-0 tabular-nums text-gray-900 dark:text-white">{money(item.fees)}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
                <PaginationControls page={orderPageData.safePage} totalPages={orderPageData.totalPages} pageSize={orderPageSize} totalItems={orderPageData.total} from={orderPageData.from} to={orderPageData.to}
                  summaryKey="showingRecords" idPrefix="cost-orders" onPageChange={setOrderPage} onPageSizeChange={(value) => { setOrderPageSize(value); setOrderPage(1); }} />
              </>
            )}
          </Section>

          <div className={`${CARD} p-4 sm:p-5`}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t("rpNotes")}</p>
            <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              {notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
