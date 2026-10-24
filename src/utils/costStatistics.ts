// Số liệu trang Quản lý chi phí (người quản lý + kế toán) và file Excel: cộng tiền theo xu (BigInt, không sai số), tách
// theo loại tiền (không bao giờ cộng VND với USD), theo nhóm (vận hành / phát sinh / tiền hàng), tình trạng đề nghị,
// khoản phí, hợp đồng; so với tháng trước; đề nghị đang mở theo hạn thanh toán. Hàm thuần, không import (test chạy thẳng).

export type CostState = "none" | "draft" | "pending" | "rejected" | "approved" | "completed" | "cancelled";
/** paid = đã duyệt / hoàn thành; processing = nháp, chờ duyệt, không duyệt; unrequested = chưa vào đề nghị. */
export type CostGroup = "paid" | "processing" | "unrequested";
/** operating = chi phí vận hành / logistics; incident = phát sinh; goods = tiền hàng (cọc / còn lại, tiền mua hàng). */
export type CostKind = "operating" | "incident" | "goods";
/** Mốc tính tháng: ngày nhập khoản / ngày lập đề nghị / ngày duyệt. */
export type CostBasis = "created" | "requested" | "approved";

export const COST_STATES: readonly CostState[] = ["none", "draft", "pending", "rejected", "approved", "completed", "cancelled"];
export const COST_GROUPS: readonly CostGroup[] = ["paid", "processing", "unrequested"];
export const COST_KINDS: readonly CostKind[] = ["operating", "incident", "goods"];
export const COST_BASES: readonly CostBasis[] = ["created", "requested", "approved"];
const TYPE_ORDER = ["mua_hang", "ban_hang", "van_hanh", "phat_sinh"];
const CURRENCY_ORDER = ["VND", "USD"];

export interface MonthlyCost {
  id: string;
  createdAt: string;
  /** Ngày dùng để tính tháng theo mốc đang chọn. */
  basisDate: string;
  contract: string;
  container: string;
  /** Số tiền đã gồm VAT; null = bị ẩn (không có quyền xem tiền hàng). */
  amount: string | null;
  vat: string;
  note: string;
  type: string;
  code: string;
  categoryName: string;
  flow: string;
  userName: string;
  requestId: string;
  requestStatus: number | null;
  requestSent: boolean;
  currency: string;
  currencyInferred: boolean;
  kind: CostKind;
}

export interface TrendPoint {
  month: string;
  kind: CostKind;
  currency: string;
  count: number;
  /** null = bị ẩn (tiền hàng, không có quyền). */
  amount: string | null;
}

export interface OpenRequest {
  id: string;
  content: string;
  currency: string;
  total: string | null;
  dueDate: string;
  status: number;
  sent: boolean;
  createdAt: string;
  approvedAt: string;
  requester: string;
  hasRed: boolean;
  hasGoods: boolean;
}

export interface ContractInfo {
  contract: string;
  supplier: string;
  containers: number;
}

export interface Totals {
  count: number;
  total: string;
  paid: string;
  processing: string;
  unrequested: string;
}

export interface KindTotals extends Totals {
  kind: CostKind;
  currency: string;
}

export interface FeeTotals {
  key: string;
  kind: CostKind;
  type: string;
  code: string;
  name: string;
  currency: string;
  count: number;
  total: string;
}

export interface CostSummary {
  /** Không tính khoản thuộc đề nghị đã hủy và khoản bị ẩn số tiền. */
  currencies: Array<Totals & { currency: string }>;
  byKind: KindTotals[];
  byFee: FeeTotals[];
  cancelledCount: number;
  hiddenCount: number;
}

const HUNDRED = BigInt(100);
const ZERO = BigInt(0);

export function toCents(value: string | null | undefined): bigint {
  const match = /^(\d+)(?:\.(\d{1,2})\d*)?$/.exec(String(value ?? "").trim());
  return match ? BigInt(match[1]) * HUNDRED + BigInt((match[2] || "").padEnd(2, "0")) : ZERO;
}

export function fromCents(cents: bigint): string {
  const negative = cents < ZERO;
  const abs = negative ? -cents : cents;
  return `${negative ? "-" : ""}${abs / HUNDRED}.${(abs % HUNDRED).toString().padStart(2, "0")}`;
}

/** Tình trạng của khoản theo đề nghị chứa nó. */
export function costState(cost: Pick<MonthlyCost, "requestId" | "requestStatus" | "requestSent">): CostState {
  if (!cost.requestId || cost.requestStatus === null) return "none";
  if (cost.requestStatus === -2) return "cancelled";
  if (cost.requestStatus === -1) return "rejected";
  if (cost.requestStatus === 2) return "completed";
  if (cost.requestStatus === 1) return "approved";
  return cost.requestSent ? "pending" : "draft";
}

