import assert from "node:assert/strict";
import test from "node:test";
import {
  costState, currentMonth, daysBetween, groupByRequest, isMonth, settlementStage, shiftMonth, stageMoney, summarizeCosts,
  summarizeDeposits, todayVn, vatCents, fromCents, toCents, withoutDeposits,
} from "../src/utils/costStatistics.ts";

const cost = (overrides) => ({
  id: "c", createdAt: "2026-10-05T03:00:00Z", contract: "", container: "", amount: "100.00", vat: "", note: "",
  type: "van_hanh", code: "VH", categoryName: "Phí internet", flow: "xanh", userName: "A",
  account: "", requestId: "", requestStatus: null, requestSent: false, requestContent: "", requestDue: "", requestBy: "",
  currency: "VND", currencyInferred: true, kind: "operating", special: "",
  ...overrides,
});

test("tình trạng khoản theo đề nghị và giai đoạn thanh toán (đã duyệt chờ chi tách khỏi đã thanh toán)", () => {
  assert.equal(costState(cost({})), "none");
  assert.equal(costState(cost({ requestId: "DNTT-1", requestStatus: 0, requestSent: false })), "draft");
  assert.equal(costState(cost({ requestId: "DNTT-1", requestStatus: 0, requestSent: true })), "pending");
  assert.equal(costState(cost({ requestId: "DNTT-1", requestStatus: -1 })), "rejected");
  assert.equal(costState(cost({ requestId: "DNTT-1", requestStatus: 1 })), "approved");
  assert.equal(costState(cost({ requestId: "DNTT-1", requestStatus: 3 })), "paid");
  assert.equal(costState(cost({ requestId: "DNTT-1", requestStatus: 2 })), "completed");
  assert.equal(costState(cost({ requestId: "DNTT-1", requestStatus: -2 })), "cancelled");
  assert.deepEqual(["none", "draft", "pending", "rejected", "approved", "paid", "completed", "cancelled"].map(settlementStage),
    ["unrequested", "unsubmitted", "pending", "unsubmitted", "approved", "settled", "settled", null]);
});

test("tổng kỳ: chi phí (vận hành + phát sinh) tách khỏi hàng mua, không cộng VND với USD, bỏ đề nghị đã hủy / khoản bị ẩn", () => {
  const summary = summarizeCosts([
    cost({ id: "1", amount: "1250000.00", requestId: "DNTT-1", requestStatus: 1 }),
    cost({ id: "2", amount: "0.10", requestId: "DNTT-2", requestStatus: 0, requestSent: true }),
    cost({ id: "3", amount: "0.20", kind: "incident", categoryName: "Kiểm hóa" }),
    cost({ id: "4", amount: "999.99", requestId: "DNTT-3", requestStatus: -2 }),
    cost({ id: "5", amount: "18500.50", currency: "USD", kind: "goods", code: "HD", categoryName: "Cọc hàng", requestId: "DNTT-4", requestStatus: 2 }),
    cost({ id: "6", amount: null, currency: "USD", kind: "goods", code: "HD", categoryName: "Thanh toán tiền còn lại" }),
  ]);
  const [vnd] = summary.costs;
  assert.deepEqual([summary.costs.length, vnd.currency, vnd.count, vnd.total, vnd.tax], [1, "VND", 3, "1250000.30", "0.00"]);
  assert.deepEqual(Object.fromEntries(Object.entries(vnd.stages).map(([stage, item]) => [stage, [item.count, item.total]])), {
    settled: [0, "0.00"], approved: [1, "1250000.00"], pending: [1, "0.10"], unsubmitted: [0, "0.00"], unrequested: [1, "0.20"],
  });
  assert.deepEqual([summary.goods.length, summary.goods[0].currency, summary.goods[0].total, summary.goods[0].stages.settled.total], [1, "USD", "18500.50", "18500.50"]);
  assert.deepEqual(summary.byFee.map((fee) => [fee.kind, fee.name, fee.count, fee.total, fee.share]), [
    ["operating", "Phí internet", 2, "1250000.10", 100],
    ["incident", "Kiểm hóa", 1, "0.20", 0],
    ["goods", "Cọc hàng", 1, "18500.50", 100],
  ]);
  assert.equal(summary.cancelledCount, 1);
  assert.equal(summary.hiddenCount, 1);
});

