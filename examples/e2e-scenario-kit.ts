// What the scenarios of the first full EVM end-to-end round share (T-216): the scenario type, the deals' terms and
// work, the prerequisite check, and the checks and appeal steps more than one scenario runs. e2e-scenarios.ts holds
// the scenarios that run and the registry; e2e-scenarios-<group>.ts hold the four groups still being built. Every
// file imports from here, never from e2e-scenarios.ts, so the registry can import the groups without a cycle.
import { fileURLToPath } from 'node:url';
import { paymentHashOf } from './e2e-chain.ts';
import { get, logsOf, reason, retry, short, sleep, trigger, waitPast, Waits, type Deal, type Run } from './e2e-run.ts';

export type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Scenario {
  id: string;
  title: string;
  /** The tasks that must be live (through T-220's deploy) before it can run against the demo. */
  waitsFor: string[];
  /** What it still needs beyond those tasks, for the Handoff; empty when it is implemented. */
  needs?: string;
  run(r: Run): Promise<void>;
}

export const PRICE = '25000000'; // 25 tUSDC: 6 decimals
export const DATASET = { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' };
export const CHECKS = [
  { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
  { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
  { id: 'uniq', type: 'unique_key', required: true, columns: ['customer_id'] },
];
export const CSV = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n3,grace@example.com\n';
/** The bad-work-row-drop shape: a row missing, so the required rows check fails. */
export const BAD_CSV = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n';
/** Scenario 1's rubric deal: a short translation, judged by the panel against two weighted criteria. */
export const MEMO = 'The goods ship on Tuesday. Payment is due within 30 days of delivery.';
export const TRANSLATION = { kind: 'document', description: `Translate into French: "${MEMO}"`, format: 'text/plain' };
export const RUBRIC = {
  passThreshold: 300, // hundredths of a point: 3.00 of 4
  criteria: [
    { id: 'faithful', description: 'Every sentence keeps its meaning, dates and amounts.', weight: 70, anchors: { '0': 'Meaning lost', '2': 'Minor errors', '4': 'Faithful' } },
    { id: 'fluent', description: 'Reads as natural, formal French.', weight: 30, anchors: { '0': 'Unreadable', '2': 'Awkward', '4': 'Natural' } },
  ],
};
export const FRENCH = 'Les marchandises sont expédiées mardi. Le paiement est dû dans les 30 jours suivant la livraison.';
/** What scenario 6's appellant holds before its deal: the price, both fees and the bond, with room (base units). */
export const APPELLANT_FLOAT = 100_000_000n;

export const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
export const lc = (a: string) => a.toLowerCase();

/**
 * Stops the run as waiting unless every task in `tasks` is live: T-217 when the club's rulebook names the drand
 * quicknet beacon on a chain (the demo world's fallback and appeal adjudicators decide on a chain only with it;
 * SimChain's own beacon needs none), T-221 when the demo primary's served registration carries a signature (its
 * second slice, the world's registration store), T-218 and T-219 when the round is told T-220 has shipped them
 * (`--t220`), since no API read shows either.
 */
export async function requires(r: Run, tasks: string[]): Promise<void> {
  const missing: string[] = [];
  const { round } = r;
  for (const t of tasks) {
    if (t === 'T-217') {
      const club = await round.agent('master').club(round.demo.clubId);
      const source = club.rulebook.randomness?.source;
      if (round.chain && source !== 'drand-quicknet') missing.push(`T-217 (the club's beacon is ${source}, not drand-quicknet)`);
    } else if (t === 'T-221') {
      // Slice 2 registers the demo's own adjudicators through the store outsiders use, so their records carry a signature.
      const served = await round.agent('master').trusted(`/v1/adjudicators/${round.demo.adjudicators.primary}`, (x) => x.registration?.signature ?? null).catch(() => null);
      if (!served) missing.push("T-221 (the demo primary's served registration carries no signature, so the world's registration store is not live)");
    } else if (!round.t220) {
      missing.push(`${t} (no API read shows it; pass --t220 once T-220 has deployed it)`);
    }
  }
  if (missing.length) {
    r.waitsFor = missing.map((m) => m.split(' ')[0]!);
    throw new Waits(r.waitsFor, missing.join('; '));
  }
}

/** The judgment record each operator serves, from the first (informative: the state is what settled). */
export async function judgment(deal: Deal): Promise<J | null> {
  try {
    return await deal.buyer.call('GET', `/v1/commitments/${deal.id}/judgment`);
  } catch {
    return null;
  }
}

/** The decision's checks in one line: "cols pass, rows FAIL". */
export const checksLine = (j: J | null) => (j?.deterministic ?? []).map((c: J) => `${c.checkId} ${c.passed ? 'pass' : 'FAIL'}`).join(', ');

/**
 * Sends `appeal-expiry` once the appeal window has closed, so the primary's bond is freed on chain, then waits for both
 * operators to show the appeal expired. Since T-211 the demo's adjudicators expire their own decisions' appeals, so
 * the window may already be closed; the run says which.
 */
export async function expireAppeal(r: Run, deal: Deal, appealBy: string): Promise<void> {
  r.step = 'appeal';
  r.say(`waiting for the appeal window to close at ${appealBy}, then appeal-expiry frees the primary's bond`);
  await waitPast(r, deal.buyer, appealBy);
  let closedBy = 'the round, through the API';
  try {
    await trigger(r, deal, 'appeal-expiry');
    r.check('appeal-expiry relayed through the API', true, 'accepted');
  } catch (e) {
    const why = reason(e);
    if (/appeal state is expired|WrongAppealState\(4\)/.test(why)) {
      closedBy = 'someone else (the demo adjudicators expire their own appeals since T-211)';
    } else {
      r.check('appeal-expiry relayed through the API', false, why);
      if (!r.round.chain) throw e;
      // The escape hatch (ADR-0005): anyone may close the window directly, so the bond is still freed.
      const tx = await r.round.chain.trigger(r.round.key('buyer'), 'expireAppeal', deal.terms);
      deal.sent.push({ step: 'expireAppeal (direct)', tx });
      closedBy = `the round, directly from the buyer's key (${r.round.chain.link(tx.tx)}, ${tx.gasUsed} gas)`;
    }
  }
  // A direct call reaches the operators' view only with T-218.
  if (!closedBy.includes('directly') || r.round.t220) await untilAppeal(r, deal, ['expired'], 120_000);
  r.say(`the appeal window is closed; appeal-expiry sent by ${closedBy}`);
  deal.record.notes.push(`appeal-expiry sent by ${closedBy}`);
}

/** The chain checks every settled deal shares: dealOf's stage, CPP empty, the operator fee paid once, both views agree. */
export function settledChecks(r: Run, deal: Deal, stage: string): void {
  const rec = deal.record;
  r.check('both operators serve the same state and event log', rec.operators?.agree === true, rec.operators?.views.map((v) => `${v.origin}: ${v.escrowState}, ${v.events} events`).join('; ') ?? 'no view');
  if (!r.round.chain || !rec.chain) return;
  r.check(`dealOf reads ${stage}`, rec.chain.stage === stage, `${rec.chain.stage}, appeal ${rec.chain.appeal}`);
  cppCheck(r, deal);
  const to = lc(r.round.demo.feeSchedule?.to ?? '');
  const fees = logsOf(rec, 'Transfer').filter((l) => lc(l.args.from) === deal.buyer.address && lc(l.args.to) === to);
  if (deal.operatorFee !== undefined) {
    r.check('the operator fee is paid once', fees.length === 1 && BigInt(fees[0]!.args.amount) === deal.operatorFee, `${fees.length} transfer(s) from the buyer to the fee address ${short(to)}: ${fees.map((f) => r.round.amount(f.args.amount)).join(', ') || 'none'}`);
  }
}

/**
 * CPP holds nothing for the deal: the funding authorized the payment key recomputed here from the terms (so the read
 * below is this deal's, not an empty slot), and nothing is left to capture.
 */
export function cppCheck(r: Run, deal: Deal, label = ''): void {
  const { chain } = r.round;
  const rec = deal.record;
  if (!chain || !rec.chain) return;
  const key = lc(paymentHashOf(deal.terms, deal.id, chain.deployment));
  const authorized = logsOf(rec, 'PaymentAuthorized').some((l) => lc(l.args.paymentInfoHash) === key);
  r.check(`${label}CPP holds nothing for the deal`, authorized && rec.chain.payment.capturable === '0', `${authorized ? 'the funding authorized' : 'no PaymentAuthorized log names'} payment ${short(key)}; capturable ${r.round.amount(rec.chain.payment.capturable)}, refundable ${r.round.amount(rec.chain.payment.refundable)}`);
}

/** A token transfer of exactly `amount` to `to` among the deal's transactions: a payout read from the chain's own logs. */
export function paidCheck(r: Run, deal: Deal, name: string, to: string, amount: bigint): void {
  if (!r.round.chain) return;
  const hits = logsOf(deal.record, 'Transfer').filter((l) => lc(l.args.to) === lc(to) && BigInt(l.args.amount) === amount);
  r.check(name, hits.length === 1, `${hits.length} Transfer log(s) of ${r.round.amount(amount)} to ${short(to)}`);
}

/** The appeal-expiry transaction freed exactly the price from the primary's bond. */
export function bondFreedCheck(r: Run, deal: Deal): void {
  if (!r.round.chain) return;
  const primary = lc(deal.terms.adjudication.adjudicator);
  const freed = logsOf(deal.record, 'BondReleased').filter((l) => lc(l.args.adjudicator) === primary);
  const total = freed.reduce((s, l) => s + BigInt(l.args.amount), 0n);
  r.check("the primary's bond is freed after the appeal window", total === BigInt(deal.terms.price.amount), `BondReleased for ${short(primary)}: ${r.round.amount(total)} in ${freed.length} log(s)`);
}

/** An appeal through the API: the appellant's own approval for its bond on a chain, then prepare, verify, sign. */
export async function appeal(r: Run, deal: Deal, who: 'buyer' | 'seller'): Promise<J> {
  const { round } = r;
  const agent = who === 'buyer' ? deal.buyer : deal.seller;
  const { rulebook } = await agent.club(round.demo.clubId);
  const prepared = await agent.call('POST', '/v1/prepare/appeal', { commitmentId: deal.id, appellant: agent.address });
  return agent.signAndSubmit(prepared, { kind: 'appeal', terms: deal.terms, me: agent.address, appealBondRateBps: rulebook.appealBondRateBps });
}

/** The appeal bond the club's rulebook sets for the deal: its rate of the price, rounded up. */
export async function appealBond(r: Run, deal: Deal): Promise<bigint> {
  const { rulebook } = await deal.buyer.club(r.round.demo.clubId);
  return (BigInt(deal.terms.price.amount) * BigInt(rulebook.appealBondRateBps) + 9_999n) / 10_000n;
}

/** Polls every operator until each reports one of `states` as the appeal state; stops once the decision deadline passes. */
export async function untilAppeal(r: Run, deal: Deal, states: string[], timeoutMs: number): Promise<J> {
  let seen: J[] = [];
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(1000)) {
    seen = await Promise.all(deal.buyer.sources().map((api) => get(deal.buyer, `/v1/commitments/${deal.id}`, api)));
    if (seen.every((s) => states.includes(s.appealState))) return seen[0];
    const by = seen[0]?.deadlines?.appealDecideBy;
    if (by && (await retry(() => deal.buyer.settlementNow())) > Date.parse(by) + 30_000) throw new Error(`${short(deal.id)}: the appeal adjudicator did not decide by appealDecideBy ${by} (appeal ${seen.map((s) => s.appealState).join(' / ')})`);
  }
  throw new Error(`${short(deal.id)} appeal still ${seen.map((s) => s.appealState).join(' / ')} after ${timeoutMs / 1000} s, waiting for ${states.join(' or ')}`);
}

/** A scenario the driver does not build yet: recorded as waiting for its prerequisites, then for the driver's own work. */
export const waiting = (id: string, title: string, waitsFor: string[], needs: string): Scenario => ({
  id, title, waitsFor, needs,
  async run(r) {
    await requires(r, waitsFor);
    r.waitsFor = ['T-216'];
    throw new Waits(r.waitsFor, `not built in the driver yet: ${needs}`);
  },
});
