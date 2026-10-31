import type { CostOverview } from "@/services/paymentCostApi";
import {
  SETTLEMENT_STAGES, agePayables, compareCurrency, costState, groupByRequest, summarizeCosts, summarizeShipments, toCents,
  vatCents, fromCents, type Money,
} from "@/utils/costStatistics";

// Xuất Excel Báo cáo chi phí & công nợ phải trả của một kỳ (tháng): Tổng hợp (I. chỉ tiêu tổng hợp, II. tình hình thanh
// toán, III. tuổi nợ phải trả), Tuổi nợ phải trả (chi tiết đề nghị chưa chi), Cơ cấu chi phí, Bảng kê đề nghị, Giá vốn theo
// lô hàng / container (lũy kế, chi phí chung + trị giá hàng phân bổ đều), Chi tiết phát sinh. Số tiền ghi dạng số theo
// nguyên tệ, mỗi loại tiền một cột (#,##0 cho VND, #,##0.00 cho USD) để Excel cộng / lọc được. xlsx (SheetJS) nạp khi bấm
// xuất, không đóng gói vào trang.

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

/** Cột tiền: một cột cho mỗi loại tiền có trong dữ liệu ("Giá vốn (VND)", "Giá vốn (USD)"). */
function moneyColumns<T>(rows: T[], label: string, pick: (row: T) => Money): Array<Column<T>> {
  const currencies = [...new Set(rows.flatMap((row) => pick(row).map((item) => item.currency)))].sort(compareCurrency);
  return (currencies.length ? currencies : ["VND"]).map((currency) => ({ label: `${label} (${currency})`, value: (row: T) => amountIn(pick(row), currency), currency, width: 18 }));
}

