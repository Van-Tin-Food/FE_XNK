"use client";
import React from "react";
import { useLanguage } from "@/context/LanguageContext";

export type ShipmentFlowStageKey =
  | "buying"
  | "shipping"
  | "arrived"
  | "declared"
  | "fifteenb"
  | "customs"
  | "delivered";

export interface ShipmentFlowStage {
  key: ShipmentFlowStageKey;
  label: string;
  shortLabel: string;
}

interface ShipmentStatusBarProps {
  activeStage: ShipmentFlowStageKey;
  stages: ShipmentFlowStage[];
  activeStageMessage?: string;
  /** Đủ mọi chứng từ (kể cả hạ rỗng TRA_CONT): bước cuối hiện `Thành công`. Thiếu hạ rỗng thì bước cuối vẫn đang làm. */
  isComplete?: boolean;
}

const STAGE_ICON: Record<ShipmentFlowStageKey, React.ReactNode> = {
  buying: <span className="flex flex-col text-[7px] font-bold leading-[8px]"><span>INV</span><span>PKL</span></span>,
  shipping: <span className="flex flex-col text-[7px] font-bold leading-[7px]"><span>BL</span><span>CO/HC</span></span>,
  arrived: <span className="flex flex-col text-[7px] font-bold leading-[7px]"><span>DON</span><span>KD</span></span>,
  declared: <span className="text-[9px] font-bold">TK</span>,
  fifteenb: <span className="text-[10px] font-bold">15B</span>,
  customs: <span className="flex flex-col text-[7px] font-bold leading-[7px]"><span>QDTQ</span><span>MV</span></span>,
  delivered: <span className="flex flex-col text-[7px] font-bold leading-[7px]"><span>TRA</span><span>CONT</span></span>,
};

export default function ShipmentStatusBar({ activeStage, stages, activeStageMessage, isComplete = false }: ShipmentStatusBarProps) {
  const { t } = useLanguage();
  const activeIndex = Math.max(0, stages.findIndex((s) => s.key === activeStage));

  const getTone = (index: number) => {
    if (index < activeIndex) return "success";
    if (index === activeIndex) return isComplete ? "success" : "primary";
    return "muted";
  };

  const toneCls = {
    success: "border-success-500 bg-success-500 text-white",
    primary: "border-brand-500 bg-brand-500 text-white",
    warning: "border-amber-500 bg-amber-400 text-white",
    danger: "border-error-500 bg-error-500 text-white",
    muted: "border-gray-300 bg-white text-gray-400 dark:border-gray-600 dark:bg-gray-800",
  } as const;

  const labelCls = {
    success: "text-success-700 dark:text-success-400",
    primary: "text-brand-700 dark:text-brand-300",
    warning: "text-amber-700 dark:text-amber-400",
    danger: "text-error-700 dark:text-error-400",
    muted: "text-gray-400 dark:text-gray-500",
  } as const;

  const subCls = {
    success: "text-success-600",
    primary: "text-brand-500",
    warning: "text-amber-600",
    danger: "text-error-600",
    muted: "text-gray-400 dark:text-gray-500",
  } as const;

  return (
    <div className="w-full">
      <div className="relative">
        <div className="absolute left-6 right-6 top-4 h-0.5 rounded-full bg-gray-200 dark:bg-gray-700" />
        <div className="absolute left-6 top-4 h-0.5 rounded-full bg-brand-500 transition-all duration-500" style={{ width: `${(activeIndex / Math.max(stages.length - 1, 1)) * 100}%` }} />
        <div className="relative z-10 grid grid-cols-7 gap-2">
          {stages.map((stage, index) => {
            const tone = getTone(index);
            const completed = index < activeIndex || (index === activeIndex && isComplete);
            return (
              <div key={stage.key} className="flex min-w-0 flex-col items-center text-center">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all ${toneCls[tone]}`}
                  title={stage.label}
                >
                  {STAGE_ICON[stage.key]}
                </div>
                <div className="mt-2 min-h-[2.5rem]">
                  <p className={`break-words text-[9px] font-semibold leading-tight ${labelCls[tone]}`}>
                    {stage.shortLabel}
                  </p>
                  <p className={`mt-0.5 text-[9px] leading-tight ${subCls[tone]}`}>
                    {completed
                      ? (stage.key === "delivered" ? t("successful") : t("done"))
                      : index === activeIndex
                      ? activeStageMessage || t("processing")
                      : t("notReached")}
                  </p>
                  <p className="hidden">
                    {completed ? (stage.key === "delivered" ? t("successful") : t("done")) : index === activeIndex ? activeStageMessage || t("processing") : t("notReached")}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
