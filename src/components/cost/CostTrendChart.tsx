"use client";

import { useEffect, useRef, useState } from "react";
import type { CostKind } from "@/utils/costStatistics";

// Biểu đồ cột chồng chi phí 6 tháng (một loại tiền): mỗi tháng một cột, chồng theo nhóm (vận hành / phát sinh / tiền
// hàng). Quy chuẩn: cột <= 24px, đầu cột bo 4px, khe 2px màu nền giữa các phần, lưới mảnh, chú giải luôn có, chỉ ghi số
// ở cột tháng đang xem; rê chuột / tab vào cột hiện tooltip cả tháng; có bảng số liệu thay cho biểu đồ.
// Màu theo nhóm (cố định, không theo thứ hạng), đã kiểm tra mù màu + độ tương phản cho nền sáng (#fff) và tối (gray-900).

export const KIND_FILL: Record<CostKind, string> = {
  operating: "fill-[#2a78d6] dark:fill-[#3987e5]",
  incident: "fill-[#eb6834] dark:fill-[#d95926]",
  goods: "fill-[#1baf7a] dark:fill-[#199e70]",
};
export const KIND_BG: Record<CostKind, string> = {
  operating: "bg-[#2a78d6] dark:bg-[#3987e5]",
  incident: "bg-[#eb6834] dark:bg-[#d95926]",
  goods: "bg-[#1baf7a] dark:bg-[#199e70]",
};

const HEIGHT = 260;
const PAD = { top: 22, right: 8, bottom: 26, left: 58 };
const GAP = 2;
const RADIUS = 4;

interface Props {
  months: string[];
  /** cents theo tháng × nhóm. */
  matrix: Record<string, Record<CostKind, bigint>>;
  kinds: CostKind[];
  /** Tháng đang xem (ghi số trên đầu cột). */
  current: string;
  kindLabel: (kind: CostKind) => string;
  monthLabel: (month: string) => string;
  formatValue: (cents: bigint) => string;
  compact: (value: number) => string;
  totalLabel: string;
  tableLabel: string;
  monthHeader: string;
  emptyLabel: string;
}

/** Bậc trục tròn: 1 / 2 / 2.5 / 5 × 10^k, khoảng 4 bậc. */
function niceScale(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 1, step: 0.25 };
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((value) => value >= raw) || 10 * power;
  return { top: Math.ceil(max / step) * step, step };
}

/** Phần trên cùng của cột: bo 2 góc trên, đáy vuông (nằm trên đường gốc / phần bên dưới). */
function topRoundedPath(x: number, y: number, width: number, height: number): string {
  const r = Math.min(RADIUS, height / 2, width / 2);
  return `M${x},${y + height}L${x},${y + r}Q${x},${y} ${x + r},${y}L${x + width - r},${y}Q${x + width},${y} ${x + width},${y + r}L${x + width},${y + height}Z`;
}

