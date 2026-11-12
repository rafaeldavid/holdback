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
 * The windows it accepts, in seconds, all counted from settlement time when the offer is posted, never from the
 * offer's own createdAt, which the seller signs and nothing else bounds (T-239 review, finding 1):
 * - the offer is dated at most a minute after settlement time;
 * - it needs a minute to agree and fund before the offer or the funding closes;
 * - the work is due at most a day from now, and each judging window (judge, fallback, appeal, appeal decision) is
 *   at most an hour, so a stalled deal holds its test tokens for a bounded time (D26);
 * - the primary adjudicator accepts the offer within 2 minutes of the post, or the buyer drops it.
 */
export const WINDOWS = { maxCreatedAheadSec: 60, minFundingLeftSec: 60, maxDeliverWithinSec: 86_400, maxJudgingSec: 3600, maxAdjudicatorAcceptSec: 120 };

/** Bounded loss (D26): how many deals it takes on, so a flood costs the operators' relayer a known amount. */
export interface BuyerLimits {
  /** Deals in progress at once (accepted or funded, not yet settled). */
  open: number;
  /** Deals it takes on per UTC day, in all. */
  perDay: number;
  /** Deals it takes on per seller address, per rolling hour and per UTC day. */
  perSellerPerHour: number;
  perSellerPerDay: number;
  /**
   * Posts to /offers per client (an IPv4 address, or an IPv6 /64) per rolling minute and hour, counted before any
   * operator read, so posts cannot spend the operators' read budget. Kept in memory only (T-239 review, finding 3).
   */
  perClientPerMinute: number;
  perClientPerHour: number;
}
export const BUYER_LIMITS: BuyerLimits = { open: 10, perDay: 50, perSellerPerHour: 3, perSellerPerDay: 10, perClientPerMinute: 6, perClientPerHour: 60 };
