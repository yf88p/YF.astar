import { getBrowserClient } from '@/lib/supabase/browser';
import type { I18n } from '@/lib/i18n';
import { ADMIN } from '@/messages/admin';

export type MediaRow = {
  id: string;
  path: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  alt: I18n;
  created_at: string;
};

export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'application/pdf'] as const;
export const MAX_BYTES = 10 * 1024 * 1024;
export const ACCEPT_ATTR = ALLOWED_MIME.join(',');

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/avif': 'avif', 'image/gif': 'gif', 'application/pdf': 'pdf',
};

export function mediaPublicUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}/storage/v1/object/public/media/${path}`;
}

export function validateFile(file: File): string | null {
  if (file.size > MAX_BYTES) return ADMIN.fileTooLarge;
  if (!(ALLOWED_MIME as readonly string[]).includes(file.type)) return ADMIN.fileTypeNotAllowed;
  return null;
}

async function imageSize(blob: Blob): Promise<{ width: number | null; height: number | null }> {
  try {
    const bmp = await createImageBitmap(blob);
    const size = { width: bmp.width, height: bmp.height };
    bmp.close();
    return size;
  } catch {
    return { width: null, height: null };
  }
}

export async function fetchMedia(): Promise<MediaRow[]> {
  const { data, error } = await getBrowserClient()
    .from('media').select('id, path, mime_type, size_bytes, width, height, alt, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MediaRow[];
}

export async function uploadMediaFile(file: File, onProgress: (pct: number) => void): Promise<MediaRow> {
  let blob: Blob = file;
  let mime = file.type;
  if (file.type.startsWith('image/') && file.type !== 'image/gif') {
    const { default: imageCompression } = await import('browser-image-compression');
    blob = await imageCompression(file, {
      maxWidthOrHeight: 1600,
      fileType: 'image/webp',
      initialQuality: 0.8,
      useWebWorker: false,
      onProgress: (p: number) => onProgress(p),
    });
    mime = 'image/webp';
  } else {
    onProgress(100);
  }
  const size = mime.startsWith('image/') ? await imageSize(blob) : { width: null, height: null };
  const path = `${crypto.randomUUID()}.${EXT_BY_MIME[mime] ?? 'bin'}`;
  const db = getBrowserClient();
  const up = await db.storage.from('media').upload(path, blob, { contentType: mime, upsert: false });
  if (up.error) throw up.error;
  const { data, error } = await db.from('media')
    .insert({ path, mime_type: mime, size_bytes: blob.size, width: size.width, height: size.height, alt: {} })
    .select('id, path, mime_type, size_bytes, width, height, alt, created_at').single();
  if (error) {
    await db.storage.from('media').remove([path]);
    throw error;
  }
  return data as MediaRow;
}

export async function updateMediaAlt(id: string, alt: I18n): Promise<void> {
  const { error } = await getBrowserClient().from('media').update({ alt }).eq('id', id);
  if (error) throw error;
}

export async function deleteMedia(row: MediaRow): Promise<void> {
  const db = getBrowserClient();
  const rm = await db.storage.from('media').remove([row.path]);
  if (rm.error) throw rm.error;
  const { error } = await db.from('media').delete().eq('id', row.id);
  if (error) throw error;
}
