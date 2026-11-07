/**
 * Time rules for the build service's "finished" callback.
 *
 * The build service waits CALLBACK_ACK_TIMEOUT_MS for each callback attempt
 * (builder/src/server.ts → postCallback) and then hangs up; the host cancels
 * our handler with it. Everything that runs before the build is recorded as
 * ready must therefore finish inside PRE_READY_BUDGET_MS, leaving room for the
 * live-site probe and the database writes.
 */
export const CALLBACK_ACK_TIMEOUT_MS = 20_000;
export const PRE_READY_BUDGET_MS = 12_000;
