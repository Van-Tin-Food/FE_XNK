"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";

const SECONDS_PER_RECIPIENT = 10;

function formatRemaining(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${String(remainder).padStart(2, "0")}s` : `${remainder}s`;
}

export default function EmailSendingIndicator({ sending, total }: { sending: boolean; total: number }) {
  const { t } = useLanguage();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!sending) return undefined;

    const resetTimer = window.setTimeout(() => setElapsedSeconds(0), 0);
    const timer = window.setInterval(() => setElapsedSeconds((value) => value + 1), 1000);
    return () => {
      window.clearTimeout(resetTimer);
      window.clearInterval(timer);
    };
  }, [sending]);

  if (!sending || total < 1) return null;

  const estimatedSeconds = total * SECONDS_PER_RECIPIENT;
  const remainingSeconds = Math.max(0, estimatedSeconds - elapsedSeconds);
  const progress = Math.min(96, Math.max(4, (elapsedSeconds / estimatedSeconds) * 100));
  const remainingText = remainingSeconds > 0
    ? t("emailSendingRemaining", { time: formatRemaining(remainingSeconds) })
    : t("emailSendingFinishing");

  return (
    <div className="mb-5 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 dark:border-brand-500/30 dark:bg-brand-500/10" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-brand-200 bg-white dark:border-brand-500/40 dark:bg-gray-900">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600 dark:border-brand-500/30 dark:border-t-brand-300" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm font-semibold text-brand-800 dark:text-brand-200">
            <span>{t("emailSending")}</span>
            <span className="text-xs font-medium text-brand-700 dark:text-brand-300">{remainingText}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-100 dark:bg-brand-500/20">
            <div className="h-full rounded-full bg-brand-500 transition-[width] duration-1000 ease-linear" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-brand-700 dark:text-brand-300">
            {t("emailSendingRecipients", { count: total })}
          </p>
        </div>
      </div>
    </div>
  );
}
