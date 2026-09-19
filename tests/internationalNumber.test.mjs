import assert from "node:assert/strict";
import test from "node:test";
import { formatInternationalNumber, parseInternationalNumber, toDatabaseNumber } from "../src/utils/internationalNumber.ts";

test("dot is the decimal separator and comma groups thousands", () => {
  assert.equal(parseInternationalNumber("1,234.56"), 1234.56);
  assert.equal(parseInternationalNumber("1234.56 USD"), 1234.56);
  assert.equal(parseInternationalNumber("2.592"), 2.592);
  assert.equal(parseInternationalNumber("1.234,56"), null);
});

test("formats UI in international notation", () => {
  assert.equal(formatInternationalNumber(1234.56), "1,234.56");
  assert.equal(formatInternationalNumber("2500.000"), "2,500");
});

test("database payload contains a number without a currency suffix", () => {
  const payload = { don_gia: toDatabaseNumber("1,234.56 USD") };
  assert.deepEqual(payload, { don_gia: 1234.56 });
  assert.equal(JSON.stringify(payload).includes("USD"), false);
});
