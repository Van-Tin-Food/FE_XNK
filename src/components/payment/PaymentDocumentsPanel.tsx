"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemConfirm } from "@/context/SystemConfirmContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import {
  checkPaymentDocumentNames,
  listPaymentDocuments,
  removePaymentDocument,
  uploadPaymentDocument,
  type PaymentDocuments,
} from "@/services/paymentRequestApi";
import { DOCUMENT_FILE_ACCEPT, getDocumentMimeType, isSupportedDocumentFile } from "@/utils/documentFile";
import { formatDateTime } from "./PaymentRequestParts";

// Chứng từ hồ sơ đề nghị (bước 4): thư mục DNTT_xxx trên Google Drive, cùng cơ chế chứng từ XNK —
// kiểm tra định dạng + trùng tên trước, rồi upload lần lượt bằng quyền Drive của người dùng. Chứng từ upload dần (tạm),
// bỏ được file up nhầm; chỉ khi bấm "Đầy đủ chứng từ" (PaymentRequestProcess) đề nghị mới hoàn thành và khóa.

const MAX_FILE_MB = 15;

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return reject(new Error("Không đọc được file"));
      resolve(reader.result.includes(",") ? reader.result.split(",", 2)[1] : reader.result);
    };
    reader.onerror = () => reject(new Error("Không đọc được file"));
    reader.readAsDataURL(file);
  });
}

interface Props {
  requestId: string;
  /** Upload + bỏ chứng từ (đề nghị chưa hoàn thành, chưa hủy). */
  canUpload: boolean;
  /** Số file hiện có (để bước lưu trữ biết đã có chứng từ chưa). */
  onFilesChange?: (count: number) => void;
  /** Sau lần upload đầu tiên đề nghị có link thư mục: báo trang tải lại đề nghị. */
  onUploaded?: () => void;
}

export default function PaymentDocumentsPanel({ requestId, canUpload, onFilesChange, onUploaded }: Props) {
  const { t, language } = useLanguage();
  const { notify } = useSystemNotification();
  const { confirm } = useSystemConfirm();
  const [removing, setRemoving] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<PaymentDocuments | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    listPaymentDocuments(requestId, controller.signal)
      .then((data) => { setDocuments(data); setError(""); onFilesChange?.(data.files.length); })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : t("prDocsLoadError"));
      });
    return () => controller.abort();
  }, [onFilesChange, reloadKey, requestId, t]);

  const upload = useCallback(async (selected: File[]) => {
    if (selected.length === 0 || progress) return;
    const unsupported = selected.filter((file) => !isSupportedDocumentFile(file));
    if (unsupported.length) return notify(t("prUnsupportedFiles", { names: unsupported.map((file) => file.name).join(", ") }), "error");
    const tooLarge = selected.filter((file) => file.size > MAX_FILE_MB * 1024 * 1024);
    if (tooLarge.length) return notify(t("prFileTooLarge", { size: MAX_FILE_MB, names: tooLarge.map((file) => file.name).join(", ") }), "error");
    setProgress({ done: 0, total: selected.length });
    try {
      // Báo trùng tên trước khi upload: không tự đổi tên / ghi đè (quy tắc đặt tên nằm ở BE).
      const checks = await checkPaymentDocumentNames(requestId, selected.map((file) => file.name));
      const duplicates = checks.filter((item) => item.duplicate).map((item) => item.fileName);
      if (duplicates.length) {
        notify(t("prDuplicateFiles", { names: duplicates.join(", ") }), "error");
        return;
      }
      for (const [index, file] of selected.entries()) {
        await uploadPaymentDocument(requestId, { name: file.name, type: getDocumentMimeType(file), data: await readFileAsBase64(file) });
        setProgress({ done: index + 1, total: selected.length });
      }
      notify(t("prUploaded", { count: selected.length }), "success");
      onUploaded?.();
    } catch (uploadError) {
      notify(uploadError instanceof Error ? uploadError.message : String(uploadError), "error");
    } finally {
      setProgress(null);
      setReloadKey((key) => key + 1);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [notify, onUploaded, progress, requestId, t]);

  const remove = async (fileId: string, fileName: string) => {
    if (removing || progress) return;
    if (!await confirm({ title: t("prRemoveDoc"), message: t("prRemoveDocMessage", { name: fileName }), confirmText: t("prRemoveDoc"), tone: "danger" })) return;
    setRemoving(fileId);
    try {
      await removePaymentDocument(requestId, fileId);
      notify(t("prRemovedDoc", { name: fileName }), "success");
    } catch (removeError) {
      notify(removeError instanceof Error ? removeError.message : String(removeError), "error");
    } finally {
      setRemoving("");
      setReloadKey((key) => key + 1);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600 dark:text-gray-300">{t("prDocsHint", { folder: documents?.folderName || requestId.replace(/-/g, "_") })}</p>
        {documents?.folderUrl && (
          <a href={documents.folderUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">{t("prOpenFolder")} ↗</a>
        )}
      </div>

      {error && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-300">
          <span className="min-w-0 break-words">{error}</span>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="font-semibold underline">{t("prRetry")}</button>
        </div>
      )}
      {!documents && !error && <div className="mt-3 h-12 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />}
      {documents && (documents.files.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-sm text-gray-500 dark:border-gray-700">{t("prDocsEmpty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
          {documents.files.map((file) => (
            <li key={file.fileId} className="flex items-start gap-2 px-3 py-2.5 sm:items-center">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
                <a href={file.fileUrl} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm font-medium text-brand-600 hover:underline dark:text-brand-400" title={file.fileName}>{file.fileName}</a>
                <span className="shrink-0 text-xs text-gray-500">{[file.uploadedBy, file.uploadedAt && formatDateTime(file.uploadedAt, language)].filter(Boolean).join(" · ")}</span>
              </div>
              {canUpload && (
                <button type="button" onClick={() => void remove(file.fileId, file.fileName)} disabled={Boolean(removing) || Boolean(progress)}
                  aria-label={`${t("prRemoveDoc")}: ${file.fileName}`} title={t("prRemoveDoc")}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-error-50 hover:text-error-600 disabled:opacity-50 dark:hover:bg-error-500/10 dark:hover:text-error-400">
                  {removing === file.fileId ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <span aria-hidden="true">✕</span>}
                </button>
              )}
            </li>
          ))}
        </ul>
      ))}

      {canUpload && (
        <>
          <input ref={inputRef} type="file" multiple accept={DOCUMENT_FILE_ACCEPT} className="hidden" onChange={(event) => void upload(Array.from(event.target.files || []))} />
          <button type="button" onClick={() => inputRef.current?.click()} disabled={Boolean(progress)}
            className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-brand-300 text-sm font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-60 sm:w-auto sm:px-6 dark:border-brand-500/40 dark:text-brand-400 dark:hover:bg-brand-500/10">
            {progress ? t("prUploading", { done: progress.done, total: progress.total }) : `⬆ ${t("prChooseFiles")}`}
          </button>
        </>
      )}
    </div>
  );
}
