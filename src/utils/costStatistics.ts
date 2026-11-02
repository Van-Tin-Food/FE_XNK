// Số liệu Báo cáo chi phí + file Excel: cộng tiền theo xu (BigInt, không sai số), không cộng VND với USD (theo nguyên tệ);
// chỉ giá vốn đơn hàng quy đổi VND khi người xem nhập tỷ giá USD/VND.
// - Chỉ tiêu tổng hợp của kỳ: chi phí mua hàng (cọc / còn lại = tiền hàng), chi phí vận hành (vận hành + phát sinh, tách giá
//   trị chưa thuế / thuế GTGT), đã thanh toán, cần thanh toán.
// - Đề nghị thanh toán của kỳ kèm từng khoản phí bên trong; cơ cấu chi phí theo khoản mục (tài khoản hạch toán, tỷ trọng).
// - Tiền cược container (BE nhận theo tên khoản phí — be/src/config/containerDepositFees.js): khoản ký cược / tạm ứng, hãng
//   tàu hoàn lại khi trả cont — tách khỏi chi phí và giá vốn; công nợ tiền cược (phải thu hãng tàu) theo container = cược đã
//   chi − phí sửa cont (phí sửa cont: chi phí thật, tính vào giá vốn; chưa vào đề nghị = đã cấn trừ vào tiền cược). Hệ thống
//   không quản lý thu tiền nên công nợ này không tự giảm khi hãng tàu hoàn tiền.
// Hàm thuần, không import (test chạy thẳng).

export type CostState = "none" | "draft" | "pending" | "rejected" | "approved" | "paid" | "completed" | "cancelled";
/**
 * Giai đoạn thanh toán của khoản: settled = đã thanh toán (đã chi tiền / hoàn tất chứng từ); approved = đã phê duyệt, chờ
 * chi; pending = chờ phê duyệt; unsubmitted = chưa trình duyệt (nháp / không duyệt); unrequested = chưa lập đề nghị.
 */
export type SettlementStage = "settled" | "approved" | "pending" | "unsubmitted" | "unrequested";
/**
 * operating = chi phí vận hành / logistics; incident = phát sinh; goods = tiền hàng (cọc / còn lại); deposit = tiền cược
 * container (ký cược / tạm ứng, không phải chi phí).
 */
export type CostKind = "operating" | "incident" | "goods" | "deposit";
/** Khoản đặc biệt (BE nhận theo tên khoản phí): cuoc_cont = tiền cược container; sua_cont = phí sửa cont trừ vào cược. */
export type CostSpecial = "" | "cuoc_cont" | "sua_cont";

export const COST_STATES: readonly CostState[] = ["none", "draft", "pending", "rejected", "approved", "paid", "completed", "cancelled"];
export const SETTLEMENT_STAGES: readonly SettlementStage[] = ["settled", "approved", "pending", "unsubmitted", "unrequested"];
export const COST_KINDS: readonly CostKind[] = ["operating", "incident", "goods", "deposit"];
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
  special: CostSpecial;
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
  /** Tiền cược container (ký cược / tạm ứng) theo loại tiền — không phải chi phí. */
  deposits: Totals[];
  byFee: FeeTotals[];
  /** Khoản thuộc đề nghị đã hủy (không tính). */
  cancelledCount: number;
  /** Khoản bị ẩn số tiền (không tính). */
  hiddenCount: number;
}

const HUNDRED = BigInt(100);
const ZERO = BigInt(0);

export function toCents(value: string | null | undefined): bigint {
  // Nhận cả số âm (công nợ tiền cược âm khi phí sửa cont vượt tiền cược).
  const match = /^(-?)(\d+)(?:\.(\d{1,2})\d*)?$/.exec(String(value ?? "").trim());
  if (!match) return ZERO;
  const cents = BigInt(match[2]) * HUNDRED + BigInt((match[3] || "").padEnd(2, "0"));
  return match[1] ? -cents : cents;
}

