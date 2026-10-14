# XNK Frontend Rules

> Bản commit của quy tắc frontend (bản gốc `.codex/skills/xnk-frontend/SKILL.md` bị gitignore).
> Sửa quy tắc thì sửa file này; nếu còn dùng Codex thì chép sang `.codex` cho đồng bộ.
>
> **Hiện trạng khác với quy tắc (đã kiểm tra 14/10/2026):**
> - Ma trận quyền nằm ở `ROLE_ACCESS` (`view`/`manage` cho từng role) trong
>   `src/config/shipmentActionPermissions.ts`, không phải `ROLE_ACTIONS`/`MANAGE_ACTIONS` như mục 3.
>   Mọi thay đổi quyền phải cập nhật bảng `EXPECTED` trong `tests/shipmentActionPermissions.test.mjs`.
> - Session chỉ còn `manage`/`view`; alias cũ không còn được chuẩn hoá (role lạ = không có quyền).
> - Mục "Current role model" bên dưới có thể đã cũ; ma trận đúng nằm trong `ROLE_ACCESS` và bảng `EXPECTED` của test.
> - Backend hiện không kiểm tra quyền (xem `be/src/config/rbac.js`), nên ẩn nút ở FE đang là lớp chặn duy nhất.

# XNK Frontend Skill

Use this skill for every frontend change in `fe/`. Build usable screens that match the existing Next.js App Router application, preserve the backend contract, and make permissions, translations, loading states, filtering, pagination, and responsive behavior part of the implementation rather than afterthoughts.

## 1. Read Before Editing

Before changing code, inspect:

- `src/app/` route groups and layouts, especially `src/app/(admin)/layout.tsx`.
- `src/layout/AppSidebar.tsx` and `src/layout/AppHeader.tsx` for navigation conventions.
- `src/context/AuthContext.tsx`, `src/types/auth.ts`, and `src/config/shipmentActionPermissions.ts` for identity and UI RBAC.
- `src/context/LanguageContext.tsx` and `src/i18n/translations.js` before adding text.
- `src/services/` and `src/app/api/xnk/[...path]/route.ts` before calling the backend.
- Existing list pages, `PaginationControls`, filters, modals, and table components before inventing a new pattern.
- `src/globals.css`, Tailwind configuration, and existing design tokens.
- `tests/` and package scripts before deciding how to verify a change.

Read the corresponding backend route/controller/service when changing an API consumer. Do not guess field names from UI labels.

## 2. Required Change Flow

For every new page, control, API function, or visible behavior:

1. Define the user workflow, allowed roles, data states, and error states.
2. Add or update the permission key in `src/config/shipmentActionPermissions.ts` if the capability is new.
3. Add the corresponding backend permission/route contract in the same change when the action mutates data.
4. Add all user-facing copy to `src/i18n/translations.js` for every supported language and use `t(...)`.
5. Implement loading, empty, error, disabled, success, and permission-denied states.
6. Reuse the existing service, pagination, modal, notification, and confirmation patterns.
7. Run lint, TypeScript checking, and production build before finishing.

## 3. RBAC and Sensitive Data

### Current role model

Use normalized values:

- `admin`: all actions.
- `it`: can view all modules, users, master data, and logs; cannot edit.
- `logistic`: can create/edit shipments and related details/documents; email sending is admin-only.
- `van_chuyen`: can handle transport and document actions; cannot create shipments.

Sessions are `all`, `manage`, and `view`; legacy aliases are normalized by the permission helper.

### Rules for every new capability

- Add a named action to `ShipmentActionPermissionKey`.
- Add it to the correct `ROLE_ACTIONS` set and, if it mutates, to `MANAGE_ACTIONS`.
- Use `canPerformShipmentAction(user, action)` before rendering the page control, menu item, button, modal action, or destructive shortcut.
- Hide controls users cannot use; disabled controls are appropriate when context should remain visible but action must be unavailable.
- Do not use frontend hiding as backend security. The backend must authorize every mutation.
- Keep GET data loading working according to the project contract. Do not add a frontend permission guard that prevents a shared table from loading data merely because a role cannot edit it.
- For sensitive fields, do not render or include them in client state when the user should not see them. UI hiding alone is insufficient if the API returns the data.
- When adding a Sidebar item, use the same permission helper and preserve route access behavior.

If a new resource has both view and manage semantics, represent them clearly in action names and session handling instead of scattering role checks across JSX.

