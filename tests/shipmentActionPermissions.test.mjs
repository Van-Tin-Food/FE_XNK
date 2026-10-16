import test from "node:test";
import assert from "node:assert/strict";
import {
  canUploadDocumentType,
  completePermissions,
  diffFromStandard,
  effectivePermissions,
  hasPermission,
  normalizePermissionMap,
  PERMISSION_FUNCTION_KEYS,
  PERMISSION_FUNCTIONS,
  PERMISSION_GROUPS,
} from "../src/config/shipmentActionPermissions.ts";

// Quyền thực tế do BE trả về (user.permissions); FE chỉ đọc, không suy quyền từ tên role.
const user = (role, permissions = {}) => ({ username: role, name: role, role, permissions });

// Danh mục phải giống PERMISSION_FUNCTIONS trong be/src/config/rbac.js. Thêm / đổi chức năng thì sửa cả hai bên.
const EXPECTED_FUNCTIONS = {
  shipments: ["none", "view", "edit"],
  shipmentCancel: ["none", "edit"],
  documents: ["none", "view", "edit"],
  documentArchive: ["none", "edit"],
  containerTransport: ["none", "view", "edit"],
  tracking: ["none", "view"],
  exportShipments: ["none", "view"],
  purchaseAmounts: ["none", "view"],
  supplierContact: ["none", "view"],
  aiChat: ["none", "view"],
  masterData: ["none", "view", "edit"],
  documentSync: ["none", "view", "edit"],
  email: ["none", "view", "edit"],
  activityLogs: ["none", "view"],
  users: ["none", "view", "edit"],
  userGuide: ["none", "view"],
};

test("danh mục chức năng khớp với BE", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(PERMISSION_FUNCTIONS)), EXPECTED_FUNCTIONS);
});

test("mọi chức năng nằm trong đúng một nhóm hiển thị", () => {
  const grouped = PERMISSION_GROUPS.flatMap((group) => group.functions);
  assert.deepEqual([...grouped].sort(), [...PERMISSION_FUNCTION_KEYS].sort());
  assert.equal(new Set(grouped).size, grouped.length);
});

test("edit bao gồm view; thiếu chức năng = none", () => {
  const thinh = user("logistic", { shipments: "edit", documents: "view" });
  assert.equal(hasPermission(thinh, "shipments", "view"), true);
  assert.equal(hasPermission(thinh, "shipments", "edit"), true);
  assert.equal(hasPermission(thinh, "documents", "edit"), false);
  assert.equal(hasPermission(thinh, "users"), false);
  assert.equal(hasPermission(null, "shipments"), false);
});

test("admin luôn toàn quyền, không phụ thuộc permissions", () => {
  for (const fn of PERMISSION_FUNCTION_KEYS) assert.equal(hasPermission(user("admin"), fn, "edit"), true, fn);
});

test("không suy quyền từ tên role: role nào cũng chỉ có quyền BE trả về", () => {
  assert.equal(hasPermission(user("logistic"), "shipments"), false);
  assert.equal(hasPermission(user("van_chuyen", { shipments: "edit" }), "shipments", "edit"), true);
});

test("upload PI theo quyền sửa Đơn hàng, chứng từ khác theo quyền sửa Chứng từ", () => {
  const logistic = user("logistic", { shipments: "edit", documents: "edit" });
  const transport = user("van_chuyen", { shipments: "view", documents: "edit" });
  for (const code of ["PI", "INV", "PKL", "BL", "CO", "TRA_CONT", "INSPECTION"]) {
    assert.equal(canUploadDocumentType(logistic, code), true, `logistic ${code}`);
    assert.equal(canUploadDocumentType(transport, code), code !== "PI", `van_chuyen ${code}`);
  }
  assert.equal(canUploadDocumentType(user("logistic", { shipments: "edit", documents: "view" }), "BL"), false);
  assert.equal(canUploadDocumentType(user("logistic", { shipments: "edit", documents: "view" }), "pi"), true);
});

test("đọc quyền từ API: bỏ chức năng lạ và mức không hợp lệ", () => {
  assert.deepEqual(
    normalizePermissionMap({ shipments: "EDIT", tracking: "edit", hack: "edit", documents: "view" }),
    { shipments: "edit", documents: "view" },
  );
  assert.deepEqual(normalizePermissionMap(null), {});
  assert.deepEqual(normalizePermissionMap(["edit"]), {});
});

test("quyền thực tế = chuẩn role ghi đè bằng tùy chỉnh; tùy chỉnh chỉ giữ dòng khác chuẩn", () => {
  const standard = { shipments: "edit", documents: "edit", tracking: "view" };
  const effective = effectivePermissions("logistic", standard, { shipments: "view" });
  assert.equal(effective.shipments, "view");
  assert.equal(effective.documents, "edit");
  assert.equal(effective.users, "none");
  assert.equal(effectivePermissions("admin", {}, { users: "none" }).users, "edit");
  assert.deepEqual(diffFromStandard(standard, { shipments: "edit", documents: "view", users: "none" }), { documents: "view" });
  assert.deepEqual(Object.keys(completePermissions({})).sort(), [...PERMISSION_FUNCTION_KEYS].sort());
});
