// Số liệu Báo cáo chi phí & công nợ phải trả + file Excel: cộng tiền theo xu (BigInt, không sai số), không bao giờ cộng
// VND với USD (báo cáo theo nguyên tệ, không quy đổi tỷ giá).
// - Chỉ tiêu tổng hợp của kỳ: chi phí hoạt động (vận hành + phát sinh, tách giá trị chưa thuế / thuế GTGT) tách khỏi giá
//   trị hàng mua (cọc / còn lại = tiền hàng).
// - Tình hình thanh toán các khoản phát sinh trong kỳ theo giai đoạn: đã thanh toán / đã phê duyệt chờ chi / chờ phê duyệt /
//   chưa trình duyệt / chưa lập đề nghị.
// - Cơ cấu chi phí theo khoản mục (tài khoản hạch toán, tỷ trọng); bảng kê đề nghị thanh toán.
// - Giá vốn nhập khẩu (landed cost) theo lô hàng / container: chi phí lũy kế của lô; chi phí chung của lô (không gắn
//   container) và trị giá hàng mua phân bổ đều cho số container.
// - Tuổi nợ phải trả theo hạn thanh toán của đề nghị chưa chi (tính đến hôm nay).
// Hàm thuần, không import (test chạy thẳng).

export type CostState = "none" | "draft" | "pending" | "rejected" | "approved" | "paid" | "completed" | "cancelled";
/**
 * Giai đoạn thanh toán của khoản: settled = đã thanh toán (đã chi tiền / hoàn tất chứng từ); approved = đã phê duyệt, chờ
 * chi; pending = chờ phê duyệt; unsubmitted = chưa trình duyệt (nháp / không duyệt); unrequested = chưa lập đề nghị.
 */
export type SettlementStage = "settled" | "approved" | "pending" | "unsubmitted" | "unrequested";
/** operating = chi phí vận hành / logistics; incident = phát sinh; goods = tiền hàng (cọc / còn lại). */
export type CostKind = "operating" | "incident" | "goods";

export const COST_STATES: readonly CostState[] = ["none", "draft", "pending", "rejected", "approved", "paid", "completed", "cancelled"];
export const SETTLEMENT_STAGES: readonly SettlementStage[] = ["settled", "approved", "pending", "unsubmitted", "unrequested"];
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
  /** Số tài khoản kế toán hạch toán khoản phí (danh mục chi phí), có thể rỗng. */
  account: string;
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

/** Lô hàng (hợp đồng) có chi phí trong kỳ. */
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

export interface StageTotals {
  count: number;
  total: string;
}

/** Tổng của một nhóm (chi phí hoạt động / giá trị hàng mua) trong một loại tiền. */
export interface Totals {
  currency: string;
  count: number;
  /** Tổng thanh toán (gồm VAT). */
  total: string;
  /** Giá trị chưa thuế GTGT. */
  base: string;
  /** Thuế GTGT. */
  tax: string;
  stages: Record<SettlementStage, StageTotals>;
}

export interface FeeTotals {
  key: string;
  kind: CostKind;
  type: string;
  code: string;
  name: string;
  account: string;
  currency: string;
  count: number;
  total: string;
  /** Tỷ trọng (%) trong tổng cùng nhóm (chi phí hoạt động / hàng mua) và cùng loại tiền, một chữ số thập phân. */
  share: number;
}

