"use client";

import { useAuth } from "@/context/AuthContext";
import { useSidebar } from "@/context/SidebarContext";
import AiChatBox from "@/components/ai/AiChatBox";
import { DocumentUploadQueueProvider } from "@/context/DocumentUploadQueueContext";
import AppHeader from "@/layout/AppHeader";
import AppSidebar from "@/layout/AppSidebar";
import Backdrop from "@/layout/Backdrop";
import { useRouter } from "next/navigation";
import React, { useEffect } from "react";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isInitialized } = useAuth();
  const router = useRouter();
  const { isExpanded } = useSidebar();

  useEffect(() => {
    if (isInitialized && !user?.token) {
      router.replace("/signin");
    }
  }, [isInitialized, router, user]);

  if (!isInitialized || !user?.token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-gray-900">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  // 1024–1679px nav là thanh rail 90px; từ 1680px nav đầy đủ 290px (thu về rail bằng ☰); dưới 1024px nav là ngăn kéo đè lên.
  const mainContentMargin = isExpanded ? "lg:ml-[90px] min-[1680px]:ml-[290px]" : "lg:ml-[90px]";

  return (
    // Hàng đợi upload chứng từ chạy nền nằm ở layout: chuyển trang trong app vẫn upload tiếp.
    <DocumentUploadQueueProvider>
      <div className="min-h-screen xl:flex">
        {/* Sidebar and Backdrop */}
        <AppSidebar />
        <Backdrop />
        {/* Main Content Area */}
        <div
          className={`min-w-0 flex-1 transition-all duration-300 ease-in-out ${mainContentMargin}`}
        >
          {/* Header */}
          <AppHeader />
          {/* Page Content */}
          <div className="mx-auto min-w-0 max-w-(--breakpoint-2xl) p-4 md:p-6">{children}</div>
        </div>
        {/* Chatbox AI tra cứu đơn hàng: nút nổi góc phải dưới */}
        <AiChatBox />
      </div>
    </DocumentUploadQueueProvider>
  );
}
