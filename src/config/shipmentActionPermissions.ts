import type { AuthUser } from "@/types/auth";

// Phân quyền theo chức năng, mỗi chức năng một mức: none (không) / view (xem) / edit (sửa, gồm cả tạo mới).
// Quyền thực tế của tài khoản do BE tính (chuẩn của role + tùy chỉnh riêng) và trả về ở đăng nhập và
// GET /api/auth/me; FE chỉ đọc user.permissions, không tự suy quyền từ tên role.
// Danh mục chức năng đồng bộ với PERMISSION_FUNCTIONS trong be/src/config/rbac.js.

export const RBAC_ROLES = ["admin", "it", "logistic", "van_chuyen", "ke_toan"] as const;
export type RbacRole = (typeof RBAC_ROLES)[number];

export const PERMISSION_LEVELS = ["none", "view", "edit"] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

export const PERMISSION_FUNCTIONS = {
  shipments: ["none", "view", "edit"], // Đơn hàng: xem; edit = tạo đơn, sửa chi tiết, upload PI
  shipmentCancel: ["none", "edit"], // Hủy đơn
  documents: ["none", "view", "edit"], // Chứng từ: xem; edit = upload (trừ PI), PASS
  documentArchive: ["none", "edit"], // Lưu trữ hồ sơ đơn đã đủ chứng từ
  containerTransport: ["none", "view", "edit"], // Vận chuyển / trả container
  tracking: ["none", "view"], // Theo dõi hành trình tàu
  exportShipments: ["none", "view"], // Xuất Excel
  purchaseAmounts: ["none", "view"], // Đơn giá, tổng tiền hàng
  supplierContact: ["none", "view"], // Email, SĐT, địa chỉ nhà cung cấp
  aiChat: ["none", "view"], // Chatbox AI
  masterData: ["none", "view", "edit"], // Danh mục NCC, hãng tàu, kho
  documentSync: ["none", "view", "edit"], // Đồng bộ chứng từ Drive
  email: ["none", "view", "edit"], // Email nhà cung cấp: xem; edit = gửi
  activityLogs: ["none", "view"], // Nhật ký thao tác
  users: ["none", "view", "edit"], // Tài khoản: xem; edit = tạo, sửa, phân quyền, đổi mật khẩu
  userGuide: ["none", "view"], // Hướng dẫn sử dụng
  // Hai link Google Apps Script trong menu Công cụ hỗ trợ: ngoài hệ thống, quyền chỉ ẩn/hiện menu.
  marketResearch: ["none", "view"], // Nghiên cứu thị trường
  legacyEtaOrders: ["none", "view"], // Dữ liệu hợp đồng cũ
  // Đề nghị thanh toán: view = xem đề nghị của mình; edit = tạo, sửa đề nghị của mình.
  paymentRequests: ["none", "view", "edit"],
  paymentRequestsAll: ["none", "view", "edit"], // Đề nghị của mọi người: view = xem; edit = sửa, gửi, hủy
  paymentApprove: ["none", "edit"], // Duyệt / từ chối trên Google Chat
  paymentDocuments: ["none", "edit"], // Upload chứng từ + lưu trữ hồ sơ đề nghị
  containerCosts: ["none", "view", "edit"], // Tab Chi phí của đơn: chi phí container
} as const satisfies Record<string, readonly PermissionLevel[]>;

export type PermissionFunction = keyof typeof PERMISSION_FUNCTIONS;
export type PermissionMap = Record<PermissionFunction, PermissionLevel>;

export const PERMISSION_FUNCTION_KEYS = Object.keys(PERMISSION_FUNCTIONS) as PermissionFunction[];

// Nhóm hiển thị trên màn quản lý tài khoản.
export const PERMISSION_GROUPS: ReadonlyArray<{ key: string; functions: readonly PermissionFunction[] }> = [
  { key: "permissionGroupShipments", functions: ["shipments", "shipmentCancel", "tracking", "exportShipments", "aiChat"] },
  { key: "permissionGroupDocuments", functions: ["documents", "documentArchive", "containerTransport"] },
  // Khớp đúng 4 mục của menu "Công cụ hỗ trợ" trên sidebar.
  { key: "supportTools", functions: ["email", "documentSync", "marketResearch", "legacyEtaOrders"] },
  { key: "permissionGroupPayments", functions: ["paymentRequests", "paymentRequestsAll", "paymentApprove", "paymentDocuments", "containerCosts"] },
  { key: "permissionGroupSensitive", functions: ["purchaseAmounts", "supplierContact"] },
  { key: "permissionGroupSystem", functions: ["masterData", "users", "activityLogs", "userGuide"] },
];

