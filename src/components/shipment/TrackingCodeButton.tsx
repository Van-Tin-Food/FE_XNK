"use client";

import React, { useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useSystemNotification } from "@/context/SystemNotificationContext";
import { findCarrierTrackingLink, openCarrierTracking } from "@/utils/carrierTracking";

/** Người dùng vừa kéo chuột bôi đen chữ (để copy): không coi là bấm (không mở tracking / chi tiết đơn). */
export function hasTextSelection(): boolean {
  return Boolean(typeof window !== "undefined" && window.getSelection()?.toString().trim());
}

/**
 * Mở tracking trên trang hãng tàu cho một số container (thay cho tab Hành trình cũ).
 * Link các hãng đều tra theo số container, nên B/L tra theo container đầu tiên của B/L.
 */
function useCarrierTracking(carrier?: string | null) {
  const { can } = useAuth();
  const { t } = useLanguage();
  const { notify } = useSystemNotification();
  const [isOpening, setIsOpening] = useState(false);
  const openingRef = useRef(false);
  const trackingLink = findCarrierTrackingLink(carrier);
  const canTrack = can("tracking") && Boolean(trackingLink);

  const open = async (containerCode: string, billCode: string) => {
    if (openingRef.current) return;
    if (!containerCode) {
      notify(t("trackingNoContainer", { bill: billCode }), "warning");
      return;
    }
    openingRef.current = true;
    setIsOpening(true);
    try {
      const result = await openCarrierTracking(carrier, containerCode, (message) => notify(message, "error"));
      if (result === "blocked") notify(t("trackingPopupBlocked"), "warning");
    } finally {
      openingRef.current = false;
      setIsOpening(false);
    }
  };

  // Không có quyền tracking: chữ thường, không gợi ý. Có quyền nhưng hãng chưa hỗ trợ: tooltip giải thích.
  const unsupportedHint = can("tracking") && carrier && !trackingLink ? t("trackingCarrierUnsupported", { carrier }) : undefined;
  return { canTrack, isOpening, open, carrierName: trackingLink?.name || "", unsupportedHint, t };
}

const EXTERNAL_ICON = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-60" aria-hidden="true">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

type TrackingBill = { ma_bl: string; carrier?: { ten_hang_tau?: string | null } | null; containers: Array<{ ma_container: string }> };

/**
 * Một cụm B/L (dòng trên) + container (dòng dưới). trackable: bấm vào cụm là mở tracking (bảng danh sách đơn);
 * kéo chuột bôi đen để copy thì không mở. Không trackable (trang chi tiết đơn): chỉ là chữ.
 */
function BillTrackingGroup({ bill, maxContainers, trackable }: { bill: TrackingBill; maxContainers?: number; trackable: boolean }) {
  const carrier = bill.carrier?.ten_hang_tau;
  const { canTrack, isOpening, open, carrierName, unsupportedHint, t } = useCarrierTracking(carrier);
  const billCode = bill.ma_bl?.trim() || "";
  const containers = bill.containers.map((container) => container.ma_container?.trim()).filter(Boolean);
  const shown = maxContainers ? containers.slice(0, maxContainers) : containers;
  const hidden = containers.slice(shown.length);
  const target = containers[0] || "";
  const isTracking = trackable && canTrack;

  const content = (
    <>
      {billCode && (
        <span className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 break-all font-semibold text-gray-800 dark:text-gray-200">{billCode}</span>
          {isTracking && EXTERNAL_ICON}
        </span>
      )}
      {shown.length > 0 && (
        <span className="block min-w-0 break-all text-[11px] text-cyan-700 dark:text-cyan-300" title={containers.join(", ")}>
          {shown.join(", ")}
          {hidden.length > 0 && <span className="text-gray-400">{`, +${hidden.length}`}</span>}
        </span>
      )}
    </>
  );

  if (!isTracking) {
    return <div className="min-w-0 select-text font-mono text-xs" title={trackable ? unsupportedHint : undefined}>{content}</div>;
  }
  const startTracking = () => {
    if (!isOpening) void open(target, billCode);
  };
  // div role="button" (không dùng thẻ button) để vẫn kéo chuột bôi đen copy được số B/L / container.
  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={isOpening || undefined}
      onClick={(event) => {
        // Nằm trong dòng bảng / thẻ bấm được: không mở chi tiết đơn.
        event.stopPropagation();
        if (!hasTextSelection()) startTracking();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          startTracking();
        }
      }}
      title={t("trackingOpenHint", { code: target || billCode, carrier: carrierName })}
      className={`-mx-1 block w-[calc(100%+0.5rem)] min-w-0 cursor-pointer select-text rounded-md px-1 py-0.5 text-left font-mono text-xs transition-colors hover:bg-brand-50 dark:hover:bg-brand-500/10 ${isOpening ? "cursor-wait opacity-60" : ""}`}
    >
      {content}
    </div>
  );
}

/** Danh sách B/L và container của một đơn: bảng danh sách đơn (bấm để tracking), tab Tổng quan (chỉ chữ). */
export function BillContainerTrackingList({
  bills,
  maxContainers,
  emptyText = "—",
  trackable = true,
}: {
  bills: TrackingBill[];
  /** Giới hạn số container hiện mỗi B/L (bảng danh sách); còn lại gộp thành +N. */
  maxContainers?: number;
  emptyText?: string;
  /** false: chỉ hiện chữ (bôi đen copy được), bấm không mở tracking. */
  trackable?: boolean;
}) {
  const visibleBills = bills.filter((bill) => bill.ma_bl?.trim() || bill.containers.some((container) => container.ma_container?.trim()));
  if (visibleBills.length === 0) return <span className="text-xs text-gray-400">{emptyText}</span>;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {visibleBills.map((bill, billIndex) => (
        <BillTrackingGroup key={`${bill.ma_bl}-${billIndex}`} bill={bill} maxContainers={maxContainers} trackable={trackable} />
      ))}
    </div>
  );
}
