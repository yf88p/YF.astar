'use client';

import { useState } from 'react';

type Mode = 'system' | 'light' | 'dark';
type Props = { labels: { system: string; light: string; dark: string } };

function apply(mode: Mode) {
  try {
    localStorage.setItem('theme', mode);
    const dark =
      mode === 'dark' ||
      (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch {
    return;
  }
}

export default function ThemeToggle({ labels }: Props) {
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof window === 'undefined') return 'system';
    try {
      const v = localStorage.getItem('theme');
      return v === 'light' || v === 'dark' ? v : 'system';
    } catch {
      return 'system';
    }
  });

  const cycle = () => {
    const next: Mode = mode === 'system' ? 'light' : mode === 'light' ? 'dark' : 'system';
    setMode(next);
    apply(next);
  };

  return (
    <button type="button" onClick={cycle} className="theme-toggle text-small"
      style={{ minHeight: 44, minWidth: 44, padding: '8px 14px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border-input)', background: 'transparent', color: 'var(--text)', cursor: 'pointer' }}>
      {labels[mode]}
    </button>
  );
}
