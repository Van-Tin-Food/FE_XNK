/** Trang chi tiết một đơn hàng (trước đây là modal trên trang chủ). */
export function shipmentDetailPath(orderCode: string, tab?: string): string {
  const path = `/shipments/${encodeURIComponent(orderCode.trim())}`;
  return tab ? `${path}?tab=${encodeURIComponent(tab)}` : path;
}

export const SHIPMENT_LIST_PATH = "/";
export const CREATE_SHIPMENT_PATH = "/shipments/new";
