"use client";
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Shipment, ShipmentFilter, ShipmentStatus, ShipmentFilterStatus } from "@/types/shipment";
import { fetchShipments, computeMetrics, exportEtaRows, getCachedShipments } from "@/services/shipmentApi";
import { returnItemsFromRelations } from "@/services/postgresShipmentApi";
import { buildEtaRows, getEtaHeaders } from "@/services/shipmentExcelExport";
import { getGoodsPaymentSummary } from "@/services/paymentCostApi";
import ShipmentMetrics from "./ShipmentMetrics";
import DashboardInfoBar from "./DashboardInfoBar";
import ShipmentFilters from "./ShipmentFilters";
import ShipmentTable from "./ShipmentTable";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { getDefaultEtaRange } from "@/utils/shipmentDateFilter";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import { CREATE_SHIPMENT_PATH, shipmentDetailPath } from "@/utils/shipmentRoutes";
import {
  SHIPMENT_FILTER_STATE_KEY,
  SHIPMENT_LIST_RESET_EVENT,
  SHIPMENT_SCROLL_STATE_KEY,
  finishShipmentListRestore,
  markShipmentListRestore,
  prepareShipmentListState,
} from "@/utils/shipmentListState";

// Bộ lọc và vị trí cuộn của danh sách: chỉ giữ lại khi mở trang chi tiết / tạo đơn rồi quay về (xem shipmentListState).
function readSavedFilter(): { filter?: ShipmentFilter; metric?: ShipmentStatus | "all" } {
  if (typeof window === "undefined" || !prepareShipmentListState()) return {};
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(SHIPMENT_FILTER_STATE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// Mặc định mở thẻ "Đang vận chuyển" (đơn đang theo dõi hằng ngày) trong khoảng ETA mặc định.
function defaultShipmentFilter(etaRange: { dateFrom?: string; dateTo?: string }): ShipmentFilter {
  return {
    status: "shipping",
    search: "",
    dateFrom: etaRange.dateFrom,
    dateTo: etaRange.dateTo,
    dateField: "eta",
    supplier: undefined,
    port: undefined,
    vessel: undefined,
  };
}

function matchesFilterValue(source?: string, selected?: string): boolean {
  if (!selected) return true;
  return String(source || "").trim().toLocaleLowerCase("vi") === selected.trim().toLocaleLowerCase("vi");
}

// HÀM NGUỒN DUY NHẤT cho lọc ETA: dùng chung cho cả table lẫn options của dropdown,
// nên hai bên không bao giờ lệch nhau. So sánh theo ngày (bỏ giờ phút giây).
function matchesEtaRange(shipment: Shipment, dateFrom?: string, dateTo?: string): boolean {
  if (!dateFrom && !dateTo) return true;
  // Đơn mới lên thường chưa có ETA. Vẫn giữ các đơn này trong danh sách khi
  // người dùng lọc theo khoảng ETA để không làm mất chúng khỏi dashboard.
  if (!shipment.eta) return true;
  const etaMatch = String(shipment.eta).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const eta = etaMatch
    ? new Date(Number(etaMatch[1]), Number(etaMatch[2]) - 1, Number(etaMatch[3]))
    : new Date(shipment.eta);
  if (Number.isNaN(eta.getTime())) return false;
  const etaDay = new Date(eta.getFullYear(), eta.getMonth(), eta.getDate()).getTime();
  if (dateFrom) {
    const from = new Date(`${dateFrom}T00:00:00`);
    if (Number.isNaN(from.getTime()) || from.getTime() > etaDay) return false;
  }
  if (dateTo) {
    const to = new Date(`${dateTo}T00:00:00`);
    if (Number.isNaN(to.getTime()) || to.getTime() < etaDay) return false;
  }
  return true;
}

function matchesStatusFilter(shipment: Shipment, filter: ShipmentFilter): boolean {
  const selectedStatus = filter.status as ShipmentFilterStatus | "all" | undefined;
  return !selectedStatus || selectedStatus === "all"
    || (selectedStatus === "cancelled" ? shipment.status === "cancelled" : shipment.status === selectedStatus);
}

// Ô tìm kiếm khớp mã đơn, tên hàng, mã B/L và số container của đơn.
function shipmentSearchValues(shipment: Shipment): string[] {
  const bills = shipment.database?.bills || [];
  return [
    shipment.orderCode,
    shipment.shipName,
    shipment.bill,
    ...bills.map((bill) => bill.ma_bl),
    ...bills.flatMap((bill) => bill.containers.map((container) => container.ma_container)),
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

// Mã B/L, số container hay bị gõ thiếu/thừa khoảng trắng nên so sánh cả dạng bỏ khoảng trắng.
function matchesSearchText(value: string, query: string): boolean {
  const text = value.toLowerCase();
  return text.includes(query) || text.replace(/\s+/g, "").includes(query.replace(/\s+/g, ""));
}

// Phạm vi chung của dashboard (chưa lọc trạng thái): ETA + tìm kiếm.
// Dùng cho cả thẻ số liệu lẫn table, nên thẻ và table luôn cùng phạm vi.
function matchesSearchAndEta(shipment: Shipment, filter: ShipmentFilter): boolean {
  const query = (filter.search || "").toLowerCase().trim();
  const searchOk = !query || shipmentSearchValues(shipment).some((value) => matchesSearchText(value, query));
  return searchOk && matchesEtaRange(shipment, filter.dateFrom, filter.dateTo);
}

function matchesBaseFilter(shipment: Shipment, filter: ShipmentFilter): boolean {
  return matchesStatusFilter(shipment, filter) && matchesSearchAndEta(shipment, filter);
}

export default function ShipmentDashboard() {
  const { can } = useAuth();
  const { t } = useLanguage();
  const { notify } = useSystemNotification();
  const canViewShipments = can("shipments");
  const canCreateShipment = can("shipments", "edit");
  const canExportShipments = can("exportShipments");
  const canViewPurchaseAmounts = can("purchaseAmounts");
  const router = useRouter();
  // Đã tải danh sách trong phiên này (vd vừa xem chi tiết đơn quay về): hiện ngay, tải lại ngầm.
  const [cachedList] = useState(() => getCachedShipments());
  const [shipments, setShipments] = useState<Shipment[]>(() => cachedList?.shipments || []);
  const [lastUpdated, setLastUpdated] = useState<string>(() => cachedList?.lastUpdated || new Date().toISOString());
  const [updatedBy, setUpdatedBy] = useState<string>(() => cachedList?.updatedBy || "");
  const [isLoading, setIsLoading] = useState(!cachedList);
  const hasShipmentsRef = useRef(Boolean(cachedList));
  const [apiError, setApiError] = useState<string | null>(null);
  // Bộ lọc đã chọn trong phiên (quay về từ chi tiết đơn) đọc ngay ở lần render đầu, để danh sách hiện đúng trước khi
  // cuộn về chỗ cũ. Trang này chỉ render ở trình duyệt sau khi đăng nhập (layout admin chặn trước), không lệch hydrate.
  const [savedFilter] = useState(() => readSavedFilter());
  // Mặc định mở thẻ "Đang vận chuyển" (đơn đang theo dõi hằng ngày); bấm "Tổng đơn hàng" để xem tất cả.
  const [activeMetricFilter, setActiveMetricFilter] = useState<ShipmentStatus | "all">(() => savedFilter.metric || "shipping");
  const defaultEtaRange = useMemo(() => getDefaultEtaRange(), []);
  const [filter, setFilter] = useState<ShipmentFilter>(() => ({
    ...defaultShipmentFilter(defaultEtaRange),
    ...(savedFilter.filter && typeof savedFilter.filter === "object" ? savedFilter.filter : {}),
  }));
  // Đổi key để bảng mount lại với sắp xếp / trang mặc định khi bấm logo / menu lúc đang ở danh sách.
  const [tableResetKey, setTableResetKey] = useState(0);

  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    finishShipmentListRestore();
  }, []);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(SHIPMENT_FILTER_STATE_KEY, JSON.stringify({ filter, metric: activeMetricFilter }));
    } catch {
      // Trình duyệt chặn lưu trữ: chỉ mất phần nhớ bộ lọc.
    }
  }, [activeMetricFilter, filter]);

  // Bấm logo / menu "Mua hàng & ETA" khi đang ở danh sách: về bộ lọc, sắp xếp, trang mặc định và lên đầu trang.
  useEffect(() => {
    const handleReset = () => {
      setActiveMetricFilter("shipping");
      setFilter(defaultShipmentFilter(getDefaultEtaRange()));
      setTableResetKey((key) => key + 1);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener(SHIPMENT_LIST_RESET_EVENT, handleReset);
    return () => window.removeEventListener(SHIPMENT_LIST_RESET_EVENT, handleReset);
  }, []);

  // Quay về từ trang chi tiết: cuộn lại đúng chỗ đang xem (chỉ khi danh sách đã hiện từ cache).
  useEffect(() => {
    let savedScroll: number | null = null;
    try {
      const raw = window.sessionStorage.getItem(SHIPMENT_SCROLL_STATE_KEY);
      window.sessionStorage.removeItem(SHIPMENT_SCROLL_STATE_KEY);
      savedScroll = raw == null ? null : Number(raw);
    } catch {
      savedScroll = null;
    }
    if (!cachedList || savedScroll == null || !Number.isFinite(savedScroll)) return;
    const frame = window.requestAnimationFrame(() => window.scrollTo({ top: savedScroll }));
    return () => window.cancelAnimationFrame(frame);
  }, [cachedList]);

  const loadData = useCallback(async ({ initial = false }: { initial?: boolean } = {}) => {
    // Không có quyền xem đơn hàng: không gọi API (BE cũng trả 403) và bỏ dữ liệu đang giữ.
    if (!canViewShipments) {
      setShipments([]);
      setIsLoading(false);
      return;
    }
    // Đang có danh sách thì tải lại ngầm, không thay bảng bằng vòng xoay (mất vị trí đang xem).
    if (!hasShipmentsRef.current) setIsLoading(true);
    setApiError(null);

    try {
      const result = await fetchShipments({ shareInFlight: initial });
      hasShipmentsRef.current = true;
      setShipments(result.shipments);
      setLastUpdated(result.lastUpdated);
      setUpdatedBy(result.updatedBy || "");
    } catch (error) {
      // Keep existing rows visible when the API is temporarily unavailable.
      setApiError(error instanceof Error ? error.message : "Không thể tải dữ liệu shipment");
    } finally {
      setIsLoading(false);
    }
  }, [canViewShipments]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      // Tải trước trạng thái cọc / còn lại song song với danh sách đơn (trước đây bảng hiện xong mới gọi, thành 2 lượt nối
      // tiếp). Bảng dùng lại kết quả này (paymentCostApi dùng chung lần tải). Lỗi thì bảng tự hiện "—".
      if (canViewShipments) void getGoodsPaymentSummary().catch(() => undefined);
      void loadData({ initial: true });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [canViewShipments, loadData]);

  // Refresh handler
  const handleRefresh = useCallback(async () => {
    await loadData();
  }, [loadData]);

  // Sync metric filter → filter state
  const handleMetricFilterChange = (status: ShipmentStatus | "all") => {
    setActiveMetricFilter(status);
    setFilter(prev => ({ ...prev, status }));
  };

  // Sync filter dropdown → metric state
  const handleFilterChange = (newFilter: ShipmentFilter) => {
    setFilter(newFilter);
    if (newFilter.status !== undefined) {
      const metricStatus: ShipmentStatus | "all" =
        newFilter.status === "cancelled"
          ? "all"
          : newFilter.status as ShipmentStatus | "all";
      setActiveMetricFilter(metricStatus);
    }
  };

  // Apply filters
  const filteredShipments = useMemo(() => shipments.filter((s) => matchesBaseFilter(s, filter)
    && matchesFilterValue(s.supplier, filter.supplier)
    && matchesFilterValue(s.port, filter.port)
    && matchesFilterValue(s.vessel, filter.vessel)
  ), [shipments, filter]);

  const handleExport = useCallback(async () => {
    if (filteredShipments.length === 0) {
      notify(t("exportExcelEmpty"), "warning");
      return;
    }
    setIsExporting(true);
    try {
      // Dữ liệu vận chuyển đã có trong danh sách vừa tải; không gọi API cho từng đơn
      // (trước đây mỗi đơn tải lại 4 bảng, xuất 500 đơn = 2000 request).
      const returnItemsByOrder = Object.fromEntries(filteredShipments
        .filter((shipment) => shipment.orderCode)
        .map((shipment) => [shipment.orderCode, shipment.database ? returnItemsFromRelations(shipment.database, shipment.orderCode) : []]));
      const includeAmounts = canViewPurchaseAmounts;
      const rows = buildEtaRows(filteredShipments, returnItemsByOrder, { includeAmounts });
      const exportedAt = new Date();
      const pad = (value: number) => String(value).padStart(2, "0");
      const version = `${pad(exportedAt.getHours())}:${pad(exportedAt.getMinutes())} ${pad(exportedAt.getDate())}/${pad(exportedAt.getMonth() + 1)}/${exportedAt.getFullYear()}`;
      await exportEtaRows({ title: `Bảng ETA được xuất vào ${version}`, rows, headers: getEtaHeaders({ includeAmounts }) });
      notify(t("exportExcelSucceeded"), "success");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      notify(error instanceof Error ? `${t("exportExcelError")}: ${error.message}` : t("exportExcelError"), "error");
    } finally {
      setIsExporting(false);
    }
  }, [canViewPurchaseAmounts, filteredShipments, notify, t]);

  // Build filter dropdown choices from the rows eligible for the table:
  // ETA lọc trước → các dòng trong table mới là nguồn sinh options của
  // Nhà cung cấp / Hãng tàu / Cảng, không lấy từ toàn bộ DB.
  // Mỗi dropdown loại trừ chính nó để còn chọn được giá trị khác.
  const filterOptionShipments = useMemo(
    () => shipments.filter((shipment) => matchesBaseFilter(shipment, filter)),
    [filter, shipments],
  );

  const supplierOptions = useMemo(() => [...new Set(
    filterOptionShipments
      .filter((shipment) => !filter.supplier || matchesFilterValue(shipment.supplier, filter.supplier))
      .map((shipment) => String(shipment.supplier || "").trim()).filter(Boolean),
  )].sort((left, right) => left.localeCompare(right, "vi")), [filterOptionShipments, filter.supplier]);

  const carrierOptions = useMemo(() => [...new Set(
    filterOptionShipments
      .filter((shipment) => !filter.vessel || matchesFilterValue(shipment.vessel, filter.vessel))
      .map((shipment) => String(shipment.vessel || "").trim()).filter(Boolean),
  )].sort((left, right) => left.localeCompare(right, "vi")), [filterOptionShipments, filter.vessel]);

  const portOptions = useMemo(() => [...new Set(
    filterOptionShipments
      .filter((shipment) => !filter.port || matchesFilterValue(shipment.port, filter.port))
      .map((shipment) => String(shipment.port || "").trim()).filter(Boolean),
  )].sort((left, right) => left.localeCompare(right, "vi")), [filterOptionShipments, filter.port]);

  const searchSuggestions = useMemo(() => [...new Set(
    shipments.flatMap(shipmentSearchValues),
  )].sort((left, right) => left.localeCompare(right, "vi")), [shipments]);

  // Thẻ số liệu đếm theo phạm vi table sau lọc ETA + tìm kiếm (chưa lọc trạng thái
  // để mỗi thẻ vẫn đếm đúng trạng thái của nó, bấm vào mới lọc table).
  const metricScopeShipments = useMemo(
    () => shipments.filter((shipment) => matchesSearchAndEta(shipment, filter)),
    [filter, shipments],
  );
  const metrics = useMemo(() => computeMetrics(metricScopeShipments), [metricScopeShipments]);

  const handleRowClick = (shipment: Shipment) => {
    try {
      window.sessionStorage.setItem(SHIPMENT_SCROLL_STATE_KEY, String(window.scrollY));
    } catch {
      // Không lưu được thì quay về đầu trang.
    }
    markShipmentListRestore();
    router.push(shipmentDetailPath(shipment.orderCode));
  };

  if (!canViewShipments) {
    return (
      <div className="flex min-w-0 flex-col gap-5">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t("dashboardTitle")}</h1>
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center dark:border-gray-800 dark:bg-gray-900 sm:p-10">
          <p className="text-sm font-semibold text-gray-800 dark:text-white/90">{t("noShipmentPermissionTitle")}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("noShipmentPermissionDescription")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm font-medium text-blue-600 shadow-sm dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
        {t("etaDataNotice")}
      </div>

      {/* Page title */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            {t("dashboardTitle")}
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {t("dashboardSubtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3">
        {canCreateShipment && (
          <Link href={CREATE_SHIPMENT_PATH} onClick={markShipmentListRestore} className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600">
            {t("createShipment")}
          </Link>
        )}
        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin text-brand-500">
              <polyline points="23 4 23 10 17 10"/>
              <polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            {t("loadingSheet")}
          </div>
        )}
        </div>
      </div>

      {/* API Error Banner */}
      {apiError && (
        <div className="flex items-start gap-3 rounded-xl border border-error-200 bg-error-50 px-4 py-3 dark:border-error-500/30 dark:bg-error-500/10">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-error-500 mt-0.5 flex-shrink-0">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div className="flex-1">
            <p className="text-sm font-semibold text-error-700 dark:text-error-400">{t("apiConnectionError")}</p>
            <p className="text-xs text-error-600 dark:text-error-500 mt-0.5">{apiError}</p>
          </div>
          <button onClick={() => setApiError(null)} className="text-error-400 hover:text-error-600 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      )}

      {/* Metrics */}
      <ShipmentMetrics
        metrics={metrics}
        activeFilter={activeMetricFilter}
        onFilterChange={handleMetricFilterChange}
      />

      {/* Info bar */}
      <DashboardInfoBar
        lastUpdated={lastUpdated}
        updatedBy={updatedBy}
        onRefresh={handleRefresh}
        onExport={canExportShipments ? handleExport : undefined}
        isExporting={isExporting}
      />

      {/* Filters */}
      <ShipmentFilters
        filter={filter}
        onChange={handleFilterChange}
        supplierOptions={supplierOptions}
        carrierOptions={carrierOptions}
        portOptions={portOptions}
        searchSuggestions={searchSuggestions}
      />

      {/* Table */}
      {isLoading ? (
        <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 p-12 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-gray-400">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin text-brand-400">
              <polyline points="23 4 23 10 17 10"/>
              <polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            <p className="text-sm">{t("loadingSheet")}</p>
          </div>
        </div>
      ) : (
        <ShipmentTable key={tableResetKey} shipments={filteredShipments} onRowClick={handleRowClick} onShipmentUpdated={loadData} />
      )}
    </div>
  );
}
