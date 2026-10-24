import assert from "node:assert/strict";
import test from "node:test";
import {
  costGroup, costState, currentMonth, groupByRequest, isMonth, shiftMonth, summarizeCosts, summarizeShipments, todayVn,
} from "../src/utils/costStatistics.ts";

const cost = (overrides) => ({
  id: "c", createdAt: "2026-10-05T03:00:00Z", contract: "", container: "", amount: "100.00", vat: "", note: "",
  type: "van_hanh", code: "VH", categoryName: "Phí internet", flow: "xanh", userName: "A",
  requestId: "", requestStatus: null, requestSent: false, requestContent: "", requestDue: "", requestBy: "",
  currency: "VND", currencyInferred: true, kind: "operating",
  ...overrides,
});

test("tình trạng khoản theo đề nghị và nhóm cộng tổng", () => {
  assert.equal(costState(cost({})), "none");
  assert.equal(costState(cost({ requestId: "DNTT-1", requestStatus: 0, requestSent: false })), "draft");
  assert.equal(costState(cost({ requestId: "DNTT-1", requestStatus: 0, requestSent: true })), "pending");
  assert.equal(costState(cost({ requestId: "DNTT-1", requestStatus: -1 })), "rejected");
  assert.equal(costState(cost({ requestId: "DNTT-1", requestStatus: 1 })), "approved");
  assert.equal(costState(cost({ requestId: "DNTT-1", requestStatus: 2 })), "completed");
  assert.equal(costState(cost({ requestId: "DNTT-1", requestStatus: -2 })), "cancelled");
  assert.deepEqual(["none", "draft", "pending", "rejected", "approved", "completed", "cancelled"].map(costGroup),
    ["unrequested", "processing", "processing", "processing", "paid", "paid", null]);
});

test("tổng tháng: chi phí (vận hành + phát sinh) tách khỏi tiền hàng, không cộng VND với USD, bỏ đề nghị đã hủy / khoản bị ẩn", () => {
  const summary = summarizeCosts([
    cost({ id: "1", amount: "1250000.00", requestId: "DNTT-1", requestStatus: 1 }),
    cost({ id: "2", amount: "0.10", requestId: "DNTT-2", requestStatus: 0, requestSent: true }),
    cost({ id: "3", amount: "0.20", kind: "incident", categoryName: "Kiểm hóa" }),
    cost({ id: "4", amount: "999.99", requestId: "DNTT-3", requestStatus: -2 }),
    cost({ id: "5", amount: "18500.50", currency: "USD", kind: "goods", code: "HD", categoryName: "Cọc hàng", requestId: "DNTT-4", requestStatus: 2 }),
    cost({ id: "6", amount: null, currency: "USD", kind: "goods", code: "HD", categoryName: "Thanh toán tiền còn lại" }),
  ]);
  assert.deepEqual(summary.costs, [{ currency: "VND", count: 3, total: "1250000.30", paid: "1250000.00", processing: "0.10", unrequested: "0.20" }]);
  assert.deepEqual(summary.goods, [{ currency: "USD", count: 1, total: "18500.50", paid: "18500.50", processing: "0.00", unrequested: "0.00" }]);
  assert.deepEqual(summary.byFee.map((fee) => [fee.kind, fee.name, fee.count, fee.total]), [
    ["operating", "Phí internet", 2, "1250000.10"],
    ["incident", "Kiểm hóa", 1, "0.20"],
    ["goods", "Cọc hàng", 1, "18500.50"],
  ]);
  assert.equal(summary.cancelledCount, 1);
  assert.equal(summary.hiddenCount, 1);
});

test("theo đề nghị: gom các khoản của tháng theo đề nghị (mới nhất trước) + phần chưa vào đề nghị", () => {
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

test("lô hàng / container: chi phí riêng + chi phí chung chia đều; tiền hàng chia đều; container lệch dữ liệu vẫn có", () => {
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
});

test("ngày tháng theo giờ Việt Nam, lùi / tiến qua năm", () => {
  assert.equal(currentMonth(new Date("2026-10-31T18:30:00Z")), "2026-11", "01:30 ngày 1/11 giờ VN");
  assert.equal(todayVn(new Date("2026-10-31T18:30:00Z")), "2026-11-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(isMonth("2026-10"), true);
  assert.equal(isMonth("2026-13"), false);
});
