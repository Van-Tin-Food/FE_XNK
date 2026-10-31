"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import CreateShipmentForm from "@/components/shipment/CreateShipmentForm";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { fetchShipments, getCachedShipments } from "@/services/shipmentApi";
import { SHIPMENT_LIST_PATH, shipmentDetailPath } from "@/utils/shipmentRoutes";

// Tạo đơn mới từ file PI hoặc nhập tay (trước là modal trên trang chủ). Tạo xong mở chi tiết đơn vừa tạo để upload tiếp chứng từ.
export default function CreateShipmentPage() {
  const { t } = useLanguage();
  const { can } = useAuth();
  const router = useRouter();
  const canCreateShipment = can("shipments", "edit");
  // Mã đơn đã có để báo trùng ngay khi OCR xong; BE vẫn chặn trùng khi ghi.
  const [existingOrderCodes, setExistingOrderCodes] = useState<string[]>(
    () => (getCachedShipments()?.shipments || []).map((shipment) => shipment.orderCode),
  );

  useEffect(() => {
    if (!canCreateShipment || getCachedShipments()) return;
    let cancelled = false;
    void fetchShipments()
      .then((result) => { if (!cancelled) setExistingOrderCodes(result.shipments.map((shipment) => shipment.orderCode)); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [canCreateShipment]);

  if (!canCreateShipment) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3">
        <Link href={SHIPMENT_LIST_PATH} className="inline-flex min-h-9 items-center text-sm text-gray-500 hover:text-brand-600 dark:text-gray-400">← {t("backToShipmentList")}</Link>
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 sm:p-10">
          {t("noCreateShipmentPermission")}
        </div>
      </div>
    );
  }

  return (
    <CreateShipmentForm
      existingOrderCodes={existingOrderCodes}
      onCancel={() => router.push(SHIPMENT_LIST_PATH)}
      onCreated={(orderCode) => router.push(shipmentDetailPath(orderCode))}
    />
  );
}
