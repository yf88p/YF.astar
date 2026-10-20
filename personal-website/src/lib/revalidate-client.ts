export async function revalidateSite(): Promise<boolean> {
  try {
    const res = await fetch('/api/revalidate', { method: 'POST' });
    return res.ok;
  } catch {
    return false;
  }
}
