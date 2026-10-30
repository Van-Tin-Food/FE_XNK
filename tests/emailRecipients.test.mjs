import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_EMAIL_FILTERS,
  countryOptions,
  filterEmailSuppliers,
  groupSelectionState,
  hasActiveEmailFilters,
  normalizeSearchText,
  toggleRecipientGroup,
} from "../src/utils/emailRecipients.ts";

// Như recipientsOf ở trang Email: mỗi người liên hệ có email là một người nhận.
const recipientsOf = (supplier) => supplier.lien_he
  .filter((contact) => contact.email)
  .map((contact, index) => ({
    key: `${supplier.id_ncc}#${index}`,
    supplierId: supplier.id_ncc,
    supplierName: supplier.ten_ncc,
    contactName: contact.ten_nguoi_lien_he || "",
    email: contact.email,
  }));

const suppliers = [
  { id_ncc: "S1", ten_ncc: "Alpha Foods", quoc_gia: "Brazil", lien_he: [{ ten_nguoi_lien_he: "Ana", email: "ana@alpha.com" }, { ten_nguoi_lien_he: "Bruno", email: "bruno@alpha.com" }] },
  { id_ncc: "S2", ten_ncc: "Beta Meat", quoc_gia: "brazil ", lien_he: [{ ten_nguoi_lien_he: "Carl", email: "carl@beta.com" }] },
  { id_ncc: "S3", ten_ncc: "Thịt Việt", quoc_gia: "Việt Nam", lien_he: [{ ten_nguoi_lien_he: "Dũng", so_dien_thoai: "+84" }] },
  { id_ncc: "S4", ten_ncc: "Gamma", quoc_gia: "Spain", lien_he: [{ ten_nguoi_lien_he: "Eva", email: "eva@gamma.es" }] },
];
const bySupplier = new Map(suppliers.map((supplier) => [supplier.id_ncc, recipientsOf(supplier)]));
const now = Date.parse("2026-10-30T10:00:00Z");
const context = (overrides = {}) => ({ lastSent: new Map(), selectedKeys: new Set(), now, ...overrides });
const ids = (rows) => rows.map((row) => row.supplier.id_ncc);
const filter = (filters, ctx = context()) => filterEmailSuppliers(suppliers, bySupplier, { ...DEFAULT_EMAIL_FILTERS, ...filters }, ctx);

test("countryOptions + lọc quốc gia: không phân biệt hoa/thường, dấu, khoảng trắng", () => {
  assert.deepEqual(countryOptions(suppliers), ["Brazil", "Spain", "Việt Nam"]);
  assert.deepEqual(ids(filter({ country: "Brazil" })), ["S1", "S2"]);
  assert.deepEqual(ids(filter({ country: "viet nam" })), ["S3"]);
});

test("tìm kiếm: tên NCC khớp thì hiện mọi email, khớp người liên hệ thì chỉ hiện người đó; không dấu vẫn tìm được", () => {
  assert.deepEqual(filter({ query: "alpha" })[0].recipients.length, 2);
  const byContact = filter({ query: "bruno" });
  assert.deepEqual(ids(byContact), ["S1"]);
  assert.deepEqual(byContact[0].recipients.map((r) => r.email), ["bruno@alpha.com"]);
  assert.equal(byContact[0].totalRecipients, 2);
  assert.deepEqual(ids(filter({ query: "thit viet" })), ["S3"]);
  assert.deepEqual(ids(filter({ query: "spain" })), ["S4"]);
  assert.equal(normalizeSearchText(" Đà Nẵng "), "da nang");
});

test("lọc có / chưa có email", () => {
  assert.deepEqual(ids(filter({ contact: "withEmail" })), ["S1", "S2", "S4"]);
  assert.deepEqual(ids(filter({ contact: "withoutEmail" })), ["S3"]);
});

test("lọc lịch sử gửi theo từng email", () => {
  const lastSent = new Map([
    ["ana@alpha.com", "2026-10-29T10:00:00Z"], // 1 ngày trước
    ["carl@beta.com", "2026-10-10T10:00:00Z"], // 20 ngày trước
    ["eva@gamma.es", "2026-08-01T10:00:00Z"], // > 30 ngày
  ]);
  const ctx = context({ lastSent });
  assert.deepEqual(filter({ history: "never" }, ctx).map((row) => row.recipients.map((r) => r.email)), [["bruno@alpha.com"]]);
  assert.deepEqual(ids(filter({ history: "within7" }, ctx)), ["S1"]);
  assert.deepEqual(filter({ history: "notWithin7" }, ctx).flatMap((row) => row.recipients.map((r) => r.email)), ["bruno@alpha.com", "carl@beta.com", "eva@gamma.es"]);
  assert.deepEqual(filter({ history: "notWithin30" }, ctx).flatMap((row) => row.recipients.map((r) => r.email)), ["bruno@alpha.com", "eva@gamma.es"]);
});

test("lọc đang chọn / chưa chọn", () => {
  const ctx = context({ selectedKeys: new Set(["S1#1", "S4#0"]) });
  assert.deepEqual(filter({ selection: "selected" }, ctx).flatMap((row) => row.recipients.map((r) => r.key)), ["S1#1", "S4#0"]);
  assert.deepEqual(filter({ selection: "unselected" }, ctx).flatMap((row) => row.recipients.map((r) => r.key)), ["S1#0", "S2#0"]);
  assert.equal(hasActiveEmailFilters(DEFAULT_EMAIL_FILTERS), false);
  assert.equal(hasActiveEmailFilters({ ...DEFAULT_EMAIL_FILTERS, selection: "selected" }), true);
});

test("toggleRecipientGroup: chọn đúng nhóm đang hiện (không nhảy về trang 1), giới hạn 15, bỏ chọn khi đã chọn hết", () => {
  const page3 = ["P3#0", "P3#1"];
  assert.deepEqual(toggleRecipientGroup(["P1#0"], page3), { next: ["P1#0", "P3#0", "P3#1"], skipped: 0 });
  assert.deepEqual(toggleRecipientGroup(["P1#0", "P3#0", "P3#1"], page3), { next: ["P1#0"], skipped: 0 });
  // Chọn dở thì bấm là thêm phần thiếu.
  assert.deepEqual(toggleRecipientGroup(["P3#1"], page3), { next: ["P3#1", "P3#0"], skipped: 0 });
  // Vượt giới hạn: chỉ thêm phần còn chỗ.
  assert.deepEqual(toggleRecipientGroup(["a", "b"], ["c", "d", "e"], 3), { next: ["a", "b", "c"], skipped: 2 });
  assert.deepEqual(toggleRecipientGroup(["a"], [], 3), { next: ["a"], skipped: 0 });
});

test("groupSelectionState", () => {
  assert.equal(groupSelectionState(new Set(), []), "none");
  assert.equal(groupSelectionState(new Set(["a"]), ["a", "b"]), "some");
  assert.equal(groupSelectionState(new Set(["a", "b"]), ["a", "b"]), "all");
});
