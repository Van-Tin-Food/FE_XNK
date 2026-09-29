import type { AuthUser } from "@/types/auth";

export const RBAC_ROLES = ["admin", "it", "logistic", "van_chuyen"] as const;
export const RBAC_SESSIONS = ["all", "manage", "view"] as const;

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
  | "sendEmail";

const ROLE_ALIASES: Record<string, RbacRole> = {
  xnk: "logistic",
  logisstic: "logistic",
  "mua hang": "logistic",
  "mua hàng": "logistic",
  nhap_kho: "van_chuyen",
  "nhập kho": "van_chuyen",
};

const SESSION_ALIASES: Record<string, RbacSession> = {
  edit: "manage",
  department: "manage",
  restricted: "view",
};

const ROLE_ACTIONS: Record<RbacRole, Set<ShipmentActionPermissionKey> | "all"> = {
  admin: "all",
  it: new Set(["viewActivityLogs", "viewUsers", "viewMasterData", "viewEmailLogs"]),
  logistic: new Set([
    "createShipment", "uploadDocument", "passDocument", "archiveDocuments",
    "editReturnItem", "editShipmentDetails", "cancelShipment", "sendEmail", "viewEmailLogs",
  ]),
  van_chuyen: new Set(["uploadDocument", "editReturnItem"]),
};

const MANAGE_ACTIONS = new Set<ShipmentActionPermissionKey>([
  "createShipment", "uploadDocument", "passDocument", "archiveDocuments",
  "editReturnItem", "editShipmentDetails", "cancelShipment", "manageUsers",
  "manageMasterData", "registerUser", "updateUserPassword", "sendEmail",
]);

export function normalizeRole(value?: string): string {
  const role = String(value || "").trim().toLocaleLowerCase("vi");
  return ROLE_ALIASES[role] || role;
}

export function normalizeSession(value?: string): RbacSession {
  const session = String(value || "").trim().toLocaleLowerCase("vi");
  return SESSION_ALIASES[session]
    || (RBAC_SESSIONS.includes(session as RbacSession) ? session as RbacSession : "view");
}

export function canViewSensitiveData(user: AuthUser | null): boolean {
  return normalizeRole(user?.role) === "admin";
}

export function canPerformShipmentAction(user: AuthUser | null, action: ShipmentActionPermissionKey): boolean {
  const role = normalizeRole(user?.role) as RbacRole;
  const session = normalizeSession(user?.session);
  const actions = ROLE_ACTIONS[role];
  if (!user || !actions) return false;
  if (role === "admin") return true;
  if (actions !== "all" && !actions.has(action)) return false;
  return !MANAGE_ACTIONS.has(action) || session === "manage";
}

export const SHIPMENT_ACTION_PERMISSIONS = Object.fromEntries(
  [...new Set(Object.values(ROLE_ACTIONS).flatMap((actions) => actions === "all" ? [] : [...actions]))]
    .map((action) => [action, []]),
) as Record<ShipmentActionPermissionKey, never[]>;