test("thuế GTGT (tách từ số tiền gồm VAT, VND tròn đồng), tỷ trọng khoản mục, tài khoản hạch toán, tổng theo giai đoạn", () => {
  assert.equal(vatCents(BigInt(110000000), "10", "VND"), BigInt(10000000));
  assert.equal(vatCents(BigInt(10000), "8", "VND"), BigInt(700), "100 đồng gồm 8% VAT: trước thuế 93 đồng, thuế 7 đồng");
  assert.equal(vatCents(BigInt(10000), "", "VND"), BigInt(0));
  const summary = summarizeCosts([
    cost({ id: "1", amount: "1100000.00", vat: "10", code: "VC", categoryName: "Cước vận chuyển", account: "6427", requestId: "DNTT-1", requestStatus: 3 }),
    cost({ id: "2", amount: "300000.00", code: "LP", categoryName: "Lệ phí", requestId: "DNTT-2", requestStatus: 1 }),
    cost({ id: "3", amount: "50.00", currency: "USD", code: "LP", categoryName: "Lệ phí", requestId: "DNTT-3", requestStatus: 0, requestSent: true }),
  ]);
  assert.deepEqual(summary.costs.map((item) => [item.currency, item.base, item.tax, item.total]), [["VND", "1300000.00", "100000.00", "1400000.00"], ["USD", "50.00", "0.00", "50.00"]]);
  assert.deepEqual(summary.byFee.map((fee) => [fee.name, fee.currency, fee.account, fee.share]), [
    ["Cước vận chuyển", "VND", "6427", 78.6],
    ["Lệ phí", "VND", "", 21.4],
    ["Lệ phí", "USD", "", 100],
  ]);
  assert.deepEqual(stageMoney(summary.costs, "settled"), { count: 1, total: [{ currency: "VND", total: "1100000.00" }] });
  assert.deepEqual(stageMoney(summary.costs, "pending"), { count: 1, total: [{ currency: "USD", total: "50.00" }] });
});

test("theo đề nghị: gom các khoản của kỳ theo đề nghị (mới nhất trước) + phần chưa lập đề nghị", () => {
  const { requests, unrequested } = groupByRequest([
    cost({ id: "1", requestId: "DNTT-9", requestStatus: 1, requestContent: "Cước tháng 9", requestBy: "B", requestDue: "2026-10-20", amount: "100.00" }),
    cost({ id: "2", requestId: "DNTT-9", requestStatus: 1, amount: "50.50" }),
    cost({ id: "3", requestId: "DNTT-10", requestStatus: 0, requestSent: true, amount: "7.00", currency: "USD" }),
    cost({ id: "4", requestId: "DNTT-10", requestStatus: 0, requestSent: true, amount: null, currency: "USD" }),
    cost({ id: "5", amount: "30.00" }),
    cost({ id: "6", amount: "2.00", currency: "USD" }),
  ]);
  assert.deepEqual(requests.map((item) => [item.requestId, item.state, item.count, item.total, item.hiddenCount]), [
    ["DNTT-10", "pending", 2, [{ currency: "USD", total: "7.00" }], 1],
    ["DNTT-9", "approved", 2, [{ currency: "VND", total: "150.50" }], 0],
  ]);
  assert.equal(requests[1].content, "Cước tháng 9");
  assert.deepEqual(requests[1].items.map((item) => item.id), ["1", "2"], "chi tiết khoản phí bên trong đề nghị");
  assert.deepEqual([unrequested.count, unrequested.total, unrequested.items.map((item) => item.id)],
    [2, [{ currency: "VND", total: "30.00" }, { currency: "USD", total: "2.00" }], ["5", "6"]]);
});

test("số ngày giữa hai ngày (YYYY-MM-DD)", () => {
  assert.equal(daysBetween("2026-10-01", "2026-10-31"), 30);
  assert.equal(daysBetween("2026-10-31", "2026-10-01"), -30);
});

