// Round 1's scripted-adjudicator group (T-216): the scenarios where the round's own primary decides the outcome the
// scenario gives it, a wrong one included (e2e-adjudicator.ts, `serve(r, { decide })`). e2e-scenarios.ts registers
// this list; its tests are in e2e-scenarios-scripted.test.ts.
//
// The primary is the round's `adjudicator-1`, registered through the API and, on a chain, bonded with the price from
// its own key. On SimChain no outsider can bond at run time, so the deals there are priced at zero: every step still
// runs, and the money checks hold at zero.
import { RoundAdjudicator } from './e2e-adjudicator.ts';
import { APPEAL_STATES } from './e2e-chain.ts';
import { buyerKeys, delta, deliver, ensureFunds, finish, fund, get, logsOf, openDeal, reason, short, shortWindows, sleep, trigger, until, waitPast, type Deal, type Run } from './e2e-run.ts';
import { APPELLANT_FLOAT, BAD_CSV, CHECKS, CSV, DATASET, PRICE, appeal, appealBond, bondFreedCheck, lc, requires, settledChecks, untilAppeal, type J, type Scenario } from './e2e-scenario-kit.ts';

/** The round's primary in both scenarios. */
const PRIMARY = 'adjudicator-1';
/** 3c's appeal adjudicator: registered, never bonded (nothing on chain pays from an appeal adjudicator, L-5), never served. */
const SILENT_APPEAL = 'adjudicator-2';
/** HoldbackTypes' role and outcome codes, as `decide`'s calldata and the Decided log carry them. */
const ROLE_PRIMARY = 0;
const ROLE_APPEAL = 2;
const OUTCOME = { accept: 0, reject: 1 } as const;
/** The beacon clocks of core's beacon.ts (ADR-0018): round 1 at genesis, then one round per period (seconds). */
const CLOCKS: Record<string, { genesis: number; period: number }> = { 'drand-quicknet': { genesis: 1692803367, period: 3 }, sim: { genesis: 1, period: 1 } };

/** The deals' price: 25 tUSDC on a chain; zero on SimChain, where the round's primary holds no bond. */
const priceOf = (r: Run) => (r.round.chain ? PRICE : '0');

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
 * decision on both operators. Before the deal's balances are read, the primary is registered and, on a chain, bonded
 * with the price, and the appellant holds enough for its appeal; on a chain the appellant approves its appeal bond from
 * its own Sepolia ETH before the delivery, so the filing fits the appeal window. `prefix` starts each check's name.
 */
