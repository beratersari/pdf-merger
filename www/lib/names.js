export function displayName(raw) {
  const cleaned = String(raw ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
  return cleaned || 'document.pdf';
}

export function safePdfName(raw) {
  const cleaned = String(raw ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim();
  let base = cleaned || 'merged';
  if (!base.toLowerCase().endsWith('.pdf')) base = `${base}.pdf`;
  if (base.toLowerCase() === '.pdf') base = 'merged.pdf';
  if (base.length <= 180) return base;
  const trimmed = base.slice(0, 180);
  if (trimmed.toLowerCase().endsWith('.pdf')) return trimmed;
  return `${trimmed.slice(0, 176)}.pdf`;
}
