"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Hỏi trước khi rời trang khi đang có thay đổi chưa lưu (đang sửa, đang chờ xác nhận OCR, đang upload):
 * - đóng tab / F5: hộp thoại beforeunload của trình duyệt;
 * - nút Back của trình duyệt: chèn thêm một mục lịch sử trùng URL, bấm Back thì ở lại và hỏi;
 * - bấm link trong app (sidebar, logo...): chặn rồi hỏi, đồng ý mới chuyển trang.
 * Trước khi tự chuyển trang (nút "Danh sách đơn hàng" đã hỏi xong, lưu xong) gọi allowLeave() để không hỏi lại.
 */
export function useLeaveGuard(active: boolean, confirmLeave: () => Promise<boolean>) {
  const router = useRouter();
  const leavingRef = useRef(false);
  // Mục lịch sử chặn Back đang nằm trên cùng (chưa bị Back lấy đi).
  const guardOnTopRef = useRef(false);
  const confirmRef = useRef(confirmLeave);
  useEffect(() => {
    confirmRef.current = confirmLeave;
  }, [confirmLeave]);

  const allowLeave = useCallback(() => {
    leavingRef.current = true;
  }, []);

  useEffect(() => {
    if (!active) {
      // Hết thay đổi chưa lưu mà vẫn ở trang: gỡ mục chặn để Back chỉ cần bấm một lần. Chỉ chạy khi active đổi lúc
      // còn ở trang (effect này không chạy khi rời trang), nên không kéo người dùng quay lại sau khi đã chuyển trang.
      if (guardOnTopRef.current && !leavingRef.current) {
        guardOnTopRef.current = false;
        window.history.back();
      }
      return;
    }
    leavingRef.current = false;
    let asking = false;
    // Mục lịch sử chặn Back: cùng URL, cùng state của Next nên Back về đây không đổi nội dung.
    window.history.pushState(window.history.state, "", window.location.href);
    guardOnTopRef.current = true;

    const ask = async (onLeave: () => void) => {
      if (asking) return false;
      asking = true;
      try {
        if (!(await confirmRef.current())) return false;
        leavingRef.current = true;
        onLeave();
        return true;
      } finally {
        asking = false;
      }
    };

    const handlePopState = () => {
      if (leavingRef.current || !guardOnTopRef.current) return;
      guardOnTopRef.current = false;
      void ask(() => window.history.back()).then((left) => {
        // Ở lại: chèn lại mục chặn cho lần bấm Back sau.
        if (!left && !leavingRef.current) {
          window.history.pushState(window.history.state, "", window.location.href);
          guardOnTopRef.current = true;
        }
      });
    };

    const handleClick = (event: MouseEvent) => {
      if (leavingRef.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      void ask(() => router.push(`${url.pathname}${url.search}${url.hash}`));
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (leavingRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("popstate", handlePopState);
    // capture: chạy trước Link của Next để chặn kịp.
    document.addEventListener("click", handleClick, true);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [active, router]);

  return { allowLeave };
}
