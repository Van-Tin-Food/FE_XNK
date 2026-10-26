import type { CostOverview } from "@/services/paymentCostApi";
import { compareCurrency, costState, fromCents, groupByRequest, summarizeCosts, summarizeShipments, toCents, type Money } from "@/utils/costStatistics";
import { splitVat } from "@/utils/paymentRequest";

// Xuất Excel trang Quản lý chi phí của một tháng: Tổng hợp, Theo đề nghị, Theo khoản phí, Theo lô hàng, Theo container
// (lũy kế, chi phí chung chia đều cho container), Chi tiết. Số tiền ghi dạng số, mỗi loại tiền một cột (#,##0 cho VND,
// #,##0.00 cho USD) để Excel cộng / lọc được. xlsx (SheetJS) nạp khi bấm xuất, không đóng gói vào trang.

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

/** Cột tiền: một cột cho mỗi loại tiền có trong dữ liệu ("Chi phí (VND)", "Chi phí (USD)"). */
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

  const { month, costs } = overview;
  const monthLabel = `${month.slice(5, 7)}/${month.slice(0, 4)}`;
  const kindLabel = (kind: string) => t(`cmKind_${kind}`);
  const summary = summarizeCosts(costs);
  const byRequest = groupByRequest(costs);
  const shipments = summarizeShipments(overview.shipments, overview.shipmentCosts);

  // ---------- Tổng hợp ----------
  const summaryRows: Cell[][] = [
    [t("cmExcelTitle", { month: monthLabel })],
    [t("cmExcelExportedAt", { time: formatDateTime(new Date().toISOString()) })],
    [],
    ["", t("cmCurrency"), t("cmCount"), t("cmGroup_paid"), t("cmNotPaid"), t("cmTotal")],
  ];
  const summaryFormats: Array<{ row: number; currency: string }> = [];
  for (const [label, items] of [[t("cmTotalCost"), summary.costs], [t("cmGoods"), summary.goods]] as const) {
    for (const item of items) {
      summaryFormats.push({ row: summaryRows.length, currency: item.currency });
      summaryRows.push([label, item.currency, item.count, toNumber(item.paid), toNumber(fromCents(toCents(item.processing) + toCents(item.unrequested))), toNumber(item.total)]);
    }
  }
  const notes = [
    summary.cancelledCount ? t("cmCancelledNote", { count: summary.cancelledCount }) : "",
    summary.hiddenCount ? t("cmHiddenNote") : "",
    costs.some((cost) => cost.currencyInferred) ? t("cmInferredNote") : "",
    t("cmShipmentHint"),
  ].filter(Boolean);
  summaryRows.push([], ...notes.map((note) => [note]));
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [{ wch: 34 }, { wch: 10 }, { wch: 10 }, { wch: 22 }, { wch: 22 }, { wch: 20 }];
  for (const { row, currency } of summaryFormats) {
    for (const column of [3, 4, 5]) {
      const cell = summarySheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell && cell.t === "n") cell.z = AMOUNT_FORMAT(currency);
    }
  }

  // ---------- Theo đề nghị ----------
  type RequestRow = { id: string; content: string; requester: string; due: string; state: string; count: number; total: Money };
  const requestRows: RequestRow[] = [
    ...byRequest.requests.map((item) => ({ id: item.requestId, content: item.content, requester: item.requester, due: formatDate(item.dueDate), state: t(`cmState_${item.state}`), count: item.count, total: item.total })),
    ...(byRequest.unrequested.count ? [{ id: "", content: t("cmUnrequested"), requester: "", due: "", state: t("cmState_none"), count: byRequest.unrequested.count, total: byRequest.unrequested.total }] : []),
  ];
  const requestSheet = table(requestRows, [
    { label: t("cmRequest"), value: (row) => row.id, width: 12 },
    { label: t("prContent"), value: (row) => row.content, width: 40 },
    { label: t("cmRequester"), value: (row) => row.requester, width: 20 },
    { label: t("prDueDate"), value: (row) => row.due, width: 14 },
    { label: t("cmState"), value: (row) => row.state, width: 16 },
    { label: t("cmCount"), value: (row) => row.count, width: 10 },
    ...moneyColumns(requestRows, t("cmTotal"), (row) => row.total),
  ]);

  // ---------- Theo khoản phí ----------
  const feeSheet = table(summary.byFee, [
    { label: t("cmKind"), value: (row) => kindLabel(row.kind), width: 28 },
    { label: t("prCostCodeLabel"), value: (row) => row.code, width: 10 },
    { label: t("mcFee"), value: (row) => row.name, width: 32 },
    { label: t("cmCount"), value: (row) => row.count, width: 10 },
    ...["VND", "USD"].filter((currency) => summary.byFee.some((fee) => fee.currency === currency)).map((currency) => ({
      label: `${t("cmTotal")} (${currency})`, value: (row: (typeof summary.byFee)[number]) => (row.currency === currency ? toNumber(row.total) : ""), currency, width: 18,
    })),
  ]);

  // ---------- Theo lô hàng / theo container ----------
  const lotSheet = table(shipments.lots, [
    { label: t("cmLot"), value: (row) => row.contract, width: 14 },
    { label: t("supplier"), value: (row) => row.supplier, width: 30 },
    { label: t("cmContainers"), value: (row) => row.containerCount || "", width: 10 },
    ...moneyColumns(shipments.lots, t("cmLotCost"), (row) => row.cost),
    ...moneyColumns(shipments.lots, t("cmCostPerContainer"), (row) => row.costPerContainer),
    ...moneyColumns(shipments.lots, t("cmGoods"), (row) => row.goods),
    ...moneyColumns(shipments.lots, t("cmGoodsPerContainer"), (row) => row.goodsPerContainer),
  ]);
  const containerSheet = table(shipments.containers, [
    { label: t("cmContainer"), value: (row) => row.container, width: 16 },
    { label: t("cmLot"), value: (row) => row.contract, width: 14 },
    { label: t("supplier"), value: (row) => row.supplier, width: 30 },
    ...moneyColumns(shipments.containers, t("cmDirectCost"), (row) => row.direct),
    ...moneyColumns(shipments.containers, t("cmSharedCost"), (row) => row.shared),
    ...moneyColumns(shipments.containers, t("cmContainerTotal"), (row) => row.total),
    ...moneyColumns(shipments.containers, t("cmGoodsPerContainer"), (row) => row.goodsShare),
  ]);

  // ---------- Chi tiết ----------
  const detailSheet = table(costs, [
    { label: t("cmRequest"), value: (row) => row.requestId, width: 12 },
    { label: t("mcCreatedAt"), value: (row) => formatDateTime(row.createdAt), width: 16 },
    { label: t("cmCostId"), value: (row) => row.id, width: 20 },
    { label: t("cmKind"), value: (row) => kindLabel(row.kind), width: 26 },
    { label: t("prCostCodeLabel"), value: (row) => row.code, width: 10 },
    { label: t("mcFee"), value: (row) => row.categoryName, width: 28 },
    { label: t("cmLot"), value: (row) => row.contract, width: 12 },
    { label: t("cmContainer"), value: (row) => row.container, width: 16 },
    { label: t("prCostNote"), value: (row) => row.note, width: 28 },
    ...["VND", "USD"].map((currency) => ({
      label: `${t("cmAmount")} (${currency})`, value: (row: (typeof costs)[number]) => (row.currency !== currency ? "" : row.amount === null ? t("cmHidden") : toNumber(row.amount)), currency, width: 18,
    })),
    { label: t("cmInferredCol"), value: (row) => (row.currencyInferred ? t("cmYes") : ""), width: 12 },
    { label: t("cmVatRate"), value: (row) => (row.vat ? Number(row.vat) : ""), width: 8 },
    { label: t("cmTax"), value: (row) => (row.amount !== null && row.vat ? toNumber(splitVat(row.amount, row.vat, row.currency === "USD" || row.currency === "VND" ? row.currency : "").tax) : ""), width: 14 },
    { label: t("cmState"), value: (row) => t(`cmState_${costState(row)}`), width: 16 },
    { label: t("cmEnteredBy"), value: (row) => row.userName, width: 20 },
  ]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summarySheet, t("cmExcelSummarySheet"));
  XLSX.utils.book_append_sheet(workbook, requestSheet, t("cmExcelRequestSheet"));
  XLSX.utils.book_append_sheet(workbook, feeSheet, t("cmExcelFeeSheet"));
  XLSX.utils.book_append_sheet(workbook, lotSheet, t("cmExcelLotSheet"));
  XLSX.utils.book_append_sheet(workbook, containerSheet, t("cmExcelContainerSheet"));
  XLSX.utils.book_append_sheet(workbook, detailSheet, t("cmExcelDetailSheet"));
  const fileName = `Chi-phi-${month}.xlsx`;
  XLSX.writeFile(workbook, fileName);
  return fileName;
}
