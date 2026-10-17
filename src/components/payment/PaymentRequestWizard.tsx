"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import {
  createPaymentRequest,
  getPaymentRequestOptions,
  updatePaymentRequest,
  type PaymentCost,
  type PaymentRequest,
  type PaymentRequestOptions,
} from "@/services/paymentRequestApi";
import { formatAmount, formatMoney, parseAmountLoose, sumAmounts, type PaymentCurrency } from "@/utils/paymentRequest";
import { PaymentFlowBadge, formatDueDate } from "./PaymentRequestParts";

// Bước 1 "Tạo đề nghị" dạng hỏi lần lượt: trả lời xong câu nào thì câu tiếp theo mới hiện ra, câu đã trả lời thu lại
// thành một dòng tóm tắt (bấm "Đổi" để sửa). Thứ tự: nội dung → chi phí → hạn thanh toán → loại tiền (bước cuối).
// Chi phí: tick các khoản đã nhập sẵn ở tab Chi phí của đơn hàng (nhiều đơn, nhiều cont, nhiều loại phí), hoặc thêm khoản
// chưa nhập sẵn (lưu vào payment_cost; khoản mã HD như thanh toán quốc tế phải chọn hợp đồng, số tiền điền sẵn bằng tổng
// tiền hàng). Một đề nghị gồm được nhiều hợp đồng: mục "Thanh toán theo hợp đồng" tick hợp đồng là thêm dòng (mỗi hợp đồng
// một dòng, số tiền nhập ngay cạnh). Lưu = lưu nháp; gửi Google Chat ở bước 2.

interface OtherRow {
  key: string;
  /** Có id = khoản không gắn đơn đã thuộc đề nghị này (đang sửa). */
  id?: string;
  categoryId: string;
  amount: string;
  /** Hợp đồng — bắt buộc với khoản mã HD (thanh toán theo hợp đồng). */
  contract: string;
}

interface Props {
  /** Có giá trị = sửa đề nghị này (mọi câu đã trả lời sẵn). */
  editing?: PaymentRequest | null;
  onSaved: (request: PaymentRequest) => void;
  onCancel?: () => void;
}

const STEP_COUNT = 4;
const SAVE_STEP = STEP_COUNT;
const TYPE_ORDER = ["mua_hang", "ban_hang", "van_hanh", "phat_sinh"];
const INPUT = "h-11 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-brand-400 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-white";
const PRIMARY = "h-11 rounded-lg bg-brand-500 px-5 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY = "h-11 rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800";

let seed = 0;
const newKey = () => `other-${Date.now()}-${seed += 1}`;
/** Chi phí container nhập sẵn ở tab Chi phí của đơn. */
const isPrepared = (cost: PaymentCost) => Boolean(cost.container);
const CONTRACT_CODE = "HD";
const MAX_COSTS = 100;
/** Số hợp đồng hiện trong danh sách tick (gõ tìm để thấy hợp đồng khác). */
const HD_LIST_LIMIT = 100;
const INTERNATIONAL_PAYMENT = "thanh toán quốc tế";
const isInternationalPayment = (category?: { code: string; name: string }) => Boolean(category)
  && category?.code.toUpperCase() === CONTRACT_CODE && category?.name.trim().toLowerCase() === INTERNATIONAL_PAYMENT;

/** Ngày (YYYY-MM-DD) theo giờ Việt Nam, cộng thêm số ngày. */
function vnDate(addDays = 0): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  const [year, month, day] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + addDays)).toISOString().slice(0, 10);
}

