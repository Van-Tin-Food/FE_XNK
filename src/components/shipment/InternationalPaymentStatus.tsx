"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { getInternationalPaymentStatus, type GoodsPaymentState, type InternationalPaymentStatus as Status } from "@/services/paymentCostApi";

// Tab Tổng quan: thanh toán tiền hàng (quốc tế) của hợp đồng theo 2 đợt — Cọc hàng và Thanh toán tiền còn lại — đã được
// duyệt chưa (bộ phận mua hàng biết đã thanh toán tiền cọc / tiền hàng chưa). Đã duyệt = có đề nghị chứa khoản đó được
// duyệt; đơn đã qua vận chuyển biển mà chưa có đề nghị = đã giao (coi như đã thanh toán). Kèm link các đề nghị liên quan.
const LABEL_KEYS: Record<GoodsPaymentState, string> = {
  approved: "intlPaymentApproved",
  delivered: "intlPaymentDelivered",
  not_approved: "intlPaymentNotApproved",
};

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
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start">
      <span className="w-full flex-shrink-0 text-xs text-gray-400 sm:w-40 dark:text-gray-500">{t("intlPayment")}</span>
      <span className="flex min-w-0 flex-col gap-1">
        {status.items.map((item) => {
          const done = item.status !== "not_approved";
          return (
            <span key={item.key} className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="text-xs text-gray-600 dark:text-gray-300">{t(item.key === "deposit" ? "intlPaymentDeposit" : "intlPaymentBalance")}:</span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${done ? "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300" : "bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300"}`}>
                {t(LABEL_KEYS[item.status])}
              </span>
              {item.requests.slice(0, 3).map((request) => (
                <Link key={request.id} href={`/payment-requests/${encodeURIComponent(request.id)}`} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">{request.id}</Link>
              ))}
            </span>
          );
        })}
      </span>
    </div>
  );
}
