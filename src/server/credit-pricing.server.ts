/**
 * Provider usage shape for a billable call. Pricing itself lives ONLY in
 * `@/lib/build-pricing` (measured cost → credits, configurable economics).
 */
export type GatewayUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  /** Real USD amount the gateway charged for this call, when reported. */
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number };
};