test("ngày tháng theo giờ Việt Nam, lùi / tiến qua năm", () => {
  assert.equal(currentMonth(new Date("2026-10-31T18:30:00Z")), "2026-11", "01:30 ngày 1/11 giờ VN");
  assert.equal(todayVn(new Date("2026-10-31T18:30:00Z")), "2026-11-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(isMonth("2026-10"), true);
  assert.equal(isMonth("2026-13"), false);
});

test("tiền cược container: tách khỏi chi phí / hàng mua, không vào giá vốn; phí sửa cont chưa lập đề nghị = đã cấn trừ", () => {
  const summary = summarizeCosts([
    cost({ id: "1", amount: "1000.00", requestId: "DNTT-1", requestStatus: 3 }),
    cost({ id: "2", amount: "2000000.00", kind: "deposit", special: "cuoc_cont", code: "CONT", categoryName: "Phí cược cont", requestId: "DNTT-2", requestStatus: 3 }),
    cost({ id: "3", amount: "350000.00", special: "sua_cont", code: "CONT", categoryName: "Phí sửa cont" }),
  ]);
  assert.deepEqual(summary.costs.map((item) => [item.currency, item.count, item.total]), [["VND", 2, "351000.00"]], "phí sửa cont là chi phí; tiền cược không");
  assert.deepEqual(summary.deposits.map((item) => [item.currency, item.count, item.total, item.stages.settled.total]), [["VND", 1, "2000000.00", "2000000.00"]]);
  assert.equal(summary.costs[0].stages.settled.total, "351000.00", "phí sửa cont chưa lập đề nghị tính là đã thanh toán (trừ vào cược)");
  assert.equal(summary.costs[0].stages.unrequested.count, 0);
  assert.deepEqual(withoutDeposits([cost({ id: "a" }), cost({ id: "b", kind: "deposit" }), cost({ id: "c", special: "sua_cont" })]).map((item) => item.id), ["a", "c"],
    "báo cáo bỏ tiền cược khỏi mọi số liệu của kỳ, giữ phí sửa cont");
  const depositFee = summary.byFee.find((fee) => fee.kind === "deposit");
  assert.deepEqual([depositFee.name, depositFee.share], ["Phí cược cont", 100], "tỷ trọng tính trong nhóm tiền cược");

});

test("công nợ tiền cược theo container: phải thu = cược đã chi − phí sửa cont; cược chưa chi tách riêng; âm khi phí sửa vượt cược", () => {
  const row = (overrides) => ({ contract: "26010", container: "TCLU1", special: "cuoc_cont", currency: "VND", paid: true, count: 1, amount: "2000000.00", firstDate: "2026-09-02", ...overrides });
  const { items, totals } = summarizeDeposits([
    row({}),
    row({ special: "sua_cont", paid: false, amount: "350000.00", firstDate: "2026-10-01" }),
    row({ container: "TCLU2", amount: "1000000.00", paid: false, firstDate: "2026-10-03" }),
    row({ container: "TCLU3", amount: "500000.00" }),
    row({ container: "TCLU3", special: "sua_cont", paid: false, amount: "800000.00" }),
    row({ container: "MSKU9", currency: "USD", amount: "150.00" }),
  ]);
  assert.deepEqual(items.map((item) => [item.container, item.currency, item.paid, item.unpaid, item.repair, item.receivable, item.since]), [
    ["TCLU1", "VND", "2000000.00", "0.00", "350000.00", "1650000.00", "2026-09-02"],
    ["TCLU2", "VND", "0.00", "1000000.00", "0.00", "0.00", "2026-10-03"],
    ["TCLU3", "VND", "500000.00", "0.00", "800000.00", "-300000.00", "2026-09-02"],
    ["MSKU9", "USD", "150.00", "0.00", "0.00", "150.00", "2026-09-02"],
  ]);
  assert.deepEqual(totals.receivable, [{ currency: "VND", total: "1350000.00" }, { currency: "USD", total: "150.00" }]);
  assert.deepEqual(totals.unpaid, [{ currency: "VND", total: "1000000.00" }]);
  assert.deepEqual([fromCents(-30050n), toCents("-300.50"), toCents("12.3")], ["-300.50", -30050n, 1230n], "số âm");
});
