import { NextResponse, type NextRequest } from 'next/server';
import { LOCALES, DEFAULT_LOCALE } from '@/lib/i18n';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasLocale = LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
  if (hasLocale) return NextResponse.next();

  const cookie = request.cookies.get('NEXT_LOCALE')?.value;
  const locale = LOCALES.find((l) => l === cookie) ?? DEFAULT_LOCALE;
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/((?!api|admin|_next|.*\\..*).*)'] };
