"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemConfirm } from "@/context/SystemConfirmContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import {
  INVOICE,
  PAYMENT_PROOF,
  SIGNED_FORM,
  listPaymentDocuments,
  removePaymentDocument,
  sendPaymentDocument,
  startPaymentDocumentUploads,
  type ContainerDeposit,
  type ContainerRepairInput,
  type PaymentDocumentKind,
  type PaymentDocuments,
} from "@/services/paymentRequestApi";
import { DOCUMENT_FILE_ACCEPT, getDocumentMimeType, isSupportedDocumentFile } from "@/utils/documentFile";
import { amountToCents, containerRepairOf, formatMoney, parseSignedAmount, parseVatInput } from "@/utils/paymentRequest";
import PaymentFilePreview from "./PaymentFilePreview";
import { formatDateTime } from "./PaymentRequestParts";

// Chứng từ hồ sơ đề nghị: thư mục DNTT_xxx trên Google Drive, cùng cơ chế chứng từ XNK — kiểm tra định dạng + trùng tên
// trước, rồi upload lần lượt bằng quyền Drive của người dùng. Chứng từ upload dần (tạm), bỏ được file up nhầm; chỉ khi bấm
// "Đầy đủ chứng từ" (PaymentRequestProcess) đề nghị mới hoàn thành và khóa.
// kind = payment_proof (bước chi tiền): chỉ hiện + upload ủy nhiệm chi / ảnh chuyển tiền; upload xong BE chuyển đề nghị sang
// đã chi tiền và báo Google Chat ở file cuối của lượt. kind = null: mọi chứng từ, ủy nhiệm chi có nhãn "UNC".
// File gửi thẳng lên Google Drive (không qua gateway), nên giới hạn là của Drive upload: 1 GB/file như chứng từ XNK.
// Khung hóa đơn của đề nghị cược cont đã chi tiền / đã hoàn thành (containerDeposits — phí sửa không ràng buộc hoàn thành, hóa
// đơn hoàn cược nhập sau hoặc không nhập đều được): cont nào chưa có phí sửa thì phải nhập số tiền hãng tàu
// hoàn cược (âm = phải trả thêm) + % VAT trước khi upload; phí sửa = tiền cược − số hoàn, BE ghi vào chi phí của cont.

const MAX_FILE_MB = 1024;
// Chứng từ hồ sơ gửi song song tối đa 3 file (mỗi file: gửi lên Drive + BE ghi nhận).
const PARALLEL_UPLOADS = 3;

/** Chạy task(0..count-1) với tối đa limit việc cùng lúc. */
async function runLimited(count: number, limit: number, task: (index: number) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < count) {
      const index = next;
      next += 1;
      await task(index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, count) }, worker));
}

interface Props {
  requestId: string;
  /** Upload + bỏ chứng từ (đề nghị chưa hoàn thành, chưa hủy). */
  canUpload: boolean;
  /** payment_proof: khung ủy nhiệm chi / ảnh chuyển tiền (bước chi tiền); invoice: khung hóa đơn; null: mọi chứng từ hồ sơ. */
  kind?: PaymentDocumentKind;
  /** Danh sách chung: được bỏ cả ủy nhiệm chi (người có quyền chi tiền). */
  canRemoveProof?: boolean;
  /** Được bỏ file (mặc định có khi upload được). Đã chi tiền: người tạo chỉ bổ sung, không bỏ được (BE cũng chặn). */
  canRemove?: boolean;
  /** Số file đang hiện (để bước lưu trữ biết đã có chứng từ chưa). */
  onFilesChange?: (count: number) => void;
  /** Sau khi upload (lần đầu có link thư mục / ủy nhiệm chi đổi trạng thái): báo trang tải lại đề nghị. */
  onUploaded?: () => void;
  onPreviewVisibilityChange?: (visible: boolean) => void;
  /** Khung hóa đơn: cont có tiền cược của đề nghị (chỉ truyền khi đã chi tiền); cont chưa có phí sửa thì bắt nhập trước khi upload. */
  containerDeposits?: ContainerDeposit[];
  /** Loại tiền của đề nghị (hiện số tiền cược / phí sửa). */
  currency?: string;
}

type RepairDraft = { refund: string; vat: string };
const repairKey = (item: { contract: string; container: string }) => `${item.contract}|${item.container}`;
const REPAIR_INPUT = "h-10 w-full min-w-0 rounded-lg border bg-white px-3 text-sm text-gray-800 outline-none focus:border-brand-400 dark:bg-gray-900 dark:text-white";