export interface CostSummary {
  /** Chi phí hoạt động (vận hành + phát sinh) theo loại tiền. */
  costs: Totals[];
  /** Giá trị hàng mua (tiền hàng) theo loại tiền. */
  goods: Totals[];
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

/** Thuế GTGT trong số tiền đã gồm VAT (cùng cách làm tròn với splitVat ở utils/paymentRequest: VND tròn đồng). */
export function vatCents(cents: bigint, vat: string, currency: string): bigint {
  const rate = BigInt(Math.round(Number(vat) * 100) || 0);
  if (rate <= ZERO) return ZERO;
  const step = currency === "VND" ? HUNDRED : BigInt(1);
  const divisor = (BigInt(10000) + rate) * step;
  const base = ((cents * BigInt(10000) * BigInt(2) + divisor) / (divisor * BigInt(2))) * step;
  return cents - base;
}

/** Tình trạng của khoản theo đề nghị chứa nó. */
export function costState(cost: Pick<MonthlyCost, "requestId" | "requestStatus" | "requestSent">): CostState {
  if (!cost.requestId || cost.requestStatus === null) return "none";
  if (cost.requestStatus === -2) return "cancelled";
  if (cost.requestStatus === -1) return "rejected";
  if (cost.requestStatus === 2) return "completed";
  if (cost.requestStatus === 3) return "paid";
  if (cost.requestStatus === 1) return "approved";
  return cost.requestSent ? "pending" : "draft";
}

/** Giai đoạn thanh toán; đề nghị đã hủy = null (không tính). */
export function settlementStage(state: CostState): SettlementStage | null {
  if (state === "cancelled") return null;
  if (state === "paid" || state === "completed") return "settled";
  if (state === "approved" || state === "pending") return state;
  if (state === "none") return "unrequested";
  return "unsubmitted";
}

const byOrder = (order: readonly string[]) => (a: string, b: string) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) || a.localeCompare(b);
export const compareCurrency = byOrder(CURRENCY_ORDER);
const compareKind = byOrder(COST_KINDS);
const descCents = (a: bigint, b: bigint) => (b > a ? 1 : b < a ? -1 : 0);

type Bucket = { count: number; total: bigint; tax: bigint; stages: Record<SettlementStage, { count: number; cents: bigint }> };
const emptyBucket = (): Bucket => ({
  count: 0, total: ZERO, tax: ZERO,
  stages: Object.fromEntries(SETTLEMENT_STAGES.map((stage) => [stage, { count: 0, cents: ZERO }])) as Bucket["stages"],
});
const bucketList = (map: Map<string, Bucket>): Totals[] => [...map.entries()].sort(([a], [b]) => compareCurrency(a, b)).map(([currency, bucket]) => ({
  currency,
  count: bucket.count,
  total: fromCents(bucket.total),
  base: fromCents(bucket.total - bucket.tax),
  tax: fromCents(bucket.tax),
  stages: Object.fromEntries(SETTLEMENT_STAGES.map((stage) => [stage, { count: bucket.stages[stage].count, total: fromCents(bucket.stages[stage].cents) }])) as Totals["stages"],
}));

/** Cộng một danh sách tiền theo loại tiền -> Money (bỏ loại tiền = 0). */
function moneyOf(entries: Map<string, bigint>): Money {
  return [...entries.entries()].filter(([, cents]) => cents !== ZERO).sort(([a], [b]) => compareCurrency(a, b)).map(([currency, cents]) => ({ currency, total: fromCents(cents) }));
}
function addMoney(map: Map<string, bigint>, currency: string, cents: bigint) {
  map.set(currency, (map.get(currency) || ZERO) + cents);
}
/** Cộng nhiều Money (cùng loại tiền mới cộng). */
export function sumMoney(...lists: Money[]): Money {
  const total = new Map<string, bigint>();
  for (const list of lists) for (const item of list) addMoney(total, item.currency, toCents(item.total));
  return moneyOf(total);
}
/** Tỷ lệ phần trăm part / whole, một chữ số thập phân. */
function percent(part: bigint, whole: bigint): number {
  return whole > ZERO ? Number((part * BigInt(2000) + whole) / (whole * BigInt(2))) / 10 : 0;
}

