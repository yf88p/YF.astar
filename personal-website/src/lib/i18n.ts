export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ar';
export type I18n = Partial<Record<Locale, string>>;

export const isLocale = (v: string): v is Locale =>
  (LOCALES as readonly string[]).includes(v);

export const dirOf = (l: Locale): 'rtl' | 'ltr' => (l === 'ar' ? 'rtl' : 'ltr');

export function tr(v: I18n | null | undefined, locale: Locale): string {
  if (!v) return '';
  const other: Locale = locale === 'ar' ? 'en' : 'ar';
  return v[locale]?.trim() || v[other]?.trim() || '';
}

export function trLang(
  v: I18n | null | undefined,
  locale: Locale,
): { text: string; lang: Locale } {
  const other: Locale = locale === 'ar' ? 'en' : 'ar';
  const own = v?.[locale]?.trim();
  if (own) return { text: own, lang: locale };
  const fallback = v?.[other]?.trim();
  return fallback ? { text: fallback, lang: other } : { text: '', lang: locale };
}
