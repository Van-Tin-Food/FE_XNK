"use client";

import React, { useMemo, useRef, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { bankLabel, type PaymentBank } from "@/services/paymentRequestApi";

// Ô chọn ngân hàng người thụ hưởng (chuyển khoản trong nước): gõ để lọc theo mã (VCB), tên ngắn (Vietcombank) hoặc tên
// đầy đủ, không phân biệt dấu; chọn trong danh sách thì lưu cả tên lẫn mã BIN (để tạo mã VietQR). Gõ tự do mà không chọn
// thì mã BIN trống (form báo phải chọn trong danh sách).

/** Bỏ dấu + chữ thường + chỉ chữ / số, để so khớp tên ngân hàng. */
export function bankSearchKey(value: string): string {
  return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Ngân hàng khớp chắc chắn với tên đã lưu (đề nghị cũ / gợi ý người thụ hưởng chưa có mã BIN): tên trùng đúng mã, tên ngắn,
 * tên đầy đủ hoặc "tên ngắn - tên đầy đủ". Không chắc (không khớp / khớp nhiều ngân hàng) thì null — không đoán.
 */
export function matchBank(banks: PaymentBank[], text: string): PaymentBank | null {
  const key = bankSearchKey(text);
  if (!key) return null;
  const found = banks.filter((bank) => [bank.code, bank.shortName, bank.name, bankLabel(bank)].some((value) => bankSearchKey(value) === key));
  return found.length === 1 ? found[0] : null;
}

interface Props {
  id: string;
  banks: PaymentBank[];
  /** Chữ đang hiện trong ô (tên ngân hàng). */
  value: string;
  /** Mã BIN đã chọn ("" = chưa chọn trong danh sách). */
  bin: string;
  invalid?: boolean;
  onChange: (next: { text: string; bin: string }) => void;
}

const MAX_RESULTS = 80;

export default function BankPicker({ id, banks, value, bin, invalid = false, onChange }: Props) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const selected = banks.find((bank) => bank.bin === bin) || null;
  // Đã chọn mà chưa gõ lại: hiện cả danh sách; đang gõ: lọc theo chữ gõ.
  const query = selected && value === bankLabel(selected) ? "" : bankSearchKey(value);
  const results = useMemo(() => {
    if (!query) return banks.slice(0, MAX_RESULTS);
    return banks.filter((bank) => [bank.code, bank.shortName, bank.name].some((field) => bankSearchKey(field).includes(query))).slice(0, MAX_RESULTS);
  }, [banks, query]);

  const choose = (bank: PaymentBank) => {
    onChange({ text: bankLabel(bank), bin: bank.bin });
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") return setOpen(false);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const next = Math.max(0, Math.min(results.length - 1, highlight + (event.key === "ArrowDown" ? 1 : -1)));
      setHighlight(next);
      listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (event.key === "Enter" && open && results[highlight]) {
      event.preventDefault();
      choose(results[highlight]);
    }
  };

  return (
    <div className="relative">
      <input id={id} value={value} autoComplete="off" role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-invalid={invalid} placeholder={t("prBankSearch")}
        onFocus={() => { setOpen(true); setHighlight(0); }}
        onBlur={() => setOpen(false)}
        onChange={(event) => { onChange({ text: event.target.value, bin: "" }); setOpen(true); setHighlight(0); }}
        onKeyDown={onKeyDown}
        className={`h-11 w-full rounded-lg border bg-white px-3 pr-9 text-sm text-gray-800 outline-none focus:border-brand-400 dark:bg-gray-900 dark:text-white ${invalid ? "border-error-400" : "border-gray-200 dark:border-gray-700"}`} />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400" aria-hidden="true">▾</span>
      {selected && <span className="mt-1 block text-xs text-success-700 dark:text-success-300">✓ {selected.code} · {t("prBankBin")} {selected.bin}</span>}
      {open && (
        <ul id={`${id}-list`} ref={listRef} role="listbox"
          className="absolute left-0 right-0 top-12 z-20 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg custom-scrollbar dark:border-gray-700 dark:bg-gray-900">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-gray-500">{t("prBankNoResult")}</li>}
          {results.map((bank, index) => (
            <li key={bank.bin} role="option" aria-selected={bank.bin === bin}
              onMouseDown={(event) => { event.preventDefault(); choose(bank); }}
              onMouseEnter={() => setHighlight(index)}
              className={`flex cursor-pointer items-baseline gap-2 rounded-md px-3 py-2 text-sm ${index === highlight ? "bg-gray-100 dark:bg-gray-800" : ""} ${bank.bin === bin ? "font-semibold text-brand-700 dark:text-brand-300" : "text-gray-800 dark:text-white/90"}`}>
              <span className="w-14 shrink-0 font-mono text-xs text-gray-500">{bank.code}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{bank.shortName}</span>
                {bank.name !== bank.shortName && <span className="block truncate text-xs font-normal text-gray-500">{bank.name}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
