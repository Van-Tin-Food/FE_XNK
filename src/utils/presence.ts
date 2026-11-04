/** Người đang online do BE trả về (POST /api/presence/heartbeat). */
export interface OnlineUser {
  id: number;
  name: string;
  email: string | null;
  role: string;
  /** Trang của tab vừa gửi nhịp gần nhất. */
  path: string;
  /** Mọi trang đang mở ở các tab của người đó. */
  paths: string[];
  lastSeenAt: string;
  isMe: boolean;
}

/** Tên trang để hiện "Đang xem: ..." — key bản dịch + biến, hoặc null nếu không nhận ra (hiện đường dẫn). */
export type PresencePageLabel = { key: string; vars?: Record<string, string> } | null;

const PAGE_LABEL_KEYS: Array<[prefix: string, key: string]> = [
  ["/payment-requests", "paymentRequests"],
  ["/payment-costs", "myCosts"],
  ["/cost-management", "costManagement"],
  ["/reports", "reportsMenu"],
  ["/master-data", "masterDataManagement"],
  ["/account-management", "accountManagement"],
  ["/activity-logs", "logsMenu"],
  ["/email", "emailSendButton"],
  ["/document-sync", "documentSync"],
  ["/user-guide", "userGuide"],
  ["/profile", "myProfile"],
];

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function presencePageLabel(path: string): PresencePageLabel {
  const clean = String(path || "").replace(/\/+$/, "") || "/";
  if (clean === "/") return { key: "importExport" };
  if (clean === "/shipments/new") return { key: "presencePageNewShipment" };
  const order = clean.match(/^\/shipments\/([^/]+)$/);
  if (order) return { key: "presencePageShipment", vars: { orderCode: decodeSegment(order[1]) } };
  const match = PAGE_LABEL_KEYS.find(([prefix]) => clean === prefix || clean.startsWith(`${prefix}/`));
  return match ? { key: match[1] } : null;
}

function samePath(a: string, b: string): boolean {
  const normalize = (value: string) => String(value || "").replace(/\/+$/, "") || "/";
  return Boolean(a && b) && normalize(a) === normalize(b);
}

/** Người đó đang mở (ở một tab bất kỳ) đúng trang mình đang xem. */
export function isOnSamePage(user: OnlineUser, currentPath: string): boolean {
  return [user.path, ...user.paths].some((path) => samePath(path, currentPath));
}

/**
 * Người khác đang online (bỏ chính mình — avatar của mình đã ở góc header), người cùng trang lên trước,
 * sau đó theo tên để thứ tự avatar không nhảy qua lại sau mỗi nhịp.
 */
export function othersOnline(users: OnlineUser[], currentPath: string): OnlineUser[] {
  return users
    .filter((user) => !user.isMe)
    .map((user) => ({ user, same: isOnSamePage(user, currentPath) }))
    .sort((a, b) => Number(b.same) - Number(a.same) || a.user.name.localeCompare(b.user.name, "vi"))
    .map(({ user }) => user);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Chuẩn hoá một dòng người online từ BE; dòng sai dạng thì bỏ. */
export function normalizeOnlineUser(row: unknown): OnlineUser | null {
  if (!isRecord(row)) return null;
  const id = Number(row.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const name = String(row.name ?? "").trim() || `#${id}`;
  return {
    id,
    name,
    email: String(row.email ?? "").trim() || null,
    role: String(row.role ?? "").trim(),
    path: String(row.path ?? ""),
    paths: Array.isArray(row.paths) ? row.paths.map(String) : [],
    lastSeenAt: String(row.lastSeenAt ?? ""),
    isMe: row.isMe === true,
  };
}
