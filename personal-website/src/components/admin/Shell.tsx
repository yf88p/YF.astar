'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ADMIN } from '@/messages/admin';

const ITEMS = [
  { href: '/admin', label: ADMIN.dashboard },
  { href: '/admin/pages', label: ADMIN.pages },
  { href: '/admin/media', label: ADMIN.media },
  { href: '/admin/settings', label: ADMIN.settings },
  { href: '/admin/tools', label: ADMIN.tools },
  { href: '/admin/audit', label: ADMIN.audit },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
}

const linkStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', minHeight: 44, padding: '10px 14px',
  borderRadius: 'var(--radius-sm)', color: active ? 'var(--text)' : 'var(--text-muted)',
  background: active ? 'var(--bg-alt)' : 'transparent', fontWeight: active ? 600 : 400,
  textDecoration: 'none',
});

export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/admin';
  const mobileItems = ITEMS.slice(0, 4);

  return (
    <div style={{ minHeight: '100svh', background: 'var(--bg-alt)' }}>
      <aside className="admin-sidebar" style={{ position: 'fixed', insetInlineStart: 0, top: 0, bottom: 0, width: 240, padding: 16, background: 'var(--surface)', borderInlineEnd: '1px solid var(--border)', display: 'none', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontWeight: 700, padding: '8px 14px 16px' }}>{ADMIN.adminTitle}</div>
        <nav aria-label={ADMIN.adminTitle} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {ITEMS.map((i) => (
            <Link key={i.href} href={i.href} aria-current={isActive(pathname, i.href) ? 'page' : undefined} style={linkStyle(isActive(pathname, i.href))}>{i.label}</Link>
          ))}
        </nav>
      </aside>

      <div className="admin-main" style={{ padding: '20px 16px 96px' }}>
        <div style={{ maxWidth: 1120, marginInline: 'auto' }}>{children}</div>
      </div>

      <nav aria-label={ADMIN.adminTitle} className="admin-tabbar"
        style={{ position: 'fixed', insetInline: 0, bottom: 0, zIndex: 40, display: 'flex', background: 'var(--surface)', borderTop: '1px solid var(--border)', paddingBottom: 'env(safe-area-inset-bottom)', minHeight: 56 }}>
        {mobileItems.map((i) => (
          <Link key={i.href} href={i.href} aria-current={isActive(pathname, i.href) ? 'page' : undefined}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 56, color: isActive(pathname, i.href) ? 'var(--text)' : 'var(--text-muted)', fontWeight: isActive(pathname, i.href) ? 600 : 400, textDecoration: 'none' }}>
            {i.label}
          </Link>
        ))}
      </nav>

      <style>{`
        @media (min-width: 768px) {
          .admin-sidebar { display: flex !important; }
          .admin-tabbar { display: none !important; }
          .admin-main { margin-inline-start: 240px; padding-bottom: 32px !important; }
        }
      `}</style>
    </div>
  );
}
