// Round 1's silent-adjudicator group (T-216): the scenarios where the round's own adjudicator accepts a deal and then
// never decides (e2e-adjudicator.ts, `serve(r, 'silent')`), so a timeout, the fallback, an early accept or a mutual
// settlement can land first. e2e-scenarios.ts registers this list; its tests are in e2e-scenarios-silent.test.ts.
//
// The round's adjudicator bonds from its own key on a chain (Sepolia, anvil in the tests). On SimChain no outsider can
// bond at run time, so there its deals are priced at 0, which needs no bond: the flow runs, and the money checks hold
// trivially. The money is checked on a chain.
import { RoundAdjudicator, type AdjudicatorRole, type Serving } from './e2e-adjudicator.ts';
import { buyerKeys, buyerOpens, deliver, delta, eventsOf, finish, fund, get, logsOf, openDeal, reason, short, shortWindows, trigger, until, waitPast, type Deal, type Run } from './e2e-run.ts';
import { CHECKS, CSV, DATASET, PRICE, expireAppeal, lastBlock, lc, paidCheck, requires, settledChecks, type J, type Scenario } from './e2e-scenario-kit.ts';
import { deliveryHashOf, freshNonce } from './verify.ts';

/** A beacon's clock (ADR-0018): round 1 at genesis, then one round per period. */
type Clock = { genesis: number; period: number };
/** drand quicknet, chain hash 52db9ba7…c84e971 (https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/info). */
const QUICKNET: Clock = { genesis: 1692803367, period: 3 };
/** SimChain's beacon: round t at unix second t. */
const SIM: Clock = { genesis: 1, period: 1 };
/** The latest round published at or before `iso`, as core's beaconRoundAt and the contract's BEACON.roundAt count it. */
const roundAt = (c: Clock, iso: string): number => {
  const t = Math.floor(Date.parse(iso) / 1000);
  return t < c.genesis ? 0 : Math.floor((t - c.genesis) / c.period) + 1;
};

/** The deal's price: the round's adjudicator bonds for it on a chain; on SimChain it cannot, so the deal is priced at 0. */
function priceFor(r: Run): string {
  if (r.round.chain) return PRICE;
  r.note("SimChain: the round's own adjudicator cannot bond at run time, so this deal is priced at 0; the money checks run on a chain");
  return '0';
}

/** The round's adjudicator under `role`, registered through the API and, on a chain, holding free bond for the price. */
const adjudicator = (r: Run, role: AdjudicatorRole, price: string): Promise<RoundAdjudicator> => RoundAdjudicator.ready(r, role, r.round.chain ? { bond: BigInt(price) } : {});

/**
 * Windows short enough that a timeout comes within minutes, with room first for the round's primary to accept (it
 * reads every 3 s), the funding and the delivery: deliverBy 4 windows after the offer, then judgeBy one window later.
 */
function timeoutWindows(r: Run, extra: Record<string, number> = {}): Record<string, number> {
  const m = r.round.demo.minWindowSec;
  return shortWindows(r, { offerExpiresInSec: Math.max(2 * m, 20), fundWithinSec: Math.max(3 * m, 30), deliverWithinSec: Math.max(4 * m, 40), ...extra });
}

/** Runs `f` with the round's silent primary serving, and stops serving whatever happens. */
async function withSilent<T>(r: Run, primary: RoundAdjudicator, f: (serving: Serving) => Promise<T>): Promise<T> {
  const serving = await primary.serve(r, 'silent');
  try {
    return await f(serving);
  } finally {
    await serving.stop();
  }
}

/** The silent primary accepted the deal and never decided it; the detail lists any error its passes retried. */
function silentCheck(r: Run, deal: Deal, serving: Serving): void {
  const mine = serving.acted.filter((a) => a.id === deal.id);
  r.check("the round's primary accepts and never decides", mine.length === 1 && mine[0]!.did === 'accepted', `${mine.map((a) => a.did).join(', ') || 'nothing'}${serving.errors.length ? `; errors: ${serving.errors.join(' | ')}` : ''}`);
}

/** The deal's state from each operator. */
const views = (deal: Deal): Promise<J[]> => Promise.all(deal.buyer.sources().map((api) => get(deal.buyer, `/v1/commitments/${deal.id}`, api)));

/** Each operator's events of one type for the deal. */
const eventsOfType = (deal: Deal, type: string): Promise<J[][]> => Promise.all(deal.buyer.sources().map(async (api) => (await eventsOf(deal.buyer, deal.id, api)).filter((e) => e.type === type)));

