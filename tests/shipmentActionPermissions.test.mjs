import test from "node:test";
import assert from "node:assert/strict";
import {
  canPerformShipmentAction,
  canUploadDocumentType,
  SHIPMENT_ACTION_PERMISSIONS,
} from "../src/config/shipmentActionPermissions.ts";

const user = (role, session) => ({ username: role, name: role, role, session });

// Ma trận quyền giao diện mong đợi. Sửa quyền trong shipmentActionPermissions.ts thì cập nhật bảng này.
const EXPECTED = {
  "it/manage": ["viewActivityLogs", "viewUsers", "viewMasterData", "viewEmailLogs", "viewEmailTools", "viewDocumentSync", "viewTracking", "useAiChat"],
  "logistic/manage": ["viewTracking", "exportShipments", "viewPurchaseAmounts", "useAiChat", "createShipment", "uploadDocument", "passDocument", "editShipmentDetails", "cancelShipment", "syncDocuments", "manageMasterData"],
  "logistic/view": ["viewTracking", "exportShipments", "viewPurchaseAmounts", "useAiChat"],
  "van_chuyen/manage": ["viewTracking", "exportShipments", "useAiChat", "uploadDocument", "passDocument", "archiveDocuments", "editReturnItem", "syncDocuments", "manageMasterData"],
  "van_chuyen/view": ["viewTracking", "exportShipments", "useAiChat"],
};
EXPECTED["it/view"] = EXPECTED["it/manage"];

const ALL_ACTIONS = Object.keys(SHIPMENT_ACTION_PERMISSIONS);

for (const [key, allowed] of Object.entries(EXPECTED)) {
  test(`${key} has exactly the expected actions`, () => {
    const [role, session] = key.split("/");
    const actual = ALL_ACTIONS.filter((action) => canPerformShipmentAction(user(role, session), action)).sort();
    assert.deepEqual(actual, [...allowed].sort());
  });
}

test("admin can perform every action", () => {
  for (const action of ALL_ACTIONS) assert.equal(canPerformShipmentAction(user("admin", "view"), action), true, action);
});

test("unknown roles get nothing", () => {
  for (const role of ["mua_hang", "nhap_kho", ""]) {
    assert.deepEqual(ALL_ACTIONS.filter((action) => canPerformShipmentAction(user(role, "manage"), action)), [], role);
  }
});

test("export Excel is available to logistic and van_chuyen in both sessions", () => {
  for (const role of ["logistic", "van_chuyen"]) {
    for (const session of ["manage", "view"]) {
      assert.equal(canPerformShipmentAction(user(role, session), "exportShipments"), true, `${role}/${session}`);
    }
  }
  assert.equal(canPerformShipmentAction(user("it", "manage"), "exportShipments"), false);
});

test("purchase amounts: admin and logistic; supplier contact: admin only", () => {
  for (const [role, amounts] of [["admin", true], ["logistic", true], ["van_chuyen", false], ["it", false]]) {
    assert.equal(canPerformShipmentAction(user(role, "view"), "viewPurchaseAmounts"), amounts, role);
    assert.equal(canPerformShipmentAction(user(role, "manage"), "viewSupplierContact"), role === "admin", role);
  }
});

test("logistic uploads every document; van_chuyen every document except PI", () => {
  const logistic = user("logistic", "manage");
  const transport = user("van_chuyen", "manage");
  for (const code of ["PI", "INV", "PKL", "BL", "CO", "TRA_CONT", "INSPECTION"]) {
    assert.equal(canUploadDocumentType(logistic, code), true, `logistic ${code}`);
    assert.equal(canUploadDocumentType(transport, code), code !== "PI", `van_chuyen ${code}`);
  }
  assert.equal(canUploadDocumentType(user("logistic", "view"), "BL"), false);
});
