import AdminEmpty from '@/components/admin/AdminEmpty';
import { ADMIN } from '@/messages/admin';

export default function PagesPage() {
  return <AdminEmpty title={ADMIN.pages} text={ADMIN.pagesEmpty} />;
}
