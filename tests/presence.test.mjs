import assert from "node:assert/strict";
import test from "node:test";
import { isOnSamePage, normalizeOnlineUser, othersOnline, presencePageLabel } from "../src/utils/presence.ts";

const user = (id, name, path, extra = {}) => ({ id, name, email: null, role: "", path, paths: [path], lastSeenAt: "", isMe: false, ...extra });

test("tên trang: danh sách đơn, chi tiết đơn (giải mã mã đơn), tạo đơn, trang con, không nhận ra", () => {
  assert.deepEqual(presencePageLabel("/"), { key: "importExport" });
  assert.deepEqual(presencePageLabel("/shipments/VTF%2F001"), { key: "presencePageShipment", vars: { orderCode: "VTF/001" } });
  assert.deepEqual(presencePageLabel("/shipments/new"), { key: "presencePageNewShipment" });
  assert.deepEqual(presencePageLabel("/reports/costs"), { key: "reportsMenu" });
  assert.deepEqual(presencePageLabel("/emailx"), null);
  assert.deepEqual(presencePageLabel(""), { key: "importExport" });
});

test("người khác online: bỏ mình, người cùng trang (ở tab bất kỳ) lên trước, rồi theo tên", () => {
  const users = [
    user(1, "Bình", "/"),
    user(2, "An", "/payment-requests"),
    user(3, "Cường", "/payment-requests", { isMe: true }),
    user(4, "Dũng", "/", { paths: ["/", "/payment-requests/"] }),
  ];
  assert.deepEqual(othersOnline(users, "/payment-requests").map((item) => item.id), [2, 4, 1]);
  assert.equal(isOnSamePage(users[3], "/payment-requests"), true);
  assert.equal(isOnSamePage(users[0], "/payment-requests"), false);
});

test("chuẩn hoá dòng BE: bỏ dòng sai id, thiếu tên thì dùng #id", () => {
  assert.equal(normalizeOnlineUser({ id: "x" }), null);
  assert.equal(normalizeOnlineUser(null), null);
  const row = normalizeOnlineUser({ id: 7, name: " ", email: "", path: "/", paths: ["/"], isMe: true });
  assert.equal(row.name, "#7");
  assert.equal(row.email, null);
  assert.equal(row.isMe, true);
});
