"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL_KEYS,
  TRANSFER_FIELDS,
  buildTransferInfo,
  createPaymentRequest,
  getPaymentRequestOptions,
  parseTransferInfo,
  searchPaymentBeneficiaries,
  updatePaymentRequest,
  type PaymentCategory,
  type PaymentCost,
  type PaymentMethod,
  type PaymentRequest,
  type PaymentRequestOptions,
  type PaymentBeneficiarySuggestion,
  type TransferField,
  type TransferKind,
} from "@/services/paymentRequestApi";
import { addVat, formatAmount, formatMoney, parseAmountLoose, parseVatInput, splitVat, sumAmounts, type PaymentCurrency } from "@/utils/paymentRequest";
import { goodsPaymentKind } from "@/services/paymentCostApi";
import { PaymentFlowBadge, formatDueDate } from "./PaymentRequestParts";

// Bước 1 "Tạo đề nghị" dạng hỏi lần lượt: trả lời xong câu nào thì câu tiếp theo mới hiện ra, câu đã trả lời thu lại
// thành phần tóm tắt chi tiết (bấm "Đổi" để sửa). Thứ tự: chi phí → nội dung → thanh toán (hạn thanh toán + loại tiền +
// hình thức, + thông tin chuyển khoản nếu chuyển khoản, chung một bước) → kiểm tra và lưu (hiện đầy đủ như bản nháp).
// Chi phí: MỘT đề nghị chỉ thanh toán một loại chi phí (loai_phi) và trong đó một mã phí (ma_phi) — chọn loại → chọn mã:
// - mã chi phí đơn hàng (HD theo hợp đồng / CONT theo container): tick các khoản nhập sẵn ở tab Chi phí của đơn hàng
//   (của mọi người, nhiều đơn, nhiều cont) — không nhập lại số tiền;
// - mã khác (chi phí vận hành...): nhập khoản phí + số tiền + nội dung, lưu vào payment_cost cùng lúc lưu đề nghị.
// Thuế: khoản thuộc danh mục có thuế bắt buộc nhập % VAT; số tiền lưu là số ĐÃ GỒM VAT. Form tự tính tiền trước thuế /
// tiền VAT (khoản nhập tay còn nhập được tiền trước thuế để tự ra tổng).
// Lưu = lưu nháp; gửi Google Chat ở bước 2.

interface OtherRow {
  key: string;
  /** Có id = khoản nhập tay đã thuộc đề nghị này (đang sửa). */
  id?: string;
  categoryId: string;
  /** Số tiền đã gồm VAT. */
  amount: string;
  note: string;
  /** % VAT (khoản có thuế). */
  vat: string;
  /** Tiền trước thuế đang gõ (basis = "base": tổng tự tính = trước thuế × (1 + %VAT)). */
  base: string;
  basis: "amount" | "base";
}

interface Props {
  /** Có giá trị = sửa đề nghị này (mọi câu đã trả lời sẵn). */
  editing?: PaymentRequest | null;
  onSaved: (request: PaymentRequest) => void;
  onCancel?: () => void;
}

const STEP_COUNT = 3;
/** Mức VAT hay dùng (bấm nhanh); mức khác gõ tay vào ô %. */
const VAT_PRESETS = ["5", "8"];
const SAVE_STEP = STEP_COUNT;
const TYPE_ORDER = ["mua_hang", "ban_hang", "van_hanh", "phat_sinh"];
const INPUT = "h-11 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-brand-400 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-white";
const PRIMARY = "h-11 rounded-lg bg-brand-500 px-5 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY = "h-11 rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800";
const CHIP = "min-h-10 rounded-full border px-4 text-sm font-medium transition-colors";
const CHIP_ON = "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300";
const CHIP_OFF = "border-gray-200 text-gray-700 hover:border-brand-300 dark:border-gray-700 dark:text-gray-200";
/** Số khoản hiện trong phần tóm tắt bước chi phí (còn lại ghi "+N khoản"). */
const SUMMARY_LIMIT = 6;

let seed = 0;
const newKey = () => `other-${Date.now()}-${seed += 1}`;
const emptyRow = (): OtherRow => ({ key: newKey(), categoryId: "", amount: "", note: "", vat: "", base: "", basis: "amount" });
/** Chi phí nhập sẵn ở tab Chi phí của đơn (theo container hoặc theo hợp đồng). */
const isPrepared = (cost: PaymentCost) => Boolean(cost.container || cost.contract);
/** Mã phí của chi phí đơn hàng (HD = theo hợp đồng, CONT = theo container): nhập ở tab Chi phí, khi tạo đề nghị chỉ tick. */
const ORDER_COST_CODES = ["HD", "CONT"];
const isOrderCode = (code: string) => ORDER_COST_CODES.includes(code.toUpperCase());
const MAX_COSTS = 100;
const BENEFICIARY_DEBOUNCE_MS = 250;

/** Ngày (YYYY-MM-DD) theo giờ Việt Nam, cộng thêm số ngày. */
function vnDate(addDays = 0): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  const [year, month, day] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + addDays)).toISOString().slice(0, 10);
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
          {!active && summary && <div className="mt-1 break-words text-sm text-gray-800 dark:text-white/90">{summary}</div>}
          {active && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </section>
  );
}

