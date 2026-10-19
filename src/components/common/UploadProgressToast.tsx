"use client";

import { useLanguage } from "@/context/LanguageContext";
import { formatFileSize } from "@/utils/documentFile";

/**
 * Thẻ nổi góc dưới phải (màn nhỏ: dải cuối màn hình) báo file đang upload lên Google Drive.
 * Đặt ngoài Modal: Modal có transform nên phần tử fixed bên trong sẽ bị định vị theo Modal.
 */
export default function UploadProgressToast({ fileName, loaded, size, index = 1, total = 1 }: {
  fileName: string;
  loaded: number;
  size: number;
  index?: number;
  total?: number;
}) {
  const { t } = useLanguage();
  const percent = Math.min(100, Math.round((loaded / Math.max(size, 1)) * 100));
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
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-gray-800 dark:text-white/90">{t("uploadingTitle")}</p>
              {total > 1 && (
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-gray-600 dark:bg-white/[0.06] dark:text-gray-300">
                  {index}/{total}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400" title={fileName}>{fileName}</p>
          </div>
          <span className="shrink-0 text-lg font-semibold tabular-nums text-brand-600 dark:text-brand-300">{percent}%</span>
        </div>
        <div className="h-1 bg-gray-100 dark:bg-gray-800">
          <div className="h-full bg-brand-500 transition-[width] duration-300 ease-out" style={{ width: `${percent}%` }} />
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-2 text-[11px] text-gray-400 dark:text-gray-500">
          <span className="shrink-0 tabular-nums">{formatFileSize(loaded)} / {formatFileSize(size)}</span>
          <span className="min-w-0 truncate text-right">{t("uploadKeepPageOpen")}</span>
        </div>
      </div>
    </div>
  );
}
