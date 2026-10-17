"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { getInternationalPaymentStatus, type InternationalPaymentStatus as Status } from "@/services/paymentCostApi";

// Tab Tổng quan: hợp đồng đã được duyệt thanh toán quốc tế chưa (bộ phận mua hàng biết đã thanh toán tiền cọc / tiền hàng
// chưa). Đã duyệt = có đề nghị chứa khoản "Thanh toán quốc tế" của hợp đồng được duyệt; đơn đã qua vận chuyển biển mà
// chưa có đề nghị = đã giao (coi như đã thanh toán). Kèm link các đề nghị liên quan.
export default function InternationalPaymentStatus({ contract }: { contract: string }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let active = true;
    getInternationalPaymentStatus(contract)
      .then((result) => { if (active) setStatus(result); })
      .catch(() => { if (active) setStatus(null); });
    return () => { active = false; };
  }, [contract]);

  if (!status) return null;
  const approved = status.status === "approved";
  const delivered = status.status === "delivered";
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start">
      <span className="w-full flex-shrink-0 text-xs text-gray-400 sm:w-40 dark:text-gray-500">{t("intlPayment")}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${approved || delivered ? "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300" : "bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300"}`}>
          {approved ? t("intlPaymentApproved") : delivered ? t("intlPaymentDelivered") : t("intlPaymentNotApproved")}
        </span>
        {status.requests.slice(0, 3).map((request) => (
          <Link key={request.id} href={`/payment-requests/${encodeURIComponent(request.id)}`} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">{request.id}</Link>
        ))}
      </span>
    </div>
  );
}
