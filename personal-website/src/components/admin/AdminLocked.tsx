import type { ReactNode } from 'react';
import { ADMIN_MODE } from '@/lib/admin-mode';
import { ADMIN } from '@/messages/admin';

export default function AdminLocked({ children }: { children: ReactNode }) {
  if (ADMIN_MODE === 'open') return <>{children}</>;
  return (
    <div style={{ minHeight: '100svh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg-alt)' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 className="text-h2">{ADMIN.lockedTitle}</h1>
        <p className="text-muted" style={{ marginTop: 12 }}>{ADMIN.lockedText}</p>
      </div>
    </div>
  );
}
