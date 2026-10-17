import assert from "node:assert/strict";
import test from "node:test";
import { activityDetailLines, activityLocationParts } from "../src/utils/activityLogFormat.ts";

// t giả: trả lại chính key để kiểm tra đúng nhãn được chọn.
const t = (key) => key;

test("vị trí: mã màn hình đổi thành đường dẫn dễ đọc", () => {
  assert.deepEqual(activityLocationParts("ShipmentDetailModal/Documents/CO", t), ["locHome", "locOrderDetail", "locDocuments", "CO"]);
  assert.deepEqual(activityLocationParts("ShipmentDetailModal/Details", t), ["locHome", "locOrderDetail", "locOrderInfo"]);
  assert.deepEqual(activityLocationParts("ShipmentDetailModal/ReturnItem", t), ["locHome", "locOrderDetail", "locTransport"]);
  assert.deepEqual(activityLocationParts("ShipmentDashboard/CreateShipmentModal", t), ["locHome", "locCreateShipment"]);
  assert.deepEqual(activityLocationParts("Dashboard/ExportExcel", t), ["locHome", "exportExcel"]);
  assert.deepEqual(activityLocationParts("/master-data/hang-tau", t), ["masterDataManagement", "CarrierLower"]);
  assert.deepEqual(activityLocationParts("/account-management/users/12", t), ["accountManagement"]);
  assert.deepEqual(activityLocationParts("Auth/Login", t), ["locLoginScreen"]);
  assert.deepEqual(activityLocationParts("Auth/Login/Google", t), ["locLoginScreen", "locGoogleVerify"]);
  assert.deepEqual(activityLocationParts("Support/DocumentSync/BL", t), ["documentSync", "BL"]);
  assert.deepEqual(activityLocationParts("AiChat", t), ["locAiChat"]);
  assert.deepEqual(activityLocationParts("Sidebar/Logout", t), ["locSidebar", "logout"]);
  assert.deepEqual(activityLocationParts("PaymentRequests", t), ["locPaymentRequests"]);
  assert.deepEqual(activityLocationParts("GoogleChat", t), ["locGoogleChat", "locPaymentRequests"]);
});

test("vị trí: mã lạ hoặc rỗng không làm lỗi", () => {
  assert.deepEqual(activityLocationParts("", t), []);
  assert.deepEqual(activityLocationParts("SomethingNew/Tab", t), ["SomethingNew/Tab"]);
});

test("nội dung: tách đối tượng và từng thay đổi trước → sau", () => {
  assert.deepEqual(activityDetailLines("Đơn 26009; ETA: 01/10/2026 → 05/10/2026 | Số kiện: (trống) → 120"), [
    { text: "Đơn 26009" },
    { field: "ETA", before: "01/10/2026", after: "05/10/2026" },
    { field: "Số kiện", before: "(trống)", after: "120" },
  ]);
  assert.deepEqual(activityDetailLines("Cập nhật nhà cung cấp N1; thay đổi: ten_ncc: A → B"), [
    { text: "Cập nhật nhà cung cấp N1" },
    { field: "ten_ncc", before: "A", after: "B" },
  ]);
  assert.deepEqual(activityDetailLines(""), []);
});
