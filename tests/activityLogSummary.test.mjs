import assert from "node:assert/strict";
import test from "node:test";
import { activityLogSummary } from "../src/utils/activityLogSummary.ts";

test("old verbose OCR logs show only order and document in the main line", () => {
  const result = activityLogSummary(
    "UPLOAD_OCR_DOCUMENT",
    "Đơn 00129263002; thay đổi: Số kiện: (trống) → 2.592 | Trọng lượng NET: (trống) → 25.920,00",
    "ShipmentDetailModal/Documents/PKL",
  );
  assert.equal(result, "Đơn 00129263002 · PKL");
});

test("new upload logs keep the order and document", () => {
  assert.equal(activityLogSummary("UPLOAD_DOCUMENT", "Đã upload 2 file chứng từ BL cho đơn VTF008", "ShipmentDetailModal/Documents"), "Đơn VTF008 · BL");
});

test("transport and account actions keep a useful identifier", () => {
  assert.equal(activityLogSummary("EDIT_RETURN_ITEM", "Cập nhật vận chuyển Container MSCU1234567 của đơn HD001", ""), "Đơn HD001 · MSCU1234567");
  assert.equal(activityLogSummary("REGISTER_USER", "Tạo tài khoản thanh; role xnk; session edit", "", "en"), "Account thanh");
});

test("shipment edit logs retain the changed fields and values", () => {
  const detail = "Đơn VTF008; Cảng đến: HCM → HP | Số kiện: 100 → 120";
  assert.equal(activityLogSummary("EDIT_SHIPMENT_DETAILS", detail, "ShipmentDetailModal/Details"), "Đơn VTF008 · Cảng đến: HCM → HP; Số kiện: 100 → 120");
  assert.equal(activityLogSummary("EDIT_SHIPMENT_DETAILS", detail, "ShipmentDetailModal/Details", "en"), "Order VTF008 · Cảng đến: HCM → HP; Số kiện: 100 → 120");
});

test("auto document sync: run summary shows date + result, each file log shows order + document", () => {
  const run = "Hệ thống tự động xử lý đồng bộ chứng từ (chạy theo lịch 8h sáng) ngày 04/11/2026 | Quét 120 file trong các thư mục chứng từ trên Google Drive, trong đó 3 file chưa có trong hệ thống | Kết quả: tiếp nhận 2 file (có 1 file phải đổi tên cho đúng mẫu), bỏ qua 1 file, lỗi 0 file | Tiếp nhận 1/2: file \"a.pdf\" vào đơn 26021, chứng từ Đơn đăng kí kiểm dịch động vật (DON_KD)";
  assert.equal(
    activityLogSummary("AUTO_DOCUMENT_SYNC_RUN", run, "System/AutoDocumentSync"),
    "Hệ thống tự động xử lý đồng bộ chứng từ (chạy theo lịch 8h sáng) ngày 04/11/2026 · tiếp nhận 2 file (có 1 file phải đổi tên cho đúng mẫu), bỏ qua 1 file, lỗi 0 file",
  );
  assert.equal(
    activityLogSummary("AUTO_DOCUMENT_SYNC", "Hệ thống tự động xử lý: tiếp nhận file \"a.pdf\" vào đơn 26021, chứng từ Đơn đăng kí kiểm dịch động vật (DON_KD), tên file đã đúng mẫu, giữ nguyên", "System/AutoDocumentSync/DON_KD"),
    "Đơn 26021 · DON_KD",
  );
});

test("arrival reminder: main line shows date + number of B/L", () => {
  const detail = "Hệ thống tự động xử lý: thông báo hàng sắp về ngày 05/11/2026 (ETA từ hôm nay đến 30 ngày tới, chưa báo lần nào) | 2 B/L: 26021 (B/L MEDU123) - 20/11/2026 cập cảng [B/L MEDU123, id_xnk 11] ; 26023 - 25/11/2026 cập cảng [B/L ONEY777, id_xnk 12] | Người nhận: User 2 (id 2): đã nhận";
  assert.equal(
    activityLogSummary("ETA_ARRIVAL_REMINDER", detail, "System/EtaArrivalReminder"),
    "Hệ thống tự động xử lý: thông báo hàng sắp về ngày 05/11/2026 (ETA từ hôm nay đến 30 ngày tới, chưa báo lần nào) · 2 B/L",
  );
});

test("payment request logs lead with the request number and the key point", () => {
  assert.equal(activityLogSummary("PAYMENT_REQUEST_APPROVE", "DNTT-001; 1000000 VND; người duyệt: An (an@x.vn)", "GoogleChat"), "Đề nghị DNTT-001 · 1000000 VND; người duyệt: An (an@x.vn)");
  assert.equal(activityLogSummary("PAYMENT_REQUEST_REJECT", "DNTT-002; lý do: thiếu hóa đơn; người từ chối: Bình (b@x.vn)", "GoogleChat", "en"), "Request DNTT-002 · lý do: thiếu hóa đơn; người từ chối: Bình (b@x.vn)");
  assert.equal(
    activityLogSummary("PAYMENT_REQUEST_UPDATE", "DNTT-003 | Số tiền: 100 → 200 | Sau khi sửa: DNTT-003 | Số tiền: 200 | Chi phí (0): (không có)", "PaymentRequests"),
    "Đề nghị DNTT-003 · Số tiền: 100 → 200",
  );
  assert.equal(activityLogSummary("PAYMENT_REQUEST_SEND", "DNTT-004", "PaymentRequests"), "Đề nghị DNTT-004");
});
