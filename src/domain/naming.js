/**
 * Make one file-name segment filesystem-safe: accents stripped, whitespace removed, path and underscore separators
 * turned into `-`, everything other than letters, digits and `-` dropped, repeated `-` collapsed.
 * ("Demo Retail Pvt. Ltd." -> "DemoRetailPvtLtd", "A/2026/01" -> "A-2026-01")
 * @param {unknown} value
 * @returns {string}
 */
export function slugSegment(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/\s+/gu, '')
    .replace(/[/\\_:|]+/gu, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-{2,}/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

/**
 * Display file name `<YYYY-MM-DD>_<party>_<Type>_<number>_v<version>.<ext>`. Empty segments are left out
 * (a document without a number gives `<date>_<party>_<Type>_v1.pdf`).
 * @param {{ date?: string|null, partyName?: string|null, type?: string|null, number?: string|null,
 *   version?: number|null, ext?: string|null }} parts
 * @returns {string}
 */
export function displayFileName({ date, partyName, type, number, version, ext }) {
  const day = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : '';
  const segments = [day, slugSegment(partyName), slugSegment(type), slugSegment(number)];
  if (Number.isSafeInteger(version) && version > 0) segments.push(`v${version}`);
  const base = segments.filter(Boolean).join('_') || 'document';
  const extension = String(ext ?? '').replace(/^\.+/, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return extension ? `${base}.${extension}` : base;
}
