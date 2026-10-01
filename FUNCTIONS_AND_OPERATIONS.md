# FE — Chức năng & Vận hành (Functions & Operations)

> Tài liệu dành cho **ban quản lý** và **nhân sự IT mới**: frontend làm gì, dữ liệu chảy qua đâu và
> bên trong code đang dùng những kỹ thuật nào.
>
> - Cần **tải code về và chạy** → xem [`README.md`](README.md)
> - Tài liệu backend → xem [`../be/FUNCTIONS_AND_OPERATIONS.md`](../be/FUNCTIONS_AND_OPERATIONS.md)

---

## Mục lục

1. [Frontend làm gì](#1-frontend-làm-gì)
2. [Vị trí trong kiến trúc](#2-vị-trí-trong-kiến-trúc)
3. [Công nghệ sử dụng](#3-công-nghệ-sử-dụng)
4. [Cấu trúc thư mục](#4-cấu-trúc-thư-mục)
5. [Các luồng hoạt động chính](#5-các-luồng-hoạt-động-chính)
6. [Các kỹ thuật bên trong](#6-các-kỹ-thuật-bên-trong)
7. [Bảo mật phía frontend](#7-bảo-mật-phía-frontend)

---

## 1. Frontend làm gì

Frontend là giao diện người dùng của phần mềm quản lý xuất nhập khẩu, chạy trên trình duyệt:

| Nhóm chức năng | Nội dung | Màn hình chính |
|---|---|---|
| **Quy trình mua hàng** | Hợp đồng mua hàng, chi tiết hàng hoá, item code nhà máy | `purchase-process` |
| **Quy trình vận chuyển** | Lô hàng XNK (B/L, cảng đi/đến, ETD/ETA/ATA), container, chi tiết container, vận chuyển container | `transport-process` |
| **Dữ liệu gốc (master data)** | Nhà cung cấp, hãng tàu, kho | `master-data` |
| **Chứng từ** | Bộ chứng từ trên Google Drive (PI, INV, B/L, PKL, CO…), theo dõi tiến độ | `ShipmentDashboard` |
| **OCR chứng từ** | Tải lên PDF/ảnh → tự bóc tách dữ liệu bằng OCR + AI | dùng trong form chứng từ |
| **Email** | Gửi email liên hệ nhà cung cấp, lưu lịch sử gửi | `email` |
| **Tra cứu hãng tàu** | Tra cứu vị trí container theo số B/L với 9 hãng tàu | `transport-process` |
| **Quản trị** | Tài khoản & phân quyền, nhật ký hoạt động, hướng dẫn sử dụng | `account-management`, `activity-logs`, `user-guide` |

---

## 2. Vị trí trong kiến trúc

```
┌────────────────────────────────────────────────────────────────────┐
│                     TRÌNH DUYỆT NGƯỜI DÙNG                         │
│        Next.js (React 19 + TypeScript + Tailwind CSS 4)            │
└───────────────┬────────────────────────────────────────────────────┘
                │  Mọi request API đi qua cổng trung gian của FE:
                │  /api/xnk/*  →  không lộ địa chỉ backend ra trình duyệt
                ▼
┌────────────────────────────────────────────────────────────────────┐
│   NEXT.JS GATEWAY  (src/app/api/xnk/[...path]/route.ts)            │
│   • Kiểm tra phiên đăng nhập (cookie token)                        │
│   • Che hostname backend, chèn X-Api-Key / Cloudflare Access       │
│   • Timeout 180s, ánh xạ lỗi 502/504 kèm gợi ý xử lý               │
└───────────────┬────────────────────────────────────────────────────┘
                │  HTTPS, Bearer token
                ▼
        BACKEND API (be/) — chi tiết xem ../be/FUNCTIONS_AND_OPERATIONS.md
```

**Nguyên tắc chính:** trình duyệt **không bao giờ** gọi thẳng backend — mọi API đi qua gateway của
Next.js (`backendApiUrl()` trả về `/api/xnk/...`). Nhờ đó hostname backend, API key và các header
bảo mật (Cloudflare Access) được giữ ngoài bundle phía client.

---

## 3. Công nghệ sử dụng

| Công nghệ | Vai trò |
|---|---|
| **Next.js 16 (App Router)** | Framework React, điều hướng theo thư mục, route groups `(admin)` / `(full-width-pages)` |
| **React 19** | Thư viện UI |
| **TypeScript 5.9** | Kiểu dữ liệu tĩnh cho toàn bộ source |
| **Tailwind CSS 4** | Styling, kèm `tailwind-merge` để gộp class |
| **Context API** | 6 provider toàn cục: Auth, Ngôn ngữ (vi), Theme, Sidebar, Thông báo hệ thống, Hộp thoại xác nhận |
| **SheetJS (`xlsx`)** | Xuất danh sách lô hàng ra file Excel ngay trên trình duyệt |
| **@svgr/webpack** | Import SVG làm component icon |
| **Cookie + localStorage** | Lưu phiên đăng nhập (token 8 giờ) và hồ sơ user |

---

## 4. Cấu trúc thư mục

```
fe/src/
├── app/
│   ├── (admin)/                 # Các trang trong layout quản trị (có sidebar)
│   │   ├── page.tsx             #   Trang chủ — Dashboard lô hàng
│   │   ├── purchase-process/    #   Quy trình mua hàng
│   │   ├── transport-process/   #   Quy trình vận chuyển
│   │   ├── master-data/         #   Dữ liệu gốc (NCC, hãng tàu, kho)
│   │   ├── email/               #   Gửi email + lịch sử
│   │   ├── account-management/  #   Quản lý tài khoản
│   │   ├── activity-logs/       #   Nhật ký hoạt động
│   │   └── user-guide/          #   Hướng dẫn sử dụng
│   ├── (full-width-pages)/(auth)/   # Trang đăng nhập, signup, reset password, callback Google
│   └── api/xnk/[...path]/route.ts   # ★ Gateway chuyển tiếp mọi API sang backend
├── components/                  # auth, shipment, email, form, header, ui...
├── context/                     # 6 Context provider toàn cục
├── services/                    # Lớp gọi API (authApi, postgresShipmentApi, emailApi...)
├── types/                       # Định nghĩa kiểu dữ liệu nghiệp vụ
├── utils/                       # Hàm tiện ích (validate, lọc ngày, phân trang, số quốc tế...)
├── i18n/                        # Dịch thuật giao diện
└── proxy.ts                     # Chặn route chưa đăng nhập → chuyển về /signin
```

---

## 5. Các luồng hoạt động chính

### 5.1. Luồng đăng nhập

```
Người dùng                    Frontend                     Backend
    │  nhập user/password         │                            │
    ├────────────────────────────▶│ POST /api/xnk/api/auth/login
    │                             ├───────────────────────────▶│ bcrypt so mật khẩu
    │              [Trường hợp 1] tài khoản KHÔNG có email → nhận JWT luôn
    │              [Trường hợp 2] tài khoản CÓ email → xác thực 2 bước Google:
    │                             │◀── pendingToken + URL Google
    │◀── chuyển hướng sang Google ┤   (lưu tạm trong sessionStorage)
    │  chọn tài khoản Google      │                            │
    ├────────────────────────────▶│ /signin/google nhận code   │
    │                             │ POST /api/auth/google/verify
    │                             │◀────────── JWT chính thức ─┤
    │◀── vào trang chủ ───────────┤                            │
```

Sau khi đăng nhập thành công:

- Token JWT lưu vào **cookie `xnk_auth_token` (8 giờ, SameSite=Lax, Secure khi HTTPS)**; hồ sơ user
  lưu vào localStorage; riêng `pendingToken` bước MFA nằm trong **sessionStorage**.
- `src/proxy.ts` chặn mọi trang chưa đăng nhập, chuyển về `/signin?next=<trang-hiện-tại>`.
- Mỗi lần gọi API: FE đọc token, gửi kèm header `Authorization: Bearer ...` qua gateway. Gateway
  kiểm tra thêm **token trong cookie phải khớp** (với thao tác ghi) rồi mới chuyển tiếp sang BE.
- Nhận **401** từ BE → phát sự kiện `xnk:auth-expired` → đăng xuất tập trung.

### 5.2. Luồng dữ liệu lô hàng

- `postgresShipmentApi.ts` tải dữ liệu từ nhiều bảng của BE rồi **ghép thành snapshot lô hàng**
  (`PostgresShipmentSnapshot`) để hiển thị dashboard: bảng, bộ lọc, số liệu tổng hợp.
- Dữ liệu số dùng chuẩn hoá dấu phẩy/chấm thập phân quốc tế (`internationalNumber.ts`) trước khi
  gửi lên database.
- Các validate phía client (`containerPackageValidation.ts`, `shipmentArchiveValidation.ts`,
  `masterDataMatching.ts`) chặn dữ liệu sai trước khi gửi API.

### 5.3. Luồng OCR chứng từ

1. Người dùng chọn file (PDF/PNG/JPG/WEBP/TIFF ≤ 15 MB) trên form.
2. FE gửi qua gateway → BE → dịch vụ Python OCR (chi tiết kỹ thuật xem
   [`../be/FUNCTIONS_AND_OPERATIONS.md`](../be/FUNCTIONS_AND_OPERATIONS.md) mục 5.3).
3. Kết quả bóc tách tự điền vào form, người dùng kiểm tra rồi lưu.

### 5.4. Xuất Excel

- Dùng **SheetJS (xlsx)** tạo file Excel trực tiếp trên trình duyệt từ dữ liệu đã lọc
  (`services/shipmentExcelExport.ts`) — không cần backend tham gia, đỡ tải server.

### 5.5. Thông báo & xác nhận

- `SystemNotificationContext` — thông báo hệ thống (kết quả thao tác, thông báo chứng từ từ `thong_bao`).
- `SystemConfirmContext` — hộp thoại xác nhận đồng bộ thay vì `confirm()` của trình duyệt.

---

## 6. Các kỹ thuật bên trong

| Kỹ thuật | Ở đâu | Làm gì |
|---|---|---|
| **Route Groups (App Router)** | `app/(admin)/`, `app/(full-width-pages)/` | Nhóm trang cùng layout khác nhau (có/không sidebar) mà không ảnh hưởng URL |
| **API Gateway tự viết** | `app/api/xnk/[...path]/route.ts` | Catch-all route chuyển tiếp mọi API; che hostname BE, kiểm tra phiên, chèn `X-Api-Key` + header Cloudflare Access, timeout 170s, ánh xạ lỗi redirect/timeout thành 502/504 kèm gợi ý sửa |
| **Middleware chặn route** | `proxy.ts` | Không có cookie token → chuyển hướng `/signin?next=...`; đã đăng nhập vào `/signin` → về trang chủ |
| **Context Provider chain** | `app/layout.tsx` | Ngôn ngữ → Theme → Auth → Thông báo → Xác nhận → Sidebar; mọi trang dùng chung |
| **Wrapper fetch chuẩn hoá** | `utils/apiError.ts` | `parseApiResponse` bắt cả response không phải JSON; tạo lỗi phân loại (HTTP / mạng / sai định dạng); nhận **401 → phát sự kiện `xnk:auth-expired`** để đăng xuất tập trung |
| **Phân tích response khoan dung** | `services/postgresShipmentApi.ts` | `unwrapRows` chấp nhận nhiều hình dạng JSON (`.data` / `.rows` / `.items`) giúp FE không vỡ khi BE đổi vỏ bọc |
| **Chuẩn hoá số quốc tế** | `utils/internationalNumber.ts` | Đọc đúng số có dấu phẩy/chấm thập phân kiểu châu Âu trước khi gửi lên DB |
| **Validate phía client** | `utils/containerPackageValidation.ts`, `shipmentArchiveValidation.ts`, `masterDataMatching.ts` | Chặn dữ liệu sai trước khi gửi API (kiện container, điều kiện lưu trữ, khớp dữ liệu gốc) |
| **i18n** | `i18n/` + `LanguageContext` | Giao diện song ngữ, mặc định tiếng Việt |
| **Xuất Excel client-side** | `services/shipmentExcelExport.ts` | SheetJS tạo workbook, đặt tên cột, định dạng ngày |

---

## 7. Bảo mật phía frontend

1. **Token chỉ nằm trong cookie HttpPath giới hạn thời gian** (8 giờ) — không lưu token vào
   URL hay localStorage dùng chung.
2. **Gateway kiểm tra kép:** với thao tác ghi, token trong header phải **khớp** token trong cookie —
   chặn kịch bản script ngoài tự gắn header từ trình duyệt.
3. **Secret không xuống client:** hostname BE, `BE_XNK_API_KEY`, header Cloudflare Access đều nằm ở
   gateway (server Next.js), không xuất hiện trong bundle trình duyệt.
4. **Phân quyền hiển thị theo role/session** lấy từ JWT đã xác minh; quyền thực tế vẫn được BE kiểm
   tra lại — FE ẩn nút chỉ để trải nghiệm, không phải lớp bảo vệ.
5. **Đăng xuất tập trung** khi token hết hạn qua sự kiện `xnk:auth-expired`.

---

*Thắc mắc về chức năng hoặc vận hành: liên hệ bộ phận IT.*

**Ngày tạo tài liệu: 01/10/2026** — nội dung có hiệu lực tính từ ngày này.
