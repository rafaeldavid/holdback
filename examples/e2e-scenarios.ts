// The scenarios of the first full EVM end-to-end round (docs/tasks/T-216-evm-e2e-round-1.md, Acceptance criteria).
// Each is one or more real deals through the public API, plus direct contract calls where the task says so, and each
// checks that the deal ends where the signed terms say. A scenario whose prerequisite is not live yet (T-217, T-218,
// T-219 or T-221, shipped together by T-220's deploy) stops before its first deal and is recorded as waiting.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { freshNonce } from './verify.ts';
import {
  buyerKeys,
  buyerOpens,
  deliver,
  delta,
  ensureFunds,
  eventsOf,
  finish,
  fund,
  logsOf,
  offer,
  openDeal,
  refreshBefore,
  short,
  shortWindows,
  sleep,
  trigger,
  until,
  waitPast,
  Waits,
  type Deal,
  type Run,
} from './e2e-run.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Scenario {
  id: string;
  title: string;
  /** The tasks that must be live (through T-220's deploy) before it can run against the demo. */
  waitsFor: string[];
  /** What it still needs beyond those tasks, for the Handoff; empty when it is implemented. */
  needs?: string;
  run(r: Run): Promise<void>;
}

const PRICE = '25000000'; // 25 tUSDC: 6 decimals
const DATASET = { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' };
const CHECKS = [
  { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
  { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
  { id: 'uniq', type: 'unique_key', required: true, columns: ['customer_id'] },
];
const CSV = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n3,grace@example.com\n';
/** The bad-work-row-drop shape: a row missing, so the required rows check fails. */
const BAD_CSV = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n';
/** Scenario 1's rubric deal: a short translation, judged by the panel against two weighted criteria. */
const MEMO = 'The goods ship on Tuesday. Payment is due within 30 days of delivery.';
const TRANSLATION = { kind: 'document', description: `Translate into French: "${MEMO}"`, format: 'text/plain' };
const RUBRIC = {
  passThreshold: 300, // hundredths of a point: 3.00 of 4
  criteria: [
    { id: 'faithful', description: 'Every sentence keeps its meaning, dates and amounts.', weight: 70, anchors: { '0': 'Meaning lost', '2': 'Minor errors', '4': 'Faithful' } },
    { id: 'fluent', description: 'Reads as natural, formal French.', weight: 30, anchors: { '0': 'Unreadable', '2': 'Awkward', '4': 'Natural' } },
  ],
};
const FRENCH = 'Les marchandises sont expédiées mardi. Le paiement est dû dans les 30 jours suivant la livraison.';

const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
const lc = (a: string) => a.toLowerCase();

/**
 * Stops the run as waiting unless every task in `tasks` is live: T-217 when the club's rulebook names the drand
 * quicknet beacon on a chain (the demo world's fallback and appeal adjudicators decide on a chain only with it;
 * SimChain's own beacon needs none), T-221 when the operators serve schema 0.10 or later, T-218 and T-219 when the
 * round is told T-220 has shipped them (`--t220`), since no API read shows either.
 */
async function requires(r: Run, tasks: string[]): Promise<void> {
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
async function judgment(deal: Deal): Promise<J | null> {
  try {
    return await deal.buyer.call('GET', `/v1/commitments/${deal.id}/judgment`);
  } catch {
    return null;
  }
}

/** The decision's checks in one line: "cols pass, rows FAIL". */
const checksLine = (j: J | null) => (j?.deterministic ?? []).map((c: J) => `${c.checkId} ${c.passed ? 'pass' : 'FAIL'}`).join(', ');

/**
 * Sends `appeal-expiry` once the appeal window has closed, so the primary's bond is freed on chain, then waits for both
 * operators to show the appeal expired. Since T-211 the demo's adjudicators expire their own decisions' appeals, so
 * the window may already be closed; the run says which.
 */
async function expireAppeal(r: Run, deal: Deal, appealBy: string): Promise<void> {
  r.step = 'appeal';
  r.say(`waiting for the appeal window to close at ${appealBy}, then appeal-expiry frees the primary's bond`);
  await waitPast(r, deal.buyer, appealBy);
  let closedBy = 'the round, through the API';
  try {
    await trigger(r, deal, 'appeal-expiry');
    r.check('appeal-expiry relayed through the API', true, 'accepted');
  } catch (e) {
    const why = (e as Error).message;
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
function settledChecks(r: Run, deal: Deal, stage: string): void {
  const rec = deal.record;
  r.check('both operators serve the same state and event log', rec.operators?.agree === true, rec.operators?.views.map((v) => `${v.origin}: ${v.escrowState}, ${v.events} events`).join('; ') ?? 'no view');
  if (!r.round.chain || !rec.chain) return;
  r.check(`dealOf reads ${stage}`, rec.chain.stage === stage, `${rec.chain.stage}, appeal ${rec.chain.appeal}`);
  r.check('CPP holds nothing for the deal', rec.chain.payment.capturable === '0', `capturable ${r.round.amount(rec.chain.payment.capturable)}, refundable ${r.round.amount(rec.chain.payment.refundable)}`);
  const to = lc(r.round.demo.feeSchedule?.to ?? '');
  const fees = logsOf(rec, 'Transfer').filter((l) => lc(l.args.from) === deal.buyer.address && lc(l.args.to) === to);
  if (deal.operatorFee !== undefined) {
    r.check('the operator fee is paid once', fees.length === 1 && BigInt(fees[0]!.args.amount) === deal.operatorFee, `${fees.length} transfer(s) from the buyer to the fee address ${short(to)}: ${fees.map((f) => r.round.amount(f.args.amount)).join(', ') || 'none'}`);
  }
}

/** The appeal-expiry transaction freed exactly the price from the primary's bond. */
function bondFreedCheck(r: Run, deal: Deal): void {
  if (!r.round.chain) return;
  const primary = lc(deal.terms.adjudication.adjudicator);
  const freed = logsOf(deal.record, 'BondReleased').filter((l) => lc(l.args.adjudicator) === primary);
  const total = freed.reduce((s, l) => s + BigInt(l.args.amount), 0n);
  r.check("the primary's bond is freed after the appeal window", total === BigInt(deal.terms.price.amount), `BondReleased for ${short(primary)}: ${r.round.amount(total)} in ${freed.length} log(s)`);
}

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
    r.check('the published try.mjs is the repository bundle', published !== null && sha(published) === sha(bundle), `${round.o.tryBundleUrl}: ${published ? sha(published).slice(0, 12) : `HTTP ${res.status}`}, site/try.mjs: ${sha(bundle).slice(0, 12)}`);
  }
  for (const relay of [0, 1]) {
    const ops = [...round.operators.slice(relay), ...round.operators.slice(0, relay)];
    const out = await new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn(process.execPath, ['--input-type=module', '-', ...(round.o.trySeller ? ['--seller', round.o.trySeller] : [])], { cwd: here('.'), env: { ...process.env, HOLDBACK_OPERATORS: ops.join(',') } });
      let text = '';
      child.stdout.on('data', (d: Buffer) => (text += d.toString()));
      child.stderr.on('data', (d: Buffer) => (text += d.toString()));
      child.on('exit', (code) => resolve({ code, out: text }));
      child.stdin.end(bundle);
    });
    const done = /^done +commitment (0x[0-9a-f]{64}) (\w+)$/m.exec(out.out);
    r.check(`the homepage command passes relayed by ${new URL(ops[0]!).origin}`, out.code === 0 && done?.[2] === 'Released', done ? `${short(done[1]!)} ${done[2]}, exit ${out.code}` : `exit ${out.code}: ${out.out.trim().split('\n').at(-1)}`);
    if (done) r.notes.push(`homepage command relayed by ${new URL(ops[0]!).origin}: ${done[1]} ${done[2]}`);
  }
}

/** An appeal through the API: the appellant's own approval for its bond on a chain, then prepare, verify, sign. */
async function appeal(r: Run, deal: Deal, who: 'buyer' | 'seller'): Promise<J> {
  const { round } = r;
  const agent = who === 'buyer' ? deal.buyer : deal.seller;
  const { rulebook } = await agent.club(round.demo.clubId);
  const prepared = await agent.call('POST', '/v1/prepare/appeal', { commitmentId: deal.id, appellant: agent.address });
  return agent.signAndSubmit(prepared, { kind: 'appeal', terms: deal.terms, me: agent.address, appealBondRateBps: rulebook.appealBondRateBps });
}

/** The appeal bond the club's rulebook sets for the deal: its rate of the price, rounded up. */
async function appealBond(r: Run, deal: Deal): Promise<bigint> {
  const { rulebook } = await deal.buyer.club(r.round.demo.clubId);
  return (BigInt(deal.terms.price.amount) * BigInt(rulebook.appealBondRateBps) + 9_999n) / 10_000n;
}

/** Polls every operator until each reports one of `states` as the appeal state; stops once the decision deadline passes. */
async function untilAppeal(r: Run, deal: Deal, states: string[], timeoutMs: number): Promise<J> {
  let seen: J[] = [];
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(1000)) {
    seen = await Promise.all(deal.buyer.sources().map((api) => deal.buyer.call('GET', `/v1/commitments/${deal.id}`, undefined, api)));
    if (seen.every((s) => states.includes(s.appealState))) return seen[0];
    const by = seen[0]?.deadlines?.appealDecideBy;
    if (by && (await deal.buyer.settlementNow()) > Date.parse(by) + 30_000) throw new Error(`${short(deal.id)}: the appeal adjudicator did not decide by appealDecideBy ${by} (appeal ${seen.map((s) => s.appealState).join(' / ')})`);
  }
  throw new Error(`${short(deal.id)} appeal still ${seen.map((s) => s.appealState).join(' / ')} after ${timeoutMs / 1000} s, waiting for ${states.join(' or ')}`);
}

/** A scenario the driver does not build yet: recorded as waiting for its prerequisites, then for the driver's own work. */
const waiting = (id: string, title: string, waitsFor: string[], needs: string): Scenario => ({
  id, title, waitsFor, needs,
  async run(r) {
    await requires(r, waitsFor);
    r.waitsFor = ['T-216'];
    throw new Waits(r.waitsFor, `not built in the driver yet: ${needs}`);
  },
});

export const SCENARIOS: Scenario[] = [
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
        if (via === 'api' || round.t220) await until(r, deal.buyer, deal.id, ['Refunded'], 120_000).catch((e) => r.note(`the operators' view: ${(e as Error).message}`));
        await finish(r, deal);
        r.check(`${via}: the buyer gets the price and the adjudication fee back`, delta(deal.record, buyer) === -(deal.operatorFee ?? 0n), `buyer ${round.amount(delta(deal.record, buyer))} (the operator fee is never refunded)`);
        if (round.chain && deal.record.chain) {
          r.check(`${via}: dealOf reads Refunded`, deal.record.chain.stage === 'Refunded', deal.record.chain.stage);
          r.check(`${via}: CPP holds nothing for the deal`, deal.record.chain.payment.capturable === '0', `capturable ${round.amount(deal.record.chain.payment.capturable)}`);
          const primary = lc(deal.terms.adjudication.adjudicator);
          const freed = logsOf(deal.record, 'BondReleased').filter((l) => lc(l.args.adjudicator) === primary).reduce((s, l) => s + BigInt(l.args.amount), 0n);
          r.check(`${via}: the primary's bond is freed`, freed === BigInt(PRICE), `BondReleased ${round.amount(freed)}`);
        }
        if (via === 'api' || round.t220) r.check(`${via}: both operators show Refunded and agree`, deal.record.operators?.agree === true && deal.record.operators.views.every((v) => v.escrowState === 'Refunded'), deal.record.operators?.views.map((v) => v.escrowState).join(' / ') ?? '');
        else deal.record.notes.push(`The operators show ${deal.record.operators?.views.map((v) => v.escrowState).join(' / ')} after the direct reclaim: they follow direct calls once T-218 is live (run with --t220); the money settled on chain.`);
      }
    },
  },
  waiting('3b', 'Timeouts: the default outcome when primary and fallback are silent (API)', ['T-221'], "the round's own primary and fallback adjudicators, registered through the API, that accept and never decide (e2e-adjudicator, after T-221 merges)"),
  waiting('3c', 'Timeouts: appeal expiry when the appeal adjudicator is silent (API)', ['T-221'], "the round's own primary deciding by script and its own silent appeal adjudicator; the appellant's bond approval from its own Sepolia ETH"),
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
  waiting('4', 'Fallback when the primary is silent (API)', ['T-217', 'T-221'], "the round's own silent primary with demo fallback and appeal adjudicators; then check the fallback decision's beacon is drand-quicknet at the round of judgeBy"),
  waiting('5a', 'Escalation, then the default outcome (API)', [], 'a checks-only delivery that exhausts the check work budget on purpose, so the primary escalates with no panel; try it on a fork first (T-216, scenario 5)'),
  waiting('5b', 'Escalation decided by the appeal adjudicator (API)', ['T-217'], 'a rubric delivery that trips the screen without being an attack fixture, so the primary escalates (D27c); then the five-seat appeal panel with a drand proof'),
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
        const deal = await openDeal(r, { label: shape.label, template: 'checks-only', deliverable: DATASET, checks: CHECKS, price: PRICE, timing: windows }, [buyer, seller, primary]);
        await fund(r, deal);
        const bond = await appealBond(r, deal);
        await ensureFunds(r, shape.appellant, bond);
        await refreshBefore(r, deal, round.address(shape.appellant));
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
        const refused = await appeal(r, deal, shape.favoured).then(() => 'accepted', (e: Error) => e.message);
        r.check(`${shape.appellant}: the favoured party's appeal is refused`, /invalid_terms/.test(refused), refused);
        await appeal(r, deal, shape.appellant);
        r.say(`${shape.appellant} filed an appeal with a ${round.amount(bond)} bond`);
        const decided = await untilAppeal(r, deal, ['upheld', 'overturned'], 600_000);
        await finish(r, deal);
        r.check(`${shape.appellant}: the appeal is upheld and the first outcome stands`, decided.appealState === 'upheld' && decided.escrowState === shape.outcome, `${decided.escrowState}, appeal ${decided.appealState}`);
        r.check(`${shape.appellant}: the appellant loses its bond`, delta(deal.record, round.address(shape.appellant)) <= -bond, `${shape.appellant} ${round.amount(delta(deal.record, round.address(shape.appellant)))}`);
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
  waiting('7', 'Appeal overturned both ways, paid from the first decider\'s bond (API)', ['T-217', 'T-221'], "the round's own primary, registered and bonded, deciding wrongly by script (accept failing work; reject passing work); a demo appeal adjudicator overturns; check BondSlashed pays the appellant the price"),
  waiting('8', 'The escape hatch: direct calls on API deals', ['T-218', 'T-217', 'T-221'], 'direct agreeAndFund (the acceptance from adjudicator.accepted, the ERC-3009 funding signature) and direct deliver, with the delivery then posted to an operator; a direct reclaim (3a covers the call); a direct triggerFallback over the round\'s silent primary; check submittedVia "direct" with the transaction on both operators within one pass'),
  waiting('9', 'Early accept before the primary decides (API)', ['T-221'], "the round's own silent primary; the buyer opens its envelope from the seller's signed delivery and accepts early (agent.earlyAccept); a later decision by the primary is refused"),
  {
    id: '10',
    title: 'Mutual settlement (API)',
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
      r.note("The second half of scenario 10, a settlement after delivery, needs the round's own silent primary (T-221) so it lands before a decision.");
    },
  },
  waiting('11', 'A restart between broadcast and receipt (live holdback-op1 redeploy)', ['T-219'], "the driver pauses after a relayed broadcast and before its receipt; Rafa redeploys holdback-op1 with the same code at that moment; then check the step's events and the buyer's key are served"),
];

/** A scenario by its ID ("1", "3a"), or every one for "all". */
export function pick(ids: readonly string[]): Scenario[] {
  if (ids.includes('all')) return SCENARIOS;
  return ids.map((id) => {
    const s = SCENARIOS.find((x) => x.id === id);
    if (!s) throw new Error(`no scenario ${id}; the scenarios are ${SCENARIOS.map((x) => x.id).join(', ')}`);
    return s;
  });
}
