export type AdminMode = 'open' | 'locked';

export const ADMIN_MODE: AdminMode =
  process.env.NEXT_PUBLIC_ADMIN_MODE === 'open' ? 'open' : 'locked';
