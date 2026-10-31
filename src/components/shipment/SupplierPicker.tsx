"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";
import type { SupplierRecord } from "@/types/postgresShipment";

// Ô chọn nhà cung cấp khi tạo đơn (danh mục dài): gõ để lọc theo tên hoặc quốc gia, không phân biệt dấu. Chỉ nhận nhà
// cung cấp chọn trong danh sách; gõ dở rồi rời ô thì trả lại tên đã chọn (khớp đúng một tên thì tự chọn tên đó).

function supplierSearchKey(value: unknown): string {
  return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

interface Props {
  id: string;
  suppliers: SupplierRecord[];
  /** id_ncc đã chọn ("" = chưa chọn). */
  selectedId: string;
  /** Tên OCR đọc được nhưng chưa khớp danh mục: hiện gợi ý dưới ô. */
  unmatchedText?: string;
  disabled?: boolean;
  onSelect: (supplier: SupplierRecord) => void;
}

const MAX_RESULTS = 100;

export default function SupplierPicker({ id, suppliers, selectedId, unmatchedText = "", disabled = false, onSelect }: Props) {
  const { t } = useLanguage();
  const listRef = useRef<HTMLUListElement>(null);
  const selected = suppliers.find((supplier) => supplier.id_ncc === selectedId) || null;
  const selectedName = selected?.ten_ncc || "";
  const [text, setText] = useState(selectedName);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  // Chọn từ ngoài (OCR khớp, đổi chế độ...): ô hiện đúng tên đã chọn.
  useEffect(() => { setText(selectedName); }, [selectedName]);

  // Chưa gõ gì khác tên đang chọn: hiện cả danh sách; đang gõ: lọc theo chữ gõ.
  const query = text === selectedName ? "" : supplierSearchKey(text);
  const matches = useMemo(() => (query
    ? suppliers.filter((supplier) => supplierSearchKey(supplier.ten_ncc).includes(query) || supplierSearchKey(supplier.quoc_gia).includes(query))
    : suppliers), [query, suppliers]);
  const results = matches.slice(0, MAX_RESULTS);

  const choose = (supplier: SupplierRecord) => {
    onSelect(supplier);
    setText(supplier.ten_ncc);
    setOpen(false);
  };

  const handleBlur = () => {
    setOpen(false);
    const key = supplierSearchKey(text);
    const exact = key ? suppliers.filter((supplier) => supplierSearchKey(supplier.ten_ncc) === key) : [];
    if (exact.length === 1) choose(exact[0]);
    else setText(selectedName);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      setText(selectedName);
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
      <input id={id} value={text} autoComplete="off" role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-invalid={!selected} disabled={disabled} placeholder={t("supplierSearchPlaceholder")}
        onFocus={(event) => { event.target.select(); setOpen(true); setHighlight(0); }}
        onBlur={handleBlur}
        onChange={(event) => { setText(event.target.value); setOpen(true); setHighlight(0); }}
        onKeyDown={onKeyDown}
        className="min-h-10 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 pr-9 text-sm text-gray-800 outline-none focus:border-brand-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
      <span className="pointer-events-none absolute right-3 top-5 -translate-y-1/2 text-xs text-gray-400" aria-hidden="true">▾</span>
      {!selected && unmatchedText && <span className="mt-1 block break-words text-xs font-normal text-warning-700 dark:text-warning-400">{t("ocrNotMatched", { value: unmatchedText })}</span>}
      {open && (
        <ul id={`${id}-list`} ref={listRef} role="listbox"
          className="absolute left-0 right-0 top-11 z-30 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg custom-scrollbar dark:border-gray-700 dark:bg-gray-900">
          {results.length === 0 && <li className="px-3 py-2 text-sm font-normal text-gray-500">{t("supplierNoResult")}</li>}
          {results.map((supplier, index) => (
            <li key={supplier.id_ncc} role="option" aria-selected={supplier.id_ncc === selectedId}
              onMouseDown={(event) => { event.preventDefault(); choose(supplier); }}
              onMouseEnter={() => setHighlight(index)}
              className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm ${index === highlight ? "bg-gray-100 dark:bg-gray-800" : ""} ${supplier.id_ncc === selectedId ? "font-semibold text-brand-700 dark:text-brand-300" : "font-normal text-gray-800 dark:text-white/90"}`}>
              <span className="min-w-0 flex-1 truncate" title={supplier.ten_ncc}>{supplier.ten_ncc}</span>
              {supplier.quoc_gia && <span className="max-w-[40%] shrink-0 truncate text-xs font-normal text-gray-500">{supplier.quoc_gia}</span>}
            </li>
          ))}
          {matches.length > results.length && (
            <li className="px-3 py-2 text-xs font-normal text-gray-500">{t("supplierMoreResults", { count: matches.length - results.length })}</li>
          )}
        </ul>
      )}
    </div>
  );
}
