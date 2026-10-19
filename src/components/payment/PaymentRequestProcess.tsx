"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemConfirm } from "@/context/SystemConfirmContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import {
  cancelPaymentRequest,
  confirmPaymentRequestDocuments,
  getPaymentRequest,
  sendPaymentRequest,
  type PaymentRequest,
} from "@/services/paymentRequestApi";
import { formatMoney } from "@/utils/paymentRequest";
import PaymentDocumentsPanel from "./PaymentDocumentsPanel";
import PaymentRequestWizard from "./PaymentRequestWizard";
import { PaymentFlowBadge, PaymentStatusBadge, RedFlowBadge, formatDateTime, formatDueDate, isOverdue } from "./PaymentRequestParts";

// Quy trình một đề nghị thanh toán, 4 nút: 1 tạo → 2 gửi → 3 duyệt / từ chối → 4 lưu trữ hồ sơ.
// Nút đang ở mở ra để thao tác, nút đã xong thu gọn kết quả, nút chưa tới bị khoá.

type NodeState = "done" | "current" | "rejected" | "locked";

const NODE_STYLES: Record<NodeState, { circle: string; line: string; label: string }> = {
  done: { circle: "bg-success-500 text-white", line: "bg-success-400", label: "text-gray-700 dark:text-gray-200" },
  current: { circle: "bg-brand-500 text-white ring-4 ring-brand-100 dark:ring-brand-500/20", line: "bg-gray-200 dark:bg-gray-700", label: "text-brand-700 font-semibold dark:text-brand-300" },
  rejected: { circle: "bg-error-500 text-white ring-4 ring-error-100 dark:ring-error-500/20", line: "bg-gray-200 dark:bg-gray-700", label: "text-error-700 font-semibold dark:text-error-300" },
  locked: { circle: "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400", line: "bg-gray-200 dark:bg-gray-700", label: "text-gray-400" },
};

const nodeIcon = (state: NodeState, index: number) => (state === "done" ? "✓" : state === "rejected" ? "✕" : String(index + 1));
const BUTTON_PRIMARY = "h-11 rounded-lg bg-brand-500 px-5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50";
const BUTTON_SECONDARY = "h-11 rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800";

function Stepper({ titles, states }: { titles: string[]; states: NodeState[] }) {
  return (
    <ol className="grid grid-cols-4 gap-1">
      {titles.map((title, index) => (
        <li key={title} className="relative flex flex-col items-center text-center">
          {index < titles.length - 1 && (
            <span className={`absolute left-1/2 top-4 h-0.5 w-full ${states[index] === "done" ? NODE_STYLES.done.line : NODE_STYLES.locked.line}`} aria-hidden="true" />
          )}
          <span className={`relative flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${NODE_STYLES[states[index]].circle}`}>{nodeIcon(states[index], index)}</span>
          <span className={`mt-1.5 px-0.5 text-[11px] leading-tight sm:text-sm ${NODE_STYLES[states[index]].label}`}>{title}</span>
        </li>
      ))}
    </ol>
  );
}

function NodeCard({ index, title, state, last = false, children }: { index: number; title: string; state: NodeState; last?: boolean; children: React.ReactNode }) {
  const { t } = useLanguage();
  const open = state === "current" || state === "rejected";
  return (
    <li className="relative flex gap-3 sm:gap-4">
      {!last && <span className={`absolute left-4 top-9 bottom-0 w-0.5 -translate-x-1/2 ${state === "done" ? NODE_STYLES.done.line : NODE_STYLES.locked.line}`} aria-hidden="true" />}
      <span className={`relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${NODE_STYLES[state].circle}`}>{nodeIcon(state, index)}</span>
      <section className={`mb-4 min-w-0 flex-1 rounded-2xl border p-4 sm:p-5 ${open ? (state === "rejected" ? "border-error-200 bg-white dark:border-error-500/30 dark:bg-white/[0.03]" : "border-brand-300 bg-white shadow-theme-xs dark:border-brand-500/40 dark:bg-white/[0.03]") : state === "locked" ? "border-dashed border-gray-200 bg-gray-50/60 dark:border-gray-800 dark:bg-transparent" : "border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"}`}>
        <h2 className={`font-semibold ${state === "locked" ? "text-sm text-gray-400" : "text-base text-gray-900 dark:text-white"}`}>{title}</h2>
        <div className="mt-2">{state === "locked" ? <p className="text-sm text-gray-400">{t("prNodeLocked")}</p> : children}</div>
      </section>
    </li>
  );
}