export default function PaymentDocumentsPanel({
  requestId, canUpload, kind = null, canRemoveProof = false, canRemove = true, onFilesChange, onUploaded, onPreviewVisibilityChange,
  containerDeposits = [], currency = "VND",
}: Props) {
  const { t, language } = useLanguage();
  const { notify } = useSystemNotification();
  const { confirm } = useSystemConfirm();
  const proofMode = kind === PAYMENT_PROOF;
  const invoiceMode = kind === INVOICE;
  const [removing, setRemoving] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<PaymentDocuments | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number; percent: number } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  // Tải lại danh sách; refresh = true (nút "Làm mới"): BE đọc lại thư mục Drive thay vì danh sách đã lưu.
  const [reload, setReload] = useState({ key: 0, refresh: false });
  const reloadList = useCallback((refresh = false) => setReload((state) => ({ key: state.key + 1, refresh })), []);
  const [refreshing, setRefreshing] = useState(false);
  // File đang xem trong khung xem trước (null = đóng): mở ngay trong trang như chứng từ XNK, không mở tab mới.
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // Khung theo loại (UNC / hóa đơn) chỉ hiện file đúng loại; khung chung hiện mọi file.
  const files = useMemo(() => (documents?.files || []).filter((file) => !kind || file.kind === kind), [documents, kind]);

  // ---------- Phí sửa cont (khung hóa đơn của đề nghị cược cont đã chi tiền) ----------
  const [repairDrafts, setRepairDrafts] = useState<Record<string, RepairDraft>>({});
  const recordedRepairs = invoiceMode ? containerDeposits.filter((item) => item.repair) : [];
  // Mỗi cont chưa có phí sửa: số đang nhập, kết quả tính và lỗi (rỗng = hợp lệ).
  const repairRows = (invoiceMode ? containerDeposits.filter((item) => !item.repair) : []).map((item) => {
    const draft = repairDrafts[repairKey(item)] || { refund: "", vat: "" };
    const refund = draft.refund.trim() ? parseSignedAmount(draft.refund) : null;
    const vat = draft.vat.trim() ? parseVatInput(draft.vat) : "";
    const result = refund === null ? null : containerRepairOf(item.deposit, refund);
    const refundError = !draft.refund.trim() ? "" : refund === null ? t("prRepairRefundInvalid") : result?.refundTooHigh ? t("prRepairRefundTooHigh") : "";
    const vatError = vat === null ? t("prRepairVatInvalid") : "";
    return { item, draft, refund, vat, result, refundError, vatError, ready: refund !== null && !refundError && !vatError };
  });
  const repairsReady = repairRows.every((row) => row.ready);
  const setRepairDraft = (key: string, field: keyof RepairDraft, value: string) => setRepairDrafts((current) => ({
    ...current,
    [key]: { ...(current[key] || { refund: "", vat: "" }), [field]: value },
  }));

  useEffect(() => {
    const controller = new AbortController();
    listPaymentDocuments(requestId, controller.signal, { refresh: reload.refresh })
      .then((data) => {
        setDocuments(data);
        setError("");
        onFilesChange?.(data.files.filter((file) => !kind || file.kind === kind).length);
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : t("prDocsLoadError"));
      })
      .finally(() => { if (!controller.signal.aborted) setRefreshing(false); });
    return () => controller.abort();
  }, [kind, onFilesChange, reload, requestId, t]);

  const refresh = () => {
    if (refreshing || progress || removing) return;
    setRefreshing(true);
    reloadList(true);
  };

  const upload = useCallback(async (selected: File[]) => {
    if (selected.length === 0 || progress) return;
    const unsupported = selected.filter((file) => !isSupportedDocumentFile(file));
    if (unsupported.length) return notify(t("prUnsupportedFiles", { names: unsupported.map((file) => file.name).join(", ") }), "error");
    const tooLarge = selected.filter((file) => file.size > MAX_FILE_MB * 1024 * 1024);
    if (tooLarge.length) return notify(t("prFileTooLarge", { size: MAX_FILE_MB, names: tooLarge.map((file) => file.name).join(", ") }), "error");
    const empty = selected.find((file) => file.size <= 0);
    if (empty) return notify(t("prEmptyFile", { name: empty.name }), "error");
    // Đề nghị cược cont: phải nhập đủ phí sửa các cont trước (BE cũng chặn ở bước mở phiên, trước khi file lên Drive).
    if (repairRows.length && !repairsReady) return notify(t("prRepairRequired"), "error");
    const containerRepairs: ContainerRepairInput[] = repairRows.map((row) => ({
      contract: row.item.contract,
      container: row.item.container,
      refund: row.refund || "",
      vat: row.vat || "",
    }));
    const excessContainers = repairRows
      .filter((row) => row.result && amountToCents(row.result.excess) > BigInt(0))
      .map((row) => `${row.item.container} (${formatMoney(row.result?.excess, currency, language)})`);
    const total = selected.length;
    setProgress({ done: 0, total, percent: 0 });
    try {
      // Một lần gọi BE cho cả lượt: báo trùng tên (không tự đổi tên / ghi đè) và mở phiên upload Drive cho mọi file.
      const { duplicates, sessions } = await startPaymentDocumentUploads(requestId, selected.map((file) => ({ file, mimeType: getDocumentMimeType(file) })), kind, containerRepairs);
      if (duplicates.length) {
        notify(t("prDuplicateFiles", { names: duplicates.join(", ") }), "error");
        return;
      }
      let done = 0;
      const failures: string[] = [];
      let repairError = "";
      const uploadedBytes = selected.map(() => 0);
      const reportProgress = (index: number, loaded: number) => {
        uploadedBytes[index] = loaded;
        const totalBytes = selected.reduce((sum, file) => sum + file.size, 0);
        const loadedBytes = uploadedBytes.reduce((sum, value) => sum + value, 0);
        setProgress({ done, total, percent: totalBytes ? Math.min(100, Math.floor((loadedBytes / totalBytes) * 100)) : 0 });
      };
      const sendOne = async (index: number, announce: boolean) => {
        const uploaded = await sendPaymentDocument(requestId, sessions[index], selected[index], { announce, onProgress: ({ loaded }) => reportProgress(index, loaded) });
        if (uploaded.containerRepairError) repairError = uploaded.containerRepairError;
        done += 1;
        reportProgress(index, selected[index].size);
        setDocuments((current) => current ? {
          ...current,
          files: [...current.files.filter((file) => file.fileId !== uploaded.fileId), uploaded],
        } : current);
      };
      if (proofMode) {
        // Ủy nhiệm chi: các file trước gửi song song (không báo Chat), file cuối gửi sau cùng mới báo "Đã chi tiền" lên
        // Google Chat (một lần, đủ các file).
        await runLimited(total - 1, PARALLEL_UPLOADS, (index) => sendOne(index, false));
        await sendOne(total - 1, true);
      } else {
        // Chứng từ hồ sơ: gửi song song; file lỗi không chặn các file khác, báo lại sau.
        await runLimited(total, PARALLEL_UPLOADS, async (index) => {
          try {
            await sendOne(index, true);
          } catch (fileError) {
            failures.push(`${selected[index].name}: ${fileError instanceof Error ? fileError.message : String(fileError)}`);
          }
        });
      }
      if (failures.length) notify(t("prUploadPartial", { done, total, errors: failures.join("; ") }), done ? "warning" : "error");
      else notify(proofMode ? t("prProofUploaded", { count: total }) : invoiceMode ? t("prInvoiceUploaded", { count: total }) : t("prUploaded", { count: total }), "success");
      // Phí sửa cont được ghi khi file đầu của lượt xong (vé của file đó mang phí sửa).
      const repairsRecorded = containerRepairs.length > 0 && done > 0 && !failures.some((failure) => failure.startsWith(`${selected[0].name}:`));
      if (repairError) notify(t("prRepairSaveFailed", { error: repairError }), "warning");
      else if (repairsRecorded && excessContainers.length) notify(t("prRepairExcessUploaded", { list: excessContainers.join(", ") }), "warning");
      if (repairsRecorded && !repairError) setRepairDrafts({});
      if (done) onUploaded?.();
    } catch (uploadError) {
      notify(uploadError instanceof Error ? uploadError.message : String(uploadError), "error");
    } finally {
      setProgress(null);
      // BE đã ghi danh sách file của thư mục (gồm file vừa upload) vào DB lúc hoàn tất upload: tải lại từ DB, không bắt BE
      // đọc lại thư mục Drive (chậm). Nút "Làm mới" vẫn đọc lại Drive khi cần.
      reloadList();
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [currency, invoiceMode, kind, language, notify, onUploaded, progress, proofMode, reloadList, repairRows, repairsReady, requestId, t]);

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
      reloadList();
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (canUpload && repairsReady && event.dataTransfer.files.length) void upload(Array.from(event.dataTransfer.files));
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {proofMode ? t("prProofHint") : invoiceMode ? t("prInvoiceHint") : t("prDocsHint", { folder: documents?.folderName || requestId.replace(/-/g, "_") })}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <button type="button" onClick={refresh} disabled={refreshing || Boolean(progress) || Boolean(removing)} title={t("prRefreshDocsHint")}
            className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-brand-600 disabled:opacity-50 dark:text-gray-300 dark:hover:text-brand-400">
            <span className={refreshing ? "inline-block animate-spin" : "inline-block"} aria-hidden="true">↻</span>
            {t("prRefreshDocs")}
          </button>
          {documents?.folderUrl && (
            <a href={documents.folderUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">{t("prOpenFolder")} ↗</a>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-300">
          <span className="min-w-0 break-words">{error}</span>
          <button type="button" onClick={() => reloadList()} className="font-semibold underline">{t("prRetry")}</button>
        </div>
      )}
      {!documents && !error && <div className="mt-3 h-12 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />}
      {documents && (files.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-sm text-gray-500 dark:border-gray-700">{proofMode ? t("prProofEmpty") : invoiceMode ? t("prInvoiceEmpty") : t("prDocsEmpty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
          {files.map((file, index) => {
            const isProof = file.kind === PAYMENT_PROOF;
            const removable = canUpload && canRemove && (!isProof || proofMode || canRemoveProof);
            return (
              <li key={file.fileId} className="flex items-start gap-2 px-3 py-2.5 sm:items-center">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {isProof && !proofMode && (
                      <span className="shrink-0 rounded-md bg-blue-light-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-light-700 dark:bg-blue-light-500/10 dark:text-blue-light-300" title={t("prProofTitle")}>UNC</span>
                    )}
                    {file.kind === INVOICE && !invoiceMode && (
                      <span className="shrink-0 rounded-md bg-success-50 px-1.5 py-0.5 text-[11px] font-semibold text-success-700 dark:bg-success-500/10 dark:text-success-300" title={t("prInvoiceTitle")}>{t("prInvoiceBadge")}</span>
                    )}
                    {file.kind === SIGNED_FORM && (
                      <span className="shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-300" title={t("prSignedFormTitle")}>{t("prSignedFormBadge")}</span>
                    )}
                    <button type="button" onClick={() => setPreviewIndex(index)} className="min-w-0 flex-1 truncate text-left text-sm font-medium text-brand-600 hover:underline dark:text-brand-400" title={file.fileName}>{file.fileName}</button>
                  </div>
                  <span className="shrink-0 text-xs text-gray-500">{[file.uploadedBy, file.uploadedAt && formatDateTime(file.uploadedAt, language)].filter(Boolean).join(" · ")}</span>
                </div>
                {removable && (
                  <button type="button" onClick={() => void remove(file.fileId, file.fileName)} disabled={Boolean(removing) || Boolean(progress)}
                    aria-label={`${t("prRemoveDoc")}: ${file.fileName}`} title={t("prRemoveDoc")}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-error-50 hover:text-error-600 disabled:opacity-50 dark:hover:bg-error-500/10 dark:hover:text-error-400">
                    {removing === file.fileId ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <span aria-hidden="true">✕</span>}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ))}

      {recordedRepairs.length > 0 && (
        <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-white/5 dark:text-gray-300">
          <span className="font-semibold">{t("prRepairSaved")}:</span>{" "}
          {recordedRepairs.map((item) => {
            const repair = item.repair;
            const amount = repair && amountToCents(repair.amount) > BigInt(0)
              ? `${formatMoney(repair.amount, currency, language)}${repair.vat ? ` (VAT ${repair.vat}%)` : ""}`
              : t("prRepairFullRefund");
            return `${item.container}: ${amount}`;
          }).join(" · ")}
        </div>
      )}

      {canUpload && repairRows.length > 0 && (
        <div className="mt-3 rounded-xl border border-warning-200 bg-warning-50/60 p-3 dark:border-warning-500/30 dark:bg-warning-500/10">
          <p className="text-sm font-semibold text-gray-800 dark:text-white/90">{t("prRepairTitle")}</p>
          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">{t("prRepairHint")}</p>
          <div className="mt-3 flex flex-col gap-3">
            {repairRows.map((row) => {
              const key = repairKey(row.item);
              const excess = row.result ? amountToCents(row.result.excess) > BigInt(0) : false;
              return (
                <div key={key} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="font-mono text-sm font-semibold text-gray-800 dark:text-white/90">{row.item.container}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{t("prRepairDeposit")}: {formatMoney(row.item.deposit, currency, language)}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_7rem]">
                    <label className="min-w-0">
                      <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{t("prRepairRefund")}</span>
                      <input value={row.draft.refund} onChange={(event) => setRepairDraft(key, "refund", event.target.value)} inputMode="decimal"
                        placeholder={t("prRepairRefundPlaceholder")} disabled={Boolean(progress)}
                        className={`${REPAIR_INPUT} ${row.refundError ? "border-error-400" : "border-gray-300 dark:border-gray-700"}`} />
                    </label>
                    <label className="min-w-0">
                      <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{t("prRepairVat")}</span>
                      <input value={row.draft.vat} onChange={(event) => setRepairDraft(key, "vat", event.target.value)} inputMode="decimal"
                        placeholder="8" disabled={Boolean(progress)}
                        className={`${REPAIR_INPUT} ${row.vatError ? "border-error-400" : "border-gray-300 dark:border-gray-700"}`} />
                    </label>
                  </div>
                  {(row.refundError || row.vatError) && <p className="mt-1.5 text-xs text-error-600 dark:text-error-400">{row.refundError || row.vatError}</p>}
                  {row.ready && row.result && (
                    <p className="mt-1.5 text-xs font-medium text-gray-700 dark:text-gray-200">
                      {amountToCents(row.result.repair) === BigInt(0) ? t("prRepairFullRefund") : t("prRepairResult", { amount: formatMoney(row.result.repair, currency, language) })}
                    </p>
                  )}
                  {row.ready && excess && (
                    <p className="mt-1 text-xs text-warning-700 dark:text-warning-300">{t("prRepairExcess", { amount: formatMoney(row.result?.excess, currency, language) })}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {canUpload && (
        <>
          <input ref={inputRef} type="file" multiple accept={DOCUMENT_FILE_ACCEPT} className="hidden" onChange={(event) => void upload(Array.from(event.target.files || []))} />
          <div onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }}
            onDrop={handleDrop}
            className={`mt-3 rounded-xl border-2 border-dashed p-3 transition-colors sm:inline-flex sm:min-w-72 sm:flex-col sm:items-center sm:justify-center ${dragActive ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-brand-300 dark:border-brand-500/40"}`}>
            <p className="mb-2 text-center text-xs text-gray-500">{t("prDropFilesHint")}</p>
            <button type="button" onClick={() => inputRef.current?.click()} disabled={Boolean(progress) || !repairsReady}
              title={repairsReady ? undefined : t("prRepairRequired")}
              className={`flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold disabled:opacity-60 sm:w-auto sm:px-6 ${proofMode
                ? "bg-brand-500 text-white hover:bg-brand-600"
                : "text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10"}`}>
              {progress ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />{t("prUploading", { done: progress.done, total: progress.total })}</> : `⬆ ${proofMode ? t("prChooseProofFiles") : invoiceMode ? t("prChooseInvoiceFiles") : t("prChooseFiles")}`}
            </button>
          </div>
          {progress && (
            <div className="mt-2 w-full max-w-sm" role="status" aria-live="polite">
              <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
                <span>{progress.percent < 100 ? t("prUploading", { done: progress.done, total: progress.total }) : t("prUploadFinishing")}</span>
                <span className="tabular-nums">{progress.percent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800" role="progressbar" aria-label={t("prUploadProgress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
                <div className="h-full rounded-full bg-brand-500 transition-[width] duration-300 ease-out" style={{ width: `${progress.percent}%` }} />
              </div>
            </div>
          )}
        </>
      )}

      <PaymentFilePreview files={files.map((file) => ({
        fileName: file.fileName,
        fileUrl: file.fileUrl,
        meta: [file.uploadedBy, file.uploadedAt && formatDateTime(file.uploadedAt, language)].filter(Boolean).join(" · "),
      }))} index={previewIndex} onIndexChange={setPreviewIndex} onVisibilityChange={onPreviewVisibilityChange} />
    </div>
  );
}
