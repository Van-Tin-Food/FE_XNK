"use client";

import React from "react";
import { useLanguage } from "@/context/LanguageContext";
import { PAYMENT_STATUS_LABEL_KEYS, type PaymentFlow, type PaymentRequestStatus } from "@/services/paymentRequestApi";

// Phần dùng chung của màn đề nghị thanh toán: nhãn trạng thái, luồng phí, định dạng ngày.

const STATUS_STYLES: Record<PaymentRequestStatus, string> = {
  0: "bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300",
  1: "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300",
  3: "bg-blue-light-50 text-blue-light-700 dark:bg-blue-light-500/10 dark:text-blue-light-300",
  [-1]: "bg-error-50 text-error-700 dark:bg-error-500/10 dark:text-error-300",
  2: "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300",
  [-2]: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

const FLOW_STYLES: Record<PaymentFlow, string> = {
  xanh: "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300",
  vang: "bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300",
  do: "bg-error-50 text-error-700 dark:bg-error-500/10 dark:text-error-300",
};

/** draft = chưa gửi lên Google Chat (status 0, chưa có ngày gửi). */
export function PaymentStatusBadge({ status, draft = false }: { status: PaymentRequestStatus; draft?: boolean }) {
  const { t } = useLanguage();
  const isDraft = draft && status === 0;
  const style = isDraft ? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" : STATUS_STYLES[status];
  return (
    <span className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>
      <span className="truncate">{isDraft ? t("prStatusDraft") : t(PAYMENT_STATUS_LABEL_KEYS[status])}</span>
    </span>
  );
}

export function PaymentFlowBadge({ flow }: { flow: PaymentFlow }) {
  const { t } = useLanguage();
  return <span className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${FLOW_STYLES[flow]}`}>{t(`prFlow_${flow}`)}</span>;
}

export function RedFlowBadge() {
  const { t } = useLanguage();
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-error-50 px-1.5 py-0.5 text-[11px] font-semibold text-error-700 dark:bg-error-500/10 dark:text-error-300">
      <span aria-hidden="true">⚠</span>{t("prFlow_do")}
    </span>
  );
}

/** YYYY-MM-DD → dd/mm/yyyy. */
export function formatDueDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value || "—";
}

/** Thời điểm (ISO) theo giờ Việt Nam. */
export function formatDateTime(value: string, language: "vi" | "en" = "vi"): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "vi-VN", {
    timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

/** Hạn thanh toán đã qua (so theo ngày giờ Việt Nam). Đã chi tiền / lưu trữ / từ chối / hủy thì không còn quá hạn. */
export function isOverdue(dueDate: string, status: PaymentRequestStatus): boolean {
  if (!dueDate || status === 2 || status === 3 || status === -1 || status === -2) return false;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  return dueDate < today;
}

export function InfoItem({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? "sm:col-span-2" : ""}`}>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <div className="mt-0.5 break-words text-sm font-medium text-gray-800 dark:text-white/90">{children}</div>
    </div>
  );
}
