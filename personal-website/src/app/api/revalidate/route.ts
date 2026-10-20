import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { LOCALES } from '@/lib/i18n';
import { ADMIN_MODE } from '@/lib/admin-mode';

export const dynamic = 'force-dynamic';

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (ADMIN_MODE !== 'open' || !isSameOrigin(request)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  for (const l of LOCALES) revalidatePath(`/${l}`, 'layout');
  revalidatePath('/sitemap.xml');
  return NextResponse.json({ ok: true });
}
