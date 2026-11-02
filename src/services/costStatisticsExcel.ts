import type { CostOverview } from "@/services/paymentCostApi";
import {
  compareCurrency, costState, groupByRequest, summarizeCosts, summarizeDeposits, toCents, vatCents, fromCents, withoutDeposits,
  type Money, type MonthlyCost,
} from "@/utils/costStatistics";

// Xuất Excel Báo cáo chi phí của một kỳ (tháng), cùng các mục trên trang: Tổng hợp (nợ phải thu + ghi chú), Đề nghị thanh
// toán (mỗi dòng một khoản phí, kèm đề nghị chứa khoản), Nợ phải thu (phí cược cont − phí sửa cont theo container), Cơ cấu
// chi phí. Tiền cược container không tính vào số liệu nào ngoài Nợ phải thu. Số tiền ghi dạng số theo nguyên tệ, mỗi loại
// tiền một cột (#,##0 cho VND, #,##0.00 cho USD). xlsx (SheetJS) nạp khi bấm xuất.

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

  const { month } = overview;
  const monthLabel = `${month.slice(5, 7)}/${month.slice(0, 4)}`;
  // Tiền cược container không tính vào số liệu của kỳ (chỉ ở sheet Nợ phải thu).
  const costs = withoutDeposits(overview.costs);
  const summary = summarizeCosts(costs);
  const byRequest = groupByRequest(costs);
  const deposits = summarizeDeposits(overview.deposits.rows);

  // ---------- Tổng hợp ----------
  const summaryRows: Cell[][] = [
    [t("rpExcelTitle", { month: monthLabel })],
    [t("rpExcelExportedAt", { time: formatDateTime(new Date().toISOString()) })],
    [t("rpBasisNote")],
    [t("rpCurrencyNote")],
    [],
  ];
  // Ô tiền cần định dạng: hàng, các cột, loại tiền.
  const formats: Array<{ row: number; columns: number[]; currency: string }> = [];
  const push = (cells: Cell[], currency: string, columns: number[]) => {
    formats.push({ row: summaryRows.length, columns, currency });
    summaryRows.push(cells);
  };
  summaryRows.push([], [`2. ${t("rpReceivableTitle", { date: formatDate(overview.deposits.asOf) })}`, t("rpCurrency"), t("rpDepositPaid"), t("rpRepairCost"), t("rpReceivable"), t("rpDepositUnpaid")]);
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

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summarySheet, t("rpSheetSummary"));
  XLSX.utils.book_append_sheet(workbook, requestSheet, t("rpSheetRequests"));
  XLSX.utils.book_append_sheet(workbook, depositSheet, t("rpSheetDeposits"));
  XLSX.utils.book_append_sheet(workbook, feeSheet, t("rpSheetStructure"));
  const fileName = `Bao-cao-chi-phi-${month}.xlsx`;
  XLSX.writeFile(workbook, fileName);
  return fileName;
}
