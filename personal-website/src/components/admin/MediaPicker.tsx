'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { fetchMedia, mediaPublicUrl, type MediaRow } from '@/components/admin/media-shared';
import { ADMIN } from '@/messages/admin';

type Props = { open: boolean; onClose: () => void; onSelect: (id: string) => void };
type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; rows: MediaRow[] };

export default function MediaPicker({ open, onClose, onSelect }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchMedia()
      .then((rows) => { if (!cancelled) setState({ kind: 'ready', rows }); })
      .catch(() => { if (!cancelled) setState({ kind: 'error' }); });
    return () => { cancelled = true; };
  }, [open ]);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label={ADMIN.pickMedia}
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-md)', width: 'min(880px, 100%)', maxHeight: '86svh', overflow: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h2 className="text-h3">{ADMIN.pickMedia}</h2>
          <button type="button" onClick={onClose} style={{ minHeight: 44, minWidth: 44, padding: '8px 16px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border-input)', background: 'transparent', color: 'var(--text)', cursor: 'pointer' }}>{ADMIN.close}</button>
        </div>

        {state.kind === 'loading' && <div aria-busy="true" style={{ height: 120, marginTop: 16, borderRadius: 'var(--radius-sm)', background: 'var(--bg-alt)' }} />}
        {state.kind === 'error' && <p style={{ marginTop: 16, color: 'var(--danger)' }}>{ADMIN.loadError}</p>}
        {state.kind === 'ready' && state.rows.length === 0 && <p className="text-muted" style={{ marginTop: 16 }}>{ADMIN.mediaEmptyAdmin}</p>}
        {state.kind === 'ready' && state.rows.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 12, marginTop: 16 }}>
            {state.rows.map((r) => (
              <button key={r.id} type="button" onClick={() => { onSelect(r.id); onClose(); }}
                style={{ minHeight: 44, padding: 6, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)', cursor: 'pointer' }}>
                {r.mime_type.startsWith('image/') ? (
                  <Image src={mediaPublicUrl(r.path)} alt={r.alt.ar ?? r.alt.en ?? ''} width={r.width ?? 240} height={r.height ?? 180} style={{ width: '100%', height: 90, objectFit: 'cover', borderRadius: 'var(--radius-sm)' }} />
                ) : (
                  <span style={{ display: 'grid', placeItems: 'center', height: 90 }}>PDF</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
