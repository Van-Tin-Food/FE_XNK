"use client";

import Link from "next/link";
import React, { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import {
  getInternationalPaymentStatus, setManualGoodsPayment,
  type GoodsPaymentKind, type GoodsPaymentState, type InternationalPaymentStatus as Status,
} from "@/services/paymentCostApi";

// Tab Tổng quan: thanh toán tiền hàng (quốc tế) của hợp đồng theo 2 đợt — Cọc hàng và Thanh toán tiền còn lại, mỗi đợt một
// dòng trong thẻ thông tin — đã được duyệt chưa, kèm link đề nghị. Đã duyệt = có đề nghị chứa khoản đó được duyệt. Bảng tổng hợp mọi đơn nằm ở cột
// "Thanh toán QT" của bảng trang chủ.
// TẠM THỜI: kế toán / admin (canMark) đánh dấu tay "đã thanh toán" từng đợt cho đơn đã trả mà không có đề nghị trong hệ
// thống; đề nghị đã duyệt vẫn ưu tiên. Bấm nút thì hỏi xác nhận ngay tại chỗ.
const LABEL_KEYS: Record<GoodsPaymentState, string> = {
  approved: "intlPaymentApproved",
  manual: "intlPaymentManual",
  not_approved: "intlPaymentNotApproved",
};
const BADGE_CLASSES: Record<GoodsPaymentState, string> = {
  approved: "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300",
  manual: "bg-blue-light-50 text-blue-light-700 dark:bg-blue-light-500/10 dark:text-blue-light-300",
  not_approved: "bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300",
};
const ACTION_BUTTON = "inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium disabled:opacity-60";

function formatMarkDate(value: string): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export default function InternationalPaymentStatus({ contract }: { contract: string }) {
  const { t } = useLanguage();
  const { notify } = useSystemNotification();
  const [status, setStatus] = useState<Status | null>(null);
  // Đợt đang hỏi xác nhận (paid = đánh dấu / bỏ đánh dấu) và đợt đang gửi.
  const [confirming, setConfirming] = useState<{ kind: GoodsPaymentKind; paid: boolean } | null>(null);
  const [busy, setBusy] = useState<GoodsPaymentKind | null>(null);

  useEffect(() => {
    let active = true;
    getInternationalPaymentStatus(contract)
      .then((result) => { if (active) setStatus(result); })
      .catch(() => { if (active) setStatus(null); });
    return () => { active = false; };
  }, [contract]);

  const submit = async (kind: GoodsPaymentKind, paid: boolean) => {
    setBusy(kind);
    try {
      setStatus(await setManualGoodsPayment(contract, kind, paid));
      setConfirming(null);
    } catch (error) {
      notify(error instanceof Error && error.message ? error.message : t("intlPaymentMarkError"), "error");
    } finally {
      setBusy(null);
    }
  };

  if (!status) return null;
  // Mỗi đợt một dòng như các dòng thông tin khác của thẻ: tên đợt bên trái, trạng thái + đề nghị + nút bên phải.
  return (
    <>
      {status.items.map((item) => {
        const fee = t(item.key === "deposit" ? "intlPaymentDeposit" : "intlPaymentBalance");
        const asking = confirming?.kind === item.key ? confirming : null;
        // Đánh dấu khi chưa có đề nghị duyệt; đã có dấu tay thì luôn bỏ được.
        const action = !status.canMark ? null : item.manual ? false : item.status === "approved" ? null : true;
        return (
          <div key={item.key} className="flex flex-col gap-0.5 sm:flex-row sm:items-start">
            <span className="w-full flex-shrink-0 text-xs text-gray-400 sm:w-40 dark:text-gray-500">{fee}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              {/* Trạng thái + nút đánh dấu cùng một hàng (nút chữ ngắn, câu đầy đủ ở tooltip và ô xác nhận). */}
              <span className="flex min-w-0 items-center gap-1.5">
                <span className={`inline-flex min-w-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE_CLASSES[item.status]}`}>
                  {t(LABEL_KEYS[item.status])}
                </span>
                {action !== null && !asking && (
                  <button
                    type="button"
                    title={t(action ? "intlPaymentMarkPaid" : "intlPaymentUnmark")}
                    onClick={() => setConfirming({ kind: item.key, paid: action })}
                    className={`${ACTION_BUTTON} shrink-0 whitespace-nowrap ${action
                      ? "border-brand-300 text-brand-600 hover:bg-brand-50 dark:border-brand-500/40 dark:text-brand-400 dark:hover:bg-brand-500/10"
                      : "border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"}`}
                  >
                    {t(action ? "intlPaymentMarkShort" : "intlPaymentUnmark")}
                  </button>
                )}
              </span>
              {item.requests.length > 0 && (
                <span className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5">
                  {item.requests.slice(0, 3).map((request) => (
                    <Link key={request.id} href={`/payment-requests/${encodeURIComponent(request.id)}`} className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400">{request.id}</Link>
                  ))}
                </span>
              )}
              {item.manual && (
                <span className="text-[11px] text-gray-500 dark:text-gray-400">
                  {t("intlPaymentMarkedBy", { name: item.manual.byName || "—", date: formatMarkDate(item.manual.at) || "—" })}
                </span>
              )}
              {asking && (
                <span className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-2 text-xs text-gray-700 dark:bg-white/5 dark:text-gray-200">
                  <span className="min-w-0">{t(asking.paid ? "intlPaymentConfirmMark" : "intlPaymentConfirmUnmark", { fee })}</span>
                  <span className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => submit(item.key, asking.paid)}
                      className={`${ACTION_BUTTON} border-brand-500 bg-brand-500 text-white hover:bg-brand-600`}
                    >
                      {busy === item.key ? t("saving") : t("intlPaymentConfirm")}
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => setConfirming(null)}
                      className={`${ACTION_BUTTON} border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5`}
                    >
                      {t("cancel")}
                    </button>
                  </span>
                </span>
              )}
            </span>
          </div>
        );
      })}
    </>
  );
}
