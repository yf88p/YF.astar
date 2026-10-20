import AdminEmpty from '@/components/admin/AdminEmpty';
import { ADMIN } from '@/messages/admin';

export default function SettingsPage() {
  return <AdminEmpty title={ADMIN.settings} text={ADMIN.settingsEmpty} />;
}
