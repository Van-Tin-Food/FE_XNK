// Số liệu trang Quản lý chi phí + file Excel: cộng tiền theo xu (BigInt, không sai số), không bao giờ cộng VND với USD.
// - Tổng tháng: chi phí (vận hành + phát sinh) tách khỏi tiền hàng (cọc / còn lại = tiền mua hàng).
// - Theo đề nghị thanh toán, theo khoản phí (các khoản nhập trong tháng).
// - Theo lô hàng / container: chi phí lũy kế của lô; chi phí chung của lô (không gắn container) chia đều cho số container.
// Hàm thuần, không import (test chạy thẳng).

export type CostState = "none" | "draft" | "pending" | "rejected" | "approved" | "completed" | "cancelled";
/** paid = đã duyệt / hoàn thành; processing = nháp, chờ duyệt, không duyệt; unrequested = chưa vào đề nghị. */
export type CostGroup = "paid" | "processing" | "unrequested";
/** operating = chi phí vận hành / logistics; incident = phát sinh; goods = tiền hàng (cọc / còn lại). */
export type CostKind = "operating" | "incident" | "goods";

export const COST_STATES: readonly CostState[] = ["none", "draft", "pending", "rejected", "approved", "completed", "cancelled"];
export const COST_KINDS: readonly CostKind[] = ["operating", "incident", "goods"];
const CURRENCY_ORDER = ["VND", "USD"];

export interface MonthlyCost {
  id: string;
  createdAt: string;
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
  requestContent: string;
  requestDue: string;
  requestBy: string;
  currency: string;
  currencyInferred: boolean;
  kind: CostKind;
}

/** Lô hàng (hợp đồng) có chi phí trong tháng. */
export interface ShipmentInfo {
  contract: string;
  supplier: string;
  containers: string[];
}

/** Chi phí lũy kế của lô theo container × nhóm × loại tiền; container rỗng = chi phí chung của lô. */
export interface ShipmentCost {
  contract: string;
  container: string;
  kind: CostKind;
  currency: string;
  count: number;
  amount: string | null;
}

/** Số tiền theo từng loại tiền (VND trước). */
export type Money = Array<{ currency: string; total: string }>;

export interface Totals {
  count: number;
  total: string;
  paid: string;
  processing: string;
  unrequested: string;
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
  /** Chi phí (vận hành + phát sinh) theo loại tiền. */
  costs: Array<Totals & { currency: string }>;
  /** Tiền hàng theo loại tiền. */
  goods: Array<Totals & { currency: string }>;
  byFee: FeeTotals[];
  /** Khoản thuộc đề nghị đã hủy (không tính). */
  cancelledCount: number;
  /** Khoản bị ẩn số tiền (không tính). */
  hiddenCount: number;
}

const HUNDRED = BigInt(100);
const ZERO = BigInt(0);

export function toCents(value: string | null | undefined): bigint {
  const match = /^(\d+)(?:\.(\d{1,2})\d*)?$/.exec(String(value ?? "").trim());
  return match ? BigInt(match[1]) * HUNDRED + BigInt((match[2] || "").padEnd(2, "0")) : ZERO;
}

export function fromCents(cents: bigint): string {
  return `${cents / HUNDRED}.${(cents % HUNDRED).toString().padStart(2, "0")}`;
}

/** Chia làm tròn: VND tới đồng, loại tiền khác tới xu. */
function divideRound(cents: bigint, by: number, currency: string): bigint {
  const unit = currency === "VND" ? HUNDRED : BigInt(1);
  const divisor = BigInt(by) * unit;
  return ((cents * BigInt(2) + divisor) / (divisor * BigInt(2))) * unit;
}

