import AdminEmpty from '@/components/admin/AdminEmpty';
import { ADMIN } from '@/messages/admin';

export default function ToolsPage() {
  return <AdminEmpty title={ADMIN.tools} text={ADMIN.toolsEmpty} />;
}
