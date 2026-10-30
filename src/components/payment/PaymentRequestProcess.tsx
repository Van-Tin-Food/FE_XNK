"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemConfirm } from "@/context/SystemConfirmContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import {
  cancelPaymentRequest,
  confirmPaymentRequestDocuments,
  deletePaymentRequest,
  fetchPaymentRequestPrintHtml,
  PAYMENT_METHOD_LABEL_KEYS,
  PAYMENT_PROOF,
  getPaymentRequest,
  approvePaymentRequest,
  notifyMissingPaymentDocuments,
  rejectPaymentRequest,
  sendPaymentRequest,
  type PaymentRequest,
} from "@/services/paymentRequestApi";
import { costCodeName, formatMoney, splitVat } from "@/utils/paymentRequest";
import { saveSignedPaymentRequestPdf } from "@/utils/paymentRequestSignedPdf";
import PaymentDocumentsPanel from "./PaymentDocumentsPanel";
import PaymentTransferQr from "./PaymentTransferQr";
import PaymentRequestWizard from "./PaymentRequestWizard";
import { PaymentFlowBadge, PaymentStatusBadge, RedFlowBadge, formatDateTime, formatDueDate, isOverdue } from "./PaymentRequestParts";

// Quy trình một đề nghị thanh toán, 4 nút: 1 lên đề nghị & gửi → 2 duyệt / từ chối → 3 chi tiền (upload ủy nhiệm chi / ảnh
// chuyển tiền) → 4 lưu trữ hồ sơ. Nút đang ở mở ra để thao tác, nút đã xong thu gọn kết quả, nút chưa tới bị khoá.
// Thông báo bổ sung chứng từ gửi vào hộp chat Google Chat cá nhân của người đề nghị (họ không ở trong nhóm Chat duyệt).

type NodeState = "done" | "current" | "rejected" | "locked";

const NODE_STYLES: Record<NodeState, { circle: string; line: string; label: string }> = {
  done: { circle: "bg-success-500 text-white", line: "bg-success-400", label: "text-gray-700 dark:text-gray-200" },
  current: { circle: "bg-brand-500 text-white ring-4 ring-brand-100 dark:ring-brand-500/20", line: "bg-gray-200 dark:bg-gray-700", label: "text-brand-700 font-semibold dark:text-brand-300" },
  rejected: { circle: "bg-error-500 text-white ring-4 ring-error-100 dark:ring-error-500/20", line: "bg-gray-200 dark:bg-gray-700", label: "text-error-700 font-semibold dark:text-error-300" },
  locked: { circle: "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400", line: "bg-gray-200 dark:bg-gray-700", label: "text-gray-400" },
};

/** Mỏ neo bước chi tiền (nút "Upload UNC" trên thẻ Google Chat mở .../payment-requests/<mã>#chi-tien). */
const PAYMENT_ANCHOR = "chi-tien";
const nodeIcon = (state: NodeState, index: number) => (state === "done" ? "✓" : state === "rejected" ? "✕" : String(index + 1));
/** Chờ duyệt trên Google Chat: chu kỳ hỏi lại trạng thái đề nghị. */
const POLL_MS = 8000;
const BUTTON_PRIMARY ="h-11 rounded-lg bg-brand-500 px-5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50";
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

function NodeCard({ index, title, state, last = false, anchor, children }: { index: number; title: string; state: NodeState; last?: boolean; anchor?: string; children: React.ReactNode }) {
  const { t } = useLanguage();
  const open = state === "current" || state === "rejected";
  return (
    <li id={anchor} className="relative flex scroll-mt-20 gap-3 sm:gap-4">
      {!last && <span className={`absolute left-4 top-9 bottom-0 w-0.5 -translate-x-1/2 ${state === "done" ? NODE_STYLES.done.line : NODE_STYLES.locked.line}`} aria-hidden="true" />}
      <span className={`relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${NODE_STYLES[state].circle}`}>{nodeIcon(state, index)}</span>
      <section className={`mb-4 min-w-0 flex-1 rounded-2xl border p-4 sm:p-5 ${open ? (state === "rejected" ? "border-error-200 bg-white dark:border-error-500/30 dark:bg-white/[0.03]" : "border-brand-300 bg-white shadow-theme-xs dark:border-brand-500/40 dark:bg-white/[0.03]") : state === "locked" ? "border-dashed border-gray-200 bg-gray-50/60 dark:border-gray-800 dark:bg-transparent" : "border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"}`}>
        <h2 className={`font-semibold ${state === "locked" ? "text-sm text-gray-400" : "text-base text-gray-900 dark:text-white"}`}>{title}</h2>
        <div className="mt-2">{state === "locked" ? <p className="text-sm text-gray-400">{t("prNodeLocked")}</p> : children}</div>
      </section>
    </li>
  );
}

