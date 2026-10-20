'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getBrowserClient } from '@/lib/supabase/browser';
import { ADMIN } from '@/messages/admin';

type Counts = { pages: number; blocks: number; media: number };
type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; counts: Counts };

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 24,
};

export default function Dashboard() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const fetchCounts = useCallback(async (): Promise<State> => {
    try {
      const db = getBrowserClient();
      const [pages, blocks, media] = await Promise.all([
        db.from('pages').select('id', { count: 'exact', head: true }),
        db.from('blocks').select('id', { count: 'exact', head: true }),
        db.from('media').select('id', { count: 'exact', head: true }),
      ]);
      if (pages.error || blocks.error || media.error) throw new Error('count failed');
      return { kind: 'ready', counts: { pages: pages.count ?? 0, blocks: blocks.count ?? 0, media: media.count ?? 0 } };
    } catch {
      return { kind: 'error' };
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchCounts().then((s) => { if (!cancelled) setState(s); });
    return () => { cancelled = true; };
  }, [fetchCounts]);

  const retry = () => {
    setState({ kind: 'loading' });
    void fetchCounts().then(setState);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <h1 className="text-h2">{ADMIN.dashboard}</h1>

      <section aria-label={ADMIN.countsTitle} style={{ ...cardStyle }}>
        <h2 className="text-h3" style={{ marginBottom: 16 }}>{ADMIN.countsTitle}</h2>
        {state.kind === 'loading' && (
          <div aria-busy="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ height: 72, borderRadius: 'var(--radius-sm)', background: 'var(--bg-alt)' }} />
            ))}
          </div>
        )}
        {state.kind === 'error' && (
          <div>
            <p style={{ color: 'var(--danger)' }}>{ADMIN.loadError}</p>
            <button type="button" onClick={retry} style={{ marginTop: 12, minHeight: 44, padding: '10px 20px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer' }}>{ADMIN.retry}</button>
          </div>
        )}
        {state.kind === 'ready' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16 }}>
            {[
              { label: ADMIN.pagesCount, value: state.counts.pages },
              { label: ADMIN.blocksCount, value: state.counts.blocks },
              { label: ADMIN.mediaCount, value: state.counts.media },
            ].map((c) => (
              <div key={c.label} style={{ background: 'var(--bg-alt)', borderRadius: 'var(--radius-sm)', padding: 16 }}>
                <div className="text-h2">{c.value}</div>
                <div className="text-muted text-small">{c.label}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        <section style={cardStyle}>
          <h2 className="text-h3">{ADMIN.tools}</h2>
          <p className="text-muted" style={{ margin: '8px 0 16px' }}>{ADMIN.toolsHint}</p>
          <Link href="/admin/tools" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '10px 20px', borderRadius: 'var(--radius-pill)', background: 'var(--accent-solid)', color: 'var(--text-on-accent)', textDecoration: 'none' }}>{ADMIN.open}</Link>
        </section>
        <section style={cardStyle}>
          <h2 className="text-h3">{ADMIN.audit}</h2>
          <p className="text-muted" style={{ margin: '8px 0 16px' }}>{ADMIN.auditHint}</p>
          <Link href="/admin/audit" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '10px 20px', borderRadius: 'var(--radius-pill)', background: 'var(--accent-solid)', color: 'var(--text-on-accent)', textDecoration: 'none' }}>{ADMIN.open}</Link>
        </section>
      </div>
    </div>
  );
}