/** The BondReleased total for `adjudicator` among the deal's transactions. */
const released = (deal: Deal, adjudicator: string): bigint => logsOf(deal.record, 'BondReleased').filter((l) => lc(l.args.adjudicator) === lc(adjudicator)).reduce((s, l) => s + BigInt(l.args.amount), 0n);

/** The KeyReleased logs that name the buyer. */
const keysToBuyer = (deal: Deal) => logsOf(deal.record, 'KeyReleased').filter((l) => lc(l.args.recipient) === deal.buyer.address);

/** The HoldbackRules calls of one function among the deal's transactions. */
const callsOf = (deal: Deal, fn: string) => deal.record.transactions.flatMap((t) => t.calls).filter((c) => c.fn === fn);

/**
 * A timeout trigger through the API, as any party may send it, recorded as a check. When another sender got there
 * first (the deal has left every state in `from`), it says so. When the operator fails it, the round sends the call
 * directly from the buyer's key instead (the escape hatch, ADR-0005), so the deal still ends: anvil 1.0.0 refuses to
 * estimate a call whose EIP-7623 calldata floor exceeds its execution gas, a cheap trigger among them (backlog).
 * Returns who sent it.
 */
async function sendTrigger(r: Run, deal: Deal, kind: 'fallback' | 'default', fn: 'triggerFallback' | 'triggerDefault', from: string[]): Promise<string> {
  try {
    await trigger(r, deal, kind);
    r.check(`${kind} relayed through the API`, true, 'accepted');
    return 'the round, through the API';
  } catch (e) {
    const why = reason(e);
    const now = (await views(deal)).map((v) => v.escrowState);
    if (!now.some((s) => from.includes(s))) return `someone else (the round's own ${kind} was refused: ${why})`;
    r.check(`${kind} relayed through the API`, false, why);
    if (!r.round.chain) throw e;
    const tx = await r.round.chain.trigger(r.round.key('buyer'), fn, deal.terms);
    deal.sent.push({ step: `${fn} (direct)`, tx });
    r.say(`${fn} sent directly by the buyer: ${r.round.chain.link(tx.tx)} (${tx.gasUsed} gas)`);
    return `the round, directly from the buyer's key (${r.round.chain.link(tx.tx)}, ${tx.gasUsed} gas)`;
  }
}

/**
 * At judgeBy, the fallback takeover (`triggerFallback` on chain), unless someone else already sent it: the demo world
 * sends it only when one of its own adjudicators is the fallback.
 */
async function takeOver(r: Run, deal: Deal): Promise<string> {
  r.step = 'fallback';
  r.say(`the primary stays silent; waiting for judgeBy ${deal.terms.timing.judgeBy}`);
  await waitPast(r, deal.buyer, deal.terms.timing.judgeBy);
  const before = (await views(deal)).map((v) => v.escrowState);
  if (!before.includes('Delivered')) return `nobody: the deal was already ${before.join(' / ')}`;
  return sendTrigger(r, deal, 'fallback', 'triggerFallback', ['Delivered']);
}

/**
 * After fallbackBy, the default outcome. On SimChain `default` moves the deal to Defaulted and `apply-default` refunds
 * it; on chain `triggerDefault` does both in one transaction, so `apply-default` has nothing to send. Returns how it
 * went.
 */
async function applyDefault(r: Run, deal: Deal): Promise<string> {
  r.step = 'default';
  r.say(`the fallback stays silent too; waiting for fallbackBy ${deal.terms.timing.fallbackBy}`);
  await waitPast(r, deal.buyer, deal.terms.timing.fallbackBy);
  const by = await sendTrigger(r, deal, 'default', 'triggerDefault', ['FallbackJudging']);
  const after = await until(r, deal.buyer, deal.id, ['Defaulted', 'Refunded'], 120_000);
  if (after.escrowState === 'Defaulted') {
    await trigger(r, deal, 'apply-default');
    await until(r, deal.buyer, deal.id, ['Refunded'], 120_000);
    return `\`default\`, sent by ${by}, moved the deal to Defaulted; then \`apply-default\` refunded it`;
  }
  return `\`default\`, sent by ${by}, refunded the deal at once (on chain, triggerDefault applies the default outcome in the same transaction), so \`apply-default\` had nothing to send`;
}

