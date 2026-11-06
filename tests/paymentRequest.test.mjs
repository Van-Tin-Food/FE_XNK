import assert from "node:assert/strict";
import test from "node:test";
import { addVat, amountForInput, amountToCents, containerRepairOf, formatAmount, formatAmountTyping, formatMoney, parseAmountInput, parseAmountLoose, parseSignedAmount, parseVatInput, splitVat, subtractAmounts, sumAmounts } from "../src/utils/paymentRequest.ts";

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
  assert.equal(amountForInput("1250000.00"), "1250000");
  assert.equal(amountForInput("18500.50"), "18500.50");
  assert.equal(amountForInput("100.00"), "100");
});

test("VAT: số tiền đã gồm VAT tách ra trước thuế / VAT, tính ngược tổng từ trước thuế", () => {
  assert.deepEqual(splitVat("1080000", "8", "VND"), { base: "1000000.00", tax: "80000.00" });
  assert.deepEqual(splitVat("1080000", "8.5", "VND"), { base: "995392.00", tax: "84608.00" }, "VND làm tròn đồng");
  assert.deepEqual(splitVat("100", "10", "USD"), { base: "90.91", tax: "9.09" });
  assert.deepEqual(splitVat("500000", "", "VND"), { base: "500000.00", tax: "0.00" }, "không thuế");
  assert.equal(addVat("1000000", "8", "VND"), "1080000.00");
  assert.equal(addVat("2721070", "8", "VND"), "2938755.60", "VND giữ phần lẻ, không làm tròn đồng");
  assert.equal(
    sumAmounts(Array.from({ length: 9 }, () => addVat("2721070", "8", "VND"))),
    "26448800.40",
    "9 khoản cộng lại khớp tổng trước thuế × 1,08",
  );
  assert.deepEqual(splitVat("2938755.60", "8", "VND"), { base: "2721070.00", tax: "217685.60" }, "tách lại đúng trước thuế");
  assert.equal(amountForInput("2938755.60"), "2938755.60", "sửa lại không mất phần lẻ");
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

test("chỉ tổng đề nghị VND làm tròn đến đồng (nửa lên), từng khoản giữ phần lẻ", async () => {
  const { roundRequestTotal } = await import("../src/utils/paymentRequest.ts");
  assert.equal(roundRequestTotal(sumAmounts(Array.from({ length: 9 }, () => addVat("2721070", "8", "VND"))), "VND"), "26448800.00");
  assert.equal(roundRequestTotal("26448800.40", "VND"), "26448800.00");
  assert.equal(roundRequestTotal("26448800.50", "VND"), "26448801.00", "nửa lên");
  assert.equal(roundRequestTotal("18500.55", "USD"), "18500.55", "USD giữ 2 chữ số lẻ");
  assert.equal(roundRequestTotal("100.40", ""), "100.40", "chưa chọn loại tiền thì giữ nguyên");
});

test("phí sửa cont: số hoàn được âm / 0; phí sửa = tiền cược − số hoàn; hoàn âm = vượt cược", () => {
  assert.equal(parseSignedAmount("-5.000.000"), "-5000000");
  assert.equal(parseSignedAmount("−1,5"), "-1.5");
  assert.equal(parseSignedAmount("3.000.000"), "3000000");
  assert.equal(parseSignedAmount("0"), "0");
  assert.equal(parseSignedAmount("0,00"), "0");
  assert.equal(parseSignedAmount("-"), null);
  assert.equal(parseSignedAmount("abc"), null);
  assert.deepEqual(containerRepairOf("10000000.00", "3000000"), { repair: "7000000.00", excess: "0.00", refundTooHigh: false });
  assert.deepEqual(containerRepairOf("10000000.00", "-5000000"), { repair: "15000000.00", excess: "5000000.00", refundTooHigh: false });
  assert.deepEqual(containerRepairOf("10000000.00", "10000000"), { repair: "0.00", excess: "0.00", refundTooHigh: false });
  assert.deepEqual(containerRepairOf("10000000.00", "0"), { repair: "10000000.00", excess: "0.00", refundTooHigh: false });
  assert.equal(containerRepairOf("10000000.00", "10000000.01").refundTooHigh, true);
});

test("ô số tiền tự chia nhóm nghìn khi gõ, đọc lại đúng bằng parseAmountLoose", () => {
  // Gõ từng chữ số từ ô trống.
  let text = "";
  for (const digit of "192802100") text = formatAmountTyping(text + digit, text).text;
  assert.equal(text, "192.802.100");
  assert.equal(parseAmountLoose(text), "192802100");
  // Gõ "." hoặc "," = bắt đầu phần lẻ (tối đa 2 số); gõ thêm dấu nữa thì bỏ qua.
  assert.equal(formatAmountTyping("18.500.", "18.500").text, "18.500,");
  assert.equal(formatAmountTyping("18.500,", "18.500").text, "18.500,");
  assert.equal(formatAmountTyping("18.500,5", "18.500,").text, "18.500,5");
  assert.equal(formatAmountTyping("18.500,505", "18.500,50").text, "18.500,50");
  assert.equal(formatAmountTyping("18.500,5.", "18.500,5").text, "18.500,5");
  assert.equal(parseAmountLoose("18.500,5"), "18500.5");
  assert.equal(formatAmountTyping(",", "").text, "0,");
  assert.equal(formatAmountTyping("0,5", "0,").text, "0,5");
  // Xóa: dấu chấm luôn là dấu nghìn, chia lại nhóm.
  assert.equal(formatAmountTyping("1.23", "1.234").text, "123");
  assert.equal(formatAmountTyping("12.345", "123.456").text, "12.345");
  assert.equal(formatAmountTyping("", "1").text, "");
  // Chữ / khoảng trắng bị bỏ; số 0 đầu bị bỏ.
  assert.equal(formatAmountTyping("1.234a", "1.234").text, "1.234");
  assert.equal(formatAmountTyping("007", "00").text, "7");
  // Dán cả chuỗi: hiểu như parseAmountLoose.
  assert.equal(formatAmountTyping("18,500.50", "").text, "18.500,50");
  assert.equal(formatAmountTyping("1.250.000", "").text, "1.250.000");
  assert.equal(formatAmountTyping("192802100", "").text, "192.802.100");
  // Con trỏ: sửa giữa số không nhảy về cuối.
  assert.deepEqual(formatAmountTyping("1.2345", "1.234", 6), { text: "12.345", caret: 6 });
  assert.deepEqual(formatAmountTyping("1952.802.100", "192.802.100", 3), { text: "1.952.802.100", caret: 4 }, "chèn 5 sau 19: con trỏ ngay sau 5");
  assert.deepEqual(formatAmountTyping("1.0234", "1.234", 3), { text: "10.234", caret: 2 });
  assert.deepEqual(formatAmountTyping("1.34", "1.234", 2), { text: "134", caret: 1 });
  assert.deepEqual(formatAmountTyping("1.234.", "1.234", 6), { text: "1.234,", caret: 6 });
});
