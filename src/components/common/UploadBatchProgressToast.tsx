"use client";

import { useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { formatFileSize } from "@/utils/documentFile";

export type UploadBatchFileStatus = "queued" | "uploading" | "done" | "failed";
export type UploadBatchFile = { key: string; fileName: string; size: number; loaded: number; status: UploadBatchFileStatus; error?: string };
/** Một lượt upload: running = đang chạy / đang kiểm tra để thử lại, done = xong hết, failed = xong nhưng có file lỗi. */
export type UploadBatchJob = {
  id: string;
  title: string;
  files: UploadBatchFile[];
  status: "running" | "done" | "failed";
  /** Lỗi của cả lượt (ví dụ kiểm tra trùng tên khi thử lại). */
  message?: string;
  /** Còn thử lại được các file lỗi không (trùng tên thì không). */
  retryable: boolean;
};

function jobBytes(files: UploadBatchFile[]) {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  // File xong / lỗi tính đủ dung lượng để thanh tổng chạy tới 100% khi cả lượt kết thúc.
  const loadedBytes = files.reduce((sum, file) => sum + (file.status === "done" || file.status === "failed" ? file.size : Math.min(file.loaded, file.size)), 0);
  return { totalBytes, loadedBytes, percent: Math.min(100, Math.round((loadedBytes / Math.max(totalBytes, 1)) * 100)) };
}

/**
 * Thẻ nổi góc dưới phải (màn nhỏ: dải gần cuối màn hình), nằm trên nút chatbox AI, cho các lượt upload chứng từ chạy nền:
 * mỗi lượt một thẻ với phần trăm tổng theo dung lượng, số file đã xong và trạng thái từng file. Lượt có file lỗi giữ lại
 * tới khi bấm Thử lại / Đóng. Thu gọn được thành một dòng (điện thoại mặc định thu gọn) để không che nút / form ở cuối
 * trang. Lớp z dưới khung chat AI, header, modal và khung xem file; trên nội dung trang.
 */
export default function UploadBatchProgressToast({ jobs, onRetry, onDismiss }: {
  jobs: UploadBatchJob[];
  onRetry: (jobId: string) => void;
  onDismiss: (jobId: string) => void;
}) {
  const { t } = useLanguage();
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches);
  if (jobs.length === 0) return null;

  const running = jobs.filter((job) => job.status === "running");
  const failedCount = jobs.filter((job) => job.status === "failed").length;
  const { percent } = jobBytes(running.flatMap((job) => job.files));
  const summary = running.length > 0
    ? t("uploadPanelSummary", { running: running.length, percent })
    : failedCount > 0
      ? t("uploadPanelSummaryFailed", { failed: failedCount })
      : t("uploadBatchDone", { done: jobs.length, total: jobs.length });

  return (
    <div className="custom-scrollbar fixed inset-x-3 bottom-20 z-[9989] flex max-h-[calc(100dvh-7rem)] flex-col gap-2 overflow-y-auto sm:inset-x-auto sm:bottom-24 sm:right-6 sm:w-[380px]">
      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          aria-label={t("uploadPanelExpand")}
          className={`flex min-h-11 w-full min-w-0 items-center gap-3 rounded-2xl border bg-white px-4 py-2 text-left shadow-theme-lg dark:bg-gray-900 ${failedCount > 0 && running.length === 0 ? "border-error-200 dark:border-error-500/30" : "border-gray-200 dark:border-gray-700"}`}
        >
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${running.length > 0 ? "animate-pulse bg-brand-500" : failedCount > 0 ? "bg-error-500" : "bg-success-500"}`} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800 dark:text-white/90" title={summary}>{summary}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-gray-400" aria-hidden="true">
            <path d="m18 15-6-6-6 6" />
          </svg>
        </button>
      ) : (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              aria-expanded={true}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 shadow-theme-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {t("uploadPanelCollapse")}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </div>
          {jobs.map((job) => <UploadJobCard key={job.id} job={job} onRetry={onRetry} onDismiss={onDismiss} />)}
        </>
      )}
    </div>
  );
}

function UploadJobCard({ job, onRetry, onDismiss }: { job: UploadBatchJob; onRetry: (jobId: string) => void; onDismiss: (jobId: string) => void }) {
  const { t } = useLanguage();
  const { files } = job;
  const { totalBytes, loadedBytes, percent } = jobBytes(files);
  const doneCount = files.filter((file) => file.status === "done").length;
  const failedCount = files.filter((file) => file.status === "failed").length;
  const running = job.status === "running";

  return (
    <div role="status" aria-live="polite" className="shrink-0 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-lg dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-center gap-3 p-4">
        <span className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${job.status === "failed" ? "bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-400" : job.status === "done" ? "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400" : "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300"}`}>
          {running && <span className="absolute inset-0 animate-ping rounded-full bg-brand-400/20" aria-hidden="true" />}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V4" />
            <path d="m7 9 5-5 5 5" />
            <path d="M5 20h14" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-800 dark:text-white/90" title={job.title}>{job.title}</p>
          <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
            {t("uploadBatchDone", { done: doneCount, total: files.length })}
            {failedCount > 0 && <span className="text-error-600 dark:text-error-400"> · {t("uploadBatchFailed", { count: failedCount })}</span>}
          </p>
        </div>
        <span className="shrink-0 text-lg font-semibold tabular-nums text-brand-600 dark:text-brand-300">{percent}%</span>
      </div>
      <div className="h-1 bg-gray-100 dark:bg-gray-800">
        <div className={`h-full transition-[width] duration-300 ease-out ${job.status === "failed" ? "bg-error-500" : "bg-brand-500"}`} style={{ width: `${percent}%` }} />
      </div>
      <ul className="max-h-32 overflow-y-auto px-4 py-2 sm:max-h-44">
        {files.map((file) => {
          const filePercent = Math.min(100, Math.round((file.loaded / Math.max(file.size, 1)) * 100));
          return (
            <li key={file.key} className="py-1 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300" title={file.fileName}>{file.fileName}</span>
                {file.status === "done" && <span className="shrink-0 font-semibold text-success-600 dark:text-success-400" aria-label={t("uploadStatusDone")}>✓</span>}
                {file.status === "failed" && <span className="shrink-0 font-semibold text-error-600 dark:text-error-400">{t("uploadStatusFailed")}</span>}
                {file.status === "queued" && <span className="shrink-0 text-gray-400 dark:text-gray-500">{t("uploadStatusQueued")}</span>}
                {file.status === "uploading" && <span className="shrink-0 font-semibold tabular-nums text-brand-600 dark:text-brand-300">{filePercent}%</span>}
              </div>
              {file.status === "failed" && file.error && <p className="mt-0.5 break-words text-[11px] text-error-600 dark:text-error-400">{file.error}</p>}
            </li>
          );
        })}
      </ul>
      {job.message && <p className="break-words border-t border-gray-100 px-4 py-2 text-xs text-error-600 dark:border-gray-800 dark:text-error-400">{job.message}</p>}
      {job.status === "failed" ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 px-4 py-2 dark:border-gray-800">
          <button type="button" onClick={() => onDismiss(job.id)} className="min-h-9 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">{t("close")}</button>
          {job.retryable && failedCount > 0 && (
            <button type="button" onClick={() => onRetry(job.id)} className="min-h-9 rounded-lg bg-brand-500 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-600">
              {t("retryFailedUploads", { count: failedCount })}
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400 dark:border-gray-800 dark:text-gray-500">
          <span className="shrink-0 tabular-nums">{formatFileSize(loadedBytes)} / {formatFileSize(totalBytes)}</span>
          {running && <span className="min-w-0 truncate text-right" title={t("uploadBackgroundHint")}>{t("uploadBackgroundHint")}</span>}
        </div>
      )}
    </div>
  );
}
