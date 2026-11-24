/**
 * A small least-recently-used map: `get` refreshes an entry, `set` evicts the oldest entries beyond `max`.
 * @template K, V
 */
export class Lru {
  /** @param {number} max largest number of entries kept (at least 1) */
  constructor(max) {
    if (!Number.isSafeInteger(max) || max < 1) throw new RangeError('Lru: max must be a positive integer');
    this.max = max;
    /** @type {Map<K, V>} */
    this.map = new Map();
  }

  /** @param {K} key @returns {V|undefined} */
  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  /** @param {K} key @returns {boolean} */
  has(key) {
    return this.map.has(key);
  }

  /** @param {K} key @param {V} value */
  set(key, value) {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    return this;
  }

  /** @param {K} key */
  delete(key) {
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}