/**
 * The deal names the delivery both operators posted, as the signed one hashes (D44, ADR-0029); on chain, `fn`'s
 * calldata and deliveryHashOf too. Run it after `finish`, which reads the deal's transactions back from the chain.
 */
async function namesPosted(r: Run, deal: Deal, what: string, fn: string): Promise<void> {
  const signed = deliveryHashOf(deal.delivery);
  const posted = (await eventsOfType(deal, 'delivery.submitted')).map((es) => lc(es.at(-1)?.payload?.deliveryHash ?? 'none'));
  const served = (await views(deal)).map((v) => lc(v.deliveryHash ?? 'none'));
  const same = [...posted, ...served].every((h) => h === lc(signed));
  if (r.round.chain) {
    const named = lc(callsOf(deal, fn).at(-1)?.args?.[1]?.deliveryHash ?? 'none');
    const onChain = lc(await r.round.chain.deliveryHashOf(deal.id, lastBlock(deal)));
    r.check(`${what} names the posted delivery (D44)`, same && named === onChain && onChain === lc(signed), `${fn} names ${short(named)}; deliveryHashOf ${short(onChain)}; both operators' delivery.submitted ${posted.map(short).join(', ')}; the signed delivery ${short(signed)}`);
  } else {
    r.check(`${what} names the posted delivery (D44)`, same, `both operators' delivery.submitted ${posted.map(short).join(', ')} and the deliveryHash they serve after it ${served.map(short).join(', ')} equal the signed delivery ${short(signed)}`);
  }
}

/** The buyer's released key: served by both operators, on chain in a KeyReleased log, and it opens the work. */
async function keyChecks(r: Run, deal: Deal, work: string): Promise<void> {
  const served = await buyerKeys(deal);
  r.check('both operators serve the buyer its released key', served.every((n) => n === 1), `${served.join(' and ')} envelope(s)`);
  r.check('the buyer opens the work with its released key', await buyerOpens(r, deal, work), 'decrypted, sha256 checked against the delivery');
}

