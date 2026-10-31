"use client";
import React, { useState, useMemo, useEffect } from "react";
import type { Shipment } from "@/types/shipment";
import { useLanguage } from "@/context/LanguageContext";
import { paginateItems } from "@/utils/pagination";
import PaginationControls from "@/components/common/PaginationControls";
import { BillContainerTrackingList, hasTextSelection } from "./TrackingCodeButton";
import { SHIPMENT_TABLE_STATE_KEY } from "@/utils/shipmentListState";
import { getGoodsPaymentSummary, type GoodsPaymentListState, type GoodsPaymentSummary } from "@/services/paymentCostApi";
import { databaseEndpoints, updateDatabaseRow } from "@/services/postgresShipmentApi";
import { useAuth } from "@/context/AuthContext";

interface ShipmentTableProps {
  shipments: Shipment[];
  onRowClick: (shipment: Shipment) => void;
  /** Đã sửa nhanh một đơn ngay trên bảng (ETA): tải lại đúng đơn đó. */
  onShipmentUpdated?: (orderCode: string) => void | Promise<void>;
}

const DEFAULT_PAGE_SIZE = 15;
// Sắp xếp / trang đang xem: giữ lại khi mở chi tiết đơn rồi quay về danh sách; vào danh sách kiểu khác thì
// ShipmentDashboard đã xoá trước khi bảng khởi tạo (shipmentListState), bảng về mặc định.
const TABLE_STATE_KEY = SHIPMENT_TABLE_STATE_KEY;
const LIST_CONTAINER_LIMIT = 3;

type TableState = { sortKey: SortKey; sortDir: SortDir; page: number; pageSize: number };

/** Chỉ nhận giá trị hợp lệ; trang này chỉ render ở trình duyệt sau khi đăng nhập nên đọc được ngay lúc khởi tạo state. */
function readTableState(): Partial<TableState> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(TABLE_STATE_KEY) || "{}") as Partial<TableState>;
    if (!parsed || typeof parsed !== "object") return {};
    return {
      ...(parsed.sortKey && SORT_OPTIONS.some((option) => option.value === parsed.sortKey) ? { sortKey: parsed.sortKey } : {}),
      ...(parsed.sortDir === "asc" || parsed.sortDir === "desc" ? { sortDir: parsed.sortDir } : {}),
      ...(Number.isInteger(parsed.page) && Number(parsed.page) > 0 ? { page: Number(parsed.page) } : {}),
      ...(Number.isInteger(parsed.pageSize) && Number(parsed.pageSize) > 0 ? { pageSize: Number(parsed.pageSize) } : {}),
    };
  } catch {
    return {};
  }
}

const STATUS_CONFIG: Record<string, { labelKey: string; color: string; bg: string; dot: string }> = {
  cancelled: { labelKey: "cancelledStatus", color: "text-error-600 dark:text-error-400", bg: "bg-error-50 dark:bg-error-500/10", dot: "bg-error-500" },
  buying: { labelKey: "stageBuying", color: "text-amber-700", bg: "bg-amber-50 dark:bg-amber-500/10", dot: "bg-amber-500" },
  shipping: { labelKey: "stageShipping", color: "text-blue-light-600", bg: "bg-blue-light-50 dark:bg-blue-light-500/10", dot: "bg-blue-light-500" },
  arrived: { labelKey: "stageArrived", color: "text-blue-light-600", bg: "bg-blue-light-50 dark:bg-blue-light-500/10", dot: "bg-blue-light-500" },
  declared: { labelKey: "stageDeclared", color: "text-blue-light-600", bg: "bg-blue-light-50 dark:bg-blue-light-500/10", dot: "bg-blue-light-500" },
  fifteenb: { labelKey: "stageFifteenB", color: "text-blue-light-600", bg: "bg-blue-light-50 dark:bg-blue-light-500/10", dot: "bg-blue-light-500" },
  customs: { labelKey: "stageCustoms", color: "text-blue-light-600", bg: "bg-blue-light-50 dark:bg-blue-light-500/10", dot: "bg-blue-light-500" },
  // Đang ở bước giao hàng: chỉ còn thiếu hạ rỗng (TRA_CONT), chưa phải thành công.
  delivered: { labelKey: "stageDelivered", color: "text-blue-light-600", bg: "bg-blue-light-50 dark:bg-blue-light-500/10", dot: "bg-blue-light-500" },
  // Đủ mọi chứng từ bắt buộc (kể cả hạ rỗng).
  completed: { labelKey: "delivered", color: "text-success-600", bg: "bg-success-50 dark:bg-success-500/10", dot: "bg-success-500" },
};

