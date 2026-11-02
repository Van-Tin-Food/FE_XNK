// Số liệu Báo cáo chi phí + file Excel: cộng tiền theo xu (BigInt, không sai số), không cộng VND với USD (theo nguyên tệ);
// chỉ giá vốn đơn hàng quy đổi VND khi người xem nhập tỷ giá USD/VND.
// - Chỉ tiêu tổng hợp của kỳ: chi phí mua hàng (cọc / còn lại = tiền hàng), chi phí vận hành (vận hành + phát sinh, tách giá
//   trị chưa thuế / thuế GTGT), đã thanh toán, cần thanh toán.
// - Đề nghị thanh toán của kỳ kèm từng khoản phí bên trong; cơ cấu chi phí theo khoản mục (tài khoản hạch toán, tỷ trọng).
// - Giá vốn đơn hàng (lũy kế): tiền hàng + thuế & phí theo đơn + phí cont, giá vốn trung bình / kg (NET).
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

/** Đơn hàng (hợp đồng) có chi phí trong kỳ. */
export interface ShipmentInfo {
  contract: string;
  supplier: string;
  containers: string[];
  /** Tổng NET (kg) trong chi tiết hợp đồng (chuỗi số, "0" = chưa có). */
  netWeight: string;
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

// ---------- Giá vốn đơn hàng ----------

/** Phí trực tiếp của một container trong đơn. */
export interface OrderContainer {
  container: string;
  fees: Money;
}

/** Giá vốn một đơn hàng (hợp đồng), lũy kế mọi kỳ. */
export interface OrderTotals {
  contract: string;
  supplier: string;
  containerCount: number;
  /** Tổng NET (kg) trong chi tiết hợp đồng; 0 = chưa có. */
  netKg: number;
  /** Tiền hàng (thanh toán quốc tế: cọc + thanh toán còn lại). */
  goods: Money;
  /** Thuế & phí theo đơn (không gắn container: thuế nhập khẩu, lệ phí, phí chung của lô...). */
  orderFees: Money;
  /** Phí theo container (cộng mọi container của đơn). */
  containerFees: Money;
  /** Tổng giá vốn theo nguyên tệ = tiền hàng + thuế & phí đơn + phí cont. */
  total: Money;
  containers: OrderContainer[];
  /** Tiền hàng bị ẩn (không có quyền xem). */
  hidden: boolean;
  /** Tổng giá vốn quy đổi VND theo tỷ giá; null = có ngoại tệ mà chưa nhập tỷ giá (hoặc tiền hàng bị ẩn). */
  totalVnd: string | null;
  /** Giá vốn trung bình mỗi kg (VND, làm tròn đồng); null = chưa quy đổi được hoặc chưa có NET. */
  perKgVnd: string | null;
}

/**
 * Tỷ giá USD/VND nhập trên báo cáo ("25.400", "25400", "25400,5") -> số xu VND cho 1 USD (BigInt), không hợp lệ / ≤ 0 thì
 * null.
 */
export function parseRate(value: string): bigint | null {
  const raw = String(value ?? "").trim().replace(/\s/g, "");
  if (!raw) return null;
  // "25.400" / "25,400" (phân tách nghìn) hoặc "25400,5" / "25400.5" (thập phân, tối đa 2 số).
  const normalized = /^\d{1,3}([.,]\d{3})+$/.test(raw) ? raw.replace(/[.,]/g, "") : raw.replace(",", ".");
  const cents = toCents(normalized);
  return /^\d+(\.\d{1,2})?$/.test(normalized) && cents > ZERO ? cents : null;
}

/** Quy đổi tiền nhiều loại sang xu VND (USD × tỷ giá); có loại tiền khác hoặc USD mà chưa có tỷ giá thì null. */
function toVndCents(money: Money, usdRate: bigint | null): bigint | null {
  let total = ZERO;
  for (const item of money) {
    const cents = toCents(item.total);
    if (item.currency === "VND") total += cents;
    else if (item.currency === "USD" && usdRate !== null) total += (cents * usdRate + HUNDRED / BigInt(2)) / HUNDRED;
    else return null;
  }
  return total;
}

/**
 * Giá vốn theo đơn hàng (hợp đồng có chi phí trong kỳ, lũy kế mọi kỳ): số cont, NET (kg), tiền hàng (thanh toán quốc tế),
 * thuế & phí theo đơn (không gắn container), phí theo container; tổng giá vốn theo nguyên tệ và quy đổi VND theo tỷ giá
 * USD/VND (usdRate = xu VND cho 1 USD, null = chưa nhập); giá vốn trung bình / kg = tổng VND ÷ NET. Tiền cược container
 * không tính (tạm ứng). Container của đơn = danh sách từ lô hàng ∪ container có chi phí. Sắp xếp tổng giá vốn giảm dần.
 */
export function summarizeOrders(shipments: ShipmentInfo[], costs: ShipmentCost[], usdRate: bigint | null): OrderTotals[] {
  const info = new Map(shipments.map((item) => [item.contract, item]));
  const contracts = [...new Set([...shipments.map((item) => item.contract), ...costs.map((item) => item.contract)])];
  const orders = contracts.map((contract) => {
    const rows = costs.filter((item) => item.contract === contract && item.kind !== "deposit");
    const names = [...new Set([...(info.get(contract)?.containers || []), ...rows.map((item) => item.container).filter(Boolean)])].sort();
    const goods = new Map<string, bigint>();
    const orderFees = new Map<string, bigint>();
    const containerFees = new Map<string, bigint>();
    const byContainer = new Map<string, Map<string, bigint>>(names.map((name) => [name, new Map<string, bigint>()]));
    let hidden = false;
    for (const row of rows) {
      if (row.amount === null) {
        hidden = true;
        continue;
      }
      const cents = toCents(row.amount);
      if (row.kind === "goods") addMoney(goods, row.currency, cents);
      else if (!row.container) addMoney(orderFees, row.currency, cents);
      else {
        addMoney(containerFees, row.currency, cents);
        addMoney(byContainer.get(row.container) as Map<string, bigint>, row.currency, cents);
      }
    }
    const total = sumMoney(moneyOf(goods), moneyOf(orderFees), moneyOf(containerFees));
    const netKg = Number(info.get(contract)?.netWeight || 0) || 0;
    const vnd = hidden ? null : toVndCents(total, usdRate);
    const item: OrderTotals = {
      contract,
      supplier: info.get(contract)?.supplier || "",
      containerCount: names.length,
      netKg,
      goods: moneyOf(goods),
      orderFees: moneyOf(orderFees),
      containerFees: moneyOf(containerFees),
      total,
      containers: names.map((container) => ({ container, fees: moneyOf(byContainer.get(container) as Map<string, bigint>) })),
      hidden,
      totalVnd: vnd === null ? null : fromCents(vnd),
      perKgVnd: vnd === null || netKg <= 0 ? null : String(Math.round(Number(vnd) / 100 / netKg)),
    };
    // Sắp xếp theo tổng giá vốn VND (chưa quy đổi được thì theo phần VND) — khóa giữ riêng, không lẫn vào dữ liệu trả về.
    return { item, sortCents: vnd ?? toCents(total.find((entry) => entry.currency === "VND")?.total) };
  });
  return orders
    .sort((a, b) => descCents(a.sortCents, b.sortCents) || a.item.contract.localeCompare(b.item.contract))
    .map((entry) => entry.item);
}

/**
 * Khoản thuộc chi phí mua hàng: tiền hàng hoặc khoản gắn đơn hàng (hợp đồng / container — vận chuyển, thông quan, thuế, phí
 * liên quan). Khoản không gắn đơn nào (văn phòng, lương...) là chi phí vận hành.
 */
export const isPurchaseCost = (cost: Pick<MonthlyCost, "kind" | "contract" | "container">) => cost.kind === "goods" || Boolean(cost.contract || cost.container);

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
