import { DossierError } from '../errors.js';

/** Document statuses in lifecycle order. */
export const STATUSES = Object.freeze(['Draft', 'Sent', 'Signed', 'Paid', 'Superseded']);

/** Allowed status transitions (from -> list of to). `Superseded` is terminal. */
export const TRANSITIONS = Object.freeze({
  Draft: Object.freeze(['Sent', 'Signed', 'Superseded']),
  Sent: Object.freeze(['Signed', 'Paid', 'Superseded']),
  Signed: Object.freeze(['Paid', 'Superseded']),
  Paid: Object.freeze(['Superseded']),
  Superseded: Object.freeze([]),
});

/**
 * True when `to` is a known status reachable from `from` in one step.
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export const canTransition = (from, to) => Object.hasOwn(TRANSITIONS, from) && TRANSITIONS[from].includes(to);

/**
 * Throw unless `from -> to` is an allowed transition.
 * @param {string} from
 * @param {string} to
 * @throws {DossierError} INVALID_INPUT for an unknown status, INVALID_STATUS_TRANSITION for a disallowed step
 */
export function assertTransition(from, to) {
  for (const s of [from, to]) {
    if (!STATUSES.includes(s)) throw new DossierError('INVALID_INPUT', `Unknown status "${s}" (expected one of ${STATUSES.join(', ')})`, { status: s });
  }
  if (!canTransition(from, to)) {
    const allowed = TRANSITIONS[from];
    throw new DossierError('INVALID_STATUS_TRANSITION',
      `Cannot change status from ${from} to ${to}${allowed.length ? ` (allowed: ${allowed.join(', ')})` : ` (${from} is final)`}`,
      { from, to, allowed: [...allowed] });
  }
}
