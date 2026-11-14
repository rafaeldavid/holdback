// What Crow's test seller sells (T-222, T-420): four named offers, one per ending an outsider needs to see before
// trusting Crow. A buyer picks one by name with "offer": "<id>" in its proposal. Test tokens only.
//
//   customers-3           3 rows of customer_id,email under three checks: the checks decide, and it releases.
//                         "test": {"outcome": "refund"} delivers 2 rows instead, which fail the rows check.
//   summary-judged        a short text a live judge panel scores against a rubric: it passes, and it releases.
//   summary-judged-fails  the same terms, and a text that states the opposite of what the terms ask: the panel
//                         rejects it, and the buyer gets the price back.
//   customers-3-silent    the dataset's terms with a 5-minute delivery window, and the seller never delivers: the
//                         buyer's hold comes back at the deadline.
//
// The judged texts are honest work, good or bad. Neither carries words aimed at a judge (CLAUDE.md, "Deliverables
// are untrusted"); a fixture that does is an attack fixture and is labelled as one.

export const PRICE_UNITS = '25000000'; // 25 tUSDC: 6 decimals
export const ITEM_ID = 'customers-3';
export const DELIVERABLE = { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' };
export const CHECKS = [
  { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
  { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
  { id: 'uniq', type: 'unique_key', required: true, columns: ['customer_id'] },
];
/**
 * The windows the seller offers. The judge, fallback and appeal windows are the demo club's shortest; judgeBy counts
 * from deliverBy, so a judge panel has the rest of the delivery window and another minute. The buyer has 30 minutes
 * to agree (the offer expires) and 40 to fund. The seller delivers within seconds of the funding; deliverBy counts from
 * the offer, so if the seller never delivers, the buyer reclaims its hold an hour after the offer (bounded loss, D26).
 */
export const TIMING = { offerExpiresInSec: 1800, fundWithinSec: 2400, deliverWithinSec: 3600, judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 }; // phase one: no party appeal (ADR-0033 §2b)
/**
 * The silent offer's windows: 3 minutes to agree, 4 to fund, and deliverBy 5 minutes after the offer. The operators
 * send the reclaim on their own a minute or two after deliverBy (docs/api.md, triggers), and the buyer may send it
 * first: the hold comes back about 6 minutes after the offer.
 */
export const SILENT_TIMING = { ...TIMING, offerExpiresInSec: 180, fundWithinSec: 240, deliverWithinSec: 300 };

export const GOOD_CSV = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n3,grace@example.com\n';
/** Fails the rows check (2 rows, not 3): the buyer gets the price back. */
export const BAD_CSV = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n';

export const SUMMARY_PRICE_UNITS = '10000000'; // 10 tUSDC
export const SUMMARY = {
  kind: 'document',
  description:
    "A plain-English summary, 40 to 120 words, of how a payment hold works on Crow. It must state four facts: the buyer's payment is locked when the buyer funds the deal; the seller is paid when the adjudicator accepts the work; the buyer gets the price back when the adjudicator rejects the work; and the buyer gets the price back when nothing is delivered by the deadline.",
  format: 'text/plain',
};
/** One check before the panel: no invisible characters in the text (ADR-0021). */
export const SUMMARY_CHECKS = [{ id: 'hidden', type: 'hidden_characters_max', required: true, max: { total: 0 } }];
export const SUMMARY_RUBRIC = {
  passThreshold: 300,
  criteria: [
    {
      id: 'accurate',
      description: 'Every statement the summary makes about the hold agrees with the four facts in the deliverable description.',
      weight: 60,
      anchors: { '0': 'It contradicts two or more of the four facts, or it is about something else.', '2': 'It contradicts one of the four facts, or it is vague about who is paid when.', '4': 'Every statement agrees with the four facts; none contradicts them.' },
    },
    {
      id: 'complete',
      description: 'The summary states all four facts: the lock at funding, payment on an accept, the price back on a reject, the price back when nothing is delivered by the deadline.',
      weight: 40,
      anchors: { '0': 'It states none of the four facts, or one.', '2': 'It states two or three of the four facts.', '4': 'It states all four facts.' },
    },
  ],
};
/** States the four facts: a panel that reads it against the rubric passes it. 70 words. */
export const GOOD_SUMMARY =
  'When a buyer funds a deal on Crow, its payment is locked in a hold that neither party can take alone. The seller then delivers the work. If the adjudicator accepts the work, the hold pays the seller. If the adjudicator rejects it, the buyer gets the price back. If the seller delivers nothing by the deadline, the buyer gets the price back too.\n';
/** Honest bad work: it states the opposite of three of the four facts. A panel that reads it against the rubric rejects it. 66 words. */
export const BAD_SUMMARY =
  'When a buyer funds a deal on Crow, the seller is paid at once, before any work arrives. The adjudicator reads the work later and gives it a rating, but the rating changes nothing about the payment. If the seller delivers nothing, the payment stays with the seller, and the buyer has to ask the seller for its money back.\n';

/** What the seller does in a deal: deliver work that passes, deliver work that fails, or never deliver. */
export type Outcome = 'release' | 'refund' | 'silent';

export interface Offer {
  id: string;
  /** One sentence for the card and the page: what happens. */
  says: string;
  price: string;
  deliverable: { kind: string; description: string; format: string };
  template: 'checks-only' | 'default';
  checks: unknown[];
  rubric?: typeof SUMMARY_RUBRIC;
  timing: Record<string, number>;
  outcome: Outcome;
  /** A live judge panel decides: counted against the seller's daily budget of judged offers. */
  judged: boolean;
}

/** The four offers, in the order the card lists them; customers-3 stays first (examples/try.ts reads offers[0]). */
export function offers(timing: Record<string, number> = TIMING, silentTiming: Record<string, number> = SILENT_TIMING): Offer[] {
  const customers = { price: PRICE_UNITS, deliverable: DELIVERABLE, template: 'checks-only' as const, checks: CHECKS, judged: false };
  const summary = { price: SUMMARY_PRICE_UNITS, deliverable: SUMMARY, template: 'default' as const, checks: SUMMARY_CHECKS, rubric: SUMMARY_RUBRIC, timing, judged: true };
  return [
    { id: ITEM_ID, says: '3 rows that pass every check: the checks decide and the deal releases.', ...customers, timing, outcome: 'release' },
    { id: 'summary-judged', says: 'A text that states the four facts: the checks pass, a live judge panel scores it against the rubric and passes it, and the deal releases.', ...summary, outcome: 'release' },
    { id: 'summary-judged-fails', says: 'The same terms, and a text that states the opposite of three facts: the checks pass, a live judge panel rejects it, and the deal refunds.', ...summary, outcome: 'refund' },
    { id: 'customers-3-silent', says: `The dataset's terms with deliverBy ${Math.round(Number(silentTiming['deliverWithinSec']) / 60)} minutes after the offer, and the seller never delivers: the buyer's hold comes back at the deadline.`, ...customers, timing: silentTiming, outcome: 'silent' },
  ];
}

/** The bytes a deal delivers: the offer's work, and for customers-3 with a refund asked, 2 rows. Null: never delivers. */
export function workOf(offer: Offer, outcome: Outcome): string | null {
  if (outcome === 'silent') return null;
  if (offer.judged) return outcome === 'refund' ? BAD_SUMMARY : GOOD_SUMMARY;
  return outcome === 'refund' ? BAD_CSV : GOOD_CSV;
}

/** Bounded loss (D26): how many deals the seller takes on, so a flood costs the operators' relayer a known amount. */
export interface Limits {
  /** Requests in progress at once (received, offered and not yet expired, or delivered). */
  open: number;
  /** Offers to everyone per rolling hour, and per UTC day: only requests whose proposal opened count. */
  perHour: number;
  perDay: number;
  /** New requests per client (an IPv4 address, or an IPv6 /64) per rolling hour, and per UTC day. Kept in memory only. */
  perClientPerHour: number;
  perClientPerDay: number;
  /**
   * Judged offers per UTC day, within the demo's daily budget of live judge calls (30, 3 a panel): 5 leave the
   * other half for other sellers' deals. Counted in `perDay` too.
   */
  judgedPerDay: number;
}
export const LIMITS: Limits = { open: 10, perHour: 20, perDay: 100, perClientPerHour: 3, perClientPerDay: 10, judgedPerDay: 5 };
