/**
 * The error every service throws for an expected failure. `code` is UPPER_SNAKE and stable: HTTP and MCP map it to
 * status codes and structured errors. `details` is a JSON-serialisable object (e.g. `{ existingId }`).
 */
export class DossierError extends Error {
  /**
   * @param {string} code UPPER_SNAKE error code, e.g. 'ENTITY_DUPLICATE'
   * @param {string} message human-readable explanation
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details = {}) {
    if (!/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/.test(String(code))) throw new TypeError(`DossierError: code must be UPPER_SNAKE, got "${code}"`);
    super(message);
    this.name = 'DossierError';
    this.code = code;
    this.details = details ?? {};
  }

  /** @returns {{ code: string, message: string, details: Record<string, unknown> }} */
  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

/**
 * True when `err` is a DossierError (optionally with the given code).
 * @param {unknown} err
 * @param {string} [code]
 * @returns {boolean}
 */
export const isDossierError = (err, code) => err instanceof DossierError && (code === undefined || err.code === code);
