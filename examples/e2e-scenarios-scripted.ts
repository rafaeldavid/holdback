// Round 1's scripted-adjudicator group (T-216): the scenarios where the round's own primary decides the outcome the
// scenario gives it, a wrong one included (e2e-adjudicator.ts, `serve(r, { decide })`). e2e-scenarios.ts registers
// this list; its tests are in e2e-scenarios-scripted.test.ts.
//
// Both scenarios file a party appeal, which the phase-one contracts do not take (ADR-0031 §8): they run on SimChain
// only (simChainOnly), and a chain round records them as waiting on ADR-0031. The primary is the round's
// `adjudicator-1`, registered through the API. On SimChain no outsider can bond at run time, so the deals are priced at
// zero: every step still runs, and the money checks hold at zero.
import { RoundAdjudicator } from './e2e-adjudicator.ts';
import { buyerKeys, delta, deliver, ensureFunds, finish, fund, get, openDeal, reason, short, shortWindows, sleep, trigger, until, waitPast, type Deal, type Run } from './e2e-run.ts';
import { APPELLANT_FLOAT, BAD_CSV, CHECKS, CSV, DATASET, appeal, appealBond, requires, settledChecks, simChainOnly, untilAppeal, type J, type Scenario } from './e2e-scenario-kit.ts';

/** The round's primary in both scenarios. */
const PRIMARY = 'adjudicator-1';
/** 3c's appeal adjudicator: registered, never bonded (nothing on chain pays from an appeal adjudicator, L-5), never served. */
const SILENT_APPEAL = 'adjudicator-2';
/** The deals' price: zero on SimChain, where the round's primary holds no bond. */
const PRICE_ZERO = '0';

interface Shape {
  label: string;
  work: string;
  decide: 'accept' | 'reject';
  appellant: 'buyer' | 'seller';
  appealAdjudicator: string;
  timing: Record<string, number>;
}

/**
 * A checks-only deal whose primary is the round's own, deciding `decide` by script whatever the work, up to the first
 * decision on both operators. Before the deal's balances are read, the primary is registered, and the appellant holds
 * enough for its appeal. `prefix` starts each check's name.
 */
async function scriptedDeal(r: Run, prefix: string, s: Shape): Promise<{ deal: Deal; bond: bigint; primary: RoundAdjudicator }> {
  const { round } = r;
  const price = PRICE_ZERO;
  r.step = 'primary';
  const primary = await RoundAdjudicator.ready(r, PRIMARY);
  await ensureFunds(r, s.appellant, APPELLANT_FLOAT);
  const serving = await primary.serve(r, { decide: s.decide });
  try {
    const deal = await openDeal(r, { label: s.label, template: 'checks-only', deliverable: DATASET, checks: CHECKS, price, timing: s.timing, adjudicators: { primary: primary.address, fallback: round.demo.adjudicators.fallback, appeal: s.appealAdjudicator } }, [round.address('buyer'), round.address('seller'), primary.address]);
    await fund(r, deal);
    const bond = await appealBond(r, deal);
    await deliver(r, deal, s.work);
    r.step = 'decision';
    const first = await until(r, deal.buyer, deal.id, ['Released', 'Refunded'], 300_000);
    const expected = s.decide === 'accept' ? 'Released' : 'Refunded';
    const decided = serving.acted.some((a) => a.id === deal.id && a.did === 'decided' && a.outcome === s.decide);
    r.check(`${prefix}the round's primary decides ${s.decide} by script, and the deal is ${expected}`, decided && first.escrowState === expected, `${PRIMARY} ${short(primary.address)} ${decided ? `decided ${s.decide}` : 'made no decision'}; both operators show ${first.escrowState}`);
    return { deal, bond, primary };
  } finally {
    await serving.stop();
    for (const e of serving.errors) r.note(`the round's ${PRIMARY} retried a step after: ${e}`);
  }
}

/** Polls both operators until each shows one of `states` as the appeal state. Unlike the kit's untilAppeal it has no deadline guard: 3c waits past appealDecideBy on purpose. */
async function untilAppealIs(deal: Deal, states: string[], timeoutMs: number): Promise<J> {
  let seen: J[] = [];
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(1000)) {
    seen = await Promise.all(deal.buyer.sources().map((api) => get(deal.buyer, `/v1/commitments/${deal.id}`, api)));
    if (seen.every((s) => states.includes(s.appealState))) return seen[0];
  }
  throw new Error(`${short(deal.id)} appeal still ${seen.map((s) => s.appealState).join(' / ')} after ${timeoutMs / 1000} s, waiting for ${states.join(' or ')}`);
}

