import type { CostOverview } from "@/services/paymentCostApi";
import {
  compareCurrency, costState, groupByRequest, isPurchaseCost, stageMoney, sumMoney, summarizeCosts, summarizeDeposits, summarizeOrders, toCents, vatCents,
  fromCents, withoutDeposits, type Money, type MonthlyCost,
} from "@/utils/costStatistics";

// Xuất Excel Báo cáo chi phí của một kỳ (tháng), cùng các mục trên trang: Tổng hợp (chỉ tiêu tổng hợp + nợ phải thu), Đề
// nghị thanh toán (mỗi dòng một khoản phí, kèm đề nghị chứa khoản), Nợ phải thu (phí cược cont − phí sửa cont theo
// container), Cơ cấu chi phí, Giá vốn đơn hàng (tiền hàng, thuế & phí đơn, phí cont, quy đổi VND theo tỷ giá đã nhập, giá
// vốn trung bình / kg), Giá vốn theo container. Tiền cược container không tính vào số liệu nào ngoài Nợ phải thu. Số tiền
// ghi dạng số theo nguyên tệ, mỗi loại tiền một cột (#,##0 cho VND, #,##0.00 cho USD). xlsx (SheetJS) nạp khi bấm xuất.

type Translate = (key: string, params?: Record<string, string | number>) => string;
type Cell = string | number;
interface Column<T> { label: string; value: (row: T) => Cell; currency?: string; width?: number }

const AMOUNT_FORMAT = (currency: string) => (currency === "USD" ? "#,##0.00" : "#,##0");
const toNumber = (value: string | null | undefined): Cell => (value === null || value === undefined || value === "" ? "" : Number(value));
const amountIn = (money: Money, currency: string): Cell => toNumber(money.find((item) => item.currency === currency)?.total ?? null);

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}
const formatDate = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : value);

/** Cột tiền: một cột cho mỗi loại tiền có trong dữ liệu ("Tiền hàng (VND)", "Tiền hàng (USD)"). */
function moneyColumns<T>(rows: T[], label: string, pick: (row: T) => Money): Array<Column<T>> {
  const currencies = [...new Set(rows.flatMap((row) => pick(row).map((item) => item.currency)))].sort(compareCurrency);
  return (currencies.length ? currencies : ["VND"]).map((currency) => ({ label: `${label} (${currency})`, value: (row: T) => amountIn(pick(row), currency), currency, width: 18 }));
}

