"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import type { PaymentCategory } from "@/services/paymentRequestApi";

// Ô chọn danh mục chi phí có cùng hành vi với ô chọn nhà cung cấp lúc tạo đơn:
// gõ để lọc, phím mũi tên/Enter để chọn và chỉ nhận mục trong danh sách.
const MAX_RESULTS = 100;

/** Chuỗi so khớp khi gõ để lọc: bỏ dấu, đ → d, chữ thường, chỉ chữ + số. */
export function searchKey(value: unknown): string {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function categoryLabel(category: PaymentCategory): string {
  // Mã phí (CONT, HD, BH...) chỉ phục vụ quy tắc xử lý nội bộ; người dùng chọn theo
  // tên danh mục và số tài khoản hạch toán để tránh danh sách bị rối.
  return [category.account, category.name].filter(Boolean).join(" · ") || category.name;
}

interface Props {
  id: string;
  categories: PaymentCategory[];
  selectedId: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  onSelect: (category: PaymentCategory) => void;
}

export default function PaymentCategoryPicker({ id, categories, selectedId, invalid = false, disabled = false, className = "", onSelect }: Props) {
  const { t } = useLanguage();
  const listRef = useRef<HTMLUListElement>(null);
  const selected = categories.find((category) => category.id === selectedId) || null;
  const selectedLabel = selected ? categoryLabel(selected) : "";
  const [text, setText] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => { setText(selectedLabel); }, [selectedLabel]);

  const query = text === selectedLabel ? "" : searchKey(text);
  const matches = useMemo(() => (query
    ? categories.filter((category) => searchKey([category.name, category.code, category.account].filter(Boolean).join(" ")).includes(query))
    : categories), [categories, query]);
  const results = matches.slice(0, MAX_RESULTS);

  const choose = (category: PaymentCategory) => {
    onSelect(category);
    setText(categoryLabel(category));
    setOpen(false);
  };

  const handleBlur = () => {
    setOpen(false);
    const key = searchKey(text);
    const exact = key ? categories.filter((category) => searchKey(categoryLabel(category)) === key) : [];
    if (exact.length === 1) choose(exact[0]);
    else setText(selectedLabel);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      setText(selectedLabel);
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
        aria-invalid={invalid} disabled={disabled} placeholder={t("prSelectCategory")}
        onFocus={(event) => { event.target.select(); setOpen(true); setHighlight(0); }}
        onBlur={handleBlur}
        onChange={(event) => { setText(event.target.value); setOpen(true); setHighlight(0); }}
        onKeyDown={onKeyDown}
        className={`${className} pr-9`} />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400" aria-hidden="true">▾</span>
      {open && (
        <ul id={`${id}-list`} ref={listRef} role="listbox" className="absolute left-0 right-0 top-12 z-30 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg custom-scrollbar dark:border-gray-700 dark:bg-gray-900">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-gray-500">{t("noData")}</li>}
          {results.map((category, index) => (
            <li key={category.id} role="option" aria-selected={category.id === selectedId}
              onMouseDown={(event) => { event.preventDefault(); choose(category); }}
              onMouseEnter={() => setHighlight(index)}
              className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm ${index === highlight ? "bg-gray-100 dark:bg-gray-800" : ""} ${category.id === selectedId ? "font-semibold text-brand-700 dark:text-brand-300" : "font-normal text-gray-800 dark:text-white/90"}`}>
              <span className="min-w-0 flex-1 truncate" title={categoryLabel(category)}>{categoryLabel(category)}</span>
              {category.flow === "do" && <span className="shrink-0 text-xs font-normal text-warning-600" title={t("pcatFlow_do")}>⚠</span>}
            </li>
          ))}
          {matches.length > results.length && <li className="px-3 py-2 text-xs text-gray-500">+{matches.length - results.length}</li>}
        </ul>
      )}
    </div>
  );
}
