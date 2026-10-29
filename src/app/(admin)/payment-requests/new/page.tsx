"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import PaymentRequestWizard from "@/components/payment/PaymentRequestWizard";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { canCreatePaymentRequests } from "@/utils/paymentRequest";

// Bước 1 của quy trình: tạo đề nghị theo từng câu hỏi; lưu xong chuyển sang trang quy trình để xem lại và gửi.
export default function NewPaymentRequestPage() {
  const { t } = useLanguage();
  const { can } = useAuth();
  const router = useRouter();

  if (!canCreatePaymentRequests(can)) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300">
        {t("prNoPermission")}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <header>
        <Link href="/payment-requests" className="text-sm text-gray-500 hover:text-brand-600">← {t("prBackToList")}</Link>
        <h1 className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{t("prNewTitle")}</h1>
      </header>
      <PaymentRequestWizard onCancel={() => router.push("/payment-requests")} onSaved={(saved) => router.push(`/payment-requests/${encodeURIComponent(saved.id)}`)} />
    </div>
  );
}
