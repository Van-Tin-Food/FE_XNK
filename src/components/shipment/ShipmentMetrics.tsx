"use client";
import React from "react";
import type { ShipmentMetricsSummary, ShipmentStatus } from "@/types/shipment";
import { useLanguage } from "@/context/LanguageContext";

interface MetricCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  colorClass: string;
  bgClass: string;
  borderClass: string;
  isActive: boolean;
  onClick: () => void;
}

function MetricCard({ label, value, icon, colorClass, bgClass, borderClass, isActive, onClick }: MetricCardProps) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex flex-col gap-3 rounded-2xl border p-4 md:p-5 text-left transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 cursor-pointer w-full ${
        isActive
          ? `${borderClass} ${bgClass} shadow-md -translate-y-0.5`
          : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-700"
      }`}
    >
      {/* Active indicator */}
      {isActive && (
        <span className={`absolute top-3 right-3 w-2 h-2 rounded-full ${colorClass.replace("text-", "bg-")} animate-pulse`} />
      )}

      {/* Icon */}
      <div className={`flex items-center justify-center w-10 h-10 rounded-xl ${isActive ? bgClass : "bg-gray-100 dark:bg-gray-800"} transition-colors duration-200`}>
        <span className={isActive ? colorClass : "text-gray-500 dark:text-gray-400"}>
          {icon}
        </span>
      </div>

      {/* Content */}
      <div>
        <p className={`text-xs font-medium uppercase tracking-wider mb-1 ${isActive ? colorClass : "text-gray-500 dark:text-gray-400"}`}>
          {label}
        </p>
        <p className={`text-2xl font-bold tabular-nums ${isActive ? colorClass : "text-gray-800 dark:text-white/90"}`}>
          {value}
        </p>
      </div>
    </button>
  );
}

interface ShipmentMetricsProps {
  metrics: ShipmentMetricsSummary;
  activeFilter: ShipmentStatus | "all";
  onFilterChange: (status: ShipmentStatus | "all") => void;
}

export default function ShipmentMetrics({ metrics, activeFilter, onFilterChange }: ShipmentMetricsProps) {
  const { t } = useLanguage();
  const cards = [
    {
      key: "all" as const,
      label: t("totalShipments"),
      value: metrics.total,
      colorClass: "text-brand-500",
      bgClass: "bg-brand-50 dark:bg-brand-500/10",
      borderClass: "border-brand-300 dark:border-brand-500/40",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="3" width="15" height="13" rx="1"/>
          <path d="M16 8h4l3 3v5h-7V8z"/>
          <circle cx="5.5" cy="18.5" r="2.5"/>
          <circle cx="18.5" cy="18.5" r="2.5"/>
        </svg>
      ),
    },
    {
      key: "completed" as const,
      label: t("completed"),
      value: metrics.completed,
      colorClass: "text-success-600",
      bgClass: "bg-success-50 dark:bg-success-500/10",
      borderClass: "border-success-300 dark:border-success-500/40",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      ),
    },
    {
      key: "shipping" as const,
      label: t("shipping"),
      value: metrics.shipping,
      colorClass: "text-blue-light-600",
      bgClass: "bg-blue-light-50 dark:bg-blue-light-500/10",
      borderClass: "border-blue-light-300 dark:border-blue-light-500/40",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/>
          <rect x="9" y="11" width="14" height="10" rx="1"/>
          <circle cx="12" cy="21" r="1"/>
          <circle cx="20" cy="21" r="1"/>
        </svg>
      ),
    },
    {
      key: "cancelled" as const,
      label: t("cancelled"),
      value: metrics.cancelled,
      colorClass: "text-error-600",
      bgClass: "bg-error-50 dark:bg-error-500/10",
      borderClass: "border-error-300 dark:border-error-500/40",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <line x1="9" y1="15" x2="15" y2="15"/>
        </svg>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:gap-4">
      {cards.map((card) => (
        <MetricCard
          key={card.key}
          label={card.label}
          value={card.value}
          icon={card.icon}
          colorClass={card.colorClass}
          bgClass={card.bgClass}
          borderClass={card.borderClass}
          isActive={activeFilter === card.key}
          onClick={() => onFilterChange(card.key)}
        />
      ))}
    </div>
  );
}
