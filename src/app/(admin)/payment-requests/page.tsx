"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import PaginationControls from "@/components/common/PaginationControls";
import { PaymentStatusBadge, RedFlowBadge, formatDateTime, formatDueDate, isOverdue } from "@/components/payment/PaymentRequestParts";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import {
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABEL_KEYS,
  listPaymentRequests,
  type PaymentRequest,
  type PaymentRequestStatus,
} from "@/services/paymentRequestApi";
import { formatMoney } from "@/utils/paymentRequest";

// Danh sách đề nghị thanh toán: lọc + phân trang phía server. Bấm một đề nghị -> trang quy trình /payment-requests/<mã>;
// link cũ ?id=DNTT-001 tự chuyển sang trang đó.

const DEFAULT_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;
const SELECT_CLASS = "h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 outline-none focus:border-brand-400 md:w-48 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200";

function PaymentRequestsContent() {
  const { t, language } = useLanguage();
  const { can } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canView = can("paymentRequests");
  const canCreate = can("paymentRequests", "edit");

  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [viewAll, setViewAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [status, setStatus] = useState<"" | `${PaymentRequestStatus}`>("");
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [reloadKey, setReloadKey] = useState(0);
  const legacyId = searchParams.get("id");

  const openDetail = useCallback((id: string) => router.push(`/payment-requests/${encodeURIComponent(id)}`), [router]);

  useEffect(() => {
    if (legacyId) router.replace(`/payment-requests/${encodeURIComponent(legacyId)}`);
  }, [legacyId, router]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      listPaymentRequests({
        limit: pageSize,
        offset: (page - 1) * pageSize,
        status: status === "" ? undefined : Number(status) as PaymentRequestStatus,
        q: debouncedQuery || undefined,
        mine,
      }, controller.signal)
        .then((result) => {
          setRequests(result.requests);
          setTotal(result.total);
          setViewAll(result.viewAll);
          // Trang hiện tại vượt quá số trang (vừa đổi bộ lọc): quay về trang cuối còn dữ liệu.
          const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
          if (page > lastPage) setPage(lastPage);
        })
        .catch((loadError: unknown) => {
          if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : t("prLoadError"));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [canView, debouncedQuery, mine, page, pageSize, reloadKey, status, t]);

  const reload = () => setReloadKey((key) => key + 1);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const from = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to = Math.min(total, currentPage * pageSize);

  if (!canView) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300">
        {t("prNoPermission")}
      </div>
    );
  }

  const money = (request: PaymentRequest) => formatMoney(request.total, request.currency, language);
  const dueClass = (request: PaymentRequest) => (isOverdue(request.dueDate, request.status) ? "text-error-600 dark:text-error-400" : "text-gray-700 dark:text-gray-300");

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03] sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t("paymentRequests")}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("prDescription")}</p>
        </div>
        {canCreate && (
          <Link href="/payment-requests/new"
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg bg-brand-500 px-5 text-sm font-semibold text-white hover:bg-brand-600">
            + {t("prCreate")}
          </Link>
        )}
      </header>

      <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 dark:border-gray-800 md:flex-row md:flex-wrap md:items-center">
          <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={t("prSearch")} aria-label={t("prSearch")}
            className="h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 outline-none focus:border-brand-400 md:flex-1 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200" />
          <select value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }} aria-label={t("status")} className={SELECT_CLASS}>
            <option value="">{t("prAllStatuses")}</option>
            {PAYMENT_STATUSES.map((value) => <option key={value} value={value}>{t(PAYMENT_STATUS_LABEL_KEYS[value])}</option>)}
          </select>
          {viewAll && (
            <label className="flex h-10 items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" className="h-4 w-4" checked={mine} onChange={(event) => { setMine(event.target.checked); setPage(1); }} />
              {t("prOnlyMine")}
            </label>
          )}
        </div>

        {error ? (
          <div className="p-6 text-center">
            <p className="break-words text-sm text-error-600 dark:text-error-400">{error}</p>
            <button type="button" onClick={reload} className="mt-3 h-10 rounded-lg border border-gray-200 px-4 text-sm font-medium dark:border-gray-700 dark:text-gray-200">{t("prRetry")}</button>
          </div>
        ) : loading && requests.length === 0 ? (
          <div className="flex justify-center py-16"><div className="h-9 w-9 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>
        ) : requests.length === 0 ? (
          <p className="py-16 text-center text-sm text-gray-500">{t("prEmpty")}</p>
        ) : (
          <div className={loading ? "opacity-60 transition-opacity" : ""}>
            {/* Điện thoại / tablet: thẻ */}
            <ul className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 lg:hidden">
              {requests.map((request) => (
                <li key={request.id}>
                  <button type="button" onClick={() => openDetail(request.id)}
                    className="flex h-full w-full min-w-0 flex-col gap-2 rounded-xl border border-gray-200 p-4 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/30 dark:border-gray-700 dark:hover:border-brand-500/50">
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="font-mono text-sm font-semibold text-brand-600 dark:text-brand-400">{request.id}</span>
                      <PaymentStatusBadge status={request.status} draft={!request.sent} />
                    </span>
                    <span className="line-clamp-2 break-words text-sm font-medium text-gray-800 dark:text-white/90">{request.content}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold tabular-nums text-gray-900 dark:text-white">{money(request)}</span>
                      {request.hasRed && <RedFlowBadge />}
                    </span>
                    <span className="flex w-full flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-gray-500">
                      <span className="truncate">{request.creatorName} · {t("prCostCount", { count: request.costCount })}</span>
                      <span className={dueClass(request)}>{t("prDueDate")}: {formatDueDate(request.dueDate)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {/* Màn lớn: bảng */}
            <div className="hidden overflow-x-auto custom-scrollbar lg:block">
              <table className="w-full min-w-[960px] table-fixed text-left">
                <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                  <tr>
                    <th className="w-[12%] px-4 py-3">{t("prCode")}</th>
                    <th className="w-[30%] px-4 py-3">{t("prContent")}</th>
                    <th className="w-[14%] px-4 py-3">{t("prCreator")}</th>
                    <th className="w-[15%] px-4 py-3 text-right">{t("prTotal")}</th>
                    <th className="w-[11%] px-4 py-3">{t("prDueDate")}</th>
                    <th className="w-[18%] px-4 py-3">{t("status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {requests.map((request) => (
                    <tr key={request.id} onClick={() => openDetail(request.id)} className="cursor-pointer hover:bg-brand-50/40 dark:hover:bg-brand-500/5">
                      <td className="px-4 py-3">
                        <button type="button" onClick={(event) => { event.stopPropagation(); openDetail(request.id); }} className="font-mono text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">{request.id}</button>
                        <p className="text-xs text-gray-400">{formatDateTime(request.createdAt, language)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="truncate text-sm font-medium text-gray-800 dark:text-white/90" title={request.content}>{request.content}</p>
                        <p className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">{t("prCostCount", { count: request.costCount })}{request.hasRed && <RedFlowBadge />}</p>
                      </td>
                      <td className="truncate px-4 py-3 text-sm text-gray-700 dark:text-gray-300" title={request.creatorName}>{request.creatorName || "—"}</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{money(request)}</td>
                      <td className={`px-4 py-3 text-sm ${dueClass(request)}`}>{formatDueDate(request.dueDate)}</td>
                      <td className="px-4 py-3">
                        <PaymentStatusBadge status={request.status} draft={!request.sent} />
                        {request.approverName && <p className="mt-1 truncate text-xs text-gray-500" title={request.approverName}>{request.approverName}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!error && total > 0 && (
          <PaginationControls page={currentPage} totalPages={totalPages} pageSize={pageSize} totalItems={total} from={from} to={to} summaryKey="showingRecords" idPrefix="payment-requests"
            onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(Math.min(value, 100)); setPage(1); }} />
        )}
      </section>

    </div>
  );
}

export default function PaymentRequestsPage() {
  return (
    <Suspense fallback={null}>
      <PaymentRequestsContent />
    </Suspense>
  );
}
