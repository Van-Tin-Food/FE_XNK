"use client";

import React, { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";

interface DashboardInfoBarProps {
  lastUpdated: string;
  updatedBy?: string;
  onRefresh: () => Promise<void>;
  onExport?: () => Promise<void>;
  isExporting?: boolean;
}

function formatRelativeTime(isoString: string, translate: (key: string, variables?: Record<string, string | number>) => string): string {
  const date = new Date(isoString);
  const diffMins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMins < 1) return translate("justNow");
  if (diffMins < 60) return translate("minutesAgo", { count: diffMins });
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return translate("hoursAgo", { count: diffHours });
  return translate("daysAgo", { count: Math.floor(diffHours / 24) });
}

function formatDateTime(isoString: string, language: "vi" | "en"): string {
  return new Date(isoString).toLocaleString(language === "en" ? "en-GB" : "vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DashboardInfoBar({ lastUpdated, updatedBy, onRefresh, onExport, isExporting = false }: DashboardInfoBarProps) {
  const { user } = useAuth();
  const { language, t } = useLanguage();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showRefreshSuccess, setShowRefreshSuccess] = useState(false);
  const updaterName = user?.name?.trim() || updatedBy || t("systemAdmin");

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setShowRefreshSuccess(false);
    try {
      await onRefresh();
      setShowRefreshSuccess(true);
      window.setTimeout(() => setShowRefreshSuccess(false), 3000);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    // Điện thoại: một hàng — dòng cập nhật (chữ nhỏ) bên trái, 2 nút chỉ còn biểu tượng (tên ở tooltip / aria-label) bên phải.
    <div className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900 sm:gap-3 sm:rounded-2xl sm:px-4 sm:py-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 sm:flex">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <p className="line-clamp-2 text-[11px] font-medium text-gray-700 dark:text-gray-300 sm:line-clamp-none sm:text-xs">
          {t("lastUpdated", { time: `${formatRelativeTime(lastUpdated, t)} · ${formatDateTime(lastUpdated, language)}` })}
          <span className="text-gray-400"> {t("updatedBy", { name: updaterName })}</span>
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {showRefreshSuccess && <span className="text-xs font-medium text-success-600" role="status">✓<span className="max-sm:sr-only"> {t("refreshSucceeded")}</span></span>}
        {onExport && (
          <button
            type="button"
            onClick={() => void onExport()}
            disabled={isExporting || isRefreshing}
            title={t("exportExcel")}
            aria-label={isExporting ? t("exportingExcel") : t("exportExcel")}
            className="inline-flex h-9 min-w-9 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-success-200 bg-success-50 px-2.5 text-xs sm:h-auto sm:px-4 sm:py-2 font-semibold text-success-700 transition-all hover:border-success-300 hover:bg-success-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-400 dark:hover:bg-success-500/20"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={isExporting ? "animate-spin" : ""} aria-hidden="true">
              {isExporting ? <><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></> : <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>}
            </svg>
            <span className="max-sm:hidden">{isExporting ? t("exportingExcel") : t("exportExcel")}</span>
          </button>
        )}
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          title={t("refreshSystemData")}
          aria-label={isRefreshing ? t("updating") : t("refreshData")}
          className="inline-flex h-9 min-w-9 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-brand-200 bg-brand-50 px-2.5 text-xs sm:h-auto sm:px-4 sm:py-2 font-semibold text-brand-600 transition-all hover:border-brand-300 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-400 dark:hover:bg-brand-500/20"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={isRefreshing ? "animate-spin" : ""}>
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          <span className="max-sm:hidden">{isRefreshing ? t("updating") : t("refreshData")}</span>
        </button>
      </div>
    </div>
  );
}