/**
 * 3c: the round's primary rejects work that fails a required check (a correct reject, by script); the seller appeals,
 * and the round's own appeal adjudicator stays silent. After appealDecideBy the round sends `appeal-expiry` through the
 * API: the refund stands, the seller's appeal bond comes back, and the primary's bond is freed.
 */
export async function appealExpiry(r: Run): Promise<void> {
  const { round } = r;
  const [buyer, seller] = [round.address('buyer'), round.address('seller')];
  const silent = await RoundAdjudicator.ready(r, SILENT_APPEAL);
  const m = round.demo.minWindowSec;
  // The appeal window leaves room for the seller's filing after the decision lands (a relayed transaction, a block or
  // two on Sepolia). The round then waits out both windows, so they stay as short as that allows.
  const timing = shortWindows(r, { appealWindowSec: Math.max(2 * m, 30), appealDecideSec: m });
  const { deal, bond, primary } = await scriptedDeal(r, '', { label: `a reject by the round's ${PRIMARY}; the seller appeals to the round's silent ${SILENT_APPEAL}`, work: BAD_CSV, decide: 'reject', appellant: 'seller', appealAdjudicator: silent.address, timing });
  r.step = 'appeal';
  await appeal(r, deal, 'seller');
  const open = await untilAppealIs(deal, ['open'], 120_000);
  const by: string | undefined = open.deadlines?.appealDecideBy;
  if (!by) throw new Error(`${short(deal.id)}: the open appeal's view serves no deadlines.appealDecideBy`);
  r.say(`the seller filed an appeal with a ${round.amount(bond)} bond; the round's ${SILENT_APPEAL} ${short(silent.address)} stays silent; waiting for appealDecideBy ${by}`);
  r.step = 'expire';
  await waitPast(r, deal.buyer, by);
  let closedBy = 'the round, through the API';
  try {
    await trigger(r, deal, 'appeal-expiry');
    r.check('appeal-expiry relayed through the API', true, `accepted after appealDecideBy ${by}`);
  } catch (e) {
    const why = reason(e);
    if (!/appeal state is expired/.test(why)) {
      r.check('appeal-expiry relayed through the API', false, why);
      throw e;
    }
    closedBy = 'someone else before the round';
  }
  await untilAppealIs(deal, ['expired'], 120_000);
  r.say(`the appeal expired undecided; appeal-expiry sent by ${closedBy}`);
  deal.record.notes.push(`appeal-expiry sent by ${closedBy}`);
  await finish(r, deal);
  const rec = deal.record;
  const fee = BigInt(deal.terms.adjudication.fee.amount);
  r.check('the first decision stands: both operators show Refunded and the appeal expired', rec.operators?.views.every((v) => v.escrowState === 'Refunded' && v.appealState === 'expired') === true, rec.operators?.views.map((v) => `${v.escrowState}, appeal ${v.appealState}`).join(' / ') ?? 'no view');
  r.check('the appellant gets its appeal bond back', delta(rec, seller) === 0n, `seller ${round.amount(delta(rec, seller))} (SimChain returns the rulebook's appeal fee too)`);
  r.check('the buyer gets the price back; the adjudication and operator fees are spent', delta(rec, buyer) === -(fee + (deal.operatorFee ?? 0n)), `buyer ${round.amount(delta(rec, buyer))}`);
  const keys = await buyerKeys(deal);
  r.check('no key reaches the buyer', keys.every((n) => n === 0), `the key read serves ${keys.join(' and ')} envelope(s) to the buyer`);
  r.check("the primary's bond is whole", delta(rec, primary.address, 'bond') === 0n, `${PRIMARY} ${short(primary.address)} bond ${round.amount(delta(rec, primary.address, 'bond'))}`);
  settledChecks(r, deal, 'Refunded');
}

/**
 * 7: the round's primary decides wrongly by script, both ways; the losing party appeals through the API; the demo
 * appeal adjudicator judges the work against the terms and overturns. The first decider's bond pays the appellant the
 * price (D43), and the appellant's bond comes back. The escrow stays where the first decision put it.
 */
