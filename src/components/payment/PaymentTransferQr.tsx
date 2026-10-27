"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { getPaymentTransferQr, type PaymentTransferQr as TransferQr } from "@/services/paymentRequestApi";
import { formatMoney } from "@/utils/paymentRequest";

// Mã VietQR chuyển khoản của đề nghị (chuyển khoản trong nước bằng VND): quét bằng app ngân hàng là điền sẵn tài khoản,
// số tiền, nội dung. Ảnh do BE tạo (không gửi dữ liệu ra dịch vụ ngoài). Kèm thông tin người nhận để đối chiếu với tên
// app ngân hàng hiện ra trước khi chuyển. Không tạo được (chưa chọn ngân hàng trong danh sách, USD...) thì hiện `fallback`
// (thông tin chuyển khoản dạng chữ) kèm lý do; có mã thì khối QR đã ghi đủ người nhận / tài khoản nên không hiện fallback.

interface Props {
  requestId: string;
  /** Đổi khi đề nghị được sửa (ví dụ updatedAt) để tải lại mã. */
  version: string;
  /** Hiện khi không có mã QR (hoặc tải mã lỗi), ví dụ thông tin chuyển khoản quốc tế. */
  fallback?: ReactNode;
}

export default function PaymentTransferQr({ requestId, version, fallback }: Props) {
  const { t, language } = useLanguage();
  const [qr, setQr] = useState<TransferQr | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    getPaymentTransferQr(requestId, controller.signal)
      .then((data) => { setQr(data); setError(""); })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : t("prQrLoadError"));
      });
    return () => controller.abort();
  }, [requestId, t, version]);

  if (error) return <>{fallback}<p className="text-xs text-error-600 dark:text-error-400">{error}</p></>;
  if (!qr) return <div className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />;
  if (!qr.available) {
    // Tiền mặt: không có lý do để ghi.
    const reason = qr.reason && qr.reason !== "not_transfer" ? qr.reason : "";
    return (
      <>
        {fallback}
        {reason && <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">{t(`prQrReason_${reason}`)}</p>}
      </>
    );
  }

  const rows: Array<[string, string]> = [
    [t("prQrReceiver"), qr.accountName || "—"],
    [t("prQrBank"), qr.bankName || "—"],
    [t("prQrAccount"), qr.account],
    [t("prQrAmount"), qr.amount ? formatMoney(qr.amount, "VND", language) : "—"],
    [t("prQrContent"), qr.content || "—"],
  ];
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-200 p-3 sm:flex-row sm:items-start sm:p-4 dark:border-gray-700">
      {/* eslint-disable-next-line @next/next/no-img-element -- ảnh QR là data URL do BE tạo, không qua tối ưu ảnh của Next */}
      <img src={qr.image} alt={t("prQrTitle")} width={176} height={176} className="mx-auto h-44 w-44 shrink-0 rounded-lg border border-gray-100 bg-white p-1 sm:mx-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-800 dark:text-white/90">{t("prQrTitle")}</p>
        <p className="mt-0.5 text-xs text-gray-500">{t("prQrHint")}</p>
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-gray-500">{label}</dt>
              <dd className="break-words font-medium text-gray-800 dark:text-white/90">{value}</dd>
            </div>
          ))}
        </dl>
        <a href={qr.image} download={`QR-${requestId}.png`}
          className="mt-3 flex h-10 w-fit items-center gap-2 rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
          ⬇ {t("prQrDownload")}
        </a>
      </div>
    </div>
  );
}
