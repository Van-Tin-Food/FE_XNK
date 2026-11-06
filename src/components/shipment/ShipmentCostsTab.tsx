"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import PaymentCategoryPicker from "@/components/payment/PaymentCategoryPicker";
import { getOrderCosts, goodsPaymentKind, saveOrderCosts, type CostCategory, type OrderCost, type OrderCosts } from "@/services/paymentCostApi";
import { amountToCents, formatAmount, parseAmountLoose, sumAmounts } from "@/utils/paymentRequest";

// Tab "Chi phí" của đơn hàng: nhập trước chi phí để khi tạo đề nghị thanh toán chỉ tick chọn, không nhập lại số tiền.
// Hai phần nằm cạnh nhau (desktop): phí theo hợp đồng (mã HD: cọc hàng, thanh toán tiền còn lại, thuế nhập khẩu...) bên
// trái, phí theo container (mỗi cont một thẻ) bên phải; màn hình hẹp thì xếp dọc.
// Mỗi khoản một khối: tên khoản, số tiền, nội dung (diễn giải). Chỉ nhập số (loại tiền chọn khi tạo đề nghị); số tiền là
// số đã gồm VAT (% VAT nhập khi tạo đề nghị). Khoản đã đưa vào đề nghị hiện mã đề nghị, khoá; nhập lại khoản phí đó = thêm
// khoản mới — phí phát sinh lần N (có dòng cảnh báo "chi phí đã được tạo"), trừ cọc hàng / thanh toán còn lại (một khoản).
// Thanh toán tiền hàng: tiền cọc và tiền còn lại nhập độc lập; khoản còn lại phải nhỏ hơn tiền hàng.

interface Props {
  contract: string;
}

/** Số container; CONTRACT_TARGET = phí theo hợp đồng. */
type Target = string;
const CONTRACT_TARGET = "";
const CONTRACT_CODE = "HD";
const CONTAINER_CODE = "CONT";

const cellKey = (target: Target, categoryId: string) => `${target}|${categoryId}`;
const INPUT = "h-10 min-w-0 rounded-lg border bg-white px-2.5 text-sm text-gray-800 outline-none focus:border-brand-400 disabled:bg-gray-50 disabled:text-gray-500 dark:bg-gray-900 dark:text-white dark:disabled:bg-gray-800";
const LABEL = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400";
/** Tiêu đề 2 mục "Chi phí theo hợp đồng" / "Chi phí theo container": chữ lớn, đậm, vạch màu bên trái cho nổi bật. */
const SECTION_TITLE = "mb-3 flex flex-wrap items-center border-l-4 border-brand-500 pl-3 text-base font-bold text-gray-900 sm:text-lg dark:text-white";
/**
 * Lưới một khoản: thẻ hẹp = [khoản phí | số tiền | xoá] + nội dung ở hàng dưới; thẻ từ 24rem (container query @sm, theo
 * bề rộng thẻ chứ không theo màn hình — thẻ nằm trong cột trái / phải) = [khoản phí | số tiền | nội dung | xoá] một hàng.
 */
const ENTRY_GRID = "grid grid-cols-[minmax(0,1fr)_7.5rem_auto] items-center gap-2 @sm:grid-cols-[minmax(0,1.1fr)_7rem_minmax(0,1fr)_auto]";
type NewEntry = { categoryId: string; amount: string; note: string };
const EMPTY_ENTRY: NewEntry = { categoryId: "", amount: "", note: "" };

