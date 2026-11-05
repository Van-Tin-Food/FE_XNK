"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PaymentStatusBadge, formatDateTime } from "@/components/payment/PaymentRequestParts";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemConfirm } from "@/context/SystemConfirmContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import {
  linkBankTransaction, listBankTransactions, searchLinkableRequests, setBankTransactionIgnored, unlinkBankMatch,
  type BankMatchState, type BankTransaction, type LinkableRequest,
} from "@/services/bankTransactionApi";
import { amountForInput, amountToCents, formatMoney, parseAmountLoose, sumAmounts } from "@/utils/paymentRequest";

// Đối soát tiền chi (quyền bankTransactions: view xem, edit thao tác): giao dịch tiền ra SePay gửi về, mới nhất trước. Hệ thống
// đã tự gắn khi có đúng 1 đề nghị đã duyệt cùng số tiền (BE bankTransactionService.autoMatch); giao dịch còn lại kế toán chọn
// ứng viên, gắn tay (một giao dịch cho nhiều đề nghị, cả đề nghị đã có UNC), gỡ gắn nhầm hoặc bỏ qua kèm lý do (lương, thuế...).
// Mỗi giao dịch một thẻ (dùng chung điện thoại / desktop).

const LIMIT = 100;
const STATES: Array<{ value: BankMatchState; labelKey: string }> = [
  { value: "pending", labelKey: "btStatePending" },
  { value: "matched", labelKey: "btStateMatched" },
  { value: "ignored", labelKey: "btStateIgnored" },
  { value: "", labelKey: "btStateAll" },
];
const BUTTON = "inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-medium disabled:opacity-60";
const OUTLINE = `${BUTTON} border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5`;
const PRIMARY = `${BUTTON} bg-brand-500 text-white hover:bg-brand-600`;
const INPUT = "h-10 w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white";

/** Còn bao nhiêu tiền của giao dịch chưa gắn với đề nghị nào. */
const remainingOf = (row: BankTransaction) => {
  const left = amountToCents(row.amount) - amountToCents(sumAmounts(row.matches.map((match) => match.amount)));
  return left > BigInt(0) ? `${left / BigInt(100)}.${String(left % BigInt(100)).padStart(2, "0")}` : "0.00";
};

