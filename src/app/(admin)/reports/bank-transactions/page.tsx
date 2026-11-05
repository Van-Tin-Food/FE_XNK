"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PaymentStatusBadge, formatDateTime } from "@/components/payment/PaymentRequestParts";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { listBankTransactions, type BankTransaction, type BankTransferType } from "@/services/bankTransactionApi";
import { formatMoney } from "@/utils/paymentRequest";

// Giao dịch ngân hàng (quyền bankTransactions — bản thử nghiệm đối soát): giao dịch SePay gửi về từ tài khoản ngân hàng của
// công ty, mới nhất trước, kèm đề nghị thanh toán nhận ra từ mã DNTT trong nội dung chuyển khoản. Tiền ra không có mã DNTT
// tô cảnh báo (chi ngoài đề nghị). Desktop dạng bảng, màn hẹp dạng thẻ. Chưa tự đổi trạng thái đề nghị.

const LIMIT = 100;
const TYPES: Array<{ value: "" | BankTransferType; labelKey: string }> = [
  { value: "", labelKey: "btTypeAll" },
  { value: "out", labelKey: "btTypeOut" },
  { value: "in", labelKey: "btTypeIn" },
];

export default function BankTransactionsPage() {
  const { t, language } = useLanguage();
  const { can } = useAuth();
  const canView = can("bankTransactions");
  const [type, setType] = useState<"" | BankTransferType>("");
  const [rows, setRows] = useState<BankTransaction[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      listBankTransactions({ type, limit: LIMIT }, controller.signal)
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
  }, [canView, type, reloadKey, t]);

  if (!canView) {
    return <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300">{t("btNoPermission")}</div>;
  }

  const amountText = (row: BankTransaction) => `${row.type === "out" ? "−" : "+"}${formatMoney(row.amount, "VND", language)}`;
  const amountClass = (row: BankTransaction) => (row.type === "out" ? "text-error-600 dark:text-error-400" : "text-success-600 dark:text-success-400");
  // Tiền ra không có mã đề nghị: rủi ro chi ngoài đề nghị.
  const unmatchedOut = (row: BankTransaction) => row.type === "out" && row.requests.length === 0;

  const requestsCell = (row: BankTransaction) => (row.requests.length === 0 ? (
    <span className={`text-xs font-medium ${row.type === "out" ? "text-warning-700 dark:text-warning-300" : "text-gray-400"}`}>{t("btNoCode")}</span>
  ) : (
    <span className="flex flex-col gap-1.5">
      {row.requests.map((request) => (
        <span key={request.id} className="flex flex-wrap items-center gap-1.5">
          {request.found ? (
            <>
              <Link href={`/payment-requests/${encodeURIComponent(request.id)}`} className="font-mono text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">{request.id}</Link>
              {request.status !== null && <PaymentStatusBadge status={request.status} />}
              <span className="text-xs text-gray-500 dark:text-gray-400">{formatMoney(request.total, request.currency || "VND", language)}</span>
            </>
          ) : (
            <>
              <span className="font-mono text-xs font-semibold text-gray-700 dark:text-gray-200">{request.id}</span>
              <span className="text-xs text-error-600 dark:text-error-400">{t("btNotFound")}</span>
            </>
          )}
        </span>
      ))}
    </span>
  ));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-gray-900 sm:text-xl dark:text-white">{t("btTitle")}</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("btSubtitle")}</p>
          </div>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)} disabled={loading}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5">
            <span className={loading ? "inline-block animate-spin" : "inline-block"} aria-hidden="true">↻</span>
            {t("btRefresh")}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {TYPES.map((item) => (
            <button key={item.value || "all"} type="button" onClick={() => setType(item.value)} aria-pressed={type === item.value}
              className={`h-9 rounded-lg px-3.5 text-sm font-medium ${type === item.value
                ? "bg-brand-500 text-white"
                : "border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"}`}>
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
        <>
          {/* Desktop: bảng */}
          <div className="hidden overflow-hidden rounded-2xl border border-gray-200 bg-white lg:block dark:border-gray-800 dark:bg-white/[0.03]">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-white/5 dark:text-gray-400">
                <tr>
                  <th className="w-[13%] px-4 py-3 font-semibold">{t("btTime")}</th>
                  <th className="w-[14%] px-4 py-3 font-semibold">{t("btBank")}</th>
                  <th className="w-[13%] px-4 py-3 text-right font-semibold">{t("btAmount")}</th>
                  <th className="px-4 py-3 font-semibold">{t("btContent")}</th>
                  <th className="w-[13%] px-4 py-3 font-semibold">{t("btReference")}</th>
                  <th className="w-[22%] px-4 py-3 font-semibold">{t("btMatched")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {rows.map((row) => (
                  <tr key={row.id} className={unmatchedOut(row) ? "bg-warning-50/60 dark:bg-warning-500/5" : ""}>
                    <td className="px-4 py-3 align-top text-gray-700 dark:text-gray-200">{formatDateTime(row.transactionDate, language)}</td>
                    <td className="px-4 py-3 align-top">
                      <span className="block font-medium text-gray-800 dark:text-white/90">{row.gateway || "—"}</span>
                      <span className="block truncate font-mono text-xs text-gray-500">{row.accountNumber}</span>
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      <span className={`block font-semibold tabular-nums ${amountClass(row)}`}>{amountText(row)}</span>
                      {row.balance && <span className="block text-[11px] text-gray-400">{t("btBalance", { amount: formatMoney(row.balance, "VND", language) })}</span>}
                    </td>
                    <td className="break-words px-4 py-3 align-top text-gray-700 dark:text-gray-200">
                      {row.content || row.description || "—"}
                      <span className="mt-1 block text-[11px] text-gray-400">{t("btReceivedAt", { time: formatDateTime(row.receivedAt, language) })}</span>
                    </td>
                    <td className="break-all px-4 py-3 align-top font-mono text-xs text-gray-600 dark:text-gray-300">{row.reference || "—"}</td>
                    <td className="px-4 py-3 align-top">{requestsCell(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Màn hẹp: thẻ */}
          <div className="flex flex-col gap-3 lg:hidden">
            {rows.map((row) => (
              <div key={row.id} className={`rounded-2xl border p-4 ${unmatchedOut(row)
                ? "border-warning-300 bg-warning-50/60 dark:border-warning-500/40 dark:bg-warning-500/5"
                : "border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-white/90">{row.gateway || "—"} <span className="font-mono text-xs text-gray-500">{row.accountNumber}</span></p>
                    <p className="text-xs text-gray-500">{formatDateTime(row.transactionDate, language)}</p>
                  </div>
                  <span className={`shrink-0 text-base font-bold tabular-nums ${amountClass(row)}`}>{amountText(row)}</span>
                </div>
                <p className="mt-2 break-words text-sm text-gray-700 dark:text-gray-200">{row.content || row.description || "—"}</p>
                {row.reference && <p className="mt-1 break-all font-mono text-xs text-gray-500">{t("btReference")}: {row.reference}</p>}
                <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-800">
                  <p className="mb-1 text-xs font-medium text-gray-500">{t("btMatched")}</p>
                  {requestsCell(row)}
                </div>
                <p className="mt-2 text-[11px] text-gray-400">{t("btReceivedAt", { time: formatDateTime(row.receivedAt, language) })}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