export function summarizeCosts(costs: MonthlyCost[]): CostSummary {
  const costTotals = new Map<string, Bucket>();
  const goodsTotals = new Map<string, Bucket>();
  const fees = new Map<string, Omit<FeeTotals, "total" | "share"> & { cents: bigint }>();
  let cancelledCount = 0;
  let hiddenCount = 0;
  for (const cost of costs) {
    const stage = settlementStage(costState(cost));
    if (!stage) {
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
    bucket.tax += vatCents(cents, cost.vat, cost.currency);
    bucket.stages[stage].count += 1;
    bucket.stages[stage].cents += cents;
    target.set(cost.currency, bucket);
    const key = `${cost.kind}|${cost.code}|${cost.categoryName}|${cost.currency}`;
    const fee = fees.get(key) || { key, kind: cost.kind, type: cost.type, code: cost.code, name: cost.categoryName, account: cost.account, currency: cost.currency, count: 0, cents: ZERO };
    fee.count += 1;
    fee.cents += cents;
    if (!fee.account && cost.account) fee.account = cost.account;
    fees.set(key, fee);
  }
  const groupTotal = (fee: { kind: CostKind; currency: string }) => (fee.kind === "goods" ? goodsTotals : costTotals).get(fee.currency)?.total ?? ZERO;
  return {
    costs: bucketList(costTotals),
    goods: bucketList(goodsTotals),
    byFee: [...fees.values()]
      .sort((a, b) => compareKind(a.kind, b.kind) || compareCurrency(a.currency, b.currency) || descCents(a.cents, b.cents) || a.name.localeCompare(b.name, "vi"))
      .map(({ cents, ...fee }) => ({ ...fee, total: fromCents(cents), share: percent(cents, groupTotal(fee)) })),
    cancelledCount,
    hiddenCount,
  };
}

/** Tổng của một giai đoạn qua nhiều loại tiền -> Money + số khoản. */
export function stageMoney(totals: Totals[], stage: SettlementStage): { count: number; total: Money } {
  return {
    count: totals.reduce((sum, item) => sum + item.stages[stage].count, 0),
    total: moneyOf(new Map(totals.map((item) => [item.currency, toCents(item.stages[stage].total)]))),
  };
}

export interface RequestTotals {
  requestId: string;
  content: string;
  requester: string;
  dueDate: string;
  state: CostState;
  count: number;
  /** Tổng các khoản của đề nghị phát sinh trong kỳ (bỏ khoản bị ẩn). */
  total: Money;
  hiddenCount: number;
}

/**
 * Các khoản của kỳ gom theo đề nghị (mới nhất trước) + phần chưa lập đề nghị (unrequested).
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
  /** Chi phí nhập khẩu & logistics (vận hành + phát sinh) lũy kế của lô. */
  cost: Money;
  /** Bình quân mỗi container (không có container thì rỗng). */
  costPerContainer: Money;
  /** Trị giá hàng mua. */
  goods: Money;
  goodsPerContainer: Money;
  /** Giá vốn nhập khẩu (landed cost) = trị giá hàng mua + chi phí, theo nguyên tệ. */
  landed: Money;
  landedPerContainer: Money;
  hidden: boolean;
}

export interface ContainerTotals {
  container: string;
  contract: string;
  supplier: string;
  /** Chi phí trực tiếp (gắn riêng container này). */
  direct: Money;
  /** Chi phí chung của lô phân bổ đều. */
  shared: Money;
  /** direct + shared. */
  total: Money;
  goodsShare: Money;
  /** Giá vốn nhập khẩu của container = total + goodsShare. */
  landed: Money;
}

/**
 * Giá vốn nhập khẩu theo lô hàng và theo container (lũy kế). Container của lô = danh sách từ lô hàng ∪ container có chi
 * phí (dữ liệu lệch vẫn không mất tiền). Chi phí chung (không gắn container) và trị giá hàng mua phân bổ đều cho số container.
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
    const lotCost = moneyOf(cost);
    const lotGoods = moneyOf(goods);
    const costEach = names.length ? moneyOf(perContainer(cost)) : [];
    const goodsEachMoney = names.length ? moneyOf(goodsEach) : [];
    lots.push({
      item: {
        contract, supplier, containerCount: names.length, hidden,
        cost: lotCost, costPerContainer: costEach, goods: lotGoods, goodsPerContainer: goodsEachMoney,
        landed: sumMoney(lotCost, lotGoods), landedPerContainer: names.length ? sumMoney(costEach, goodsEachMoney) : [],
      },
      sortCents: cost.get("VND") || ZERO,
    });
    for (const name of names) {
      const own = direct.get(name) || new Map<string, bigint>();
      const total = new Map(own);
      sharedEach.forEach((cents, currency) => addMoney(total, currency, cents));
      const totalMoney = moneyOf(total);
      const goodsShare = moneyOf(goodsEach);
      containers.push({
        item: { container: name, contract, supplier, direct: moneyOf(own), shared: moneyOf(sharedEach), total: totalMoney, goodsShare, landed: sumMoney(totalMoney, goodsShare) },
        sortCents: total.get("VND") || ZERO,
      });
    }
  }
  return {
    lots: lots.sort((a, b) => descCents(a.sortCents, b.sortCents) || a.item.contract.localeCompare(b.item.contract)).map((entry) => entry.item),
    containers: containers.sort((a, b) => descCents(a.sortCents, b.sortCents) || a.item.container.localeCompare(b.item.container)).map((entry) => entry.item),
  };
}

// ---------- Tuổi nợ phải trả ----------

/** Đề nghị đã trình chưa chi tiền (công nợ phải trả). */
export interface Payable {
  requestId: string;
  content: string;
  requester: string;
  /** pending = chờ phê duyệt; approved = đã phê duyệt, chờ chi. */
  state: "pending" | "approved";
  currency: string;
  /** Tổng thanh toán (gồm VAT); null = bị ẩn. */
  amount: string | null;
  /** Hạn thanh toán YYYY-MM-DD, rỗng = chưa xác định. */
  dueDate: string;
  requestDate: string;
}

