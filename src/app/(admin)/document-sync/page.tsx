"use client";

import { canPerformShipmentAction } from "@/config/shipmentActionPermissions";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import {
  acceptDocumentSync,
  renameDocumentSync,
  restoreDocumentSync,
  scanDocumentSync,
  type DocumentSyncCandidate,
  type DocumentSyncResult,
} from "@/services/shipmentApi";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { recordActivity } from "@/services/activityLogApi";

export default function DocumentSyncPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();
  const canViewSync = canPerformShipmentAction(user, "viewDocumentSync") || canPerformShipmentAction(user, "syncDocuments");
  const canSync = canPerformShipmentAction(user, "syncDocuments");
  const [result, setResult] = useState<DocumentSyncResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renameCandidate, setRenameCandidate] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canViewSync) router.replace("/");
  }, [canViewSync, router]);

  const runScan = async () => {
    if (!canSync) return;
    setScanning(true);
    setError("");
    try {
      const scanResult = await scanDocumentSync();
      setResult(scanResult);
      recordActivity(user, {
        action: "DOCUMENT_SYNC_SCAN",
        location: "Support/DocumentSync",
        detail: t("documentSyncActivityScan", { scannedFiles: scanResult.summary.scannedFiles, pendingCandidates: scanResult.summary.pendingCandidates }),
      });
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : t("documentSyncErrorScan"));
    } finally {
      setScanning(false);
    }
  };

  const accept = async (candidate: DocumentSyncCandidate) => {
    if (!canSync) return;
    if (!candidate.nameValid) {
      setError(t("documentSyncErrorInvalidName", { fileName: candidate.fileName, expectedFileName: candidate.expectedFileName }));
      return;
    }
    setBusyId(candidate.candidateId);
    setError("");
    try {
      await acceptDocumentSync(candidate.candidateId);
      recordActivity(user, {
        action: "DOCUMENT_SYNC_ACCEPT",
        location: `Support/DocumentSync/${candidate.documentCode}`,
        detail: t("documentSyncActivityAccept", { fileName: candidate.fileName, documentCode: candidate.documentCode, orderCode: candidate.orderCode }),
      });
      setResult((current) => current ? {
        ...current,
        candidates: current.candidates.filter((item) => item.candidateId !== candidate.candidateId),
        autoAddedFiles: [...current.autoAddedFiles, {
          fileId: candidate.fileId,
          fileName: candidate.fileName,
          documentCode: candidate.documentCode,
          orderCode: candidate.orderCode,
        }],
        summary: {
          ...current.summary,
          pendingCandidates: Math.max(0, current.summary.pendingCandidates - 1),
          driveOnlyFiles: Math.max(0, current.summary.driveOnlyFiles - 1),
        },
      } : current);
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : t("documentSyncErrorAccept"));
    } finally {
      setBusyId(null);
    }
  };

  const rename = async (candidate: DocumentSyncCandidate) => {
    if (!canSync) return;
    if (!renameValue.trim()) {
      setError(t("documentSyncErrorEmptyName"));
      return;
    }
    setBusyId(candidate.candidateId);
    setError("");
    try {
      const renamed = await renameDocumentSync(candidate.candidateId, renameValue.trim(), candidate.documentCode);
      recordActivity(user, {
        action: "DOCUMENT_SYNC_RENAME",
        location: `Support/DocumentSync/${candidate.documentCode}`,
        detail: t("documentSyncActivityRename", { oldFileName: candidate.fileName, newFileName: renamed.fileName, documentCode: candidate.documentCode, orderCode: renamed.orderCode || candidate.orderCode || t("documentSyncNoOrderCode") }),
      });
      setResult((current) => current ? {
        ...current,
        candidates: current.candidates.map((item) => item.candidateId === candidate.candidateId ? {
          ...item,
          fileName: renamed.fileName,
          fileUrl: renamed.fileUrl,
          orderCode: renamed.orderCode,
          nameValid: true,
        } : item),
      } : current);
      setRenameCandidate(null);
      setRenameValue("");
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : t("documentSyncErrorRename"));
    } finally {
      setBusyId(null);
    }
  };

  const restore = async (fileId: string, documentCode: string) => {
    if (!canSync) return;
    setBusyId(fileId);
    setError("");
    try {
      await restoreDocumentSync(fileId, documentCode);
      recordActivity(user, {
        action: "DOCUMENT_SYNC_RESTORE",
        location: `Support/DocumentSync/${documentCode}`,
        detail: t("documentSyncActivityRestore", { fileId, documentCode }),
      });
      setResult((current) => current ? {
        ...current,
        trashedFiles: current.trashedFiles.filter((file) => file.fileId !== fileId),
      } : current);
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : t("documentSyncErrorRestore"));
    } finally {
      setBusyId(null);
    }
  };

  const openAccept = (candidate: DocumentSyncCandidate) => {
    void accept(candidate);
  };

  if (!canViewSync) return null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">{t("documentSync")}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("documentSyncDescription")}</p>
        </div>
        {canSync && <button type="button" onClick={runScan} disabled={scanning} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60">
          {scanning ? t("documentSyncScanning") : t("documentSyncScan")}
        </button>}
      </div>

      {error && <div className="rounded-lg border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700">{error}</div>}

      {result && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border bg-white p-4 dark:border-gray-800 dark:bg-gray-900"><p className="text-xs text-gray-500">{t("documentSyncScannedFiles")}</p><p className="mt-1 text-2xl font-semibold">{result.summary.scannedFiles}</p></div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10"><p className="text-xs text-amber-700 dark:text-amber-300">{t("documentSyncDriveOnly")}</p><p className="mt-1 text-2xl font-semibold text-amber-800 dark:text-amber-200">{result.summary.driveOnlyFiles}</p></div>
        <div className="rounded-lg border border-error-200 bg-error-50 p-4 dark:border-error-500/30 dark:bg-error-500/10"><p className="text-xs text-error-700 dark:text-error-300">{t("documentSyncTrashed")}</p><p className="mt-1 text-2xl font-semibold text-error-800 dark:text-error-200">{result.summary.trashedFiles}</p></div>
      </div>}

      <section className="rounded-xl border bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b px-4 py-3 dark:border-gray-800"><h2 className="font-semibold text-gray-900 dark:text-white">{t("documentSyncDriveOnlyTitle")}</h2><p className="mt-1 text-xs text-gray-500">{t("documentSyncDriveOnlyDescription")}</p></div>
        {!result && <p className="p-6 text-sm text-gray-500">{t("documentSyncNoResult")}</p>}
        {result?.candidates.length === 0 && <p className="p-6 text-sm text-gray-500">{t("documentSyncNoCandidates")}</p>}
        <div className="divide-y dark:divide-gray-800">
          {result?.candidates.map((candidate) => (
            <div key={candidate.candidateId} className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{candidate.fileName}</p>
                  <p className="text-xs text-gray-500">{candidate.orderCode || t("documentSyncNoOrderCode")} · {candidate.documentCode} · {candidate.folderName}</p>
                  {!candidate.nameValid && <p className="mt-1 text-xs font-semibold text-error-600">{t("documentSyncInvalidName", { fileName: candidate.expectedFileName })}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <a href={candidate.fileUrl} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-2 text-xs font-semibold">{t("documentSyncOpenFile")}</a>
                  {canSync && <><button type="button" onClick={() => { setRenameCandidate(candidate.candidateId); setRenameValue(candidate.fileName); setError(""); }} disabled={busyId === candidate.candidateId} className="rounded-lg border px-3 py-2 text-xs font-semibold">{t("documentSyncRename")}</button>
                  <button type="button" onClick={() => openAccept(candidate)} disabled={busyId === candidate.candidateId} className="rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white">{busyId === candidate.candidateId ? t("documentSyncSaving") : t("documentSyncAccept")}</button></>}
                </div>
              </div>

              {renameCandidate === candidate.candidateId && <div className="flex flex-wrap gap-3 rounded-lg bg-gray-50 p-4 dark:bg-gray-950">
                <input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} placeholder={t("documentSyncNewNamePlaceholder")} className="min-w-64 flex-1 rounded-lg border px-3 py-2 text-sm" />
                <button type="button" onClick={() => void rename(candidate)} disabled={busyId === candidate.candidateId} className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white">{busyId === candidate.candidateId ? t("documentSyncRenaming") : t("documentSyncSaveName")}</button>
                <button type="button" onClick={() => { setRenameCandidate(null); setRenameValue(""); }} disabled={busyId === candidate.candidateId} className="rounded-lg border px-3 py-2 text-sm font-semibold">{t("documentSyncCancel")}</button>
              </div>}

            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b px-4 py-3 dark:border-gray-800"><h2 className="font-semibold text-gray-900 dark:text-white">{t("documentSyncTrashTitle")}</h2><p className="mt-1 text-xs text-gray-500">{t("documentSyncTrashDescription")}</p></div>
        {!result && <p className="p-6 text-sm text-gray-500">{t("documentSyncNoScanResult")}</p>}
        {result?.trashedFiles.length === 0 && <p className="p-6 text-sm text-gray-500">{t("documentSyncNoTrashed")}</p>}
        <div className="divide-y dark:divide-gray-800">
          {result?.trashedFiles.map((file) => (
            <div key={file.fileId} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div><p className="font-medium text-gray-900 dark:text-white">{file.fileName || file.fileId}</p><p className="text-xs text-gray-500">{file.orderCode} · {file.documentCode}</p></div>
              {canSync && <button type="button" onClick={() => void restore(file.fileId, file.documentCode)} disabled={busyId === file.fileId} className="rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white">{busyId === file.fileId ? t("documentSyncRestoring") : t("documentSyncRestore")}</button>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