export async function exportCostOverviewExcel({ overview, t, usdRate = null, rateText = "" }: {
  overview: CostOverview;
  t: Translate;
  /** Tỷ giá USD/VND (xu VND cho 1 USD) người xem đã nhập; null = không quy đổi. */
  usdRate?: bigint | null;
  rateText?: string;
}): Promise<string> {
  const XLSX = await import("xlsx");
  type Sheet = ReturnType<typeof XLSX.utils.aoa_to_sheet>;
  /** Bảng có tiêu đề + bộ lọc; ô tiền theo định dạng loại tiền của cột. */
  function table<T>(rows: T[], columns: Array<Column<T>>): Sheet {
    const sheet = XLSX.utils.aoa_to_sheet([columns.map((column) => column.label), ...rows.map((row) => columns.map((column) => column.value(row)))]);
    sheet["!cols"] = columns.map((column) => ({ wch: column.width ?? 16 }));
    columns.forEach((column, index) => {
      if (!column.currency) return;
      rows.forEach((_, rowIndex) => {
        const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex + 1, c: index })];
        if (cell && cell.t === "n") cell.z = AMOUNT_FORMAT(column.currency as string);
      });
    });
    if (rows.length) sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: columns.length - 1 } }) };
    return sheet;
  }

  const { month } = overview;
  const monthLabel = `${month.slice(5, 7)}/${month.slice(0, 4)}`;
  // Tiền cược container không tính vào số liệu của kỳ (chỉ ở sheet Nợ phải thu).
  const costs = withoutDeposits(overview.costs);
  const summary = summarizeCosts(costs);
  const byRequest = groupByRequest(costs);
  const deposits = summarizeDeposits(overview.deposits.rows);
  const orders = summarizeOrders(overview.shipments, overview.shipmentCosts, usdRate);

  // ---------- Tổng hợp ----------
  const summaryRows: Cell[][] = [
    [t("rpExcelTitle", { month: monthLabel })],
    [t("rpExcelExportedAt", { time: formatDateTime(new Date().toISOString()) })],
    [t("rpBasisNote")],
    [t("rpCurrencyNote")],
    [],
    [`1. ${t("rpKeyFigures", { month: monthLabel })}`, t("rpCurrency"), t("rpCount"), t("rpAmount")],
  ];
  // Ô tiền cần định dạng: hàng, các cột, loại tiền.
  const formats: Array<{ row: number; columns: number[]; currency: string }> = [];
  const push = (cells: Cell[], currency: string, columns: number[]) => {
    formats.push({ row: summaryRows.length, columns, currency });
    summaryRows.push(cells);
  };
  const stageOf = (stages: Array<"settled" | "approved" | "pending" | "unsubmitted" | "unrequested">) => {
    const parts = stages.flatMap((stage) => [stageMoney(summary.costs, stage), stageMoney(summary.goods, stage)]);
    return { count: parts.reduce((sum, item) => sum + item.count, 0), total: sumMoney(...parts.map((item) => item.total)) };
  };
  // Chi phí mua hàng = tiền hàng + khoản gắn đơn hàng (vận chuyển, phí liên quan); chi phí vận hành = khoản không gắn đơn.
  const purchase = summarizeCosts(costs.filter(isPurchaseCost));
  const operating = summarizeCosts(costs.filter((cost) => !isPurchaseCost(cost)));
  const totalOf = (items: typeof summary.costs) => sumMoney(items.map((item) => ({ currency: item.currency, total: item.total })));
  const countOf = (items: typeof summary.costs) => items.reduce((sum, item) => sum + item.count, 0);
  const figures: Array<[string, number, Money]> = [
    [t("rpPurchases"), countOf(purchase.goods) + countOf(purchase.costs), sumMoney(totalOf(purchase.goods), totalOf(purchase.costs))],
    [`  ${t("rpPurchaseGoods")}`, countOf(purchase.goods), totalOf(purchase.goods)],
    [`  ${t("rpPurchaseFees")}`, countOf(purchase.costs), totalOf(purchase.costs)],
    [t("rpExpense"), countOf(operating.costs), totalOf(operating.costs)],
  ];
  const settled = stageOf(["settled"]);
  const outstanding = stageOf(["approved", "pending", "unsubmitted", "unrequested"]);
  figures.push([t("rpSettled"), settled.count, settled.total], [t("rpOutstanding"), outstanding.count, outstanding.total]);
  for (const [label, count, total] of figures) {
    if (!total.length) summaryRows.push([label, "", count, ""]);
    for (const item of total) push([label, item.currency, count, toNumber(item.total)], item.currency, [3]);
  }
  summaryRows.push([], [`3. ${t("rpReceivableTitle", { date: formatDate(overview.deposits.asOf) })}`, t("rpCurrency"), t("rpDepositPaid"), t("rpRepairCost"), t("rpReceivable"), t("rpDepositUnpaid")]);
  const depositCurrencies = [...new Set([...deposits.totals.paid, ...deposits.totals.repair, ...deposits.totals.unpaid].map((item) => item.currency))].sort(compareCurrency);
  for (const currency of depositCurrencies) {
    push([t("rpGrandTotal"), currency, amountIn(deposits.totals.paid, currency) || 0, amountIn(deposits.totals.repair, currency) || 0,
      amountIn(deposits.totals.receivable, currency) || 0, amountIn(deposits.totals.unpaid, currency) || 0], currency, [2, 3, 4, 5]);
  }
  const notes = [
    overview.truncated ? t("rpTruncatedNote") : "",
    summary.cancelledCount ? t("rpCancelledNote", { count: summary.cancelledCount }) : "",
    summary.hiddenCount ? t("rpHiddenNote") : "",
    costs.some((cost) => cost.currencyInferred) ? t("rpInferredNote") : "",
    overview.deposits.truncated ? t("rpDepositTruncatedNote") : "",
    t("rpDepositNote"),
    t("rpOrderCostHint"),
    rateText ? t("rpExcelRate", { rate: rateText }) : "",
  ].filter(Boolean);
  summaryRows.push([], [t("rpNotes")], ...notes.map((note) => [`• ${note}`]));
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [{ wch: 44 }, { wch: 10 }, { wch: 18 }, { wch: 22 }, { wch: 22 }, { wch: 22 }];
  for (const { row, columns, currency } of formats) {
    for (const column of columns) {
      const cell = summarySheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell && cell.t === "n") cell.z = AMOUNT_FORMAT(currency);
    }
  }

  // ---------- Đề nghị thanh toán (mỗi dòng một khoản phí) ----------
  const requestLines: MonthlyCost[] = [...byRequest.requests.flatMap((item) => item.items), ...byRequest.unrequested.items];
  const requestSheet = table(requestLines, [
    { label: t("rpRequest"), value: (row) => row.requestId || t("rpUnrequestedShort"), width: 14 },
    { label: t("prContent"), value: (row) => row.requestContent, width: 36 },
    { label: t("rpRequester"), value: (row) => row.requestBy, width: 18 },
    { label: t("prDueDate"), value: (row) => formatDate(row.requestDue), width: 12 },
    { label: t("rpStatus"), value: (row) => t(`rpState_${costState(row)}`), width: 20 },
    { label: t("rpCostItem"), value: (row) => row.categoryName, width: 28 },
    { label: t("prCostCodeLabel"), value: (row) => row.code, width: 8 },
    { label: t("rpAccount"), value: (row) => row.account, width: 10 },
    { label: t("rpOrder"), value: (row) => row.contract, width: 12 },
    { label: t("rpContainer"), value: (row) => row.container, width: 16 },
    { label: t("prCostNote"), value: (row) => row.note, width: 26 },
    { label: t("rpVatRate"), value: (row) => (row.vat ? Number(row.vat) : ""), width: 8 },
    ...["VND", "USD"].map((currency) => ({
      label: `${t("rpTotalInclVat")} (${currency})`, value: (row: MonthlyCost) => (row.currency !== currency ? "" : row.amount === null ? t("rpHidden") : toNumber(row.amount)), currency, width: 18,
    })),
    { label: t("rpVat"), value: (row) => (row.amount !== null && row.vat ? toNumber(fromCents(vatCents(toCents(row.amount), row.vat, row.currency))) : ""), width: 14 },
    { label: t("rpRecordedAt"), value: (row) => formatDateTime(row.createdAt), width: 16 },
    { label: t("rpEnteredBy"), value: (row) => row.userName, width: 18 },
  ]);

  // ---------- Nợ phải thu (tiền cược container) ----------
  const depositSheet = table(deposits.items, [
    { label: t("rpContainer"), value: (row) => row.container, width: 16 },
    { label: t("rpOrder"), value: (row) => row.contract, width: 14 },
    { label: t("rpDepositSinceCol"), value: (row) => formatDate(row.since), width: 14 },
    { label: t("rpCurrency"), value: (row) => row.currency, width: 10 },
    ...(["paid", "repair", "receivable", "unpaid"] as const).map((field) => ({
      label: t({ paid: "rpDepositPaid", repair: "rpRepairCost", receivable: "rpReceivable", unpaid: "rpDepositUnpaid" }[field]),
      value: (row: (typeof deposits.items)[number]) => toNumber(row[field]),
      width: 20,
    })),
  ]);
  // Định dạng tiền theo loại tiền của từng dòng (bảng nhiều loại tiền trong cùng cột).
  deposits.items.forEach((row, index) => {
    for (const column of [4, 5, 6, 7]) {
      const cell = depositSheet[XLSX.utils.encode_cell({ r: index + 1, c: column })];
      if (cell && cell.t === "n") cell.z = AMOUNT_FORMAT(row.currency);
    }
  });

  // ---------- Cơ cấu chi phí ----------
  const feeSheet = table(summary.byFee, [
    { label: t("rpCostGroup"), value: (row) => t(`rpKind_${row.kind}`), width: 30 },
    { label: t("rpAccount"), value: (row) => row.account, width: 12 },
    { label: t("prCostCodeLabel"), value: (row) => row.code, width: 10 },
    { label: t("rpCostItem"), value: (row) => row.name, width: 32 },
    { label: t("rpCount"), value: (row) => row.count, width: 10 },
    ...["VND", "USD"].filter((currency) => summary.byFee.some((fee) => fee.currency === currency)).map((currency) => ({
      label: `${t("rpTotalInclVat")} (${currency})`, value: (row: (typeof summary.byFee)[number]) => (row.currency === currency ? toNumber(row.total) : ""), currency, width: 20,
    })),
    { label: t("rpShare"), value: (row) => row.share, width: 12 },
  ]);

  // ---------- Giá vốn đơn hàng / theo container ----------
  const orderSheet = table(orders, [
    { label: t("rpOrder"), value: (row) => row.contract, width: 14 },
    { label: t("supplier"), value: (row) => row.supplier, width: 30 },
    { label: t("rpContainers"), value: (row) => row.containerCount || "", width: 10 },
    { label: t("rpNetKgCol"), value: (row) => row.netKg || "", width: 14 },
    ...moneyColumns(orders, t("rpGoodsIntl"), (row) => row.goods),
    ...moneyColumns(orders, t("rpOrderFees"), (row) => row.orderFees),
    ...moneyColumns(orders, t("rpContainerFees"), (row) => row.containerFees),
    ...moneyColumns(orders, t("rpOrderTotal"), (row) => row.total),
    { label: `${t("rpOrderTotal")} (VND, ${t("rpConverted")})`, value: (row) => toNumber(row.totalVnd), currency: "VND", width: 22 },
    { label: `${t("rpAvgPerKg")} (VND/kg)`, value: (row) => toNumber(row.perKgVnd), currency: "VND", width: 18 },
  ]);
  const containerRows = orders.flatMap((order) => order.containers.map((item) => ({ ...item, contract: order.contract, supplier: order.supplier })));
  const containerSheet = table(containerRows, [
    { label: t("rpContainer"), value: (row) => row.container, width: 16 },
    { label: t("rpOrder"), value: (row) => row.contract, width: 14 },
    { label: t("supplier"), value: (row) => row.supplier, width: 30 },
    ...moneyColumns(containerRows, t("rpContainerFees"), (row) => row.fees),
  ]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summarySheet, t("rpSheetSummary"));
  XLSX.utils.book_append_sheet(workbook, requestSheet, t("rpSheetRequests"));
  XLSX.utils.book_append_sheet(workbook, depositSheet, t("rpSheetDeposits"));
  XLSX.utils.book_append_sheet(workbook, feeSheet, t("rpSheetStructure"));
  XLSX.utils.book_append_sheet(workbook, orderSheet, t("rpSheetOrders"));
  XLSX.utils.book_append_sheet(workbook, containerSheet, t("rpSheetContainers"));
  const fileName = `Bao-cao-chi-phi-${month}.xlsx`;
  XLSX.writeFile(workbook, fileName);
  return fileName;
}
