// SimChain only: the round's party-appeal group (T-216, T-374). The phase-one contracts take no party appeal and hold
// no bond (ADR-0031 §8, D57): a first decision by the primary or the fallback is final when written, and the
// operators refuse an appeal and its expiry on a chain. SimChain keeps the full protocol on purpose, so this file keeps
// the round's appeal scenarios and helpers for it, and no other e2e file names a party appeal:
//
// - 3c and 7, the scripted-adjudicator scenarios: the round's own primary decides the outcome the scenario gives it, a
//   wrong one included (e2e-adjudicator.ts, `serve(r, { decide })`). The primary is the round's `adjudicator-1`,
//   registered through the API. On SimChain no outsider can bond at run time, so these deals are priced at zero:
//   every step still runs, and the money checks hold at zero.
// - 6, an appeal upheld, with the demo world's own adjudicators.
// - The helpers: `appeal` and its bond, the appeal-state poll, and `closeOnSimChain`, which closes a decided deal's
//   appeal window on SimChain and does nothing on a chain.
//
// Each scenario stops before its first deal on a chain (simChainOnly), and the run records it as waiting on ADR-0031.
// e2e-scenarios.ts registers APPEAL; the tests are in e2e-scenarios-appeal.test.ts.
import { RoundAdjudicator } from './e2e-adjudicator.ts';
import { buyerKeys, delta, deliver, ensureFunds, finish, fund, get, openDeal, reason, retry, short, shortWindows, sleep, trigger, until, waitPast, Waits, type Deal, type Run } from './e2e-run.ts';
import { BAD_CSV, CHECKS, CSV, DATASET, PRICE, requires, settledChecks, type J, type Scenario } from './e2e-scenario-kit.ts';

/** What an appellant holds before its deal: the price, both fees and the bond, with room (base units). */
export const APPELLANT_FLOAT = 100_000_000n;

/**
 * Stops a scenario with a party appeal before its first deal when the round runs on a chain: the phase-one contracts
 * take no party appeal and hold no bond (ADR-0031 §8), so it runs on SimChain only. The run records it as waiting on
 * ADR-0031, with the reason.
 */
export function simChainOnly(r: Run, what: string): void {
  if (!r.round.chain) return;
  r.waitsFor = ['ADR-0031'];
  throw new Waits(r.waitsFor, `not in phase one (ADR-0031): ${what}; the phase-one contracts take no party appeal, so this scenario runs on SimChain only`);
}

/**
 * An appeal through the API: prepare, verify, sign. On a chain the operators refuse it with invalid_state, in every
 * state (ADR-0031 §8); 5b checks that refusal after the appeal adjudicator's decision.
 */
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

/**
 * Closes a decided deal's appeal window before its evidence is read, so the primary's bond is freed. On a chain it does
 * nothing: the phase-one contracts write a decision as final, and the operators refuse an appeal-expiry trigger
 * (ADR-0031 §8). On SimChain, when `done` (the deal's view after its decision) names an appeal window, it waits for the
 * window to close and sends `appeal-expiry`, then waits for both operators to show the appeal expired. Since T-211 the
 * demo's adjudicators expire their own decisions' appeals, so the window may already be closed; the run says which.
 */
export async function closeOnSimChain(r: Run, deal: Deal, done: J): Promise<void> {
  const appealBy: string | undefined = done?.deadlines?.appealBy;
  if (r.round.chain || !appealBy) return;
  r.step = 'appeal';
  r.say(`waiting for the appeal window to close at ${appealBy}, then appeal-expiry frees the primary's bond`);
  await waitPast(r, deal.buyer, appealBy);
  let closedBy = 'the round, through the API';
  try {
    await trigger(r, deal, 'appeal-expiry');
    r.check('appeal-expiry relayed through the API', true, 'accepted');
  } catch (e) {
    const why = reason(e);
    if (!/appeal state is expired/.test(why)) {
      r.check('appeal-expiry relayed through the API', false, why);
      throw e;
    }
    closedBy = 'someone else (the demo adjudicators expire their own appeals since T-211)';
  }
  await untilAppeal(r, deal, ['expired'], 120_000);
  r.say(`the appeal window is closed; appeal-expiry sent by ${closedBy}`);
  deal.record.notes.push(`appeal-expiry sent by ${closedBy}`);
}

