/**
 * One repair budget, shared by the page and the server.
 *
 * The open tab and the background worker draw from the same pool, so this
 * number must be identical on both sides. Keeping it in one browser-safe
 * module stops the two from drifting apart.
 */
export const MAX_REPAIR_ATTEMPTS = 3;
