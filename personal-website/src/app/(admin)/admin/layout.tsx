import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { IBM_Plex_Sans_Arabic } from 'next/font/google';
import AdminLocked from '@/components/admin/AdminLocked';
import DevBanner from '@/components/admin/DevBanner';
import Shell from '@/components/admin/Shell';
import '../../globals.css';

const plexAr = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-ar',
  display: 'swap',
});

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" data-radius="soft" data-density="comfortable" data-default-theme="system" suppressHydrationWarning className={plexAr.variable}>
      <body>
        <AdminLocked>
          <DevBanner />
          <Shell>{children}</Shell>
        </AdminLocked>
      </body>
    </html>
  );
}
