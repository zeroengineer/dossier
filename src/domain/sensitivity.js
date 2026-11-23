import { DossierError } from '../errors.js';

/** Sensitivity levels, lowest first. A user's clearance is one of these. */
export const LEVELS = Object.freeze(['Public', 'Internal', 'Confidential', 'Restricted']);

/**
 * True when a user with `clearance` may see a document of `sensitivity`. Unknown values never grant access.
 * @param {string} clearance
 * @param {string} sensitivity
 * @returns {boolean}
 */
export function canAccess(clearance, sensitivity) {
  const c = LEVELS.indexOf(clearance);
  const s = LEVELS.indexOf(sensitivity);
  return c >= 0 && s >= 0 && s <= c;
}

/**
 * The levels a user with `clearance` may see (empty for an unknown clearance).
 * @param {string} clearance
 * @returns {string[]}
 */
export const accessibleLevels = (clearance) => LEVELS.filter((l) => canAccess(clearance, l));

/**
 * Throw FORBIDDEN unless ctx.user may see `doc`.
 * @param {{ user: { id: string, clearance: string } }} ctx
 * @param {{ id?: string, sensitivity: string }} doc
 */
export function assertAccess(ctx, doc) {
  if (!canAccess(ctx.user.clearance, doc.sensitivity)) {
    throw new DossierError('FORBIDDEN', `${doc.id ?? 'This document'} is ${doc.sensitivity}; user "${ctx.user.id}" has ${ctx.user.clearance} clearance`,
      { id: doc.id ?? null, sensitivity: doc.sensitivity, clearance: ctx.user.clearance });
  }
}
