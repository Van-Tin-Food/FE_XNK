"use client";

import Link from "next/link";
import type React from "react";

/**
 * Logo XNK: bấm là tải lại trang chủ (đọc lại dữ liệu và role / phân quyền mới nhất), không chuyển trang
 * kiểu SPA. Ctrl/Cmd/Shift + bấm hoặc chuột giữa vẫn mở tab mới như link thường.
 */
export default function ReloadHomeLink({ className, title, ariaLabel, children }: {
  className?: string;
  title?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.location.assign("/");
  };

  return (
    <Link href="/" onClick={handleClick} className={className} title={title} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}
