import assert from "node:assert/strict";
import test from "node:test";
import {
  formatInternationalNumber,
  formatMoneyAmount,
  formatNetWeight,
  formatPackageCount,
  parseInternationalNumber,
  toDatabaseNumber,
  toDatabasePackageCount,
} from "../src/utils/internationalNumber.ts";

test("dot is the decimal separator and commas are tolerated from old input", () => {
  assert.equal(parseInternationalNumber("1,234.56"), 1234.56);
  assert.equal(parseInternationalNumber("1234.56 USD"), 1234.56);
  assert.equal(parseInternationalNumber("2.592"), 2.592);
  assert.equal(parseInternationalNumber("1.234,56"), null);
});

test("formats UI without thousands separators", () => {
  assert.equal(formatInternationalNumber(1234.56), "1234.56");
  assert.equal(formatNetWeight("25920"), "25920.00");
  assert.equal(formatNetWeight("25920.5"), "25920.50");
  assert.equal(formatMoneyAmount("25920.5 USD"), "25920.50 USD");
  assert.equal(formatPackageCount("1377"), "1377");
  assert.equal(formatPackageCount("1.377"), "1377");
});

test("database payload contains a number without a currency suffix", () => {
  const payload = { don_gia: toDatabaseNumber("1,234.56 USD") };
  assert.deepEqual(payload, { don_gia: 1234.56 });
  assert.equal(JSON.stringify(payload).includes("USD"), false);
  assert.equal(toDatabasePackageCount("1377"), 1377);
});