async function scriptedDeal(r: Run, prefix: string, s: Shape): Promise<{ deal: Deal; bond: bigint; primary: RoundAdjudicator }> {
  const { round } = r;
  const price = priceOf(r);
  r.step = 'primary';
  const primary = await RoundAdjudicator.ready(r, PRIMARY, round.chain ? { bond: BigInt(price) } : {});
  await ensureFunds(r, s.appellant, APPELLANT_FLOAT);
  const serving = await primary.serve(r, { decide: s.decide });
  try {
    const deal = await openDeal(r, { label: s.label, template: 'checks-only', deliverable: DATASET, checks: CHECKS, price, timing: s.timing, adjudicators: { primary: primary.address, fallback: round.demo.adjudicators.fallback, appeal: s.appealAdjudicator } }, [round.address('buyer'), round.address('seller'), primary.address]);
    await fund(r, deal);
    const bond = await appealBond(r, deal);
    if (round.chain) {
      const tx = await round.chain.approveBonds(round.key(s.appellant), bond);
      deal.sent.push({ step: 'appeal bond approval', tx });
      r.say(`the ${s.appellant} approves HoldbackBonds for its ${round.amount(bond)} appeal bond from its own Sepolia ETH: ${round.chain.link(tx.tx)} (${tx.gasUsed} gas)`);
    }
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

/** On chain, the Decided log of the first decision names the round's primary and the scripted outcome. */
function firstDecisionCheck(r: Run, deal: Deal, prefix: string, primary: RoundAdjudicator, outcome: 'accept' | 'reject'): void {
  if (!r.round.chain) return;
  const first = logsOf(deal.record, 'Decided').filter((l) => Number(l.args.role) === ROLE_PRIMARY);
  r.check(`${prefix}the round's primary signs the first decision on chain`, first.length === 1 && lc(first[0]!.args.adjudicator) === lc(primary.address) && Number(first[0]!.args.outcome) === OUTCOME[outcome], first.map((l) => `Decided by ${short(l.args.adjudicator)}, outcome ${l.args.outcome}`).join('; ') || 'no Decided log for the primary');
}

/**
 * The appeal decision's seed is a beacon proof from the first round after the filing, which the contract requires (it
 * reverts otherwise). Read from the record: the round in `decide`'s calldata, against the round recomputed from the
 * filing block's time on the club's beacon clock.
 */
async function beaconCheck(r: Run, deal: Deal, prefix: string, source: string): Promise<void> {
  const chain = r.round.chain;
  if (!chain) return;
  const txs = deal.record.transactions;
  const decide = txs.flatMap((t) => t.calls).filter((c) => c.fn === 'decide' && Number(c.args?.[1]?.role) === ROLE_APPEAL).at(-1);
  const filed = txs.find((t) => t.calls.some((c) => c.fn === 'fileAppeal'));
  const clock = CLOCKS[source];
  let expected = 0;
  if (filed && clock) {
    const t = Number((await chain.client.getBlock({ blockNumber: BigInt(filed.block) })).timestamp);
    expected = (t < clock.genesis ? 0 : Math.floor((t - clock.genesis) / clock.period) + 1) + 1;
  }
  const round = Number(decide?.args?.[1]?.beaconRound ?? 0);
  r.check(`${prefix}the appeal decision carries a ${source.replace('-', ' ')} beacon proof from the round after the filing`, round > 0 && round === expected, `beacon round ${round || 'none'} in decide's calldata; the filing in block ${filed?.block ?? 'none found'} makes it ${expected || 'unknown'}`);
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
    if (/appeal state is expired|WrongAppealState\(4\)/.test(why)) {
      closedBy = 'someone else before the round';
    } else {
      r.check('appeal-expiry relayed through the API', false, why);
      if (!round.chain) throw e;
      // The escape hatch (ADR-0005): anyone may close it directly, so the bonds are still freed.
      const tx = await round.chain.trigger(round.key('seller'), 'expireAppeal', deal.terms);
      deal.sent.push({ step: 'expireAppeal (direct)', tx });
      closedBy = `the round, directly from the seller's key (${round.chain.link(tx.tx)}, ${tx.gasUsed} gas)`;
    }
  }
  // A direct call reaches the operators' view only with T-218.
  if (!closedBy.includes('directly') || round.t220) await untilAppealIs(deal, ['expired'], 120_000);
  r.say(`the appeal expired undecided; appeal-expiry sent by ${closedBy}`);
  deal.record.notes.push(`appeal-expiry sent by ${closedBy}`);
  await finish(r, deal);
  const rec = deal.record;
  const fee = BigInt(deal.terms.adjudication.fee.amount);
  r.check('the first decision stands: both operators show Refunded and the appeal expired', rec.operators?.views.every((v) => v.escrowState === 'Refunded' && v.appealState === 'expired') === true, rec.operators?.views.map((v) => `${v.escrowState}, appeal ${v.appealState}`).join(' / ') ?? 'no view');
  r.check('the appellant gets its appeal bond back', delta(rec, seller) === 0n, `seller ${round.amount(delta(rec, seller))}${round.chain ? '' : " (SimChain returns the rulebook's appeal fee too)"}`);
  r.check('the buyer gets the price back; the adjudication and operator fees are spent', delta(rec, buyer) === -(fee + (deal.operatorFee ?? 0n)), `buyer ${round.amount(delta(rec, buyer))}`);
  const keys = await buyerKeys(deal);
  r.check('no key reaches the buyer', keys.every((n) => n === 0), `the key read serves ${keys.join(' and ')} envelope(s) to the buyer`);
  r.check("the primary's bond is whole", delta(rec, primary.address, 'bond') === 0n, `${PRIMARY} ${short(primary.address)} bond ${round.amount(delta(rec, primary.address, 'bond'))}`);
  settledChecks(r, deal, 'Refunded');
  if (round.chain && rec.chain) {
    firstDecisionCheck(r, deal, '', primary, 'reject');
    r.check("dealOf's appeal reads expired", rec.chain.appeal === 'expired', rec.chain.appeal);
    const closed = logsOf(rec, 'AppealClosed');
    r.check('the appeal closes as expired on chain', closed.length === 1 && APPEAL_STATES[Number(closed[0]!.args.verdict)] === 'expired', closed.map((l) => `AppealClosed ${APPEAL_STATES[Number(l.args.verdict)]}`).join('; ') || 'no AppealClosed log');
    const paid = logsOf(rec, 'AppealBondPaid');
    r.check('the seller gets its appeal bond back on chain', paid.length === 1 && lc(paid[0]!.args.to) === seller && paid[0]!.args.toBond === false && BigInt(paid[0]!.args.amount) === bond, paid.map((p) => `${round.amount(p.args.amount)} to ${short(p.args.to)}${p.args.toBond ? ' (bond)' : ''}`).join('; ') || 'no AppealBondPaid log');
    r.check('no bond is slashed', logsOf(rec, 'BondSlashed').length === 0, `${logsOf(rec, 'BondSlashed').length} BondSlashed log(s)`);
    bondFreedCheck(r, deal);
  }
}

/**
 * 7: the round's bonded primary decides wrongly by script, both ways; the losing party appeals through the API; the
 * demo appeal adjudicator judges the work against the terms and overturns. The first decider's bond pays the appellant
 * the price (D43, BondSlashed), and the appellant's bond comes back. The escrow stays where the first decision put it.
 */
export async function overturnedBothWays(r: Run): Promise<void> {
  const { round } = r;
  const [buyer, seller] = [round.address('buyer'), round.address('seller')];
  const { rulebook } = await round.agent('master').club(round.demo.clubId);
  const source: string = rulebook.randomness?.source ?? 'sim';
  // SimChain charges the rulebook's appeal fee and pays it to the appeal adjudicator; the contract charges none (Phase 4).
  const appealFee = round.chain ? 0n : BigInt(rulebook.appealFee?.amount ?? '0');
  // The appeal windows are the parties' choice (D31): long enough for the filing, the beacon round and the decision's block.
  const timing = shortWindows(r, { appealWindowSec: Math.max(round.demo.minWindowSec, 180), appealDecideSec: Math.max(round.demo.minWindowSec, 120) });
  for (const shape of [
    { label: `the round's ${PRIMARY} accepts work that fails a required check; the buyer appeals`, work: BAD_CSV, decide: 'accept', first: 'Released', appellant: 'buyer' },
    { label: `the round's ${PRIMARY} rejects work that passes every check; the seller appeals`, work: CSV, decide: 'reject', first: 'Refunded', appellant: 'seller' },
  ] as const) {
    const tag = shape.appellant;
    const who = round.address(tag);
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
      const onChain = logsOf(rec, 'KeyReleased').filter((l) => lc(l.args.recipient) === buyer).length;
      r.check('seller: no key reaches the refunded buyer', keys.every((n) => n === 0) && onChain === 0, `the key read serves ${keys.join(' and ')} envelope(s) to the buyer${round.chain ? `; ${onChain} KeyReleased log(s) name it` : ''}`);
    }
    r.check(`${tag}: the primary's bond pays the price`, delta(rec, primary.address, 'bond') === -price, `${PRIMARY} ${short(primary.address)} bond ${round.amount(delta(rec, primary.address, 'bond'))}`);
    settledChecks(r, deal, shape.first);
    if (round.chain && rec.chain) {
      firstDecisionCheck(r, deal, `${tag}: `, primary, shape.decide);
      r.check(`${tag}: dealOf's appeal reads overturned`, rec.chain.appeal === 'overturned', rec.chain.appeal);
      const slashed = logsOf(rec, 'BondSlashed');
      r.check(`${tag}: BondSlashed pays the ${tag} the price from the primary's bond`, slashed.length === 1 && lc(slashed[0]!.args.adjudicator) === lc(primary.address) && lc(slashed[0]!.args.to) === who && BigInt(slashed[0]!.args.amount) === price, slashed.map((l) => `${round.amount(l.args.amount)} from ${short(l.args.adjudicator)} to ${short(l.args.to)}`).join('; ') || 'no BondSlashed log');
      const paid = logsOf(rec, 'AppealBondPaid');
      r.check(`${tag}: the ${tag}'s appeal bond comes back`, paid.length === 1 && lc(paid[0]!.args.to) === who && paid[0]!.args.toBond === false && BigInt(paid[0]!.args.amount) === bond, paid.map((p) => `${round.amount(p.args.amount)} to ${short(p.args.to)}${p.args.toBond ? ' (bond)' : ''}`).join('; ') || 'no AppealBondPaid log');
      await beaconCheck(r, deal, `${tag}: `, source);
      rec.notes.push('No appeal fee on chain: Phase 4 economics, recorded, not passed (T-216 non-goals).');
    }
  }
}

export const SCRIPTED: Scenario[] = [
  {
    id: '3c',
    title: 'Timeouts: appeal expiry when the appeal adjudicator is silent (API)',
    waitsFor: ['T-221'],
    async run(r) {
      await requires(r, ['T-221']);
      await appealExpiry(r);
    },
  },
  {
    id: '7',
    title: "Appeal overturned both ways, paid from the first decider's bond (API)",
    waitsFor: ['T-217', 'T-221'],
    async run(r) {
      await requires(r, ['T-217', 'T-221']);
      await overturnedBothWays(r);
    },
  },
];
