import type { ReactNode } from 'react';
import type { CSSProperties } from 'react';
import { notFound } from 'next/navigation';
import { Inter, IBM_Plex_Sans_Arabic } from 'next/font/google';
import { isLocale, dirOf, type Locale } from '@/lib/i18n';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import ThemeToggle from '@/components/site/ThemeToggle';
import LocaleSwitcher from '@/components/site/LocaleSwitcher';
import '../../globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const plexAr = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-ar',
  display: 'swap',
});

const THEME_SCRIPT = `(function () {
  try {
    var d = document.documentElement;
    d.setAttribute('data-js', '');
    var s = localStorage.getItem('theme') || d.getAttribute('data-default-theme') || 'system';
    var dark = s === 'dark' || (s === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    d.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) {}
})();`;

export function generateStaticParams() {
  return [{ locale: 'ar' }, { locale: 'en' }];
}

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function SiteLayout({ children, params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale: Locale = raw;
  const t = locale === 'ar' ? ar : en;
  const brandStyle = {} as CSSProperties;

  return (
    <html lang={locale} dir={dirOf(locale)} data-radius="soft" data-density="comfortable"
      data-default-theme="system" style={brandStyle} suppressHydrationWarning
      className={`${inter.variable} ${plexAr.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <a className="skip-link" href="#main">{t.skip_to_content}</a>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingInline: 20, minHeight: 'var(--nav-h)', alignItems: 'center' }}>
          <LocaleSwitcher locale={locale} otherName={locale === 'ar' ? t.lang_en_name : t.lang_ar_name} label={t.language} />
          <ThemeToggle labels={{ system: t.theme_system, light: t.theme_light, dark: t.theme_dark }} />
        </div>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
