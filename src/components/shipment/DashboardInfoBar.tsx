"use client";

import React, { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";

interface DashboardInfoBarProps {
  lastUpdated: string;
  updatedBy?: string;
  onRefresh: () => Promise<void>;
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

export default function DashboardInfoBar({ lastUpdated, updatedBy, onRefresh }: DashboardInfoBarProps) {
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
    <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-white/[0.03] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
          {t("lastUpdated", { time: `${formatRelativeTime(lastUpdated, t)} · ${formatDateTime(lastUpdated, language)}` })}
          <span className="text-gray-400"> {t("updatedBy", { name: updaterName })}</span>
        </p>
      </div>

      <div className="flex items-center gap-2">
        {showRefreshSuccess && <span className="text-xs font-medium text-success-600">✓ {t("refreshSucceeded")}</span>}
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          title={t("refreshSystemData")}
          className="inline-flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-xs font-semibold text-brand-600 transition-all hover:border-brand-300 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-400 dark:hover:bg-brand-500/20"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={isRefreshing ? "animate-spin" : ""}>
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          {isRefreshing ? t("updating") : t("refreshData")}
        </button>
      </div>
    </div>
  );
}
