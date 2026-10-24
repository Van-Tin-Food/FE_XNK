import assert from "node:assert/strict";
import test from "node:test";
import {
  changePercent, costGroup, costState, currentMonth, isMonth, kindTotal, rankContracts, shiftDate, shiftMonth, summarizeCosts,
  summarizePayables, todayVn, topIncidents, trendMatrix, trendMonths,
} from "../src/utils/costStatistics.ts";

const cost = (overrides) => ({
  id: "c", createdAt: "2026-10-05T03:00:00Z", basisDate: "2026-10-05T03:00:00Z", contract: "", container: "", amount: "100.00", vat: "", note: "",
  type: "van_hanh", code: "VH", categoryName: "Phí internet", flow: "xanh", userName: "A",
  requestId: "", requestStatus: null, requestSent: false, currency: "VND", currencyInferred: true, kind: "operating",
  ...overrides,
});
const request = (overrides) => ({
  id: "DNTT-1", content: "", currency: "VND", total: "100.00", dueDate: "", status: 0, sent: true, createdAt: "2026-10-01T00:00:00Z",
  approvedAt: "", requester: "A", hasRed: false, hasGoods: false, ...overrides,
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

test("tổng: tách nhóm vận hành / phát sinh / tiền hàng, không cộng VND với USD, bỏ đề nghị đã hủy và khoản bị ẩn", () => {
  const summary = summarizeCosts([
    cost({ id: "1", amount: "1250000.00", requestId: "DNTT-1", requestStatus: 1 }),
    cost({ id: "2", amount: "0.10", requestId: "DNTT-2", requestStatus: 0, requestSent: true }),
    cost({ id: "3", amount: "0.20", kind: "incident", type: "phat_sinh", categoryName: "Kiểm hóa" }),
    cost({ id: "4", amount: "999.99", requestId: "DNTT-3", requestStatus: -2 }),
    cost({ id: "5", amount: "18500.50", currency: "USD", kind: "goods", type: "mua_hang", code: "HD", categoryName: "Cọc hàng", requestId: "DNTT-4", requestStatus: 2 }),
    cost({ id: "6", amount: null, currency: "USD", kind: "goods", type: "mua_hang", code: "HD", categoryName: "Thanh toán tiền còn lại" }),
  ]);
  assert.deepEqual(summary.currencies, [
    { currency: "VND", count: 3, total: "1250000.30", paid: "1250000.00", processing: "0.10", unrequested: "0.20" },
    { currency: "USD", count: 1, total: "18500.50", paid: "18500.50", processing: "0.00", unrequested: "0.00" },
  ]);
  assert.deepEqual(summary.byKind.map((item) => [item.kind, item.currency, item.total]), [
    ["operating", "VND", "1250000.10"],
    ["incident", "VND", "0.20"],
    ["goods", "USD", "18500.50"],
  ]);
  assert.equal(kindTotal(summary, "goods", "VND").total, "0.00", "không có thì 0");
  assert.equal(summary.cancelledCount, 1);
  assert.equal(summary.hiddenCount, 1);
});

test("xu hướng: ma trận tháng × nhóm cho một loại tiền; so tháng trước theo %", () => {
  const months = trendMonths("2026-02", 6);
  assert.deepEqual(months, ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
  const matrix = trendMatrix([
    { month: "2026-01", kind: "operating", currency: "VND", count: 1, amount: "1000.00" },
    { month: "2026-02", kind: "operating", currency: "VND", count: 1, amount: "1250.00" },
    { month: "2026-02", kind: "goods", currency: "USD", count: 1, amount: "9.00" },
    { month: "2026-02", kind: "goods", currency: "VND", count: 1, amount: null },
    { month: "2024-01", kind: "operating", currency: "VND", count: 1, amount: "5.00" },
  ], months, "VND");
  assert.equal(matrix["2026-02"].operating, BigInt(125000));
  assert.equal(matrix["2026-02"].goods, BigInt(0), "USD và số bị ẩn không vào bảng VND");
  assert.equal(changePercent(matrix["2026-02"].operating, matrix["2026-01"].operating), 25);
  assert.equal(changePercent(BigInt(500), BigInt(1000)), -50);
  assert.equal(changePercent(BigInt(500), BigInt(0)), null, "tháng trước = 0 thì không so");
});

test("đề nghị đang mở: quá hạn / đến hạn trong 7 ngày / chờ duyệt / đã duyệt, tổng theo loại tiền", () => {
  const summary = summarizePayables([
    request({ id: "A", dueDate: "2026-10-20", total: "100.00" }),
    request({ id: "B", dueDate: "2026-10-24", status: 1, total: "50.00" }),
    request({ id: "C", dueDate: "2026-10-31", status: 1, currency: "USD", total: "10.00" }),
    request({ id: "D", dueDate: "2026-11-15", total: null, hasGoods: true }),
    request({ id: "E", dueDate: "", total: "1.00" }),
  ], "2026-10-24");
  assert.deepEqual(summary.overdue.requests.map((item) => item.id), ["A"]);
  assert.deepEqual(summary.dueSoon.requests.map((item) => item.id), ["B", "C"], "kể cả hôm nay và đúng ngày thứ 7");
  assert.deepEqual(summary.pending.requests.map((item) => item.id), ["A", "D", "E"]);
  assert.deepEqual(summary.approved.requests.map((item) => item.id), ["B", "C"]);
  assert.deepEqual(summary.all.totals, [{ currency: "VND", total: "151.00" }, { currency: "USD", total: "10.00" }], "bị ẩn thì không cộng");
});

test("theo hợp đồng: chỉ vận hành + phát sinh, bình quân mỗi container; phát sinh lớn nhất", () => {
  const costs = [
    cost({ id: "1", contract: "26010", amount: "900.00" }),
    cost({ id: "2", contract: "26010", amount: "300.00", kind: "incident" }),
    cost({ id: "3", contract: "26010", amount: "5000.00", kind: "goods", currency: "USD" }),
    cost({ id: "4", contract: "26011", amount: "2000.00" }),
    cost({ id: "5", contract: "26011", amount: "777.00", requestId: "DNTT-9", requestStatus: -2 }),
    cost({ id: "6", amount: "50.00", kind: "incident" }),
  ];
  assert.deepEqual(rankContracts(costs, [{ contract: "26010", supplier: "NCC A", containers: 4 }]).map((item) => [item.contract, item.total, item.containers, item.perContainer, item.supplier]), [
    ["26011", "2000.00", 0, null, ""],
    ["26010", "1200.00", 4, "300.00", "NCC A"],
  ]);
  assert.deepEqual(topIncidents(costs).map((item) => item.id), ["2", "6"]);
});

test("ngày tháng: hôm nay / tháng hiện tại theo giờ Việt Nam, lùi / tiến qua năm", () => {
  assert.equal(currentMonth(new Date("2026-10-31T18:30:00Z")), "2026-11", "01:30 ngày 1/11 giờ VN");
  assert.equal(todayVn(new Date("2026-10-31T18:30:00Z")), "2026-11-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftDate("2026-12-28", 7), "2027-01-04");
  assert.equal(isMonth("2026-10"), true);
  assert.equal(isMonth("2026-13"), false);
});
