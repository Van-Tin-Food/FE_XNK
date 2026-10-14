import './globals.css';
import { SidebarProvider } from '@/context/SidebarContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { AuthProvider } from '@/context/AuthContext';
import { SystemNotificationProvider } from '@/context/SystemNotificationContext';
import { SystemConfirmProvider } from '@/context/SystemConfirmContext';
import { LanguageProvider } from '@/context/LanguageContext';

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
