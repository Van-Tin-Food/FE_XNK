"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import React, { useEffect, useRef, useState } from "react";
import ReloadHomeLink from "../components/common/ReloadHomeLink";
import logoMark from "../icons/logo-vtf-mark.png";
import { useAuth } from "../context/AuthContext";
import { useSidebar } from "../context/SidebarContext";
import { GridIcon } from "../icons/index";
import { useLanguage } from "../context/LanguageContext";
import { useShipmentListResetLinks } from "../utils/shipmentListState";
import { canOpenPaymentRequests } from "../utils/paymentRequest";

const MARKET_RESEARCH_HREF = "https://script.google.com/a/macros/vantinfood.vn/s/AKfycbx9gxbHB-b5UMbF6x9NrdDmc-abshieQ5pZfhFQRbHXhLGw-Cxv91kkssrmz0hZBabNXA/exec";
const LEGACY_ETA_HREF = "https://script.google.com/a/macros/vantinfood.vn/s/AKfycbwlTy4uv4eGx5beJfLKRwJj-VW0H5uFxSeRbhGOstoGn4bPjjJ2-0E0xqwghxvB3R3_7g/exec";
const WAREHOUSE_SYNC_HREF = "https://script.google.com/a/macros/vantinfood.vn/s/AKfycbxQU59_Qmdkq7h3OPjK4r2OQbbHIQXi4SWK5OZWyjOj3JH4HJPE4Jl6AHnI9vZi3PiGUQ/exec";

const ICON_PROPS = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

const PaymentIcon = () => <svg {...ICON_PROPS}><path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z" /><path d="M9 7h6M9 11h6M9 15h4" /></svg>;
const CatalogIcon = () => <svg {...ICON_PROPS}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></svg>;
const CostIcon = () => <svg {...ICON_PROPS}><path d="M4 6h16M4 12h16M4 18h10" /><circle cx="18" cy="18" r="2" /></svg>;
const ReportIcon = () => <svg {...ICON_PROPS}><path d="M3 3v18h18" /><path d="M7 15v2M11 11v6M15 8v9M19 5v12" /></svg>;
const AccountIcon = () => <svg {...ICON_PROPS}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>;
const LogIcon = () => <svg {...ICON_PROPS}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /></svg>;
const ToolIcon = () => <svg {...ICON_PROPS}><path d="M12 3v3" /><path d="M5.5 7.5 7.6 9.6" /><path d="M18.5 7.5 16.4 9.6" /><path d="M4 14h16" /><path d="M6 14a6 6 0 0 1 12 0" /><path d="M8 14v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-4" /><path d="M4 14v2a2 2 0 0 0 2 2" /><path d="M20 14v2a2 2 0 0 1-2 2" /></svg>;
const LogoutIcon = () => <svg {...ICON_PROPS}><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /></svg>;
const ExternalIcon = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="ml-auto shrink-0 opacity-60"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>;

type NavChild = { key: string; label: string; href: string; active: boolean; external?: boolean };
type NavEntry = {
  key: string;
  /** Tên đầy đủ: ngăn kéo, tooltip, tiêu đề menu bật ra. */
  label: string;
  /** Nhãn ngắn dưới icon của thanh rail. */
  shortLabel: string;
  icon: React.ReactNode;
  active: boolean;
  href?: string;
  children?: NavChild[];
  resetShipmentList?: boolean;
};

/** Vị trí menu bật ra cạnh rail: mục ở nửa dưới màn hình thì neo đáy để menu không tràn khỏi màn hình. */
type Flyout = { key: string; route: string; top?: number; bottom?: number };

/**
 * Nav:
 * - Dưới 1024px: ngăn kéo 290px (nút ☰ trên header), nhóm mở / thu tại chỗ, chọn trang là tự đóng.
 * - 1024–1679px: thanh rail cố định 90px (icon + nhãn ngắn); mục có trang con bấm vào thì menu bật ra bên phải rail
 *   (bấm ra ngoài / Esc / chọn trang là đóng). Không mở rộng, nội dung luôn rộng như nhau.
 * - Từ 1680px (màn 24"/27"): nav đầy đủ 290px như cũ (cùng phần hiển thị với ngăn kéo); ☰ thu về rail (`isExpanded`).
 */