const PROCESS_ORDER: Record<string, number> = {
  buying: 1,
  shipping: 2,
  arrived: 3,
  declared: 4,
  fifteenb: 5,
  customs: 6,
  delivered: 7,
  completed: 8,
  cancelled: 99,
};

/** Trạng thái hiển thị: hủy / hoàn thành (đủ chứng từ) / giai đoạn đang chạy. */
function shipmentStatusKey(shipment: Shipment): string {
  if (shipment.status === "cancelled") return "cancelled";
  if (shipment.status === "completed") return "completed";
  return shipment.flowStageKey || "buying";
}

type SortKey = "orderCode" | "contractDate" | "shipName" | "supplier" | "factory" | "eta" | "status" | "receivedDocs";
type SortDir = "asc" | "desc";

const SORT_OPTIONS: { value: SortKey; labelKey: string }[] = [
  { value: "orderCode", labelKey: "orderNumber" },
  { value: "contractDate", labelKey: "contractDate" },
  { value: "shipName", labelKey: "productName" },
  { value: "supplier", labelKey: "supplier" },
  { value: "factory", labelKey: "factoryName" },
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

function formatContractDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const slash = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const day = first > 12 ? first : second;
    const month = first > 12 ? second : first;
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${slash[3]}`;
  }
  return raw;
}

function formatProductNames(value: string): string {
  return value.split(/\s*,\s*/).filter(Boolean).join("\n");
}

function factoryNameOf(shipment: Shipment): string {
  return String(shipment.summaryFields?.["Tên nhà máy"] || shipment.factoryCode || "").trim();
}

/** Tên hàng (mỗi mặt hàng một dòng), tên nhà máy ngay bên dưới. */
function ProductFactoryText({ shipment, className = "" }: { shipment: Shipment; className?: string }) {
  const factory = factoryNameOf(shipment);
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="w-full whitespace-pre-line break-words text-sm font-medium text-gray-800 dark:text-white/90" title={shipment.shipName}>
        {formatProductNames(shipment.shipName) || "—"}
      </p>
      {factory && (
        <p className="mt-0.5 break-words text-xs text-gray-500 dark:text-gray-400" title={factory}>
          {factory}
        </p>
      )}
    </div>
  );
}

function parseDateStart(value: string | undefined): number | null {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date.getTime();
  }
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

function ArrivalCell({ shipment, language }: { shipment: Shipment; language: "vi" | "en" }) {
  const arrivalState = getArrivalState(shipment, language);
  const hasEta = Boolean(String(shipment.eta ?? "").trim());
  const hasAta = Boolean(String(shipment.ata ?? "").trim());

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {hasEta && (
        <span className="text-[11px] font-medium text-gray-700 dark:text-gray-200">
          ETA: {formatContractDate(shipment.eta)}
        </span>
      )}
      <span className={`text-xs font-medium ${arrivalState.className}`}>{arrivalState.text}</span>
      {hasAta && (
        <span className="text-[10px] text-gray-500 dark:text-gray-400">
          ATA: {formatContractDate(shipment.ata)}
        </span>
      )}
    </div>
  );
}

function primaryBillOf(shipment: Shipment) {
  return [...(shipment.database?.bills || [])].sort((left, right) => String(left.eta || "9999-12-31").localeCompare(String(right.eta || "9999-12-31")))[0];
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

// Cột "Thanh toán QT": 2 đợt thanh toán tiền hàng (cọc hàng, thanh toán tiền còn lại) của hợp đồng, trạng thái lấy một
// lần cho mọi đơn (getGoodsPaymentSummary). Màu: xanh = đã duyệt / đã giao, vàng = chờ duyệt, đỏ = bị từ chối, xám = chưa có.
const GOODS_STATE_STYLE: Record<GoodsPaymentListState, string> = {
  approved: "bg-success-500",
  delivered: "bg-success-300",
  pending: "bg-warning-500",
  rejected: "bg-error-500",
  none: "bg-gray-300 dark:bg-gray-600",
};
const goodsContract = (shipment: Shipment) => String(shipment.database?.purchase?.ma_hop_dong || shipment.orderCode);

function GoodsPaymentCell({ state, t, inline = false }: {
  state: GoodsPaymentSummary[string] | undefined;
  t: (key: string, variables?: Record<string, string | number>) => string;
  inline?: boolean;
}) {
  if (!state) return <span className="text-xs text-gray-400">—</span>;
  return (
    <div className={inline ? "flex flex-wrap gap-x-3 gap-y-1" : "flex flex-col gap-1"}>
      {(["deposit", "balance"] as const).map((kind) => {
        const label = `${t(kind === "deposit" ? "glpDeposit" : "glpBalance")}: ${t(`glpState_${state[kind]}`)}`;
        return (
          <span key={kind} className="flex min-w-0 items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-300" title={label}>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${GOODS_STATE_STYLE[state[kind]]}`} aria-hidden="true" />
            <span className="truncate">{label}</span>
          </span>
        );
      })}
    </div>
  );
}

