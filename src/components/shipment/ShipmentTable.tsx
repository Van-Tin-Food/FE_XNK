"use client";
import React, { useState, useMemo } from "react";
import type { Shipment } from "@/types/shipment";
import { useLanguage } from "@/context/LanguageContext";
import { paginateItems } from "@/utils/pagination";
import PaginationControls from "@/components/common/PaginationControls";

interface ShipmentTableProps {
  shipments: Shipment[];
  onRowClick: (shipment: Shipment) => void;
}

const DEFAULT_PAGE_SIZE = 15;

const STATUS_CONFIG: Record<string, { labelKey: string; color: string; bg: string; dot: string }> = {
  cancelled: { labelKey: "cancelledStatus", color: "text-error-600 dark:text-error-400", bg: "bg-error-50 dark:bg-error-500/10", dot: "bg-error-500" },
  buying: { labelKey: "stageBuying", color: "text-amber-700", bg: "bg-amber-50 dark:bg-amber-500/10", dot: "bg-amber-500" },
  shipping: { labelKey: "stageShipping", color: "text-blue-light-600", bg: "bg-blue-light-50 dark:bg-blue-light-500/10", dot: "bg-blue-light-500" },
  arrived: { labelKey: "stageArrived", color: "text-blue-light-600", bg: "bg-blue-light-50 dark:bg-blue-light-500/10", dot: "bg-blue-light-500" },
  declared: { labelKey: "stageDeclared", color: "text-blue-light-600", bg: "bg-blue-light-50 dark:bg-blue-light-500/10", dot: "bg-blue-light-500" },
  fifteenb: { labelKey: "stageFifteenB", color: "text-blue-light-600", bg: "bg-blue-light-50 dark:bg-blue-light-500/10", dot: "bg-blue-light-500" },
  customs: { labelKey: "stageCustoms", color: "text-blue-light-600", bg: "bg-blue-light-50 dark:bg-blue-light-500/10", dot: "bg-blue-light-500" },
  delivered: { labelKey: "delivered", color: "text-success-600", bg: "bg-success-50 dark:bg-success-500/10", dot: "bg-success-500" },
};

type SortKey = "orderCode" | "shipName" | "supplier" | "eta" | "status" | "receivedDocs";
type SortDir = "asc" | "desc";

const SORT_OPTIONS: { value: SortKey; labelKey: string }[] = [
  { value: "orderCode", labelKey: "orderNumber" },
  { value: "shipName", labelKey: "productName" },
  { value: "supplier", labelKey: "supplier" },
  { value: "eta", labelKey: "estimatedArrivalShort" },
  { value: "status", labelKey: "status" },
  { value: "receivedDocs", labelKey: "documents" },
];

function SortIcon({
  col,
  sortKey,
  sortDir,
}: {
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
}) {
  if (sortKey !== col) {
    return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300 dark:text-gray-600">
        <polyline points="7 15 12 20 17 15" />
        <polyline points="7 9 12 4 17 9" />
      </svg>
    );
  }

  return sortDir === "asc" ? (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand-500">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  ) : (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand-500">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateStart(value: string | undefined): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getArrivalState(shipment: Shipment, language: "vi" | "en" = "vi"): { text: string; className: string; sortValue: number | null } {
  const eta = parseDateStart(shipment.eta);
  const ata = parseDateStart(shipment.ata);
  const today = parseDateStart(new Date().toISOString()) as number;

  if (eta === null) return { text: "—", className: "text-gray-500 dark:text-gray-400", sortValue: null };

  if (ata !== null) {
    const difference = Math.round((ata - eta) / DAY_MS);
    if (difference < 0) {
      const days = Math.abs(difference);
      return {
        text: language === "en" ? `${days} days early` : `Giao sớm ${days} ngày`,
        className: "text-success-600 dark:text-success-400",
        sortValue: difference,
      };
    }
    return {
      text: difference === 0 ? (language === "en" ? "On time" : "Giao đúng hạn") : language === "en" ? `${difference} days late` : `Giao trễ ${difference} ngày`,
      className: difference === 0 ? "text-success-600 dark:text-success-400" : "text-error-600 dark:text-error-400",
      sortValue: difference,
    };
  }

  const remainingDays = Math.round((eta - today) / DAY_MS);
  if (remainingDays < 0) {
    return {
      text: language === "en" ? `${Math.abs(remainingDays)} days overdue` : `Trễ ${Math.abs(remainingDays)} ngày`,
      className: "text-error-600 dark:text-error-400",
      sortValue: remainingDays,
    };
  }
  return {
    text: remainingDays === 0 ? (language === "en" ? "Due today" : "Đến hạn hôm nay") : language === "en" ? `${remainingDays} days remaining` : `Còn ${remainingDays} ngày`,
    className: "text-blue-600 dark:text-blue-400",
    sortValue: remainingDays,
  };
}

function DocBar({ total, received, missingList, missingLabel }: { total: number; received: number; missingList: string; missingLabel: string }) {
  const pct = total > 0 ? (received / total) * 100 : 0;
  const missing = total - received;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className="w-20 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${missing > 0 ? "bg-blue-500" : "bg-success-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={`text-xs font-medium tabular-nums ${missing > 0 ? "text-blue-600" : "text-success-600"}`}>
          {received}/{total}
        </span>
      </div>
      {missing > 0 && missingList && (
        <p className="text-[10px] text-gray-400 truncate max-w-[160px]" title={missingList}>
          {missingLabel}: {missingList}
        </p>
      )}
    </div>
  );
}