export function fromCents(cents: bigint): string {
  const abs = cents < ZERO ? -cents : cents;
  return `${cents < ZERO ? "-" : ""}${abs / HUNDRED}.${(abs % HUNDRED).toString().padStart(2, "0")}`;
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

/**
 * Giai đoạn thanh toán của một khoản: như settlementStage, riêng phí sửa cont chưa vào đề nghị = đã thanh toán (hãng tàu đã
 * trừ vào tiền cược, không chi tiền).
 */
export function costStage(cost: Pick<MonthlyCost, "requestId" | "requestStatus" | "requestSent" | "special">): SettlementStage | null {
  const state = costState(cost);
  return cost.special === "sua_cont" && state === "none" ? "settled" : settlementStage(state);
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
  const depositTotals = new Map<string, Bucket>();
  const totalsOf = (kind: CostKind) => (kind === "goods" ? goodsTotals : kind === "deposit" ? depositTotals : costTotals);
  const fees = new Map<string, Omit<FeeTotals, "total" | "share"> & { cents: bigint }>();
  let cancelledCount = 0;
  let hiddenCount = 0;
  for (const cost of costs) {
    const stage = costStage(cost);
    if (!stage) {
      cancelledCount += 1;
      continue;
    }
    if (cost.amount === null) {
      hiddenCount += 1;
      continue;
    }
    const cents = toCents(cost.amount);
    const target = totalsOf(cost.kind);
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
  const groupTotal = (fee: { kind: CostKind; currency: string }) => totalsOf(fee.kind).get(fee.currency)?.total ?? ZERO;
  return {
    costs: bucketList(costTotals),
    goods: bucketList(goodsTotals),
    deposits: bucketList(depositTotals),
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
  /** Các khoản phí của đề nghị phát sinh trong kỳ (thứ tự nhập). */
  items: MonthlyCost[];
}

/**
 * Các khoản của kỳ gom theo đề nghị (mới nhất trước) + phần chưa lập đề nghị (unrequested).
 * Đề nghị đã hủy vẫn liệt kê (để biết) nhưng gắn state cancelled.
 */
export function groupByRequest(costs: MonthlyCost[]): { requests: RequestTotals[]; unrequested: { count: number; total: Money; items: MonthlyCost[] } } {
  const requests = new Map<string, RequestTotals & { cents: Map<string, bigint> }>();
  const loose = new Map<string, bigint>();
  const looseItems: MonthlyCost[] = [];
  for (const cost of costs) {
    if (!cost.requestId) {
      looseItems.push(cost);
      if (cost.amount !== null) addMoney(loose, cost.currency, toCents(cost.amount));
      continue;
    }
    const current = requests.get(cost.requestId) || {
      requestId: cost.requestId, content: cost.requestContent, requester: cost.requestBy, dueDate: cost.requestDue,
      state: costState(cost), count: 0, total: [], hiddenCount: 0, items: [], cents: new Map<string, bigint>(),
    };
    current.count += 1;
    current.items.push(cost);
    if (cost.amount === null) current.hiddenCount += 1;
    else addMoney(current.cents, cost.currency, toCents(cost.amount));
    requests.set(cost.requestId, current);
  }
  const number = (id: string) => Number(id.replace(/\D/g, "")) || 0;
  return {
    requests: [...requests.values()]
      .sort((a, b) => number(b.requestId) - number(a.requestId))
      .map(({ cents, ...item }) => ({ ...item, total: moneyOf(cents) })),
    unrequested: { count: looseItems.length, total: moneyOf(loose), items: looseItems },
  };
}

// ---------- Công nợ tiền cược container ----------

/**
 * Khoản dùng cho số liệu báo cáo: bỏ tiền cược container (tạm ứng — không tính vào bất kỳ chỉ tiêu nào: chi phí, tình hình
 * thanh toán, cơ cấu, bảng kê, chi tiết), chỉ theo dõi riêng ở công nợ tiền cược (summarizeDeposits).
 */
export function withoutDeposits<T extends { kind: CostKind }>(costs: T[]): T[] {
  return costs.filter((cost) => cost.kind !== "deposit");
}

/** Khoản cược cont / sửa cont gộp theo lô × container × loại × loại tiền (BE, tính đến hôm nay, mọi kỳ). */
export interface DepositRow {
  contract: string;
  container: string;
  special: "cuoc_cont" | "sua_cont";
  currency: string;
  /** Tiền cược đã chi (đề nghị đã chi tiền); phí sửa cont luôn false. */
  paid: boolean;
  count: number;
  amount: string;
  /** Ngày nhập khoản đầu tiên (YYYY-MM-DD). */
  firstDate: string;
}

export interface ContainerDeposit {
  container: string;
  contract: string;
  currency: string;
  /** Tiền cược đã chi cho hãng tàu. */
  paid: string;
  /** Tiền cược chưa chi (nháp, chờ duyệt, chờ chi, chưa lập đề nghị). */
  unpaid: string;
  /** Phí sửa cont hãng tàu trừ vào tiền cược. */
  repair: string;
  /** Phải thu hãng tàu = cược đã chi − phí sửa cont (âm = phí sửa vượt tiền cược, phải trả thêm). */
  receivable: string;
  /** Ngày nhập khoản cược / sửa đầu tiên của container. */
  since: string;
}

/**
 * Công nợ tiền cược theo container (mỗi loại tiền một dòng): phải thu = cược đã chi − phí sửa cont. Sắp xếp phải thu giảm
 * dần. totals: tổng theo loại tiền.
 */
export function summarizeDeposits(rows: DepositRow[]): { items: ContainerDeposit[]; totals: { paid: Money; unpaid: Money; repair: Money; receivable: Money } } {
  const groups = new Map<string, { container: string; contract: string; currency: string; paid: bigint; unpaid: bigint; repair: bigint; since: string }>();
  for (const row of rows) {
    const key = [row.contract, row.container, row.currency].join("|");
    const group = groups.get(key) || { container: row.container, contract: row.contract, currency: row.currency, paid: ZERO, unpaid: ZERO, repair: ZERO, since: row.firstDate };
    const cents = toCents(row.amount);
    if (row.special === "sua_cont") group.repair += cents;
    else if (row.paid) group.paid += cents;
    else group.unpaid += cents;
    if (row.firstDate && (!group.since || row.firstDate < group.since)) group.since = row.firstDate;
    groups.set(key, group);
  }
  const paid = new Map<string, bigint>();
  const unpaid = new Map<string, bigint>();
  const repair = new Map<string, bigint>();
  const receivable = new Map<string, bigint>();
  const sorted = [...groups.values()].sort((a, b) => compareCurrency(a.currency, b.currency)
    || descCents(a.paid - a.repair, b.paid - b.repair) || a.container.localeCompare(b.container));
  const items = sorted.map((group) => {
    addMoney(paid, group.currency, group.paid);
    addMoney(unpaid, group.currency, group.unpaid);
    addMoney(repair, group.currency, group.repair);
    addMoney(receivable, group.currency, group.paid - group.repair);
    return {
      container: group.container, contract: group.contract, currency: group.currency, since: group.since,
      paid: fromCents(group.paid), unpaid: fromCents(group.unpaid), repair: fromCents(group.repair), receivable: fromCents(group.paid - group.repair),
    };
  });
  return { items, totals: { paid: moneyOf(paid), unpaid: moneyOf(unpaid), repair: moneyOf(repair), receivable: moneyOf(receivable) } };
}

/** Số ngày từ a tới b (YYYY-MM-DD), b sau a thì dương. */
export function daysBetween(a: string, b: string): number {
  const utc = (value: string) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  return Math.round((utc(b) - utc(a)) / 86_400_000);
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