export const SILENT: Scenario[] = [
  {
    id: '3b',
    title: 'Timeouts: the default outcome when primary and fallback are silent (API)',
    waitsFor: ['T-221'],
    async run(r) {
      await requires(r, ['T-221']);
      const { round } = r;
      const [buyer, seller] = [round.address('buyer'), round.address('seller')];
      const price = priceFor(r);
      const primary = await adjudicator(r, 'adjudicator-1', price);
      // The fallback reserves its bond only by deciding, but a relay refuses terms whose fallback shows less free bond
      // than the price (T-221). It never serves: no takeover, no decision.
      const fallback = await adjudicator(r, 'adjudicator-2', price);
      let deal!: Deal;
      let takenBy = '';
      let defaulted = '';
      await withSilent(r, primary, async (serving) => {
        deal = await openDeal(r, { label: "the round's silent primary and silent fallback", template: 'checks-only', deliverable: DATASET, checks: CHECKS, price, timing: timeoutWindows(r), adjudicators: { primary: primary.address, fallback: fallback.address, appeal: round.demo.adjudicators.appeal } }, [buyer, seller, primary.address, fallback.address]);
        await fund(r, deal);
        await deliver(r, deal, CSV);
        takenBy = await takeOver(r, deal);
        const judging = await until(r, deal.buyer, deal.id, ['FallbackJudging'], 120_000);
        r.check('the fallback trigger moves the deal to FallbackJudging', judging.escrowState === 'FallbackJudging', `sent by ${takenBy}`);
        defaulted = await applyDefault(r, deal);
        silentCheck(r, deal, serving);
      });
      r.say(defaulted);
      deal.record.notes.push(`fallback takeover sent by ${takenBy}; ${defaulted}`);
      const [triggered, dflt] = await Promise.all([eventsOfType(deal, 'fallback.triggered'), eventsOfType(deal, 'default.triggered')]);
      await finish(r, deal);
      const states = deal.record.operators?.views.map((v) => v.escrowState) ?? [];
      r.check('the deal ends Refunded by the default outcome', states.length > 0 && states.every((s) => s === 'Refunded') && dflt.every((es) => es.length === 1) && triggered.every((es) => es.length === 1), `${states.join(' / ')}; fallback.triggered ${triggered.map((es) => es.length).join(' and ')}, default.triggered ${dflt.map((es) => es.length).join(' and ')} event(s)`);
      r.check('the buyer gets the price and the adjudication fee back', delta(deal.record, buyer) === -(deal.operatorFee ?? 0n), `buyer ${round.amount(delta(deal.record, buyer))} (the operator fee is never refunded)`);
      const keys = await buyerKeys(deal);
      r.check('no key reaches the buyer', keys.every((n) => n === 0), `the key read serves ${keys.join(' and ')} envelope(s) to the buyer`);
      settledChecks(r, deal, 'Refunded');
      if (round.chain) {
        // Compensation from bonds is Phase 4 on the contract (LOCAL_EXCLUSIONS): the default pays the seller nothing.
        r.check('the seller is paid nothing (compensation from bonds is Phase 4 on the contract)', delta(deal.record, seller) === 0n, `seller ${round.amount(delta(deal.record, seller))}`);
        paidCheck(r, deal, 'the price and the adjudication fee return to the buyer on chain', buyer, BigInt(price) + BigInt(deal.terms.adjudication.fee.amount));
        const dTx = logsOf(deal.record, 'Defaulted');
        const refunded = logsOf(deal.record, 'Refunded');
        r.check('triggerDefault defaults and refunds in one transaction', dTx.length === 1 && refunded.length === 1 && dTx[0]!.tx === refunded[0]!.tx && callsOf(deal, 'triggerDefault').length === 1, `${dTx.length} Defaulted and ${refunded.length} Refunded log(s)${dTx[0] ? `, Defaulted in ${short(dTx[0].tx)}` : ''}${refunded[0] ? `, Refunded in ${short(refunded[0].tx)}` : ''}`);
        const takeover = logsOf(deal.record, 'FallbackTriggered');
        r.check('triggerFallback lands once, after judgeBy', takeover.length === 1 && callsOf(deal, 'triggerFallback').length === 1, `${takeover.length} FallbackTriggered log(s), beacon round ${takeover[0]?.args?.beaconRound ?? 'none'}`);
        r.check("the primary's bond is freed", released(deal, primary.address) === BigInt(price), `BondReleased ${round.amount(released(deal, primary.address))} for ${short(primary.address)}`);
        r.check("the fallback's bond is never encumbered", released(deal, fallback.address) === 0n && delta(deal.record, fallback.address, 'free') === 0n, `BondReleased ${round.amount(released(deal, fallback.address))}; free bond ${round.amount(delta(deal.record, fallback.address, 'free'))} across the deal`);
        r.check('no KeyReleased log names the buyer', keysToBuyer(deal).length === 0, `${keysToBuyer(deal).length} log(s)`);
      } else {
        deal.record.notes.push(`SimChain paid the seller ${round.amount(delta(deal.record, seller))} from the default outcome: its rulebook's compensation rate of a price of 0`);
      }
    },
  },
  {
    id: '4',
    title: 'Fallback when the primary is silent (API)',
    waitsFor: ['T-217', 'T-221'],
    async run(r) {
      await requires(r, ['T-217', 'T-221']);
      const { round } = r;
      const [buyer, seller] = [round.address('buyer'), round.address('seller')];
      const { fallback, appeal } = round.demo.adjudicators;
      const price = priceFor(r);
      const primary = await adjudicator(r, 'adjudicator-1', price);
      // The fallback decides between judgeBy and fallbackBy, after a beacon round and a block: room for both (D31).
      const timing = timeoutWindows(r, { fallbackWithinSec: Math.max(round.demo.minWindowSec, 180) });
      let deal!: Deal;
      let done: J = null;
      await withSilent(r, primary, async (serving) => {
        deal = await openDeal(r, { label: "the round's silent primary, the demo fallback and appeal adjudicators", template: 'checks-only', deliverable: DATASET, checks: CHECKS, price, timing, adjudicators: { primary: primary.address, fallback, appeal } }, [buyer, seller, primary.address, fallback]);
        await fund(r, deal);
        await deliver(r, deal, CSV);
        r.step = 'fallback';
        r.say(`the primary stays silent; at judgeBy ${deal.terms.timing.judgeBy} the world's takeover hands the deal to the demo fallback ${short(fallback)}`);
        const left = Date.parse(deal.terms.timing.fallbackBy) - (await deal.buyer.settlementNow());
        done = await until(r, deal.buyer, deal.id, ['Released', 'Refunded'], Math.max(left, 0) + 60_000).catch((e) => {
          r.check('the demo fallback adjudicator decides', false, reason(e));
          return null;
        });
        silentCheck(r, deal, serving);
      });
      if (!done) {
        // Nobody decided: the default outcome ends the deal, so no money stays held for the next scenario.
        const takenBy = await takeOver(r, deal);
        const how = await applyDefault(r, deal);
        deal.record.notes.push(`the fallback did not decide; takeover sent by ${takenBy}; ${how}`);
        await finish(r, deal);
        return;
      }
      const [decided, triggered] = await Promise.all([eventsOfType(deal, 'judgment.decided'), eventsOfType(deal, 'fallback.triggered')]);
      const judgeBy = Date.parse(deal.terms.timing.judgeBy);
      r.check("the world's takeover sends fallback at judgeBy", triggered.every((es) => es.length === 1 && Date.parse(es[0].at) >= judgeBy), triggered.map((es) => es.map((e) => `fallback.triggered at ${e.at}${e.submittedVia ? ` via ${e.submittedVia}` : ''}`).join(', ') || 'none').join('; '));
      r.check('the deal ends Released, as the work passes', done.escrowState === 'Released', done.escrowState);
      if (done.escrowState === 'Released') await keyChecks(r, deal, CSV);
      const { rulebook } = await deal.buyer.club(round.demo.clubId);
      const source: string = rulebook.randomness?.source ?? 'sim';
      const clock = source === 'drand-quicknet' ? QUICKNET : source === 'sim' ? SIM : null;
      const want = clock ? roundAt(clock, deal.terms.timing.judgeBy) : null;
      const rounds = decided.map((es) => es.at(-1)?.payload?.beaconRound ?? null);
      if (done.deadlines?.appealBy) await expireAppeal(r, deal, done.deadlines.appealBy);
      await finish(r, deal);
      const fee = BigInt(deal.terms.adjudication.fee.amount);
      r.check('the seller is paid the price', delta(deal.record, seller) === BigInt(price), `seller ${round.amount(delta(deal.record, seller))}`);
      r.check('the buyer pays the price, the adjudication fee and the operator fee', delta(deal.record, buyer) === -(BigInt(price) + fee + (deal.operatorFee ?? 0n)), `buyer ${round.amount(delta(deal.record, buyer))}`);
      settledChecks(r, deal, 'Released');
      if (round.chain) {
        const decides = callsOf(deal, 'decide');
        const log = logsOf(deal.record, 'Decided');
        r.check('the demo fallback adjudicator decides', decided.every((es) => es.at(-1)?.payload?.role === 'fallback') && log.length === 1 && lc(log[0]!.args.adjudicator) === fallback, `Decided by ${log.map((l) => short(l.args.adjudicator)).join(', ') || 'nobody'}; role ${decided.map((es) => es.at(-1)?.payload?.role ?? 'none').join(' / ')}`);
        const named = decides.at(-1)?.args?.[1]?.beaconRound;
        const takeover = logsOf(deal.record, 'FallbackTriggered')[0]?.args?.beaconRound;
        r.check("the fallback decision's beacon is drand-quicknet at the round of judgeBy", source === 'drand-quicknet' && want !== null && Number(named) === want && Number(takeover) === want && rounds.every((x) => Number(x) === want), `the club's beacon ${source}; the round at judgeBy ${want ?? 'unknown'}; decide's beaconRound ${named ?? 'none'}, FallbackTriggered's ${takeover ?? 'none'}, both operators' ${rounds.join(' and ')}; HoldbackRules verified its BLS signature, or decide would have reverted`);
        r.check('the key reaches the buyer on chain', keysToBuyer(deal).length === 1, `${keysToBuyer(deal).length} KeyReleased log(s) to the buyer`);
        paidCheck(r, deal, 'the price reaches the seller on chain', seller, BigInt(price));
        paidCheck(r, deal, 'the adjudication fee goes to the fallback, whose decision settles', fallback, fee);
        r.check("the primary's bond is freed at the fallback's decision", released(deal, primary.address) === BigInt(price), `BondReleased ${round.amount(released(deal, primary.address))} for ${short(primary.address)}`);
        r.check("the fallback's bond is freed after the appeal window", released(deal, fallback) === BigInt(price), `BondReleased ${round.amount(released(deal, fallback))} for ${short(fallback)}`);
      } else {
        const actors = decided.map((es) => lc(es.at(-1)?.actor ?? 'none'));
        r.check('the demo fallback adjudicator decides', decided.every((es) => es.at(-1)?.payload?.role === 'fallback') && actors.every((a) => a === fallback), `judgment.decided by ${actors.map(short).join(' / ')}, role ${decided.map((es) => es.at(-1)?.payload?.role ?? 'none').join(' / ')}`);
        // SimChain's beacon is the settlement layer's own clock, not drand: the drand proof is checked on a chain.
        r.check(`the fallback decision's beacon is ${source} at the round of judgeBy`, want !== null && rounds.every((x) => Number(x) === want), `the round at judgeBy ${want ?? 'unknown'}; both operators' judgment.decided ${rounds.join(' and ')}; drand quicknet is checked on a chain`);
      }
    },
  },
  {
    id: '9',
    title: 'Early accept before the primary decides (API)',
    waitsFor: ['T-221'],
    async run(r) {
      await requires(r, ['T-221']);
      const { round } = r;
      const [buyer, seller] = [round.address('buyer'), round.address('seller')];
      const price = priceFor(r);
      const primary = await adjudicator(r, 'adjudicator-1', price);
      let deal!: Deal;
      let late = '';
      await withSilent(r, primary, async (serving) => {
        deal = await openDeal(r, { label: "the round's silent primary; the buyer accepts early", template: 'checks-only', deliverable: DATASET, checks: CHECKS, price, timing: timeoutWindows(r), adjudicators: { primary: primary.address, fallback: round.demo.adjudicators.fallback, appeal: round.demo.adjudicators.appeal } }, [buyer, seller, primary.address]);
        await fund(r, deal);
        await deliver(r, deal, CSV);
        r.step = 'accept';
        // The seller hands the buyer its signed delivery (D32); the buyer opens its own envelope from it, checks it
        // against the delivery both operators posted and the signed hashes, and only then signs (agent.earlyAccept).
        const accepted = await deal.buyer.earlyAccept(deal.terms, deal.delivery);
        r.say(`${accepted.escrowState}: the buyer opened its envelope from the seller's signed delivery and accepted early`);
        const done = await until(r, deal.buyer, deal.id, ['Released'], 120_000);
        r.check('the deal ends Released by the early accept', done.escrowState === 'Released', done.escrowState);
        r.step = 'late';
        // The primary decides after all: settlement refuses a decision on a deal the early accept has closed.
        late = await primary.decide(r, deal.id, deal.terms, 'reject').then(() => 'accepted', (e: unknown) => reason(e));
        silentCheck(r, deal, serving);
      });
      const after = (await views(deal)).map((v) => v.escrowState);
      r.check("the primary's later decision is refused", /\/decisions: \w+: /.test(late) && after.every((s) => s === 'Released'), `${late}; the deal stays ${after.join(' / ')}`);
      await keyChecks(r, deal, CSV);
      await finish(r, deal);
      await namesPosted(r, deal, 'the early accept', 'earlyAccept');
      const fee = BigInt(deal.terms.adjudication.fee.amount);
      r.check('the seller is paid the price', delta(deal.record, seller) === BigInt(price), `seller ${round.amount(delta(deal.record, seller))}`);
      r.check('the buyer pays the price and the operator fee; the adjudication fee comes back', delta(deal.record, buyer) === -(BigInt(price) + (deal.operatorFee ?? 0n)), `buyer ${round.amount(delta(deal.record, buyer))}; adjudication fee ${round.amount(fee)}`);
      settledChecks(r, deal, 'Released');
      if (round.chain) {
        r.check("dealOf's appeal state is closed (no appeal follows an early accept)", deal.record.chain?.appeal === 'closed', deal.record.chain?.appeal ?? 'unread');
        r.check('the key reaches the buyer on chain', keysToBuyer(deal).length === 1 && Number(keysToBuyer(deal)[0]!.args.path) === 1, `${keysToBuyer(deal).length} KeyReleased log(s) to the buyer, path ${keysToBuyer(deal).map((l) => l.args.path).join(', ') || 'none'} (1 is the early accept)`);
        r.check('no Decided log', logsOf(deal.record, 'Decided').length === 0, `${logsOf(deal.record, 'Decided').length} log(s)`);
        paidCheck(r, deal, 'the price reaches the seller on chain', seller, BigInt(price));
        paidCheck(r, deal, 'the adjudication fee returns to the buyer on chain', buyer, fee);
        r.check("the primary's bond is freed at the early accept", released(deal, primary.address) === BigInt(price), `BondReleased ${round.amount(released(deal, primary.address))} for ${short(primary.address)}`);
      }
    },
  },
  {
    id: '10b',
    title: 'Mutual settlement after delivery (API)',
    waitsFor: ['T-221'],
    async run(r) {
      await requires(r, ['T-221']);
      const { round } = r;
      // At a price of 0 there is nothing to settle: a MutualSettlement carries one to eight payouts that sum to the price
      // (spec/schemas/common.schema.json, Payouts), and each is positive.
      if (!round.chain) throw new Error("SimChain: the round's own adjudicator cannot bond at run time, so its deal would be priced at 0, and a settlement of a price of 0 has no payout to carry; 10b runs on a chain (anvil in the tests, Sepolia live)");
      const [buyer, seller] = [round.address('buyer'), round.address('seller')];
      const price = priceFor(r);
      const primary = await adjudicator(r, 'adjudicator-1', price);
      const total = BigInt(price);
      const share = (total * 6_000n) / 10_000n;
      let deal!: Deal;
      await withSilent(r, primary, async (serving) => {
        deal = await openDeal(r, { label: "settled by agreement after delivery, 60 % to the seller, the key released", template: 'checks-only', deliverable: DATASET, checks: CHECKS, price, timing: timeoutWindows(r), adjudicators: { primary: primary.address, fallback: round.demo.adjudicators.fallback, appeal: round.demo.adjudicators.appeal } }, [buyer, seller, primary.address]);
        await fund(r, deal);
        await deliver(r, deal, CSV);
        r.step = 'settle';
        const token = round.demo.token;
        const payouts = [{ to: seller, amount: { token, amount: share.toString() } }, { to: buyer, amount: { token, amount: (total - share).toString() } }];
        const nonce = freshNonce();
        // After a delivery the settlement names the posted delivery, the one the seller signed (ADR-0029).
        const intent = { kind: 'settlement' as const, terms: deal.terms, payouts, releaseKey: true, deliveryHash: deliveryHashOf(deal.delivery), nonce };
        const prepared = await deal.buyer.call('POST', '/v1/prepare/settlement', { commitmentId: deal.id, nonce, payouts, releaseKey: true });
        const mine = await deal.buyer.sign(prepared, intent);
        const theirs = await deal.seller.sign(prepared, intent);
        const settled = await deal.buyer.call('POST', mine.path, { ...mine.body, sellerSignature: theirs.body.sellerSignature });
        r.say(`${settled.escrowState}: both signed one MutualSettlement after delivery, ${round.amount(share)} to the seller and ${round.amount(total - share)} to the buyer, releaseKey true`);
        const done = await until(r, deal.buyer, deal.id, ['Settled'], 120_000);
        r.check('the deal ends Settled', done.escrowState === 'Settled', done.escrowState);
        silentCheck(r, deal, serving);
      });
      await keyChecks(r, deal, CSV);
      await finish(r, deal);
      await namesPosted(r, deal, 'the settlement', 'mutualSettle');
      r.check('the payouts sum to the price, 60 % to the seller', delta(deal.record, seller) === share, `seller ${round.amount(delta(deal.record, seller))}`);
      r.check('the buyer gets the rest of the price and the adjudication fee back', delta(deal.record, buyer) === -(share + (deal.operatorFee ?? 0n)), `buyer ${round.amount(delta(deal.record, buyer))}`);
      settledChecks(r, deal, 'Settled');
      if (round.chain) {
        const settle = callsOf(deal, 'mutualSettle').at(-1)?.args?.[1];
        r.check('the settlement carries the delivery and releaseKey', settle?.hasDelivery === true && settle?.releaseKey === true, `hasDelivery ${settle?.hasDelivery}, releaseKey ${settle?.releaseKey}`);
        r.check('the key reaches the buyer on chain', keysToBuyer(deal).length === 1 && Number(keysToBuyer(deal)[0]!.args.path) === 2, `${keysToBuyer(deal).length} KeyReleased log(s) to the buyer, path ${keysToBuyer(deal).map((l) => l.args.path).join(', ') || 'none'} (2 is a mutual settlement)`);
        paidCheck(r, deal, 'the seller\'s share reaches it on chain', seller, share);
        r.check("the primary's bond is freed", released(deal, primary.address) === total, `BondReleased ${round.amount(released(deal, primary.address))} for ${short(primary.address)}`);
      }
    },
  },
];
