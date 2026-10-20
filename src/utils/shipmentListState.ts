"use client";

import { useEffect } from "react";

// Trạng thái danh sách đơn (bộ lọc, sắp xếp / trang, vị trí cuộn) chỉ giữ lại khi mở trang chi tiết / tạo đơn rồi quay
// về (nút X, "Danh sách đơn hàng", Back của trình duyệt). F5, bấm logo, bấm menu "Mua hàng & ETA" đều về bộ lọc mặc định.
export const SHIPMENT_FILTER_STATE_KEY = "xnk.shipmentDashboard";
export const SHIPMENT_SCROLL_STATE_KEY = "xnk.shipmentDashboard.scrollY";
export const SHIPMENT_TABLE_STATE_KEY = "xnk.shipmentTable";
const RESTORE_FLAG_KEY = "xnk.shipmentDashboard.restore";
/** Phát khi bấm logo / menu lúc đang ở danh sách (Next không mount lại trang) để danh sách tự về mặc định. */
export const SHIPMENT_LIST_RESET_EVENT = "xnk:shipment-list-reset";
/** Gắn lên link về danh sách (logo, menu) để bấm vào là bỏ bộ lọc đã nhớ. */
export const SHIPMENT_LIST_RESET_ATTR = "data-shipment-list-reset";

function getStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function clearSavedState(storage: Storage) {
  storage.removeItem(SHIPMENT_FILTER_STATE_KEY);
  storage.removeItem(SHIPMENT_SCROLL_STATE_KEY);
  storage.removeItem(SHIPMENT_TABLE_STATE_KEY);
}

/** Rời danh sách sang trang chi tiết / tạo đơn: lần quay về tiếp theo giữ nguyên bộ lọc. */
export function markShipmentListRestore() {
  try {
    getStorage()?.setItem(RESTORE_FLAG_KEY, "1");
  } catch {
    // Trình duyệt chặn lưu trữ: quay về chỉ mất phần nhớ bộ lọc.
  }
}

/**
 * Gọi khi danh sách khởi tạo state: có cờ quay về thì trả true (dùng trạng thái đã lưu), không có thì xoá trạng thái cũ
 * để danh sách và bảng con cùng về mặc định. Không xoá cờ ở đây vì StrictMode gọi initializer hai lần; xoá trong effect
 * bằng finishShipmentListRestore().
 */
export function prepareShipmentListState(): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    if (storage.getItem(RESTORE_FLAG_KEY) === "1") return true;
    clearSavedState(storage);
  } catch {
    // Bỏ qua: dùng bộ lọc mặc định.
  }
  return false;
}

/** Đã khôi phục xong: F5 hay vào lại danh sách sau đó đều về mặc định. */
export function finishShipmentListRestore() {
  try {
    getStorage()?.removeItem(RESTORE_FLAG_KEY);
  } catch {
    // Bỏ qua.
  }
}

/** Bỏ bộ lọc đã nhớ; đang ở danh sách thì báo để về mặc định ngay. */
export function resetShipmentListState() {
  const storage = getStorage();
  try {
    storage?.removeItem(RESTORE_FLAG_KEY);
    if (storage) clearSavedState(storage);
  } catch {
    // Bỏ qua.
  }
  window.dispatchEvent(new Event(SHIPMENT_LIST_RESET_EVENT));
}

/**
 * Bắt lần bấm vào link có SHIPMENT_LIST_RESET_ATTR ở pha capture của window, chạy trước cả bộ chặn rời trang
 * (useLeaveGuard chặn ở document), nên đang sửa dở ở trang chi tiết rồi bấm menu và đồng ý rời trang vẫn về mặc định.
 */
export function useShipmentListResetLinks() {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as Element | null;
      if (target?.closest?.(`[${SHIPMENT_LIST_RESET_ATTR}]`)) resetShipmentListState();
    };
    window.addEventListener("click", handleClick, true);
    return () => window.removeEventListener("click", handleClick, true);
  }, []);
}
