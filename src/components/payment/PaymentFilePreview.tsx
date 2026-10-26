"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { toDocumentDownloadUrl, toDocumentPreviewUrl } from "@/utils/documentPreview";

// Khung xem file chứng từ đề nghị thanh toán ngay trong trang (cùng cơ chế xem chứng từ XNK ở chi tiết đơn): mở bên phải
// màn hình, iframe xem trước của Google Drive, chuyển file trước / sau (nút hoặc phím ← →), tải file, phóng to, đóng (Esc).
// Không mở tab mới.

export interface PreviewFile {
  fileName: string;
  fileUrl: string;
}

interface Props {
  files: PreviewFile[];
  /** Vị trí file đang xem; null = đóng. */
  index: number | null;
  onIndexChange: (index: number | null) => void;
}

const ICON_BUTTON = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800";

export default function PaymentFilePreview({ files, index, onIndexChange }: Props) {
  const { t } = useLanguage();
  const [maximized, setMaximized] = useState(false);
  const open = index !== null && index >= 0 && index < files.length;
  const current = open ? files[index] : null;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onIndexChange(null);
      if (event.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      if (event.key === "ArrowRight" && index < files.length - 1) onIndexChange(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [files.length, index, onIndexChange, open]);

  if (!open || !current) return null;
  const previewUrl = toDocumentPreviewUrl(current.fileUrl);
  const downloadUrl = toDocumentDownloadUrl(current.fileUrl);

  return (
    <aside className={`fixed right-0 top-0 z-[100000] flex h-screen min-h-0 flex-col border-l border-gray-200 bg-white shadow-2xl transition-all duration-300 dark:border-gray-700 dark:bg-gray-900 ${maximized ? "w-full" : "w-[92vw] md:w-1/2"}`}
      aria-label={current.fileName}>
      <div className="flex min-h-14 flex-shrink-0 items-center gap-2 border-b border-gray-200 px-3 py-2 sm:gap-3 sm:px-4 dark:border-gray-700">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800 dark:text-white" title={current.fileName}>{current.fileName}</p>
        {files.length > 1 && (
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => onIndexChange(index - 1)} disabled={index === 0} aria-label={t("previousFile")} title={`${t("previousFile")} (←)`} className={ICON_BUTTON}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
            </button>
            <span className="min-w-12 text-center text-xs font-semibold tabular-nums text-gray-600 dark:text-gray-300">{index + 1}/{files.length}</span>
            <button type="button" onClick={() => onIndexChange(index + 1)} disabled={index === files.length - 1} aria-label={t("nextFile")} title={`${t("nextFile")} (→)`} className={ICON_BUTTON}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          </div>
        )}
        {downloadUrl && (
          <a href={downloadUrl} download={current.fileName || undefined} rel="noopener noreferrer" title={t("downloadDocument")} aria-label={`${t("downloadDocument")} ${current.fileName}`} className={ICON_BUTTON}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
          </a>
        )}
        <button type="button" onClick={() => setMaximized((value) => !value)} className="hidden shrink-0 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 sm:inline-flex dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
          {maximized ? t("minimize") : t("maximize")}
        </button>
        <button type="button" onClick={() => onIndexChange(null)} aria-label={t("close")} title={`${t("close")} (Esc)`} className={`${ICON_BUTTON} hover:bg-error-50 hover:text-error-600 dark:hover:bg-error-500/10 dark:hover:text-error-400`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
        </button>
      </div>
      <div className="flex min-h-0 flex-1 bg-gray-100 p-2 dark:bg-gray-950">
        <iframe key={previewUrl} title={current.fileName} src={previewUrl} className="block h-full min-h-[320px] w-full rounded-lg bg-white" />
      </div>
      {files.length > 1 && (
        <div className="flex shrink-0 gap-2 overflow-x-auto border-t border-gray-200 bg-white p-2 custom-scrollbar dark:border-gray-700 dark:bg-gray-900">
          {files.map((file, position) => (
            <button key={`${file.fileUrl}-${position}`} type="button" onClick={() => onIndexChange(position)} aria-current={position === index ? "true" : undefined} title={file.fileName}
              className={`flex min-h-10 max-w-48 shrink-0 flex-col items-start justify-center rounded-lg border px-2.5 py-1 text-left text-[11px] transition ${position === index ? "border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-500/60 dark:bg-brand-500/10 dark:text-brand-300" : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"}`}>
              <span className="font-semibold">{position + 1}</span>
              <span className="w-full truncate text-gray-400">{file.fileName}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
