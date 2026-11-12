import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVITY_GROUPS,
  activityActionLabel,
  activityActionQuery,
  activityGroupOf,
  activityPeriodRange,
  groupActivityByDay,
  relativeDay,
} from "../src/utils/activityLogCatalog.ts";

const t = (key) => key;

test("mỗi mã thao tác chỉ thuộc một nhóm", () => {
  const codes = ACTIVITY_GROUPS.flatMap((group) => group.actions.map(([code]) => code));
  assert.equal(new Set(codes).size, codes.length);
  // Các mã BE ghi trước đây chưa có nhãn nay đã có nhóm riêng.
  assert.equal(activityGroupOf("USER_SIGNATURE_UPDATE"), "account");
  assert.equal(activityGroupOf("bank_transaction_link"), "cost");
  assert.equal(activityGroupOf("PAYMENT_REQUEST_PAID"), "payment");
  assert.equal(activityGroupOf("PAYMENT_CATEGORY_CREATE"), "masterData");
});

test("mã lạ: nhóm Khác, nhãn giữ nguyên mã", () => {
  assert.equal(activityGroupOf("SOMETHING_NEW"), "other");
  assert.equal(activityActionLabel("SOMETHING_NEW", t), "SOMETHING_NEW");
  assert.equal(activityActionLabel("", t), "unknown");
  assert.equal(activityActionLabel("login", t), "logLogin");
});

test("lọc: thao tác cụ thể ưu tiên hơn nhóm; chỉ chọn nhóm thì gửi mọi mã của nhóm", () => {
  assert.deepEqual(activityActionQuery("", ""), {});
  assert.deepEqual(activityActionQuery("payment", "PAYMENT_REQUEST_APPROVE"), { action: "PAYMENT_REQUEST_APPROVE" });
  assert.deepEqual(activityActionQuery("auth", ""), { actions: ["LOGIN", "LOGIN_GOOGLE", "LOGIN_FAILED", "LOGOUT"] });
});

test("khoảng thời gian nhanh tính theo ngày, cả hai đầu", () => {
  const now = new Date(2026, 10, 12, 9, 30);
  assert.deepEqual(activityPeriodRange("all", undefined, now), { from: "", to: "" });
  assert.deepEqual(activityPeriodRange("today", undefined, now), { from: "2026-11-12", to: "2026-11-12" });
  assert.deepEqual(activityPeriodRange("yesterday", undefined, now), { from: "2026-11-11", to: "2026-11-11" });
  assert.deepEqual(activityPeriodRange("last7", undefined, now), { from: "2026-11-06", to: "2026-11-12" });
  assert.deepEqual(activityPeriodRange("last30", undefined, new Date(2026, 2, 1)), { from: "2026-01-31", to: "2026-03-01" });
  assert.deepEqual(activityPeriodRange("custom", { from: "2026-10-01", to: "" }, now), { from: "2026-10-01", to: "" });
});

test("gom theo ngày giữ thứ tự, hôm nay / hôm qua", () => {
  const logs = [
    { id: 1, createdAt: "2026-11-12 10:00:00" },
    { id: 2, createdAt: "2026-11-12 08:00:00.123456" },
    { id: 3, createdAt: "2026-11-11 23:59:00" },
    { id: 4, createdAt: "" },
  ];
  assert.deepEqual(groupActivityByDay(logs).map((group) => [group.day, group.items.map((log) => log.id)]), [
    ["2026-11-12", [1, 2]],
    ["2026-11-11", [3]],
    ["", [4]],
  ]);
  const now = new Date(2026, 10, 12, 9);
  assert.equal(relativeDay("2026-11-12", now), "today");
  assert.equal(relativeDay("2026-11-11", now), "yesterday");
  assert.equal(relativeDay("2026-11-01", now), "");
  assert.equal(relativeDay("", now), "");
});
