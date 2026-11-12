"use client";
import React from "react";
import { useLanguage } from "@/context/LanguageContext";

/**
 * Nút "Bộ lọc" cho điện thoại (ẩn từ md): đặt cạnh ô tìm kiếm, bấm để mở / đóng các ô lọc còn lại của trang danh sách.
 * `activeCount` > 0 thì nút đổi màu và hiện số bộ lọc đang bật (thấy được cả khi đang đóng).
 * Ô lọc ẩn ở điện thoại khi đóng: thêm class `max-md:hidden` lúc `open` = false (xem ShipmentFilters, payment-requests).
 */
export default function MobileFilterToggle({ open, onToggle, activeCount = 0, controls }: {
  open: boolean;
  onToggle: () => void;
  activeCount?: number;
  /** id các vùng ô lọc (aria-controls), cách nhau bằng dấu cách. */
  controls?: string;
}) {
  const { t } = useLanguage();
  const highlighted = open || activeCount > 0;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      title={t("mobileFilterToggleHint")}
      className={`relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors md:hidden ${highlighted
        ? "border-brand-300 bg-brand-50 text-brand-600 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300"
        : "border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300"}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 5h16l-6 8v5l-4 2v-7z" />
      </svg>
      {t("mobileFilterToggle")}
      {activeCount > 0 && (
        <span className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-semibold text-white">{activeCount}</span>
      )}
    </button>
  );
}
