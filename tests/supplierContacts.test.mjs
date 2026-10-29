import assert from "node:assert/strict";
import test from "node:test";
import { findSupplierContactError, formatSupplierContact, supplierContacts } from "../src/utils/supplierContacts.ts";

test("supplierContacts: bỏ khoảng trắng, bỏ dòng trống, chịu được giá trị hỏng", () => {
  assert.deepEqual(supplierContacts([
    { ten_nguoi_lien_he: " Ana ", email: " a@x.es ", so_dien_thoai: "" },
    { ten_nguoi_lien_he: "", email: "", so_dien_thoai: " " },
    null,
    "hỏng",
  ]), [{ ten_nguoi_lien_he: "Ana", email: "a@x.es", so_dien_thoai: null }]);
  assert.deepEqual(supplierContacts(null), []);
  assert.deepEqual(supplierContacts("[]"), []);
});

test("formatSupplierContact: tên · email · SĐT, bỏ phần trống", () => {
  assert.equal(formatSupplierContact({ ten_nguoi_lien_he: "Ana", email: "a@x.es", so_dien_thoai: "+34" }), "Ana · a@x.es · +34");
  assert.equal(formatSupplierContact({ email: "b@x.es" }), "b@x.es");
});

test("findSupplierContactError: thiếu cả email lẫn SĐT, email sai; dòng trống bỏ qua", () => {
  assert.equal(findSupplierContactError([{ ten_nguoi_lien_he: "", email: "", so_dien_thoai: "" }, { email: "a@x.es" }]), null);
  assert.deepEqual(findSupplierContactError([{ email: "a@x.es" }, { ten_nguoi_lien_he: "Bo" }]), { index: 1, reason: "missing" });
  assert.deepEqual(findSupplierContactError([{ email: "sai", so_dien_thoai: "+1" }]), { index: 0, reason: "email" });
});
