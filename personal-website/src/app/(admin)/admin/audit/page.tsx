import AdminEmpty from '@/components/admin/AdminEmpty';
import { ADMIN } from '@/messages/admin';

export default function AuditPage() {
  return <AdminEmpty title={ADMIN.audit} text={ADMIN.auditEmpty} />;
}
