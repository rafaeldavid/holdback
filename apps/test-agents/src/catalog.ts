// What Crow's test seller sells (T-222): the one dataset examples/try.ts trades, 3 rows of customer_id,email for
// 25 tUSDC under three declarative checks, on the checks-only template, public terms. A buyer that asks for a refund
// gets work that fails the rows check: 2 rows instead of 3. Test tokens only.

export const PRICE_UNITS = '25000000'; // 25 tUSDC: 6 decimals
export const ITEM_ID = 'customers-3';
export const DELIVERABLE = { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' };
export const CHECKS = [
  { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
  { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
  { id: 'uniq', type: 'unique_key', required: true, columns: ['customer_id'] },
];
/**
 * The windows the seller offers. The judge, fallback and appeal windows are the demo club's shortest, so a deal is
 * final a minute after the decision. The buyer has 30 minutes to agree (the offer expires) and 40 to fund. The seller
 * delivers within seconds of the funding; deliverBy counts from the offer, so if the seller never delivers, the buyer
 * reclaims its hold an hour after the offer (bounded loss, D26).
 */
export const TIMING = { offerExpiresInSec: 1800, fundWithinSec: 2400, deliverWithinSec: 3600, judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 60, appealDecideSec: 60 };

export const GOOD_CSV = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n3,grace@example.com\n';
/** Fails the rows check (2 rows, not 3): the buyer gets the price back. */
export const BAD_CSV = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n';

export type Outcome = 'release' | 'refund';

/** Bounded loss (D26): how many deals the seller takes on, so a flood costs the operators' relayer a known amount. */
export interface Limits {
  /** Requests in progress at once (received, offered and not yet expired, or delivered). */
  open: number;
  /** New requests from everyone per rolling hour, and per UTC day. */
  perHour: number;
  perDay: number;
  /** New requests per client (IP address) per rolling hour, and per UTC day. Kept in memory only. */
  perClientPerHour: number;
  perClientPerDay: number;
}
export const LIMITS: Limits = { open: 10, perHour: 20, perDay: 100, perClientPerHour: 3, perClientPerDay: 10 };
