import { ADMIN_MODE } from '@/lib/admin-mode';
import { ADMIN } from '@/messages/admin';

export default function DevBanner() {
  if (ADMIN_MODE !== 'open') return null;
  return (
    <div role="alert" className="text-small"
      style={{ minHeight: 36, display: 'flex', alignItems: 'center', padding: '6px 16px', background: 'color-mix(in srgb, var(--danger) 10%, var(--surface))', borderBottom: '1px solid var(--danger)', color: 'var(--text)' }}>
      {ADMIN.devBanner}
    </div>
  );
}
