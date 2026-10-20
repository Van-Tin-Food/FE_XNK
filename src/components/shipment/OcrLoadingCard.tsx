"use client";
import React, { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";

/** Vòng xoay nhỏ đặt cạnh chữ trong nút (vd nút upload của chứng từ đang OCR). */
export function InlineSpinner() {
  return <span aria-hidden="true" className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

/**
 * Khung chờ OCR: vòng xoay, tên file và số giây đã chạy. OCR file scan (Tesseract + AI) có thể mất cả phút, nên đếm giây
 * để người dùng biết hệ thống vẫn đang chạy, không bấm lại hay đóng trang.
 */
export default function OcrLoadingCard({ title, fileName, className = "" }: { title: string; fileName?: string; className?: string }) {
  const { t } = useLanguage();
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div role="status" aria-live="polite" className={`flex min-w-0 items-center gap-3 rounded-xl border border-brand-100 bg-brand-50/70 px-4 py-3 dark:border-brand-500/20 dark:bg-brand-500/10 ${className}`}>
      <span aria-hidden="true" className="h-8 w-8 shrink-0 animate-spin rounded-full border-[3px] border-brand-500 border-t-transparent" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-brand-700 dark:text-brand-300">{title}</p>
        {fileName && <p className="truncate text-xs font-medium text-gray-700 dark:text-gray-300" title={fileName}>{fileName}</p>}
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t("ocrLoadingHint", { seconds })}</p>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-brand-100 dark:bg-brand-500/20">
          <div className="h-full w-full animate-pulse rounded-full bg-brand-400" />
        </div>
      </div>
    </div>
  );
}