/**
 * Nút "Báo thiếu chứng từ" + ô nhập mở ngay dưới nút: gửi vào hộp chat Google Chat cá nhân của người đề nghị (người kiểm
 * tra hồ sơ / người duyệt dùng khi cần bổ sung chứng từ để duyệt hoặc lưu trữ).
 */
function MissingDocumentsNotice({ requestId, creatorName, disabled }: { requestId: string; creatorName: string; disabled: boolean }) {
  const { t } = useLanguage();
  const { notify } = useSystemNotification();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [touched, setTouched] = useState(false);
  const inputId = `pr-missing-note-${requestId}`;
  const noteError = touched && !note.trim() ? t("prMissingNoteRequired") : "";

  const send = async () => {
    const text = note.trim();
    setTouched(true);
    if (sending) return;
    if (!text) {
      notify(t("prMissingNoteRequired"), "error");
      return;
    }
    setSending(true);
    try {
      const result = await notifyMissingPaymentDocuments(requestId, text);
      notify(t("prMissingSent", { name: result.requesterName || creatorName || "—" }), "success");
      setNote("");
      setTouched(false);
      setOpen(false);
    } catch (missingError) {
      notify(missingError instanceof Error ? missingError.message : String(missingError), "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <button type="button" onClick={() => setOpen((value) => !value)} disabled={disabled || sending} aria-expanded={open}
        className="h-11 w-full rounded-lg border border-warning-300 px-5 text-sm font-semibold text-warning-700 hover:bg-warning-50 disabled:opacity-50 sm:w-auto dark:border-warning-500/40 dark:text-warning-300 dark:hover:bg-warning-500/10">
        {t("prMissingButton")}
      </button>
      {open && (
        <div className="mt-3 rounded-xl border border-warning-200 bg-warning-50/60 p-3 dark:border-warning-500/30 dark:bg-warning-500/5">
          <label htmlFor={inputId} className="block text-sm font-semibold text-gray-800 dark:text-white/90">{t("prMissingLabel")}</label>
          <p className="mt-0.5 text-xs text-gray-500">{t("prMissingHint", { name: creatorName || "—" })}</p>
          <textarea id={inputId} value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={1000}
            placeholder={t("prMissingPlaceholder")} autoFocus aria-invalid={Boolean(noteError)}
            className={`mt-2 w-full min-w-0 rounded-lg border bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-400 dark:bg-gray-900 dark:text-white ${noteError ? "border-error-400" : "border-gray-200 dark:border-gray-700"}`} />
          <div className="flex justify-between gap-2 text-xs">
            {noteError ? <span className="text-error-600 dark:text-error-400">{noteError}</span> : <span />}
            <span className="shrink-0 tabular-nums text-gray-400">{note.length}/1000</span>
          </div>
          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => { setOpen(false); setNote(""); setTouched(false); }} disabled={sending}
              className="h-10 w-full rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 sm:w-auto dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
              {t("cancel")}
            </button>
            <button type="button" onClick={() => void send()} disabled={sending}
              className="h-10 w-full rounded-lg bg-warning-600 px-4 text-sm font-semibold text-white hover:bg-warning-700 disabled:opacity-50 sm:w-auto">
              {sending ? t("prSaving") : t("prMissingSend")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Thông tin chuyển khoản dạng chữ: chỉ hiện khi không có mã QR (khối QR đã ghi người nhận, tài khoản, nội dung). */
function TransferInfoText({ text }: { text: string }) {
  const { t } = useLanguage();
  return (
    <div className="text-sm">
      <p className="text-gray-500">{t("prTransferInfo")}</p>
      <p className="whitespace-pre-line break-words font-medium text-gray-800 dark:text-white/90">{text || "—"}</p>
    </div>
  );
}

export default function PaymentRequestProcess({ id }: { id: string }) {
  const { t, language } = useLanguage();
  const { user, can } = useAuth();
  const { notify } = useSystemNotification();
  const { confirm } = useSystemConfirm();
  const router = useRouter();
  const [request, setRequest] = useState<PaymentRequest | null>(null);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"" | "send" | "archive" | "cancel" | "delete" | "download" | "approve" | "reject">("");
  // Đang tạo + lưu giấy đề nghị đã ký (PDF) sau khi upload ủy nhiệm chi.
  const [savingSignedForm, setSavingSignedForm] = useState(false);
  const [fileCount, setFileCount] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
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

  // Đã gửi, đang chờ duyệt hoặc chờ chi tiền (duyệt / gửi ủy nhiệm chi có thể làm trên Google Chat): hỏi lại BE mỗi POLL_MS
  // (tab đang mở) và ngay khi quay lại tab, có thay đổi thì cập nhật trang luôn, không cần F5. Đang sửa đề nghị thì không hỏi.
  const awaitingDecision = Boolean(request && request.sent && request.status === 0 && !editing);
  const awaitingUpdate = Boolean(request && request.sent && (request.status === 0 || request.status === 1) && !editing);
  const currentVersion = request?.updatedAt || "";
  const currentStatus = request?.status ?? 0;
  const currentCanRecordPayment = request?.canRecordPayment ?? null;
  useEffect(() => {
    if (!awaitingUpdate) return undefined;
    let stopped = false;
    let running = false;
    const check = async () => {
      if (stopped || running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const fresh = await getPaymentRequest(id);
        if (stopped || (fresh.status === currentStatus && fresh.updatedAt === currentVersion
          && fresh.canRecordPayment === currentCanRecordPayment && fresh.sent)) return;
        const statusChanged = fresh.status !== currentStatus;
        setRequest(fresh);
        if (!statusChanged) return;
        if (fresh.status === 1) notify(t("prLiveApproved", { id: fresh.id, name: fresh.approverName || "—" }), "success");
        else if (fresh.status === 3) notify(t("prLivePaid", { id: fresh.id }), "success");
        else if (fresh.status === -1) notify(t("prLiveRejected", { id: fresh.id, name: fresh.approverName || "—" }), "error");
      } catch {
        // Lỗi mạng tạm thời: lần sau hỏi lại.
      } finally {
        running = false;
      }
    };
    const timer = window.setInterval(() => void check(), POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [awaitingUpdate, currentCanRecordPayment, currentStatus, currentVersion, id, notify, t]);

  // Link từ nút "Upload UNC" trên thẻ Google Chat (#chi-tien): cuộn tới bước chi tiền khi trang đã tải xong.
  const loaded = Boolean(request);
  useEffect(() => {
    if (!loaded || window.location.hash !== `#${PAYMENT_ANCHOR}`) return;
    document.getElementById(PAYMENT_ANCHOR)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [loaded]);

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
  // Sửa / gửi / hủy: người tạo, kế toán (paymentRequestsAll edit), người được ủy quyền tạo đề nghị thay (đề nghị chưa duyệt).
  // BE tính sẵn can_manage; bản BE cũ chưa trả thì tính như trước.
  const canManage = request.canManage ?? (isOwner || (can("paymentRequests", "edit") && can("paymentRequestsAll", "edit")));
  const sent = request.sent;
  const cancelled = request.status === -2;
  // Chưa duyệt (nháp / đang chờ) hoặc bị từ chối: sửa, hủy, xóa được. Đã hủy: không duyệt được nữa nhưng vẫn sửa (về nháp,
  // gửi lại) hoặc xóa được.
  const canCancel = canManage && (request.status === 0 || request.status === -1);
  const canEdit = canCancel || (canManage && cancelled);
  // Chứng từ upload dần (tạm) cho tới khi bấm "Đầy đủ chứng từ"; đề nghị đã hủy / hoàn thành thì khóa. BE trả
  // can_upload_documents (gồm người tạo đề nghị thay khi chưa duyệt).
  const canUploadDocs = (request.canUploadDocuments ?? (isOwner || can("paymentDocuments", "edit"))) && request.status !== 2 && !cancelled;
  // Chi tiền (upload ủy nhiệm chi): người duyệt / được ủy quyền / người lưu trữ chứng từ — BE trả can_record_payment.
  const canRecordPayment = request.canRecordPayment === true;
  const canUploadProof = canRecordPayment && (request.status === 1 || request.status === 3);
  // Đã chi tiền (có ủy nhiệm chi): hồ sơ chỉ bổ sung, chỉ người có quyền chi tiền / lưu trữ bỏ được file (BE cũng chặn).
  const canRemoveDocs = request.status !== 3 || canRecordPayment;
  // Lưu trữ (đầy đủ chứng từ) chỉ sau khi đã chi tiền.
  const canArchive = can("paymentDocuments", "edit") && request.status === 3;
  // Báo thiếu chứng từ vào Chat cá nhân người đề nghị: khi đã gửi và chưa lưu trữ / hủy.
  const canSendMissing = canRecordPayment && ((request.status === 0 && sent) || request.status === 1 || request.status === 3);
  // Luồng đỏ chỉ kế toán được duyệt / từ chối: BE trả can_decide theo người đang xem.
  const awaitingSentDecision = request.status === 0 && request.sent;
  const canApprove = can("paymentApprove", "edit") && request.canDecide !== false && awaitingSentDecision;
  const redFlowBlocked = can("paymentApprove", "edit") && request.canDecide === false && awaitingSentDecision;
  const money = (value: string) => formatMoney(value, request.currency, language);
  const paidOrArchived = request.status === 3 || request.status === 2;
  const states: NodeState[] = [
    // 1 Lên đề nghị & gửi
    editing ? "current" : cancelled && !sent ? "rejected" : !sent ? "current" : "done",
    // 2 Duyệt
    editing || !sent ? "locked" : cancelled ? "rejected" : request.status === 0 ? "current" : request.status === -1 ? "rejected" : "done",
    // 3 Chi tiền
    editing ? "locked" : request.status === 1 ? "current" : paidOrArchived ? "done" : "locked",
    // 4 Lưu trữ hồ sơ
    editing ? "locked" : request.status === 3 ? "current" : request.status === 2 ? "done" : "locked",
  ];
  const titles = [t("prNode1"), t("prNode2"), t("prNode3"), t("prNode4")];

  const startEdit = () => {
    setEditing(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /** Mở bản in Giấy đề nghị thanh toán ở tab mới (xem trước → In / Lưu PDF). Mở tab ngay khi bấm để không bị chặn popup. */
  const openPrint = async () => {
    if (busy) return;
    const preview = window.open("", "_blank");
    if (!preview) {
      notify(t("prPrintBlocked"), "error");
      return;
    }
    preview.document.write(`<p style="font-family:sans-serif;padding:24px">${t("prPrintLoading")}</p>`);
    setBusy("download");
    try {
      const html = await fetchPaymentRequestPrintHtml(request.id);
      preview.document.open();
      preview.document.write(html);
      preview.document.close();
    } catch (printError) {
      preview.close();
      notify(printError instanceof Error ? printError.message : String(printError), "error");
    } finally {
      setBusy("");
    }
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

  // Upload ủy nhiệm chi xong mà đề nghị vừa từ "đã duyệt" sang "đã chi tiền" (đủ chữ ký kế toán trưởng): người upload lưu
  // luôn giấy đề nghị đã ký (PDF bản in) vào hồ sơ. Upload thêm ủy nhiệm chi khi đã chi tiền thì không tạo lại.
  const proofUploaded = async () => {
    const becamePaid = request.status === 1;
    reload();
    if (!becamePaid) return;
    setSavingSignedForm(true);
    try {
      const file = await saveSignedPaymentRequestPdf(request.id);
      notify(t("prSignedFormSaved", { name: file.fileName }), "success");
      reload();
    } catch (saveError) {
      notify(t("prSignedFormFailed", { reason: saveError instanceof Error ? saveError.message : String(saveError) }), "warning");
    } finally {
      setSavingSignedForm(false);
    }
  };

  const deleteRequest = async () => {
    if (busy) return;
    if (!await confirm({ title: t("prDeleteRequest"), message: t("prDeleteMessage", { id: request.id }), confirmText: t("prDeleteRequest"), tone: "danger" })) return;
    setBusy("delete");
    try {
      const { releasedCosts } = await deletePaymentRequest(request.id);
      notify(t("prDeletedToast", { id: request.id, count: String(releasedCosts) }), "success");
      router.replace("/payment-requests");
    } catch (deleteError) {
      notify(deleteError instanceof Error ? deleteError.message : String(deleteError), "error");
      setBusy("");
    }
  };

  const approveRequest = async () => {
    if (busy || !canApprove) return;
    setBusy("approve");
    try {
      const approved = await approvePaymentRequest(request.id);
      setRequest(approved);
      try {
        setRequest(await getPaymentRequest(request.id));
      } catch {
        reload();
      }
      notify(t("prApprovedBy", { name: user?.name || user?.username || "—", time: formatDateTime(new Date().toISOString(), language) }), "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally { setBusy(""); }
  };

  const rejectRequest = async () => {
    if (busy || !canApprove) return;
    const note = window.prompt(t("prRejectReason"));
    if (note === null) return; // bấm Huỷ
    if (!note.trim()) {
      notify(t("prRejectReasonRequired"), "error");
      return;
    }
    setBusy("reject");
    try {
      setRequest(await rejectPaymentRequest(request.id, note.trim()));
      notify(t("prRejectedBy", { name: user?.name || user?.username || "—", time: formatDateTime(new Date().toISOString(), language) }), "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally { setBusy(""); }
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
    <>
      {previewOpen && <div className="fixed inset-0 z-[100000] hidden bg-gray-400/50 backdrop-blur-[32px] md:block" aria-hidden="true" />}
      <div className={previewOpen
        ? "space-y-5 md:fixed md:bottom-4 md:left-4 md:top-4 md:z-[100000] md:w-[calc(50vw-1.5rem)] md:overflow-y-auto md:overscroll-contain"
        : "space-y-5"}>
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
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
            {canCancel && (
              <button type="button" onClick={() => void cancelRequest()} disabled={busy !== ""}
                className="h-10 w-full rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 sm:w-auto dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
                {busy === "cancel" ? t("prSaving") : t("prCancelRequest")}
              </button>
            )}
            <button type="button" onClick={() => void deleteRequest()} disabled={busy !== ""}
              className="h-10 w-full rounded-lg border border-error-200 px-4 text-sm font-medium text-error-600 hover:bg-error-50 disabled:opacity-50 sm:w-auto dark:border-error-500/30 dark:text-error-400 dark:hover:bg-error-500/10">
              {busy === "delete" ? t("prDeleting") : `🗑 ${t("prDeleteRequest")}`}
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
                <div className="col-span-2 sm:col-span-3"><dt className="text-gray-500">{t("prContent")}</dt><dd className="whitespace-pre-line break-words font-medium text-gray-800 dark:text-white/90">{request.content || "—"}</dd></div>
                {/* Hạn thanh toán · loại tiền · hình thức: chung một ô */}
                <div className="col-span-2 sm:col-span-1"><dt className="text-gray-500">{t("prPaymentLineLabel")}</dt>
                  <dd className="font-medium text-gray-800 dark:text-white/90">
                    <span className={isOverdue(request.dueDate, request.status) ? "text-error-600" : ""}>{formatDueDate(request.dueDate)}</span>
                    {` · ${request.currency} · ${request.paymentMethod ? t(PAYMENT_METHOD_LABEL_KEYS[request.paymentMethod]) : "—"}`}
                  </dd>
                </div>
                <div><dt className="text-gray-500">{t("prTotal")}</dt><dd className="font-bold tabular-nums text-gray-900 dark:text-white">{money(request.total)}</dd></div>
                {request.costs[0] && (
                  <div><dt className="text-gray-500">{t("prCostTypeLabel")} / {request.costs[0].code.toUpperCase() === "VH" ? t("pcatAccount") : t("prCostCodeLabel")}</dt><dd className="font-medium text-gray-800 dark:text-white/90">{t(`prType_${request.costs[0].type}`)} · {request.costs[0].code.toUpperCase() === "VH" ? request.costs[0].account || "—" : request.costs[0].code}</dd></div>
                )}
              </dl>
              {/* Mã VietQR (chuyển khoản trong nước bằng VND), không có mã thì thông tin chuyển khoản dạng chữ. Đang chờ chi
                  tiền thì cả hai nằm ở bước Chi tiền. */}
              {request.paymentMethod === "chuyen_khoan" && request.status !== 1 && !editing && (
                <PaymentTransferQr requestId={request.id} version={`${request.updatedAt}-${request.total}`}
                  fallback={<TransferInfoText text={request.transferInfo} />} />
              )}
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
                {request.costs.map((cost) => (
                  <li key={cost.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-gray-800 dark:text-white/90">
                        <span className="break-words">{cost.code.toUpperCase() === "VH" ? [cost.account, cost.categoryName].filter(Boolean).join(" · ") : costCodeName(cost.code, cost.categoryName)}{cost.note && <span className="font-normal text-gray-600 dark:text-gray-300"> — {cost.note}</span>}</span>
                        <PaymentFlowBadge flow={cost.flow} />
                      </p>
                      <p className="truncate text-xs text-gray-500">
                        {cost.container ? `${t("prContainer")} ${cost.container} · ${t("prContract")} ${cost.contract}` : cost.contract ? `${t("prContract")} ${cost.contract}` : t("prNoTarget")}
                      </p>
                      {cost.vat && (() => {
                        const { base, tax } = splitVat(cost.amount, String(Number(cost.vat)), request.currency);
                        return <p className="text-xs text-gray-500">{t("prVatLine", { base: money(base), rate: String(Number(cost.vat)), tax: money(tax) })}</p>;
                      })()}
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{money(cost.amount)}</span>
                  </li>
                ))}
              </ul>
              {canEdit && <button type="button" onClick={startEdit} className={`${BUTTON_SECONDARY} w-full sm:w-auto`}>✎ {t("prEditRequest")}</button>}

              {/* Gửi đề nghị lên Google Chat (kèm chứng từ đính kèm) */}
              <div className="border-t border-gray-100 pt-3 dark:border-gray-800">
                {!sent ? (
                  canManage && !cancelled ? (
                    <div className="space-y-3">
                      {/* Đính kèm hóa đơn nháp / chứng từ trước khi gửi: thẻ Google Chat hiện link từng file. */}
                      <div className="rounded-xl border border-gray-200 p-3 sm:p-4 dark:border-gray-700">
                        <p className="mb-2 text-sm font-semibold text-gray-800 dark:text-white/90">{t("prAttachBeforeSend")}</p>
                        <PaymentDocumentsPanel requestId={request.id} canUpload={canUploadDocs} onFilesChange={setFileCount} onUploaded={reload} onPreviewVisibilityChange={setPreviewOpen} />
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-300">{t("prReviewHint")}</p>
                      <button type="button" onClick={() => void send()} disabled={busy !== ""} className={`${BUTTON_PRIMARY} w-full sm:w-auto`}>
                        {busy === "send" ? t("prSending") : `➤ ${t("prConfirmSend")}`}
                      </button>
                    </div>
                  ) : <p className="text-sm text-gray-500">{cancelled ? `🚫 ${t("prCancelledInfo", { time: formatDateTime(request.updatedAt, language) })}` : t("prDraftOther")}</p>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-gray-700 dark:text-gray-200">✓ {t("prSentAt")}</p>
                    {canManage && request.status === 0 && (
                      <button type="button" onClick={() => void send()} disabled={busy !== ""} className={BUTTON_SECONDARY}>{busy === "send" ? t("prSending") : t("prResendChat")}</button>
                    )}
                  </div>
                )}
                <button type="button" onClick={() => void openPrint()} disabled={busy !== ""} title={t("prDownloadHint")}
                  className="mt-2 inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-brand-600 hover:bg-brand-50 disabled:opacity-50 dark:text-brand-400 dark:hover:bg-brand-500/10">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2" />
                    <rect x="6" y="14" width="12" height="7" />
                  </svg>
                  {busy === "download" ? t("prDownloading") : t("prDownload")}
                </button>
              </div>
            </div>
          )}
        </NodeCard>

        {/* 2. Duyệt / từ chối */}
        <NodeCard index={1} title={titles[1]} state={states[1]}>
          {request.status === 0 && (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-sm font-medium text-warning-700 dark:text-warning-300"><span className="h-2 w-2 animate-pulse rounded-full bg-warning-500" />{t("prWaitingApproval")}</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">{t("prHowToApprove")}</p>
              {awaitingDecision && <p className="text-xs text-gray-500">{t("prLiveHint")}</p>}
              {redFlowBlocked && <p className="border-t border-gray-100 pt-3 text-sm text-error-600 dark:border-gray-800 dark:text-error-400">{t("prRedFlowAccountantOnly")}</p>}
              {canApprove && (
                <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
                  <p className="w-full text-xs text-gray-500">{t("prSystemApprovalHint")}</p>
                  <button type="button" onClick={() => void approveRequest()} disabled={busy !== ""} className="h-10 rounded-lg bg-success-600 px-4 text-sm font-semibold text-white hover:bg-success-700 disabled:opacity-50">
                    {busy === "approve" ? t("prSaving") : t("prApproveSystem")}
                  </button>
                  <button type="button" onClick={() => void rejectRequest()} disabled={busy !== ""} className="h-10 rounded-lg border border-error-200 px-4 text-sm font-semibold text-error-600 hover:bg-error-50 disabled:opacity-50 dark:border-error-500/30 dark:text-error-400">
                    {busy === "reject" ? t("prSaving") : t("prRejectSystem")}
                  </button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-lg bg-gray-100 px-3 py-2 font-mono text-sm text-gray-800 dark:bg-gray-800 dark:text-gray-100">@… {request.id}</code>
                <button type="button" onClick={() => void copyCode()} className="h-9 rounded-lg px-3 text-sm font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10">{copied ? t("prCopied") : t("prCopy")}</button>
              </div>
              {/* Đang chờ duyệt: người đề nghị bổ sung chứng từ khi người duyệt yêu cầu (thông báo gửi vào Chat cá nhân của họ). */}
              {sent && (canUploadDocs || canSendMissing) && (
                <div className="space-y-3 border-t border-gray-100 pt-3 dark:border-gray-800">
                  {canUploadDocs && (
                    <>
                      <p className="text-sm font-semibold text-gray-800 dark:text-white/90">{t("prDocsDuringApproval")}</p>
                      <PaymentDocumentsPanel requestId={request.id} canUpload={canUploadDocs} canRemoveProof={canRecordPayment} canRemove={canRemoveDocs} onFilesChange={setFileCount} onUploaded={reload} onPreviewVisibilityChange={setPreviewOpen} />
                    </>
                  )}
                  {canSendMissing && <MissingDocumentsNotice requestId={request.id} creatorName={request.creatorName} disabled={busy !== ""} />}
                </div>
              )}
            </div>
          )}
          {(request.status === 1 || paidOrArchived) && (
            <div className="space-y-2">
              <p className="text-sm text-success-700 dark:text-success-300">✓ {t("prApprovedBy", { name: request.approverName || "—", time: formatDateTime(request.updatedAt, language) })}</p>
              {/* Ghi chú người duyệt nhập trên Google Chat (không bắt buộc) */}
              {request.decisionNote && (
                <p className="whitespace-pre-line break-words rounded-lg bg-success-50 px-3 py-2 text-sm text-success-800 dark:bg-success-500/10 dark:text-success-200"><span className="font-semibold">{t("prDecisionNote")}:</span> {request.decisionNote}</p>
              )}
            </div>
          )}
          {cancelled && <p className="text-sm text-gray-600 dark:text-gray-300">🚫 {t("prCancelledInfo", { time: formatDateTime(request.updatedAt, language) })}</p>}
          {request.status === -1 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-error-700 dark:text-error-300">{t("prRejectedBy", { name: request.approverName || "—", time: formatDateTime(request.updatedAt, language) })}</p>
              <p className="break-words rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-300"><span className="font-semibold">{t("prRejectReason")}:</span> {request.decisionNote}</p>
              {canEdit && <button type="button" onClick={startEdit} className={`${BUTTON_PRIMARY} w-full sm:w-auto`}>✎ {t("prEditAfterReject")}</button>}
            </div>
          )}
        </NodeCard>

        {/* 3. Chi tiền: upload ủy nhiệm chi / ảnh chuyển tiền -> đã chi tiền (thẻ Google Chat có nút mở thẳng bước này) */}
        <NodeCard index={2} title={titles[2]} state={states[2]} anchor={PAYMENT_ANCHOR}>
          <div className="space-y-3">
            {request.status === 1 && (
              <p className="flex items-center gap-2 text-sm font-medium text-warning-700 dark:text-warning-300"><span className="h-2 w-2 animate-pulse rounded-full bg-warning-500" />{t("prWaitPayment")}</p>
            )}
            {/* Đang chờ chi tiền: mã QR ngay tại bước chi tiền để kế toán quét chuyển. */}
            {request.status === 1 && request.paymentMethod === "chuyen_khoan" && (
              <PaymentTransferQr requestId={request.id} version={`${request.updatedAt}-${request.total}`}
                fallback={<TransferInfoText text={request.transferInfo} />} />
            )}
            {paidOrArchived && <p className="text-sm font-medium text-success-700 dark:text-success-300">✓ {t("prPaidDone")}</p>}
            <div className="rounded-xl border border-gray-200 p-3 sm:p-4 dark:border-gray-700">
              <p className="mb-2 text-sm font-semibold text-gray-800 dark:text-white/90">{t("prProofTitle")}</p>
              <PaymentDocumentsPanel requestId={request.id} kind={PAYMENT_PROOF} canUpload={canUploadProof && !savingSignedForm} onUploaded={() => void proofUploaded()} onPreviewVisibilityChange={setPreviewOpen} />
              {savingSignedForm && (
                <p className="mt-2 flex items-center gap-2 text-sm text-brand-700 dark:text-brand-300">
                  <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />{t("prSignedFormSaving")}
                </p>
              )}
              {canUploadProof && request.status === 1 && <p className="mt-2 text-xs text-gray-500">{t("prPaymentChatHint", { id: request.id })}</p>}
            </div>
            {/* Chờ chi tiền: vẫn bổ sung được chứng từ hồ sơ / báo người đề nghị bổ sung. */}
            {request.status === 1 && (canUploadDocs || canSendMissing) && (
              <div className="space-y-3 rounded-xl border border-gray-200 p-3 sm:p-4 dark:border-gray-700">
                {canUploadDocs && (
                  <>
                    <p className="text-sm font-semibold text-gray-800 dark:text-white/90">{t("prDocsTitle")}</p>
                    <PaymentDocumentsPanel requestId={request.id} canUpload={canUploadDocs} canRemoveProof={canRecordPayment} canRemove={canRemoveDocs} onFilesChange={setFileCount} onUploaded={reload} onPreviewVisibilityChange={setPreviewOpen} />
                  </>
                )}
                {canSendMissing && <MissingDocumentsNotice requestId={request.id} creatorName={request.creatorName} disabled={busy !== ""} />}
              </div>
            )}
          </div>
        </NodeCard>

        {/* 4. Lưu trữ hồ sơ (sau khi đã chi tiền) */}
        <NodeCard index={3} title={titles[3]} state={states[3]} last>
          <PaymentDocumentsPanel requestId={request.id} canUpload={canUploadDocs} canRemoveProof={canRecordPayment} canRemove={canRemoveDocs} onFilesChange={setFileCount} onUploaded={reload} onPreviewVisibilityChange={setPreviewOpen} />
          {canUploadDocs && !canRemoveDocs && <p className="mt-2 text-xs text-gray-500">{t("prPaidAddOnlyHint")}</p>}
          {request.status === 3 && (
            <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
              {fileCount > 0 && <p className="mb-3 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700 dark:bg-warning-500/10 dark:text-warning-300">{t("prDocsDraftHint", { count: fileCount })}</p>}
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
                {canArchive && (
                  <button type="button" onClick={() => void archive()} disabled={busy !== "" || fileCount === 0} className="h-11 w-full rounded-lg bg-success-600 px-5 text-sm font-semibold text-white hover:bg-success-700 disabled:opacity-50 sm:w-auto">
                    {busy === "archive" ? t("prSaving") : `🗄 ${t("prArchive")}`}
                  </button>
                )}
                {canSendMissing && <MissingDocumentsNotice requestId={request.id} creatorName={request.creatorName} disabled={busy !== ""} />}
              </div>
              {canArchive && fileCount === 0 && <p className="mt-2 text-xs text-gray-500">{t("prArchiveNeedsFile")}</p>}
              {!canArchive && <p className="mt-2 text-sm text-gray-500">{t("prWaitArchive")}</p>}
            </div>
          )}
          {request.status === 2 && <p className="mt-3 text-sm font-medium text-success-700 dark:text-success-300">✓ {t("prCompletedHint")}</p>}
        </NodeCard>
      </ol>
      </div>
    </>
  );
}