/** Tình trạng của khoản theo đề nghị chứa nó. */
export function costState(cost: Pick<MonthlyCost, "requestId" | "requestStatus" | "requestSent">): CostState {
  if (!cost.requestId || cost.requestStatus === null) return "none";
  if (cost.requestStatus === -2) return "cancelled";
  if (cost.requestStatus === -1) return "rejected";
  if (cost.requestStatus === 2) return "completed";
  // Đã duyệt, gồm cả đã chi tiền (3) chờ lưu trữ.
  if (cost.requestStatus === 1 || cost.requestStatus === 3) return "approved";
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
const descCents = (a: bigint, b: bigint) => (b > a ? 1 : b < a ? -1 : 0);

type Bucket = { count: number; total: bigint; paid: bigint; processing: bigint; unrequested: bigint };
const emptyBucket = (): Bucket => ({ count: 0, total: ZERO, paid: ZERO, processing: ZERO, unrequested: ZERO });
const bucketList = (map: Map<string, Bucket>) => [...map.entries()].sort(([a], [b]) => compareCurrency(a, b)).map(([currency, bucket]) => ({
  currency,
  count: bucket.count,
  total: fromCents(bucket.total),
  paid: fromCents(bucket.paid),
  processing: fromCents(bucket.processing),
  unrequested: fromCents(bucket.unrequested),
}));

/** Cộng một danh sách tiền theo loại tiền -> Money (bỏ loại tiền = 0). */
function moneyOf(entries: Map<string, bigint>): Money {
  return [...entries.entries()].filter(([, cents]) => cents !== ZERO).sort(([a], [b]) => compareCurrency(a, b)).map(([currency, cents]) => ({ currency, total: fromCents(cents) }));
}
function addMoney(map: Map<string, bigint>, currency: string, cents: bigint) {
  map.set(currency, (map.get(currency) || ZERO) + cents);
}

export function summarizeCosts(costs: MonthlyCost[]): CostSummary {
  const costTotals = new Map<string, Bucket>();
  const goodsTotals = new Map<string, Bucket>();
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
    const target = cost.kind === "goods" ? goodsTotals : costTotals;
    const bucket = target.get(cost.currency) || emptyBucket();
    bucket.count += 1;
    bucket.total += cents;
    bucket[group] += cents;
    target.set(cost.currency, bucket);
    const key = `${cost.kind}|${cost.code}|${cost.categoryName}|${cost.currency}`;
    const fee = fees.get(key) || { key, kind: cost.kind, type: cost.type, code: cost.code, name: cost.categoryName, currency: cost.currency, count: 0, cents: ZERO };
    fee.count += 1;
    fee.cents += cents;
    fees.set(key, fee);
  }
  return {
    costs: bucketList(costTotals),
    goods: bucketList(goodsTotals),
    byFee: [...fees.values()]
      .sort((a, b) => compareKind(a.kind, b.kind) || compareCurrency(a.currency, b.currency) || descCents(a.cents, b.cents) || a.name.localeCompare(b.name, "vi"))
      .map(({ cents, ...fee }) => ({ ...fee, total: fromCents(cents) })),
    cancelledCount,
    hiddenCount,
  };
}

export interface RequestTotals {
  requestId: string;
  content: string;
  requester: string;
  dueDate: string;
  state: CostState;
  count: number;
  /** Tổng các khoản của đề nghị nhập trong tháng (bỏ khoản bị ẩn). */
  total: Money;
  hiddenCount: number;
}

/**
 * Các khoản của tháng gom theo đề nghị (mới nhất trước) + phần chưa vào đề nghị nào (unrequested).
 * Đề nghị đã hủy vẫn liệt kê (để biết) nhưng gắn state cancelled.
 */
export function groupByRequest(costs: MonthlyCost[]): { requests: RequestTotals[]; unrequested: { count: number; total: Money } } {
  const requests = new Map<string, RequestTotals & { cents: Map<string, bigint> }>();
  const loose = new Map<string, bigint>();
  let looseCount = 0;
  for (const cost of costs) {
    if (!cost.requestId) {
      looseCount += 1;
      if (cost.amount !== null) addMoney(loose, cost.currency, toCents(cost.amount));
      continue;
    }
    const current = requests.get(cost.requestId) || {
      requestId: cost.requestId, content: cost.requestContent, requester: cost.requestBy, dueDate: cost.requestDue,
      state: costState(cost), count: 0, total: [], hiddenCount: 0, cents: new Map<string, bigint>(),
    };
    current.count += 1;
    if (cost.amount === null) current.hiddenCount += 1;
    else addMoney(current.cents, cost.currency, toCents(cost.amount));
    requests.set(cost.requestId, current);
  }
  const number = (id: string) => Number(id.replace(/\D/g, "")) || 0;
  return {
    requests: [...requests.values()]
      .sort((a, b) => number(b.requestId) - number(a.requestId))
      .map(({ cents, ...item }) => ({ ...item, total: moneyOf(cents) })),
    unrequested: { count: looseCount, total: moneyOf(loose) },
  };
}

