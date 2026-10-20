import { NextResponse } from 'next/server';
import { createPublicClient } from '@/lib/supabase/public';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const { error } = await createPublicClient().from('site_settings').select('key').limit(1);
  return NextResponse.json({ ok: !error }, { status: error ? 500 : 200 });
}
