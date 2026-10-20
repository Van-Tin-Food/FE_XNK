"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import React, { useCallback, useEffect, useRef, useState } from "react";
import ShipmentDetailView from "@/components/shipment/ShipmentDetailView";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import { fetchShipments, getCachedShipments } from "@/services/shipmentApi";
import type { Shipment } from "@/types/shipment";
import { SHIPMENT_LIST_PATH } from "@/utils/shipmentRoutes";

function findShipment(shipments: Shipment[], orderCode: string): Shipment | null {
  const wanted = orderCode.trim().toUpperCase();
  return shipments.find((shipment) => shipment.orderCode.trim().toUpperCase() === wanted) || null;
}

// Mỗi lần tải danh sách tạo object mới (updatedAt, id theo vị trí); chỉ thay đơn đang xem khi dữ liệu thật sự đổi,
// để tải lại ngầm không xoá form đang sửa.
function shipmentDataKey(shipment: Shipment): string {
  return JSON.stringify([shipment.status, shipment.summaryFields, shipment.documents, shipment.database, shipment.timeUpdate]);
}

// Chi tiết một đơn hàng (trước là modal trên trang chủ). Link dạng /shipments/<mã đơn>?tab=details.
export default function ShipmentDetailPage() {
  const { t } = useLanguage();
  const { can } = useAuth();
  const { notify } = useSystemNotification();
  const router = useRouter();
  const params = useParams<{ orderCode: string }>();
  const orderCode = decodeURIComponent(String(params?.orderCode || ""));
  const canViewShipments = can("shipments");
  // Vừa xem danh sách: hiện ngay từ cache rồi mới tải lại ngầm.
  const [shipment, setShipment] = useState<Shipment | null>(() => findShipment(getCachedShipments()?.shipments || [], orderCode));
  const [isLoading, setIsLoading] = useState(() => !shipment);
  const [loadError, setLoadError] = useState("");
  const hasShipmentRef = useRef(Boolean(shipment));
  // Đánh số từng lần tải: lần tải ngầm lúc mở trang về sau lần tải sau khi lưu thì bỏ, không ghi đè dữ liệu mới bằng cũ.
  const loadSequenceRef = useRef(0);

  const loadShipment = useCallback(async () => {
    const sequence = ++loadSequenceRef.current;
    try {
      const result = await fetchShipments();
      if (sequence !== loadSequenceRef.current) return;
      const found = findShipment(result.shipments, orderCode);
      hasShipmentRef.current = Boolean(found);
      setShipment((current) => (current && found && shipmentDataKey(current) === shipmentDataKey(found) ? current : found));
      setLoadError("");
    } catch (error) {
      if (sequence !== loadSequenceRef.current) return;
      const message = error instanceof Error ? error.message : t("shipmentLoadError");
      setLoadError(message);
      // Đang xem đơn (dữ liệu cũ vẫn hiện): báo để người dùng biết dữ liệu có thể chưa mới nhất.
      if (hasShipmentRef.current) notify(`${t("shipmentLoadError")}: ${message}`, "warning");
    } finally {
      if (sequence === loadSequenceRef.current) setIsLoading(false);
    }
  }, [notify, orderCode, t]);

  useEffect(() => {
    if (!canViewShipments) return;
    const timer = window.setTimeout(() => void loadShipment(), 0);
    return () => window.clearTimeout(timer);
  }, [canViewShipments, loadShipment]);

  const goToList = useCallback(() => router.push(SHIPMENT_LIST_PATH), [router]);

  const message = (title: string, description?: string) => (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <Link href={SHIPMENT_LIST_PATH} className="inline-flex min-h-9 items-center text-sm text-gray-500 hover:text-brand-600 dark:text-gray-400">← {t("backToShipmentList")}</Link>
      <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center dark:border-gray-800 dark:bg-gray-900 sm:p-10">
        <p className="break-words text-sm font-semibold text-gray-800 dark:text-white/90">{title}</p>
        {description && <p className="mt-1 break-words text-sm text-gray-500 dark:text-gray-400">{description}</p>}
      </div>
    </div>
  );

  if (!canViewShipments) return message(t("noShipmentPermissionTitle"), t("noShipmentPermissionDescription"));

  if (!shipment) {
    if (isLoading) {
      return (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-gray-400">
          <span className="h-9 w-9 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" aria-hidden="true" />
          <p className="text-sm">{t("loadingShipmentDetail", { orderCode })}</p>
        </div>
      );
    }
    return loadError
      ? message(t("shipmentLoadError"), loadError)
      : message(t("shipmentNotFound", { orderCode }), t("shipmentNotFoundHint"));
  }

  return <ShipmentDetailView key={shipment.orderCode} shipment={shipment} onBack={goToList} onRefresh={loadShipment} />;
}