/** Nhóm cộng tổng; đề nghị đã hủy = null (không tính). */
export function costGroup(state: CostState): CostGroup | null {
  if (state === "cancelled") return null;
  if (state === "approved" || state === "completed") return "paid";
  if (state === "none") return "unrequested";
  return "processing";
}

const byOrder = (order: readonly string[]) => (a: string, b: string) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) || a.localeCompare(b);
export const compareCurrency = byOrder(CURRENCY_ORDER);
const compareKind = byOrder(COST_KINDS);
const compareType = byOrder(TYPE_ORDER);

type Bucket = { count: number; total: bigint; paid: bigint; processing: bigint; unrequested: bigint };
const emptyBucket = (): Bucket => ({ count: 0, total: ZERO, paid: ZERO, processing: ZERO, unrequested: ZERO });
const bucketTotals = (bucket: Bucket): Totals => ({
  count: bucket.count,
  total: fromCents(bucket.total),
  paid: fromCents(bucket.paid),
  processing: fromCents(bucket.processing),
  unrequested: fromCents(bucket.unrequested),
});

export function summarizeCosts(costs: MonthlyCost[]): CostSummary {
  const currencies = new Map<string, Bucket>();
  const kinds = new Map<string, Bucket & { kind: CostKind; currency: string }>();
  const fees = new Map<string, Omit<FeeTotals, "total"> & { cents: bigint }>();
  let cancelledCount = 0;
  let hiddenCount = 0;
  for (const cost of costs) {
    const group = costGroup(costState(cost));
    if (!group) {
      cancelledCount += 1;
      continue;
    }
    if (cost.amount === null) {
      hiddenCount += 1;
      continue;
    }
    const cents = toCents(cost.amount);
    const add = (bucket: Bucket) => {
      bucket.count += 1;
      bucket.total += cents;
      bucket[group] += cents;
    };
    const currency = currencies.get(cost.currency) || emptyBucket();
    add(currency);
    currencies.set(cost.currency, currency);
    const kindKey = `${cost.kind}|${cost.currency}`;
    const kind = kinds.get(kindKey) || { ...emptyBucket(), kind: cost.kind, currency: cost.currency };
    add(kind);
    kinds.set(kindKey, kind);
    const feeKey = `${cost.kind}|${cost.type}|${cost.code}|${cost.categoryName}|${cost.currency}`;
    const fee = fees.get(feeKey) || { key: feeKey, kind: cost.kind, type: cost.type, code: cost.code, name: cost.categoryName, currency: cost.currency, count: 0, cents: ZERO };
    fee.count += 1;
    fee.cents += cents;
    fees.set(feeKey, fee);
  }
  return {
    currencies: [...currencies.entries()].sort(([a], [b]) => compareCurrency(a, b)).map(([currency, bucket]) => ({ currency, ...bucketTotals(bucket) })),
    byKind: [...kinds.values()]
      .sort((a, b) => compareKind(a.kind, b.kind) || compareCurrency(a.currency, b.currency))
      .map((bucket) => ({ kind: bucket.kind, currency: bucket.currency, ...bucketTotals(bucket) })),
    byFee: [...fees.values()]
      .sort((a, b) => compareKind(a.kind, b.kind) || compareCurrency(a.currency, b.currency) || (b.cents > a.cents ? 1 : b.cents < a.cents ? -1 : 0)
        || compareType(a.type, b.type) || a.name.localeCompare(b.name, "vi"))
      .map(({ cents, ...fee }) => ({ ...fee, total: fromCents(cents) })),
    cancelledCount,
    hiddenCount,
  };
}

/** Tổng của một nhóm + loại tiền (không có thì 0). */
export function kindTotal(summary: CostSummary, kind: CostKind, currency: string): KindTotals {
  return summary.byKind.find((item) => item.kind === kind && item.currency === currency)
    || { kind, currency, count: 0, total: "0.00", paid: "0.00", processing: "0.00", unrequested: "0.00" };
}

/** Các tháng (YYYY-MM) từ month lùi về count - 1 tháng, cũ trước. */
export function trendMonths(month: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => shiftMonth(month, index - (count - 1)));
}

/** Giá trị xu hướng: tháng × nhóm cho một loại tiền (cents). Ẩn (null) coi như 0. */
export function trendMatrix(points: TrendPoint[], months: string[], currency: string): Record<string, Record<CostKind, bigint>> {
  const matrix = Object.fromEntries(months.map((month) => [month, { operating: ZERO, incident: ZERO, goods: ZERO }])) as Record<string, Record<CostKind, bigint>>;
  for (const point of points) {
    if (point.currency !== currency || !matrix[point.month]) continue;
    matrix[point.month][point.kind] += toCents(point.amount);
  }
  return matrix;
}

/** Thay đổi so với tháng trước (phần trăm, 1 chữ số lẻ); tháng trước = 0 thì null (không so được). */
export function changePercent(current: bigint, previous: bigint): number | null {
  if (previous === ZERO) return null;
  return Math.round(Number(((current - previous) * BigInt(1000)) / previous)) / 10;
}

