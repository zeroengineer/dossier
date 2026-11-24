// Layout profiles: page geometry shared by the document families (docs/DISCOVERY.md A2, A8 "Margin families").

const PAGE = Object.freeze({ PW: 595.28, PH: 841.89 });

const withWidth = (p) => Object.freeze({ ...p, CW: p.PW - p.ML - p.MR });

/**
 * Shipped layout profiles (points). `CW` is derived as `PW - ML - MR`; `CP` is the gap between the header rule zone /
 * footer zone and the content; `LOGO_H` the drawn letterhead logo height.
 */
export const PROFILES = Object.freeze({
  invoice: withWidth({ ...PAGE, ML: 40, MR: 40, MT: 40, MB: 40, CP: 0 }),
  letter: withWidth({ ...PAGE, ML: 37.5, MR: 37.5, MT: 100, MB: 39, CP: 10, LOGO_H: 32 }),
  settlement: withWidth({ ...PAGE, ML: 37.5, MR: 37.5, MT: 100, MB: 39, CP: 12, LOGO_H: 32 }),
  proposal: withWidth({ ...PAGE, ML: 40, MR: 40, MT: 100, MB: 42, CP: 12, LOGO_H: 32 }),
  compact: withWidth({ ...PAGE, ML: 42, MR: 42, MT: 100, MB: 39, CP: 14, LOGO_H: 32 }),
  mou: withWidth({ ...PAGE, ML: 45, MR: 45, MT: 50, MB: 50, CP: 0 }),
});

const NUMERIC_KEYS = ['PW', 'PH', 'ML', 'MR', 'MT', 'MB', 'CP', 'LOGO_H'];

/**
 * A layout profile with a brand's overrides applied (`brand.layoutProfiles`). `CW` is always recomputed.
 * @param {string} id one of the PROFILES keys
 * @param {Record<string, Record<string, unknown>>} [brandOverrides] the brand's `layoutProfiles` map (`{ <id>: { ML: 42, … } }`)
 * @returns {Readonly<{ PW: number, PH: number, ML: number, MR: number, MT: number, MB: number, CP: number, CW: number, LOGO_H?: number }>}
 */
export function getProfile(id, brandOverrides) {
  const base = PROFILES[id];
  if (!base) throw new Error(`unknown layout profile "${id}" (known: ${Object.keys(PROFILES).join(', ')})`);
  const over = brandOverrides?.[id];
  if (!over) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (k === 'CW') continue;
    if (NUMERIC_KEYS.includes(k) && !(typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
      throw new Error(`layoutProfiles.${id}.${k}: must be a non-negative number`);
    }
    out[k] = v;
  }
  return withWidth(out);
}
