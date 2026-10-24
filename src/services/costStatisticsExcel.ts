import type { CostOverview } from "@/services/paymentCostApi";
import { costState, rankContracts, summarizeCosts, summarizePayables, todayVn } from "@/utils/costStatistics";
import { splitVat } from "@/utils/paymentRequest";

// Xuất Excel trang Quản lý chi phí của một tháng: "Tổng hợp" (theo nhóm vận hành / phát sinh / tiền hàng × loại tiền ×
// tình trạng, theo khoản phí), "Theo hợp đồng" (chi phí vận hành + phát sinh, bình quân mỗi container), "Đề nghị đang
// mở" (chờ duyệt / đã duyệt chưa hoàn thành, hạn thanh toán, quá hạn) và "Chi tiết" (từng khoản). Số tiền ghi dạng số
// (#,##0 / #,##0.00) để Excel cộng / lọc được. xlsx (SheetJS) nạp khi bấm xuất, không đóng gói vào trang.

type Translate = (key: string, params?: Record<string, string | number>) => string;
type Cell = string | number;
type AmountCells = Array<{ row: number; columns: number[]; currency: string }>;

const AMOUNT_FORMAT = (currency: string) => (currency === "USD" ? "#,##0.00" : "#,##0");
const toNumber = (value: string | null | undefined): Cell => (value === null || value === undefined || value === "" ? "" : Number(value));

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

const formatDate = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : value);

