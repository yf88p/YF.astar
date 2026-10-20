import type { Locale } from '@/lib/i18n';

export function safeHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const v = href.trim();
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  if (v.startsWith('#')) return v;
  try {
    const u = new URL(v);
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(u.protocol) ? v : null;
  } catch {
    return null;
  }
}

export function localizeHref(href: string, locale: Locale): string {
  return href.startsWith('/') ? `/${locale}${href === '/' ? '' : href}` : href;
}
