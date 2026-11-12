"use client";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * Nav theo bề rộng màn hình:
 * - Dưới 1024px: ngăn kéo (drawer) mở bằng nút ☰ trên header (`isMobileOpen`).
 * - 1024–1679px: thanh rail cố định 90px (icon + nhãn ngắn, nhóm mở menu bật ra bên cạnh), không mở rộng.
 * - Từ 1680px (màn 24"/27"): nav đầy đủ 290px như cũ, đẩy nội dung; nút ☰ thu về rail / mở lại (`isExpanded`, mặc định mở).
 */
type SidebarContextType = {
  isMobileOpen: boolean;
  /** Chỉ có tác dụng từ 1680px: nav đầy đủ (true) hay thanh rail (false). */
  isExpanded: boolean;
  toggleExpanded: () => void;
  toggleMobileSidebar: () => void;
  closeMobileSidebar: () => void;
};

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
};

export const SidebarProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  // Cửa sổ giãn lên từ 1024px (rail) thì đóng ngăn kéo.
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const apply = () => {
      if (desktop.matches) setIsMobileOpen(false);
    };
    desktop.addEventListener("change", apply);
    return () => desktop.removeEventListener("change", apply);
  }, []);

  const toggleMobileSidebar = useCallback(() => {
    setIsMobileOpen((prev) => !prev);
  }, []);

  const closeMobileSidebar = useCallback(() => {
    setIsMobileOpen(false);
  }, []);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <SidebarContext.Provider value={{ isMobileOpen, isExpanded, toggleExpanded, toggleMobileSidebar, closeMobileSidebar }}>
      {children}
    </SidebarContext.Provider>
  );
};