export default function ShipmentCostsTab({ contract }: Props) {
  const { t, language } = useLanguage();
  const { notify } = useSystemNotification();
  const [data, setData] = useState<OrderCosts | null>(null);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  // Số tiền đang sửa theo ô (ô = hợp đồng/cont × khoản phí); "" = xoá khoản. Nội dung (diễn giải) sửa riêng theo ô.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<string[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [newEntry, setNewEntry] = useState<Record<Target, NewEntry>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    getOrderCosts(contract)
      .then((result) => {
        if (!active) return;
        setData(result);
        setError("");
        setDrafts({});
        setNoteDrafts({});
        setAdded([]);
        setRemoved([]);
      })
      .catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : t("pcLoadError")); });
    return () => { active = false; };
  }, [contract, reloadKey, t]);

  const categoriesById = useMemo(() => new Map((data?.categories || []).map((category) => [category.id, category])), [data]);
  // Ô (hợp đồng/cont + khoản phí) sửa khoản chưa thuộc đề nghị đầu tiên; danh sách bên dưới (lockedByTarget) = khoản đã vào đề
  // nghị (khoá) + khoản chưa vào đề nghị thứ hai trở đi của ô (hiếm: đề nghị bị xóa trả khoản về khi ô đã có khoản khác).
  // requestsByCell: mã đề nghị đã chứa khoản phí của ô — nhập lại ô đó là phí phát sinh (cảnh báo).
  const { freeByCell, lockedByTarget, requestsByCell, countByCell } = useMemo(() => {
    const free = new Map<string, OrderCost>();
    const locked = new Map<Target, OrderCost[]>();
    const requests = new Map<string, string[]>();
    const counts = new Map<string, number>();
    for (const cost of data?.costs || []) {
      const key = cellKey(cost.container, cost.categoryId);
      counts.set(key, (counts.get(key) || 0) + 1);
      if (cost.requestId) requests.set(key, [...new Set([...(requests.get(key) || []), cost.requestId])]);
      if (cost.requestId || free.has(key)) locked.set(cost.container, [...(locked.get(cost.container) || []), cost]);
      else free.set(key, cost);
    }
    return { freeByCell: free, lockedByTarget: locked, requestsByCell: requests, countByCell: counts };
  }, [data]);
  /** Cảnh báo ô đã có khoản trong đề nghị mà chưa có khoản trống: lưu sẽ tạo phí phát sinh lần N. */
  const repeatWarning = (key: string) => {
    const requests = requestsByCell.get(key);
    if (!requests?.length || freeByCell.has(key)) return null;
    return (
      <p className="mt-1 text-xs font-medium text-warning-700 dark:text-warning-300">
        ⚠ {t("costRepeatWarning", { ids: requests.join(", "), n: (countByCell.get(key) || 0) + 1 })}
      </p>
    );
  };

  const valueOf = (key: string) => (key in drafts ? drafts[key] : freeByCell.has(key) ? formatAmount(freeByCell.get(key)?.amount, language) : "");
  const isShown = (key: string) => !removed.includes(key) && (freeByCell.has(key) || added.includes(key));
  const entriesOf = (target: Target) => (data?.categories || []).filter((category) => isShown(cellKey(target, category.id)));
  const noteOf = (key: string) => (key in noteDrafts ? noteDrafts[key] : freeByCell.get(key)?.note || "");
  // Ô có thay đổi: số tiền khác (hoặc xoá), hoặc nội dung khác bản đã lưu.
  const dirtyKeys = [...new Set([...Object.keys(drafts), ...Object.keys(noteDrafts)])].filter((key) => {
    const original = freeByCell.get(key)?.amount || null;
    const amountText = valueOf(key);
    const next = amountText.trim() ? parseAmountLoose(amountText) : null;
    const noteChanged = noteOf(key).trim() !== (freeByCell.get(key)?.note || "");
    if (!amountText.trim()) return original !== null;
    return next === null || Number(next) !== Number(original) || noteChanged;
  });
  const invalidKeys = new Set(Object.keys(drafts).filter((key) => drafts[key].trim() && parseAmountLoose(drafts[key]) === null));

  const targetTotal = (target: Target) => sumAmounts([
    ...entriesOf(target).map((category) => parseAmountLoose(valueOf(cellKey(target, category.id)))),
    ...(lockedByTarget.get(target) || []).map((cost) => cost.amount),
  ]);

  // Khoản phí theo hợp đồng: mã HD; khoản phí của container: mã CONT (mã khác như chi phí vận hành nhập khi tạo đề nghị).
  const contractCategories = useMemo(() => (data?.categories || []).filter((category) => category.code.toUpperCase() === CONTRACT_CODE), [data]);
  const containerCategories = useMemo(() => (data?.categories || []).filter((category) => category.code.toUpperCase() === CONTAINER_CODE), [data]);
  const depositCategory = contractCategories.find((category) => goodsPaymentKind(category) === "deposit");
  const balanceCategory = contractCategories.find((category) => goodsPaymentKind(category) === "balance");

  // ---------- Kiểm tra khoản còn lại theo tiền hàng ----------
  const goodsTotal = amountToCents(data?.goodsTotal) > BigInt(0) ? data?.goodsTotal || "" : "";
  /** Số tiền hiện tại của một khoản theo hợp đồng (đang sửa / đã lưu / đã vào đề nghị); không có → null. */
  const contractAmount = (category: CostCategory | undefined, overrides: Record<string, string> = {}): string | null => {
    if (!category) return null;
    const key = cellKey(CONTRACT_TARGET, category.id);
    if (key in overrides) return parseAmountLoose(overrides[key]);
    if (isShown(key)) return parseAmountLoose(valueOf(key));
    return (lockedByTarget.get(CONTRACT_TARGET) || []).find((cost) => cost.categoryId === category.id)?.amount || null;
  };
  /** Sửa số tiền một ô. */
  const setAmount = (key: string, value: string) => {
    setDrafts((current) => ({ ...current, [key]: value }));
  };

  /**
   * Danh sách sổ xuống: nhóm theo mã chi phí, bỏ khoản đang có ô sửa. Khoản đã vào đề nghị vẫn chọn được (phí phát sinh, có
   * cảnh báo), trừ cọc hàng / thanh toán còn lại — mỗi hợp đồng một khoản.
   */
  const optionGroups = (target: Target) => {
    const groups = new Map<string, CostCategory[]>();
    const forContract = target === CONTRACT_TARGET;
    for (const category of forContract ? contractCategories : containerCategories) {
      const key = cellKey(target, category.id);
      if (isShown(key) || (goodsPaymentKind(category) && requestsByCell.has(key))) continue;
      groups.set(category.code, [...(groups.get(category.code) || []), category]);
    }
    return [...groups.entries()];
  };

  const addEntry = (target: Target) => {
    const entry = newEntry[target];
    if (!entry?.categoryId) return notify(t("pcFeeRequired"), "error");
    if (parseAmountLoose(entry.amount) === null) return notify(t("pcAmountRequired"), "error");
    const key = cellKey(target, entry.categoryId);
    setAmount(key, entry.amount);
    setNoteDrafts((current) => ({ ...current, [key]: entry.note }));
    setRemoved((current) => current.filter((item) => item !== key));
    if (!freeByCell.has(key)) setAdded((current) => [...current, key]);
    setNewEntry((current) => ({ ...current, [target]: EMPTY_ENTRY }));
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
    setNoteDrafts({});
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
        const amountText = valueOf(key);
        return { container, categoryId, amount: amountText.trim() ? parseAmountLoose(amountText) : null, note: noteOf(key).trim() };
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
  const money = (value: string | null | undefined) => formatAmount(value, language);

  /** Khoản còn lại phải nhỏ hơn tiền hàng; tiền cọc không ảnh hưởng kiểm tra này. */
  const balanceHint = (amount: string | null) => {
    if (!goodsTotal) return null;
    const valid = amount !== null && amountToCents(amount) < amountToCents(goodsTotal);
    return (
      <p className={`mt-1 text-xs ${valid ? "text-gray-500" : "text-error-600 dark:text-error-400"}`}>
        {t("pcBalanceFormula", { goods: money(goodsTotal) })}
        {!valid && amount !== null && ` · ${t("pcBalanceMismatch")}`}
      </p>
    );
  };

  const costCard = (target: Target, title: React.ReactNode, editable: boolean, fill = false) => {
    const entries = entriesOf(target);
    const locked = lockedByTarget.get(target) || [];
    const entry = newEntry[target] || EMPTY_ENTRY;
    const groups = optionGroups(target);
    const isContract = target === CONTRACT_TARGET;
    const entryKind = goodsPaymentKind(categoriesById.get(entry.categoryId));
    // Số tiền khoản mới gõ sai: báo ngay dưới ô (để trống thì báo khi bấm Thêm).
    const entryAmountInvalid = Boolean(entry.amount.trim()) && parseAmountLoose(entry.amount) === null;
    const showGoodsSplit = isContract && goodsTotal && (depositCategory || balanceCategory);
    return (
      <div key={target} className={`@container rounded-xl border border-gray-200 bg-white p-3 sm:p-4 dark:border-gray-700 dark:bg-white/[0.02] ${fill ? "lg:flex-1" : ""}`}>
        {/* Hàng tiêu đề: hợp đồng / cont | (hợp đồng) tiền hàng, cọc, còn lại | tổng — cùng một hàng, hẹp thì xuống dòng */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 pb-2 dark:border-gray-800">
          <p className={`min-w-0 truncate text-sm font-semibold text-gray-800 dark:text-white ${isContract ? "" : "font-mono"}`}>{title}</p>
          {showGoodsSplit && (
            <span className="min-w-0 rounded-md bg-brand-50/70 px-2 py-0.5 text-xs text-gray-600 dark:bg-brand-500/10 dark:text-gray-300">
              {t("pcGoodsSplit", { goods: money(goodsTotal), deposit: money(contractAmount(depositCategory) || "0"), balance: money(contractAmount(balanceCategory) || "0") })}
            </span>
          )}
          <p className="ml-auto shrink-0 text-sm text-gray-500">{t("pcTotal")}: <span className="font-bold tabular-nums text-gray-900 dark:text-white">{money(targetTotal(target))}</span></p>
        </div>

        {entries.length === 0 && locked.length === 0 && <p className="mt-3 text-sm text-gray-400">{t("pcNoEntries")}</p>}
        {(entries.length > 0 || locked.length > 0) && (
          <>
            {/* Tiêu đề cột: Khoản phí | Số tiền | Nội dung (khi thẻ đủ rộng mới chia cột) */}
            <div className={`${ENTRY_GRID} mt-3 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400`}>
              <span>{t("pcFeeLabel")}</span>
              <span className="text-right">{t("pcAmountWithVatLabel")}</span>
              <span className="hidden @sm:block">{t("pcNoteLabel")}</span>
              <span className={editable ? "w-8" : ""} />
            </div>
            <ul className="mt-1 space-y-2">
              {entries.map((category) => {
                const key = cellKey(target, category.id);
                const kind = goodsPaymentKind(category);
                return (
                  <li key={key} className={`rounded-lg border p-2.5 ${dirtyKeys.includes(key) ? "border-warning-300 bg-warning-50/40 dark:border-warning-500/40 dark:bg-warning-500/5" : "border-gray-100 bg-gray-50/60 dark:border-gray-800 dark:bg-gray-800/40"}`}>
                    {/* Một hàng: khoản phí | số tiền | nội dung | xoá; thẻ hẹp thì nội dung xuống dòng dưới */}
                    <div className={ENTRY_GRID}>
                      <span className="line-clamp-2 min-w-0 break-words text-sm font-medium text-gray-800 dark:text-gray-100" title={category.account ? `${category.account} · ${category.name}` : category.name}>{category.account ? `${category.account} · ${category.name}` : category.name}</span>
                      <span className="min-w-0">
                        <input inputMode="decimal" aria-label={`${t("pcAmountWithVatLabel")} ${category.name}`} value={valueOf(key)} disabled={!editable}
                          onChange={(event) => setAmount(key, event.target.value)} aria-invalid={invalidKeys.has(key)}
                          className={`${INPUT} w-full text-right font-semibold tabular-nums ${invalidKeys.has(key) ? "border-error-400" : "border-gray-200 dark:border-gray-700"}`} />
                        {invalidKeys.has(key) && <span className="mt-0.5 block text-right text-[11px] text-error-600 dark:text-error-400">{t("prAmountInvalidShort")}</span>}
                      </span>
                      {(editable || noteOf(key)) ? (
                        <input value={noteOf(key)} maxLength={500} disabled={!editable} placeholder={t("pcNotePlaceholder")} aria-label={`${t("prCostNote")} ${category.name}`}
                          onChange={(event) => setNoteDrafts((current) => ({ ...current, [key]: event.target.value }))}
                          className={`${INPUT} order-last col-span-3 w-full border-gray-200 @sm:order-none @sm:col-span-1 dark:border-gray-700`} />
                      ) : <span className="hidden @sm:block" />}
                      {editable ? (
                        <button type="button" onClick={() => removeEntry(key)} aria-label={`${t("prRemoveCost")} ${category.name}`} title={t("prRemoveCost")}
                          className="flex h-10 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-error-50 hover:text-error-600 dark:hover:bg-error-500/10">✕</button>
                      ) : <span />}
                    </div>
                    {kind === "balance" && balanceHint(parseAmountLoose(valueOf(key)))}
                    {repeatWarning(key)}
                  </li>
                );
              })}
              {locked.map((cost) => {
                const name = categoriesById.get(cost.categoryId)?.name || cost.categoryId;
                return (
                  <li key={cost.id} className="rounded-lg border border-dashed border-gray-200 p-2.5 dark:border-gray-700">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        {/* Mã đề nghị chứa khoản này lên đầu (như các bảng chi phí khác); phí phát sinh có nhãn lần thứ mấy. */}
                        <div className="mb-1 flex flex-wrap items-center gap-1">
                          {cost.requestId ? (
                            <Link href={`/payment-requests/${encodeURIComponent(cost.requestId)}`} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-brand-600 hover:underline dark:bg-gray-800 dark:text-brand-400">
                              🔒 {t("pcLockedIn", { id: cost.requestId })}
                            </Link>
                          ) : <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">{t("pcNotInRequest")}</span>}
                          {cost.repeat > 1 && <span className="rounded-full bg-warning-50 px-2 py-0.5 text-xs font-semibold text-warning-700 dark:bg-warning-500/10 dark:text-warning-300">{t("costRepeatBadge", { n: cost.repeat })}</span>}
                        </div>
                        <p className="break-words text-sm font-medium text-gray-600 dark:text-gray-300" title={name}>{name}</p>
                        {cost.note && <p className="break-words text-xs text-gray-500">{cost.note}</p>}
                      </div>
                      <span className="shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-gray-700 dark:text-gray-200">{money(cost.amount)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {editable && groups.length > 0 && (
          <div className="mt-3 rounded-lg border border-dashed border-gray-300 p-2.5 dark:border-gray-700">
            <p className="mb-2 text-xs font-semibold text-gray-600 dark:text-gray-300">+ {t("pcAddTitle")}</p>
            {/* Một hàng: khoản phí | số tiền | nội dung | nút thêm (thẻ hẹp thì xếp dọc) */}
            <div className="grid grid-cols-1 items-end gap-2 @sm:grid-cols-[minmax(0,1.1fr)_7rem_minmax(0,1fr)_auto]">
              {/* Khoản phí: gõ để lọc (không dấu cũng được, theo tên / mã / tài khoản), mũi tên + Enter để chọn — như form đề nghị */}
              <div className="min-w-0">
                <label htmlFor={`pc-fee-${target || "contract"}`} className={LABEL}>{t("pcFeeLabel")}</label>
                <PaymentCategoryPicker id={`pc-fee-${target || "contract"}`} categories={groups.flatMap(([, items]) => items)} selectedId={entry.categoryId}
                  onSelect={(category) => setNewEntry((current) => ({ ...current, [target]: { ...(current[target] || EMPTY_ENTRY), categoryId: category.id } }))}
                  className={`${INPUT} w-full border-gray-200 dark:border-gray-700`} />
              </div>
              <label className="min-w-0">
                <span className={LABEL}>{t("pcAmountWithVatLabel")}</span>
                <input inputMode="decimal" value={entry.amount} placeholder="1.250.000"
                  onChange={(event) => setNewEntry((current) => ({ ...current, [target]: { ...entry, amount: event.target.value } }))}
                  onKeyDown={(event) => { if (event.key === "Enter") addEntry(target); }}
                  aria-invalid={entryAmountInvalid}
                  className={`${INPUT} w-full text-right tabular-nums ${entryAmountInvalid ? "border-error-400" : "border-gray-200 dark:border-gray-700"}`} />
                {entryAmountInvalid && <span className="mt-0.5 block text-right text-[11px] text-error-600 dark:text-error-400">{t("prAmountInvalidShort")}</span>}
              </label>
              <label className="min-w-0">
                <span className={LABEL}>{t("pcNoteLabel")}</span>
                <input value={entry.note} maxLength={500} placeholder={t("pcNotePlaceholder")}
                  onChange={(event) => setNewEntry((current) => ({ ...current, [target]: { ...entry, note: event.target.value } }))}
                  onKeyDown={(event) => { if (event.key === "Enter") addEntry(target); }}
                  className={`${INPUT} w-full border-gray-200 dark:border-gray-700`} />
              </label>
              <button type="button" onClick={() => addEntry(target)}
                aria-label={t("pcAddFee")} title={t("pcAddFee")}
                className="h-10 w-full whitespace-nowrap rounded-lg bg-brand-50 px-4 text-sm font-semibold text-brand-700 hover:bg-brand-100 disabled:opacity-50 @sm:w-10 @sm:px-0 dark:bg-brand-500/10 dark:text-brand-300">
                +<span className="@sm:hidden"> {t("pcAddFee")}</span>
              </button>
            </div>
            {entryKind === "balance" && balanceHint(parseAmountLoose(entry.amount))}
            {entry.categoryId && repeatWarning(cellKey(target, entry.categoryId))}
          </div>
        )}
      </div>
    );
  };

  const readOnlyTag = !canEditContainer && <span className="ml-2 text-xs font-normal text-gray-400">({t("pcReadOnly")})</span>;
  const showContract = data.access.container.view && contractCategories.length > 0;
  const showContainers = data.access.container.view;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600 sm:flex-row sm:items-center sm:justify-between dark:bg-gray-800/60 dark:text-gray-300">
        <p className="min-w-0">{data.cancelled ? t("pcCancelledOrder") : t("pcHint")}</p>
        <Link href="/payment-requests/new" className="shrink-0 font-semibold text-brand-600 hover:underline dark:text-brand-400">{t("pcCreateRequest")} →</Link>
      </div>
      {data.categories.length === 0 && <p className="text-sm text-gray-500">{t("pcNoGroups")}</p>}

      {data.categories.length > 0 && (showContract || showContainers) && (
        // Hai khối ngang hàng: tiêu đề cùng hàng, thẻ hợp đồng kéo cao bằng cột container (từ lg).
        <div className={`grid grid-cols-1 gap-5 ${showContract && showContainers ? "lg:grid-cols-2 lg:items-stretch" : ""}`}>
          {showContract && (
            <section className="flex min-w-0 flex-col">
              <h3 className={SECTION_TITLE}>{t("pcContractSection")}{readOnlyTag}</h3>
              {costCard(CONTRACT_TARGET, `${t("prContract")} ${data.contract}`, canEditContainer, true)}            </section>
          )}
          {showContainers && (
            <section className="min-w-0">
              <h3 className={SECTION_TITLE}>
                {t("pcContainerSection")}{data.containers.length > 0 && <span className="ml-1 text-sm font-medium text-gray-400">({data.containers.length})</span>}{readOnlyTag}
              </h3>
              {data.containers.length === 0
                ? <p className="rounded-xl border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500 dark:border-gray-700">{t("pcNoContainers")}</p>
                : <div className="space-y-3">{data.containers.map((container) => costCard(container, container, canEditContainer))}</div>}
            </section>
          )}
        </div>
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