function ShipmentCard({
  shipment,
  onClick,
  t,
  language,
  goodsPayment,
}: {
  shipment: Shipment;
  onClick: () => void;
  goodsPayment?: GoodsPaymentSummary[string];
  t: (key: string, variables?: Record<string, string | number>) => string;
  language: "vi" | "en";
}) {
  const statusKey = shipmentStatusKey(shipment);
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
      className="flex h-full min-w-0 flex-col rounded-xl border border-gray-200 bg-white p-4 text-left shadow-theme-xs transition-colors hover:border-brand-300 hover:bg-brand-50/30 dark:border-gray-700 dark:bg-gray-800/40 dark:hover:border-brand-500/50 dark:hover:bg-brand-500/5"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-semibold text-brand-600 dark:text-brand-400" title={shipment.orderCode}>
            {shipment.orderCode}
          </p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {t("contractDate")}: {formatContractDate(shipment.database?.purchase?.ngay_hop_dong)}
          </p>
          <ProductFactoryText shipment={shipment} className="mt-2" />
        </div>
      </div>

      {(shipment.database?.bills.length || 0) > 0 && (
        <div className="mt-3 min-w-0 border-t border-gray-100 pt-3 dark:border-gray-700">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-400">{t("billContainerColumn")}</p>
          <BillContainerTrackingList bills={shipment.database?.bills || []} maxContainers={LIST_CONTAINER_LIMIT} />
        </div>
      )}

      <div className="my-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-gray-100 pt-3 dark:border-gray-700">
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
          <p className="text-[10px] uppercase tracking-wide text-gray-400">{t("time")}</p>
          <div className="mt-0.5">
            <span className="mb-0.5 block text-[10px] text-gray-500 dark:text-gray-400">ETD: {formatContractDate(shipment.etd)}</span>
            <ArrivalCell shipment={shipment} language={language} />
          </div>
        </div>
      </div>

      <div className="mt-3 min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-gray-400">{t("glpColumn")}</p>
        <div className="mt-0.5"><GoodsPaymentCell state={goodsPayment} t={t} inline /></div>
      </div>

      <div className="mt-auto flex min-w-0 items-center justify-between gap-3 border-t border-gray-100 pt-3 dark:border-gray-700">
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

export default function ShipmentTable({ shipments, onRowClick, onShipmentUpdated }: ShipmentTableProps) {
  const { language, t } = useLanguage();
  const { can } = useAuth();
  const canEditEta = can("shipments", "edit");
  const [editingEtaId, setEditingEtaId] = useState<string | null>(null);
  const [draftEta, setDraftEta] = useState("");
  const [savingEtaId, setSavingEtaId] = useState<string | null>(null);
  const [etaError, setEtaError] = useState<string | null>(null);
  // Đọc ngay ở lần render đầu (không đợi effect) để quay về từ chi tiết đơn thì đúng trang trước khi cuộn về chỗ cũ.
  const [savedState] = useState(() => readTableState());
  const [sortKey, setSortKey] = useState<SortKey>(() => savedState.sortKey || "eta");
  const [sortDir, setSortDir] = useState<SortDir>(() => savedState.sortDir || "asc");
  const [page, setPage] = useState(() => savedState.page || 1);
  const [pageSize, setPageSize] = useState(() => savedState.pageSize || DEFAULT_PAGE_SIZE);
  // Trạng thái cọc / còn lại của mọi đơn: tải một lần, tải lại khi quay lại tab (có thể vừa duyệt trên Google Chat).
  const [goodsPayments, setGoodsPayments] = useState<GoodsPaymentSummary | null>(null);
  const beginEtaEdit = (event: React.SyntheticEvent, shipment: Shipment) => {
    event.stopPropagation();
    if (!canEditEta) return;
    setEtaError(null);
    setEditingEtaId(shipment.id);
    setDraftEta(String(shipment.eta || "").slice(0, 10));
  };

  const cancelEtaEdit = (event?: React.SyntheticEvent) => {
    event?.stopPropagation();
    setEditingEtaId(null);
    setDraftEta("");
    setEtaError(null);
  };

  const saveEta = async (event: React.SyntheticEvent, shipment: Shipment) => {
    event.stopPropagation();
    if (savingEtaId === shipment.id) return;
    const bill = primaryBillOf(shipment);
    if (!bill?.id_xnk) {
      setEtaError(t("etaNoBill"));
      return;
    }
    const eta = draftEta.trim() || null;
    const etd = parseDateStart(bill.etd || undefined);
    const etaDate = parseDateStart(eta || undefined);
    if (etaDate !== null && etd !== null && etaDate < etd) {
      setEtaError(t("etaBeforeEtd"));
      return;
    }
    if (eta === String(shipment.eta || "").slice(0, 10)) {
      cancelEtaEdit();
      return;
    }
    setSavingEtaId(shipment.id);
    setEtaError(null);
    try {
      await updateDatabaseRow(databaseEndpoints.bills, bill.id_xnk, { eta });
      setEditingEtaId(null);
      setDraftEta("");
      await onShipmentUpdated?.(shipment.orderCode);
    } catch (error) {
      setEtaError(error instanceof Error ? error.message : t("etaUpdateFailed"));
    } finally {
      setSavingEtaId(null);
    }
  };

  const renderTimeCell = (shipment: Shipment) => {
    const isEditing = editingEtaId === shipment.id;
    const isSaving = savingEtaId === shipment.id;
    const bill = primaryBillOf(shipment);
    if (isEditing) {
      return (
        <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-brand-200 bg-brand-50/40 p-1.5 dark:border-brand-500/40 dark:bg-brand-500/5" onClick={(event) => event.stopPropagation()}>
          <span className="text-[10px] text-gray-500 dark:text-gray-400">ETD: {formatContractDate(shipment.etd)}</span>
          <label className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300">ETA</span>
            <input
              type="date"
              value={draftEta}
              min={String(shipment.etd || "").slice(0, 10) || undefined}
              autoFocus
              disabled={isSaving}
              onChange={(event) => { setDraftEta(event.target.value); setEtaError(null); }}
              onBlur={(event) => { void saveEta(event, shipment); }}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); void saveEta(event, shipment); }
                if (event.key === "Escape") { event.preventDefault(); cancelEtaEdit(event); }
              }}
              className="h-8 w-full min-w-0 rounded-md border border-brand-300 bg-white px-2 text-xs font-medium tabular-nums text-gray-700 shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-200 dark:border-brand-500/60 dark:bg-gray-800 dark:text-gray-200 dark:focus:ring-brand-500/30"
            />
          </label>
          {etaError && <span className="text-[10px] leading-tight text-error-600">{etaError}</span>}
        </div>
      );
    }
    return (
      <div
        role={canEditEta && bill ? "button" : undefined}
        tabIndex={canEditEta && bill ? 0 : undefined}
        title={canEditEta && bill ? t("etaEditHint") : undefined}
        onClick={(event) => beginEtaEdit(event, shipment)}
        onKeyDown={(event) => {
          if (canEditEta && bill && (event.key === "Enter" || event.key === " ")) beginEtaEdit(event, shipment);
        }}
        className={canEditEta && bill ? "cursor-text rounded-md outline-none hover:bg-brand-50/70 focus:ring-2 focus:ring-brand-200 dark:hover:bg-brand-500/10" : ""}
      >
        <span className="mb-0.5 block text-[10px] text-gray-500 dark:text-gray-400">ETD: {formatContractDate(shipment.etd)}</span>
        <ArrivalCell shipment={shipment} language={language} />
      </div>
    );
  };
  useEffect(() => {
    let active = true;
    const load = () => {
      getGoodsPaymentSummary()
        .then((summary) => { if (active) setGoodsPayments(summary); })
        .catch(() => { /* Không tải được: cột hiện "—", bảng vẫn dùng bình thường. */ });
    };
    load();
    // Quay lại tab (có thể vừa duyệt trên Google Chat): tải lại nếu lần trước đã quá 30 giây (paymentCostApi tự kiểm tra).
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(TABLE_STATE_KEY, JSON.stringify({ sortKey, sortDir, page, pageSize } satisfies TableState));
    } catch {
      // Trình duyệt chặn lưu trữ: chỉ mất phần nhớ trang / sắp xếp.
    }
  }, [page, pageSize, sortDir, sortKey]);

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
      if (sortKey === "contractDate") {
        const dateA = parseDateStart(String(a.database?.purchase?.ngay_hop_dong || ""));
        const dateB = parseDateStart(String(b.database?.purchase?.ngay_hop_dong || ""));
        if (dateA === null && dateB === null) return a.orderCode.localeCompare(b.orderCode, "vi");
        if (dateA === null) return 1;
        if (dateB === null) return -1;
        const cmp = dateA < dateB ? -1 : dateA > dateB ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortKey === "status") {
        const statusA = shipmentStatusKey(a);
        const statusB = shipmentStatusKey(b);
        const orderA = PROCESS_ORDER[statusA] ?? 98;
        const orderB = PROCESS_ORDER[statusB] ?? 98;
        const cmp = orderA < orderB ? -1 : orderA > orderB ? 1 : 0;
        if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
        return a.orderCode.localeCompare(b.orderCode, "vi");
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
      if (sortKey === "factory") {
        va = a.summaryFields?.["Tên nhà máy"] || a.factoryCode || "";
        vb = b.summaryFields?.["Tên nhà máy"] || b.factoryCode || "";
      } else {
        va = a[sortKey as keyof Shipment] as string | undefined;
        vb = b[sortKey as keyof Shipment] as string | undefined;
      }
      if (!va) va = "";
      if (!vb) vb = "";
      const cmp = String(va).localeCompare(String(vb), "vi");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [shipments, sortKey, sortDir]);

  const { items: paged, totalPages, safePage, from, to } = paginateItems(sorted, page, pageSize);

  const headerCls =
    "py-3 px-4 xl:max-2xl:px-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200 transition-colors";

  return (
    <div className="min-w-0 rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      {/* Table header */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-gray-100 px-4 py-4 dark:border-gray-800 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">{t("shipmentList")}</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {t("shipmentCount", { count: shipments.length })}
            {shipments.length > 0 && ` • ${t("pageOf", { page: safePage, total: totalPages })}`}
          </p>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs text-gray-400">{t("clickRowForDetails")}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
      </div>

      {/* Dạng thẻ dưới 1280px (2 cột từ 768px); bảng 9 cột cần đủ chiều ngang. */}
      <div className="space-y-3 p-4 xl:hidden">
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {paged.map((shipment) => (
              <ShipmentCard
                key={shipment.id}
                shipment={shipment}
                onClick={() => { if (!hasTextSelection()) onRowClick(shipment); }}
                t={t}
                language={language}
                goodsPayment={goodsPayments?.[goodsContract(shipment)]}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bảng từ 1280px, đủ 9 cột. Dưới 1680px sidebar mặc định thu nhỏ (SidebarContext) để bảng rộng hơn; vẫn thiếu chỗ thì cuộn ngang trong khung bảng, không ẩn cột. */}
      <div className="hidden w-full xl:block xl:max-2xl:overflow-x-auto xl:max-2xl:overscroll-x-contain xl:max-2xl:custom-scrollbar">
          <table className="w-full min-w-0 table-fixed border-separate border-spacing-0 [&_td]:overflow-hidden [&_th]:overflow-hidden xl:max-2xl:min-w-[1140px]">
            <thead className="border-b border-gray-100 dark:border-gray-800">
            <tr>
              <th className="sticky top-[65px] z-40 xl:max-2xl:static w-[4%] bg-gray-50/95 px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 backdrop-blur lg:top-[73px] dark:bg-gray-900/95 dark:text-gray-400">{t("sequence")}</th>
              {/* Số HĐ + ngày HĐ chung một cột; bấm tiêu đề sắp xếp theo ngày hợp đồng. */}
              <th className={`${headerCls} sticky top-[65px] z-40 xl:max-2xl:static bg-gray-50/95 w-[12%] backdrop-blur lg:top-[73px] dark:bg-gray-900/95`} onClick={() => handleSort("contractDate")} title={t("sortByContractDate")}>
                <div className="flex items-center gap-1.5">{t("orderNumber")} <SortIcon col="contractDate" sortKey={sortKey} sortDir={sortDir} /></div>
              </th>
              <th className={`${headerCls} sticky top-[65px] z-40 xl:max-2xl:static bg-gray-50/95 w-[17%] backdrop-blur lg:top-[73px] dark:bg-gray-900/95`} onClick={() => handleSort("shipName")}>
                <div className="flex items-center gap-1.5">{t("productAndFactory")} <SortIcon col="shipName" sortKey={sortKey} sortDir={sortDir} /></div>
              </th>
              <th className="sticky top-[65px] z-40 xl:max-2xl:static w-[13%] bg-gray-50/95 px-4 py-3 xl:max-2xl:px-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 backdrop-blur lg:top-[73px] dark:bg-gray-900/95 dark:text-gray-400" title={t("trackingColumnHint")}>{t("billContainerColumn")}</th>
              <th className={`${headerCls} sticky top-[65px] z-40 xl:max-2xl:static bg-gray-50/95 w-[10%] backdrop-blur lg:top-[73px] dark:bg-gray-900/95`} onClick={() => handleSort("supplier")}>
                <div className="flex items-center gap-1.5">{t("supplier")} <SortIcon col="supplier" sortKey={sortKey} sortDir={sortDir} /></div>
              </th>
              <th className={`${headerCls} sticky top-[65px] z-40 xl:max-2xl:static bg-gray-50/95 w-[18%] backdrop-blur lg:top-[73px] dark:bg-gray-900/95`} onClick={() => handleSort("eta")}>
                <div className="flex items-center gap-1.5">{t("time")} <SortIcon col="eta" sortKey={sortKey} sortDir={sortDir} /></div>
              </th>
              <th className={`${headerCls} sticky top-[65px] z-40 xl:max-2xl:static bg-gray-50/95 w-[10%] backdrop-blur lg:top-[73px] dark:bg-gray-900/95`} onClick={() => handleSort("status")}>
                <div className="flex items-center gap-1.5">{t("status")} <SortIcon col="status" sortKey={sortKey} sortDir={sortDir} /></div>
              </th>
              <th className={`${headerCls} sticky top-[65px] z-40 xl:max-2xl:static bg-gray-50/95 w-[8%] backdrop-blur lg:top-[73px] dark:bg-gray-900/95`} onClick={() => handleSort("receivedDocs")}>
                <div className="flex items-center gap-1.5">{t("documents")} <SortIcon col="receivedDocs" sortKey={sortKey} sortDir={sortDir} /></div>
              </th>
              <th className="sticky top-[65px] z-40 xl:max-2xl:static w-[8%] bg-gray-50/95 px-4 py-3 xl:max-2xl:px-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 backdrop-blur lg:top-[73px] dark:bg-gray-900/95 dark:text-gray-400" title={t("glpColumnHint")}>{t("glpColumn")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-800/50">
            {paged.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-16 text-center text-sm text-gray-400">
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
                const statusKey = shipmentStatusKey(shipment);
                const sc = STATUS_CONFIG[statusKey] || STATUS_CONFIG.buying;
                const statusLabel = t(sc.labelKey);
                // Số thứ tự đếm tiếp qua các trang (trang 2 bắt đầu từ pageSize + 1).
                const rowNum = (safePage - 1) * pageSize + rowIdx + 1;
                return (
                  <tr
                    key={shipment.id}
                    onClick={() => { if (!hasTextSelection()) onRowClick(shipment); }}
                    className="group cursor-pointer hover:bg-brand-50/40 dark:hover:bg-brand-500/5 transition-colors duration-150"
                  >
                    {/* Row number */}
                    <td className="py-3.5 px-3">
                      <span className="text-xs text-gray-400 tabular-nums">{rowNum}</span>
                    </td>

                    {/* Order code + contract date */}
                    <td className="py-3.5 px-4 xl:max-2xl:px-2.5">
                      <div className="flex flex-col gap-0.5">
                        <span className="truncate font-mono text-sm font-semibold text-brand-600 group-hover:text-brand-700 dark:text-brand-400" title={shipment.orderCode}>
                          {shipment.orderCode}
                        </span>
                        <span className="truncate text-xs text-gray-500 dark:text-gray-400">
                          {formatContractDate(shipment.database?.purchase?.ngay_hop_dong)}
                        </span>
                      </div>
                    </td>

                    {/* Product + factory */}
                    <td className="py-3.5 px-4 xl:max-2xl:px-2.5">
                      <ProductFactoryText shipment={shipment} />
                    </td>

                    {/* B/L · container: bấm để tracking, không mở chi tiết đơn */}
                    <td className="py-3.5 px-4 xl:max-2xl:px-2.5">
                      <BillContainerTrackingList bills={shipment.database?.bills || []} maxContainers={LIST_CONTAINER_LIMIT} />
                    </td>

                    {/* Supplier */}
                    <td className="py-3.5 px-4 xl:max-2xl:px-2.5">
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
                    <td className="py-3.5 px-4 xl:max-2xl:px-2.5">
                      {renderTimeCell(shipment)}
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-4 xl:max-2xl:px-2.5">
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
                    <td className="py-3.5 px-4 xl:max-2xl:px-2.5">
                      <DocBar
                        total={shipment.totalDocs}
                        received={shipment.receivedDocs}
                        missingList={shipment.missingDocs}
                        missingLabel={t("missing")}
                      />
                    </td>

                    {/* Thanh toán QT: cọc hàng / thanh toán tiền còn lại */}
                    <td className="py-3.5 px-4 xl:max-2xl:px-2.5">
                      <GoodsPaymentCell state={goodsPayments?.[goodsContract(shipment)]} t={t} />
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
