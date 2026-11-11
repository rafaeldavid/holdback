// What Crow's test buyer accepts (T-239), as catalog.ts is what the test seller sells. These are the buyer's own
// choices as a party, published on its card, not protocol rules (D31): a seller whose offer fits them is agreed and
// funded with test tUSDC; any other offer is refused with the rule it broke. Test tokens only.

/** The largest price it pays, and the largest adjudication fee it pays on top: 50 tUSDC and 5 tUSDC (6 decimals). */
export const MAX_PRICE_UNITS = '50000000';
export const MAX_ADJUDICATION_FEE_UNITS = '5000000';

/**
 * The deterministic check types it accepts: every type in spec/schemas/commitment.schema.json. Each is declarative
 * data the adjudicator evaluates; the buyer runs nothing from an offer, and takes no rubric (checks-only).
 */
export const CHECK_TYPES = ['csv_columns_exact', 'row_count_range', 'unique_key', 'null_rate_max', 'regex_match_rate_min', 'hidden_characters_max', 'reference_row_match_min', 'json_schema'] as const;
export const CHECKS_RULE = { types: CHECK_TYPES, min: 1, max: 10, requiredAtLeast: 1 };

/**
 * The windows it accepts, in seconds. It needs a minute to agree and fund before the offer or the funding closes. The
 * work is due at most a day after the offer, and each judging window (judge, fallback, appeal, appeal decision) is at
 * most an hour, so a stalled deal holds its test tokens for a bounded time (D26).
 */
export const WINDOWS = { minFundingLeftSec: 60, maxDeliverWithinSec: 86_400, maxJudgingSec: 3600 };

/** Bounded loss (D26): how many deals it takes on, so a flood costs the operators' relayer a known amount. */
export interface BuyerLimits {
  /** Deals in progress at once (accepted or funded, not yet settled). */
  open: number;
  /** Deals it takes on per UTC day, in all. */
  perDay: number;
  /** Deals it takes on per seller address, per rolling hour and per UTC day. */
  perSellerPerHour: number;
  perSellerPerDay: number;
}
export const BUYER_LIMITS: BuyerLimits = { open: 10, perDay: 50, perSellerPerHour: 3, perSellerPerDay: 10 };
