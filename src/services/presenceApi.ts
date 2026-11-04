import { backendApiUrl } from "@/services/backendApiUrl";
import { createHttpApiError, createInvalidResponseError, createNetworkApiError, parseApiResponse } from "@/utils/apiError";
import { normalizeOnlineUser, type OnlineUser } from "@/utils/presence";

const HEARTBEAT_PATH = "/api/presence/heartbeat";
const LEAVE_PATH = "/api/presence/leave";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Gửi nhịp "tab này đang mở trang path" và nhận danh sách người đang online (kể cả mình, isMe = true).
 * token truyền vào (không đọc localStorage) để nhịp luôn đi bằng đúng phiên của component đang chạy.
 */
export async function sendPresenceHeartbeat(token: string, tabId: string, path: string): Promise<OnlineUser[]> {
  let response: Response;
  try {
    response = await fetch(backendApiUrl(HEARTBEAT_PATH), {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tabId, path }),
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof TypeError) throw createNetworkApiError("Người đang online", "POST", HEARTBEAT_PATH, error);
    throw error;
  }
  const { data: result, nonJsonPreview } = await parseApiResponse(response);
  if (!response.ok) throw createHttpApiError("Người đang online", "POST", HEARTBEAT_PATH, response, result, nonJsonPreview);
  const users = isRecord(result) && isRecord(result.data) ? result.data.users : null;
  if (!Array.isArray(users)) throw createInvalidResponseError("Người đang online", "POST", HEARTBEAT_PATH, nonJsonPreview);
  return users.map(normalizeOnlineUser).filter((user): user is OnlineUser => user !== null);
}

/**
 * Tab đóng / đăng xuất: báo BE bỏ tab này ngay (không chờ hết hạn). keepalive để request vẫn đi khi trang đang đóng.
 * Lỗi bỏ qua: BE tự xoá tab sau khoảng 90 giây không có nhịp.
 */
export function leavePresence(token: string, tabId: string): void {
  void fetch(backendApiUrl(LEAVE_PATH), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tabId }),
    keepalive: true,
  }).catch(() => undefined);
}
