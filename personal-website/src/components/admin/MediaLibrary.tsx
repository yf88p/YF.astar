'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ACCEPT_ATTR, deleteMedia, fetchMedia, mediaPublicUrl, updateMediaAlt, uploadMediaFile, validateFile, type MediaRow } from '@/components/admin/media-shared';
import { ADMIN } from '@/messages/admin';

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; rows: MediaRow[] };

const btn: React.CSSProperties = { minHeight: 44, padding: '10px 18px', borderRadius: 'var(--radius-pill)', cursor: 'pointer' };
const primary: React.CSSProperties = { ...btn, border: 'none', background: 'var(--accent-solid)', color: 'var(--text-on-accent)' };
const secondary: React.CSSProperties = { ...btn, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)' };
const danger: React.CSSProperties = { ...btn, border: '1px solid var(--danger)', background: 'transparent', color: 'var(--danger)' };
const input: React.CSSProperties = { width: '100%', minHeight: 48, padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-input)', background: 'var(--surface)', color: 'var(--text)' };

export default function MediaLibrary() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [editing, setEditing] = useState<MediaRow | null>(null);
  const [altAr, setAltAr] = useState('');
  const [altEn, setAltEn] = useState('');
  const [confirming, setConfirming] = useState<MediaRow | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (): Promise<State> => {
    try { return { kind: 'ready', rows: await fetchMedia() }; }
    catch { return { kind: 'error' }; }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load().then((s) => { if (!cancelled) setState(s); });
    return () => { cancelled = true; };
  }, [load]);

  const refresh = useCallback(() => { void load().then(setState); }, [load]);

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setNotice('');
    for (const file of Array.from(files)) {
      const err = validateFile(file);
      if (err) { setNotice(err); continue; }
      setProgress(0);
      try {
        await uploadMediaFile(file, setProgress);
        setNotice(ADMIN.uploadDone);
      } catch {
        setNotice(ADMIN.uploadError);
      }
    }
    setProgress(null);
    refresh();
    if (fileRef.current) fileRef.current.value = '';
  };

  const startEdit = (row: MediaRow) => { setEditing(row); setAltAr(row.alt.ar ?? ''); setAltEn(row.alt.en ?? ''); };
  const saveAlt = async () => {
    if (!editing) return;
    try {
      await updateMediaAlt(editing.id, { ar: altAr.trim() || undefined, en: altEn.trim() || undefined });
      setEditing(null); setNotice(ADMIN.saved); refresh();
    } catch { setNotice(ADMIN.saveError); }
  };
  const doDelete = async () => {
    if (!confirming) return;
    try {
      await deleteMedia(confirming);
      setConfirming(null); setNotice(ADMIN.deleted); refresh();
    } catch { setNotice(ADMIN.deleteError); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 className="text-h2">{ADMIN.media}</h1>
        <button type="button" style={primary} onClick={() => fileRef.current?.click()}>{ADMIN.upload}</button>
        <input ref={fileRef} type="file" accept={ACCEPT_ATTR} multiple hidden onChange={(e) => void onFiles(e.target.files)} />
      </div>

      {progress !== null && <div aria-live="polite"><div className="text-small text-muted">{ADMIN.uploading} {progress}%</div><div style={{ height: 6, background: 'var(--bg-alt)', borderRadius: 'var(--radius-pill)' }}><div style={{ height: 6, width: `${progress}%`, background: 'var(--accent-solid)', borderRadius: 'var(--radius-pill)' }} /></div></div>}
      {notice && <p aria-live="polite" className="text-small" style={{ color: 'var(--text)' }}>{notice}</p>}

      {state.kind === 'loading' && <div aria-busy="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>{[0,1,2,3].map((i) => <div key={i} style={{ height: 150, borderRadius: 'var(--radius-md)', background: 'var(--surface)' }} />)}</div>}
      {state.kind === 'error' && <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-md)', padding: 24 }}><p style={{ color: 'var(--danger)' }}>{ADMIN.loadError}</p><button type="button" style={{ ...secondary, marginTop: 12 }} onClick={refresh}>{ADMIN.retry}</button></div>}
      {state.kind === 'ready' && state.rows.length === 0 && <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-md)', padding: 24 }}><p className="text-muted">{ADMIN.mediaEmptyAdmin}</p><button type="button" style={{ ...primary, marginTop: 12 }} onClick={() => fileRef.current?.click()}>{ADMIN.upload}</button></div>}

      {state.kind === 'ready' && state.rows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
          {state.rows.map((r) => (
            <div key={r.id} className="card" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 10 }}>
              {r.mime_type.startsWith('image/') ? (
                <Image src={mediaPublicUrl(r.path)} alt={r.alt.ar ?? r.alt.en ?? ''} width={r.width ?? 300} height={r.height ?? 220} style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 'var(--radius-sm)' }} />
              ) : (<div style={{ height: 110, display: 'grid', placeItems: 'center' }}>PDF</div>)}
              <div className="text-caption text-muted" style={{ marginTop: 8 }}>{(r.alt.ar ?? r.alt.en ?? ADMIN.noAlt)}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button type="button" style={secondary} onClick={() => startEdit(r)}>{ADMIN.edit}</button>
                <button type="button" style={danger} onClick={() => setConfirming(r)}>{ADMIN.delete}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div role="dialog" aria-modal="true" aria-label={ADMIN.altText} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', padding: 16 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-md)', width: 'min(560px, 100%)', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 className="text-h3">{ADMIN.altText}</h2>
            <label className="text-small">{ADMIN.arabic}<input dir="rtl" style={input} value={altAr} onChange={(e) => setAltAr(e.target.value)} /></label>
            <label className="text-small">{ADMIN.english}<input dir="ltr" style={input} value={altEn} onChange={(e) => setAltEn(e.target.value)} /></label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" style={primary} onClick={() => void saveAlt()}>{ADMIN.save}</button>
              <button type="button" style={secondary} onClick={() => setEditing(null)}>{ADMIN.cancel}</button>
            </div>
          </div>
        </div>
      )}

      {confirming && (
        <div role="alertdialog" aria-modal="true" aria-label={ADMIN.deleteConfirmTitle} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', padding: 16 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-md)', width: 'min(480px, 100%)', padding: 20 }}>
            <h2 className="text-h3">{ADMIN.deleteConfirmTitle}</h2>
            <p className="text-muted" style={{ marginTop: 8 }}>{ADMIN.deleteConfirmText}</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <button type="button" style={{ ...btn, border: 'none', background: 'var(--danger)', color: '#fff' }} onClick={() => void doDelete()}>{ADMIN.delete}</button>
              <button type="button" style={secondary} onClick={() => setConfirming(null)}>{ADMIN.cancel}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
