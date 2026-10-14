---
name: verify
description: Rà soát thay đổi frontend XNK theo checklist (tsc, lint, test, build, quyền, bản dịch vi/en, contract API) trước khi báo hoàn thành. Dùng khi người dùng gõ /verify hoặc trước khi kết thúc một thay đổi frontend.
---

Chạy mọi lệnh bên dưới trong thư mục `fe/` (repo chứa skill này), kể cả khi phiên đang mở ở thư mục cha.

Rà soát các thay đổi frontend chưa commit trong repo này và báo cáo theo checklist. Chỉ sửa lỗi
TypeScript/lint/build hiển nhiên; các vấn đề khác liệt kê để người dùng quyết định.

1. Xem phạm vi: `git status --short`, `git diff`.
2. Chạy lần lượt và ghi kết quả thật:
   - `npx tsc --noEmit --incremental false`
   - `npm run lint`
   - từng file test: `node --test tests/<file>.test.mjs` (truyền cả thư mục `tests/` sẽ lỗi)
   - `npm run build`
3. Đối chiếu với `.claude/docs/frontend-rules.md` mục 10 (Verification Checklist), đặc biệt:
   - Chức năng mới có quyền trong `ROLE_ACCESS` và bảng `EXPECTED` của
     `tests/shipmentActionPermissions.test.mjs` đã cập nhật.
   - Mọi chữ hiển thị mới có key trong `src/i18n/translations.js` cho **cả `vi` và `en`**
     (kiểm tra từng key mới bằng `grep`, đếm đủ 2 lần).
   - Gọi API qua `src/services/`, type khớp response BE; mã lỗi BE mới đã có trong `src/utils/apiError.ts`.
   - Có trạng thái loading / rỗng / lỗi / không có quyền; không hiển thị dữ liệu nhạy cảm sai quyền.
   - Mã chứng từ đổi ở FE đã đồng bộ với `be/src/config/documentStages.js` và `googleDrive.js`.
   - **Responsive** (mục 8.1): với mọi file `.tsx` đã đổi, rà phần giao diện mới/sửa:
     - `grep -nE "w-\[[0-9]+px\]|min-w-\[[0-9]+px\]|h-\[[0-9]+px\]"` — kích thước cố định phải có `max-w`/`w-full`,
       biến thể breakpoint, hoặc nằm trong vùng `overflow-x-auto`.
     - Bảng mới có dạng thẻ dưới `lg` hoặc bọc `overflow-x-auto`; lưới/flex nhiều cột có bản một cột ở mobile
       (`grid-cols-1`, `flex-col` rồi mới `sm:`/`md:`/`lg:`).
     - Phần tử con trong flex chứa chữ dài có `min-w-0` + `truncate`/`break-words`.
     - Ghi rõ đã thử ở 375 / 768 / 1024 / 1280px hay chưa.
4. Nếu đổi API contract, đọc route/controller tương ứng ở `../be` để xác nhận tên trường.

Báo cáo ngắn gọn bằng tiếng Việt: lệnh đã chạy và kết quả, mục đạt, mục chưa đạt kèm `file:dòng`,
và những gì chưa kiểm được (chưa bấm thử trên trình duyệt, chưa có backend thật...).
