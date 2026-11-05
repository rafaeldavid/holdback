// The scenarios of the first full EVM end-to-end round (docs/tasks/T-216-evm-e2e-round-1.md, Acceptance criteria),
// and their registry. Each is one or more real deals through the public API, plus direct contract calls where the
// task says so, and each checks that the deal ends where the signed terms say. A scenario whose prerequisite is not
// live yet (T-217, T-218, T-219 or T-221, shipped together by T-220's deploy) stops before its first deal and is
// recorded as waiting. This file holds the scenarios that run; the four groups still being built live in
// e2e-scenarios-<group>.ts, and SCENARIOS below registers all of them, in scenario order.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { freshNonce } from './verify.ts';
import { buyerKeys, buyerOpens, deliver, delta, ensureFunds, eventsOf, finish, fund, logsOf, offer, openDeal, reason, short, shortWindows, trigger, until, waitPast, type Run } from './e2e-run.ts';
import {
  APPELLANT_FLOAT,
  BAD_CSV,
  CHECKS,
  CSV,
  DATASET,
  FRENCH,
  PRICE,
  RUBRIC,
  TRANSLATION,
  appeal,
  appealBond,
  bondFreedCheck,
  checksLine,
  cppCheck,
  expireAppeal,
  here,
  judgment,
  lc,
  paidCheck,
  requires,
  settledChecks,
  untilAppeal,
  type J,
  type Scenario,
} from './e2e-scenario-kit.ts';
import { DIRECT } from './e2e-scenarios-direct.ts';
import { ESCALATION } from './e2e-scenarios-escalation.ts';
import { SCRIPTED } from './e2e-scenarios-scripted.ts';
import { SILENT } from './e2e-scenarios-silent.ts';

export type { Scenario } from './e2e-scenario-kit.ts';

/**
 * The homepage command: the published bundle (site/try.mjs, as https://escrow.stream/try.mjs serves it) run once
 * relayed by each operator, as a stranger runs it. With `--try-seller`, Crow's test seller is the other party.
 */
async function homepage(r: Run): Promise<void> {
  const { round } = r;
  r.step = 'homepage';
  const bundle = readFileSync(here('../site/try.mjs'));
  if (round.o.tryBundleUrl) {
    const res = await fetch(round.o.tryBundleUrl);
    const published = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    const same = published !== null && sha(published) === sha(bundle);
    const detail = `${round.o.tryBundleUrl}: ${published ? sha(published).slice(0, 12) : `HTTP ${res.status}`}, site/try.mjs: ${sha(bundle).slice(0, 12)}`;
    // Until T-220 deploys main, the site stays matched to the live operators (publishing main's bundle would advertise
    // routes that answer 501 live), so a difference is expected and counts only with --t220.
    if (round.t220) r.check('the published try.mjs is the repository bundle', same, detail);
    else r.note(`the published try.mjs ${same ? 'is' : 'is not'} the repository bundle (${detail}); a difference is expected before T-220's deploy`);
  }
  for (const relay of [0, 1]) {
    const ops = [...round.operators.slice(relay), ...round.operators.slice(0, relay)];
    const out = await new Promise<{ code: number | null; out: string }>((resolve) => {
      // As a stranger runs it: only what try.mjs reads, never the rest of the environment (the round's secret among it).
      const env = { PATH: process.env['PATH'] ?? '', HOLDBACK_OPERATORS: ops.join(','), ...(process.env['HOLDBACK_DEPLOYMENT'] ? { HOLDBACK_DEPLOYMENT: process.env['HOLDBACK_DEPLOYMENT'] } : {}) };
      const child = spawn(process.execPath, ['--input-type=module', '-', ...(round.o.trySeller ? ['--seller', round.o.trySeller] : [])], { cwd: here('.'), env });
      let text = '';
      child.stdout.on('data', (d: Buffer) => (text += d.toString()));
      child.stderr.on('data', (d: Buffer) => (text += d.toString()));
      child.on('exit', (code) => resolve({ code, out: text }));
      child.stdin.end(bundle);
    });
    const done = /^done +commitment (0x[0-9a-f]{64}) (\w+)$/m.exec(out.out);
    // try.mjs says why it stopped on its "stopped at" or "refused at" line; the line after it is a general footer.
    const stop = out.out.split('\n').find((l) => /^(stopped|refused) at /.test(l)) ?? out.out.trim().split('\n').at(-1);
    r.attachments[`homepage relayed by ${new URL(ops[0]!).origin}`] = reason(out.out);
    r.check(`the homepage command passes relayed by ${new URL(ops[0]!).origin}`, out.code === 0 && done?.[2] === 'Released', done ? `${short(done[1]!)} ${done[2]}, exit ${out.code}` : `exit ${out.code}: ${reason(stop)}`);
    if (done) r.notes.push(`homepage command relayed by ${new URL(ops[0]!).origin}: ${done[1]} ${done[2]}`);
  }
}

