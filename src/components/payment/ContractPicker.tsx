"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { searchKey } from "./PaymentCategoryPicker";
import { formatDueDate } from "./PaymentRequestParts";

// Ô chọn hợp đồng (form đề nghị — "Nhập khoản mới" mã HD / CONT): cùng giao diện + hành vi với ô chọn khoản phí
// (PaymentCategoryPicker), thay datalist của trình duyệt (khung gợi ý do trình duyệt / hệ điều hành vẽ, không theo màu app).
// Gõ để lọc theo mã hợp đồng / nhà cung cấp (không dấu cũng được), mũi tên + Enter để chọn, chỉ nhận hợp đồng trong danh sách.
const MAX_RESULTS = 100;

export interface ContractOption {
  code: string;
  /** YYYY-MM-DD. */
  date: string;
  supplier: string;
}

interface Props {
  id: string;
  contracts: ContractOption[];
  /** Mã hợp đồng đang chọn ("" = chưa chọn). */
  value: string;
  placeholder: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  /** "" = xoá chọn (người dùng xoá trắng ô). */
  onSelect: (code: string) => void;
}

export default function ContractPicker({ id, contracts, value, placeholder, invalid = false, disabled = false, className = "", onSelect }: Props) {
  const { t } = useLanguage();
  const listRef = useRef<HTMLUListElement>(null);
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => { setText(value); }, [value]);

  const query = text === value ? "" : searchKey(text);
  const matches = useMemo(() => (query
    ? contracts.filter((contract) => searchKey(`${contract.code} ${contract.supplier}`).includes(query))
    : contracts), [contracts, query]);
  const results = matches.slice(0, MAX_RESULTS);

  const choose = (contract: ContractOption) => {
    onSelect(contract.code);
    setText(contract.code);
    setOpen(false);
  };

  // Rời ô: gõ đúng một mã hợp đồng thì chọn luôn; xoá trắng thì bỏ chọn; còn lại trả về hợp đồng đang chọn.
  const handleBlur = () => {
    setOpen(false);
    const key = searchKey(text);
    if (!key) {
      if (value) onSelect("");
      setText("");
      return;
    }
    const exact = contracts.filter((contract) => searchKey(contract.code) === key);
    if (exact.length === 1) choose(exact[0]);
    else setText(value);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      setText(value);
      return;
    }
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
    <div className="relative min-w-0">
      <input id={id} type="search" value={text} autoComplete="off" role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-invalid={invalid} disabled={disabled} placeholder={placeholder}
        onFocus={(event) => { event.target.select(); setOpen(true); setHighlight(0); }}
        onBlur={handleBlur}
        onChange={(event) => { setText(event.target.value); setOpen(true); setHighlight(0); }}
        onKeyDown={onKeyDown}
        className={`${className} pr-9`} />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400" aria-hidden="true">▾</span>
      {open && (
        <ul id={`${id}-list`} ref={listRef} role="listbox" className="absolute left-0 right-0 top-12 z-30 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg custom-scrollbar dark:border-gray-700 dark:bg-gray-900">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-gray-500">{t("noData")}</li>}
          {results.map((contract, index) => (
            <li key={contract.code} role="option" aria-selected={contract.code === value}
              onMouseDown={(event) => { event.preventDefault(); choose(contract); }}
              onMouseEnter={() => setHighlight(index)}
              className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm ${index === highlight ? "bg-gray-100 dark:bg-gray-800" : ""} ${contract.code === value ? "font-semibold text-brand-700 dark:text-brand-300" : "font-normal text-gray-800 dark:text-white/90"}`}>
              <span className="shrink-0 font-mono">{contract.code}</span>
              <span className="min-w-0 flex-1 truncate text-gray-500 dark:text-gray-400" title={contract.supplier}>{contract.supplier}</span>
              {contract.date && <span className="shrink-0 text-xs text-gray-400">{formatDueDate(contract.date)}</span>}
            </li>
          ))}
          {matches.length > results.length && <li className="px-3 py-2 text-xs text-gray-500">+{matches.length - results.length}</li>}
        </ul>
      )}
    </div>
  );
}