/**
 * Nhóm tuổi nợ theo hạn thanh toán so với ngày báo cáo: notDue = trong hạn, còn trên 7 ngày; dueSoon = đến hạn trong 7
 * ngày tới (gồm hôm nay); overdue30 / 60 / 90 = quá hạn 1–30 / 31–60 / 61–90 ngày; overdueOver90 = quá hạn trên 90 ngày;
 * noDue = chưa xác định hạn.
 */
export type AgingBucket = "notDue" | "dueSoon" | "overdue30" | "overdue60" | "overdue90" | "overdueOver90" | "noDue";
export const AGING_BUCKETS: readonly AgingBucket[] = ["notDue", "dueSoon", "overdue30", "overdue60", "overdue90", "overdueOver90", "noDue"];
const DUE_SOON_DAYS = 7;

/** Số ngày từ a tới b (YYYY-MM-DD), b sau a thì dương. */
export function daysBetween(a: string, b: string): number {
  const utc = (value: string) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}

export function agingBucket(dueDate: string, today: string): AgingBucket {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return "noDue";
  const overdue = daysBetween(dueDate, today);
  if (overdue <= 0) return -overdue <= DUE_SOON_DAYS ? "dueSoon" : "notDue";
  if (overdue <= 30) return "overdue30";
  if (overdue <= 60) return "overdue60";
  if (overdue <= 90) return "overdue90";
  return "overdueOver90";
}

export interface AgingRow {
  bucket: AgingBucket;
  count: number;
  total: Money;
  hiddenCount: number;
}

export interface AgedPayable extends Payable {
  bucket: AgingBucket;
  /** Số ngày quá hạn (âm = còn bao nhiêu ngày tới hạn); null = chưa có hạn. */
  daysOverdue: number | null;
}

/**
 * Phân tích tuổi nợ phải trả: tổng theo nhóm tuổi nợ (đủ mọi nhóm, kể cả rỗng) + tổng cộng + danh sách đề nghị cần chú ý
 * (quá hạn / đến hạn trong 7 ngày, hạn sớm nhất trước).
 */
export function agePayables(payables: Payable[], today: string): { rows: AgingRow[]; total: Money; count: number; attention: AgedPayable[]; items: AgedPayable[] } {
  const buckets = new Map(AGING_BUCKETS.map((bucket) => [bucket, { count: 0, hiddenCount: 0, cents: new Map<string, bigint>() }]));
  const total = new Map<string, bigint>();
  const items = payables.map((item): AgedPayable => {
    const bucket = agingBucket(item.dueDate, today);
    const entry = buckets.get(bucket)!;
    entry.count += 1;
    if (item.amount === null) entry.hiddenCount += 1;
    else {
      addMoney(entry.cents, item.currency, toCents(item.amount));
      addMoney(total, item.currency, toCents(item.amount));
    }
    return { ...item, bucket, daysOverdue: bucket === "noDue" ? null : daysBetween(item.dueDate, today) };
  });
  const attention = items
    .filter((item) => item.bucket !== "notDue" && item.bucket !== "noDue")
    .sort((a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0) || a.requestId.localeCompare(b.requestId));
  return {
    rows: AGING_BUCKETS.map((bucket) => {
      const entry = buckets.get(bucket)!;
      return { bucket, count: entry.count, total: moneyOf(entry.cents), hiddenCount: entry.hiddenCount };
    }),
    total: moneyOf(total),
    count: payables.length,
    attention,
    items,
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
