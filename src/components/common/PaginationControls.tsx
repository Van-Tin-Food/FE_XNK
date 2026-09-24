"use client";

import React from "react";
import { useLanguage } from "@/context/LanguageContext";

interface PaginationControlsProps {
  page: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  from: number;
  to: number;
  summaryKey?: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export default function PaginationControls({
  page,
  totalPages,
  pageSize,
  totalItems,
  from,
  to,
  summaryKey = "showingShipments",
  onPageChange,
  onPageSizeChange,
}: PaginationControlsProps) {
  const { t } = useLanguage();
  const pages: (number | "...")[] = [];
  if (totalPages <= 7) {
    for (let number = 1; number <= totalPages; number += 1) pages.push(number);
  } else {
    pages.push(1);
    if (page > 3) pages.push("...");
    for (let number = Math.max(2, page - 1); number <= Math.min(totalPages - 1, page + 1); number += 1) pages.push(number);
    if (page < totalPages - 2) pages.push("...");
    pages.push(totalPages);
  }

  const handlePageSizeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextSize = Number(event.target.value);
    if (Number.isFinite(nextSize) && nextSize > 0) onPageSizeChange(Math.min(200, Math.max(1, Math.trunc(nextSize))));
  };

  return (
    <div className="flex flex-col gap-3 border-t border-gray-100 px-4 py-3 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <p className="text-xs text-gray-400">{t(summaryKey, { from, to, total: totalItems })}</p>
      <div className="flex max-w-full flex-wrap items-center justify-end gap-2 overflow-x-auto pb-1 sm:pb-0">
        <label htmlFor="pagination-page-size" className="text-xs text-gray-500 dark:text-gray-400">{t("shipmentsPerPage")}</label>
        <input
          id="pagination-page-size"
          type="number"
          min={1}
          max={200}
          step={1}
          value={pageSize}
          onChange={handlePageSizeChange}
          className="h-8 w-16 rounded-lg border border-gray-200 bg-white px-2 text-center text-xs text-gray-700 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
        />
        {totalPages > 1 && <>
          <button type="button" aria-label={t("previousPage")} onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1} className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition-all hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-brand-500/50 dark:hover:bg-brand-500/10">
            <span aria-hidden="true">&#8249;</span>
          </button>
          {pages.map((number, index) => number === "..."
            ? <span key={`dots-${index}`} className="flex h-8 w-8 items-center justify-center text-xs text-gray-400">...</span>
            : <button key={number} type="button" aria-current={number === page ? "page" : undefined} onClick={() => onPageChange(number)} className={`h-8 w-8 rounded-lg border text-xs font-medium transition-all ${number === page ? "border-brand-400 bg-brand-500 text-white shadow-sm" : "border-gray-200 bg-white text-gray-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-brand-500/50 dark:hover:bg-brand-500/10"}`}>{number}</button>)}
          <button type="button" aria-label={t("nextPage")} onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition-all hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-brand-500/50 dark:hover:bg-brand-500/10">
            <span aria-hidden="true">&#8250;</span>
          </button>
        </>}
      </div>
    </div>
  );
}