function ShipmentCard({
  shipment,
  onClick,
  t,
  language,
}: {
  shipment: Shipment;
  onClick: () => void;
  t: (key: string, variables?: Record<string, string | number>) => string;
  language: "vi" | "en";
}) {
  const statusKey = shipment.status === "cancelled" ? "cancelled" : shipment.flowStageKey || "buying";
  const sc = STATUS_CONFIG[statusKey] || STATUS_CONFIG.buying;
  const statusLabel = t(sc.labelKey);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className="rounded-xl border border-gray-200 bg-white p-4 text-left shadow-theme-xs transition-colors hover:border-brand-300 hover:bg-brand-50/30 dark:border-gray-700 dark:bg-gray-800/40 dark:hover:border-brand-500/50 dark:hover:bg-brand-500/5"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-semibold text-brand-600 dark:text-brand-400" title={shipment.orderCode}>
            {shipment.orderCode}
          </p>
          <p className="mt-1 truncate text-sm font-medium text-gray-800 dark:text-white/90" title={shipment.shipName}>
            {shipment.shipName}
          </p>
        </div>
        <button
          type="button"
          aria-label={t("viewShipmentDetails", { orderCode: shipment.orderCode })}
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-400 transition-all hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-brand-500/50 dark:hover:bg-brand-500/10 dark:hover:text-brand-400"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-gray-100 pt-3 dark:border-gray-700">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-gray-400">{t("supplier")}</p>
          <p className="mt-0.5 truncate text-xs font-medium text-gray-700 dark:text-gray-300" title={shipment.supplier}>
            {shipment.supplier || "—"}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-gray-400">{t("carrier")}</p>
          <p className="mt-0.5 truncate text-xs text-gray-600 dark:text-gray-300" title={shipment.vessel}>
            {shipment.vessel || "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400">{t("arrivalDuration")}</p>
          <p className={`mt-0.5 text-xs font-medium ${getArrivalState(shipment, language).className}`}>{getArrivalState(shipment, language).text}</p>
        </div>
      </div>

      <div className="mt-3 flex min-w-0 items-center justify-between gap-3 border-t border-gray-100 pt-3 dark:border-gray-700">
        <span
          className={`inline-flex max-w-[62%] min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${sc.color} ${sc.bg}`}
          title={statusLabel}
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${sc.dot}`} />
          <span className="truncate">{statusLabel}</span>
        </span>
        <DocBar total={shipment.totalDocs} received={shipment.receivedDocs} missingList={shipment.missingDocs} missingLabel={t("missing")} />
      </div>
    </div>
  );
}

export default function ShipmentTable({ shipments, onRowClick }: ShipmentTableProps) {
  const { language, t } = useLanguage();
  const [sortKey, setSortKey] = useState<SortKey>("eta");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  };

  const sorted = useMemo(() => {
    return [...shipments].sort((a, b) => {
      let va: string | number | undefined;
      let vb: string | number | undefined;
      if (sortKey === "receivedDocs") {
        va = a.receivedDocs;
        vb = b.receivedDocs;
        const cmp = (va ?? 0) < (vb ?? 0) ? -1 : (va ?? 0) > (vb ?? 0) ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortKey === "eta") {
        const etaA = parseDateStart(a.eta);
        const etaB = parseDateStart(b.eta);

        // Mặc định ETA tăng dần để đơn sắp cập cảng nằm ở đầu; đơn thiếu ETA luôn nằm cuối.
        if (etaA === null && etaB === null) return a.orderCode.localeCompare(b.orderCode, "vi");
        if (etaA === null) return 1;
        if (etaB === null) return -1;

        const cmp = etaA < etaB ? -1 : etaA > etaB ? 1 : 0;
        if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
        return a.orderCode.localeCompare(b.orderCode, "vi");
      }
      va = a[sortKey as keyof Shipment] as string | undefined;
      vb = b[sortKey as keyof Shipment] as string | undefined;
      if (!va) va = "";
      if (!vb) vb = "";
      const cmp = String(va).localeCompare(String(vb), "vi");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [shipments, sortKey, sortDir]);

  const { items: paged, totalPages, safePage, from, to } = paginateItems(sorted, page, pageSize);

  const headerCls =
    "py-3 px-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200 transition-colors";

  return (
    <div className="min-w-0 rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      {/* Table header */}
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-4 dark:border-gray-800 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">{t("shipmentList")}</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {t("shipmentCount", { count: shipments.length })}
            {shipments.length > 0 && ` • ${t("pageOf", { page: safePage, total: totalPages })}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-gray-400">{t("clickRowForDetails")}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
      </div>

      {/* Mobile card layout */}
      <div className="space-y-3 p-4 lg:hidden">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="shipment-mobile-sort" className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t("sortBy")}
            </label>
            <select
              id="shipment-mobile-sort"
              value={sortKey}
              onChange={(event) => handleSort(event.target.value as SortKey)}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-gray-700 dark:bg-gray-800/50 dark:text-white"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{t(option.labelKey)}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            aria-label={sortDir === "asc" ? t("sortDescending") : t("sortAscending")}
            onClick={() => setSortDir((direction) => direction === "asc" ? "desc" : "asc")}
            className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-500 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400 dark:hover:border-brand-500/50 dark:hover:bg-brand-500/10"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {sortDir === "asc" ? <path d="m18 15-6-6-6 6" /> : <path d="m6 9 6 6 6-6" />}
            </svg>
          </button>
        </div>

        {paged.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">{t("noShipments")}</div>
        ) : (
          paged.map((shipment) => (
            <ShipmentCard
              key={shipment.id}
              shipment={shipment}
              onClick={() => onRowClick(shipment)}
              t={t}
              language={language}
            />
          ))
        )}
      </div>

      {/* Desktop and tablet table layout */}
      <div className="hidden w-full lg:block lg:max-xl:overflow-x-auto lg:max-xl:overscroll-x-contain lg:max-xl:custom-scrollbar">
          <table className="w-full min-w-0 table-fixed border-separate border-spacing-0 [&_td]:overflow-hidden [&_th]:overflow-hidden lg:max-xl:min-w-[1120px]">
            <thead className="border-b border-gray-100 dark:border-gray-800">
            <tr>
              <th className="sticky top-[65px] z-40 w-[4%] bg-gray-50/95 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 backdrop-blur lg:top-[73px] dark:bg-gray-900/95 dark:text-gray-400">{t("sequence")}</th>
              <th className={`${headerCls} sticky top-[65px] z-40 bg-gray-50/95 w-[10%] backdrop-blur lg:top-[73px] dark:bg-gray-900/95`} onClick={() => handleSort("orderCode")}>
                <div className="flex items-center gap-1.5">{t("orderNumber")} <SortIcon col="orderCode" sortKey={sortKey} sortDir={sortDir} /></div>
              </th>
              <th className={`${headerCls} sticky top-[65px] z-40 bg-gray-50/95 w-[19%] backdrop-blur lg:top-[73px] dark:bg-gray-900/95`} onClick={() => handleSort("shipName")}>
                <div className="flex items-center gap-1.5">{t("productName")} <SortIcon col="shipName" sortKey={sortKey} sortDir={sortDir} /></div>
              </th>
              <th className={`${headerCls} sticky top-[65px] z-40 bg-gray-50/95 w-[15%] backdrop-blur lg:top-[73px] dark:bg-gray-900/95`} onClick={() => handleSort("supplier")}>
                <div className="flex items-center gap-1.5">{t("supplier")} <SortIcon col="supplier" sortKey={sortKey} sortDir={sortDir} /></div>
              </th>
              <th className={`${headerCls} sticky top-[65px] z-40 bg-gray-50/95 w-[12%] backdrop-blur lg:top-[73px] dark:bg-gray-900/95`} onClick={() => handleSort("eta")}>
                <div className="flex items-center gap-1.5">{t("arrivalDuration")} <SortIcon col="eta" sortKey={sortKey} sortDir={sortDir} /></div>
              </th>
              <th className={`${headerCls} sticky top-[65px] z-40 bg-gray-50/95 w-[14%] backdrop-blur lg:top-[73px] dark:bg-gray-900/95`} onClick={() => handleSort("status")}>
                <div className="flex items-center gap-1.5">{t("status")} <SortIcon col="status" sortKey={sortKey} sortDir={sortDir} /></div>
              </th>
              <th className={`${headerCls} sticky top-[65px] z-40 bg-gray-50/95 w-[14%] backdrop-blur lg:top-[73px] dark:bg-gray-900/95`} onClick={() => handleSort("receivedDocs")}>
                <div className="flex items-center gap-1.5">{t("documents")} <SortIcon col="receivedDocs" sortKey={sortKey} sortDir={sortDir} /></div>
              </th>
              <th className="sticky top-[65px] z-40 bg-gray-50/95 py-3 px-4 w-[5%] text-center text-xs font-semibold uppercase tracking-wider text-gray-500 backdrop-blur lg:top-[73px] dark:bg-gray-900/95 dark:text-gray-400">{t("view")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-800/50">
            {paged.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-16 text-center text-sm text-gray-400">
                  <div className="flex flex-col items-center gap-2">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300">
                      <circle cx="11" cy="11" r="8"/>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    {t("noShipments")}
                  </div>
                </td>
              </tr>
            ) : (
              paged.map((shipment, rowIdx) => {
                const statusKey = shipment.status === "cancelled" ? "cancelled" : shipment.flowStageKey || "buying";
                const sc = STATUS_CONFIG[statusKey] || STATUS_CONFIG.buying;
                const statusLabel = t(sc.labelKey);
                const rowNum = (safePage - 1) * pageSize + rowIdx + 1;
                return (
                  <tr
                    key={shipment.id}
                    onClick={() => onRowClick(shipment)}
                    className="group cursor-pointer hover:bg-brand-50/40 dark:hover:bg-brand-500/5 transition-colors duration-150"
                  >
                    {/* Row number */}
                    <td className="py-3.5 px-4">
                      <span className="text-xs text-gray-400 tabular-nums">{rowNum}</span>
                    </td>

                    {/* Order code */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col gap-0.5">
                        <span className="truncate font-mono text-sm font-semibold text-brand-600 group-hover:text-brand-700 dark:text-brand-400" title={shipment.orderCode}>
                          {shipment.orderCode}
                        </span>
                      </div>
                    </td>

                    {/* Ship name */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col gap-0.5">
                        {/* <p className="text-sm font-medium text-gray-800 dark:text-white/90 max-w-[200px] truncate" title={shipment.shipName}>
                          {shipment.shipName}
                        </p> */}
                        <p
                          className="text-sm font-medium text-gray-800 dark:text-white/90 truncate w-full"
                          title={shipment.shipName}
                        >
                          {shipment.shipName}
                        </p>
                      </div>
                    </td>

                    {/* Supplier */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col gap-0.5">
                        <span className="truncate text-xs font-medium text-gray-700 dark:text-gray-300" title={shipment.supplier}>{shipment.supplier || "—"}</span>
                        {shipment.vessel && (
                          <div className="flex items-center gap-1">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 flex-shrink-0">
                              <path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>
                            </svg>
                            <span className="truncate text-xs text-gray-500 dark:text-gray-400" title={shipment.vessel}>{shipment.vessel}</span>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Arrival status */}
                    <td className="py-3.5 px-4">
                      {(() => {
                        const arrivalState = getArrivalState(shipment, language);
                        return <span className={`text-xs font-medium ${arrivalState.className}`}>{arrivalState.text}</span>;
                      })()}
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col items-start gap-1">
                        <span
                          className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${sc.color} ${sc.bg}`}
                          title={statusLabel}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sc.dot}`} />
                          <span className="truncate">{statusLabel}</span>
                        </span>
                      </div>
                    </td>

                    {/* Docs */}
                    <td className="py-3.5 px-4">
                      <DocBar
                        total={shipment.totalDocs}
                        received={shipment.receivedDocs}
                        missingList={shipment.missingDocs}
                        missingLabel={t("missing")}
                      />
                    </td>

                    {/* Detail button */}
                    <td className="py-3.5 px-4 text-center">
                      <button
                        onClick={(e) => { e.stopPropagation(); onRowClick(shipment); }}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-400 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-brand-500/50 dark:hover:bg-brand-500/10 dark:hover:text-brand-400 transition-all"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="8"/>
                          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {(totalPages > 1 || sorted.length > 0) && <PaginationControls page={safePage} totalPages={totalPages} pageSize={pageSize} totalItems={sorted.length} from={from} to={to} onPageChange={setPage} onPageSizeChange={(nextSize) => { setPageSize(nextSize); setPage(1); }} />}
    </div>
  );
}
