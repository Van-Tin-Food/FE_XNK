"use client";

import { clearStoredUser, getStoredUser } from "@/services/authApi";
import type { AuthUser } from "@/types/auth";
import {
  canPerformShipmentAction,
  SHIPMENT_ACTION_PERMISSIONS,
  type ShipmentActionPermissionKey,
} from "@/config/shipmentActionPermissions";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type AuthPermissions = Record<ShipmentActionPermissionKey, boolean>;

interface AuthContextValue {
  user: AuthUser | null;
  isInitialized: boolean;
  permissions: AuthPermissions;
  setUser: (user: AuthUser | null) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Server và lần render client đầu tiên phải cùng bắt đầu với user = null.
  // localStorage chỉ được đọc sau khi component đã hydrate.
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const permissions = useMemo(() => Object.fromEntries(
    (Object.keys(SHIPMENT_ACTION_PERMISSIONS) as ShipmentActionPermissionKey[])
      .map((action) => [action, canPerformShipmentAction(user, action)]),
  ) as AuthPermissions, [user]);

  const logout = () => {
    clearStoredUser();
    setUser(null);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setUser(getStoredUser());
      setIsInitialized(true);
    }, 0);

    const handleExpiredSession = () => logout();
    window.addEventListener("xnk:auth-expired", handleExpiredSession);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("xnk:auth-expired", handleExpiredSession);
    };
  }, []);

  return <AuthContext.Provider value={{ user, isInitialized, permissions, setUser, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