/** Một dòng khoản phí trong tóm tắt / bản nháp: tên khoản — nội dung, đơn / cont, (trước thuế · VAT), số tiền. */
function CostLine({ name, note, target, amount, vatLine }: { name: string; note: string; target: string; amount: string; vatLine?: string }) {
  return (
    <li className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="break-words text-sm font-medium text-gray-800 dark:text-white/90">{name}{note && <span className="font-normal text-gray-600 dark:text-gray-300"> — {note}</span>}</p>
        {target && <p className="truncate text-xs text-gray-500" title={target}>{target}</p>}
        {vatLine && <p className="text-xs text-gray-500">{vatLine}</p>}
      </div>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{amount}</span>
    </li>
  );
}

/** Ô % VAT + nút mức hay dùng. */
function VatInput({ value, onChange, invalid, label }: { value: string; onChange: (value: string) => void; invalid: boolean; label: string }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="relative">
        <input inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} placeholder="8"
          className={`h-9 w-20 rounded-lg border bg-white pl-2.5 pr-6 text-right text-sm tabular-nums text-gray-800 outline-none focus:border-brand-400 dark:bg-gray-900 dark:text-white ${invalid ? "border-error-400" : "border-gray-200 dark:border-gray-700"}`} />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
      </span>
      {VAT_PRESETS.map((preset) => (
        <button key={preset} type="button" onClick={() => onChange(preset)} aria-pressed={parseVatInput(value) === preset}
          className={`h-8 rounded-full border px-2.5 text-xs font-medium ${parseVatInput(value) === preset ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300" : "border-gray-200 text-gray-600 hover:border-brand-300 dark:border-gray-700 dark:text-gray-300"}`}>
          {preset}%
        </button>
      ))}
    </span>
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
    key: newKey(), id: cost.id, categoryId: cost.categoryId, amount: formatAmount(cost.amount, "vi"), note: cost.note, vat: cost.vat, base: "", basis: "amount" as const,
  })) : []));
  // % VAT đang nhập cho từng khoản nhập sẵn có thuế (theo id); chưa nhập thì lấy % đã lưu của khoản đó.
  const [vats, setVats] = useState<Record<string, string>>({});
  // Loại chi phí + mã phí của đề nghị (sửa đề nghị: lấy theo khoản đầu tiên).
  const [costType, setCostType] = useState(editing?.costs[0]?.type || "");
  const [costCode, setCostCode] = useState(editing?.costs[0]?.code.toUpperCase() || "");
  const [dueDate, setDueDate] = useState(editing?.dueDate || "");
  const [currency, setCurrency] = useState<PaymentCurrency | "">(editing?.currency || "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">(editing?.paymentMethod || "");
  // Thông tin chuyển khoản (người thụ hưởng): một khối nhiều dòng, chọn chuyển khoản lần đầu thì điền sẵn khung mẫu.
  const [transferValues, setTransferValues] = useState<Record<string, string>>(() => parseTransferInfo(editing?.transferInfo || ""));
  // Gợi ý người thụ hưởng theo số tài khoản / IBAN đang gõ (tìm trong các đề nghị đã lưu, chờ ngừng gõ mới gọi BE).
  const [accountQuery, setAccountQuery] = useState("");
  const [beneficiarySuggestions, setBeneficiarySuggestions] = useState<PaymentBeneficiarySuggestion[]>([]);
  const [active, setActive] = useState(editing ? SAVE_STEP : 0);
  const [reached, setReached] = useState(editing ? SAVE_STEP : 0);
  const [search, setSearch] = useState("");
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  // Đã bấm "Tiếp tục" ở bước chi phí: tô đỏ các ô còn thiếu (khoản phí, số tiền, % VAT).
  const [costsTouched, setOthersTouched] = useState(false);
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

  const categories = useMemo(() => options?.categories || [], [options]);
  const categoriesById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  // Loại chi phí có trong danh mục (theo thứ tự quen thuộc), mã phí của loại đang chọn.
  const typeOptions = useMemo(() => {
    const types = [...new Set(categories.map((category) => category.type))];
    return types.sort((a, b) => (TYPE_ORDER.indexOf(a) + 1 || 99) - (TYPE_ORDER.indexOf(b) + 1 || 99));
  }, [categories]);
  const codeOptions = useMemo(() => [...new Set(categories.filter((category) => category.type === costType).map((category) => category.code.toUpperCase()))], [categories, costType]);
  const orderMode = isOrderCode(costCode);
  const suppliers = useMemo(() => new Map((options?.contracts || []).map((item) => [item.code, item.supplier])), [options]);
  // Khoản nhập sẵn có thể chọn của mã phí đang chọn: chưa thuộc đề nghị nào (+ của chính đề nghị đang sửa), nhóm theo hợp đồng.
  const prepared = useMemo(() => {
    const pool = [...ownPrepared, ...(options?.availableCosts || []).filter((cost) => !ownPrepared.some((own) => own.id === cost.id))];
    return pool.filter((cost) => isPrepared(cost) && cost.type === costType && cost.code.toUpperCase() === costCode);
  }, [costCode, costType, options, ownPrepared]);
  const preparedById = useMemo(() => new Map(prepared.map((cost) => [cost.id, cost])), [prepared]);
  const orderGroups = useMemo(() => {
    const groups = new Map<string, PaymentCost[]>();
    for (const cost of prepared) groups.set(cost.contract, [...(groups.get(cost.contract) || []), cost]);
    const term = search.trim().toLowerCase();
    return [...groups.entries()]
      .map(([contract, costs]) => ({ contract, supplier: suppliers.get(contract) || "", costs }))
      .filter((group) => !term || [group.contract, group.supplier, ...group.costs.map((cost) => cost.container), ...group.costs.map((cost) => cost.note)].some((value) => value.toLowerCase().includes(term)))
      .sort((a, b) => b.contract.localeCompare(a.contract));
  }, [prepared, search, suppliers]);
  // Khoản phí nhập tay: thuộc đúng loại + mã đang chọn.
  const manualCategories = useMemo(() => categories.filter((category) => category.type === costType && category.code.toUpperCase() === costCode), [categories, costCode, costType]);

  const selectedCosts = orderMode ? selected.map((id) => preparedById.get(id)).filter((cost): cost is PaymentCost => Boolean(cost)) : [];
  const manualRows = orderMode ? [] : others;
  const isTaxed = (categoryId: string, fallback = false) => categoriesById.get(categoryId)?.taxed ?? fallback;
  // VAT khoản nhập sẵn: % đang gõ, chưa gõ thì % đã lưu; khoản không thuế bỏ qua.
  const preparedTaxed = (cost: PaymentCost) => isTaxed(cost.categoryId, cost.taxed);
  const vatTextOf = (cost: PaymentCost) => (cost.id in vats ? vats[cost.id] : cost.vat ? String(Number(cost.vat)) : "");
  const preparedVat = (cost: PaymentCost) => (preparedTaxed(cost) ? parseVatInput(vatTextOf(cost)) : null);
  const otherAmounts = manualRows.map((row) => parseAmountLoose(row.amount));
  const otherVats = manualRows.map((row) => (isTaxed(row.categoryId) ? parseVatInput(row.vat) : null));
  const otherValid = manualRows.every((row, index) => row.categoryId && otherAmounts[index] !== null && (!isTaxed(row.categoryId) || otherVats[index] !== null));
  const preparedVatValid = selectedCosts.every((cost) => !preparedTaxed(cost) || preparedVat(cost) !== null);
  const total = sumAmounts([...selectedCosts.map((cost) => cost.amount), ...otherAmounts]);
  const costCount = selectedCosts.length + manualRows.length;
  const transfer = paymentMethod === "chuyen_khoan";
  // Có ít nhất một dòng đã điền (dòng chỉ có nhãn "Ngân hàng:" không tính, BE cũng bỏ các dòng đó).
  // Thanh toán tiền hàng cho nhà cung cấp nước ngoài (cọc / còn lại) = chuyển khoản quốc tế: IBAN, SWIFT...
  const internationalTransfer = selectedCosts.some((cost) => goodsPaymentKind({ code: cost.code, name: categoriesById.get(cost.categoryId)?.name || cost.categoryName }) !== null);
  const transferKind: TransferKind = internationalTransfer ? "international" : "domestic";
  const transferFields = TRANSFER_FIELDS[transferKind];
  const missingTransfer = transfer ? transferFields.filter((field) => field.required && !(transferValues[field.label] || "").trim()) : [];
  const recipientValid = missingTransfer.length === 0;
  const money = (value: string | null | undefined) => (currency ? formatMoney(value, currency, language) : formatAmount(value, language));
  const paymentDone = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && Boolean(currency && paymentMethod && recipientValid);
  const complete = [costCount > 0 && otherValid && preparedVatValid, Boolean(content.trim()), paymentDone];

  // Gợi ý người thụ hưởng: chờ ngừng gõ rồi mới gọi BE, huỷ lần gọi cũ để kết quả cũ không đè kết quả mới.
  useEffect(() => {
    const term = accountQuery.trim();
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (term.length < 2) {
        setBeneficiarySuggestions([]);
        return;
      }
      searchPaymentBeneficiaries(term, transferKind, controller.signal)
        .then((rows) => { if (!controller.signal.aborted) setBeneficiarySuggestions(rows); })
        .catch(() => { if (!controller.signal.aborted) setBeneficiarySuggestions([]); });
    }, term.length < 2 ? 0 : BENEFICIARY_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [accountQuery, transferKind]);

  /** "Trước thuế X · VAT 8% Y" cho khoản có % VAT. */
  const vatLineOf = (amount: string | null, vat: string | null) => {
    if (!amount || vat === null) return "";
    const { base, tax } = splitVat(amount, vat, currency);
    return t("prVatLine", { base: money(base), rate: vat, tax: money(tax) });
  };
  /** Khoản nhập tay có thuế: gõ tiền trước thuế thì tổng = trước thuế × (1 + %VAT); làm tròn đồng khi gõ số nguyên. */
  const totalFromBase = (base: string, vat: string) => {
    const baseAmount = parseAmountLoose(base);
    const rate = parseVatInput(vat);
    if (!baseAmount || rate === null) return "";
    return formatAmount(addVat(baseAmount, rate, currency || (baseAmount.includes(".") ? "" : "VND")), "vi");
  };
  const updateVatRow = (row: OtherRow, patch: Partial<OtherRow>) => {
    const next = { ...row, ...patch };
    if (next.basis === "base") next.amount = totalFromBase(next.base, next.vat);
    updateRow(row.key, next);
  };
  const baseValueOf = (row: OtherRow, index: number) => {
    if (row.basis === "base") return row.base;
    const amount = otherAmounts[index];
    const rate = otherVats[index];
    return amount && rate !== null ? formatAmount(splitVat(amount, rate, currency || (amount.includes(".") ? "" : "VND")).base, "vi") : "";
  };
  const taxTotal = sumAmounts([
    ...selectedCosts.map((cost) => { const rate = preparedVat(cost); return rate === null ? "0" : splitVat(cost.amount, rate, currency).tax; }),
    ...manualRows.map((row, index) => { const amount = otherAmounts[index]; const rate = otherVats[index]; return amount && rate !== null ? splitVat(amount, rate, currency).tax : "0"; }),
  ]);
  const hasVat = selectedCosts.some((cost) => preparedVat(cost) !== null) || otherVats.some((rate) => rate !== null);

  /** Xong một câu: mở câu đầu tiên còn thiếu, đủ hết thì sang bước lưu. */
  const advance = () => {
    const next = complete.findIndex((done) => !done);
    const target = next === -1 ? SAVE_STEP : next;
    setActive(target);
    setReached((current) => Math.max(current, target));
  };

  /** Đổi loại / mã phí: một đề nghị chỉ một loại + một mã, nên bỏ các khoản đã chọn của loại / mã cũ. */
  const chooseGroup = (type: string, code: string) => {
    if (type === costType && code === costCode) return;
    if (selected.length || others.length) notify(t("prGroupChanged"), "info");
    setCostType(type);
    setCostCode(code);
    setSelected([]);
    setOthers(isOrderCode(code) || !code ? [] : [emptyRow()]);
    setOthersTouched(false);
    setSearch("");
  };
  const chooseType = (type: string) => {
    const codes = [...new Set(categories.filter((category) => category.type === type).map((category) => category.code.toUpperCase()))];
    chooseGroup(type, codes.length === 1 ? codes[0] : "");
  };

  const updateRow = (key: string, patch: Partial<OtherRow>) => setOthers((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  const toggle = (ids: string[], on: boolean) => setSelected((current) => (on ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.includes(id))));
  const costLabel = (cost: PaymentCost) => categoriesById.get(cost.categoryId)?.name || cost.categoryName || cost.code;
  const typeLabel = (type: string) => (type ? t(`prType_${type}`) : "—");
  const codeLabel = (code: string) => (code === "HD" ? `HD · ${t("prCode_HD")}` : code === "CONT" ? `CONT · ${t("prCode_CONT")}` : code);
  const targetOf = (cost: PaymentCost) => [cost.container && `${t("prContainer")} ${cost.container}`, cost.contract && `${t("prContract")} ${cost.contract}`].filter(Boolean).join(" · ");

  // Các khoản đã chọn dạng dòng hiển thị (dùng cho tóm tắt bước chi phí và bản nháp ở bước lưu).
  const chosenLines = [
    ...selectedCosts.map((cost) => ({ key: cost.id, name: costLabel(cost), note: cost.note, target: targetOf(cost), amount: cost.amount, vatLine: vatLineOf(cost.amount, preparedVat(cost)) })),
    ...manualRows.map((row, index) => ({ key: row.key, name: categoriesById.get(row.categoryId)?.name || "—", note: row.note.trim(), target: "", amount: otherAmounts[index] || "0", vatLine: vatLineOf(otherAmounts[index], otherVats[index]) })),
  ];
  const transferText = transfer ? buildTransferInfo(transferKind, transferValues) : "";
  const choosePaymentMethod = (value: PaymentMethod) => setPaymentMethod(value);
  const updateTransferValue = (field: TransferField, value: string) => {
    setTransferValues((current) => ({ ...current, [field.label]: value }));
    if (field.jsonKey === "so_tai_khoan") setAccountQuery(value);
  };
  /** Chọn một gợi ý: điền mọi trường trừ nội dung thanh toán (nội dung mỗi lần mỗi khác). */
  const applyBeneficiary = (row: PaymentBeneficiarySuggestion) => {
    const values: Record<string, string> = {};
    for (const field of transferFields) {
      const value = field.jsonKey === "noi_dung_thanh_toan" ? "" : row[field.jsonKey];
      if (value) values[field.label] = value;
    }
    setTransferValues((current) => ({ ...current, ...values }));
    setAccountQuery("");
  };

  const save = async () => {
    if (saving || complete.some((done) => !done) || !currency || !paymentMethod) return;
    setSaving(true);
    setError("");
    try {
      const input = {
        content: content.trim(),
        currency,
        paymentMethod,
        transferInfo: transferText,
        dueDate,
        costs: [
          ...selectedCosts.map((cost) => ({ id: cost.id, categoryId: cost.categoryId, amount: cost.amount, container: cost.container, contract: cost.contract, vat: preparedVat(cost) ?? undefined })),
          ...manualRows.map((row, index) => ({ id: row.id, categoryId: row.categoryId, amount: otherAmounts[index] as string, note: row.note.trim(), vat: otherVats[index] ?? undefined })),
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
  const titles = [t("prStepCosts"), t("prStepContent"), t("prStepPayment")];
  /** Hạn thanh toán · loại tiền · hình thức (một dòng). */
  const paymentLine = [dueDate && formatDueDate(dueDate), currency, paymentMethod && t(PAYMENT_METHOD_LABEL_KEYS[paymentMethod])].filter(Boolean).join(" · ");

  const costsSummary = (
    <div>
      <p className="font-medium">{typeLabel(costType)} · {codeLabel(costCode)} · {t("prCostsSummary", { count: costCount, total: money(total) })}</p>
      <ul className="mt-1 divide-y divide-gray-100 dark:divide-gray-800">
        {chosenLines.slice(0, SUMMARY_LIMIT).map((line) => <CostLine key={line.key} name={line.name} note={line.note} target={line.target} amount={money(line.amount)} vatLine={line.vatLine} />)}
      </ul>
      {chosenLines.length > SUMMARY_LIMIT && <p className="text-xs text-gray-500">{t("prMoreCosts", { count: chosenLines.length - SUMMARY_LIMIT })}</p>}
    </div>
  );

  return (
    <div className="space-y-3">
      {optionsError && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-error-50 px-4 py-3 text-sm text-error-700 dark:bg-error-500/10 dark:text-error-300">
          <span className="min-w-0 break-words">{optionsError}</span>
          <button type="button" onClick={() => setOptionsKey((key) => key + 1)} className="font-semibold underline">{t("prRetry")}</button>
        </div>
      )}

      {/* 1. Chi phí: chọn loại chi phí → mã phí → tick khoản nhập sẵn / nhập khoản vận hành */}
      <StepCard index={0} title={titles[0]} state={stepState(0)} onChange={() => setActive(0)} summary={costsSummary}>
        {options && categories.length === 0 && (
          <p className="mb-3 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700 dark:bg-warning-500/10 dark:text-warning-300">{t("prNoCategories")}</p>
        )}
        {!options && !optionsError && <div className="h-16 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />}

        {options && categories.length > 0 && (
          <>
            <p className="text-xs text-gray-500">{t("prOneGroupHint")}</p>
            <p className="mt-2 text-sm font-semibold text-gray-700 dark:text-gray-200">{t("prCostTypeLabel")}</p>
            <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label={t("prCostTypeLabel")}>
              {typeOptions.map((type) => (
                <button key={type} type="button" role="radio" aria-checked={costType === type} onClick={() => chooseType(type)} className={`${CHIP} ${costType === type ? CHIP_ON : CHIP_OFF}`}>{typeLabel(type)}</button>
              ))}
            </div>

            {costType && (
              <>
                <p className="mt-3 text-sm font-semibold text-gray-700 dark:text-gray-200">{t("prCostCodeLabel")}</p>
                <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label={t("prCostCodeLabel")}>
                  {codeOptions.map((code) => (
                    <button key={code} type="button" role="radio" aria-checked={costCode === code} onClick={() => chooseGroup(costType, code)} className={`${CHIP} ${costCode === code ? CHIP_ON : CHIP_OFF}`}>{codeLabel(code)}</button>
                  ))}
                </div>
              </>
            )}

            {/* Mã chi phí đơn hàng: tick khoản nhập sẵn */}
            {costCode && orderMode && (
              <div className="mt-4">
                <p className="text-xs text-gray-500">{t("prOrderCostsHint")}</p>
                {prepared.length === 0 ? (
                  <p className="mt-2 rounded-lg border border-dashed border-gray-200 px-3 py-3 text-sm text-gray-500 dark:border-gray-700">{t("prNoPreparedForCode")}</p>
                ) : (
                  <>
                    <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("prSearchOrder")} aria-label={t("prSearchOrder")} className={`mt-2 ${INPUT}`} />
                    {/* Nhiều khoản có thuế đã tick: áp một mức VAT cho tất cả */}
                    {selectedCosts.filter(preparedTaxed).length > 1 && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-brand-50/60 px-3 py-2 text-xs text-gray-700 dark:bg-brand-500/10 dark:text-gray-200">
                        <span className="font-semibold">{t("prVatApplyAll")}</span>
                        {VAT_PRESETS.map((preset) => (
                          <button key={preset} type="button" className="h-8 rounded-full border border-gray-200 bg-white px-2.5 font-medium hover:border-brand-300 dark:border-gray-700 dark:bg-gray-900"
                            onClick={() => setVats((current) => ({ ...current, ...Object.fromEntries(selectedCosts.filter(preparedTaxed).map((cost) => [cost.id, preset])) }))}>
                            {preset}%
                          </button>
                        ))}
                      </div>
                    )}
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
                                      {costs.map((cost) => {
                                        const checked = selected.includes(cost.id);
                                        const taxed = preparedTaxed(cost);
                                        const rate = preparedVat(cost);
                                        return (
                                          <li key={cost.id} className={checked && taxed ? "rounded-lg bg-gray-50 pb-2 dark:bg-gray-800/50" : ""}>
                                            <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-1 py-1 hover:bg-gray-50 dark:hover:bg-gray-800">
                                              <input type="checkbox" className="h-4 w-4 shrink-0" checked={checked} onChange={(event) => toggle([cost.id], event.target.checked)} />
                                              <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm text-gray-700 dark:text-gray-200" title={costLabel(cost)}>{costLabel(cost)}</span>
                                                {cost.note && <span className="block truncate text-xs text-gray-500" title={cost.note}>{cost.note}</span>}
                                              </span>
                                              <span className="shrink-0 text-right">
                                                <span className="block text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{money(cost.amount)}</span>
                                                {taxed && <span className="block text-[11px] text-gray-400">{t("prVatIncluded")}</span>}
                                              </span>
                                            </label>
                                            {/* Khoản có thuế đã tick: nhập % VAT, tự tách tiền trước thuế / VAT */}
                                            {checked && taxed && (
                                              <div className="ml-8 mr-1 flex flex-col gap-1">
                                                <span className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                                                  <span className="font-semibold">VAT</span>
                                                  <VatInput value={vatTextOf(cost)} label={`${t("prVatRate")} ${costLabel(cost)}`} invalid={rate === null && costsTouched}
                                                    onChange={(value) => setVats((current) => ({ ...current, [cost.id]: value }))} />
                                                </span>
                                                {rate !== null
                                                  ? <span className="text-xs text-gray-500">{vatLineOf(cost.amount, rate)}</span>
                                                  : <span className="text-xs text-warning-700 dark:text-warning-300">{t("prVatRequired")}</span>}
                                              </div>
                                            )}
                                          </li>
                                        );
                                      })}
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
              </div>
            )}

            {/* Mã khác (chi phí vận hành...): nhập khoản phí + số tiền + nội dung */}
            {costCode && !orderMode && (
              <div className="mt-4">
                <p className="text-xs text-gray-500">{t("prOtherHint")}</p>
                {others.length > 0 && (
                  <ul className="mt-2 space-y-2">
                    {others.map((row, index) => {
                      const category = categoriesById.get(row.categoryId);
                      const taxed = Boolean(category?.taxed);
                      const amountInvalid = costsTouched && otherAmounts[index] === null;
                      const vatInvalid = costsTouched && taxed && otherVats[index] === null;
                      const label = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400";
                      return (
                        <li key={row.key} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                          {/* Một hàng: Khoản phí | Số tiền | Nội dung (màn hẹp xếp dọc) */}
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.3fr)_9.5rem_minmax(0,1fr)_auto] sm:items-end">
                            <label className="min-w-0">
                              <span className={label}>{t("pcFeeLabel")}</span>
                              <select value={row.categoryId} onChange={(event) => updateVatRow(row, { categoryId: event.target.value })}
                                className={`${INPUT} ${costsTouched && !row.categoryId ? "border-error-400" : ""}`}>
                                <option value="">{t("prSelectCategory")}</option>
                                {manualCategories.map((item: PaymentCategory) => <option key={item.id} value={item.id}>{item.name}{item.flow === "do" ? " ⚠" : ""}</option>)}
                              </select>
                            </label>
                            <label className="min-w-0">
                              <span className={label}>{taxed ? t("prVatTotal") : t("pcAmountLabel")}</span>
                              <input inputMode="decimal" value={row.amount} placeholder={taxed ? "1.080.000" : "1.250.000"}
                                onChange={(event) => updateRow(row.key, { amount: event.target.value, basis: "amount" })}
                                className={`${INPUT} text-right font-semibold tabular-nums ${amountInvalid ? "border-error-400" : ""}`} />
                            </label>
                            <label className="min-w-0">
                              <span className={label}>{t("pcNoteLabel")}</span>
                              <input value={row.note} maxLength={500} placeholder={t("prCostNotePlaceholder")}
                                onChange={(event) => updateRow(row.key, { note: event.target.value })} className={INPUT} />
                            </label>
                            <span className="flex items-center justify-end gap-1">
                              {category && <PaymentFlowBadge flow={category.flow} />}
                              <button type="button" onClick={() => setOthers((current) => current.filter((item) => item.key !== row.key))} aria-label={t("prRemoveCost")} title={t("prRemoveCost")}
                                className="flex h-11 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-error-50 hover:text-error-600 dark:hover:bg-error-500/10">✕</button>
                            </span>
                          </div>
                          {/* Có thuế: % VAT + tiền trước thuế (gõ trước thuế thì tự ra số tiền gồm VAT, gõ số tiền thì tự tách thuế) */}
                          {taxed && (
                            <div className="mt-2 flex flex-col gap-2 rounded-lg bg-gray-50 px-2.5 py-2 sm:flex-row sm:flex-wrap sm:items-center dark:bg-gray-800/50">
                              <span className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                                <span className="font-semibold">VAT</span>
                                <VatInput value={row.vat} label={t("prVatRate")} invalid={vatInvalid} onChange={(value) => updateVatRow(row, { vat: value })} />
                              </span>
                              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                                <span className="shrink-0 font-semibold">{t("prVatBase")}</span>
                                <input inputMode="decimal" value={baseValueOf(row, index)} placeholder="1.000.000"
                                  onChange={(event) => updateVatRow(row, { base: event.target.value, basis: "base" })}
                                  className="h-9 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-2.5 text-right text-sm tabular-nums text-gray-800 outline-none focus:border-brand-400 sm:w-36 dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                              </label>
                              <span className="text-xs text-gray-500">
                                {otherAmounts[index] && otherVats[index] !== null ? vatLineOf(otherAmounts[index], otherVats[index]) : t("prVatHint")}
                              </span>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                <button type="button" className={`${SECONDARY} mt-2 w-full sm:w-auto`} disabled={costCount >= MAX_COSTS || manualCategories.length === 0}
                  onClick={() => setOthers((current) => [...current, emptyRow()])}>+ {t("prAddOtherCost")}</button>
              </div>
            )}
          </>
        )}

        <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
          <p className="text-sm text-gray-600 dark:text-gray-300">{t("prSelectedCount", { count: costCount, total: money(total) })}</p>
          <button type="button" className={PRIMARY} disabled={costCount === 0}
            onClick={() => { setOthersTouched(true); if (complete[0]) advance(); }}>{t("prContinue")}</button>
        </div>
      </StepCard>

      {/* 2. Nội dung */}
      {reached >= 1 && (
        <StepCard index={1} title={titles[1]} state={stepState(1)} onChange={() => setActive(1)}
          summary={<p className="whitespace-pre-line">{content}</p>}>
          <textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={2000} rows={3} autoFocus placeholder={t("prContentPlaceholder")}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
          <div className="mt-3 flex justify-end">
            <button type="button" className={`${PRIMARY} w-full sm:w-auto`} disabled={!content.trim()} onClick={() => advance()}>{t("prContinue")}</button>
          </div>
        </StepCard>
      )}

      {/* 3. Thanh toán: hạn thanh toán + loại tiền + hình thức (+ thông tin chuyển khoản nếu chuyển khoản) */}
      {reached >= 2 && (
        <StepCard index={2} title={titles[2]} state={stepState(2)} onChange={() => setActive(2)}
          summary={(
            <div>
              <p className="font-medium">{paymentLine}</p>
              {transferText && <p className="whitespace-pre-line text-gray-600 dark:text-gray-300">{transferText}</p>}
            </div>
          )}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)_minmax(0,1.1fr)]">
            <div className="min-w-0">
              <p className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">{t("prDueDate")}</p>
              <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label={t("prDueDate")} className={INPUT} />
              <div className="mt-2 flex flex-nowrap gap-1.5 overflow-x-auto pb-0.5">
                {([["prQuickToday", vnDate()], ["prQuick3", vnDate(3)]] as const).map(([key, value]) => (
                  <button key={key} type="button" onClick={() => setDueDate(value)} className={`h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-medium ${dueDate === value ? CHIP_ON : CHIP_OFF}`}>
                    {t(key)} · {formatDueDate(value).slice(0, 5)}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-w-0">
              <p className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">{t("prCurrency")}</p>
              <div className="grid grid-cols-2 gap-2">
                {(["VND", "USD"] as const).map((value) => (
                  <button key={value} type="button" aria-pressed={currency === value} onClick={() => setCurrency(value)}
                    className={`h-11 rounded-xl border-2 text-base font-bold transition-colors ${currency === value ? CHIP_ON : CHIP_OFF}`}>
                    {value}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-w-0">
              <p className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">{t("prPaymentMethod")}</p>
              <div className="grid grid-cols-2 gap-2">
                {PAYMENT_METHODS.map((value) => (
                  <button key={value} type="button" aria-pressed={paymentMethod === value} onClick={() => choosePaymentMethod(value)}
                    className={`flex h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border-2 px-2 text-sm font-semibold transition-colors ${paymentMethod === value ? CHIP_ON : CHIP_OFF}`}>
                    <span aria-hidden="true">{value === "tien_mat" ? "💵" : "🏦"}</span>{t(PAYMENT_METHOD_LABEL_KEYS[value])}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {/* Chuyển khoản: thông tin người thụ hưởng theo từng trường (trong nước / quốc tế), dấu * là bắt buộc */}
          {transfer && (
            <div className="mt-4 rounded-xl border border-gray-200 p-3 sm:p-4 dark:border-gray-700">
              <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
                {t("prTransferInfo")} · <span className="font-normal text-gray-500">{t(internationalTransfer ? "prTransferKindIntl" : "prTransferKindDomestic")}</span>
              </p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {transferFields.map((field) => {
                  const value = transferValues[field.label] || "";
                  const id = `transfer-${field.key}`;
                  // Các ô đều autoComplete="off": trình duyệt không gợi ý lại giá trị cũ (nhất là Nội dung thanh toán, mỗi đề nghị mỗi khác).
                  const className = "w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white";
                  return (
                    <label key={field.label} htmlFor={id} className={`min-w-0 ${field.multiline ? "sm:col-span-2" : ""}`}>
                      <span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-300">{t(field.key)}{field.required && <span className="text-error-500"> *</span>}</span>
                      {field.multiline ? (
                        <textarea id={id} value={value} rows={2} maxLength={300} placeholder={t("prTfOptional")}
                          autoComplete="off"
                          onChange={(event) => updateTransferValue(field, event.target.value)}
                          className={`${className} py-2`} />
                      ) : (
                        <input id={id} value={value} maxLength={300} placeholder={field.required ? "" : t("prTfOptional")}
                          autoComplete="off"
                          onChange={(event) => updateTransferValue(field, event.target.value)}
                          onBlur={field.jsonKey === "so_tai_khoan" ? () => setAccountQuery("") : undefined}
                          onKeyDown={field.jsonKey === "so_tai_khoan" ? (event) => { if (event.key === "Escape") setAccountQuery(""); } : undefined}
                          className={`${className} h-11`} />
                      )}
                      {field.jsonKey === "so_tai_khoan" && accountQuery.trim().length >= 2 && beneficiarySuggestions.length > 0 && (
                        <div className="relative z-10">
                          <div className="absolute left-0 right-0 top-1 max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
                            {beneficiarySuggestions.map((row, index) => (
                              <button key={`${row.so_tai_khoan}-${index}`} type="button" onMouseDown={(event) => { event.preventDefault(); applyBeneficiary(row); }}
                                className="block w-full min-w-0 break-words rounded-md px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800">
                                <span className="font-semibold text-gray-800 dark:text-white/90">{row.so_tai_khoan}</span>{row.ten_nguoi_thu_huong && <span className="ml-2 text-gray-500">{row.ten_nguoi_thu_huong}</span>}{row.ten_ngan_hang && <span className="ml-2 text-gray-500">· {row.ten_ngan_hang}</span>}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </label>
                  );
                })}
              </div>
              {missingTransfer.length > 0 && (
                <p className="mt-2 text-xs text-warning-700 dark:text-warning-300">{t("prTfMissing", { fields: missingTransfer.map((field) => t(field.key)).join(", ") })}</p>
              )}
            </div>
          )}
          <div className="mt-4 flex justify-end">
            <button type="button" className={`${PRIMARY} w-full sm:w-auto`} disabled={!complete[2]} onClick={() => advance()}>{t("prContinue")}</button>
          </div>
        </StepCard>
      )}

      {/* Kiểm tra và lưu: hiện đầy đủ như bản nháp đề nghị */}
      {reached >= SAVE_STEP && active === SAVE_STEP && (
        <section className="rounded-2xl border border-brand-300 bg-white p-4 shadow-theme-xs dark:border-brand-500/40 dark:bg-white/[0.03] sm:p-5">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t("prStepSave")}</h2>
          <div className="mt-3 rounded-xl border border-dashed border-gray-300 p-3 sm:p-4 dark:border-gray-700">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t("prDraftPreview")}</p>
            <p className="mt-1 whitespace-pre-line break-words text-sm font-medium text-gray-900 dark:text-white">{content}</p>
            <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-gray-500">{t("prCostTypeLabel")} / {t("prCostCodeLabel")}</dt><dd className="font-medium text-gray-800 dark:text-white/90">{typeLabel(costType)} · {codeLabel(costCode)}</dd></div>
              <div><dt className="text-xs text-gray-500">{t("prPaymentLineLabel")}</dt><dd className="font-medium text-gray-800 dark:text-white/90">{paymentLine || "—"}</dd></div>
              {transfer && <div className="sm:col-span-2"><dt className="text-xs text-gray-500">{t("prTransferInfo")}</dt><dd className="whitespace-pre-line break-words font-medium text-gray-800 dark:text-white/90">{transferText}</dd></div>}
            </dl>
            <ul className="mt-3 divide-y divide-gray-100 border-y border-gray-100 dark:divide-gray-800 dark:border-gray-800">
              {chosenLines.map((line) => <CostLine key={line.key} name={line.name} note={line.note} target={line.target} amount={money(line.amount)} vatLine={line.vatLine} />)}
            </ul>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-sm text-gray-600 dark:text-gray-300">{t("prTotal")} · {t("prCostCount", { count: costCount })}</span>
              <span className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{money(total)}</span>
            </div>
            {hasVat && <p className="text-right text-xs text-gray-500">{t("prVatTotalLine", { tax: money(taxTotal) })}</p>}
          </div>
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
