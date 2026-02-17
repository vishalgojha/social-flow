export function sanitizeText(value: unknown): string {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 2048);
}