export async function exportCostOverviewExcel({ overview, t, basisLabel }: { overview: CostOverview; t: Translate; basisLabel: string }): Promise<string> {
  // Tính theo ngày nhập thì ngày tính = ngày nhập: không lặp cột.
  const withBasisDate = overview.basis !== "created";
  const XLSX = await import("xlsx");
  type Sheet = ReturnType<typeof XLSX.utils.aoa_to_sheet>;
  const sheetOf = (rows: Cell[][], widths: number[], amounts: AmountCells, filter = false): Sheet => {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = widths.map((wch) => ({ wch }));
    for (const { row, columns, currency } of amounts) {
      for (const column of columns) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (cell && cell.t === "n") cell.z = AMOUNT_FORMAT(currency);
      }
    }
    if (filter && rows.length > 1) {
      sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: rows[0].length - 1 } }) };
    }
    return sheet;
  };

  const { month, costs, payables: openRequests } = overview;
  const monthLabel = `${month.slice(5, 7)}/${month.slice(0, 4)}`;
  const kindLabel = (kind: string) => t(`cmKind_${kind}`);
  const typeLabel = (type: string) => (type ? t(`prType_${type}`) : "—");
  const summary = summarizeCosts(costs);
  const contracts = rankContracts(costs, overview.contracts, Number.MAX_SAFE_INTEGER);
  const payables = summarizePayables(openRequests, todayVn());

  // ---------- Tổng hợp ----------
  const summaryRows: Cell[][] = [
    [t("cmExcelTitle", { month: monthLabel })],
    [t("cmExcelBasis", { basis: basisLabel })],
    [t("cmExcelExportedAt", { time: formatDateTime(new Date().toISOString()) })],
    [],
    [t("cmKind"), t("cmCurrency"), t("cmCount"), t("cmGroup_paid"), t("cmGroup_processing"), t("cmGroup_unrequested"), t("cmTotal")],
  ];
  const summaryAmounts: AmountCells = [];
  for (const item of summary.byKind) {
    summaryAmounts.push({ row: summaryRows.length, columns: [3, 4, 5, 6], currency: item.currency });
    summaryRows.push([kindLabel(item.kind), item.currency, item.count, toNumber(item.paid), toNumber(item.processing), toNumber(item.unrequested), toNumber(item.total)]);
  }
  for (const item of summary.currencies) {
    summaryAmounts.push({ row: summaryRows.length, columns: [3, 4, 5, 6], currency: item.currency });
    summaryRows.push([t("cmTotal"), item.currency, item.count, toNumber(item.paid), toNumber(item.processing), toNumber(item.unrequested), toNumber(item.total)]);
  }
  summaryRows.push([], [t("cmByFee")], [t("cmKind"), t("cmType"), t("prCostCodeLabel"), t("mcFee"), t("cmCurrency"), t("cmCount"), t("cmTotal")]);
  for (const fee of summary.byFee) {
    summaryAmounts.push({ row: summaryRows.length, columns: [6], currency: fee.currency });
    summaryRows.push([kindLabel(fee.kind), typeLabel(fee.type), fee.code, fee.name, fee.currency, fee.count, toNumber(fee.total)]);
  }
  const notes = [
    summary.cancelledCount ? t("cmCancelledNote", { count: summary.cancelledCount }) : "",
    summary.hiddenCount ? t("cmHiddenNote") : "",
    costs.some((cost) => cost.currencyInferred) ? t("cmInferredNote") : "",
  ].filter(Boolean);
  if (notes.length) summaryRows.push([], ...notes.map((note) => [note]));

  // ---------- Theo hợp đồng ----------
  const contractRows: Cell[][] = [[t("cmContract"), t("supplier"), t("cmCurrency"), t("cmCount"), t("cmTotal"), t("cmContainers"), t("cmPerContainer")]];
  const contractAmounts: AmountCells = [];
  for (const item of contracts) {
    contractAmounts.push({ row: contractRows.length, columns: [4, 6], currency: item.currency });
    contractRows.push([item.contract, item.supplier, item.currency, item.count, toNumber(item.total), item.containers || "", toNumber(item.perContainer)]);
  }

  // ---------- Đề nghị đang mở ----------
  const overdueIds = new Set(payables.overdue.requests.map((request) => request.id));
  const dueSoonIds = new Set(payables.dueSoon.requests.map((request) => request.id));
  const payableRows: Cell[][] = [[t("cmRequest"), t("prContent"), t("cmState"), t("cmRequester"), t("prDueDate"), t("cmDueStatus"), t("cmCurrency"), t("cmTotal")]];
  const payableAmounts: AmountCells = [];
  for (const request of payables.all.requests) {
    payableAmounts.push({ row: payableRows.length, columns: [7], currency: request.currency });
    payableRows.push([
      request.id,
      request.content,
      request.status === 0 ? t("cmState_pending") : t("cmApprovedOpen"),
      request.requester,
      formatDate(request.dueDate),
      overdueIds.has(request.id) ? t("cmOverdue") : dueSoonIds.has(request.id) ? t("cmDueSoon") : "",
      request.currency,
      request.total === null ? t("cmHidden") : toNumber(request.total),
    ]);
  }

  // ---------- Chi tiết ----------
  const detailRows: Cell[][] = [[
    ...(withBasisDate ? [basisLabel] : []), t("mcCreatedAt"), t("cmCostId"), t("cmKind"), t("cmType"), t("prCostCodeLabel"), t("mcFee"), t("cmFlow"), t("cmContract"), t("cmContainer"),
    t("prCostNote"), t("cmAmount"), t("cmCurrency"), t("cmInferredCol"), t("cmVatRate"), t("cmBase"), t("cmTax"), t("cmState"), t("cmRequest"), t("cmEnteredBy"),
  ]];
  const detailAmounts: AmountCells = [];
  for (const cost of costs) {
    const split = cost.amount !== null && cost.vat ? splitVat(cost.amount, cost.vat, cost.currency === "USD" || cost.currency === "VND" ? cost.currency : "") : null;
    const shift = withBasisDate ? 1 : 0;
    detailAmounts.push({ row: detailRows.length, columns: [10 + shift, 14 + shift, 15 + shift], currency: cost.currency });
    detailRows.push([
      ...(withBasisDate ? [formatDateTime(cost.basisDate)] : []), formatDateTime(cost.createdAt), cost.id, kindLabel(cost.kind), typeLabel(cost.type), cost.code, cost.categoryName,
      cost.flow ? t(`prFlow_${cost.flow}`) : "", cost.contract, cost.container, cost.note,
      cost.amount === null ? t("cmHidden") : toNumber(cost.amount), cost.currency, cost.currencyInferred ? t("cmYes") : "",
      cost.vat ? Number(cost.vat) : "", split ? toNumber(split.base) : "", split ? toNumber(split.tax) : "",
      t(`cmState_${costState(cost)}`), cost.requestId, cost.userName,
    ]);
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheetOf(summaryRows, [26, 10, 10, 22, 26, 20, 20], summaryAmounts), t("cmExcelSummarySheet"));
  XLSX.utils.book_append_sheet(workbook, sheetOf(contractRows, [14, 30, 9, 10, 18, 12, 18], contractAmounts, true), t("cmExcelContractSheet"));
  XLSX.utils.book_append_sheet(workbook, sheetOf(payableRows, [12, 40, 22, 20, 12, 12, 9, 18], payableAmounts, true), t("cmExcelPayableSheet"));
  XLSX.utils.book_append_sheet(workbook, sheetOf(detailRows, [...(withBasisDate ? [16] : []), 16, 20, 18, 12, 10, 28, 12, 12, 16, 28, 16, 9, 10, 8, 16, 14, 18, 12, 20], detailAmounts, true), t("cmExcelDetailSheet"));
  const fileName = `Chi-phi-${month}.xlsx`;
  XLSX.writeFile(workbook, fileName);
  return fileName;
}
