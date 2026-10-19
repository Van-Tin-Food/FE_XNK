# FE XNK — hướng dẫn cho Claude Code

Frontend Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4 cho hệ thống quản lý xuất
nhập khẩu. Backend ở repo riêng `../be` (Express + PostgreSQL).

Quy tắc bắt buộc (RBAC UI, dịch, API, trạng thái, phân trang, responsive, kiểm tra): @.claude/docs/frontend-rules.md

Tài liệu tham khảo: `FUNCTIONS_AND_OPERATIONS.md` (kiến trúc), `README.md`. Một số đường dẫn trong
tài liệu có thể chưa kịp cập nhật — luôn đối chiếu code. Hệ thống chỉ có một quy trình đơn hàng (không còn màn
`purchase-process` / `transport-process` / `logistics-process`, không còn role `mua_hang`).

## Lệnh

| Việc | Lệnh |
|---|---|
| Chạy dev | `npm run dev` (gọi BE qua `BE_XNK_API_URL`, mặc định `http://127.0.0.1:5000`) |
| Kiểm tra type | `npx tsc --noEmit --incremental false` |
| Lint | `npm run lint` — hook tự lint file `.ts/.tsx` vừa sửa (chạy nền, chỉ báo khi có lỗi) |
| Test | từng file: `node --test tests/<file>.test.mjs` (truyền cả thư mục `tests/` sẽ lỗi) |
| Build | `npm run build` |
| Rà toàn bộ trước khi xong | `/verify` (mở từ thư mục gốc XNK thì là `fe:verify`) |

## Cấu trúc

- `src/app/(admin)/` — các trang có sidebar; `src/app/(full-width-pages)/(auth)/` — đăng nhập.
- `src/app/api/xnk/[...path]/route.ts` — gateway: mọi request tới BE đi qua đây (`backendApiUrl()`),
  trình duyệt không bao giờ gọi thẳng BE. `src/proxy.ts` là middleware chặn trang khi chưa đăng nhập.
- `src/services/` — toàn bộ lời gọi API (`shipmentApi.ts`, `postgresShipmentApi.ts`, `authApi.ts`...).
  Không gọi `fetch` trong component.
- `src/config/shipmentActionPermissions.ts` — danh mục chức năng (`PERMISSION_FUNCTIONS`, mức `none`/`view`/`edit`,
  đồng bộ với `be/src/config/rbac.js`). Quyền thực tế do BE tính (chuẩn role + tùy chỉnh `users.permissions`) và trả
  về ở đăng nhập và `GET /api/auth/me`; component hỏi quyền bằng `useAuth().can(fn, level)` hoặc
  `hasPermission(user, fn, level)`, **không** kiểm tra tên role. `AuthContext` đọc lại quyền khi tải lại trang,
  khi chuyển trang và khi BE trả 403 `PERMISSION_DENIED`; logo XNK (`ReloadHomeLink`) tải lại trang.
- `src/i18n/translations.js` — chuỗi giao diện, hai ngôn ngữ `vi` và `en`, dùng `t("key", { biến })`.
- `src/utils/apiError.ts` — `getFriendlyMessage` đổi mã lỗi BE thành câu cho người dùng. Mã lỗi BE mới
  phải thêm ở đây, nếu không người dùng chỉ thấy câu chung chung theo HTTP status.
- `src/components/shipment/ShipmentDetailModal.tsx` (~3.600 dòng) — chi tiết đơn, tab chứng từ, OCR,
  trả cont. Sửa cục bộ, không tái cấu trúc khi không được yêu cầu.

## Nghiệp vụ chứng từ (dễ làm sai)

- Danh sách mã chứng từ lặp ở nhiều nơi, phải sửa đồng bộ với BE (`be/src/config/documentStages.js`,
  `googleDrive.js`): `DOCUMENT_CODES` + `DOCUMENT_FIELD_MAP` (`shipmentApi.ts`), `DRIVE_DOCUMENT_FIELD_MAP`
  (`postgresShipmentApi.ts`), `DOCUMENT_DISPLAY_ORDER` / `FLOW_STAGES` (`ShipmentDetailModal.tsx`),
  trang `user-guide`.
- Mã `TRA_CONT` ↔ cột DB `tra_cong`. `TRA_CONT` và `INSPECTION` bắt buộc chọn số container (hoặc thư mục
  ảnh đã có với INSPECTION) trước khi upload; file nằm trong thư mục container trên Drive.