export async function exportCostOverviewExcel({ overview, t }: { overview: CostOverview; t: Translate }): Promise<string> {
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

  const { month, costs, payables } = overview;
  const monthLabel = `${month.slice(5, 7)}/${month.slice(0, 4)}`;
  const kindLabel = (kind: string) => t(`rpKind_${kind}`);
  const summary = summarizeCosts(costs);
  const byRequest = groupByRequest(costs);
  const shipments = summarizeShipments(overview.shipments, overview.shipmentCosts);
  const aging = agePayables(payables.rows, payables.asOf);
  const currencies = [...new Set([...summary.costs, ...summary.goods].map((item) => item.currency))].sort(compareCurrency);

  // ---------- Tổng hợp ----------
  const summaryRows: Cell[][] = [
    [t("rpExcelTitle", { month: monthLabel })],
    [t("rpExcelExportedAt", { time: formatDateTime(new Date().toISOString()) })],
    [t("rpBasisNote")],
    [t("rpCurrencyNote")],
    [],
    [`I. ${t("rpKeyFigures", { month: monthLabel })}`, t("rpCurrency"), t("rpCount"), t("rpPreTax"), t("rpVat"), t("rpTotalInclVat")],
  ];
  // Ô tiền cần định dạng: hàng, các cột, loại tiền.
  const formats: Array<{ row: number; columns: number[]; currency: string }> = [];
  const push = (cells: Cell[], currency: string, columns: number[]) => {
    formats.push({ row: summaryRows.length, columns, currency });
    summaryRows.push(cells);
  };
  for (const [label, items] of [[t("rpExpense"), summary.costs], [t("rpPurchases"), summary.goods]] as const) {
    for (const item of items) push([label, item.currency, item.count, toNumber(item.base), toNumber(item.tax), toNumber(item.total)], item.currency, [3, 4, 5]);
  }
  summaryRows.push([], [`II. ${t("rpSettlement")}`, t("rpCurrency"), t("rpCount"), t("rpExpenseShort"), t("rpPurchasesShort"), t("rpGrandTotal")]);
  for (const stage of SETTLEMENT_STAGES) {
    for (const currency of currencies) {
      const expense = summary.costs.find((item) => item.currency === currency)?.stages[stage];
      const purchases = summary.goods.find((item) => item.currency === currency)?.stages[stage];
      const count = (expense?.count ?? 0) + (purchases?.count ?? 0);
      if (!count) continue;
      const sum = fromCents(toCents(expense?.total) + toCents(purchases?.total));
      push([t(`rpStage_${stage}`), currency, count, toNumber(expense?.total ?? "0"), toNumber(purchases?.total ?? "0"), toNumber(sum)], currency, [3, 4, 5]);
    }
  }
  summaryRows.push([], [`III. ${t("rpAging", { date: formatDate(payables.asOf) })}`, t("rpCurrency"), t("rpRequestCount"), t("rpAmount")]);
  for (const row of aging.rows) {
    if (!row.count) continue;
    if (!row.total.length) summaryRows.push([t(`rpBucket_${row.bucket}`), "", row.count, row.hiddenCount ? t("rpHidden") : ""]);
    for (const item of row.total) push([t(`rpBucket_${row.bucket}`), item.currency, row.count, toNumber(item.total)], item.currency, [3]);
  }
  for (const item of aging.total) push([t("rpTotalPayables"), item.currency, aging.count, toNumber(item.total)], item.currency, [3]);
  const notes = [
    payables.truncated ? t("rpPayablesTruncatedNote") : "",
    summary.cancelledCount ? t("rpCancelledNote", { count: summary.cancelledCount }) : "",
    summary.hiddenCount ? t("rpHiddenNote") : "",
    costs.some((cost) => cost.currencyInferred) ? t("rpInferredNote") : "",
    t("rpLandedHint"),
  ].filter(Boolean);
  summaryRows.push([], [t("rpNotes")], ...notes.map((note) => [`• ${note}`]));
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [{ wch: 44 }, { wch: 10 }, { wch: 12 }, { wch: 22 }, { wch: 22 }, { wch: 22 }];
  for (const { row, columns, currency } of formats) {
    for (const column of columns) {
      const cell = summarySheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell && cell.t === "n") cell.z = AMOUNT_FORMAT(currency);
    }
  }

  // ---------- Tuổi nợ phải trả ----------
  const agingSheet = table(aging.items, [
    { label: t("rpRequest"), value: (row) => row.requestId, width: 12 },
    { label: t("prContent"), value: (row) => row.content, width: 40 },
    { label: t("rpRequester"), value: (row) => row.requester, width: 20 },
    { label: t("rpRequestDate"), value: (row) => formatDate(row.requestDate), width: 14 },
    { label: t("rpStatus"), value: (row) => t(`rpState_${row.state}`), width: 22 },
    { label: t("prDueDate"), value: (row) => formatDate(row.dueDate), width: 14 },
    { label: t("rpDaysOverdueCol"), value: (row) => (row.daysOverdue === null ? "" : row.daysOverdue), width: 12 },
    { label: t("rpAgingBucket"), value: (row) => t(`rpBucket_${row.bucket}`), width: 26 },
    ...["VND", "USD"].filter((currency) => aging.items.some((row) => row.currency === currency)).map((currency) => ({
      label: `${t("rpAmount")} (${currency})`, value: (row: (typeof aging.items)[number]) => (row.currency !== currency ? "" : row.amount === null ? t("rpHidden") : toNumber(row.amount)), currency, width: 18,
    })),
  ]);

  // ---------- Cơ cấu chi phí ----------
  const feeSheet = table(summary.byFee, [
    { label: t("rpCostGroup"), value: (row) => kindLabel(row.kind), width: 30 },
    { label: t("rpAccount"), value: (row) => row.account, width: 12 },
    { label: t("prCostCodeLabel"), value: (row) => row.code, width: 10 },
    { label: t("rpCostItem"), value: (row) => row.name, width: 32 },
    { label: t("rpCount"), value: (row) => row.count, width: 10 },
    ...["VND", "USD"].filter((currency) => summary.byFee.some((fee) => fee.currency === currency)).map((currency) => ({
      label: `${t("rpTotalInclVat")} (${currency})`, value: (row: (typeof summary.byFee)[number]) => (row.currency === currency ? toNumber(row.total) : ""), currency, width: 20,
    })),
    { label: t("rpShare"), value: (row) => row.share, width: 12 },
  ]);

  // ---------- Bảng kê đề nghị ----------
  type RequestRow = { id: string; content: string; requester: string; due: string; state: string; count: number; total: Money };
  const requestRows: RequestRow[] = [
    ...byRequest.requests.map((item) => ({ id: item.requestId, content: item.content, requester: item.requester, due: formatDate(item.dueDate), state: t(`rpState_${item.state}`), count: item.count, total: item.total })),
    ...(byRequest.unrequested.count ? [{ id: "", content: t("rpStage_unrequested"), requester: "", due: "", state: t("rpState_none"), count: byRequest.unrequested.count, total: byRequest.unrequested.total }] : []),
  ];
  const requestSheet = table(requestRows, [
    { label: t("rpRequest"), value: (row) => row.id, width: 12 },
    { label: t("prContent"), value: (row) => row.content, width: 40 },
    { label: t("rpRequester"), value: (row) => row.requester, width: 20 },
    { label: t("prDueDate"), value: (row) => row.due, width: 14 },
    { label: t("rpStatus"), value: (row) => row.state, width: 22 },
    { label: t("rpCount"), value: (row) => row.count, width: 10 },
    ...moneyColumns(requestRows, t("rpAmountInPeriod"), (row) => row.total),
  ]);

  // ---------- Giá vốn theo lô hàng / theo container ----------
  const lotSheet = table(shipments.lots, [
    { label: t("rpLot"), value: (row) => row.contract, width: 14 },
    { label: t("supplier"), value: (row) => row.supplier, width: 30 },
    { label: t("rpContainers"), value: (row) => row.containerCount || "", width: 10 },
    ...moneyColumns(shipments.lots, t("rpGoodsValue"), (row) => row.goods),
    ...moneyColumns(shipments.lots, t("rpImportCost"), (row) => row.cost),
    ...moneyColumns(shipments.lots, t("rpCostPerContainer"), (row) => row.costPerContainer),
    ...moneyColumns(shipments.lots, t("rpLandedCost"), (row) => row.landed),
    ...moneyColumns(shipments.lots, t("rpLandedPerContainer"), (row) => row.landedPerContainer),
  ]);
  const containerSheet = table(shipments.containers, [
    { label: t("rpContainer"), value: (row) => row.container, width: 16 },
    { label: t("rpLot"), value: (row) => row.contract, width: 14 },
    { label: t("supplier"), value: (row) => row.supplier, width: 30 },
    ...moneyColumns(shipments.containers, t("rpDirectCost"), (row) => row.direct),
    ...moneyColumns(shipments.containers, t("rpAllocatedCost"), (row) => row.shared),
    ...moneyColumns(shipments.containers, t("rpContainerCost"), (row) => row.total),
    ...moneyColumns(shipments.containers, t("rpGoodsAllocated"), (row) => row.goodsShare),
    ...moneyColumns(shipments.containers, t("rpLandedCost"), (row) => row.landed),
  ]);

  // ---------- Chi tiết phát sinh ----------
  const detailSheet = table(costs, [
    { label: t("rpRequest"), value: (row) => row.requestId, width: 12 },
    { label: t("rpRecordedAt"), value: (row) => formatDateTime(row.createdAt), width: 16 },
    { label: t("rpCostId"), value: (row) => row.id, width: 20 },
    { label: t("rpCostGroup"), value: (row) => kindLabel(row.kind), width: 28 },
    { label: t("rpAccount"), value: (row) => row.account, width: 12 },
    { label: t("prCostCodeLabel"), value: (row) => row.code, width: 10 },
    { label: t("rpCostItem"), value: (row) => row.categoryName, width: 28 },
    { label: t("rpLot"), value: (row) => row.contract, width: 12 },
    { label: t("rpContainer"), value: (row) => row.container, width: 16 },
    { label: t("prCostNote"), value: (row) => row.note, width: 28 },
    ...["VND", "USD"].map((currency) => ({
      label: `${t("rpTotalInclVat")} (${currency})`, value: (row: (typeof costs)[number]) => (row.currency !== currency ? "" : row.amount === null ? t("rpHidden") : toNumber(row.amount)), currency, width: 18,
    })),
    { label: t("rpInferredCol"), value: (row) => (row.currencyInferred ? t("rpYes") : ""), width: 12 },
    { label: t("rpVatRate"), value: (row) => (row.vat ? Number(row.vat) : ""), width: 8 },
    { label: t("rpVat"), value: (row) => (row.amount !== null && row.vat ? toNumber(fromCents(vatCents(toCents(row.amount), row.vat, row.currency))) : ""), width: 14 },
    { label: t("rpStatus"), value: (row) => t(`rpState_${costState(row)}`), width: 22 },
    { label: t("rpEnteredBy"), value: (row) => row.userName, width: 20 },
  ]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summarySheet, t("rpSheetSummary"));
  XLSX.utils.book_append_sheet(workbook, agingSheet, t("rpSheetAging"));
  XLSX.utils.book_append_sheet(workbook, feeSheet, t("rpSheetStructure"));
  XLSX.utils.book_append_sheet(workbook, requestSheet, t("rpSheetRegister"));
  XLSX.utils.book_append_sheet(workbook, lotSheet, t("rpSheetLots"));
  XLSX.utils.book_append_sheet(workbook, containerSheet, t("rpSheetContainers"));
  XLSX.utils.book_append_sheet(workbook, detailSheet, t("rpSheetDetail"));
  const fileName = `Bao-cao-chi-phi-cong-no-${month}.xlsx`;
  XLSX.writeFile(workbook, fileName);
  return fileName;
}
