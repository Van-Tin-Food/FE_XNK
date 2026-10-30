"use client";

import { useLanguage } from "@/context/LanguageContext";
import type { EmailJob, EmailJobRecipient } from "@/services/emailApi";

function formatRemaining(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${String(remainder).padStart(2, "0")}s` : `${remainder}s`;
}

type RowState = "pending" | "sending" | "sent" | "failed";

const BADGE_CLASS: Record<RowState, string> = {
  pending: "bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300",
  sending: "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-200",
  sent: "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-300",
  failed: "bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-300",
};

function rowState(recipient: EmailJobRecipient, isCurrent: boolean): RowState {
  if (recipient.status === "sent") return "sent";
  if (recipient.status === "not sent") return "failed";
  return isCurrent ? "sending" : "pending";
}

/** Tiến độ lượt gửi chạy nền: trạng thái thật của từng người nhận do BE trả về (không ước lượng theo đồng hồ). */
export default function EmailSendProgress({ job, connectionLost, onClose, onReselectFailed }: {
  job: EmailJob;
  connectionLost: boolean;
  onClose: () => void;
  onReselectFailed: () => void;
}) {
  const { t } = useLanguage();
  const running = job.status === "running";
  const done = job.sentCount + job.failedCount;
  const pending = Math.max(0, job.total - done);
  const intervalSeconds = Math.max(1, Math.round(job.sendIntervalMs / 1000));
  const remainingSeconds = pending * intervalSeconds;
  const progress = job.total > 0 ? Math.round((done / job.total) * 100) : 100;
  const currentIndex = running ? job.recipients.findIndex((recipient) => recipient.status === "pending") : -1;
  const labels: Record<RowState, string> = {
    pending: t("emailRecipientPending"),
    sending: t("emailRecipientSending"),
    sent: t("emailRecipientSent"),
    failed: t("emailRecipientFailed"),
  };

  return (
    <div className="rounded-2xl border border-brand-200 bg-brand-50/60 p-4 dark:border-brand-500/30 dark:bg-brand-500/10" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-brand-200 bg-white dark:border-brand-500/40 dark:bg-gray-900">
          {running
            ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600 dark:border-brand-500/30 dark:border-t-brand-300" aria-hidden="true" />
            : <span className={`text-base font-bold ${job.failedCount ? "text-amber-600" : "text-success-600"}`} aria-hidden="true">{job.failedCount ? "!" : "✓"}</span>}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="text-sm font-semibold text-brand-800 dark:text-brand-200">
              {running
                ? t("emailJobRunningTitle", { done, total: job.total })
                : t("emailJobDoneTitle", { sent: job.sentCount, failed: job.failedCount })}
            </p>
            {running && (
              <span className="text-xs font-medium text-brand-700 dark:text-brand-300">
                {remainingSeconds > 0 ? t("emailSendingRemaining", { time: formatRemaining(remainingSeconds) }) : t("emailSendingFinishing")}
              </span>
            )}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-100 dark:bg-brand-500/20">
            <div className="h-full rounded-full bg-brand-500 transition-[width] duration-500" style={{ width: `${progress}%` }} />
          </div>
          {running && <p className="mt-1.5 text-xs text-brand-700 dark:text-brand-300">{t("emailJobRunningNote", { seconds: intervalSeconds })}</p>}
          {running && connectionLost && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t("emailJobConnectionLost")}</p>}
        </div>
      </div>

      <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-brand-100 bg-white p-1.5 custom-scrollbar dark:border-brand-500/20 dark:bg-gray-900">
        {job.recipients.map((recipient, index) => {
          const state = rowState(recipient, index === currentIndex);
          return (
            <li key={`${recipient.email}#${index}`} className="flex flex-col gap-1 rounded-lg px-2 py-1.5 sm:flex-row sm:items-start sm:gap-3">
              <span className={`inline-flex w-fit shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold sm:mt-0.5 sm:w-20 sm:justify-center ${BADGE_CLASS[state]}`}>{labels[state]}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-gray-800 dark:text-white/90" title={recipient.name}>{recipient.name || recipient.email}</span>
                <span className="block break-all text-[11px] text-gray-500 dark:text-gray-400">{recipient.email}</span>
                {recipient.error && <span className="block break-words text-[11px] text-error-600 dark:text-error-300">{recipient.error}</span>}              </span>
            </li>
          );
        })}
      </ul>

      {!running && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {job.failedCount > 0 && (
            <button type="button" onClick={onReselectFailed} className="h-10 rounded-lg border border-brand-300 bg-white px-4 text-sm font-semibold text-brand-700 hover:bg-brand-50 dark:border-brand-500/40 dark:bg-gray-900 dark:text-brand-200 dark:hover:bg-brand-500/10">
              {t("emailReselectFailed")}
            </button>
          )}
          <button type="button" onClick={onClose} className="h-10 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white hover:bg-brand-600">
            {t("emailJobClose")}
          </button>
        </div>
      )}
    </div>
  );
}