const AppSidebar: React.FC = () => {
  const { user, can, logout } = useAuth();
  const { isMobileOpen, isExpanded, closeMobileSidebar } = useSidebar();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const route = `${pathname}?${searchParams.toString()}`;
  const catalog = searchParams.get("catalog") || "";
  const logTab = searchParams.get("tab");
  const { t } = useLanguage();
  // Bấm logo (sidebar, header) hoặc menu "Mua hàng & ETA": danh sách đơn về bộ lọc mặc định.
  useShipmentListResetLinks();

  // Menu hiện theo quyền thực tế của tài khoản (mức view trở lên), không theo tên role.
  const canViewLogs = can("activityLogs");
  const canViewEmailTools = can("email");
  const canViewDocumentSync = can("documentSync");
  const canViewMarketResearch = can("marketResearch");
  const canViewLegacyEta = can("legacyEtaOrders");
  const canManageUsers = can("users");
  const canViewSuppliers = can("catalogSuppliers");
  const canViewCarriers = can("catalogCarriers");
  const canViewWarehouses = can("catalogWarehouses");
  const canViewPaymentCategories = can("paymentCategories");
  const canViewPaymentRequests = can("paymentRequests");
  // Menu Đề nghị thanh toán: thêm người được uỷ quyền duyệt / xác nhận chứng từ (khớp quyền xem danh sách ở BE).
  const canOpenPaymentRequestList = canOpenPaymentRequests(can);
  // Mục Báo cáo: báo cáo chi phí — quyền costReports (admin cấp riêng cho từng tài khoản).
  const canViewCostReport = Number(user?.id) === 1;
  // Giao dịch ngân hàng (thử nghiệm đối soát SePay) — quyền bankTransactions (admin cấp riêng).
  const canViewBankTransactions = can("bankTransactions");

  const onMasterData = pathname === "/master-data";
  const group = (entry: Omit<NavEntry, "active" | "children">, children: Array<NavChild | false>): NavEntry | null => {
    const visible = children.filter((child): child is NavChild => Boolean(child));
    return visible.length ? { ...entry, children: visible, active: visible.some((child) => child.active) } : null;
  };
  const entries = [
    {
      key: "orders", label: t("importExport"), shortLabel: t("navShortOrders"), icon: <GridIcon />, href: "/",
      active: pathname === "/" || pathname.startsWith("/shipments/"), resetShipmentList: true,
    },
    canOpenPaymentRequestList && {
      key: "paymentRequests", label: t("paymentRequests"), shortLabel: t("navShortPayments"), icon: <PaymentIcon />,
      href: "/payment-requests", active: pathname.startsWith("/payment-requests"),
    },
    group({ key: "catalogs", label: t("masterDataManagement"), shortLabel: t("navShortCatalogs"), icon: <CatalogIcon /> }, [
      canViewSuppliers && { key: "suppliers", label: t("suppliers"), href: "/master-data?catalog=suppliers", active: onMasterData && !["carriers", "warehouses", "paymentCategories"].includes(catalog) },
      canViewCarriers && { key: "carriers", label: t("carriers"), href: "/master-data?catalog=carriers", active: onMasterData && catalog === "carriers" },
      canViewWarehouses && { key: "warehouses", label: t("warehouses"), href: "/master-data?catalog=warehouses", active: onMasterData && catalog === "warehouses" },
    ]),
    group({ key: "costs", label: t("costManagement"), shortLabel: t("navShortCosts"), icon: <CostIcon /> }, [
      canViewPaymentCategories && { key: "paymentCategories", label: t("paymentCategories"), href: "/master-data?catalog=paymentCategories", active: onMasterData && catalog === "paymentCategories" },
      canViewPaymentRequests && { key: "myCosts", label: t("myCosts"), href: "/payment-costs", active: pathname.startsWith("/payment-costs") },
    ]),
    group({ key: "reports", label: t("reportsMenu"), shortLabel: t("reportsMenu"), icon: <ReportIcon /> }, [
      canViewCostReport && { key: "costReport", label: t("costPayableReport"), href: "/reports/costs", active: pathname.startsWith("/reports/costs") },
      canViewBankTransactions && { key: "bankTransactions", label: t("bankTransactionsMenu"), href: "/reports/bank-transactions", active: pathname.startsWith("/reports/bank-transactions") },
    ]),
    canManageUsers && {
      key: "accounts", label: t("accountManagement"), shortLabel: t("navShortAccounts"), icon: <AccountIcon />,
      href: "/account-management", active: pathname === "/account-management",
    },
    group({ key: "logs", label: t("logsMenu"), shortLabel: t("logsMenu"), icon: <LogIcon /> }, [
      canViewLogs && { key: "activity", label: t("operationHistory"), href: "/activity-logs?tab=activity", active: pathname === "/activity-logs" && logTab !== "email" },
      canViewLogs && { key: "emailLogs", label: t("emailLogs"), href: "/activity-logs?tab=email", active: pathname === "/activity-logs" && logTab === "email" },
    ]),
    group({ key: "tools", label: t("supportTools"), shortLabel: t("navShortTools"), icon: <ToolIcon /> }, [
      canViewEmailTools && { key: "email", label: t("emailSendButton"), href: "/email", active: pathname === "/email" },
      canViewDocumentSync && { key: "documentSync", label: t("documentSync"), href: "/document-sync", active: pathname === "/document-sync" },
      canViewMarketResearch && { key: "marketResearch", label: t("marketResearch"), href: MARKET_RESEARCH_HREF, active: false, external: true },
      canViewLegacyEta && { key: "warehouseSync", label: t("warehouseSync"), href: WAREHOUSE_SYNC_HREF, active: false, external: true },
      canViewLegacyEta && { key: "legacyEta", label: t("legacyEtaOrders"), href: LEGACY_ETA_HREF, active: false, external: true },
    ]),
  ].filter((entry): entry is NavEntry => Boolean(entry));

  // Ngăn kéo (dưới 1024px): nhóm chứa trang đang mở thì mở sẵn.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(entries.filter((entry) => entry.children && entry.active).map((entry) => entry.key)));
  const toggleGroup = (key: string) => setOpenGroups((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // Rail (từ 1024px): menu bật ra. Gắn với trang lúc mở — chuyển trang (kể cả nút Back) là menu tự ẩn.
  const [flyout, setFlyout] = useState<Flyout | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const flyoutEntry = flyout && flyout.route === route ? entries.find((entry) => entry.key === flyout.key && entry.children) : undefined;
  const flyoutKey = flyoutEntry?.key;

  useEffect(() => {
    if (!flyoutKey) return;
    const close = () => setFlyout(null);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (flyoutRef.current?.contains(target)) return;
      if (target?.closest?.(`[data-nav-flyout-trigger="${flyoutKey}"]`)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
    };
  }, [flyoutKey]);

  const toggleFlyout = (key: string, trigger: HTMLElement) => {
    if (flyoutKey === key) {
      setFlyout(null);
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const anchorBottom = rect.top > window.innerHeight * 0.55;
    setFlyout(anchorBottom ? { key, route, bottom: Math.max(8, window.innerHeight - rect.bottom) } : { key, route, top: Math.max(8, rect.top) });
  };

  const childLink = (child: NavChild, onNavigate: () => void, className: string) => child.external ? (
    <a href={child.href} target="_blank" rel="noopener noreferrer" onClick={onNavigate} className={`${className} menu-dropdown-item-inactive`}>
      <span className="min-w-0 break-words">{child.label}</span>
      <ExternalIcon />
    </a>
  ) : (
    <Link href={child.href} onClick={onNavigate} aria-current={child.active ? "page" : undefined} className={`${className} ${child.active ? "menu-dropdown-item-active" : "menu-dropdown-item-inactive"}`}>
      <span className="min-w-0 break-words">{child.label}</span>
    </Link>
  );

  const railItemClass = (highlighted: boolean) => `group relative flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2 text-center transition-colors ${
    highlighted
      ? "bg-brand-50 text-brand-600 dark:bg-brand-500/[0.12] dark:text-brand-400"
      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200"
  }`;
  const railLabel = (text: string) => <span className="line-clamp-2 w-full break-words text-[11px] font-medium leading-tight">{text}</span>;

  return (
    <>
      <aside
        aria-label={t("features")}
        className={`fixed left-0 top-0 z-50 mt-16 flex h-[calc(100vh-4rem)] w-[290px] flex-col border-r border-gray-200 bg-white text-gray-900 transition-[transform,width] duration-300 ease-in-out dark:border-gray-800 dark:bg-gray-900 lg:mt-0 lg:h-screen lg:w-[90px] lg:translate-x-0
          ${isExpanded ? "min-[1680px]:w-[290px]" : ""}
          ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* ===== Danh sách đầy đủ: ngăn kéo dưới 1024px, và nav mở rộng từ 1680px ===== */}
        <div className={`flex min-h-0 flex-1 flex-col px-5 lg:hidden ${isExpanded ? "min-[1680px]:flex" : ""}`}>
          <div className="flex py-6">
            {/* Bấm logo là tải lại trang: dữ liệu và phân quyền đều được đọc lại. */}
            <ReloadHomeLink ariaLabel="Trang quản lý xuất nhập khẩu" title={t("reloadApp")} className="flex h-10 items-center gap-3 font-semibold text-gray-900 dark:text-white">
              <Image src={logoMark} alt="Vạn Tín Food" width={40} height={40} priority className="h-10 w-10 shrink-0 object-contain" />
              <span>{t("importExportManagement")}</span>
            </ReloadHomeLink>
          </div>
          <nav className="mb-4 min-h-0 flex-1 overflow-y-auto">
            <h2 className="mb-4 text-xs uppercase leading-5 text-gray-400">{t("features")}</h2>
            <ul className="flex flex-col gap-2">
              {entries.map((entry) => {
                const iconClass = entry.active ? "menu-item-icon-active" : "menu-item-icon-inactive";
                if (!entry.children) {
                  return (
                    <li key={entry.key}>
                      <Link href={entry.href!} onClick={closeMobileSidebar} data-shipment-list-reset={entry.resetShipmentList ? "" : undefined} aria-current={entry.active ? "page" : undefined} className={`menu-item group ${entry.active ? "menu-item-active" : "menu-item-inactive"}`}>
                        <span className={iconClass}>{entry.icon}</span>
                        <span className="menu-item-text">{entry.label}</span>
                      </Link>
                    </li>
                  );
                }
                const open = openGroups.has(entry.key);
                return (
                  <li key={entry.key}>
                    <button type="button" onClick={() => toggleGroup(entry.key)} aria-expanded={open} className={`menu-item group ${entry.active ? "menu-item-active" : "menu-item-inactive"}`}>
                      <span className={iconClass}>{entry.icon}</span>
                      <span className="menu-item-text text-left">{entry.label}</span>
                      <span className="ml-auto text-xs" aria-hidden="true">{open ? "−" : "+"}</span>
                    </button>
                    {open && (
                      <ul className="mt-1 space-y-1 pl-11">
                        {entry.children.map((child) => <li key={child.key}>{childLink(child, closeMobileSidebar, "menu-dropdown-item")}</li>)}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="border-t border-gray-200 py-4 dark:border-gray-800">
            <button type="button" onClick={logout} className="menu-item group text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-300">
              <span className="shrink-0"><LogoutIcon /></span>
              <span className="menu-item-text">{t("logout")}</span>
            </button>
          </div>
        </div>

        {/* ===== Thanh rail: từ 1024px (từ 1680px chỉ khi đã thu gọn nav) ===== */}
        <div className={`hidden min-h-0 flex-1 flex-col items-center px-2 lg:flex ${isExpanded ? "min-[1680px]:hidden" : ""}`}>
          <div className="flex justify-center py-5">
            <ReloadHomeLink ariaLabel="Trang quản lý xuất nhập khẩu" title={t("reloadApp")} className="flex h-10 w-10 items-center justify-center">
              <Image src={logoMark} alt="Vạn Tín Food" width={40} height={40} priority className="h-10 w-10 shrink-0 object-contain" />
            </ReloadHomeLink>
          </div>
          <nav className="custom-scrollbar min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden pb-3" onScroll={() => setFlyout(null)}>
            <ul className="flex flex-col gap-1">
              {entries.map((entry) => {
                const flyoutOpen = flyoutKey === entry.key;
                const iconClass = entry.active || flyoutOpen ? "text-brand-500 dark:text-brand-400" : "text-gray-500 group-hover:text-gray-700 dark:text-gray-400 dark:group-hover:text-gray-200";
                if (!entry.children) {
                  return (
                    <li key={entry.key}>
                      <Link href={entry.href!} title={entry.label} data-shipment-list-reset={entry.resetShipmentList ? "" : undefined} aria-current={entry.active ? "page" : undefined} className={railItemClass(entry.active)}>
                        <span className={iconClass}>{entry.icon}</span>
                        {railLabel(entry.shortLabel)}
                      </Link>
                    </li>
                  );
                }
                return (
                  <li key={entry.key}>
                    <button
                      type="button"
                      title={entry.label}
                      data-nav-flyout-trigger={entry.key}
                      aria-haspopup="true"
                      aria-expanded={flyoutOpen}
                      aria-controls={flyoutOpen ? "nav-flyout" : undefined}
                      onClick={(event) => toggleFlyout(entry.key, event.currentTarget)}
                      className={`${railItemClass(entry.active || flyoutOpen)} ${flyoutOpen ? "ring-1 ring-brand-200 dark:ring-brand-500/30" : ""}`}
                    >
                      <span className={iconClass}>{entry.icon}</span>
                      {railLabel(entry.shortLabel)}
                      {/* Mũi tên nhỏ: mục này mở menu con. */}
                      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" className="absolute right-1 top-1/2 -translate-y-1/2 opacity-50"><path d="M2.5 1.5 5 4 2.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="w-full border-t border-gray-200 py-3 dark:border-gray-800">
            <button type="button" onClick={logout} title={t("logout")} className="flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2 text-center text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-300">
              <LogoutIcon />
              {railLabel(t("logout"))}
            </button>
          </div>
        </div>
      </aside>

      {/* Menu con bật ra cạnh rail; nằm ngoài <aside> (transform) để định vị theo màn hình và nổi trên header. */}
      {flyoutEntry?.children && (
        <div
          ref={flyoutRef}
          id="nav-flyout"
          aria-label={flyoutEntry.label}
          style={{ top: flyout?.top, bottom: flyout?.bottom }}
          className="fixed left-[96px] z-[100002] hidden max-h-[calc(100vh-16px)] w-64 overflow-y-auto rounded-xl border border-gray-200 bg-white p-2 shadow-theme-lg custom-scrollbar dark:border-gray-800 dark:bg-gray-900 lg:block"
        >
          <p className="px-3 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{flyoutEntry.label}</p>
          <ul className="space-y-0.5">
            {flyoutEntry.children.map((child) => (
              <li key={child.key}>{childLink(child, () => setFlyout(null), "menu-dropdown-item w-full")}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
};

export default AppSidebar;
