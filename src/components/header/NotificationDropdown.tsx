"use client";

import { Modal } from "@/components/ui/modal";
import {
  getNotifications,
  markNotificationsRead,
  NOTIFICATIONS_SYNC_EVENT,
} from "@/services/shipmentApi";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dropdown } from "../ui/dropdown/Dropdown";
import { DropdownItem } from "../ui/dropdown/DropdownItem";
import { useLanguage } from "@/context/LanguageContext";

type NotificationKind = "delivered" | "route_warning";

type NotificationRow = {
  id_thong_bao?: string | number;
  name?: string;
  order_code?: string;
  type?: string;
  missing_docs?: string;
  mss_docs?: string;
  message?: string;
  updated_by?: string;
  update_by?: string;
  status?: string | number;
  date_time?: string;
};

type NotificationItem = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  orderCode: string;
  missingDocs?: string;
  updatedBy?: string;
  status: string;
  time: string;
};

function normalizeType(value?: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getNotificationKind(row: NotificationRow): NotificationKind | null {
  const values = [normalizeType(row.type), normalizeType(row.name)].filter(Boolean);
  const delivered = values.some((value) =>
    ["HOAN_THANH", "DON_HANG_HOAN_THANH", "DON_THANH_CONG", "GIAO_THANH_CONG", "DELIVERED", "COMPLETED", "ORDER_COMPLETED"].includes(value)
    || value.includes("HOAN_THANH")
    || value.includes("THANH_CONG"),
  );
  if (delivered) return "delivered";

  const exceeded = values.some((value) =>
    ["VUOT_LO_TRINH", "THIEU_CHUNG_TU", "VUOT_TIEN_DO", "OVERDUE", "PROGRESS_EXCEEDED"].includes(value)
    || value.includes("VUOT_LO_TRINH")
    || value.includes("VUOT_TIEN_DO"),
  );
  return exceeded ? "route_warning" : null;
}

function mapRows(rows: NotificationRow[], translate: (key: string, variables?: Record<string, string | number>) => string): NotificationItem[] {
  return rows
    .map((row, index): NotificationItem | null => {
      const type = normalizeType(row.type || row.name);
      const kind = getNotificationKind(row);
      if (!kind) return null;
      const orderCode = String(row.order_code || "").trim();
      const missingDocs = String(row.missing_docs || row.mss_docs || "").trim();
      const message = String(row.message || "").trim();
      const time = String(row.date_time || "").trim();
      const updatedBy = String(row.updated_by || row.update_by || "").trim();
      const delivered = kind === "delivered";
      const title = String(row.name || "").trim() || (delivered
        ? translate("delivered")
        : translate("routeWarning"));
      const body = message || (delivered
        ? translate("deliveredBody", { orderCode })
        : `${translate("routeWarningBody", { orderCode })}${missingDocs ? `. ${translate("missingSuffix")}: ${missingDocs}` : ""}`);

      return {
        id: String(row.id_thong_bao ?? `${type}-${orderCode}-${time}-${index}`),
        kind,
        title,
        body,
        orderCode,
        missingDocs: missingDocs || undefined,
        updatedBy: updatedBy || undefined,
        status: String(row.status ?? ""),
        time,
      };
    })
    .filter((item): item is NotificationItem => item !== null)
    .sort((a, b) => {
      const timeA = Date.parse(a.time);
      const timeB = Date.parse(b.time);
      return (Number.isFinite(timeB) ? timeB : 0) - (Number.isFinite(timeA) ? timeA : 0);
    });
}

function isUnreadRow(row: NotificationRow): boolean {
  return String(row.status ?? "") === "0";
}

function isUnread(item: NotificationItem): boolean {
  return item.status === "0";
}

function formatTime(value: string, language: "vi" | "en"): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(language === "en" ? "en-GB" : "vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getNotificationKey(item: NotificationItem, index: number): string {
  return `${item.id}-${item.orderCode}-${item.time}-${index}`;
}

function badgeTone(kind: NotificationKind): string {
  if (kind === "delivered") return "bg-success-500";
  return "bg-warning-500";
}

export default function NotificationDropdown() {
  const { language, t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Giữ dữ liệu gốc từ API; đổi ngôn ngữ chỉ dựng lại nội dung, không gọi lại API.
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const notifications = useMemo(() => mapRows(rows, t), [rows, t]);
  const [loading, setLoading] = useState(true);
  // "" = không lỗi; null = lỗi không có nội dung, hiển thị câu mặc định theo ngôn ngữ.
  const [errorMessage, setErrorMessage] = useState<string | null>("");
  const error = errorMessage === null ? t("loadingNotifications") : errorMessage;
  const rowsRef = useRef<NotificationRow[]>([]);
  const [hasNewNotification, setHasNewNotification] = useState(false);
  const [orderFilter, setOrderFilter] = useState("");
  const markingReadRef = useRef(false);

  const applyRows = useCallback((nextRows: NotificationRow[], announce = false) => {
    rowsRef.current = nextRows;
    setRows(nextRows);
    setErrorMessage("");
    setLoading(false);
    if (announce && nextRows.some(isUnreadRow)) setHasNewNotification(true);
  }, []);

  const refreshNotifications = useCallback(async (announce = false): Promise<NotificationRow[] | null> => {
    try {
      const nextRows = await getNotifications() as NotificationRow[];
      applyRows(nextRows, announce);
      return nextRows;
    } catch (refreshError) {
      setLoading(false);
      setErrorMessage(refreshError instanceof Error ? refreshError.message : null);
      return null;
    }
  }, [applyRows]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshNotifications(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshNotifications]);

  useEffect(() => {
    const handleUploadSync = () => void refreshNotifications(true);

    window.addEventListener(NOTIFICATIONS_SYNC_EVENT, handleUploadSync);
    return () => window.removeEventListener(NOTIFICATIONS_SYNC_EVENT, handleUploadSync);
  }, [refreshNotifications]);

  const filteredNotifications = useMemo(() => {
    const query = orderFilter.trim().toLowerCase();
    return query ? notifications.filter((item) => item.orderCode.toLowerCase().includes(query)) : notifications;
  }, [notifications, orderFilter]);
  const latestThree = useMemo(() => filteredNotifications.slice(0, 3), [filteredNotifications]);
  const unreadCount = useMemo(() => notifications.filter(isUnread).length, [notifications]);

  const markUnreadAsRead = useCallback(async () => {
    if (markingReadRef.current) return;
    markingReadRef.current = true;
    try {
      // Tải mới một lần để có thông báo vừa phát sinh, rồi đánh dấu đã đọc bằng một request.
      const latest = await refreshNotifications() || rowsRef.current;
      const unreadIds = latest
        .filter((row) => isUnreadRow(row) && row.id_thong_bao !== undefined && row.id_thong_bao !== null)
        .map((row) => row.id_thong_bao as string | number);
      if (unreadIds.length === 0) return;
      await markNotificationsRead(unreadIds);
      const readIds = new Set(unreadIds.map(String));
      applyRows(latest.map((row) => readIds.has(String(row.id_thong_bao)) ? { ...row, status: 1 } : row));
    } catch (markError) {
      setErrorMessage(markError instanceof Error ? markError.message : t("markReadError"));
    } finally {
      markingReadRef.current = false;
    }
  }, [applyRows, refreshNotifications, t]);

  const handleToggle = () => {
    const willOpen = !isOpen;
    setHasNewNotification(false);
    setIsOpen(willOpen);
    if (willOpen) void markUnreadAsRead();
  };

  const handleViewAll = () => {
    setIsModalOpen(true);
    setIsOpen(false);
  };

  const renderNotification = (item: NotificationItem, index: number, compact = false) => (
    <div key={getNotificationKey(item, index)} className="flex gap-3 rounded-xl border border-gray-100 p-3 dark:border-gray-800">
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
        <span className={`h-2.5 w-2.5 rounded-full ${badgeTone(item.kind)}`} />
        {isUnread(item) && <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-brand-500 ring-2 ring-white dark:ring-gray-800" />}
      </span>
      <span className="block min-w-0 flex-1">
        <span className="mb-1 block text-sm font-medium text-gray-800 dark:text-white/90">{item.title}</span>
        <span className={`block text-xs text-gray-500 dark:text-gray-400 ${compact ? "line-clamp-2" : ""}`}>{item.body}</span>
        {/* {item.updatedBy && !compact && (
          <span className="mt-1 block text-xs font-medium text-amber-700 dark:text-amber-400">{t("notificationStage", { stage: item.updatedBy })}</span>
        )} */}
        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
          <span className="font-medium text-gray-600 dark:text-gray-300">{item.orderCode || "—"}</span>
          <span className="h-1 w-1 rounded-full bg-gray-400" />
          <span>{formatTime(item.time, language)}</span>
        </span>
      </span>
    </div>
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleToggle}
        title={t("notifications")}
        className="relative flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
      >
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-error-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
        <svg className="fill-current" width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path fillRule="evenodd" clipRule="evenodd" d="M10.75 2.29248C10.75 1.87827 10.4143 1.54248 10 1.54248C9.58583 1.54248 9.25004 1.87827 9.25004 2.29248V2.83613C6.08266 3.20733 3.62504 5.9004 3.62504 9.16748V14.4591H3.33337C2.91916 14.4591 2.58337 14.7949 2.58337 15.2091C2.58337 15.6234 2.91916 15.9591 3.33337 15.9591H16.6667C17.0809 15.9591 17.4167 15.6234 17.4167 15.2091C17.4167 14.7949 17.0809 14.4591 16.6667 14.4591H16.375V9.16748C16.375 5.9004 13.9174 3.20733 10.75 2.83613V2.29248ZM14.875 14.4591V9.16748C14.875 6.47509 12.6924 4.29248 10 4.29248C7.30765 4.29248 5.12504 6.47509 5.12504 9.16748V14.4591H14.875ZM8.00004 17.7085C8.00004 18.1228 8.33583 18.4585 8.75004 18.4585H11.25C11.6643 18.4585 12 18.1228 12 17.7085C12 17.2943 11.6643 16.9585 11.25 16.9585H8.75004C8.33583 16.9585 8.00004 17.2943 8.00004 17.7085Z" />
        </svg>
      </button>

      {/* Dưới lg chuông nằm ở hàng menu thu gọn: hộp thông báo cố định theo bề ngang màn hình để không bị cắt. */}
      <Dropdown isOpen={isOpen} onClose={() => setIsOpen(false)} className="flex flex-col rounded-2xl border border-gray-200 bg-white p-3 shadow-theme-lg dark:border-gray-800 dark:bg-gray-dark max-lg:fixed max-lg:inset-x-3 max-lg:top-[140px] max-lg:mt-0 max-lg:max-h-[calc(100dvh-156px)] lg:right-0 lg:mt-[17px] lg:max-h-[80dvh] lg:w-[361px]">
        <div className="mb-3 flex shrink-0 items-center justify-between border-b border-gray-100 pb-3 dark:border-gray-700">
          <div>
            <h5 className="text-lg font-semibold text-gray-800 dark:text-gray-200">{t("notifications")}</h5>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t("unreadNotifications", { count: unreadCount })}</p>
          </div>
          <button type="button" onClick={() => setIsOpen(false)} aria-label={t("closeNotifications")} className="text-2xl leading-none text-gray-500 hover:text-gray-700 dark:text-gray-400">×</button>
        </div>

        <div className="min-h-0 overflow-y-auto overscroll-contain pr-1 custom-scrollbar">
          <div className="mb-3">
            <label className="sr-only" htmlFor="notification-order-filter">Lọc theo mã đơn hàng</label>
            <input
              id="notification-order-filter"
              value={orderFilter}
              onChange={(event) => setOrderFilter(event.target.value)}
              placeholder="Lọc theo mã đơn hàng..."
              className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 text-xs text-gray-700 outline-none transition focus:border-brand-400 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            />
          </div>
          {hasNewNotification && <div className="mb-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">{t("newUploadNotification")}</div>}
          {error && <div className="mb-2 rounded-lg border border-error-200 bg-error-50 px-3 py-2 text-xs font-medium text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">{error}</div>}

          {loading ? (
            <div className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500 dark:bg-white/[0.02] dark:text-gray-400">{t("loadingNotifications")}</div>
          ) : latestThree.length === 0 ? (
            <div className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500 dark:bg-white/[0.02] dark:text-gray-400">{t("noNotifications")}</div>
          ) : (
            <div className="flex flex-col gap-2">
              {latestThree.map((item, index) => (
                <DropdownItem key={getNotificationKey(item, index)} onItemClick={() => setIsOpen(false)} className="block rounded-xl p-0 hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                  {renderNotification(item, index, true)}
                </DropdownItem>
              ))}
            </div>
          )}

          {notifications.length > 0 && (
            <button type="button" onClick={handleViewAll} className="mt-3 w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700">
              {t("viewAllNotifications")}
            </button>
          )}
        </div>
      </Dropdown>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden" className="mx-4 my-4 flex h-[90dvh] max-h-[720px] max-w-3xl flex-col overflow-hidden">
        <div className="shrink-0 border-b border-gray-100 px-6 pb-4 pt-6 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t("allNotifications")}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("systemNotificationCount", { count: notifications.length })}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5 custom-scrollbar">
          {error && (
            <div className="mb-3 rounded-lg border border-error-200 bg-error-50 px-3 py-2 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">
              {error}
            </div>
          )}
          <div className="flex flex-col gap-2">
            {filteredNotifications.length > 0
              ? filteredNotifications.map((item, index) => renderNotification(item, index))
              : <p className="py-8 text-center text-sm text-gray-400">{t("noNotifications")}</p>}
          </div>
        </div>
      </Modal>
    </div>
  );
}