const LEVEL_RANK: Record<PermissionLevel, number> = { none: 0, view: 1, edit: 2 };

export function normalizeRole(value?: string): string {
  return String(value || "").trim().toLocaleLowerCase("vi");
}

export function isAdminRole(role?: string): boolean {
  return normalizeRole(role) === "admin";
}

export function levelRank(level?: string): number {
  return LEVEL_RANK[level as PermissionLevel] ?? 0;
}

export function isPermissionFunction(value: string): value is PermissionFunction {
  return Object.prototype.hasOwnProperty.call(PERMISSION_FUNCTIONS, value);
}

export function isLevelAllowed(fn: PermissionFunction, level: string): level is PermissionLevel {
  return (PERMISSION_FUNCTIONS[fn] as readonly string[]).includes(level);
}

/** Đọc map { chức năng: mức } từ API: bỏ chức năng lạ và mức không hợp lệ. */
export function normalizePermissionMap(value: unknown): Partial<PermissionMap> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Partial<PermissionMap> = {};
  for (const [fn, raw] of Object.entries(value as Record<string, unknown>)) {
    const level = String(raw ?? "").trim().toLowerCase();
    if (isPermissionFunction(fn) && isLevelAllowed(fn, level)) result[fn] = level;
  }
  return result;
}

export function fullPermissions(): PermissionMap {
  return Object.fromEntries(PERMISSION_FUNCTION_KEYS.map((fn) => {
    const levels = PERMISSION_FUNCTIONS[fn];
    return [fn, levels[levels.length - 1]];
  })) as PermissionMap;
}

/** Quyền đầy đủ cho mọi chức năng (thiếu = none). */
export function completePermissions(value: Partial<PermissionMap> | undefined): PermissionMap {
  return Object.fromEntries(PERMISSION_FUNCTION_KEYS.map((fn) => [fn, value?.[fn] || "none"])) as PermissionMap;
}

/** Quyền thực tế = chuẩn của role, ghi đè bằng tùy chỉnh (giống BE, dùng để xem trước khi sửa quyền). */
export function effectivePermissions(role: string, standard: Partial<PermissionMap> | undefined, custom: Partial<PermissionMap> | undefined): PermissionMap {
  if (isAdminRole(role)) return fullPermissions();
  const base = completePermissions(standard);
  return Object.fromEntries(PERMISSION_FUNCTION_KEYS.map((fn) => [fn, custom?.[fn] || base[fn]])) as PermissionMap;
}

/** Chỉ giữ chức năng khác chuẩn của role (chỉnh về đúng chuẩn thì không còn là tùy chỉnh). */
export function diffFromStandard(standard: Partial<PermissionMap> | undefined, custom: Partial<PermissionMap>): Partial<PermissionMap> {
  const base = completePermissions(standard);
  return Object.fromEntries(
    Object.entries(custom).filter(([fn, level]) => isPermissionFunction(fn) && base[fn] !== level),
  ) as Partial<PermissionMap>;
}

/** Tài khoản có chức năng fn ở mức level trở lên không (edit bao gồm view). Admin luôn có. */
export function hasPermission(user: AuthUser | null, fn: PermissionFunction, level: PermissionLevel = "view"): boolean {
  if (!user) return false;
  if (isAdminRole(user.role)) return true;
  return levelRank(user.permissions?.[fn]) >= levelRank(level);
}

/** PI là chứng từ gốc của đơn nên thuộc quyền sửa Đơn hàng; chứng từ khác thuộc quyền sửa Chứng từ. */
export function canUploadDocumentType(user: AuthUser | null, documentCode: string): boolean {
  return documentCode.trim().toUpperCase() === "PI"
    ? hasPermission(user, "shipments", "edit")
    : hasPermission(user, "documents", "edit");
}
