// Quote and dash variants folded to ASCII before punctuation is stripped ("O’Brien" = "O'Brien", "A – B" = "A - B").
const SINGLE_QUOTES = /[‘’‚‛′ʼ`´]/gu;
const DOUBLE_QUOTES = /[“”„‟″«»]/gu;
const DASHES = /[‐‑‒–—―−﹘﹣]/gu;
// Every Unicode punctuation character except `&`, `'` and `-`.
const PUNCTUATION = /[^\P{P}&'-]+/gu;

/**
 * The one name normalisation of Dossier, used for `entities.canonical_key`, `entity_aliases.alias_key` and lookups:
 * Unicode NFKC, lower case, curly quotes and dash variants unified to `'`, `"` and `-`, punctuation other than
 * `&`, `'` and `-` replaced by a space, whitespace collapsed and trimmed.
 * ("Acme  Events, Pvt." and "acme events pvt" match; "O’Brien & Co" becomes "o'brien & co").
 * @param {unknown} name
 * @returns {string} '' for empty or punctuation-only input
 */
export function normaliseName(name) {
  return String(name ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, '-')
    .replace(PUNCTUATION, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Alias of {@link normaliseName}: the value stored in `canonical_key` / `alias_key` columns. */
export const canonicalKey = normaliseName;