export interface PayableBucket {
  requests: OpenRequest[];
  /** Theo loại tiền; đề nghị bị ẩn tổng tiền thì không cộng. */
  totals: Array<{ currency: string; total: string }>;
}

export interface PayableSummary {
  overdue: PayableBucket;
  dueSoon: PayableBucket;
  pending: PayableBucket;
  approved: PayableBucket;
  all: PayableBucket;
}

function bucketOf(requests: OpenRequest[]): PayableBucket {
  const totals = new Map<string, bigint>();
  for (const request of requests) {
    if (request.total === null) continue;
    totals.set(request.currency, (totals.get(request.currency) || ZERO) + toCents(request.total));
  }
  return {
    requests,
    totals: [...totals.entries()].sort(([a], [b]) => compareCurrency(a, b)).map(([currency, cents]) => ({ currency, total: fromCents(cents) })),
  };
}

/**
 * Đề nghị đang mở (chờ duyệt / đã duyệt chưa hoàn thành) theo hạn thanh toán so với today (YYYY-MM-DD, giờ VN):
 * overdue = quá hạn; dueSoon = đến hạn trong days ngày tới (kể cả hôm nay); pending = chờ duyệt; approved = đã duyệt.
 */
export function summarizePayables(requests: OpenRequest[], today: string, days = 7): PayableSummary {
  const limit = shiftDate(today, days);
  const byDue = [...requests].sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || a.createdAt.localeCompare(b.createdAt));
  return {
    overdue: bucketOf(byDue.filter((request) => request.dueDate && request.dueDate < today)),
    dueSoon: bucketOf(byDue.filter((request) => request.dueDate && request.dueDate >= today && request.dueDate <= limit)),
    pending: bucketOf(byDue.filter((request) => request.status === 0)),
    approved: bucketOf(byDue.filter((request) => request.status === 1)),
    all: bucketOf(byDue),
  };
}

export interface ContractTotals {
  contract: string;
  supplier: string;
  currency: string;
  containers: number;
  count: number;
  total: string;
  /** Bình quân mỗi container (tổng / số container của hợp đồng); không có container thì null. */
  perContainer: string | null;
}

/** Chi phí vận hành + phát sinh theo hợp đồng (không tính tiền hàng, đề nghị đã hủy), lớn nhất trước trong mỗi loại tiền. */
export function rankContracts(costs: MonthlyCost[], contracts: ContractInfo[], limit = 10): ContractTotals[] {
  const info = new Map(contracts.map((item) => [item.contract, item]));
  const totals = new Map<string, { contract: string; currency: string; count: number; cents: bigint }>();
  for (const cost of costs) {
    if (!cost.contract || cost.kind === "goods" || cost.amount === null || !costGroup(costState(cost))) continue;
    const key = `${cost.contract}|${cost.currency}`;
    const current = totals.get(key) || { contract: cost.contract, currency: cost.currency, count: 0, cents: ZERO };
    current.count += 1;
    current.cents += toCents(cost.amount);
    totals.set(key, current);
  }
  return [...totals.values()]
    .sort((a, b) => compareCurrency(a.currency, b.currency) || (b.cents > a.cents ? 1 : b.cents < a.cents ? -1 : 0) || a.contract.localeCompare(b.contract))
    .slice(0, limit)
    .map((item) => {
      const containers = info.get(item.contract)?.containers || 0;
      return {
        contract: item.contract,
        supplier: info.get(item.contract)?.supplier || "",
        currency: item.currency,
        containers,
        count: item.count,
        total: fromCents(item.cents),
        perContainer: containers > 0 ? fromCents(item.cents / BigInt(containers)) : null,
      };
    });
}

/** Khoản phát sinh lớn nhất của tháng (không tính đề nghị đã hủy). */
export function topIncidents(costs: MonthlyCost[], limit = 5): MonthlyCost[] {
  return costs
    .filter((cost) => cost.kind === "incident" && cost.amount !== null && costGroup(costState(cost)))
    .sort((a, b) => compareCurrency(a.currency, b.currency) || (toCents(b.amount) > toCents(a.amount) ? 1 : toCents(b.amount) < toCents(a.amount) ? -1 : 0))
    .slice(0, limit);
}

/** Tháng hiện tại theo giờ Việt Nam, dạng YYYY-MM. */
export function currentMonth(now: Date = new Date()): string {
  return todayVn(now).slice(0, 7);
}

/** Ngày hôm nay theo giờ Việt Nam, dạng YYYY-MM-DD. */
export function todayVn(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Cộng / trừ số tháng cho chuỗi YYYY-MM. */
export function shiftMonth(month: string, delta: number): string {
  const [year, value] = month.split("-").map(Number);
  const index = year * 12 + (value - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Cộng / trừ số ngày cho chuỗi YYYY-MM-DD. */
export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export const isMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