/** The round's primary in 3c and 7. */
const PRIMARY = 'adjudicator-1';
/** 3c's appeal adjudicator: registered, never bonded (nothing on chain pays from an appeal adjudicator, L-5), never served. */
const SILENT_APPEAL = 'adjudicator-2';
/** 3c's and 7's price: zero on SimChain, where the round's primary holds no bond. */
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

/**
 * 6: the demo primary decides correctly, both ways; the favoured party's appeal is refused, the losing party appeals,
 * and the demo appeal adjudicator upholds. The appellant loses its bond and the first outcome stands.
 */
export async function appealUpheld(r: Run): Promise<void> {
  const { round } = r;
  const [buyer, seller] = [round.address('buyer'), round.address('seller')];
  const primary = round.demo.adjudicators.primary;
  // The appeal windows are the parties' choice (D31): long enough for the appellant's filing, and for the appeal
  // adjudicator's beacon round and its decision's block.
  const windows = shortWindows(r, { appealWindowSec: Math.max(round.demo.minWindowSec, 180), appealDecideSec: Math.max(round.demo.minWindowSec, 120) });
  for (const shape of [
    { label: 'the seller appeals a correct reject', work: BAD_CSV, outcome: 'Refunded', appellant: 'seller', favoured: 'buyer' },
    { label: 'the buyer appeals a correct accept', work: CSV, outcome: 'Released', appellant: 'buyer', favoured: 'seller' },
  ] as const) {
    // The appellant holds enough for the deal and its bond before the deal's starting balances are read.
    await ensureFunds(r, shape.appellant, APPELLANT_FLOAT);
    const deal = await openDeal(r, { label: shape.label, template: 'checks-only', deliverable: DATASET, checks: CHECKS, price: PRICE, timing: windows }, [buyer, seller, primary]);
    await fund(r, deal);
    const bond = await appealBond(r, deal);
    await deliver(r, deal, shape.work);
    r.step = 'outcome';
    const done = await until(r, deal.buyer, deal.id, ['Released', 'Refunded', 'Escalated'], 300_000);
    r.check(`${shape.appellant}: the first decision is ${shape.outcome}`, done.escrowState === shape.outcome, done.escrowState);
    r.step = 'appeal';
    const refused = await appeal(r, deal, shape.favoured).then(() => 'accepted', (e: Error) => reason(e));
    r.check(`${shape.appellant}: the favoured party's appeal is refused`, /invalid_terms/.test(refused), refused);
    await appeal(r, deal, shape.appellant);
    r.say(`${shape.appellant} filed an appeal with a ${round.amount(bond)} bond`);
    const decided = await untilAppeal(r, deal, ['upheld', 'overturned'], 600_000);
    await finish(r, deal);
    r.check(`${shape.appellant}: the appeal is upheld and the first outcome stands`, decided.appealState === 'upheld' && decided.escrowState === shape.outcome, `${decided.escrowState}, appeal ${decided.appealState}`);
    // The seller appeals a refund it was not paid for; the buyer appeals a release it paid price and fees for. An
    // upheld appellant loses its bond, and the rulebook's appeal fee (SimChain charges it).
    const appealFee = BigInt((await deal.buyer.club(round.demo.clubId)).rulebook.appealFee?.amount ?? '0');
    const paidByBuyer = BigInt(PRICE) + BigInt(deal.terms.adjudication.fee.amount) + (deal.operatorFee ?? 0n);
    const expected = -(bond + appealFee + (shape.appellant === 'seller' ? 0n : paidByBuyer));
    r.check(`${shape.appellant}: the appellant loses its bond`, delta(deal.record, round.address(shape.appellant)) === expected, `${shape.appellant} ${round.amount(delta(deal.record, round.address(shape.appellant)))}, expected ${round.amount(expected)}`);
    r.check(`${shape.appellant}: both operators agree`, deal.record.operators?.agree === true, deal.record.operators?.views.map((v) => `${v.escrowState} ${v.appealState}`).join(' / ') ?? '');
  }
}

export const APPEAL: Scenario[] = [
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
    id: '6',
    title: 'Appeal upheld (API)',
    waitsFor: ['T-217'],
    async run(r) {
      simChainOnly(r, 'a party appeal');
      await requires(r, ['T-217']);
      await appealUpheld(r);
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
