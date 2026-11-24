// Money, date and amount-in-words formatting driven by the workspace locale (docs/DISCOVERY.md A8 "Shared helpers").

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

export const LOCALE_DEFAULTS = Object.freeze({
  currencySymbol: '₹',
  numberLocale: 'en-IN',
  dateFormats: { short: 'DD/MM/YYYY', long: 'D MMMM YYYY', us: 'MMMM D, YYYY' },
  currencyWords: { major: 'Rupees', minor: 'Paise', suffix: 'Only' },
});

function checkMinor(minor, fn) {
  if (!Number.isSafeInteger(minor)) throw new TypeError(`${fn}: amount must be an integer number of minor units (got ${minor})`);
}

function twoDigits(n) {
  return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : '');
}

function threeDigits(n) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', rest ? twoDigits(rest) : ''].filter(Boolean).join(' ');
}

/** Words for a non-negative integer in the Indian system (Thousand, Lakh, Crore; crores recurse). */
export function indianWords(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 1e7);
  const rest = n % 1e7;
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  const lakh = Math.floor(rest / 1e5);
  const thousand = Math.floor((rest % 1e5) / 1000);
  const hundreds = rest % 1000;
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundreds) parts.push(threeDigits(hundreds));
  return parts.join(' ');
}

/** `{ y, m, d }` from an ISO date string (date part taken literally, no time-zone shift) or a Date (local time). */
function dateParts(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new RangeError('fmt.date: invalid Date');
    return { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(String(value ?? ''));
  if (!m) throw new RangeError(`fmt.date: expected YYYY-MM-DD, got "${value}"`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) throw new RangeError(`fmt.date: not a calendar date "${value}"`);
  return { y, m: mo, d };
}

function ordinal(d) {
  const s = d % 100 >= 11 && d % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[d % 10] ?? 'th';
  return `${d}${s}`;
}

/**
 * Format date parts with a pattern: `YYYY`, `MMMM` (month name), `MMM` (short name), `MM`, `M`, `DD`, `Do` (31st), `D`.
 * Other characters are copied.
 * @param {{ y: number, m: number, d: number }} p
 * @param {string} pattern
 */
function applyPattern(p, pattern) {
  return pattern.replace(/YYYY|MMMM|MMM|MM|M|DD|Do|D/g, (tok) => ({
    YYYY: String(p.y).padStart(4, '0'),
    MMMM: MONTHS[p.m - 1],
    MMM: MONTHS[p.m - 1].slice(0, 3),
    MM: String(p.m).padStart(2, '0'),
    M: String(p.m),
    DD: String(p.d).padStart(2, '0'),
    Do: ordinal(p.d),
    D: String(p.d),
  })[tok]);
}

/**
 * Build the formatter bound to a workspace locale (`ws.config.locale`).
 * @param {object} [locale]
 */
export function createFormatter(locale = {}) {
  const currencySymbol = locale.currencySymbol ?? LOCALE_DEFAULTS.currencySymbol;
  const numberLocale = locale.numberLocale ?? LOCALE_DEFAULTS.numberLocale;
  const dateFormats = { ...LOCALE_DEFAULTS.dateFormats, ...locale.dateFormats };
  const words = { ...LOCALE_DEFAULTS.currencyWords, ...locale.currencyWords };

  const number = (minor, { decimals = 2 } = {}) => {
    checkMinor(minor, 'fmt.number');
    const s = (Math.abs(minor) / 100).toLocaleString(numberLocale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return minor < 0 ? `-${s}` : s;
  };

  return Object.freeze({
    /**
     * Grouped number without a symbol, e.g. `1,20,000.00` (minor units in, `decimals` places out).
     * @param {number} minor @param {{ decimals?: number }} [opts]
     */
    number,
    /**
     * Currency amount: `'₹ 1,20,000.00'` with `space: true` (invoice family), `'₹1,20,000.00'` without (letters).
     * @param {number} minor amount in minor units (paise)
     * @param {{ space?: boolean, decimals?: number }} [opts]
     */
    money(minor, { space = false, decimals = 2 } = {}) {
      checkMinor(minor, 'fmt.money');
      const body = number(Math.abs(minor), { decimals });
      return `${minor < 0 ? '-' : ''}${currencySymbol}${space ? ' ' : ''}${body}`;
    },
    /**
     * Date in one of the locale styles (`short` DD/MM/YYYY, `long` 29 August 2026, `us` August 29, 2026) or a raw pattern.
     * @param {string|Date} iso @param {'short'|'long'|'us'|string} [style]
     */
    date(iso, style = 'long') {
      const pattern = dateFormats[style] ?? style;
      return applyPattern(dateParts(iso), pattern);
    },
    /**
     * Amount in words, Indian system: `Rupees One Lakh Twenty Thousand Only`, `Rupees Ten and Fifty Paise Only`,
     * `Fifty Paise Only`, `Rupees Zero Only`.
     * @param {number} minor non-negative amount in minor units
     */
    amountInWords(minor) {
      checkMinor(minor, 'fmt.amountInWords');
      if (minor < 0) throw new RangeError('fmt.amountInWords: amount must not be negative');
      const major = Math.floor(minor / 100);
      const paise = minor % 100;
      const parts = major || !paise ? [words.major, indianWords(major)] : [];
      if (paise) parts.push(...(major ? ['and'] : []), twoDigits(paise), words.minor);
      if (words.suffix) parts.push(words.suffix);
      return parts.filter(Boolean).join(' ');
    },
  });
}
