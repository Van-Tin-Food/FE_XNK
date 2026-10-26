"use client";

import { useLanguage } from "@/context/LanguageContext";
import { formatFileSize } from "@/utils/documentFile";

export type UploadBatchFileStatus = "queued" | "uploading" | "done" | "failed";
export type UploadBatchFile = { key: string; fileName: string; size: number; loaded: number; status: UploadBatchFileStatus };

/**
 * Thẻ nổi góc dưới phải (màn nhỏ: dải cuối màn hình) cho một lượt upload nhiều file chạy song song:
 * phần trăm tổng theo dung lượng, số file đã xong và trạng thái từng file.
 * Đặt ngoài Modal: Modal có transform nên phần tử fixed bên trong sẽ bị định vị theo Modal.
 */
export default function UploadBatchProgressToast({ files }: { files: UploadBatchFile[] }) {
  const { t } = useLanguage();
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  // File xong / lỗi tính đủ dung lượng để thanh tổng chạy tới 100% khi cả lượt kết thúc.
  const loadedBytes = files.reduce((sum, file) => sum + (file.status === "done" || file.status === "failed" ? file.size : Math.min(file.loaded, file.size)), 0);
  const percent = Math.min(100, Math.round((loadedBytes / Math.max(totalBytes, 1)) * 100));
  const doneCount = files.filter((file) => file.status === "done").length;
  const failedCount = files.filter((file) => file.status === "failed").length;

  return (
    <div role="status" aria-live="polite" className="fixed inset-x-3 bottom-3 z-[100002] sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[380px]">
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-theme-lg dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center gap-3 p-4">
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
            <span className="absolute inset-0 animate-ping rounded-full bg-brand-400/20" aria-hidden="true" />
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 16V4" />
              <path d="m7 9 5-5 5 5" />
              <path d="M5 20h14" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-gray-800 dark:text-white/90">{t("uploadingTitle")}</p>
            <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
              {t("uploadBatchDone", { done: doneCount, total: files.length })}
              {failedCount > 0 && <span className="text-error-600 dark:text-error-400"> · {t("uploadBatchFailed", { count: failedCount })}</span>}
            </p>
          </div>
          <span className="shrink-0 text-lg font-semibold tabular-nums text-brand-600 dark:text-brand-300">{percent}%</span>
        </div>
        <div className="h-1 bg-gray-100 dark:bg-gray-800">
          <div className="h-full bg-brand-500 transition-[width] duration-300 ease-out" style={{ width: `${percent}%` }} />
        </div>
        <ul className="max-h-44 overflow-y-auto px-4 py-2">
          {files.map((file) => {
            const filePercent = Math.min(100, Math.round((file.loaded / Math.max(file.size, 1)) * 100));
            return (
              <li key={file.key} className="flex min-w-0 items-center gap-2 py-1 text-xs">
                <span className="min-w-0 flex-1 truncate text-gray-600 dark:text-gray-300" title={file.fileName}>{file.fileName}</span>
                {file.status === "done" && <span className="shrink-0 font-semibold text-success-600 dark:text-success-400" aria-label={t("uploadStatusDone")}>✓</span>}
                {file.status === "failed" && <span className="shrink-0 font-semibold text-error-600 dark:text-error-400">{t("uploadStatusFailed")}</span>}
                {file.status === "queued" && <span className="shrink-0 text-gray-400 dark:text-gray-500">{t("uploadStatusQueued")}</span>}
                {file.status === "uploading" && <span className="shrink-0 font-semibold tabular-nums text-brand-600 dark:text-brand-300">{filePercent}%</span>}
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400 dark:border-gray-800 dark:text-gray-500">
          <span className="shrink-0 tabular-nums">{formatFileSize(loadedBytes)} / {formatFileSize(totalBytes)}</span>
          <span className="min-w-0 truncate text-right">{t("uploadKeepPageOpen")}</span>
        </div>
      </div>
    </div>
  );
}
