import assert from "node:assert/strict";
import test from "node:test";
import {
  agePayables, agingBucket, costState, currentMonth, groupByRequest, isMonth, settlementStage, shiftMonth, stageMoney, summarizeCosts,
  summarizeShipments, todayVn, vatCents,
} from "../src/utils/costStatistics.ts";

const cost = (overrides) => ({
  id: "c", createdAt: "2026-10-05T03:00:00Z", contract: "", container: "", amount: "100.00", vat: "", note: "",
  type: "van_hanh", code: "VH", categoryName: "Phí internet", flow: "xanh", userName: "A",
  account: "", requestId: "", requestStatus: null, requestSent: false, requestContent: "", requestDue: "", requestBy: "",
  currency: "VND", currencyInferred: true, kind: "operating",
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
  assert.deepEqual(unrequested, { count: 2, total: [{ currency: "VND", total: "30.00" }, { currency: "USD", total: "2.00" }] });
});

test("giá vốn nhập khẩu theo lô / container: chi phí trực tiếp + chi phí chung phân bổ; hàng mua phân bổ đều; container lệch dữ liệu vẫn có", () => {
  const { lots, containers } = summarizeShipments(
    [{ contract: "26010", supplier: "NCC A", containers: ["C1", "C2"] }, { contract: "26011", supplier: "NCC B", containers: [] }],
    [
      { contract: "26010", container: "C1", kind: "operating", currency: "VND", count: 2, amount: "1000.00" },
      { contract: "26010", container: "", kind: "incident", currency: "VND", count: 1, amount: "301.00" },
      { contract: "26010", container: "C3", kind: "operating", currency: "VND", count: 1, amount: "50.00" },
      { contract: "26010", container: "", kind: "goods", currency: "USD", count: 1, amount: "9000.00" },
      { contract: "26011", container: "", kind: "operating", currency: "VND", count: 1, amount: "70.00" },
      { contract: "26011", container: "", kind: "goods", currency: "USD", count: 1, amount: null },
    ],
  );
  assert.deepEqual(lots.map((item) => [item.contract, item.containerCount, item.cost, item.costPerContainer, item.goods, item.goodsPerContainer, item.hidden]), [
    ["26010", 3, [{ currency: "VND", total: "1351.00" }], [{ currency: "VND", total: "450.00" }], [{ currency: "USD", total: "9000.00" }], [{ currency: "USD", total: "3000.00" }], false],
    ["26011", 0, [{ currency: "VND", total: "70.00" }], [], [], [], true],
  ]);
  assert.deepEqual(containers.map((item) => [item.container, item.direct, item.shared, item.total]), [
    ["C1", [{ currency: "VND", total: "1000.00" }], [{ currency: "VND", total: "100.00" }], [{ currency: "VND", total: "1100.00" }]],
    ["C2", [], [{ currency: "VND", total: "100.00" }], [{ currency: "VND", total: "100.00" }]],
    ["C3", [{ currency: "VND", total: "50.00" }], [{ currency: "VND", total: "100.00" }], [{ currency: "VND", total: "150.00" }]],
  ].sort((a, b) => Number(b[3][0].total) - Number(a[3][0].total)));
  assert.deepEqual(containers.find((item) => item.container === "C2").goodsShare, [{ currency: "USD", total: "3000.00" }]);
  assert.deepEqual(lots[0].landed, [{ currency: "VND", total: "1351.00" }, { currency: "USD", total: "9000.00" }], "giá vốn = hàng mua + chi phí, theo nguyên tệ");
  assert.deepEqual(lots[0].landedPerContainer, [{ currency: "VND", total: "450.00" }, { currency: "USD", total: "3000.00" }]);
  assert.deepEqual(lots[1].landedPerContainer, [], "lô chưa có container: không tính bình quân");
  assert.deepEqual(containers.find((item) => item.container === "C2").landed, [{ currency: "VND", total: "100.00" }, { currency: "USD", total: "3000.00" }]);
});

test("tuổi nợ phải trả: nhóm theo hạn thanh toán so với ngày báo cáo; danh sách cần ưu tiên quá hạn lâu nhất trước", () => {
  const today = "2026-10-31";
  assert.deepEqual(["2026-11-08", "2026-11-07", "2026-10-31", "2026-10-30", "2026-10-01", "2026-09-30", "2026-08-02", "2026-08-01", ""].map((due) => agingBucket(due, today)),
    ["notDue", "dueSoon", "dueSoon", "overdue30", "overdue30", "overdue60", "overdue90", "overdueOver90", "noDue"]);
  const payable = (requestId, dueDate, amount, currency = "VND") => ({ requestId, content: "", requester: "A", state: "approved", currency, amount, dueDate, requestDate: "2026-09-01" });
  const result = agePayables([
    payable("DNTT-1", "2026-10-20", "100.00"),
    payable("DNTT-2", "2026-07-01", "200.00"),
    payable("DNTT-3", "2026-11-03", "5.00", "USD"),
    payable("DNTT-4", "", null),
    payable("DNTT-5", "2026-12-31", "1.00"),
  ], today);
  assert.deepEqual(result.rows.filter((row) => row.count).map((row) => [row.bucket, row.count, row.total, row.hiddenCount]), [
    ["notDue", 1, [{ currency: "VND", total: "1.00" }], 0],
    ["dueSoon", 1, [{ currency: "USD", total: "5.00" }], 0],
    ["overdue30", 1, [{ currency: "VND", total: "100.00" }], 0],
    ["overdueOver90", 1, [{ currency: "VND", total: "200.00" }], 0],
    ["noDue", 1, [], 1],
  ]);
  assert.equal(result.rows.length, 7, "đủ mọi nhóm, kể cả nhóm rỗng");
  assert.deepEqual(result.total, [{ currency: "VND", total: "301.00" }, { currency: "USD", total: "5.00" }]);
  assert.deepEqual(result.attention.map((item) => [item.requestId, item.daysOverdue]), [["DNTT-2", 122], ["DNTT-1", 11], ["DNTT-3", -3]]);
});

test("ngày tháng theo giờ Việt Nam, lùi / tiến qua năm", () => {
  assert.equal(currentMonth(new Date("2026-10-31T18:30:00Z")), "2026-11", "01:30 ngày 1/11 giờ VN");
  assert.equal(todayVn(new Date("2026-10-31T18:30:00Z")), "2026-11-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(isMonth("2026-10"), true);
  assert.equal(isMonth("2026-13"), false);
});