## 4. API Services and Data Contracts

- Put backend calls in `src/services/`, not directly in page JSX.
- Reuse the existing API proxy and authentication behavior in `src/app/api/xnk/[...path]/route.ts`.
- Keep request/response types explicit. Update `src/types/` or the service types when fields change.
- Normalize optional/null values at the service boundary so components can render predictable values.
- Handle non-2xx responses through existing API error/notification patterns.
- Do not fabricate success locally before the server confirms a write.
- After a mutation, refresh or update the affected data deliberately; avoid stale tables and duplicate rows.
- Do not put credentials, SMTP secrets, or tokens in client code, query strings, logs, or localStorage unless the existing auth design explicitly requires the token storage.

## 5. Translation Rules

Every new visible string must be translated:

- Add the key to every supported language in `src/i18n/translations.js`.
- Use `const { t } = useLanguage()` and `t("key", variables)` in components.
- Translate headings, buttons, placeholders, labels, table statuses, validation messages, empty states, tooltips, notifications, and confirmation dialogs.
- Keep status values stable in code (`sent`, `not sent`, etc.) and translate their display labels.
- Do not use a missing-key fallback as a permanent translation.
- Do not translate backend machine codes; map them to frontend translation keys.

When touching an old hard-coded screen, only convert nearby text needed for the requested feature unless a broader translation migration is explicitly requested.

## 6. Lists, Tables, Filters, and Pagination

For every list that can grow:

- Use the shared `PaginationControls` and `paginateItems` patterns where appropriate.
- Keep page and page size state separate for independent lists on the same screen.
- Reset the page to `1` when search, filter, sort, or page size changes.
- Clamp page state when the filtered result count shrinks.
- Use stable unique keys from domain IDs, not array indexes.
- Provide loading, empty, and error states that do not shift the layout unexpectedly.
- Keep filters explicit and easy to scan. For email/history screens, include status, provider/supplier, and date filters when the data supports them.
- Avoid duplicate HTML IDs when a page has multiple filter or pagination instances; give reusable controls an `idPrefix` or equivalent.
- Preserve selection semantics across pagination and filtering. Make clear whether “select all” means the current page or all filtered records.
- Avoid loading an unbounded dataset if the backend supports server-side pagination; if the current API is client-paginated, document that behavior.

## 7. Forms and Mutations

- Validate required fields before calling the API and show field-level or form-level feedback.
- Disable submit while sending and prevent duplicate submissions.
- Keep the selected records and payload visible enough for the user to confirm the operation.
- Show success and partial-failure notifications using the existing notification context.
- For destructive operations, use the existing confirmation context/modal.
- After errors, preserve user input when safe and explain what failed.
- For email sending, show recipient count, per-recipient result status, and refresh the history after the server response. The history contains only SMTP-confirmed successful deliveries; failed recipients must be visible in the send result/notification and must not be presented as successful history rows.

## 8. UI and Layout Conventions

- Match the existing Tailwind design system, spacing, typography, dark mode, and menu classes.
- Use familiar icons from the existing icon system or an enabled icon library; do not draw a custom icon when an existing one fits.
- Buttons should have clear labels or an icon plus tooltip. Do not use decorative text-only rounded controls where a standard icon is expected.
- Keep cards reserved for actual framed tools, repeated items, and modals. Do not nest cards unnecessarily.
- Keep dense operational pages practical: scanning, comparison, filters, and repeated actions matter more than marketing-style decoration.
- Ensure text fits at mobile and desktop widths. Check long supplier names, email addresses, errors, translations, and selected-recipient lists.
- Do not use viewport-scaled font sizes or negative letter spacing.
- Preserve keyboard focus, labels, `aria-label`, `aria-expanded`, `aria-current`, and disabled states for interactive controls.
- Every route should have a useful loading/error/empty experience, not a blank screen.

### 8.1. Responsive (bắt buộc với mọi code giao diện)

Mọi component/trang viết mới hoặc sửa đều phải responsive trong cùng thay đổi. Không giao phần "desktop
trước, mobile sau".

**Breakpoint** (khai báo ở `src/app/globals.css`, dùng đúng tên này):
`2xsm` 375px · `xsm` 425px · `sm` 640px · `md` 768px · `lg` 1024px · `xl` 1280px · `2xl` 1536px · `3xl` 2000px.
Sidebar chỉ chiếm chỗ từ `lg` (`lg:ml-[290px]` / `lg:ml-[90px]`); dưới `lg` nội dung dùng toàn bộ chiều ngang.