export interface ShipmentTotals {
  contract: string;
  supplier: string;
  containerCount: number;
  /** Chi phí vận hành + phát sinh lũy kế của lô. */
  cost: Money;
  /** Bình quân mỗi container (không có container thì rỗng). */
  costPerContainer: Money;
  goods: Money;
  goodsPerContainer: Money;
  hidden: boolean;
}

export interface ContainerTotals {
  container: string;
  contract: string;
  supplier: string;
  /** Chi phí gắn riêng container này. */
  direct: Money;
  /** Chi phí chung của lô chia đều. */
  shared: Money;
  /** direct + shared. */
  total: Money;
  goodsShare: Money;
}

/**
 * Chi phí theo lô hàng và theo container (lũy kế). Container của lô = danh sách từ lô hàng ∪ container có chi phí
 * (dữ liệu lệch vẫn không mất tiền). Chi phí chung (không gắn container) và tiền hàng chia đều cho số container.
 */
export function summarizeShipments(shipments: ShipmentInfo[], costs: ShipmentCost[]): { lots: ShipmentTotals[]; containers: ContainerTotals[] } {
  const info = new Map(shipments.map((item) => [item.contract, item]));
  const contracts = [...new Set([...shipments.map((item) => item.contract), ...costs.map((item) => item.contract)])];
  // Sắp xếp theo chi phí VND giảm dần (sortCents giữ riêng, không lẫn vào dữ liệu trả về).
  const lots: Array<{ item: ShipmentTotals; sortCents: bigint }> = [];
  const containers: Array<{ item: ContainerTotals; sortCents: bigint }> = [];
  for (const contract of contracts) {
    const rows = costs.filter((item) => item.contract === contract);
    const names = [...new Set([...(info.get(contract)?.containers || []), ...rows.map((item) => item.container).filter(Boolean)])].sort();
    const cost = new Map<string, bigint>();
    const shared = new Map<string, bigint>();
    const goods = new Map<string, bigint>();
    const direct = new Map<string, Map<string, bigint>>();
    let hidden = false;
    for (const row of rows) {
      if (row.amount === null) {
        hidden = true;
        continue;
      }
      const cents = toCents(row.amount);
      if (row.kind === "goods") {
        addMoney(goods, row.currency, cents);
        continue;
      }
      addMoney(cost, row.currency, cents);
      if (!row.container) addMoney(shared, row.currency, cents);
      else {
        const own = direct.get(row.container) || new Map<string, bigint>();
        addMoney(own, row.currency, cents);
        direct.set(row.container, own);
      }
    }
    const perContainer = (map: Map<string, bigint>) => new Map([...map.entries()].map(([currency, cents]) => [currency, names.length ? divideRound(cents, names.length, currency) : ZERO]));
    const sharedEach = perContainer(shared);
    const goodsEach = perContainer(goods);
    const supplier = info.get(contract)?.supplier || "";
    lots.push({
      item: {
        contract, supplier, containerCount: names.length, hidden,
        cost: moneyOf(cost), costPerContainer: names.length ? moneyOf(perContainer(cost)) : [],
        goods: moneyOf(goods), goodsPerContainer: names.length ? moneyOf(goodsEach) : [],
      },
      sortCents: cost.get("VND") || ZERO,
    });
    for (const name of names) {
      const own = direct.get(name) || new Map<string, bigint>();
      const total = new Map(own);
      sharedEach.forEach((cents, currency) => addMoney(total, currency, cents));
      containers.push({
        item: { container: name, contract, supplier, direct: moneyOf(own), shared: moneyOf(sharedEach), total: moneyOf(total), goodsShare: moneyOf(goodsEach) },
        sortCents: total.get("VND") || ZERO,
      });
    }
  }
  return {
    lots: lots.sort((a, b) => descCents(a.sortCents, b.sortCents) || a.item.contract.localeCompare(b.item.contract)).map((entry) => entry.item),
    containers: containers.sort((a, b) => descCents(a.sortCents, b.sortCents) || a.item.container.localeCompare(b.item.container)).map((entry) => entry.item),
  };
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

export const isMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
