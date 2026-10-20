import { notFound } from 'next/navigation';
import { isLocale } from '@/lib/i18n';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import EmptyState from '@/components/site/EmptyState';

type Props = { params: Promise<{ locale: string }> };

export default async function HomePage({ params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const t = raw === 'ar' ? ar : en;
  return <EmptyState title={t.empty_title} text={t.empty_text} />;
}