**Cách viết**

- Mobile-first: class không tiền tố là giao diện điện thoại (từ 360px), thêm `sm:` / `md:` / `lg:` / `xl:` cho màn lớn hơn.
- Không để trang cuộn ngang. Chỉ vùng bảng được cuộn ngang, và phải bọc `overflow-x-auto custom-scrollbar`.
- **Bảng dữ liệu**: theo mẫu `ShipmentTable` — dưới `lg` hiện danh sách thẻ (`lg:hidden`), từ `lg` hiện bảng
  (`hidden lg:block`). Bảng phụ nhỏ trong modal có thể chỉ bọc `overflow-x-auto` + `min-w-[...]`.
- **Lưới / form / bộ lọc**: `grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4`; hàng bộ lọc
  `flex flex-col gap-3 md:flex-row md:flex-wrap`, ô nhập `w-full md:w-44` (xem `ShipmentFilters`).
- **Modal / panel**: `w-full max-w-*`, có lề ở màn nhỏ, `max-h-[90vh] overflow-y-auto`; nhóm nút
  `flex flex-wrap gap-2` để tự xuống dòng; nội dung nhiều cột chuyển một cột dưới `sm`/`md`.
- **Kích thước cố định**: không dùng `w-[600px]`, `h-[...px]` trần cho khối nội dung; dùng
  `w-full max-w-[600px]` hoặc kèm biến thể theo breakpoint.
- **Chữ dài** (tên NCC, tên hàng, mã B/L, số container, email, lỗi, bản dịch tiếng Anh): `min-w-0` trên phần tử
  flex/grid con + `truncate` (kèm `title`) hoặc `break-words` / `break-all` cho mã dài.
- **Thao tác chạm**: nút và ô bấm cao tối thiểu ~36–40px trên mobile; thao tác chỉ có khi hover (tooltip, nút ẩn
  hiện khi rê chuột) phải có cách bấm thay thế.
- **Sticky**: header bảng dính dùng đúng độ cao header app (`top-[65px] lg:top-[73px]`), không che nội dung ở mobile.
- Ẩn bớt cột/thông tin phụ ở màn nhỏ (`hidden md:table-cell`, `hidden sm:inline`) thay vì ép chữ nhỏ;
  không ẩn thông tin hoặc nút thao tác chính.

**Tự kiểm tra trước khi báo xong**: DevTools ở 375px, 768px, 1024px, 1280px (thêm 1536px nếu là bảng rộng), cả
sáng/tối: không cuộn ngang trang, chữ không tràn/đè, nút bấm được, modal cuộn được. Nếu chưa thử được trên
trình duyệt thì ghi rõ trong báo cáo.

## 9. Email-Specific Rules

The email screen has three related concerns:

- supplier selection and filtering,
- message composition and sending,
- per-recipient delivery history and missing-supplier comparison.

Keep them visually clear and independently manageable. The history contract stores one row per successful recipient, so do not group away the recipient-level result. Show failed recipients in the send result/notification and keep filtering/pagination consistent with catalog screens. Never display SMTP credentials or raw provider secrets.

## 10. Verification Checklist

Before finishing a frontend task, verify:

- [ ] Permission action exists and is used for every new restricted control/page.
- [ ] Backend mutation authorization is coordinated; frontend hiding is not the only protection.
- [ ] Every new visible string has translation keys in all supported languages.
- [ ] API types and service behavior match the backend response.
- [ ] Loading, empty, error, success, disabled, and no-permission states exist.
- [ ] Lists reset pagination when filters/search/page size change.
- [ ] Multiple pagination/filter controls have unique IDs.
- [ ] Sensitive data is not rendered for unauthorized roles.
- [ ] Responsive (mục 8.1): mobile-first, không cuộn ngang trang ở 375px, bảng có dạng thẻ hoặc vùng cuộn riêng, chữ dài không tràn, đã thử 375/768/1024/1280px hoặc ghi rõ chưa thử.
- [ ] Dark mode, long text, and keyboard interaction were considered.
- [ ] No unrelated generated files or secrets were committed.

Run from `fe/`:

```powershell
npm run lint
npx tsc --noEmit --incremental false
npm run build
```

If a command cannot run, report the exact limitation. Do not claim a browser workflow was tested without actually testing it.