function vnMonthEnd(): string {
  const [year, month] = vnDate().split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function StepCard({ index, title, state, summary, onChange, children }: {
  index: number;
  title: string;
  state: "active" | "done";
  summary?: React.ReactNode;
  onChange?: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useLanguage();
  const active = state === "active";
  return (
    <section className={`rounded-2xl border bg-white p-4 transition-colors dark:bg-white/[0.03] sm:p-5 ${active ? "border-brand-300 shadow-theme-xs dark:border-brand-500/40" : "border-gray-200 dark:border-gray-800"}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${active ? "bg-brand-500 text-white" : "bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-400"}`} aria-hidden="true">
          {active ? index + 1 : "✓"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h2 className={`pt-1 font-semibold ${active ? "text-base text-gray-900 dark:text-white" : "text-sm text-gray-500 dark:text-gray-400"}`}>{title}</h2>
            {!active && onChange && (
              <button type="button" onClick={onChange} className="h-8 shrink-0 rounded-lg px-3 text-sm font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10">{t("prChange")}</button>
            )}
          </div>
          {!active && summary && <div className="mt-1 break-words text-sm font-medium text-gray-800 dark:text-white/90">{summary}</div>}
          {active && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </section>
  );
}

export default function PaymentRequestWizard({ editing, onSaved, onCancel }: Props) {
  const { t, language } = useLanguage();
  const { notify } = useSystemNotification();
  const [options, setOptions] = useState<PaymentRequestOptions | null>(null);
  const [optionsError, setOptionsError] = useState("");
  const [optionsKey, setOptionsKey] = useState(0);
  const [content, setContent] = useState(editing?.content || "");
  // Khoản nhập sẵn (gắn hợp đồng / cont) đang thuộc đề nghị khi sửa: giữ để hiện cùng danh sách chọn.
  const [ownPrepared] = useState<PaymentCost[]>(() => (editing ? editing.costs.filter(isPrepared) : []));
  const [selected, setSelected] = useState<string[]>(() => ownPrepared.map((cost) => cost.id));
  const [others, setOthers] = useState<OtherRow[]>(() => (editing ? editing.costs.filter((cost) => !isPrepared(cost)).map((cost) => ({
    key: newKey(), id: cost.id, categoryId: cost.categoryId, amount: formatAmount(cost.amount, "vi"), contract: cost.contract,
  })) : []));
  const [dueDate, setDueDate] = useState(editing?.dueDate || "");
  const [currency, setCurrency] = useState<PaymentCurrency | "">(editing?.currency || "");
  const [active, setActive] = useState(editing ? SAVE_STEP : 0);
  const [reached, setReached] = useState(editing ? SAVE_STEP : 0);
  const [search, setSearch] = useState("");
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [othersTouched, setOthersTouched] = useState(false);
  // Thanh toán theo hợp đồng: khoản HD đang xem + ô tìm hợp đồng.
  const [hdCategory, setHdCategory] = useState("");
  const [hdSearch, setHdSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    getPaymentRequestOptions(controller.signal)
      .then((data) => { setOptions(data); setOptionsError(""); })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setOptionsError(loadError instanceof Error ? loadError.message : t("prLoadError"));
      });
    return () => controller.abort();
  }, [optionsKey, t]);

  const categoriesById = useMemo(() => new Map((options?.categories || []).map((category) => [category.id, category])), [options]);
  const groupedCategories = useMemo(() => TYPE_ORDER
    .map((type) => ({ type, items: (options?.categories || []).filter((category) => category.type === type) }))
    .concat([{ type: "", items: (options?.categories || []).filter((category) => !TYPE_ORDER.includes(category.type)) }])
    .filter((group) => group.items.length > 0), [options]);
  const suppliers = useMemo(() => new Map((options?.contracts || []).map((item) => [item.code, item.supplier])), [options]);
  const contractsByCode = useMemo(() => new Map((options?.contracts || []).map((item) => [item.code, item])), [options]);
  // Khoản nhập sẵn có thể chọn: chưa thuộc đề nghị nào (+ của chính đề nghị đang sửa), nhóm theo hợp đồng.
  const prepared = useMemo(() => {
    const pool = [...ownPrepared, ...(options?.availableCosts || []).filter((cost) => !ownPrepared.some((own) => own.id === cost.id))];
    return pool.filter(isPrepared);
  }, [options, ownPrepared]);
  const preparedById = useMemo(() => new Map(prepared.map((cost) => [cost.id, cost])), [prepared]);
  const orderGroups = useMemo(() => {
    const groups = new Map<string, PaymentCost[]>();
    for (const cost of prepared) groups.set(cost.contract, [...(groups.get(cost.contract) || []), cost]);
    const term = search.trim().toLowerCase();
    return [...groups.entries()]
      .map(([contract, costs]) => ({ contract, supplier: suppliers.get(contract) || "", costs }))
      .filter((group) => !term || [group.contract, group.supplier, ...group.costs.map((cost) => cost.container)].some((value) => value.toLowerCase().includes(term)))
      .sort((a, b) => b.contract.localeCompare(a.contract));
  }, [prepared, search, suppliers]);

  const selectedCosts = selected.map((id) => preparedById.get(id)).filter((cost): cost is PaymentCost => Boolean(cost));
  const otherAmounts = others.map((row) => parseAmountLoose(row.amount));
  const needsContract = (row: OtherRow) => categoriesById.get(row.categoryId)?.code.toUpperCase() === CONTRACT_CODE;
  // Mỗi khoản phí HD của một hợp đồng chỉ nằm trong một đề nghị (như phí container): đề nghị khác đã có thì khoá.
  const usedBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of options?.usedContractCosts || []) {
      if (item.requestId !== editing?.id) map.set(`${item.contract}|${item.categoryId}`, item.requestId);
    }
    return map;
  }, [options, editing?.id]);
  const contractConflict = (row: OtherRow) => {
    if (!needsContract(row) || !row.contract) return "";
    const key = `${row.contract}|${row.categoryId}`;
    if (usedBy.has(key)) return t("prContractCostUsed", { id: usedBy.get(key) || "" });
    return others.some((item) => item.key !== row.key && needsContract(item) && `${item.contract}|${item.categoryId}` === key) ? t("prContractCostDuplicate") : "";
  };
  // Thanh toán theo hợp đồng (khoản mã HD): tick hợp đồng = thêm một dòng, bỏ tick = xoá. Hợp đồng hiện ra: chưa có khoản
  // này ở đề nghị khác; thanh toán quốc tế thì thêm điều kiện chưa qua vận chuyển biển (đơn đã giao coi như đã thanh toán).
  // Hợp đồng đang tick luôn hiện (kể cả khi sửa đề nghị cũ).
  const hdCategories = useMemo(() => (options?.categories || []).filter((category) => category.code.toUpperCase() === CONTRACT_CODE), [options]);
  const activeHd = categoriesById.get(hdCategory) || hdCategories.find(isInternationalPayment) || hdCategories[0];
  const hdRows = useMemo(() => new Map(others.filter((row) => activeHd && row.categoryId === activeHd.id && row.contract).map((row) => [row.contract, row])), [activeHd, others]);
  const hdList = useMemo(() => {
    if (!activeHd) return { items: [], more: 0 };
    const intl = isInternationalPayment(activeHd);
    const term = hdSearch.trim().toLowerCase();
    const all = (options?.contracts || [])
      .filter((item) => hdRows.has(item.code) || (!usedBy.has(`${item.code}|${activeHd.id}`) && !(intl && item.seaPassed)))
      .filter((item) => !term || item.code.toLowerCase().includes(term) || item.supplier.toLowerCase().includes(term));
    const items = all.filter((item, index) => index < HD_LIST_LIMIT || hdRows.has(item.code));
    return { items, more: all.length - items.length };
  }, [activeHd, hdRows, hdSearch, options, usedBy]);
  const hdCount = (categoryId: string) => others.filter((row) => row.categoryId === categoryId && row.contract).length;
  // Khoản nhập tay không gắn hợp đồng: loại phí chọn trong danh sách không có mã HD.
  const manualGroups = groupedCategories
    .map((group) => ({ ...group, items: group.items.filter((item) => item.code.toUpperCase() !== CONTRACT_CODE) }))
    .filter((group) => group.items.length > 0);
  const otherValid = others.every((row, index) => row.categoryId && otherAmounts[index] !== null && (!needsContract(row) || Boolean(row.contract)) && !contractConflict(row));
  const total = sumAmounts([...selectedCosts.map((cost) => cost.amount), ...otherAmounts]);
  const costCount = selectedCosts.length + others.length;
  const money = (value: string | null | undefined) => (currency ? formatMoney(value, currency, language) : formatAmount(value, language));
  const complete = [Boolean(content.trim()), costCount > 0 && otherValid, /^\d{4}-\d{2}-\d{2}$/.test(dueDate), Boolean(currency)];

  /** Xong một câu: mở câu đầu tiên còn thiếu, đủ hết thì sang bước lưu. justDone: câu vừa trả lời (state chưa kịp cập nhật). */
  const advance = (justDone?: number) => {
    const next = complete.findIndex((done, index) => index !== justDone && !done);
    const target = next === -1 ? SAVE_STEP : next;
    setActive(target);
    setReached((current) => Math.max(current, target));
  };

  const contractAmount = (code: string) => {
    const total = contractsByCode.get(code)?.total;
    return isInternationalPayment(activeHd) && total && Number(total) > 0 ? formatAmount(total, "vi") : "";
  };
  const toggleContracts = (codes: string[], on: boolean) => {
    if (!activeHd) return;
    if (!on) {
      setOthers((current) => current.filter((row) => !(row.categoryId === activeHd.id && codes.includes(row.contract))));
      return;
    }
    const fresh = codes.filter((code) => !hdRows.has(code));
    const room = Math.max(0, MAX_COSTS - costCount);
    if (fresh.length > room) notify(t("prTooManyCosts"), "error");
    const rows = fresh.slice(0, room).map((code) => ({ key: newKey(), categoryId: activeHd.id, contract: code, amount: contractAmount(code) }));
    if (rows.length) setOthers((current) => [...current, ...rows]);
  };
  const setRowAmount = (key: string, amount: string) => setOthers((current) => current.map((item) => (item.key === key ? { ...item, amount } : item)));

  const toggle = (ids: string[], on: boolean) => setSelected((current) => (on ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.includes(id))));
  const costLabel = (cost: PaymentCost) => categoriesById.get(cost.categoryId)?.name || cost.categoryName || cost.code;

  const save = async () => {
    if (saving || complete.some((done) => !done) || !currency) return;
    setSaving(true);
    setError("");
    try {
      const input = {
        content: content.trim(),
        currency,
        dueDate,
        costs: [
          ...selectedCosts.map((cost) => ({ id: cost.id, categoryId: cost.categoryId, amount: cost.amount, container: cost.container, contract: cost.contract })),
          ...others.map((row, index) => ({ id: row.id, categoryId: row.categoryId, amount: otherAmounts[index] as string, contract: needsContract(row) ? row.contract : "" })),
        ],
      };
      const saved = editing ? await updatePaymentRequest(editing.id, input) : await createPaymentRequest(input);
      notify(t(editing ? "prChangesSaved" : "prDraftSaved", { id: saved.id }), "success");
      onSaved(saved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const stepState = (index: number) => (active === index ? "active" : "done");
  const titles = [t("prStepContent"), t("prStepCosts"), t("prStepDueDate"), t("prStepCurrency")];

  return (
    <div className="space-y-3">
      {optionsError && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-error-50 px-4 py-3 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-300">
          <span className="min-w-0 break-words">{optionsError}</span>
          <button type="button" onClick={() => setOptionsKey((key) => key + 1)} className="font-semibold underline">{t("prRetry")}</button>
        </div>
      )}

      {/* 1. Nội dung */}
      <StepCard index={0} title={titles[0]} state={stepState(0)} summary={content} onChange={() => setActive(0)}>
        <textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={2000} rows={3} autoFocus placeholder={t("prContentPlaceholder")}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
        <div className="mt-3 flex justify-end">
          <button type="button" className={`${PRIMARY} w-full sm:w-auto`} disabled={!content.trim()} onClick={() => advance()}>{t("prContinue")}</button>
        </div>
      </StepCard>

      {/* 2. Chi phí */}
      {reached >= 1 && (
        <StepCard index={1} title={titles[1]} state={stepState(1)} onChange={() => setActive(1)}
          summary={t("prCostsSummary", { count: costCount, total: money(total) })}>
          {options && options.categories.length === 0 && (
            <p className="mb-3 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700 dark:bg-warning-500/10 dark:text-warning-300">{t("prNoCategories")}</p>
          )}

          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t("prPickByOrder")}</h3>
          {!options && !optionsError && <div className="mt-2 h-16 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />}
          {options && prepared.length === 0 && <p className="mt-2 rounded-lg border border-dashed border-gray-200 px-3 py-3 text-sm text-gray-500 dark:border-gray-700">{t("prNoPrepared")}</p>}
          {options && prepared.length > 0 && (
            <>
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("prSearchOrder")} aria-label={t("prSearchOrder")} className={`mt-2 ${INPUT}`} />
              <ul className="mt-2 max-h-[28rem] space-y-2 overflow-y-auto custom-scrollbar">
                {orderGroups.map((group) => {
                  const ids = group.costs.map((cost) => cost.id);
                  const chosen = ids.filter((id) => selected.includes(id));
                  const open = openGroups.includes(group.contract) || chosen.length > 0 || Boolean(search.trim());
                  const byContainer = new Map<string, PaymentCost[]>();
                  for (const cost of group.costs) byContainer.set(cost.container, [...(byContainer.get(cost.container) || []), cost]);
                  return (
                    <li key={group.contract || "none"} className={`rounded-xl border ${chosen.length ? "border-brand-300 dark:border-brand-500/40" : "border-gray-200 dark:border-gray-700"}`}>
                      <div className="flex items-center gap-3 px-3 py-2.5">
                        <input type="checkbox" className="h-4 w-4 shrink-0" aria-label={`${t("prSelectAll")} ${group.contract}`}
                          checked={chosen.length === ids.length} ref={(input) => { if (input) input.indeterminate = chosen.length > 0 && chosen.length < ids.length; }}
                          onChange={(event) => toggle(ids, event.target.checked)} />
                        <button type="button" onClick={() => setOpenGroups((current) => (current.includes(group.contract) ? current.filter((item) => item !== group.contract) : [...current, group.contract]))}
                          className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left" aria-expanded={open}>
                          <span className="min-w-0">
                            <span className="block truncate font-mono text-sm font-semibold text-gray-800 dark:text-white">{group.contract || t("prOrdersOther")}</span>
                            {group.supplier && <span className="block truncate text-xs text-gray-500">{group.supplier}</span>}
                          </span>
                          <span className="shrink-0 text-right text-xs text-gray-500">
                            {t("prOrderCosts", { count: ids.length, total: money(sumAmounts(group.costs.map((cost) => cost.amount))) })}
                            <span className="ml-1">{open ? "▴" : "▾"}</span>
                          </span>
                        </button>
                      </div>
                      {open && (
                        <div className="space-y-2 border-t border-gray-100 px-3 py-2 dark:border-gray-800">
                          {[...byContainer.entries()].map(([container, costs]) => (
                            <div key={container || "contract"}>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{container ? `${t("prContainer")} ${container}` : t("prContractLevel")}</p>
                              <ul className="mt-1 space-y-0.5">
                                {costs.map((cost) => (
                                  <li key={cost.id}>
                                    <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-1 py-1 hover:bg-gray-50 dark:hover:bg-gray-800">
                                      <input type="checkbox" className="h-4 w-4 shrink-0" checked={selected.includes(cost.id)} onChange={(event) => toggle([cost.id], event.target.checked)} />
                                      <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-200" title={costLabel(cost)}>
                                        {costLabel(cost)} <span className="text-xs text-gray-400">{cost.code}</span>
                                      </span>
                                      <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{money(cost.amount)}</span>
                                    </label>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {/* Thanh toán theo hợp đồng (mã HD): tick hợp đồng là thêm dòng, số tiền nhập ngay cạnh */}
          {hdCategories.length > 0 && activeHd && (
            <>
              <h3 className="mt-5 text-sm font-semibold text-gray-700 dark:text-gray-200">{t("prByContract")}</h3>
              <p className="text-xs text-gray-500">{isInternationalPayment(activeHd) ? t("prIntlContractHint") : t("prByContractHint")}</p>
              {hdCategories.length > 1 && (
                <div className="mt-2 flex flex-wrap gap-2" role="tablist" aria-label={t("prByContract")}>
                  {hdCategories.map((item) => {
                    const count = hdCount(item.id);
                    const on = item.id === activeHd.id;
                    return (
                      <button key={item.id} type="button" role="tab" aria-selected={on} onClick={() => { setHdCategory(item.id); setHdSearch(""); }}
                        className={`h-9 max-w-full rounded-full border px-3 text-sm font-medium ${on ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300" : "border-gray-200 text-gray-700 hover:border-brand-300 dark:border-gray-700 dark:text-gray-200"}`}>
                        <span className="truncate">{item.name}</span>{count > 0 && <span className="ml-1.5 rounded-full bg-brand-500 px-1.5 text-xs text-white">{count}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
              <input type="search" value={hdSearch} onChange={(event) => setHdSearch(event.target.value)} placeholder={t("prSearchContract")} aria-label={t("prSearchContract")} className={`mt-2 ${INPUT}`} />
              {!options && !optionsError && <div className="mt-2 h-16 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />}
              {options && hdList.items.length === 0 && (
                <p className="mt-2 rounded-lg border border-dashed border-gray-200 px-3 py-3 text-sm text-gray-500 dark:border-gray-700">{t("prNoContractsLeft")}</p>
              )}
              {hdList.items.length > 0 && (
                <div className="mt-2 rounded-xl border border-gray-200 dark:border-gray-700">
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-gray-100 px-3 text-sm font-medium text-gray-700 dark:border-gray-800 dark:text-gray-200">
                    <input type="checkbox" className="h-4 w-4 shrink-0"
                      checked={hdList.items.every((item) => hdRows.has(item.code))}
                      ref={(input) => { if (input) input.indeterminate = hdList.items.some((item) => hdRows.has(item.code)) && !hdList.items.every((item) => hdRows.has(item.code)); }}
                      onChange={(event) => toggleContracts(hdList.items.map((item) => item.code), event.target.checked)} />
                    <span className="min-w-0 flex-1">{t("prSelectAll")} ({hdList.items.length})</span>
                    {hdCount(activeHd.id) > 0 && <span className="shrink-0 text-xs text-brand-600 dark:text-brand-400">{t("prContractsPicked", { count: hdCount(activeHd.id) })}</span>}
                  </label>
                  <ul className="max-h-[28rem] divide-y divide-gray-100 overflow-y-auto custom-scrollbar dark:divide-gray-800">
                    {hdList.items.map((item) => {
                      const row = hdRows.get(item.code);
                      const rowIndex = row ? others.findIndex((other) => other.key === row.key) : -1;
                      const amountInvalid = Boolean(row) && othersTouched && otherAmounts[rowIndex] === null;
                      const conflict = row ? contractConflict(row) : "";
                      return (
                        <li key={item.code} className={`px-3 py-1.5 ${row ? "bg-brand-50/50 dark:bg-brand-500/5" : ""}`}>
                          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                            <label className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-3">
                              <input type="checkbox" className="h-4 w-4 shrink-0" checked={Boolean(row)} onChange={(event) => toggleContracts([item.code], event.target.checked)} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-mono text-sm font-semibold text-gray-800 dark:text-white">{item.code}</span>
                                {item.supplier && <span className="block truncate text-xs text-gray-500">{item.supplier}</span>}
                              </span>
                              {!row && isInternationalPayment(activeHd) && Number(item.total) > 0 && (
                                <span className="shrink-0 text-sm tabular-nums text-gray-500">{formatAmount(item.total, language)}</span>
                              )}
                            </label>
                            {row && (
                              <input inputMode="decimal" value={row.amount} placeholder="1.250.000" aria-label={`${t("prCostAmount")} ${item.code}`}
                                onChange={(event) => setRowAmount(row.key, event.target.value)}
                                className={`${INPUT} text-right tabular-nums sm:w-44 ${amountInvalid ? "border-error-400" : ""}`} />
                            )}
                          </div>
                          {conflict && <p className="pb-1 text-xs text-error-600">{conflict}</p>}
                        </li>
                      );
                    })}
                  </ul>
                  {hdList.more > 0 && <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500 dark:border-gray-800">{t("prMoreContracts", { count: hdList.more })}</p>}
                </div>
              )}
            </>
          )}

          <h3 className="mt-5 text-sm font-semibold text-gray-700 dark:text-gray-200">{t("prOtherCosts")}</h3>
          <p className="text-xs text-gray-500">{t("prOtherHint")}</p>
          {others.some((row) => !needsContract(row)) && (
            <ul className="mt-2 space-y-2">
              {others.map((row, index) => {
                if (needsContract(row)) return null;
                const category = categoriesById.get(row.categoryId);
                const amountInvalid = othersTouched && otherAmounts[index] === null;
                return (
                  <li key={row.key} className="grid grid-cols-1 gap-2 rounded-xl border border-gray-200 p-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-center dark:border-gray-700">
                    <select value={row.categoryId} onChange={(event) => setOthers((current) => current.map((item) => (item.key === row.key ? { ...item, categoryId: event.target.value } : item)))}
                      disabled={!options} aria-label={t("prCostType")} className={`${INPUT} ${othersTouched && !row.categoryId ? "border-error-400" : ""}`}>
                      <option value="">{t("prSelectCategory")}</option>
                      {manualGroups.map((group) => (
                        <optgroup key={group.type || "other"} label={group.type ? t(`prType_${group.type}`) : "—"}>
                          {group.items.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}{item.flow === "do" ? " ⚠" : ""}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    <input inputMode="decimal" value={row.amount} placeholder="1.250.000" aria-label={t("prCostAmount")}
                      onChange={(event) => setRowAmount(row.key, event.target.value)}
                      className={`${INPUT} text-right tabular-nums ${amountInvalid ? "border-error-400" : ""}`} />
                    <span className="flex items-center justify-between gap-2 sm:justify-end">
                      {category && <PaymentFlowBadge flow={category.flow} />}
                      <button type="button" onClick={() => setOthers((current) => current.filter((item) => item.key !== row.key))} aria-label={t("prRemoveCost")} title={t("prRemoveCost")}
                        className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-error-50 hover:text-error-600 dark:hover:bg-error-500/10">✕</button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <button type="button" className={`${SECONDARY} mt-2 w-full sm:w-auto`} disabled={!options || costCount >= MAX_COSTS}
            onClick={() => setOthers((current) => [...current, { key: newKey(), categoryId: "", amount: "", contract: "" }])}>+ {t("prAddOtherCost")}</button>

          <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
            <p className="text-sm text-gray-600 dark:text-gray-300">{t("prSelectedCount", { count: costCount, total: money(total) })}</p>
            <button type="button" className={PRIMARY} disabled={costCount === 0}
              onClick={() => { setOthersTouched(true); if (otherValid) advance(); }}>{t("prContinue")}</button>
          </div>
        </StepCard>
      )}

      {/* 3. Hạn thanh toán */}
      {reached >= 2 && (
        <StepCard index={2} title={titles[2]} state={stepState(2)} summary={formatDueDate(dueDate)} onChange={() => setActive(2)}>
          <div className="flex flex-wrap gap-2">
            {([["prQuickToday", vnDate()], ["prQuick3", vnDate(3)], ["prQuick7", vnDate(7)], ["prQuickMonthEnd", vnMonthEnd()]] as const).map(([key, value]) => (
              <button key={key} type="button" onClick={() => setDueDate(value)}
                className={`h-10 rounded-full border px-4 text-sm font-medium ${dueDate === value ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300" : "border-gray-200 text-gray-700 hover:border-brand-300 dark:border-gray-700 dark:text-gray-200"}`}>
                {t(key)} · {formatDueDate(value).slice(0, 5)}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label={t("prDueDate")} className={`${INPUT} sm:w-56`} />
            <button type="button" className={`${PRIMARY} sm:ml-auto`} disabled={!complete[2]} onClick={() => advance()}>{t("prContinue")}</button>
          </div>
        </StepCard>
      )}

      {/* 4. Loại tiền (bước cuối) */}
      {reached >= 3 && (
        <StepCard index={3} title={titles[3]} state={stepState(3)} summary={currency} onChange={() => setActive(3)}>
          <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">{t("prCurrencyHint")}</p>
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            {(["VND", "USD"] as const).map((value) => (
              <button key={value} type="button" onClick={() => { setCurrency(value); advance(3); }}
                className={`h-16 rounded-xl border-2 text-lg font-bold transition-colors ${currency === value ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300" : "border-gray-200 text-gray-700 hover:border-brand-300 dark:border-gray-700 dark:text-gray-200"}`}>
                {value}
              </button>
            ))}
          </div>
        </StepCard>
      )}

      {/* Lưu */}
      {reached >= SAVE_STEP && active === SAVE_STEP && (
        <section className="rounded-2xl border border-brand-300 bg-white p-4 shadow-theme-xs dark:border-brand-500/40 dark:bg-white/[0.03] sm:p-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t("prStepSave")}</h2>
          <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-gray-500">{t("prTotal")}</dt><dd className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{money(total)}</dd></div>
            <div><dt className="text-gray-500">{t("prCosts")}</dt><dd className="font-medium text-gray-800 dark:text-white/90">{t("prCostCount", { count: costCount })}</dd></div>
            <div><dt className="text-gray-500">{t("prDueDate")}</dt><dd className="font-medium text-gray-800 dark:text-white/90">{formatDueDate(dueDate)}</dd></div>
          </dl>
          <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">{t("prSaveHint")}</p>
          {error && <p role="alert" className="mt-3 break-words rounded-lg bg-error-50 px-3 py-2 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-300">{error}</p>}
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {onCancel && <button type="button" className={SECONDARY} onClick={onCancel} disabled={saving}>{t("cancel")}</button>}
            <button type="button" className={PRIMARY} onClick={() => void save()} disabled={saving || complete.some((done) => !done)}>
              {saving ? t("prSaving") : editing ? t("prSaveChanges") : t("prSaveDraft")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