export default function PaymentRequestProcess({ id }: { id: string }) {
  const { t, language } = useLanguage();
  const { user, can } = useAuth();
  const { notify } = useSystemNotification();
  const { confirm } = useSystemConfirm();
  const [request, setRequest] = useState<PaymentRequest | null>(null);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"" | "send" | "archive" | "cancel">("");
  const [fileCount, setFileCount] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getPaymentRequest(id, controller.signal)
      .then((data) => { setRequest(data); setError(""); })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : t("prLoadError"));
      });
    return () => controller.abort();
  }, [id, reloadKey, t]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  if (error && !request) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center dark:border-gray-800 dark:bg-white/[0.03]">
        <p className="break-words text-sm text-error-600 dark:text-error-400">{error}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={reload} className={BUTTON_SECONDARY}>{t("prRetry")}</button>
          <Link href="/payment-requests" className={`${BUTTON_SECONDARY} inline-flex items-center`}>{t("prBackToList")}</Link>
        </div>
      </div>
    );
  }
  if (!request) return <div className="flex justify-center py-20"><div className="h-9 w-9 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>;

  const isOwner = Boolean(user?.id) && Number(user?.id) === request.userId && can("paymentRequests", "edit");
  // Người tạo, hoặc kế toán (paymentRequestsAll edit) sửa / gửi / hủy được đề nghị của mọi người.
  const canManage = isOwner || (can("paymentRequests", "edit") && can("paymentRequestsAll", "edit"));
  const sent = request.sent;
  const cancelled = request.status === -2;
  // Chưa duyệt (nháp / đang chờ) hoặc bị từ chối: sửa hoặc hủy được.
  const canEdit = canManage && (request.status === 0 || request.status === -1);
  // Chứng từ upload dần (tạm) cho tới khi bấm "Đầy đủ chứng từ"; đề nghị đã hủy / hoàn thành thì khóa.
  const canUploadDocs = (isOwner || can("paymentDocuments", "edit")) && request.status !== 2 && !cancelled;
  const canArchive = can("paymentDocuments", "edit") && request.status === 1;
  const money = (value: string) => formatMoney(value, request.currency, language);
  const states: NodeState[] = [
    editing ? "current" : "done",
    editing || (cancelled && !sent) ? "locked" : !sent ? "current" : "done",
    editing ? "locked" : cancelled ? "rejected" : !sent ? "locked" : request.status === 0 ? "current" : request.status === -1 ? "rejected" : "done",
    editing ? "locked" : request.status === 1 ? "current" : request.status === 2 ? "done" : "locked",
  ];
  const titles = [t("prNode1"), t("prNode2"), t("prNode3"), t("prNode4")];

  const startEdit = () => {
    setEditing(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const send = async () => {
    if (busy) return;
    setBusy("send");
    try {
      setRequest(await sendPaymentRequest(request.id));
      notify(t("prSentSuccess", { id: request.id }), "success");
    } catch (sendError) {
      notify(sendError instanceof Error ? sendError.message : String(sendError), "error");
    } finally {
      setBusy("");
    }
  };

  const cancelRequest = async () => {
    if (busy) return;
    if (!await confirm({ title: t("prCancelRequest"), message: t("prCancelMessage", { id: request.id }), confirmText: t("prCancelRequest"), tone: "danger" })) return;
    setBusy("cancel");
    try {
      setRequest(await cancelPaymentRequest(request.id));
      setEditing(false);
      notify(t("prCancelledToast", { id: request.id }), "success");
    } catch (cancelError) {
      notify(cancelError instanceof Error ? cancelError.message : String(cancelError), "error");
    } finally {
      setBusy("");
    }
  };

  const archive = async () => {
    if (busy) return;
    if (!await confirm({ title: t("prArchive"), message: t("prArchiveMessage", { id: request.id }), confirmText: t("prArchive") })) return;
    setBusy("archive");
    try {
      setRequest(await confirmPaymentRequestDocuments(request.id));
      notify(t("prArchived", { id: request.id }), "success");
    } catch (archiveError) {
      notify(archiveError instanceof Error ? archiveError.message : String(archiveError), "error");
    } finally {
      setBusy("");
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(request.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03] sm:p-6">
        <Link href="/payment-requests" className="text-sm text-gray-500 hover:text-brand-600">← {t("prBackToList")}</Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-xl font-bold text-gray-900 dark:text-white">{request.id}</h1>
          <PaymentStatusBadge status={request.status} draft={!sent} />
          {request.hasRed && <RedFlowBadge />}
          <span className="ml-auto text-lg font-bold tabular-nums text-gray-900 dark:text-white">{money(request.total)}</span>
        </div>
        <p className="mt-1 break-words text-sm text-gray-600 dark:text-gray-300">{request.content}</p>
        {cancelled && <p className="mt-3 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-300">🚫 {t("prCancelledInfo", { time: formatDateTime(request.updatedAt, language) })}</p>}
        {canEdit && !editing && (
          <div className="mt-3 flex justify-end">
            <button type="button" onClick={() => void cancelRequest()} disabled={busy !== ""}
              className="h-10 w-full rounded-lg border border-error-200 px-4 text-sm font-medium text-error-600 hover:bg-error-50 disabled:opacity-50 sm:w-auto dark:border-error-500/30 dark:text-error-400 dark:hover:bg-error-500/10">
              {busy === "cancel" ? t("prSaving") : t("prCancelRequest")}
            </button>
          </div>
        )}
        <div className="mt-5"><Stepper titles={titles} states={states} /></div>
      </header>

      <ol>
        {/* 1. Tạo đề nghị */}
        <NodeCard index={0} title={editing ? t("prEditTitle", { id: request.id }) : titles[0]} state={states[0]}>
          {editing ? (
            <PaymentRequestWizard editing={request} onCancel={() => setEditing(false)} onSaved={(saved) => { setRequest(saved); setEditing(false); }} />
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">{t("prCreatedBy", { name: request.creatorName || "—", time: formatDateTime(request.createdAt, language) })}</p>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div><dt className="text-gray-500">{t("prCurrency")}</dt><dd className="font-medium text-gray-800 dark:text-white/90">{request.currency}</dd></div>
                <div><dt className="text-gray-500">{t("prDueDate")}</dt><dd className={`font-medium ${isOverdue(request.dueDate, request.status) ? "text-error-600" : "text-gray-800 dark:text-white/90"}`}>{formatDueDate(request.dueDate)}</dd></div>
                <div><dt className="text-gray-500">{t("prTotal")}</dt><dd className="font-bold tabular-nums text-gray-900 dark:text-white">{money(request.total)}</dd></div>
              </dl>
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
                {request.costs.map((cost) => (
                  <li key={cost.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-gray-800 dark:text-white/90">{cost.code} <PaymentFlowBadge flow={cost.flow} /></p>
                      <p className="truncate text-xs text-gray-500" title={cost.categoryName}>
                        {cost.categoryName} · {cost.container ? `${t("prContainer")} ${cost.container}` : cost.contract ? `${t("prContract")} ${cost.contract}` : t("prNoTarget")}
                      </p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{money(cost.amount)}</span>
                  </li>
                ))}
              </ul>
              {canEdit && <button type="button" onClick={startEdit} className={`${BUTTON_SECONDARY} w-full sm:w-auto`}>✎ {t("prEditRequest")}</button>}
            </div>
          )}
        </NodeCard>

        {/* 2. Gửi đề nghị */}
        <NodeCard index={1} title={titles[1]} state={states[1]}>
          {!sent ? (
            canManage && !cancelled ? (
              <div className="space-y-3">
                {/* Đính kèm hóa đơn nháp / chứng từ trước khi gửi: thẻ Google Chat hiện link từng file. */}
                <div className="rounded-xl border border-gray-200 p-3 sm:p-4 dark:border-gray-700">
                  <p className="mb-2 text-sm font-semibold text-gray-800 dark:text-white/90">{t("prAttachBeforeSend")}</p>
                  <PaymentDocumentsPanel requestId={request.id} canUpload={canUploadDocs} onFilesChange={setFileCount} onUploaded={reload} />
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300">{t("prReviewHint")}</p>
                <button type="button" onClick={() => void send()} disabled={busy !== ""} className={`${BUTTON_PRIMARY} w-full sm:w-auto`}>
                  {busy === "send" ? t("prSending") : `➤ ${t("prConfirmSend")}`}
                </button>
              </div>
            ) : <p className="text-sm text-gray-500">{t("prDraftOther")}</p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-gray-700 dark:text-gray-200">✓ {t("prSentAt")}</p>
              {canManage && request.status === 0 && (
                <button type="button" onClick={() => void send()} disabled={busy !== ""} className={BUTTON_SECONDARY}>{busy === "send" ? t("prSending") : t("prResendChat")}</button>
              )}
            </div>
          )}
        </NodeCard>

        {/* 3. Duyệt / từ chối */}
        <NodeCard index={2} title={titles[2]} state={states[2]}>
          {request.status === 0 && (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-sm font-medium text-warning-700 dark:text-warning-300"><span className="h-2 w-2 animate-pulse rounded-full bg-warning-500" />{t("prWaitingApproval")}</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">{t("prHowToApprove")}</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-lg bg-gray-100 px-3 py-2 font-mono text-sm text-gray-800 dark:bg-gray-800 dark:text-gray-100">@… {request.id}</code>
                <button type="button" onClick={() => void copyCode()} className="h-9 rounded-lg px-3 text-sm font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10">{copied ? t("prCopied") : t("prCopy")}</button>
              </div>
            </div>
          )}
          {(request.status === 1 || request.status === 2) && (
            <p className="text-sm text-success-700 dark:text-success-300">✓ {t("prApprovedBy", { name: request.approverName || "—", time: formatDateTime(request.updatedAt, language) })}</p>
          )}
          {cancelled && <p className="text-sm text-gray-600 dark:text-gray-300">🚫 {t("prCancelledInfo", { time: formatDateTime(request.updatedAt, language) })}</p>}
          {request.status === -1 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-error-700 dark:text-error-300">{t("prRejectedBy", { name: request.approverName || "—", time: formatDateTime(request.updatedAt, language) })}</p>
              <p className="break-words rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-300"><span className="font-semibold">{t("prRejectReason")}:</span> {request.rejectReason}</p>
              {canEdit && <button type="button" onClick={startEdit} className={`${BUTTON_PRIMARY} w-full sm:w-auto`}>✎ {t("prEditAfterReject")}</button>}
            </div>
          )}
        </NodeCard>

        {/* 4. Lưu trữ hồ sơ */}
        <NodeCard index={3} title={titles[3]} state={states[3]} last>
          <PaymentDocumentsPanel requestId={request.id} canUpload={canUploadDocs} onFilesChange={setFileCount} onUploaded={reload} />
          {request.status === 1 && (
            <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
              {fileCount > 0 && <p className="mb-3 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700 dark:bg-warning-500/10 dark:text-warning-300">{t("prDocsDraftHint", { count: fileCount })}</p>}
              {canArchive ? (
                <>
                  <button type="button" onClick={() => void archive()} disabled={busy !== "" || fileCount === 0} className={`h-11 w-full rounded-lg bg-success-600 px-5 text-sm font-semibold text-white hover:bg-success-700 disabled:opacity-50 sm:w-auto`}>
                    {busy === "archive" ? t("prSaving") : `🗄 ${t("prArchive")}`}
                  </button>
                  {fileCount === 0 && <p className="mt-2 text-xs text-gray-500">{t("prArchiveNeedsFile")}</p>}
                </>
              ) : <p className="text-sm text-gray-500">{t("prWaitArchive")}</p>}
            </div>
          )}
          {request.status === 2 && <p className="mt-3 text-sm font-medium text-success-700 dark:text-success-300">✓ {t("prCompletedHint")}</p>}
        </NodeCard>
      </ol>
    </div>
  );
}
