/**
 * Site-level visibility flags for surfaces that are paused, not deleted.
 * Flip a flag back to true to bring the surface back into the UI — the
 * underlying routes, pages and APIs stay in place either way.
 */

/** Investor round promotion is paused. `/invest` still works by direct URL. */
export const INVEST_LINKS_ENABLED = false;
