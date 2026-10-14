import ThemeTogglerTwo from "@/components/common/ThemeTogglerTwo";

import { ThemeProvider } from "@/context/ThemeContext";
import Link from "next/link";
import React from "react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative p-6 bg-white z-1 dark:bg-gray-900 sm:p-0">
      <ThemeProvider>
        <div className="relative flex lg:flex-row w-full h-screen justify-center flex-col  dark:bg-gray-900 sm:p-0">
          {children}
          <div className="lg:w-1/2 w-full h-full bg-brand-950 dark:bg-white/5 lg:grid items-center hidden">
            <div className="relative z-1 flex items-center justify-center">
              <div className="flex flex-col items-center max-w-xs">
                <Link href="/" className="mb-5 flex items-center gap-3 text-2xl font-semibold text-white">
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500 text-sm font-bold">XNK</span>
                Operation Dashboard 
                </Link>
                <p className="text-center text-gray-400 dark:text-white/60">
                  Theo dõi chứng từ, hành trình và tiến độ đơn hàng tập trung.
                </p>
              </div>
            </div>
          </div>
          <div className="fixed bottom-6 right-6 z-50 hidden sm:block">
            <ThemeTogglerTwo />
          </div>
        </div>
      </ThemeProvider>
    </div>
  );
}