export default function CostTrendChart({ months, matrix, kinds, current, kindLabel, monthLabel, formatValue, compact, totalLabel, tableLabel, monthHeader, emptyLabel }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => setWidth(Math.max(280, Math.round(entries[0].contentRect.width))));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const toNumber = (cents: bigint) => Number(cents) / 100;
  const totals = months.map((month) => kinds.reduce((sum, kind) => sum + matrix[month][kind], BigInt(0)));
  const maxValue = Math.max(0, ...totals.map(toNumber));
  const { top, step } = niceScale(maxValue);
  const plotWidth = width - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const band = plotWidth / months.length;
  const barWidth = Math.min(24, band * 0.5);
  const yOf = (value: number) => PAD.top + plotHeight - (value / top) * plotHeight;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step);
  const empty = maxValue === 0;
  const tooltipMonth = active === null ? null : months[active];

  return (
    <div className="min-w-0">
      {/* Chú giải: luôn có khi >= 2 nhóm; ô màu hình chữ nhật như cột */}
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
        {kinds.map((kind) => (
          <li key={kind} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ${KIND_BG[kind]}`} aria-hidden="true" />{kindLabel(kind)}</li>
        ))}
      </ul>
      <div ref={wrapRef} className="relative w-full" onPointerLeave={() => setActive(null)}>
        {empty ? (
          <p className="flex h-[260px] items-center justify-center text-sm text-gray-400">{emptyLabel}</p>
        ) : (
          <svg width={width} height={HEIGHT} role="img" aria-label={tableLabel} className="block max-w-full overflow-visible">
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={PAD.left} x2={width - PAD.right} y1={yOf(tick)} y2={yOf(tick)} className="stroke-gray-100 dark:stroke-gray-800" strokeWidth={1} />
                <text x={PAD.left - 8} y={yOf(tick)} dy="0.32em" textAnchor="end" className="fill-gray-400 text-[11px] tabular-nums">{compact(tick)}</text>
              </g>
            ))}
            {months.map((month, index) => {
              const x = PAD.left + band * index + (band - barWidth) / 2;
              let base = PAD.top + plotHeight;
              const present = kinds.filter((kind) => matrix[month][kind] > BigInt(0));
              const dim = active !== null && active !== index;
              return (
                <g key={month} className={`transition-opacity ${dim ? "opacity-45" : ""}`}>
                  {present.map((kind, position) => {
                    const fullHeight = (toNumber(matrix[month][kind]) / top) * plotHeight;
                    // Khe 2px màu nền giữa các phần chồng (trừ phần dưới cùng nằm trên đường gốc).
                    const height = position === 0 ? fullHeight : fullHeight - GAP;
                    const y = base - fullHeight;
                    base -= fullHeight;
                    if (height <= 0.5) return null;
                    const isTop = position === present.length - 1;
                    return isTop
                      ? <path key={kind} d={topRoundedPath(x, y, barWidth, height)} className={KIND_FILL[kind]} />
                      : <rect key={kind} x={x} y={y} width={barWidth} height={height} className={KIND_FILL[kind]} />;
                  })}
                  {month === current && totals[index] > BigInt(0) && (
                    <text x={x + barWidth / 2} y={yOf(toNumber(totals[index])) - 6} textAnchor="middle" className="fill-gray-700 text-[11px] font-semibold tabular-nums dark:fill-gray-200">{compact(toNumber(totals[index]))}</text>
                  )}
                  <text x={PAD.left + band * index + band / 2} y={HEIGHT - 8} textAnchor="middle" className={`text-[11px] ${month === current ? "fill-gray-800 font-semibold dark:fill-white" : "fill-gray-400"}`}>{monthLabel(month)}</text>
                  {/* Vùng bắt chuột / bàn phím: cả cột tháng, lớn hơn phần đã vẽ */}
                  <rect x={PAD.left + band * index} y={PAD.top} width={band} height={plotHeight} fill="transparent" tabIndex={0}
                    aria-label={`${monthLabel(month)}: ${kinds.map((kind) => `${kindLabel(kind)} ${formatValue(matrix[month][kind])}`).join(", ")}`}
                    onPointerEnter={() => setActive(index)} onPointerMove={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}
                    className="cursor-default outline-none" />
                </g>
              );
            })}
          </svg>
        )}
        {tooltipMonth && (
          <div role="tooltip" className="pointer-events-none absolute top-0 z-10 w-max max-w-[280px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-900"
            style={{ left: Math.min(Math.max(0, PAD.left + band * (active as number) + band / 2 - 110), Math.max(0, width - 280)) }}>
            <p className="mb-1 font-semibold text-gray-800 dark:text-white/90">{monthLabel(tooltipMonth)}</p>
            {kinds.map((kind) => (
              <p key={kind} className="flex items-center gap-2">
                <span className={`h-0.5 w-3 rounded ${KIND_BG[kind]}`} aria-hidden="true" />
                <span className="whitespace-nowrap font-semibold tabular-nums text-gray-900 dark:text-white">{formatValue(matrix[tooltipMonth][kind])}</span>
                <span className="text-gray-500">{kindLabel(kind)}</span>
              </p>
            ))}
            <p className="mt-1 border-t border-gray-100 pt-1 text-gray-600 dark:border-gray-800 dark:text-gray-300">{totalLabel}: <span className="font-semibold tabular-nums text-gray-900 dark:text-white">{formatValue(totals[active as number])}</span></p>
          </div>
        )}
      </div>
      {/* Bảng số liệu: ai không xem được màu / biểu đồ vẫn có đủ số */}
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer select-none text-brand-600 hover:underline dark:text-brand-400">{tableLabel}</summary>
        <div className="mt-2 overflow-x-auto custom-scrollbar">
          <table className="w-full min-w-[420px] text-left">
            <thead className="text-gray-500">
              <tr>
                <th className="py-1 pr-3 font-medium">{monthHeader}</th>
                {kinds.map((kind) => <th key={kind} className="py-1 pr-3 text-right font-medium">{kindLabel(kind)}</th>)}
                <th className="py-1 text-right font-medium">{totalLabel}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 tabular-nums text-gray-700 dark:divide-gray-800 dark:text-gray-300">
              {months.map((month, index) => (
                <tr key={month}>
                  <td className="py-1 pr-3">{monthLabel(month)}</td>
                  {kinds.map((kind) => <td key={kind} className="py-1 pr-3 text-right">{formatValue(matrix[month][kind])}</td>)}
                  <td className="py-1 text-right font-semibold">{formatValue(totals[index])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
