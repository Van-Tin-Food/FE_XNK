"use client";

import { useParams } from "next/navigation";
import PaymentRequestProcess from "@/components/payment/PaymentRequestProcess";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";

// Quy trình một đề nghị thanh toán (link "Mở trên hệ thống" trong thẻ Google Chat trỏ tới đây).
export default function PaymentRequestPage() {
  const { t } = useLanguage();
  const { can } = useAuth();
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id || ""));

  if (!can("paymentRequests")) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300">
        {t("prNoPermission")}
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-4xl">
      <PaymentRequestProcess key={id} id={id} />
    </div>
  );
}
