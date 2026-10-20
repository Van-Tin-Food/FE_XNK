import assert from "node:assert/strict";
import test from "node:test";
import { addVat, amountForInput, amountToCents, formatAmount, formatMoney, parseAmountInput, parseAmountLoose, parseVatInput, splitVat, subtractAmounts, sumAmounts } from "../src/utils/paymentRequest.ts";

test("đọc số tiền khi chưa biết loại tiền: phân biệt dấu nghìn và phần lẻ", () => {
  assert.equal(parseAmountLoose("1.250.000"), "1250000");
  assert.equal(parseAmountLoose("1,250,000"), "1250000");
  assert.equal(parseAmountLoose("950000"), "950000");
  assert.equal(parseAmountLoose("18.500,50"), "18500.50");
  assert.equal(parseAmountLoose("18,500.50"), "18500.50");
  assert.equal(parseAmountLoose("18500,5"), "18500.5");
  assert.equal(parseAmountLoose("18500.25"), "18500.25");
  assert.equal(parseAmountLoose("1.250"), "1250", "nhóm 3 số sau dấu chấm là dấu nghìn");
  assert.equal(parseAmountLoose("0"), null);
  assert.equal(parseAmountLoose("1.2.3"), null);
  assert.equal(parseAmountLoose("12,345.678"), null);
  assert.equal(parseAmountLoose("abc"), null);
  assert.equal(formatAmount("1250000.00"), "1.250.000");
  assert.equal(formatAmount("18500.5"), "18.500,50");
  assert.equal(formatAmount("18500.5", "en"), "18,500.50");
});

test("đọc số tiền: VND bỏ dấu nghìn, USD có 2 số lẻ", () => {
  assert.equal(parseAmountInput("1.250.000", "VND"), "1250000");
  assert.equal(parseAmountInput("1,250,000", "VND"), "1250000");
  assert.equal(parseAmountInput(" 950000 ", "VND"), "950000");
  assert.equal(parseAmountInput("1250000.5", "VND"), null);
  assert.equal(parseAmountInput("18,500.50", "USD"), "18500.50");
  assert.equal(parseAmountInput("18500.5", "USD"), "18500.5");
  assert.equal(parseAmountInput("1.234", "USD"), null);
  assert.equal(parseAmountInput("0", "VND"), null);
  assert.equal(parseAmountInput("-5", "USD"), null);
  assert.equal(parseAmountInput("abc", "VND"), null);
  assert.equal(parseAmountInput("1".repeat(17), "VND"), null);
});

test("cộng tiền chính xác theo xu", () => {
  assert.equal(amountToCents("18500.5"), BigInt(1850050));
  assert.equal(sumAmounts(["0.1", "0.2"]), "0.30");
  assert.equal(sumAmounts(["1250000.00", "3800000", null, "bad"]), "5050000.00");
});

test("hiển thị tiền theo loại tiền và ngôn ngữ", () => {
  assert.equal(formatMoney("5050000.00", "VND"), "5.050.000 VND");
  assert.equal(formatMoney("18500.5", "USD"), "18.500,50 USD");
  assert.equal(formatMoney("18500.5", "USD", "en"), "18,500.50 USD");
  assert.equal(formatMoney("1250000", "VND", "en"), "1,250,000 VND");
  assert.equal(amountForInput("1250000.00", "VND"), "1250000");
  assert.equal(amountForInput("18500.50", "USD"), "18500.50");
  assert.equal(amountForInput("100.00", "USD"), "100");
});

test("VAT: số tiền đã gồm VAT tách ra trước thuế / VAT, tính ngược tổng từ trước thuế", () => {
  assert.deepEqual(splitVat("1080000", "8", "VND"), { base: "1000000.00", tax: "80000.00" });
  assert.deepEqual(splitVat("1080000", "8.5", "VND"), { base: "995392.00", tax: "84608.00" }, "VND làm tròn đồng");
  assert.deepEqual(splitVat("100", "10", "USD"), { base: "90.91", tax: "9.09" });
  assert.deepEqual(splitVat("500000", "", "VND"), { base: "500000.00", tax: "0.00" }, "không thuế");
  assert.equal(addVat("1000000", "8", "VND"), "1080000.00");
  assert.equal(addVat("90.91", "10", "USD"), "100.00");
  assert.equal(parseVatInput("8,5%"), "8.5");
  assert.equal(parseVatInput("0"), "0");
  assert.equal(parseVatInput("101"), null);
  assert.equal(parseVatInput(""), null);
});

test("cọc + còn lại: còn lại = tiền hàng - cọc, cọc vượt tiền hàng thì null", () => {
  assert.equal(subtractAmounts("40500.00", "12150"), "28350.00");
  assert.equal(subtractAmounts("100", "100.01"), null);
});