- Mọi luồng upload phải gọi `checkDocumentFileNames` **trước** khi upload, chạy OCR hay ghi DB, để báo
  trùng tên sớm. Không tự đổi tên hay đánh số file ở FE — quy tắc đặt tên nằm ở BE.
- Upload chứng từ dùng `uploadDocument(input, { onProgress })` trong `shipmentApi.ts`: BE mở phiên upload, trình duyệt gửi
  file thẳng lên Google Drive (`utils/driveResumableUpload.ts`, từng phần 8 MB), BE xác nhận rồi lưu DB. Không gửi file
  base64 qua gateway: gateway chạy trên Vercel, giới hạn 4,5 MB mỗi request. Tối đa 1 GB/file
  (`MAX_DOCUMENT_UPLOAD_BYTES`); file OCR vẫn qua gateway nên tối đa `MAX_OCR_FILE_BYTES` (4 MB).
- Upload PI cần `shipments:edit`, chứng từ khác cần `documents:edit` (`canUploadDocumentType`); tab Chi tiết sửa theo
  `shipments:edit`, hủy đơn theo `shipmentCancel:edit`.
- Tiền hàng theo chức năng `purchaseAmounts`, liên hệ nhà cung cấp theo `supplierContact` (BE cũng ẩn cột khi thiếu quyền).

## Tải dữ liệu

- Danh sách đơn hàng tải bằng **một** request `GET shipment-snapshot` (`fetchPostgresShipmentListSnapshot`), tự quay về
  tải từng bảng nếu BE trả 404. Ghép quan hệ bằng chỉ mục (`buildRelationIndex`), không `.filter` cả bảng cho từng đơn.
- Không gọi API theo từng đơn trong vòng lặp. Dữ liệu vận chuyển/trả cont lấy từ `shipment.database` qua
  `returnItemsFromRelations`. Danh mục NCC/hãng tàu/kho dùng `listCatalogRows` (cache 5 phút theo token,
  tự xoá khi tạo/sửa); màn danh mục vẫn dùng `listDatabaseRows` để luôn mới.

## Chatbox AI

- `src/components/ai/AiChatBox.tsx` (nút nổi trong layout admin, quyền `useAiChat`) gọi `src/services/aiChatApi.ts`.
  Bảng kết quả lấy từ `results` do BE trả (dữ liệu DB), không lấy từ chữ AI viết. Không gọi OpenRouter từ trình duyệt.

## Quy trình khi sửa

1. Đọc trang/component gần nhất đang làm việc tương tự, và route/controller BE của API liên quan
   (đừng đoán tên trường từ nhãn giao diện).
2. Chức năng mới cần quyền: thêm vào `PERMISSION_FUNCTIONS` + `PERMISSION_GROUPS`, bản dịch `permissionFn_*` /
   `permissionFnDesc_*`; cùng lúc thêm ở BE
   (`PERMISSION_FUNCTIONS`, `ROLE_PERMISSIONS`, route). Ẩn nút ở FE **không** thay cho kiểm tra ở BE.
3. Mọi chữ hiển thị mới: thêm key vào cả `vi` và `en`. Không dịch lan sang phần code cũ không liên quan.
4. Có đủ trạng thái loading / rỗng / lỗi / không có quyền / đang gửi (khoá nút, chống bấm hai lần).
5. **Mọi giao diện viết mới hoặc sửa phải responsive ngay trong cùng thay đổi** (không để "làm sau"):
   dùng được ở điện thoại 375px, tablet 768px, laptop 1024–1280px và màn lớn; không cuộn ngang cả trang.
   Viết mobile-first theo mẫu sẵn có (bảng: thẻ `lg:hidden` + bảng `hidden lg:block` như `ShipmentTable`).
   Quy tắc chi tiết: mục 8.1 của `.claude/docs/frontend-rules.md`.
6. Xong việc: tsc, lint, test, build; báo rõ nếu chưa bấm thử trên trình duyệt (kể cả chưa thử ở màn nhỏ).

## Không được làm khi chưa được yêu cầu rõ

- Push lên `main` (chạy Docker CI, xem `.github/workflows/docker.yml`).
- Commit `.env`, đưa hostname BE, `BE_XNK_API_KEY` hay secret vào code phía client.
- Đổi danh mục chức năng / quyền chuẩn ngoài phạm vi yêu cầu, đổi contract API mà không sửa BE cùng lúc.

Trả lời người dùng bằng tiếng Việt.
