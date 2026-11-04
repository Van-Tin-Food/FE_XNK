"use client";

import AvatarText from "@/components/ui/avatar/AvatarText";
import { Dropdown } from "@/components/ui/dropdown/Dropdown";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { leavePresence, sendPresenceHeartbeat } from "@/services/presenceApi";
import { isOnSamePage, othersOnline, presencePageLabel, type OnlineUser } from "@/utils/presence";
import { usePathname } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * TẠM TẮT (người dùng chốt 04/11/2026): mỗi tab gửi ~2 request / phút qua gateway Vercel. Bật lại (true) khi FE có host
 * riêng. Tắt thì AppHeader không gắn component nên không có request nào tới /api/presence.
 */
export const ONLINE_USERS_ENABLED = false;

// Nhịp 30 giây / tab; BE coi tab đã đóng sau 90 giây không có nhịp (presenceService.TTL_MS).
const HEARTBEAT_INTERVAL_MS = 30 * 1000;
// Số avatar hiện trước "+N": điện thoại 1, từ sm 3, từ lg 4 (hàng nút header ở 375px chỉ còn chỗ cho một avatar).
const VISIBLE_BY_BREAKPOINT = { base: 1, sm: 3, lg: 4 } as const;

/** Mã riêng cho mỗi lần mở tab (không lưu sessionStorage: nhân bản tab sẽ chép trùng mã). */
function createTabId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `tab-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Avatar thứ index (0-based) chỉ hiện từ breakpoint nào. */
function avatarVisibility(index: number): string {
  if (index < VISIBLE_BY_BREAKPOINT.base) return "flex";
  if (index < VISIBLE_BY_BREAKPOINT.sm) return "hidden sm:flex";
  return "hidden lg:flex";
}

/**
 * Avatar những người khác đang mở hệ thống (như Google Drive / Sheets). Người đang cùng trang với mình có viền màu và
 * đứng đầu. Bấm vào để xem danh sách đầy đủ + trang mỗi người đang xem (thay cho tooltip khi dùng màn hình cảm ứng).
 */
export default function OnlineUsers() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const token = user?.token;
  const pathname = usePathname() || "/";
  const [users, setUsers] = useState<OnlineUser[]>([]);
  const [hasError, setHasError] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const pathRef = useRef(pathname);
  const beatRef = useRef<(() => void) | null>(null);

  // Mỗi phiên (token) một mã tab: đổi token / đăng xuất thì báo rời bằng mã cũ, nhịp mới dùng mã mới nên hai request
  // không đè nhau ở BE.
  useEffect(() => {
    if (!token) return undefined;
    const tabId = createTabId();
    let active = true;
    let inFlight = false;

    const beat = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const list = await sendPresenceHeartbeat(token, tabId, pathRef.current);
        if (!active) return;
        setUsers(list);
        setHasError(false);
      } catch {
        // Giữ danh sách lần trước, nhịp sau thử lại; không làm phiền người dùng bằng thông báo lỗi.
        if (active) setHasError(true);
      } finally {
        inFlight = false;
      }
    };
    beatRef.current = () => void beat();

    const timer = window.setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void beat();
    };
    const handlePageHide = () => leavePresence(token, tabId);
    // Quay lại trang từ bộ nhớ đệm back/forward của trình duyệt: trang không tải lại nên phải tự gửi nhịp.
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void beat();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    void beat();

    return () => {
      active = false;
      beatRef.current = null;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      leavePresence(token, tabId);
    };
  }, [token]);

  // Chuyển trang: báo ngay để người khác thấy mình đang ở trang mới (không chờ nhịp 30 giây).
  useEffect(() => {
    if (pathRef.current === pathname) return;
    pathRef.current = pathname;
    beatRef.current?.();
  }, [pathname]);

  const others = useMemo(() => othersOnline(users, pathname), [users, pathname]);
  const me = useMemo(() => users.find((item) => item.isMe) || null, [users]);
  const closeDropdown = useCallback(() => setIsOpen(false), []);

  const pageName = useCallback((path: string) => {
    const label = presencePageLabel(path);
    return label ? t(label.key, label.vars) : path;
  }, [t]);

  // Chỉ có mình mình (hoặc chưa tải được): không hiện gì, như Google Drive.
  if (others.length === 0) return null;

  const totalOnline = users.length;
  const shown = others.slice(0, VISIBLE_BY_BREAKPOINT.lg);
  // Điện thoại: số người còn lại là chấm đếm đè góc avatar (không thêm ô tròn, hàng nút header không đủ chỗ).
  const mobileExtra = others.length - VISIBLE_BY_BREAKPOINT.base;
  const extraBadges = [
    { count: others.length - VISIBLE_BY_BREAKPOINT.sm, className: "hidden sm:flex lg:hidden" },
    { count: others.length - VISIBLE_BY_BREAKPOINT.lg, className: "hidden lg:flex" },
  ].filter((badge) => badge.count > 0);

  const tooltip = (item: OnlineUser) => `${item.name}${item.email ? ` (${item.email})` : ""}\n${t("onlineUsersViewing", { page: pageName(item.path) })}`;

  const renderRow = (item: OnlineUser) => {
    const samePage = !item.isMe && isOnSamePage(item, pathname);
    return (
      <li key={item.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
        <span className="relative shrink-0">
          <AvatarText name={item.name} className={`h-9! w-9! ${samePage ? "ring-2 ring-brand-500 ring-offset-2 ring-offset-white dark:ring-offset-gray-900" : ""}`} />
          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-success-500 ring-2 ring-white dark:ring-gray-900" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-100" title={item.name}>{item.name}</span>
            {item.isMe && <span className="shrink-0 text-xs text-gray-400">({t("onlineUsersYou")})</span>}
            {samePage && (
              <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                {t("onlineUsersSamePage")}
              </span>
            )}
          </span>
          {item.email && <span className="block truncate text-xs text-gray-500 dark:text-gray-400" title={item.email}>{item.email}</span>}
          <span className="block truncate text-xs text-gray-400 dark:text-gray-500" title={pageName(item.path)}>
            {t("onlineUsersViewing", { page: pageName(item.path) })}
          </span>
        </span>
      </li>
    );
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-label={`${t("onlineUsersOpen")} — ${t("onlineUsersCount", { count: totalOnline })}`}
        className="dropdown-toggle relative flex h-10 items-center rounded-full p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 lg:h-11"
      >
        {mobileExtra > 0 && (
          <span
            title={t("onlineUsersMore", { count: mobileExtra })}
            className="absolute -right-1 -top-1 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-gray-700 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:bg-gray-200 dark:text-gray-900 dark:ring-gray-900 sm:hidden"
          >
            +{mobileExtra}
          </span>
        )}
        <span className="flex -space-x-2">
          {shown.map((item, index) => {
            const samePage = isOnSamePage(item, pathname);
            return (
              <span key={item.id} title={tooltip(item)} className={`presence-avatar-enter relative shrink-0 ${avatarVisibility(index)}`}>
                <AvatarText
                  name={item.name}
                  className={`h-8! w-8! ring-2 lg:h-9! lg:w-9! ${samePage ? "ring-brand-500" : "ring-white dark:ring-gray-900"}`}
                />
                <span className="presence-dot absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-success-500 ring-2 ring-white dark:ring-gray-900" aria-hidden="true" />
              </span>
            );
          })}
          {extraBadges.map((badge) => (
            <span
              key={badge.className}
              title={t("onlineUsersMore", { count: badge.count })}
              className={`${badge.className} relative h-8 min-w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 px-1.5 text-xs font-semibold text-gray-600 ring-2 ring-white dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-900 lg:h-9 lg:min-w-9`}
            >
              +{badge.count}
            </span>
          ))}
        </span>
      </button>

      {/* Dưới lg nút nằm ở hàng menu thu gọn: hộp cố định theo bề ngang màn hình để không bị cắt (như hộp thông báo). */}
      <Dropdown
        isOpen={isOpen}
        onClose={closeDropdown}
        className="flex flex-col p-3 max-lg:fixed max-lg:inset-x-3 max-lg:top-[140px] max-lg:mt-0 max-lg:max-h-[calc(100dvh-156px)] lg:right-0 lg:mt-[17px] lg:max-h-[70dvh] lg:w-[340px]"
      >
        <div className="mb-2 flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-2 pb-3 dark:border-gray-700">
          <div className="min-w-0">
            <h5 className="flex items-center gap-2 text-base font-semibold text-gray-800 dark:text-gray-200">
              <span className="h-2 w-2 rounded-full bg-success-500" aria-hidden="true" />
              {t("onlineUsersTitle")}
            </h5>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t("onlineUsersCount", { count: totalOnline })}</p>
            {hasError && <p className="mt-1 text-xs text-error-500">{t("onlineUsersLoadError")}</p>}
          </div>
          <button
            type="button"
            onClick={closeDropdown}
            aria-label={t("close")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-2xl leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            ×
          </button>
        </div>
        <ul className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
          {others.map(renderRow)}
          {me && renderRow(me)}
        </ul>
      </Dropdown>
    </div>
  );
}
