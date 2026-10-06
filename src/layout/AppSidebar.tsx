"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import React, { useState } from "react";
import { canPerformShipmentAction, normalizeRole } from "../config/shipmentActionPermissions";
import { useAuth } from "../context/AuthContext";
import { useSidebar } from "../context/SidebarContext";
import { GridIcon, HorizontaLDots } from "../icons/index";
import { useLanguage } from "../context/LanguageContext";

const MARKET_RESEARCH_HREF = "https://script.google.com/a/macros/vantinfood.vn/s/AKfycbx9gxbHB-b5UMbF6x9NrdDmc-abshieQ5pZfhFQRbHXhLGw-Cxv91kkssrmz0hZBabNXA/exec";

const AppSidebar: React.FC = () => {
  const { user, logout } = useAuth();
  const { isExpanded, isMobileOpen, isHovered, setIsHovered } = useSidebar();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const showText = isExpanded || isHovered || isMobileOpen;
  const [supportOpen, setSupportOpen] = useState(pathname === "/email" || pathname === "/document-sync");
  const [catalogOpen, setCatalogOpen] = useState(pathname === "/master-data");
  const [logsOpen, setLogsOpen] = useState(pathname === "/activity-logs");
  const role = normalizeRole(user?.role);
  const isOperationalRole = role === "logistic" || role === "van_chuyen";
  const canViewLogs = !isOperationalRole && canPerformShipmentAction(user, "viewActivityLogs");
  const canSendEmail = !isOperationalRole && canPerformShipmentAction(user, "sendEmail");
  const canSyncDocuments = canPerformShipmentAction(user, "syncDocuments");
  const canViewDocumentSync = canPerformShipmentAction(user, "viewDocumentSync") || canSyncDocuments;
  const canManageUsers = !isOperationalRole && (canPerformShipmentAction(user, "viewUsers") || canPerformShipmentAction(user, "manageUsers"));
  const canManageMasterData = canPerformShipmentAction(user, "viewMasterData") || canPerformShipmentAction(user, "manageMasterData");
  const { t } = useLanguage();

  return (
    <aside
      className={`fixed left-0 top-0 z-50 mt-16 flex h-[calc(100vh-4rem)] flex-col border-r border-gray-200 bg-white px-5 text-gray-900 transition-all duration-300 ease-in-out dark:border-gray-800 dark:bg-gray-900 lg:mt-0 lg:h-screen
        ${isExpanded || isMobileOpen || isHovered ? "w-[290px]" : "w-[90px]"}
        ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0`}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={`flex py-8 ${
          !isExpanded && !isHovered ? "lg:justify-center" : "justify-start"
        }`}
      >
        <Link
          href="/"
          aria-label="Trang quản lý xuất nhập khẩu"
          className="flex h-10 items-center gap-3 font-semibold text-gray-900 dark:text-white"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
            XNK
          </span>
          {showText && <span>{t("importExportManagement")}</span>}
        </Link>
      </div>

      <nav className="mb-6 min-h-0 flex-1 overflow-y-auto">
        <h2
          className={`mb-4 flex text-xs uppercase leading-5 text-gray-400 ${
            !isExpanded && !isHovered ? "lg:justify-center" : "justify-start"
          }`}
        >
          {showText ? t("features") : <HorizontaLDots />}
        </h2>

        <ul className="flex flex-col gap-4">
          <li>
            <Link
              href="/"
              className={`menu-item group ${
                pathname === "/" ? "menu-item-active" : "menu-item-inactive"
              } ${!showText ? "lg:justify-center" : "lg:justify-start"}`}
            >
              <span
                className={
                  pathname === "/"
                    ? "menu-item-icon-active"
                    : "menu-item-icon-inactive"
                }
              >
                <GridIcon />
              </span>
              {showText && <span className="menu-item-text">{t("importExport")}</span>}
            </Link>
          </li>
          {/* <li>
            <Link
              href="/user-guide"
              className={`menu-item group ${
                pathname === "/user-guide" ? "menu-item-active" : "menu-item-inactive"
              } ${!showText ? "lg:justify-center" : "lg:justify-start"}`}
            >
              <span className={pathname === "/user-guide" ? "menu-item-icon-active" : "menu-item-icon-inactive"}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  <path d="M9 7h6M9 11h6" />
                </svg>
              </span>
              {showText && <span className="menu-item-text">{t("userGuide")}</span>}
            </Link>
          </li> */}
           {canManageMasterData && (
            <li>
              <button type="button" onClick={() => setCatalogOpen((current) => !current)} className={`menu-item group w-full ${catalogOpen ? "menu-item-active" : "menu-item-inactive"} ${!showText ? "lg:justify-center" : "lg:justify-start"}`} aria-expanded={catalogOpen}>
                <span className={catalogOpen ? "menu-item-icon-active" : "menu-item-icon-inactive"}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <ellipse cx="12" cy="5" rx="8" ry="3" />
                    <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
                    <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
                  </svg>
                </span>
                {showText && <span className="menu-item-text">{t("masterDataManagement")}</span>}
                {showText && <span className="ml-auto text-xs">{catalogOpen ? "−" : "+"}</span>}
              </button>
              {catalogOpen && showText && <ul className="mt-1 space-y-1 pl-11">
                <li><Link href="/master-data?catalog=suppliers" className={`menu-dropdown-item ${pathname === "/master-data" && searchParams.get("catalog") !== "carriers" && searchParams.get("catalog") !== "warehouses" ? "menu-dropdown-item-active" : "menu-dropdown-item-inactive"}`}>{t("suppliers")}</Link></li>
                <li><Link href="/master-data?catalog=carriers" className={`menu-dropdown-item ${searchParams.get("catalog") === "carriers" ? "menu-dropdown-item-active" : "menu-dropdown-item-inactive"}`}>{t("carriers")}</Link></li>
                <li><Link href="/master-data?catalog=warehouses" className={`menu-dropdown-item ${searchParams.get("catalog") === "warehouses" ? "menu-dropdown-item-active" : "menu-dropdown-item-inactive"}`}>{t("warehouses")}</Link></li>
              </ul>}
            </li>
          )}


          {canManageUsers && (
            <li>
              <Link
                href="/account-management"
                className={`menu-item group ${
                  pathname === "/account-management" ? "menu-item-active" : "menu-item-inactive"
                } ${!showText ? "lg:justify-center" : "lg:justify-start"}`}
              >
                <span className={pathname === "/account-management" ? "menu-item-icon-active" : "menu-item-icon-inactive"}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M19 8v6M22 11h-6" />
                  </svg>
                </span>
                {showText && <span className="menu-item-text">{t("accountManagement")}</span>}
              </Link>
            </li>
          )}
          {canViewLogs && (
            <li>
              <button type="button" onClick={() => setLogsOpen((current) => !current)} className={`menu-item group w-full ${logsOpen ? "menu-item-active" : "menu-item-inactive"} ${!showText ? "lg:justify-center" : "lg:justify-start"}`} aria-expanded={logsOpen}>
                <span className={logsOpen ? "menu-item-icon-active" : "menu-item-icon-inactive"}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="8" y1="13" x2="16" y2="13" />
                    <line x1="8" y1="17" x2="16" y2="17" />
                  </svg>
                </span>
                {showText && <span className="menu-item-text">{t("logsMenu")}</span>}
                {showText && <span className="ml-auto text-xs">{logsOpen ? "−" : "+"}</span>}
              </button>
              {logsOpen && showText && <ul className="mt-1 space-y-1 pl-11">
                <li><Link href="/activity-logs?tab=activity" className={`menu-dropdown-item ${pathname === "/activity-logs" && searchParams.get("tab") !== "email" ? "menu-dropdown-item-active" : "menu-dropdown-item-inactive"}`}>{t("operationHistory")}</Link></li>
                <li><Link href="/activity-logs?tab=email" className={`menu-dropdown-item ${pathname === "/activity-logs" && searchParams.get("tab") === "email" ? "menu-dropdown-item-active" : "menu-dropdown-item-inactive"}`}>{t("emailLogs")}</Link></li>
              </ul>}
            </li>
          )}

          {(canSendEmail || canViewDocumentSync) && (
            <li>
              <button type="button" onClick={() => setSupportOpen((current) => !current)} className={`menu-item group w-full ${supportOpen ? "menu-item-active" : "menu-item-inactive"} ${!showText ? "lg:justify-center" : "lg:justify-start"}`} aria-expanded={supportOpen}>
                <span className={supportOpen ? "menu-item-icon-active" : "menu-item-icon-inactive"}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v3" /><path d="M5.5 7.5 7.6 9.6" /><path d="M18.5 7.5 16.4 9.6" /><path d="M4 14h16" /><path d="M6 14a6 6 0 0 1 12 0" /><path d="M8 14v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-4" /><path d="M4 14v2a2 2 0 0 0 2 2" /><path d="M20 14v2a2 2 0 0 1-2 2" /></svg>
                </span>
                {showText && <span className="menu-item-text">{t("supportTools")}</span>}
                {showText && <span className="ml-auto text-xs">{supportOpen ? "−" : "+"}</span>}
              </button>
              {supportOpen && showText && <ul className="mt-1 space-y-1 pl-11">
                {canSendEmail && <li><Link href="/email" className={`block rounded-lg px-3 py-2 text-sm ${pathname === "/email" ? "bg-brand-50 font-semibold text-brand-600 dark:bg-brand-500/10 dark:text-brand-300" : "text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-white/[0.04]"}`}>{t("emailSendButton")}</Link></li>}
                {canViewDocumentSync && <li><Link href="/document-sync" className={`block rounded-lg px-3 py-2 text-sm ${pathname === "/document-sync" ? "bg-brand-50 font-semibold text-brand-600 dark:bg-brand-500/10 dark:text-brand-300" : "text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-white/[0.04]"}`}>{t("documentSync")}</Link></li>}
              </ul>}
            </li>
          )}
          {canSendEmail && supportOpen && showText && (
            <li className="-mt-3 pl-11">
              <a href={MARKET_RESEARCH_HREF} target="_blank" rel="noopener noreferrer" className="block rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-white/[0.04]">
                {t("marketResearch")}
              </a>
            </li>
          )}
        </ul>
      </nav>

      <div className="border-t border-gray-200 py-5 dark:border-gray-800">
        <button
          type="button"
          onClick={logout}
          title={t("logout")}
          aria-label={t("logout")}
          className={`menu-item group w-full text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:text-red-300 ${
            !showText ? "lg:justify-center" : "lg:justify-start"
          }`}
        >
          <span className="shrink-0">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10 17l5-5-5-5" />
              <path d="M15 12H3" />
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            </svg>
          </span>
          {showText && <span className="menu-item-text">{t("logout")}</span>}
        </button>
      </div>
    </aside>
  );
};

export default AppSidebar;