export default function BankTransactionsPage() {
  const { t, language } = useLanguage();
  const { can } = useAuth();
  const { notify } = useSystemNotification();
  const { confirm } = useSystemConfirm();
  const canView = can("bankTransactions");
  const canEdit = can("bankTransactions", "edit");
  const [state, setState] = useState<BankMatchState>("pending");
  const [rows, setRows] = useState<BankTransaction[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState("");
  // Thẻ đang mở khung gắn tay / bỏ qua (theo id giao dịch).
  const [linking, setLinking] = useState("");
  const [ignoring, setIgnoring] = useState("");
  const reload = () => setReloadKey((key) => key + 1);

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      listBankTransactions({ state, limit: LIMIT }, controller.signal)
        .then((result) => {
          setRows(result.rows);
          setTotal(result.total);
        })
        .catch((loadError: unknown) => {
          if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : t("btLoadError"));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [canView, state, reloadKey, t]);

  if (!canView) {
    return <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300">{t("btNoPermission")}</div>;
  }

  const money = (value: string) => formatMoney(value, "VND", language);
  const run = async (key: string, work: () => Promise<string | void>) => {
    setBusy(key);
    try {
      const message = await work();
      notify(message || t("btUpdated"), "success");
      setLinking("");
      setIgnoring("");
      reload();
    } catch (actionError) {
      notify(actionError instanceof Error ? actionError.message : String(actionError), "error");
    } finally {
      setBusy("");
    }
  };
  const link = (row: BankTransaction, allocations: Array<{ requestId: string; amount: string }>) => run(`link-${row.id}`, async () => {
    const result = await linkBankTransaction(row.id, allocations);
    if (result.warnings.length) notify(result.warnings.join("; "), "warning");
    return result.changed.length ? `${t("btLinked")}. ${t("btPaidNow", { list: result.changed.join(", ") })}` : t("btLinked");
  });
  const unlink = async (matchId: string, requestId: string) => {
    if (!await confirm({ title: t("btUnlinkTitle"), message: t("btUnlinkConfirm", { id: requestId }), confirmText: t("btUnlink"), tone: "danger" })) return;
    await run(`unlink-${matchId}`, async () => {
      const result = await unlinkBankMatch(matchId);
      return t(result.reverted ? "btReverted" : "btUnlinked", { id: result.requestId });
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-gray-900 sm:text-xl dark:text-white">{t("btTitle")}</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("btSubtitle")}</p>
          </div>
          <button type="button" onClick={reload} disabled={loading} className={`${OUTLINE} h-10 shrink-0 gap-2 px-4`}>
            <span className={loading ? "inline-block animate-spin" : "inline-block"} aria-hidden="true">↻</span>
            {t("btRefresh")}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {STATES.map((item) => (
            <button key={item.value || "all"} type="button" onClick={() => setState(item.value)} aria-pressed={state === item.value}
              className={state === item.value ? PRIMARY : OUTLINE}>
              {t(item.labelKey)}
            </button>
          ))}
          {rows && <span className="ml-auto text-sm text-gray-500 dark:text-gray-400">{t("btTotal", { count: total })}</span>}
        </div>
      </div>

      {error && <div className="rounded-xl bg-error-50 px-4 py-3 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-300">{error}</div>}
      {!rows && !error && <div className="h-32 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />}
      {rows && rows.length === 0 && (
        <p className="rounded-2xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700">{t("btEmpty")}</p>
      )}

      {rows && rows.length > 0 && (
        <div className="flex flex-col gap-3">
          {rows.map((row) => {
            const remaining = remainingOf(row);
            const open = row.type === "out" && !row.ignoredAt && amountToCents(remaining) > BigInt(0);
            const pending = open && row.matches.length === 0;
            return (
              <div key={row.id} className={`rounded-2xl border p-4 ${pending
                ? "border-warning-300 bg-warning-50/50 dark:border-warning-500/40 dark:bg-warning-500/5"
                : "border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"}`}>
                {/* Thông tin giao dịch */}
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                      {row.gateway || "—"} <span className="font-mono text-xs text-gray-500">{row.accountNumber}</span>
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatDateTime(row.transactionDate, language)}{row.reference && <> · <span className="font-mono">{row.reference}</span></>}
                    </p>
                  </div>
                  <span className={`shrink-0 text-lg font-bold tabular-nums ${row.type === "out" ? "text-error-600 dark:text-error-400" : "text-success-600 dark:text-success-400"}`}>
                    {row.type === "out" ? "−" : "+"}{money(row.amount)}
                  </span>
                </div>
                <p className="mt-2 break-words text-sm text-gray-700 dark:text-gray-200">{row.content || row.description || "—"}</p>

                {/* Đối soát */}
                <div className="mt-3 flex flex-col gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
                  {row.matches.map((match) => (
                    <div key={match.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <Link href={`/payment-requests/${encodeURIComponent(match.requestId)}`} className="font-mono font-semibold text-brand-600 hover:underline dark:text-brand-400">{match.requestId}</Link>
                      <PaymentStatusBadge status={match.status} />
                      <span className="tabular-nums text-gray-700 dark:text-gray-200">{money(match.amount)}</span>
                      <span className="text-xs text-gray-500">· {match.method === "auto" ? t("btAuto") : t("btManual", { name: match.by || "—" })}</span>
                      {canEdit && (
                        <button type="button" onClick={() => void unlink(match.id, match.requestId)} disabled={Boolean(busy)}
                          className="ml-auto text-xs font-medium text-error-600 hover:underline disabled:opacity-50 dark:text-error-400">
                          {t("btUnlink")}
                        </button>
                      )}
                    </div>
                  ))}

                  {row.ignoredAt && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600 dark:text-gray-300">
                      <span className="font-medium">{t("btIgnoredLabel", { reason: row.ignoredReason })}</span>
                      <span className="text-xs text-gray-400">{t("btIgnoredBy", { name: row.ignoredBy || "—", time: formatDateTime(row.ignoredAt, language) })}</span>
                      {canEdit && (
                        <button type="button" disabled={Boolean(busy)} onClick={() => void run(`ignore-${row.id}`, () => setBankTransactionIgnored(row.id, ""))}
                          className="ml-auto text-xs font-medium text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400">
                          {t("btUnignore")}
                        </button>
                      )}
                    </div>
                  )}

                  {open && row.matches.length > 0 && <p className="text-xs text-warning-700 dark:text-warning-300">{t("btRemaining", { amount: money(remaining) })}</p>}

                  {pending && (
                    row.candidates.length > 1 ? (
                      <div>
                        <p className="text-sm font-medium text-warning-700 dark:text-warning-300">{t("btAmbiguous", { count: row.candidates.length })}</p>
                        <ul className="mt-2 flex flex-col gap-2">
                          {row.candidates.map((candidate) => (
                            <li key={candidate.id} className="flex flex-col gap-2 rounded-lg bg-white p-3 sm:flex-row sm:items-center dark:bg-gray-900">
                              <span className="min-w-0 flex-1 text-sm">
                                <Link href={`/payment-requests/${encodeURIComponent(candidate.id)}`} className="font-mono font-semibold text-brand-600 hover:underline dark:text-brand-400">{candidate.id}</Link>
                                <span className="ml-2 text-gray-700 dark:text-gray-200">{candidate.content}</span>
                                <span className="block text-xs text-gray-500">
                                  {[candidate.beneficiary && t("btBeneficiary", { name: candidate.beneficiary }), candidate.creator, t("btApprovedAt", { time: formatDateTime(candidate.approvedAt, language) })].filter(Boolean).join(" · ")}
                                </span>
                              </span>
                              {canEdit && (
                                <button type="button" disabled={Boolean(busy)} onClick={() => void link(row, [{ requestId: candidate.id, amount: row.amount }])} className={`${PRIMARY} shrink-0`}>
                                  {t("btChoose")}
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="text-sm font-medium text-warning-700 dark:text-warning-300">{t("btUnmatched")}</p>
                    )
                  )}

                  {canEdit && open && linking !== row.id && ignoring !== row.id && (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={Boolean(busy)} onClick={() => { setLinking(row.id); setIgnoring(""); }} className={OUTLINE}>{t("btLinkOther")}</button>
                      {row.matches.length === 0 && (
                        <button type="button" disabled={Boolean(busy)} onClick={() => { setIgnoring(row.id); setLinking(""); }} className={OUTLINE}>{t("btIgnore")}</button>
                      )}
                    </div>
                  )}
                  {linking === row.id && (
                    <LinkPanel remaining={remaining} busy={busy === `link-${row.id}`} onCancel={() => setLinking("")}
                      onSave={(allocations) => void link(row, allocations)} />
                  )}
                  {ignoring === row.id && (
                    <IgnorePanel busy={busy === `ignore-${row.id}`} onCancel={() => setIgnoring("")}
                      onSave={(reason) => void run(`ignore-${row.id}`, () => setBankTransactionIgnored(row.id, reason))} />
                  )}
                </div>
                <p className="mt-2 text-[11px] text-gray-400">{t("btReceivedAt", { time: formatDateTime(row.receivedAt, language) })}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Gắn tay: tìm đề nghị đã duyệt / đã chi tiền, chọn một hoặc nhiều, nhập số tiền gắn cho từng đề nghị. */
function LinkPanel({ remaining, busy, onCancel, onSave }: {
  remaining: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (allocations: Array<{ requestId: string; amount: string }>) => void;
}) {
  const { t, language } = useLanguage();
  const { notify } = useSystemNotification();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LinkableRequest[] | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchLinkableRequests(query.trim(), controller.signal)
        .then(setResults)
        .catch(() => { if (!controller.signal.aborted) setResults([]); });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const toggle = (request: LinkableRequest) => setPicked((current) => {
    const next = { ...current };
    if (request.id in next) delete next[request.id];
    else {
      // Gợi ý số tiền = phần còn lại của đề nghị, không quá phần còn lại của giao dịch.
      const requestLeft = amountToCents(request.total) - amountToCents(request.allocated);
      const left = requestLeft < amountToCents(remaining) ? requestLeft : amountToCents(remaining);
      next[request.id] = left > BigInt(0) ? amountForInput(`${left / BigInt(100)}.${String(left % BigInt(100)).padStart(2, "0")}`) : "";
    }
    return next;
  });
  const save = () => {
    const allocations = Object.entries(picked).map(([requestId, value]) => ({ requestId, amount: parseAmountLoose(value) || "" }));
    if (!allocations.length || allocations.some((item) => !item.amount)) return notify(t("btLinkInvalid"), "error");
    onSave(allocations);
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-white/5">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("btSearchPlaceholder")} className={INPUT} />
      <ul className="mt-2 flex max-h-72 flex-col gap-1.5 overflow-y-auto">
        {results === null && <li className="h-10 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />}
        {results?.length === 0 && <li className="px-1 py-2 text-sm text-gray-500">{t("btSearchEmpty")}</li>}
        {results?.map((request) => {
          const checked = request.id in picked;
          return (
            <li key={request.id} className="flex flex-col gap-2 rounded-lg bg-white p-2.5 sm:flex-row sm:items-center dark:bg-gray-900">
              <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-sm">
                <input type="checkbox" checked={checked} onChange={() => toggle(request)} className="mt-1 h-4 w-4 shrink-0" />
                <span className="min-w-0">
                  <span className="font-mono font-semibold text-gray-800 dark:text-white/90">{request.id}</span>{" "}
                  <PaymentStatusBadge status={request.status} />
                  <span className="mt-0.5 block break-words text-gray-600 dark:text-gray-300">{request.content}</span>
                  <span className="block text-xs text-gray-500">
                    {[request.beneficiary && t("btBeneficiary", { name: request.beneficiary }), t("btAllocated", { allocated: formatMoney(request.allocated, "VND", language), total: formatMoney(request.total, "VND", language) })].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </label>
              {checked && (
                <input value={picked[request.id]} onChange={(event) => setPicked((current) => ({ ...current, [request.id]: event.target.value }))}
                  inputMode="decimal" aria-label={t("btAllocateAmount")} placeholder={t("btAllocateAmount")} className={`${INPUT} sm:w-40`} />
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className={OUTLINE}>{t("cancel")}</button>
        <button type="button" onClick={save} disabled={busy || Object.keys(picked).length === 0} className={PRIMARY}>
          {busy ? t("saving") : t("btLinkSave", { count: Object.keys(picked).length })}
        </button>
      </div>
    </div>
  );
}

/** Bỏ qua giao dịch không thuộc đề nghị: bắt buộc lý do. */
function IgnorePanel({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: (reason: string) => void }) {
  const { t } = useLanguage();
  const { notify } = useSystemNotification();
  const [reason, setReason] = useState("");
  const save = () => (reason.trim() ? onSave(reason.trim()) : notify(t("btIgnoreRequired"), "error"));
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:flex-row sm:items-center dark:border-gray-700 dark:bg-white/5">
      <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} placeholder={t("btIgnoreReason")} className={INPUT} />
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className={OUTLINE}>{t("cancel")}</button>
        <button type="button" onClick={save} disabled={busy} className={PRIMARY}>{busy ? t("saving") : t("btIgnoreSave")}</button>
      </div>
    </div>
  );
}
