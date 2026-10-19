"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import { getOrderCosts, saveOrderCosts, type CostCategory, type OrderCost, type OrderCosts } from "@/services/paymentCostApi";
import { formatAmount, parseAmountLoose, sumAmounts } from "@/utils/paymentRequest";

// Tab "Chi phí" của đơn hàng: nhập trước chi phí để khi tạo đề nghị thanh toán chỉ tick chọn, không nhập lại số tiền.
// Một thẻ "phí theo hợp đồng" (mã HD: thanh toán quốc tế, thuế nhập khẩu...) + mỗi container một thẻ (phí container).
// Mỗi thẻ: danh sách khoản đã nhập + dòng thêm khoản (sổ xuống chọn khoản phí, nhập số tiền; thanh toán quốc tế điền sẵn
// tổng tiền hàng). Chỉ nhập số (loại tiền chọn khi tạo đề nghị). Khoản đã đưa vào đề nghị hiện mã đề nghị, khoá.
// Đơn đã qua vận chuyển biển (đã giao) không nhập thêm thanh toán quốc tế.

interface Props {
  contract: string;
}

/** Số container; CONTRACT_TARGET = phí theo hợp đồng. */
type Target = string;
const CONTRACT_TARGET = "";
const CONTRACT_CODE = "HD";
const isInternationalPayment = (category: CostCategory) => category.code.toUpperCase() === CONTRACT_CODE
  && category.name.trim().toLowerCase() === "thanh toán quốc tế";

const cellKey = (target: Target, categoryId: string) => `${target}|${categoryId}`;
const INPUT = "h-10 min-w-0 rounded-lg border bg-white px-2.5 text-sm text-gray-800 outline-none focus:border-brand-400 disabled:bg-gray-50 disabled:text-gray-500 dark:bg-gray-900 dark:text-white dark:disabled:bg-gray-800";

