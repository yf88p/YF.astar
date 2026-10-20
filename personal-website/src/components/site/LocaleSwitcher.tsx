'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Locale } from '@/lib/i18n';

type Props = { locale: Locale; otherName: string; label: string };

export default function LocaleSwitcher({ locale, otherName, label }: Props) {
  const pathname = usePathname() ?? `/${locale}`;
  const other: Locale = locale === 'ar' ? 'en' : 'ar';
  const parts = pathname.split('/');
  parts[1] = other;
  const href = parts.join('/') || `/${other}`;

  const save = () => {
    document.cookie = `NEXT_LOCALE=${other}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <Link href={href} onClick={save} aria-label={label}
      style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '8px 14px', color: 'var(--accent)' }}>
      {otherName}
    </Link>
  );
}
