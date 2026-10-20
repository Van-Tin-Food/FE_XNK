"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PaginationControls from "@/components/common/PaginationControls";
import { PaymentStatusBadge, formatDateTime } from "@/components/payment/PaymentRequestParts";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemConfirm } from "@/context/SystemConfirmContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import { deleteMyCost, listMyCosts, updateMyCost, type MyCost, type MyCostScope } from "@/services/paymentCostApi";
import { formatAmount, parseAmountLoose } from "@/utils/paymentRequest";

// Chi phí của tôi: mọi khoản chi phí do người đang đăng nhập nhập (tab Chi phí của đơn hàng + chi phí vận hành của đề
// nghị). Khoản chưa thuộc đề nghị nào thì sửa số tiền / xóa được; đã vào đề nghị thì chỉ xem kèm link đề nghị.

const DEFAULT_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;
const SCOPES: MyCostScope[] = ["all", "free", "used"];
const INPUT = "h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white";
const ACTION = "h-9 rounded-lg px-3 text-sm font-medium disabled:opacity-50";

export default function MyCostsPage() {
  const { t, language } = useLanguage();
  const { can } = useAuth();
  const { notify } = useSystemNotification();
  const { confirm } = useSystemConfirm();
  const canView = can("paymentRequests");

  const [costs, setCosts] = useState<MyCost[]>([]);
  const [total, setTotal] = useState(0);
  const [totalAmount, setTotalAmount] = useState("0");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scope, setScope] = useState<MyCostScope>("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [reloadKey, setReloadKey] = useState(0);
  // Khoản đang sửa số tiền (id -> giá trị đang gõ).
  const [editing, setEditing] = useState<{ id: string; amount: string; note: string } | null>(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!canView) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      listMyCosts({ scope, q: debouncedQuery || undefined, limit: pageSize, offset: (page - 1) * pageSize })
        .then((result) => {
          if (!active) return;
          setCosts(result.costs);
          setTotal(result.total);
          setTotalAmount(result.totalAmount);
          const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
          if (page > lastPage) setPage(lastPage);
        })
        .catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : t("mcLoadError")); })
        .finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [canView, debouncedQuery, page, pageSize, reloadKey, scope, t]);

  if (!canView) {
    return <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300">{t("prNoPermission")}</div>;
  }

  const reload = () => setReloadKey((key) => key + 1);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const from = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to = Math.min(total, currentPage * pageSize);

  const kindLabel = (cost: MyCost) => (cost.container ? t("mcKindContainer") : cost.contract ? t("mcKindContract") : t("mcKindOperating"));
  const targetLabel = (cost: MyCost) => [cost.contract && `${t("prContract")} ${cost.contract}`, cost.container && `${t("prContainer")} ${cost.container}`].filter(Boolean).join(" · ");

  const saveAmount = async (cost: MyCost) => {
    if (!editing || busy) return;
    const amount = parseAmountLoose(editing.amount);
    if (amount === null) return notify(t("pcAmountRequired"), "error");
    setBusy(cost.id);
    try {
      await updateMyCost(cost.id, amount, editing.note.trim());
      notify(t("mcSaved"), "success");
      setEditing(null);
      reload();
    } catch (saveError) {
      notify(saveError instanceof Error ? saveError.message : String(saveError), "error");
    } finally {
      setBusy("");
    }
  };

  const remove = async (cost: MyCost) => {
    if (busy) return;
    const name = `${cost.categoryName}${targetLabel(cost) ? ` (${targetLabel(cost)})` : ""}`;
    if (!await confirm({ title: t("mcDelete"), message: t("mcDeleteMessage", { name, amount: formatAmount(cost.amount, language) }), confirmText: t("mcDelete"), tone: "danger" })) return;
    setBusy(cost.id);
    try {
      await deleteMyCost(cost.id);
      notify(t("mcDeleted"), "success");
      reload();
    } catch (deleteError) {
      notify(deleteError instanceof Error ? deleteError.message : String(deleteError), "error");
    } finally {
      setBusy("");
    }
  };

  /** Số tiền (hoặc ô sửa) + nút thao tác của một khoản; dùng chung cho thẻ (điện thoại) và bảng (màn lớn). */
  const amountCell = (cost: MyCost) => (editing?.id === cost.id ? (
    <input inputMode="decimal" autoFocus value={editing.amount} aria-label={t("prCostAmount")}
      onChange={(event) => setEditing({ ...editing, amount: event.target.value })}
      onKeyDown={(event) => { if (event.key === "Enter") void saveAmount(cost); if (event.key === "Escape") setEditing(null); }}
      className={`${INPUT} text-right tabular-nums`} />
  ) : (
    <span className="font-semibold tabular-nums text-gray-900 dark:text-white">
      {formatAmount(cost.amount, language)}
      {cost.vat && <span className="block text-[11px] font-normal text-gray-500">{t("prVatIncludedRate", { rate: String(Number(cost.vat)) })}</span>}
    </span>
  ));

  /** Nội dung (diễn giải) của khoản: đang sửa thì là ô nhập. */
  const noteCell = (cost: MyCost) => (editing?.id === cost.id ? (
    <input value={editing.note} maxLength={500} placeholder={t("pcNotePlaceholder")} aria-label={t("prCostNote")}
      onChange={(event) => setEditing({ ...editing, note: event.target.value })}
      onKeyDown={(event) => { if (event.key === "Enter") void saveAmount(cost); if (event.key === "Escape") setEditing(null); }}
      className={`${INPUT} mt-1`} />
  ) : cost.note ? <p className="break-words text-xs text-gray-600 dark:text-gray-300">{cost.note}</p> : null);

  const actions = (cost: MyCost) => {
    if (cost.requestId) {
      return (
        <span className="flex flex-wrap items-center gap-2">
          <Link href={`/payment-requests/${encodeURIComponent(cost.requestId)}`} className="font-mono text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">{cost.requestId}</Link>
          {cost.requestStatus !== null && <PaymentStatusBadge status={cost.requestStatus} draft={!cost.requestSent} />}
        </span>
      );
    }
    if (editing?.id === cost.id) {
      return (
        <span className="flex gap-2">
          <button type="button" onClick={() => void saveAmount(cost)} disabled={Boolean(busy)} className={`${ACTION} bg-brand-500 text-white hover:bg-brand-600`}>{busy === cost.id ? t("prSaving") : t("mcSave")}</button>
          <button type="button" onClick={() => setEditing(null)} disabled={Boolean(busy)} className={`${ACTION} border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200`}>{t("cancel")}</button>
        </span>
      );
    }
    return (
      <span className="flex gap-2">
        <button type="button" onClick={() => setEditing({ id: cost.id, amount: formatAmount(cost.amount, "vi"), note: cost.note })} disabled={Boolean(busy)}
          className={`${ACTION} border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800`}>✎ {t("mcEdit")}</button>
        <button type="button" onClick={() => void remove(cost)} disabled={Boolean(busy)}
          className={`${ACTION} border border-error-200 text-error-600 hover:bg-error-50 dark:border-error-500/30 dark:text-error-400 dark:hover:bg-error-500/10`}>{busy === cost.id ? t("prSaving") : t("mcDelete")}</button>
      </span>
    );
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03] sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t("myCosts")}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("mcDescription")}</p>
        </div>
        <div className="shrink-0 rounded-xl bg-gray-50 px-4 py-2 text-right dark:bg-gray-800/60">
          <p className="text-xs text-gray-500">{t("mcSummary", { count: total })}</p>
          <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{formatAmount(totalAmount, language)}</p>
        </div>
      </header>

      <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 dark:border-gray-800 md:flex-row md:items-center">
          <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={t("mcSearch")} aria-label={t("mcSearch")}
            className="h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-700 outline-none focus:border-brand-400 md:flex-1 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200" />
          <div role="tablist" aria-label={t("mcScope")} className="grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1 md:w-auto dark:bg-gray-800">
            {SCOPES.map((value) => (
              <button key={value} type="button" role="tab" aria-selected={scope === value} onClick={() => { setScope(value); setPage(1); setEditing(null); }}
                className={`min-h-9 rounded-lg px-3 text-sm font-medium ${scope === value ? "bg-white text-brand-700 shadow-theme-xs dark:bg-gray-900 dark:text-brand-300" : "text-gray-600 dark:text-gray-300"}`}>
                {t(`mcScope_${value}`)}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <div className="p-6 text-center">
            <p className="break-words text-sm text-error-600 dark:text-error-400">{error}</p>
            <button type="button" onClick={reload} className="mt-3 h-10 rounded-lg border border-gray-200 px-4 text-sm font-medium dark:border-gray-700 dark:text-gray-200">{t("prRetry")}</button>
          </div>
        ) : loading && costs.length === 0 ? (
          <div className="flex justify-center py-16"><div className="h-9 w-9 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>
        ) : costs.length === 0 ? (
          <p className="py-16 text-center text-sm text-gray-500">{t("mcEmpty")}</p>
        ) : (
          <div className={loading ? "opacity-60 transition-opacity" : ""}>
            {/* Điện thoại / tablet: thẻ */}
            <ul className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 lg:hidden">
              {costs.map((cost) => (
                <li key={cost.id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-gray-800 dark:text-white/90">{cost.categoryName}</p>
                      {noteCell(cost)}
                      <p className="truncate text-xs text-gray-500">{kindLabel(cost)}{targetLabel(cost) ? ` · ${targetLabel(cost)}` : ""}</p>
                    </div>
                    {editing?.id !== cost.id && <span className="shrink-0 text-base">{amountCell(cost)}</span>}
                  </div>
                  {editing?.id === cost.id && amountCell(cost)}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-gray-400">{formatDateTime(cost.createdAt, language)}</span>
                    {actions(cost)}
                  </div>
                </li>
              ))}
            </ul>

            {/* Màn lớn: bảng */}
            <div className="hidden overflow-x-auto custom-scrollbar lg:block">
              <table className="w-full min-w-[960px] table-fixed text-left">
                <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                  <tr>
                    <th className="w-[26%] px-4 py-3">{t("mcFee")}</th>
                    <th className="w-[24%] px-4 py-3">{t("mcTarget")}</th>
                    <th className="w-[16%] px-4 py-3 text-right">{t("prCostAmount")}</th>
                    <th className="w-[12%] px-4 py-3">{t("mcCreatedAt")}</th>
                    <th className="w-[22%] px-4 py-3">{t("mcRequest")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {costs.map((cost) => (
                    <tr key={cost.id} className="align-middle">
                      <td className="px-4 py-3">
                        <p className="truncate text-sm font-medium text-gray-800 dark:text-white/90" title={cost.categoryName}>{cost.categoryName}</p>
                        {noteCell(cost)}
                        <p className="text-xs text-gray-400">{cost.code}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-gray-700 dark:text-gray-300">{kindLabel(cost)}</p>
                        {targetLabel(cost) && <p className="truncate font-mono text-xs text-gray-500" title={targetLabel(cost)}>{targetLabel(cost)}</p>}
                      </td>
                      <td className="px-4 py-3 text-right text-sm">{amountCell(cost)}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(cost.createdAt, language)}</td>
                      <td className="px-4 py-3">{actions(cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!error && total > 0 && (
          <PaginationControls page={currentPage} totalPages={totalPages} pageSize={pageSize} totalItems={total} from={from} to={to} summaryKey="showingRecords" idPrefix="my-costs"
            onPageChange={setPage} onPageSizeChange={(value) => { setPageSize(Math.min(value, 100)); setPage(1); }} />
        )}
      </section>
    </div>
  );
}
