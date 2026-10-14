import type { AuthUser } from "@/types/auth";

export const RBAC_ROLES = ["admin", "it", "logistic", "van_chuyen"] as const;
export const RBAC_SESSIONS = ["manage", "view"] as const;

export type RbacRole = (typeof RBAC_ROLES)[number];
export type RbacSession = (typeof RBAC_SESSIONS)[number];

export type ShipmentActionPermissionKey =
  | "createShipment"
  | "uploadDocument"
  | "passDocument"
  | "archiveDocuments"
  | "editReturnItem"
  | "editShipmentDetails"
  | "cancelShipment"
  | "viewActivityLogs"
  | "viewUsers"
  | "manageUsers"
  | "viewMasterData"
  | "viewEmailLogs"
  | "manageMasterData"
  | "registerUser"
  | "updateUserPassword"
  | "viewEmailTools"
  | "viewTracking"
  | "sendEmail"
  | "viewDocumentSync"
  | "syncDocuments"
  | "exportShipments"
  // Dữ liệu nhạy cảm (đồng bộ với SENSITIVE_DATA_VIEWERS trong be/src/config/rbac.js):
  | "viewPurchaseAmounts"   // đơn giá, tổng tiền hàng
  | "viewSupplierContact";  // email, SĐT, địa chỉ nhà cung cấp

type ActionAccess = {
  view: ShipmentActionPermissionKey[];
  manage: ShipmentActionPermissionKey[];
};

// Chỉnh quyền giao diện tại đây.
// - view: được xem màn hình/dữ liệu.
// - manage: được thực hiện thao tác thay đổi dữ liệu.
// - admin: luôn có toàn quyền, không cần liệt kê từng action.
const ROLE_ACCESS: Record<Exclude<RbacRole, "admin">, ActionAccess> = {
  it: {
    // IT chỉ được xem dữ liệu. Session view/manage không làm thay đổi quyền IT.
    view: ["viewActivityLogs", "viewUsers", "viewMasterData", "viewEmailLogs", "viewEmailTools", "viewDocumentSync", "viewTracking"],
    manage: [],
  },
  logistic: {
    // Xuất Excel chỉ đọc dữ liệu nên có ở cả session view và manage.
    view: ["viewTracking", "exportShipments", "viewPurchaseAmounts"],
    manage: [
      "createShipment", "uploadDocument", "passDocument", "editShipmentDetails",
      "cancelShipment", "syncDocuments", "manageMasterData",
    ],
  },
  van_chuyen: {
    view: ["viewTracking", "exportShipments"],
    manage: ["uploadDocument", "passDocument", "archiveDocuments", "editReturnItem", "syncDocuments", "manageMasterData"],
  },
};

export function normalizeRole(value?: string): string {
  const role = String(value || "").trim().toLocaleLowerCase("vi");
  return role;
}

export function normalizeSession(value?: string): RbacSession {
  const session = String(value || "").trim().toLocaleLowerCase("vi");
  return RBAC_SESSIONS.includes(session as RbacSession) ? session as RbacSession : "view";
}

export function canViewSensitiveData(user: AuthUser | null): boolean {
  return normalizeRole(user?.role) === "admin";
}

export function canPerformShipmentAction(user: AuthUser | null, action: ShipmentActionPermissionKey): boolean {
  const role = normalizeRole(user?.role) as RbacRole;
  const session = normalizeSession(user?.session);
  if (!user || !role || !RBAC_ROLES.includes(role)) return false;
  if (role === "admin") return true;

  const access = ROLE_ACCESS[role];
  if (role === "it") return access.view.includes(action);
  if (access.manage.includes(action)) return session === "manage";
  return access.view.includes(action);
}

export function canUploadDocumentType(user: AuthUser | null, documentCode: string): boolean {
  if (!canPerformShipmentAction(user, "uploadDocument")) return false;
  return normalizeRole(user?.role) !== "van_chuyen" || documentCode.trim().toUpperCase() !== "PI";
}

// Đủ mọi action (TypeScript báo lỗi nếu thiếu key). Trước đây danh sách chỉ lấy action có trong
// ROLE_ACCESS nên action chỉ-admin không có trong useAuth().permissions và admin bị ẩn nút.
const ALL_SHIPMENT_ACTIONS: Record<ShipmentActionPermissionKey, true> = {
  createShipment: true, uploadDocument: true, passDocument: true, archiveDocuments: true,
  editReturnItem: true, editShipmentDetails: true, cancelShipment: true, viewActivityLogs: true,
  viewUsers: true, manageUsers: true, viewMasterData: true, viewEmailLogs: true,
  manageMasterData: true, registerUser: true, updateUserPassword: true, viewEmailTools: true,
  viewTracking: true, sendEmail: true, viewDocumentSync: true, syncDocuments: true,
  exportShipments: true, viewPurchaseAmounts: true, viewSupplierContact: true,
};

export const SHIPMENT_ACTION_PERMISSIONS = Object.fromEntries(
  Object.keys(ALL_SHIPMENT_ACTIONS).map((action) => [action, []]),
) as Record<ShipmentActionPermissionKey, never[]>;