/** The scenarios this file builds; the groups' scenarios come from their own files. */
const BUILT: Scenario[] = [
  {
    id: '1',
    title: 'Happy-path release (API)',
    waitsFor: [],
    async run(r) {
      const { round } = r;
      const [buyer, seller] = [round.address('buyer'), round.address('seller')];
      const deal = await openDeal(r, { label: 'rubric deal, default template, live panel', template: 'default', deliverable: TRANSLATION, rubric: RUBRIC, checks: [], price: PRICE }, [buyer, seller, round.demo.adjudicators.primary]);
      const notices = ((await deal.buyer.call('GET', `/v1/commitments/${deal.id}`)).notices ?? []) as string[];
      for (const n of notices) r.say(`notice: ${n}`);
      await fund(r, deal);
      await deliver(r, deal, FRENCH);
      r.step = 'outcome';
      const done = await until(r, deal.buyer, deal.id, ['Released', 'Refunded', 'Escalated'], 600_000);
      const record = await judgment(deal);
      const members: J[] = record?.panel?.members ?? [];
      r.say(`${done.escrowState}: decision ${record?.aggregate?.decision ?? 'unknown'}; panel ${members.map((m) => `${m.model} ${m.verdict?.overall ?? m.status}`).join(', ') || 'none served'}`);
      if (!r.check('the deal ends Released', done.escrowState === 'Released', done.escrowState)) {
        r.note('No re-roll (T-216): a panel verdict is never re-rolled. Record this as a finding; do not open another deal to get a pass.');
      }
      const scripted = members.some((m) => String(m.model).startsWith('placeholder-') || String(m.verdict?.rationale ?? '').startsWith('[fake judge'));
      r.check('a live panel judged', members.length > 0 && !scripted, members.length ? (scripted ? 'the panel was scripted (no model ran): the live budget was spent or the keys are missing' : `${members.length} pinned models`) : 'no judgment record served');
      if (done.escrowState === 'Released') r.check('the buyer opens the work with its released key', await buyerOpens(r, deal, FRENCH), 'decrypted, sha256 checked against the delivery');
      if (done.deadlines?.appealBy) await expireAppeal(r, deal, done.deadlines.appealBy);
      await finish(r, deal);
      const price = BigInt(PRICE);
      const fee = BigInt(deal.terms.adjudication.fee.amount);
      r.check('the seller is paid the price', delta(deal.record, seller) === price, `seller ${round.amount(delta(deal.record, seller))}`);
      r.check('the buyer pays the price, the adjudication fee and the operator fee', delta(deal.record, buyer) === -(price + fee + (deal.operatorFee ?? 0n)), `buyer ${round.amount(delta(deal.record, buyer))}`);
      settledChecks(r, deal, 'Released');
      paidCheck(r, deal, 'the price reaches the seller on chain', seller, price);
      if (round.chain) {
        const keys = logsOf(deal.record, 'KeyReleased').filter((l) => lc(l.args.recipient) === buyer);
        r.check('the key reaches the buyer on chain', keys.length === 1, `${keys.length} KeyReleased log(s) to the buyer`);
        bondFreedCheck(r, deal);
      }
      if (round.o.homepage !== false) await homepage(r);
    },
  },
  {
    id: '2',
    title: 'Refund on reject (API)',
    waitsFor: [],
    async run(r) {
      const { round } = r;
      const [buyer, seller] = [round.address('buyer'), round.address('seller')];
      // Relayed by the second operator, so the round's own deals run through both nodes.
      const deal = await openDeal(r, { label: 'checks-only, a delivery that drops a row', template: 'checks-only', deliverable: DATASET, checks: CHECKS, price: PRICE, relay: 1 }, [buyer, seller, round.demo.adjudicators.primary]);
      await fund(r, deal);
      await deliver(r, deal, BAD_CSV);
      r.step = 'outcome';
      const done = await until(r, deal.buyer, deal.id, ['Released', 'Refunded', 'Escalated'], 300_000);
      const record = await judgment(deal);
      r.check('the deal ends Refunded', done.escrowState === 'Refunded', `${done.escrowState}: checks ${checksLine(record)}; decision ${record?.aggregate?.decision ?? 'unknown'}`);
      const keys = await buyerKeys(deal);
      r.check('no key reaches the buyer', keys.every((n) => n === 0), `the key read serves ${keys.join(' and ')} envelope(s) to the buyer`);
      const posted = await Promise.all(deal.buyer.sources().map(async (api) => (await eventsOf(deal.buyer, deal.id, api)).find((e) => e.type === 'delivery.submitted')?.payload?.deliveryHash ?? null));
      if (done.deadlines?.appealBy) await expireAppeal(r, deal, done.deadlines.appealBy);
      await finish(r, deal);
      const fee = BigInt(deal.terms.adjudication.fee.amount);
      r.check('the buyer gets the price back; the adjudication and operator fees are spent', delta(deal.record, buyer) === -(fee + (deal.operatorFee ?? 0n)), `buyer ${round.amount(delta(deal.record, buyer))}`);
      r.check('the seller is paid nothing', delta(deal.record, seller) === 0n, `seller ${round.amount(delta(deal.record, seller))}`);
      settledChecks(r, deal, 'Refunded');
      paidCheck(r, deal, 'the price returns to the buyer on chain', buyer, BigInt(PRICE));
      if (round.chain) {
        const decide = deal.record.transactions.flatMap((t) => t.calls).find((c) => c.fn === 'decide');
        const named = lc(decide?.args?.[1]?.deliveryHash ?? '');
        const onChain = lc(await round.chain.deliveryHashOf(deal.id));
        r.check('the decision names the posted delivery (D44)', named === onChain && posted.every((p) => lc(p ?? '') === onChain), `decide names ${short(named)}; deliveryHashOf ${short(onChain)}; both operators' delivery.submitted ${posted.map((p) => short(p ?? 'none')).join(', ')}`);
        const toBuyer = logsOf(deal.record, 'KeyReleased').filter((l) => lc(l.args.recipient) === buyer);
        r.check('no KeyReleased log names the buyer', toBuyer.length === 0, `${toBuyer.length} log(s)`);
        bondFreedCheck(r, deal);
      } else {
        r.check('the decision names the posted delivery (D44)', posted.every((p) => p !== null && p === posted[0]), `both operators record delivery ${short(posted[0] ?? 'none')}; SimChain refuses a decision naming another`, 'inferred');
      }
    },
  },
  {
    id: '3a',
    title: 'Timeouts: reclaim when nothing is delivered (API and direct)',
    waitsFor: [],
    async run(r) {
      const { round } = r;
      const [buyer, seller] = [round.address('buyer'), round.address('seller')];
      // offerExpiresAt < fundBy < deliverBy (core's timing rule), with room to fund before the offer expires.
      const m = round.demo.minWindowSec;
      const timing = shortWindows(r, { offerExpiresInSec: 2 * m, fundWithinSec: 3 * m, deliverWithinSec: 4 * m });
      for (const via of round.chain ? (['api', 'direct'] as const) : (['api'] as const)) {
        const deal = await openDeal(r, { label: `nothing delivered, reclaimed ${via === 'api' ? 'through the API' : "directly from the buyer's key"}`, template: 'checks-only', deliverable: DATASET, checks: CHECKS, price: PRICE, timing }, [buyer, seller, round.demo.adjudicators.primary]);
        await fund(r, deal);
        r.step = 'reclaim';
        r.say(`the seller delivers nothing; waiting for deliverBy ${deal.terms.timing.deliverBy}`);
        await waitPast(r, deal.buyer, deal.terms.timing.deliverBy);
        if (via === 'api') {
          await trigger(r, deal, 'reclaim');
        } else {
          const tx = await round.chain!.trigger(round.key('buyer'), 'reclaim', deal.terms);
          deal.sent.push({ step: 'reclaim (direct)', tx });
          r.say(`reclaim sent directly by the buyer: ${round.chain!.link(tx.tx)} (${tx.gasUsed} gas)`);
        }
        // The operators follow a direct call only with T-218 (target: one sync pass, 60 s or less); until then the view lags.
        if (via === 'api' || round.t220) await until(r, deal.buyer, deal.id, ['Refunded'], 120_000).catch((e) => r.note(`the operators' view: ${reason(e)}`));
        await finish(r, deal);
        r.check(`${via}: the buyer gets the price and the adjudication fee back`, delta(deal.record, buyer) === -(deal.operatorFee ?? 0n), `buyer ${round.amount(delta(deal.record, buyer))} (the operator fee is never refunded)`);
        if (round.chain && deal.record.chain) {
          r.check(`${via}: dealOf reads Refunded`, deal.record.chain.stage === 'Refunded', deal.record.chain.stage);
          cppCheck(r, deal, `${via}: `);
          paidCheck(r, deal, `${via}: the price and the adjudication fee return to the buyer on chain`, buyer, BigInt(PRICE) + BigInt(deal.terms.adjudication.fee.amount));
          const primary = lc(deal.terms.adjudication.adjudicator);
          const freed = logsOf(deal.record, 'BondReleased').filter((l) => lc(l.args.adjudicator) === primary).reduce((s, l) => s + BigInt(l.args.amount), 0n);
          r.check(`${via}: the primary's bond is freed`, freed === BigInt(PRICE), `BondReleased ${round.amount(freed)}`);
        }
        if (via === 'api' || round.t220) r.check(`${via}: both operators show Refunded and agree`, deal.record.operators?.agree === true && deal.record.operators.views.every((v) => v.escrowState === 'Refunded'), deal.record.operators?.views.map((v) => v.escrowState).join(' / ') ?? '');
        else deal.record.notes.push(`The operators show ${deal.record.operators?.views.map((v) => v.escrowState).join(' / ')} after the direct reclaim: they follow direct calls once T-218 is live (run with --t220); the money settled on chain.`);
      }
    },
  },
  {
    id: '3d',
    title: 'Timeouts: offer expiry (API)',
    waitsFor: [],
    async run(r) {
      const { round } = r;
      const offerExpiresInSec = round.demo.minWindowSec;
      const deal = await offer(r, { label: 'an offer nobody agrees to', template: 'checks-only', deliverable: DATASET, checks: CHECKS, price: PRICE, timing: shortWindows(r, { offerExpiresInSec }) }, [round.address('buyer'), round.address('seller')]);
      r.step = 'expire';
      r.say(`nobody agrees; waiting for offerExpiresAt ${deal.terms.timing.offerExpiresAt}`);
      await waitPast(r, deal.buyer, deal.terms.timing.offerExpiresAt);
      await trigger(r, deal, 'expire-offer');
      await until(r, deal.buyer, deal.id, ['Expired'], 120_000);
      await finish(r, deal);
      r.check('both operators show Expired and agree', deal.record.operators?.agree === true && deal.record.operators.views.every((v) => v.escrowState === 'Expired'), deal.record.operators?.views.map((v) => v.escrowState).join(' / ') ?? '');
      if (round.chain && deal.record.chain) {
        r.check('dealOf reads Expired', deal.record.chain.stage === 'Expired', deal.record.chain.stage);
        r.check('expireOffer emits JobExpired', logsOf(deal.record, 'JobExpired').length === 1, `${logsOf(deal.record, 'JobExpired').length} log(s)`);
      }
    },
  },
  {
    id: '6',
    title: 'Appeal upheld (API)',
    waitsFor: ['T-217'],
    async run(r) {
      await requires(r, ['T-217']);
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
        if (round.chain) {
          const tx = await round.chain.approveBonds(round.key(shape.appellant), bond);
          deal.sent.push({ step: 'appeal bond approval', tx });
          r.say(`${shape.appellant} approves HoldbackBonds for its ${round.amount(bond)} appeal bond: ${round.chain.link(tx.tx)} (${tx.gasUsed} gas)`);
        }
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
        // upheld appellant loses its bond, and the rulebook's appeal fee where the settlement layer charges one: SimChain
        // does; on the contract the fee is Phase 4 and absent (recorded, not passed).
        const appealFee = round.chain ? 0n : BigInt((await deal.buyer.club(round.demo.clubId)).rulebook.appealFee?.amount ?? '0');
        if (round.chain) deal.record.notes.push('No appeal fee on chain: Phase 4 economics, recorded, not passed (T-216 non-goals).');
        const paidByBuyer = BigInt(PRICE) + BigInt(deal.terms.adjudication.fee.amount) + (deal.operatorFee ?? 0n);
        const expected = -(bond + appealFee + (shape.appellant === 'seller' ? 0n : paidByBuyer));
        r.check(`${shape.appellant}: the appellant loses its bond`, delta(deal.record, round.address(shape.appellant)) === expected, `${shape.appellant} ${round.amount(delta(deal.record, round.address(shape.appellant)))}, expected ${round.amount(expected)}`);
        if (round.chain) {
          const paid = logsOf(deal.record, 'AppealBondPaid');
          r.check(`${shape.appellant}: the bond goes to the first adjudicator's bond`, paid.length === 1 && lc(paid[0]!.args.to) === primary && paid[0]!.args.toBond === true && BigInt(paid[0]!.args.amount) === bond, paid.map((p) => `${r.round.amount(p.args.amount)} to ${short(p.args.to)}${p.args.toBond ? ' (bond)' : ''}`).join('; ') || 'no AppealBondPaid log');
          r.check(`${shape.appellant}: no bond is slashed`, logsOf(deal.record, 'BondSlashed').length === 0, `${logsOf(deal.record, 'BondSlashed').length} BondSlashed log(s)`);
          const decide = deal.record.transactions.flatMap((t) => t.calls).filter((c) => c.fn === 'decide').at(-1);
          r.check(`${shape.appellant}: the appeal decision carries a drand quicknet proof`, Number(decide?.args?.[1]?.beaconRound ?? 0) > 0, `beacon round ${decide?.args?.[1]?.beaconRound ?? 'none'}`);
        }
        r.check(`${shape.appellant}: both operators agree`, deal.record.operators?.agree === true, deal.record.operators?.views.map((v) => `${v.escrowState} ${v.appealState}`).join(' / ') ?? '');
      }
    },
  },
  {
    id: '10a',
    title: 'Mutual settlement before delivery (API)',
    waitsFor: [],
    async run(r) {
      const { round } = r;
      const [buyer, seller] = [round.address('buyer'), round.address('seller')];
      const deal = await openDeal(r, { label: 'settled by agreement before delivery, 60 % to the seller', template: 'checks-only', deliverable: DATASET, checks: CHECKS, price: PRICE }, [buyer, seller, round.demo.adjudicators.primary]);
      await fund(r, deal);
      r.step = 'settle';
      const price = BigInt(PRICE);
      const share = (price * 6_000n) / 10_000n;
      const token = round.demo.token;
      const payouts = [{ to: seller, amount: { token, amount: share.toString() } }, { to: buyer, amount: { token, amount: (price - share).toString() } }];
      const nonce = freshNonce();
      const prepared = await deal.buyer.call('POST', '/v1/prepare/settlement', { commitmentId: deal.id, nonce, payouts, releaseKey: false });
      const intent = { kind: 'settlement' as const, terms: deal.terms, payouts, releaseKey: false, deliveryHash: null, nonce };
      const mine = await deal.buyer.sign(prepared, intent);
      const theirs = await deal.seller.sign(prepared, intent);
      const settled = await deal.buyer.call('POST', mine.path, { ...mine.body, sellerSignature: theirs.body.sellerSignature });
      r.say(`${settled.escrowState}: both signed one MutualSettlement, ${round.amount(share)} to the seller and ${round.amount(price - share)} to the buyer`);
      await until(r, deal.buyer, deal.id, ['Settled'], 120_000);
      await finish(r, deal);
      const fee = BigInt(deal.terms.adjudication.fee.amount);
      r.check('the payouts sum to the price, 60 % to the seller', delta(deal.record, seller) === share, `seller ${round.amount(delta(deal.record, seller))}`);
      r.check('the buyer gets the rest of the price and the adjudication fee back', delta(deal.record, buyer) === -(share + (deal.operatorFee ?? 0n)), `buyer ${round.amount(delta(deal.record, buyer))}; the adjudication fee of ${round.amount(fee)} returns to the buyer`);
      settledChecks(r, deal, 'Settled');
      if (round.chain) {
        const primary = lc(deal.terms.adjudication.adjudicator);
        const freed = logsOf(deal.record, 'BondReleased').filter((l) => lc(l.args.adjudicator) === primary).reduce((s, l) => s + BigInt(l.args.amount), 0n);
        r.check("the primary's bond is freed", freed === price, `BondReleased ${round.amount(freed)}`);
        r.check('no key is released (releaseKey false, nothing delivered)', logsOf(deal.record, 'KeyReleased').length === 0, `${logsOf(deal.record, 'KeyReleased').length} KeyReleased log(s)`);
      }
    },
  },
];

/** Scenario order: by number, then by letter ("3a" < "3b" < "4" < "10a"). */
const order = (a: Scenario, b: Scenario) => parseInt(a.id, 10) - parseInt(b.id, 10) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Every scenario once, in scenario order: the built ones here and the four groups'. Refuses an ID listed twice. */
function registry(...lists: Scenario[][]): Scenario[] {
  const all = lists.flat();
  const twice = all.map((s) => s.id).filter((id, i, ids) => ids.indexOf(id) !== i);
  if (twice.length) throw new Error(`scenario ${twice.join(', ')} is registered more than once (e2e-scenarios*.ts)`);
  return all.sort(order);
}

export const SCENARIOS: Scenario[] = registry(BUILT, SILENT, SCRIPTED, ESCALATION, DIRECT);

/** A scenario by its ID ("1", "3a"), or every one for "all". */
export function pick(ids: readonly string[]): Scenario[] {
  if (ids.includes('all')) return SCENARIOS;
  return ids.map((id) => {
    const s = SCENARIOS.find((x) => x.id === id);
    if (!s) throw new Error(`no scenario ${id}; the scenarios are ${SCENARIOS.map((x) => x.id).join(', ')}`);
    return s;
  });
}
