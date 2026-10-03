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
  | "sendEmail"
  | "syncDocuments"
  | "exportShipments";

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
    view: ["viewActivityLogs", "viewUsers", "viewMasterData", "viewEmailLogs"],
    manage: [],
  },
  logistic: {
    view: ["viewEmailLogs"],
    manage: [
      "createShipment", "uploadDocument", "passDocument", "archiveDocuments",
      "editReturnItem", "editShipmentDetails", "cancelShipment",
      "syncDocuments", "exportShipments",
    ],
  },
  van_chuyen: {
    view: [],
    manage: ["uploadDocument", "editReturnItem", "syncDocuments", "exportShipments"],
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
  if (access.manage.includes(action)) return session === "manage";
  return access.view.includes(action);
}

export const SHIPMENT_ACTION_PERMISSIONS = Object.fromEntries(
  [...new Set(Object.values(ROLE_ACCESS).flatMap((access) => [...access.view, ...access.manage]))]
    .map((action) => [action, []]),
) as Record<ShipmentActionPermissionKey, never[]>;
