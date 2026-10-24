import type { Metadata } from 'next';
import './globals.css';
import { SidebarProvider } from '@/context/SidebarContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { AuthProvider } from '@/context/AuthContext';
import { SystemNotificationProvider } from '@/context/SystemNotificationContext';
import { SystemConfirmProvider } from '@/context/SystemConfirmContext';
import { LanguageProvider } from '@/context/LanguageContext';

// Hệ thống nội bộ: thẻ <meta name="robots"> / "googlebot" noindex cho mọi trang (cùng X-Robots-Tag ở next.config.ts).
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body>
        <LanguageProvider>
          <ThemeProvider>
            <AuthProvider>
              <SystemNotificationProvider>
                <SystemConfirmProvider>
                  <SidebarProvider>{children}</SidebarProvider>
                </SystemConfirmProvider>
              </SystemNotificationProvider>
            </AuthProvider>
          </ThemeProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
