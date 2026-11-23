/**
 * Normalised form of a name used for `entities.canonical_key` and `entity_aliases.alias_key`:
 * Unicode NFKC, lower case, punctuation-insensitive spacing ("Acme  Events, Pvt." and "acme events pvt" match).
 * @param {string} name
 * @returns {string}
 */
export function canonicalKey(name) {
  return String(name ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s.,;:'"`’‘“”()[\]{}]+/gu, ' ')
    .trim();
}