export default function ShipmentCostsTab({ contract }: Props) {
  const { t, language } = useLanguage();
  const { notify } = useSystemNotification();
  const [data, setData] = useState<OrderCosts | null>(null);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  // Số tiền đang sửa theo ô (ô = hợp đồng/cont × khoản phí); "" = xoá khoản.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<string[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [newEntry, setNewEntry] = useState<Record<Target, { categoryId: string; amount: string }>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    getOrderCosts(contract)
      .then((result) => {
        if (!active) return;
        setData(result);
        setError("");
        setDrafts({});
        setAdded([]);
        setRemoved([]);
      })
      .catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : t("pcLoadError")); });
    return () => { active = false; };
  }, [contract, reloadKey, t]);

  const categoriesById = useMemo(() => new Map((data?.categories || []).map((category) => [category.id, category])), [data]);
  // Khoản chưa thuộc đề nghị (sửa được) và các khoản đã vào đề nghị (khoá), theo hợp đồng/cont + khoản phí.
  const { freeByCell, lockedByTarget } = useMemo(() => {
    const free = new Map<string, OrderCost>();
    const locked = new Map<Target, OrderCost[]>();
    for (const cost of data?.costs || []) {
      if (cost.requestId) locked.set(cost.container, [...(locked.get(cost.container) || []), cost]);
      else if (!free.has(cellKey(cost.container, cost.categoryId))) free.set(cellKey(cost.container, cost.categoryId), cost);
    }
    return { freeByCell: free, lockedByTarget: locked };
  }, [data]);

  const valueOf = (key: string) => (key in drafts ? drafts[key] : freeByCell.has(key) ? formatAmount(freeByCell.get(key)?.amount, language) : "");
  const isShown = (key: string) => !removed.includes(key) && (freeByCell.has(key) || added.includes(key));
  const entriesOf = (target: Target) => (data?.categories || []).filter((category) => isShown(cellKey(target, category.id)));
  const dirtyKeys = Object.keys(drafts).filter((key) => {
    const original = freeByCell.get(key)?.amount || null;
    const next = drafts[key].trim() ? parseAmountLoose(drafts[key]) : null;
    return drafts[key].trim() ? next === null || Number(next) !== Number(original) : original !== null;
  });
  const invalidKeys = new Set(Object.keys(drafts).filter((key) => drafts[key].trim() && parseAmountLoose(drafts[key]) === null));

  const targetTotal = (target: Target) => sumAmounts([
    ...entriesOf(target).map((category) => parseAmountLoose(valueOf(cellKey(target, category.id)))),
    ...(lockedByTarget.get(target) || []).map((cost) => cost.amount),
  ]);

  // Khoản phí theo hợp đồng: mã HD; khoản phí của container: mọi mã khác.
  const contractCategories = useMemo(() => (data?.categories || []).filter((category) => category.code.toUpperCase() === CONTRACT_CODE), [data]);
  const containerCategories = useMemo(() => (data?.categories || []).filter((category) => category.code.toUpperCase() !== CONTRACT_CODE), [data]);

  /** Danh sách sổ xuống: nhóm theo mã chi phí, bỏ khoản đã nhập ở hợp đồng / cont này. */
  const optionGroups = (target: Target) => {
    const groups = new Map<string, CostCategory[]>();
    // Mỗi khoản phí chỉ một dòng trên một cont / hợp đồng: khoản đã vào đề nghị cũng không nhập thêm.
    const lockedCategories = new Set((lockedByTarget.get(target) || []).map((cost) => cost.categoryId));
    const forContract = target === CONTRACT_TARGET;
    for (const category of forContract ? contractCategories : containerCategories) {
      if (isShown(cellKey(target, category.id)) || lockedCategories.has(category.id)) continue;
      // Đơn đã giao coi như đã thanh toán quốc tế.
      if (forContract && data?.seaPassed && isInternationalPayment(category)) continue;
      groups.set(category.code, [...(groups.get(category.code) || []), category]);
    }
    return [...groups.entries()];
  };

  const addEntry = (target: Target) => {
    const entry = newEntry[target];
    if (!entry?.categoryId) return;
    if (parseAmountLoose(entry.amount) === null) return notify(t("pcAmountRequired"), "error");
    const key = cellKey(target, entry.categoryId);
    setDrafts((current) => ({ ...current, [key]: entry.amount }));
    setRemoved((current) => current.filter((item) => item !== key));
    if (!freeByCell.has(key)) setAdded((current) => [...current, key]);
    setNewEntry((current) => ({ ...current, [target]: { categoryId: "", amount: "" } }));
  };

  const removeEntry = (key: string) => {
    if (freeByCell.has(key)) {
      setRemoved((current) => [...current, key]);
      setDrafts((current) => ({ ...current, [key]: "" }));
    } else {
      setAdded((current) => current.filter((item) => item !== key));
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  const discard = () => {
    setDrafts({});
    setAdded([]);
    setRemoved([]);
  };

  const save = async () => {
    if (!data || saving || dirtyKeys.length === 0) return;
    if (invalidKeys.size) return notify(t("pcInvalidAmount"), "error");
    setSaving(true);
    try {
      const changes = dirtyKeys.map((key) => {
        const [container, categoryId] = key.split("|");
        return { container, categoryId, amount: drafts[key].trim() ? parseAmountLoose(drafts[key]) : null };
      });
      setData(await saveOrderCosts(contract, changes));
      discard();
      notify(t("pcSaved"), "success");
    } catch (saveError) {
      notify(saveError instanceof Error ? saveError.message : String(saveError), "error");
    } finally {
      setSaving(false);
    }
  };

  if (error && !data) {
    return (
      <div className="rounded-xl bg-error-50 px-4 py-3 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-300">
        <p className="break-words">{error}</p>
        <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="mt-2 font-semibold underline">{t("prRetry")}</button>
      </div>
    );
  }
  if (!data) return <div className="h-40 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />;

  const canEditContainer = data.access.container.edit && !data.cancelled;

  const costCard = (target: Target, title: React.ReactNode, editable: boolean) => {
    const entries = entriesOf(target);
    const locked = lockedByTarget.get(target) || [];
    const entry = newEntry[target] || { categoryId: "", amount: "" };
    const groups = optionGroups(target);
    return (
      <div key={target} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
        <div className="flex items-center justify-between gap-2">
          <p className={`min-w-0 truncate text-sm font-semibold text-gray-800 dark:text-white ${target === CONTRACT_TARGET ? "" : "font-mono"}`}>{title}</p>
          <p className="shrink-0 text-sm font-bold tabular-nums text-gray-900 dark:text-white">{t("pcTotal")}: {formatAmount(targetTotal(target), language)}</p>
        </div>

        {entries.length === 0 && locked.length === 0 && <p className="mt-2 text-sm text-gray-400">{t("pcNoEntries")}</p>}
        {(entries.length > 0 || locked.length > 0) && (
          <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
            {entries.map((category) => {
              const key = cellKey(target, category.id);
              return (
                <li key={key} className="flex items-center gap-2 py-1.5">
                  <span className="line-clamp-2 min-w-0 flex-1 break-words text-sm text-gray-700 dark:text-gray-200" title={category.name}>{category.name}</span>
                  <input inputMode="decimal" aria-label={category.name} value={valueOf(key)} disabled={!editable}
                    onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
                    className={`${INPUT} w-32 text-right tabular-nums sm:w-40 ${invalidKeys.has(key) ? "border-error-400" : dirtyKeys.includes(key) ? "border-warning-400" : "border-gray-200 dark:border-gray-700"}`} />
                  {editable && (
                    <button type="button" onClick={() => removeEntry(key)} aria-label={`${t("prRemoveCost")} ${category.name}`} title={t("prRemoveCost")}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-error-50 hover:text-error-600 dark:hover:bg-error-500/10">✕</button>
                  )}
                </li>
              );
            })}
            {locked.map((cost) => (
              <li key={cost.id} className="flex items-center gap-2 py-1.5 text-sm text-gray-500">
                <span className="min-w-0 flex-1 truncate" title={categoriesById.get(cost.categoryId)?.name}>{categoriesById.get(cost.categoryId)?.name || cost.categoryId}</span>
                <Link href={`/payment-requests/${encodeURIComponent(cost.requestId)}`} className="shrink-0 text-xs text-brand-600 hover:underline dark:text-brand-400">{t("pcLockedIn", { id: cost.requestId })}</Link>
                <span className="w-28 shrink-0 text-right tabular-nums">{formatAmount(cost.amount, language)}</span>
              </li>
            ))}
          </ul>
        )}

        {editable && (
          <div className="mt-2 grid grid-cols-1 gap-2 border-t border-dashed border-gray-200 pt-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto] dark:border-gray-700">
            <select value={entry.categoryId} aria-label={t("pcSelectFee")}
              onChange={(event) => {
                const categoryId = event.target.value;
                const category = categoriesById.get(categoryId);
                const fill = !entry.amount.trim() && category && isInternationalPayment(category) && Number(data?.goodsTotal) > 0;
                setNewEntry((current) => ({ ...current, [target]: { categoryId, amount: fill ? formatAmount(data?.goodsTotal, "vi") : entry.amount } }));
              }}
              className={`${INPUT} w-full border-gray-200 dark:border-gray-700`}>
              <option value="">{t("pcSelectFee")}</option>
              {groups.map(([code, items]) => (
                <optgroup key={code} label={`${code} · ${t(`prType_${items[0].type}`)}`}>
                  {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </optgroup>
              ))}
            </select>
            <input inputMode="decimal" value={entry.amount} placeholder={t("prCostAmount")} aria-label={t("prCostAmount")}
              onChange={(event) => setNewEntry((current) => ({ ...current, [target]: { ...entry, amount: event.target.value } }))}
              onKeyDown={(event) => { if (event.key === "Enter") addEntry(target); }}
              className={`${INPUT} w-full border-gray-200 text-right tabular-nums dark:border-gray-700`} />
            <button type="button" onClick={() => addEntry(target)} disabled={!entry.categoryId || !entry.amount.trim()}
              className="h-10 rounded-lg bg-brand-50 px-4 text-sm font-semibold text-brand-700 hover:bg-brand-100 disabled:opacity-50 dark:bg-brand-500/10 dark:text-brand-300">
              + {t("pcAddFee")}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600 sm:flex-row sm:items-center sm:justify-between dark:bg-gray-800/60 dark:text-gray-300">
        <p className="min-w-0">{data.cancelled ? t("pcCancelledOrder") : t("pcHint")}</p>
        <Link href="/payment-requests/new" className="shrink-0 font-semibold text-brand-600 hover:underline dark:text-brand-400">{t("pcCreateRequest")} →</Link>
      </div>
      {data.categories.length === 0 && <p className="text-sm text-gray-500">{t("pcNoGroups")}</p>}

      {data.categories.length > 0 && data.access.container.view && contractCategories.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-800 dark:text-white">
            {t("pcContractSection")}{!canEditContainer && <span className="ml-2 text-xs font-normal text-gray-400">({t("pcReadOnly")})</span>}
          </h3>
          {costCard(CONTRACT_TARGET, `${t("prContract")} ${data.contract}`, canEditContainer)}
          {data.seaPassed && <p className="mt-2 text-xs text-gray-500">{t("pcSeaPassedHint")}</p>}
        </section>
      )}

      {data.categories.length > 0 && data.access.container.view && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-800 dark:text-white">
            {t("pcContainerSection")}{!canEditContainer && <span className="ml-2 text-xs font-normal text-gray-400">({t("pcReadOnly")})</span>}
          </h3>
          {data.containers.length === 0
            ? <p className="text-sm text-gray-500">{t("pcNoContainers")}</p>
            : <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{data.containers.map((container) => costCard(container, container, canEditContainer))}</div>}
        </section>
      )}

      {canEditContainer && (
        <div className="sticky bottom-0 flex flex-col gap-2 border-t border-gray-100 bg-white/95 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-end dark:border-gray-800 dark:bg-gray-900/95">
          {dirtyKeys.length > 0 && <p className="text-sm text-warning-700 sm:mr-auto dark:text-warning-300">{t("pcUnsaved")} ({dirtyKeys.length})</p>}
          {dirtyKeys.length > 0 && (
            <button type="button" onClick={discard} disabled={saving} className="h-10 rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200">{t("pcDiscard")}</button>
          )}
          <button type="button" onClick={() => void save()} disabled={saving || dirtyKeys.length === 0}
            className="h-10 rounded-lg bg-brand-500 px-5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
            {saving ? t("prSaving") : t("pcSave")}
          </button>
        </div>
      )}
    </div>
  );
}