export async function overturnedBothWays(r: Run): Promise<void> {
  const { round } = r;
  const [buyer, seller] = [round.address('buyer'), round.address('seller')];
  const { rulebook } = await round.agent('master').club(round.demo.clubId);
  // SimChain charges the rulebook's appeal fee and pays it to the appeal adjudicator.
  const appealFee = BigInt(rulebook.appealFee?.amount ?? '0');
  // The appeal windows are the parties' choice (D31): long enough for the filing, the beacon round and the decision's block.
  const timing = shortWindows(r, { appealWindowSec: Math.max(round.demo.minWindowSec, 180), appealDecideSec: Math.max(round.demo.minWindowSec, 120) });
  for (const shape of [
    { label: `the round's ${PRIMARY} accepts work that fails a required check; the buyer appeals`, work: BAD_CSV, decide: 'accept', first: 'Released', appellant: 'buyer' },
    { label: `the round's ${PRIMARY} rejects work that passes every check; the seller appeals`, work: CSV, decide: 'reject', first: 'Refunded', appellant: 'seller' },
  ] as const) {
    const tag = shape.appellant;
    const { deal, bond, primary } = await scriptedDeal(r, `${tag}: `, { ...shape, appealAdjudicator: round.demo.adjudicators.appeal, timing });
    r.step = 'appeal';
    await appeal(r, deal, tag);
    r.say(`the ${tag} filed an appeal with a ${round.amount(bond)} bond to the demo appeal adjudicator ${short(round.demo.adjudicators.appeal)}`);
    const decided = await untilAppeal(r, deal, ['upheld', 'overturned'], 600_000);
    await finish(r, deal);
    const rec = deal.record;
    const price = BigInt(deal.terms.price.amount);
    const fees = BigInt(deal.terms.adjudication.fee.amount) + (deal.operatorFee ?? 0n);
    r.check(`${tag}: the demo appeal adjudicator overturns, and the deal stays ${shape.first}`, decided.appealState === 'overturned' && decided.escrowState === shape.first, `${decided.escrowState}, appeal ${decided.appealState}`);
    if (tag === 'buyer') {
      r.check('buyer: the buyer is paid the price from the bond; the fees stay spent', delta(rec, buyer) === -(fees + appealFee), `buyer ${round.amount(delta(rec, buyer))}${appealFee ? `, the appeal fee of ${round.amount(appealFee)} included` : ''}`);
      r.check('buyer: the seller keeps the price it was paid', delta(rec, seller) === price, `seller ${round.amount(delta(rec, seller))}`);
    } else {
      r.check('seller: the seller is paid the price from the bond', delta(rec, seller) === price - appealFee, `seller ${round.amount(delta(rec, seller))}${appealFee ? `, the appeal fee of ${round.amount(appealFee)} included` : ''}`);
      r.check('seller: the buyer gets the price back; the adjudication and operator fees are spent', delta(rec, buyer) === -fees, `buyer ${round.amount(delta(rec, buyer))}`);
      const keys = await buyerKeys(deal);
      r.check('seller: no key reaches the refunded buyer', keys.every((n) => n === 0), `the key read serves ${keys.join(' and ')} envelope(s) to the buyer`);
    }
    r.check(`${tag}: the primary's bond pays the price`, delta(rec, primary.address, 'bond') === -price, `${PRIMARY} ${short(primary.address)} bond ${round.amount(delta(rec, primary.address, 'bond'))}`);
    settledChecks(r, deal, shape.first);
  }
}

export const SCRIPTED: Scenario[] = [
  {
    id: '3c',
    title: 'Timeouts: appeal expiry when the appeal adjudicator is silent (API)',
    waitsFor: ['T-221'],
    async run(r) {
      simChainOnly(r, 'a party appeal and its expiry');
      await requires(r, ['T-221']);
      await appealExpiry(r);
    },
  },
  {
    id: '7',
    title: "Appeal overturned both ways, paid from the first decider's bond (API)",
    waitsFor: ['T-217', 'T-221'],
    async run(r) {
      simChainOnly(r, 'a party appeal, overturned');
      await requires(r, ['T-217', 'T-221']);
      await overturnedBothWays(r);
    },
  },
];
