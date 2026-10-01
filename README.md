# FE — Frontend XNK: Hướng dẫn tải code về và chạy

> Hướng dẫn cài đặt cho nhân sự IT mới: từ máy trống đến khi mở được trang đăng nhập.
> Muốn hiểu các màn hình, luồng và kỹ thuật bên trong → xem
> [`FUNCTIONS_AND_OPERATIONS.md`](FUNCTIONS_AND_OPERATIONS.md).

## Điều kiện tiên quyết

- **BE phải chạy trước** — FE gọi BE ngay khi mở trang. Xem hướng dẫn chạy BE tại
  [`../be/README.md`](../be/README.md) (mục 4).
- BE cần kết nối database server nội bộ → máy phải cùng mạng nội bộ công ty hoặc đã bật VPN.

## Thứ tự thực hiện

```
1. Cài môi trường  →  2. Tải code  →  3. File .env (nếu cần)  →  4. Chạy FE
```

---

## 1. Các ứng dụng cần tải và cài đặt

| Ứng dụng | Phiên bản | Bắt buộc? | Dùng để làm gì | Tải tại |
|---|---|:---:|---|---|
| **Visual Studio Code (VS Code)** | mới nhất | ✅ | Mở, xem và sửa code; chạy lệnh trong terminal tích hợp | code.visualstudio.com |
| **Git** | mới nhất | ✅ | Tải code từ repo về máy | git-scm.com |
| **Node.js** | **22 LTS** | ✅ | Chạy frontend (FE — Next.js); backend BE cũng cần Node này | nodejs.org |
| **Trình duyệt** (Chrome/Edge) | mới nhất | ✅ | Mở http://localhost:3000 khi chạy FE | — |
| **PostgreSQL** | — | ❌ Không cần cài trên máy | Database nằm trên **server nội bộ** công ty, FE không kết nối trực tiếp — BE mới là nơi kết nối | — |
| **Postman** | mới nhất | Tùy chọn | Test API backend khi cần đối chiếu | postman.com |
| **Python + Tesseract OCR** | 3.12 + 5.x | Tùy chọn | Chỉ cần khi muốn chạy luôn dịch vụ OCR trên máy — xem `../be/README.md` mục 5 | python.org |

---

## 2. Tải code

```bash
git clone <URL_REPO>        # URL repo liên hệ bộ phận IT nếu chưa có quyền truy cập
cd <ten-repo>/fe
```

---

## 3. File `.env`

- **Không cần** tạo `fe/.env.local` khi chạy local: FE chế độ dev tự trỏ về backend
  `http://127.0.0.1:5000`.
- Chỉ cần file này khi **backend chạy ở địa chỉ khác** hoặc khi **build production** —
  👉 **liên hệ bộ phận IT** để được cấp `fe/.env.local` (chứa `BE_XNK_API_URL`, `BE_XNK_API_KEY`),
  đặt vào thư mục `fe/`.

⚠️ File `.env` chứa thông tin nhạy cảm: không commit lên Git, không gửi qua kênh công khai.

---

## 4. Chạy FE

Đảm bảo BE đã chạy (http://localhost:5000), rồi:

```bash
npm install        # lần đầu chạy, mất vài phút
npm run dev
```

- FE chạy tại **http://localhost:3000** — mở bằng trình duyệt.
- Chế độ build production: `npm run build` rồi `npm start`.
- **Đăng nhập thử:** dùng tài khoản do IT cấp. Nếu tài khoản có cấu hình email Google, hệ thống sẽ
  chuyển qua bước xác thực Google (MFA) rồi mới vào trang chủ.

---

## 5. Lỗi thường gặp

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| FE mở ra lỗi **502 "Không thể kết nối backend XNK"** | BE chưa chạy hoặc chưa xong `npm install` | Chạy BE trước (xem `../be/README.md` mục 4), rồi refresh |
| Mọi request trả **401** | Token hết hạn hoặc `JWT_SECRET` hai bên không khớp | Đăng nhập lại; vẫn lỗi thì liên hệ IT |
| Đăng nhập báo sai mật khẩu | Chưa có tài khoản / sai tài khoản | Liên hệ IT để được cấp tài khoản |
| `npm run dev` báo lỗi phiên bản Node | Node cũ hơn yêu cầu | Cài Node.js 22 LTS |
| Cổng 3000 bị chiếm | Ứng dụng khác đang dùng cổng | Tắt ứng dụng đó |
| FE trỏ sai địa chỉ BE | BE không chạy ở `localhost:5000` | Xin `fe/.env.local` từ IT (mục 3) |

---

## Bước tiếp theo

- Hiểu **các màn hình, luồng và kỹ thuật** của frontend → [`FUNCTIONS_AND_OPERATIONS.md`](FUNCTIONS_AND_OPERATIONS.md)
- Chạy **backend** → [`../be/README.md`](../be/README.md)
- **Quy tắc khi sửa code frontend** → [`AGENTS.md`](AGENTS.md)

---

*Có lỗi nào không có trong bảng trên: chụp lại thông báo lỗi + terminal log rồi liên hệ bộ phận IT.*

**Ngày tạo tài liệu: 01/10/2026** — nội dung có hiệu lực tính từ ngày này.
