// Round 1's escalation group (T-216): the scenarios where the primary escalates and the appeal adjudicator decides
// alone, or the default outcome applies (docs/api.md, Escalation). e2e-scenarios.ts registers this list; its tests go
// in e2e-scenarios-escalation.test.ts.
//
// - 5a: a checks-only deal whose check runs out of the check work budget on purpose. The primary escalates with no
//   panel; the appeal adjudicator runs the same check under the same budget, escalates again and signs nothing
//   (signedOutcome); after appealDecideBy the `default` trigger refunds the buyer.
// - 5b: a rubric deal whose honest translation carries soft hyphens from a word processor. The screen flags the hidden
//   characters, so the primary's panel escalates (D27c); the appeal adjudicator's five-seat panel then accepts or
//   rejects (D27a/b), seeded from the beacon round after the escalation, and its decision is final at once.
import { keccak256, parseAbi, toBytes, type Hex } from 'viem';
import { STAGES } from './e2e-chain.ts';
import { buyerKeys, buyerOpens, delta, deliver, eventsOf, finish, fund, get, logsOf, openDeal, reason, retry, short, shortWindows, sleep, trigger, until, waitPast, type Deal, type Run } from './e2e-run.ts';
import { appeal } from './e2e-scenarios-appeal.ts';
import { checksLine, judgment, lc, paidCheck, PRICE, requires, RUBRIC, settledChecks, TRANSLATION, type J, type Scenario } from './e2e-scenario-kit.ts';

/** 5a's dataset: one row per customer with the account manager's notes. */
export const NOTES = { kind: 'dataset', description: 'notes.csv, one row per customer with the account notes', format: 'text/csv' };

/**
 * 5a's checks. `notes` is a pattern of 4,001 NFA states whose 2,000 character states are all live on every character
 * (each `.*` may match nothing), so the matcher spends 2,002 units of the check work budget a character. Three
 * 10,000-character cells need about 60 million units; a delivery gets 50 million across all its checks (CHECK_BUDGET in
 * packages/judgment/src/checks/index.ts), so the check runs out in the third cell. It is then inconclusive, neither
 * passed nor failed, and the adjudicator escalates without a panel (aggregate.ts). The other two checks pass, since a
 * required check that fails rejects before an inconclusive one escalates.
 */
export const BUDGET_CHECKS = [
  { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'notes'] },
  { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
  { id: 'notes', type: 'regex_match_rate_min', required: true, column: 'notes', pattern: '(.*){1000}(.*){1000}', minBps: 10_000 },
];
/** The safe-regex engine matches no cell longer than this (MAX_SUBJECT_CHARS), so each cell is exactly this long. */
const CELL_CHARS = 10_000;
const NOTE = 'Prefers email; renews each spring; asks for invoices in euros and a call before each renewal. ';
/** 5a's delivery: three rows whose notes run to 10,000 characters each, with no comma or quote. */
export const NOTES_CSV = `customer_id,notes\n${[1, 2, 3].map((i) => `${i},${NOTE.repeat(Math.ceil(CELL_CHARS / NOTE.length)).slice(0, CELL_CHARS)}`).join('\n')}\n`;

/**
 * 5b's delivery: the faithful French of scenario 1, pasted from a word processor that hyphenates, so four soft hyphens
 * (U+00AD) sit inside three long words. Readers never see them; the screen strips and counts them as hidden characters
 * and flags the delivery (zero_width). Not an attack fixture: no instruction, no encoding, nothing aimed at a judge.
 */
const SHY = String.fromCodePoint(0xad); // the soft hyphen, written as a code point so the source shows where it sits
export const FRENCH_SOFT_HYPHENS = `Les mar${SHY}chan${SHY}dises sont expédiées mardi. Le paie${SHY}ment est dû dans les 30 jours suivant la livrai${SHY}son.`;

const BEACON_ABI = parseAbi(['function roundAt(uint256 t) pure returns (uint64)']);
const OUTCOMES = ['accept', 'reject', 'escalate'] as const;
const ROLES = ['primary', 'fallback', 'appeal'] as const;

/**
 * The judgment.decided events each operator serves for the deal, as [operator origin, events]. The appeal adjudicator's
 * decision on an escalation is one too, with role `appeal`, on SimChain and on a chain alike.
 */
async function decisions(deal: Deal): Promise<Array<{ origin: string; events: J[] }>> {
  return Promise.all(deal.buyer.sources().map(async (api) => ({ origin: new URL(api).origin, events: (await eventsOf(deal.buyer, deal.id, api)).filter((e) => e.type === 'judgment.decided') })));
}
const by = (events: J[], who: string) => events.filter((e) => lc(String(e.actor)) === lc(who));
const decidedLine = (seen: Array<{ origin: string; events: J[] }>) => seen.map((s) => `${s.origin}: ${s.events.map((e) => `${short(String(e.actor))} ${e.payload?.role} ${e.payload?.outcome}`).join(', ') || 'none'}`).join('; ');

/** The envelopes each operator serves to `recipient` at the key read. */
const keysFor = (deal: Deal, recipient: string): Promise<number[]> => Promise.all(deal.buyer.sources().map(async (api) => (await get(deal.buyer, `/v1/commitments/${deal.id}/key?recipient=${recipient}`, api)).items.length));

/** Each operator's state read. */
const states = (deal: Deal): Promise<J[]> => Promise.all(deal.buyer.sources().map((api) => get(deal.buyer, `/v1/commitments/${deal.id}`, api)));

/** The record names the budget: `notes` inconclusive, no panel, and the escalation's reason. */
const ranOut = (j: J | null) =>
  j?.aggregate?.decision === 'escalate' && j.panel?.ran === false && (j.deterministic ?? []).some((c: J) => c.checkId === 'notes' && /budget/.test(c.detail ?? '')) && /check work budget ran out: notes/.test((j.aggregate.reasons ?? []).join(' '));
const recordLine = (j: J | null) => (j ? `${j.role}'s record: checks ${checksLine(j)}; ${j.aggregate?.decision}: ${(j.aggregate?.reasons ?? []).join('; ')}` : 'no judgment record served');

/** How long past appealDecideBy 5b waits for the appeal decision to show on both operators before it closes the deal. */
const PAST_DEADLINE_SEC = 30;

/** Each operator's state once all show Released or Refunded, or null once settlement time is PAST_DEADLINE_SEC past `deadline`. */
async function settledOrPast(deal: Deal, deadline: string): Promise<J | null> {
  for (;;) {
    const views = await states(deal);
    if (views.every((v) => v.escrowState === 'Released' || v.escrowState === 'Refunded') && views.every((v) => v.escrowState === views[0].escrowState)) return views[0];
    if ((await retry(() => deal.buyer.settlementNow())) > Date.parse(deadline) + PAST_DEADLINE_SEC * 1000) return null;
    await sleep(2000);
  }
}

/** Polls the judgment record until the appeal adjudicator's is served, or settlement time passes `until`. */
async function appealRecord(deal: Deal, untilIso: string): Promise<J | null> {
  for (;;) {
    const rec = await judgment(deal);
    if (rec?.role === 'appeal') return rec;
    if ((await retry(() => deal.buyer.settlementNow())) > Date.parse(untilIso)) return null;
    await sleep(2000);
  }
}

/** The decide calls of the deal's transactions, with their Decision struct (`args[1]`). */
const decides = (deal: Deal) => deal.record.transactions.flatMap((t) => t.calls.filter((c) => c.fn === 'decide').map((c) => ({ block: t.block, m: c.args?.[1] ?? {} })));

/** On a chain: the primary decided escalate (a Decided log). The phase-one contracts hold no bond (ADR-0031 §8). */
function escalationOnChain(r: Run, deal: Deal): void {
  const primary = lc(deal.terms.adjudication.adjudicator);
  const decided = logsOf(deal.record, 'Decided');
  const mine = decided.filter((l) => lc(l.args.adjudicator) === primary);
  r.check("the primary's decision on chain is an escalation", mine.length === 1 && ROLES[Number(mine[0]!.args.role)] === 'primary' && OUTCOMES[Number(mine[0]!.args.outcome)] === 'escalate', mine.map((l) => `Decided by ${short(l.args.adjudicator)}: ${ROLES[Number(l.args.role)]} ${OUTCOMES[Number(l.args.outcome)]}`).join('; ') || 'no Decided log names the primary');
}

/**
 * 5a's deal, after its prerequisites (none): a check out of budget escalates at both instances, nobody signs, and the
 * default outcome refunds the buyer.
 */
async function defaultAfterEscalation(r: Run): Promise<void> {
  const { round } = r;
  const [buyer, seller] = [round.address('buyer'), round.address('seller')];
  const { primary, appeal: appealAdj } = round.demo.adjudicators;
  // The appeal adjudicator's window after the escalation, the parties' choice (D31): room to read the beacon and run
  // the same check again before appealDecideBy. Its round is published only after the escalation plus the contract's
  // BEACON_MARGIN (ADR-0032: 29 s on Sepolia, 0 on anvil), so the window covers the margin as well.
  const margin = round.chain ? await round.chain.beaconMarginSec() : 0;
  const timing = shortWindows(r, { appealDecideSec: Math.max(round.demo.minWindowSec, margin + 20) });
  const deal = await openDeal(r, { label: 'checks-only, a check that runs out of its work budget', template: 'checks-only', deliverable: NOTES, checks: BUDGET_CHECKS, price: PRICE, timing }, [buyer, seller, primary, appealAdj]);
  await fund(r, deal);
  await deliver(r, deal, NOTES_CSV);
  r.step = 'escalate';
  const delivered = Date.now();
  const esc = await until(r, deal.buyer, deal.id, ['Escalated', 'Released', 'Refunded'], 300_000);
  const tookSec = Math.round((Date.now() - delivered) / 1000);
  const first = await judgment(deal);
  r.say(`${esc.escrowState} ${tookSec} s after the delivery; ${recordLine(first)}`);
  if (!r.check('the deal is Escalated on both operators', esc.escrowState === 'Escalated', `${esc.escrowState}, ${tookSec} s after the delivery`)) return;
  r.check('the primary escalates with no panel: the check ran out of its work budget', ranOut(first), recordLine(first));
  const seen = await decisions(deal);
  r.check("both operators record the primary's escalate", seen.every((s) => by(s.events, primary).some((e) => e.payload?.role === 'primary' && e.payload?.outcome === 'escalate')), decidedLine(seen));
  const toAppeal = await keysFor(deal, appealAdj);
  r.check('the escalation envelope reaches the appeal adjudicator', toAppeal.every((n) => n >= 1), `the key read serves ${toAppeal.join(' and ')} envelope(s) to the appeal adjudicator`);
  const appealDecideBy = String(esc.deadlines?.appealDecideBy);

  r.step = 'appeal';
  r.say(`the appeal adjudicator runs the same check under the same budget; waiting for its record, then appealDecideBy ${appealDecideBy}`);
  const second = await appealRecord(deal, appealDecideBy);
  r.check('the appeal adjudicator judges again and escalates for the same reason', ranOut(second), second ? recordLine(second) : `no record from the appeal adjudicator by appealDecideBy ${appealDecideBy}`);
  await waitPast(r, deal.buyer, appealDecideBy);
  const after = await decisions(deal);
  r.check('the appeal adjudicator signs no decision after the escalation', after.every((s) => by(s.events, appealAdj).length === 0), decidedLine(after));
  const still = await states(deal);
  if (!r.check('the deal is still Escalated at appealDecideBy', still.every((s) => s.escrowState === 'Escalated'), still.map((s) => s.escrowState).join(' / '))) return;

  r.step = 'default';
  await trigger(r, deal, 'default');
  // SimChain records the default, then applies it; on chain triggerDefault does both, and apply-default sends nothing.
  await trigger(r, deal, 'apply-default');
  const done = await until(r, deal.buyer, deal.id, ['Refunded'], 120_000);
  r.say(`Refunded: the default outcome after the escalation, settled ${done.settledAt}`);
  await finish(r, deal);

  const price = BigInt(PRICE);
  const fee = BigInt(deal.terms.adjudication.fee.amount);
  const views = await states(deal);
  r.check('the deal ends Refunded by the default outcome', views.every((v) => v.escrowState === 'Refunded'), views.map((v) => v.escrowState).join(' / '));
  r.check('the default is final at once', views.every((v) => v.finalAt && v.finalAt === v.settledAt), views.map((v) => `finalAt ${v.finalAt}, settledAt ${v.settledAt}`).join('; '));
  r.check('the buyer gets the price and the adjudication fee back', delta(deal.record, buyer) === -(deal.operatorFee ?? 0n), `buyer ${round.amount(delta(deal.record, buyer))} (the operator fee is never refunded)`);
  // SimChain pays the seller the rulebook's compensation from the appeal adjudicator's bond, which the escalation
  // reserved; on the contract that is Phase 4 economics (LOCAL_EXCLUSIONS), so it pays nothing.
  const rate = BigInt((await deal.buyer.club(round.demo.clubId)).rulebook.defaultOutcome?.judged?.sellerCompensationRateBps ?? 0);
  const comp = round.chain ? 0n : (price * rate) / 10_000n;
  r.check('the seller gets the default compensation', delta(deal.record, seller) === comp, `seller ${round.amount(delta(deal.record, seller))}, expected ${round.amount(comp)}${round.chain ? ': no compensation from bonds on chain (Phase 4)' : ` (${rate} bps of the price from the appeal adjudicator's bond)`}`);
  if (round.chain) deal.record.notes.push('No seller compensation on chain after a default: Phase 4 economics, recorded, not passed (T-216 non-goals).');
  const keys = await buyerKeys(deal);
  r.check('no key reaches the buyer', keys.every((n) => n === 0), `the key read serves ${keys.join(' and ')} envelope(s) to the buyer`);
  settledChecks(r, deal, 'Refunded');
  if (round.chain) {
    paidCheck(r, deal, 'the price and the adjudication fee return to the buyer on chain', buyer, price + fee);
    escalationOnChain(r, deal);
    const appealLogs = logsOf(deal.record, 'Decided').filter((l) => lc(l.args.adjudicator) === lc(appealAdj));
    r.check('no Decided log names the appeal adjudicator', appealLogs.length === 0, `${appealLogs.length} log(s)`);
    const defaulted = logsOf(deal.record, 'Defaulted');
    r.check('triggerDefault records the default from Escalated', defaulted.length === 1 && STAGES[Number(defaulted[0]!.args.from)] === 'Escalated', defaulted.map((l) => `Defaulted from ${STAGES[Number(l.args.from)]}`).join('; ') || 'no Defaulted log');
  }
}

/**
 * 5b's deal, after its prerequisite (T-217): the screen flags honest work, the primary escalates, and the appeal
 * adjudicator's five-seat panel decides. Its chain checks run first on Sepolia: on anvil the demo world's appeal
 * decision reverts BadSeed (the harness's SimBeacon seed is not the world's), so 5b waits for T-217 there, as 6 does.
 */
async function decidedOnAppeal(r: Run): Promise<void> {
  const { round } = r;
  const [buyer, seller] = [round.address('buyer'), round.address('seller')];
  const { primary, appeal: appealAdj } = round.demo.adjudicators;
  // Room after the escalation for the beacon round, five judges and the decision's block (D31: the parties' choice).
  const timing = shortWindows(r, { appealDecideSec: Math.max(round.demo.minWindowSec, 180) });
  const deal = await openDeal(r, { label: 'rubric deal, soft hyphens in the translation', template: 'default', deliverable: TRANSLATION, rubric: RUBRIC, checks: [], price: PRICE, timing }, [buyer, seller, primary, appealAdj]);
  const notices = ((await deal.buyer.call('GET', `/v1/commitments/${deal.id}`)).notices ?? []) as string[];
  for (const n of notices) r.say(`notice: ${n}`);
  await fund(r, deal);
  await deliver(r, deal, FRENCH_SOFT_HYPHENS);
  r.step = 'escalate';
  const esc = await until(r, deal.buyer, deal.id, ['Escalated', 'Released', 'Refunded'], 600_000);
  const first = await judgment(deal);
  r.say(`${esc.escrowState}; ${first ? `${first.role}'s record: ${first.aggregate?.decision}, ${(first.aggregate?.reasons ?? []).join('; ')}` : 'no judgment record served'}`);
  const seen = await decisions(deal);
  const escalated = seen.every((s) => by(s.events, primary).some((e) => e.payload?.role === 'primary' && e.payload?.outcome === 'escalate'));
  if (!r.check('the primary escalates (D27c)', escalated, decidedLine(seen))) return;
  // The screen runs the same at both instances, so either record shows it; only the primary's names its reason.
  const signals: J[] = first?.screen?.signals ?? [];
  r.check('the screen flags the delivery', first?.screen?.flagged === true && signals.some((s) => s.kind === 'zero_width'), signals.map((s) => `${s.kind}: ${s.detail}`).join('; ') || 'no signal served');
  if (first?.role === 'primary') r.note(`the primary's reasons: ${(first.aggregate?.reasons ?? []).join('; ')}; its panel: ${(first.panel?.members ?? []).map((m: J) => `${m.model} ${m.verdict?.overall ?? m.status}`).join(', ')}`);
  const toAppeal = await keysFor(deal, appealAdj);
  r.check('the escalation envelope reaches the appeal adjudicator', toAppeal.every((n) => n >= 1), `the key read serves ${toAppeal.join(' and ')} envelope(s) to the appeal adjudicator`);

  r.step = 'appeal';
  const appealDecideBy = String(esc.deadlines?.appealDecideBy);
  r.say(`the appeal adjudicator's five-seat panel decides by appealDecideBy ${appealDecideBy}`);
  const done = await settledOrPast(deal, appealDecideBy);
  if (!r.check('the appeal adjudicator decides by appealDecideBy', done !== null, done ? done.escrowState : `still ${(await states(deal)).map((v) => v.escrowState).join(' / ')} ${PAST_DEADLINE_SEC} s after appealDecideBy; the default trigger closes the deal`)) {
    // Nobody may leave the buyer's money held (Decision 12): the default refunds it, as 5a shows.
    await trigger(r, deal, 'default');
    await trigger(r, deal, 'apply-default');
    await until(r, deal.buyer, deal.id, ['Refunded'], 120_000);
    await finish(r, deal);
    return;
  }
  const record = await judgment(deal);
  const members: J[] = record?.panel?.members ?? [];
  const decision = record?.aggregate?.decision;
  const outcome = done.escrowState === 'Released' ? 'accept' : 'reject';
  r.check("the appeal adjudicator's five-seat panel decides (D27a/b)", record?.role === 'appeal' && members.length === 5 && decision === outcome, `${decision ?? 'no record'} by ${members.length} seats: ${members.map((m) => `${m.model} ${m.verdict?.overall ?? m.status}`).join(', ')}; the deal is ${done.escrowState}`);
  const unanimous = members.length > 0 && members.every((m) => m.verdict?.overall === 'pass' && m.verdict?.injectionSuspected !== true);
  r.check('a flagged escalation is accepted only on a unanimous clean panel (D27a)', outcome === 'reject' || unanimous, `${outcome}: ${(record?.aggregate?.reasons ?? []).join('; ')}`);
  const scripted = members.some((m) => String(m.model).startsWith('placeholder-') || String(m.verdict?.rationale ?? '').startsWith('[fake judge'));
  r.note(scripted ? 'the appeal panel was scripted (no model ran): the live budget was spent or the keys are missing' : `the appeal panel ran ${members.length} live models`);
  const later = await appeal(r, deal, outcome === 'accept' ? 'buyer' : 'seller').then(() => 'accepted', (e: Error) => reason(e));
  r.check('a later appeal is refused (invalid_state)', /invalid_state/.test(later), later);
  if (outcome === 'accept') r.check('the buyer opens the work with its released key', await buyerOpens(r, deal, FRENCH_SOFT_HYPHENS), 'decrypted, sha256 checked against the delivery');
  await finish(r, deal);

  const price = BigInt(PRICE);
  const fee = BigInt(deal.terms.adjudication.fee.amount);
  const views = await states(deal);
  r.check('the decision is final at once', views.every((v) => v.finalAt && v.finalAt === v.settledAt), views.map((v) => `finalAt ${v.finalAt}, settledAt ${v.settledAt}`).join('; '));
  const after = await decisions(deal);
  r.check('both operators record the appeal adjudicator as the decider', after.every((s) => by(s.events, appealAdj).some((e) => e.payload?.role === 'appeal' && e.payload?.outcome === outcome && e.payload?.seedSource === 'beacon')), decidedLine(after));
  if (outcome === 'accept') {
    r.check('the seller is paid the price', delta(deal.record, seller) === price, `seller ${round.amount(delta(deal.record, seller))}`);
    r.check('the buyer pays the price, the adjudication fee and the operator fee', delta(deal.record, buyer) === -(price + fee + (deal.operatorFee ?? 0n)), `buyer ${round.amount(delta(deal.record, buyer))}`);
  } else {
    r.check('the buyer gets the price back; the adjudication and operator fees are spent', delta(deal.record, buyer) === -(fee + (deal.operatorFee ?? 0n)), `buyer ${round.amount(delta(deal.record, buyer))}`);
    r.check('the seller is paid nothing', delta(deal.record, seller) === 0n, `seller ${round.amount(delta(deal.record, seller))}`);
    const keys = await buyerKeys(deal);
    r.check('no key reaches the buyer', keys.every((n) => n === 0), `the key read serves ${keys.join(' and ')} envelope(s) to the buyer`);
  }
  settledChecks(r, deal, done.escrowState);
  const { chain } = round;
  if (!chain) return;
  escalationOnChain(r, deal);
  paidCheck(r, deal, outcome === 'accept' ? 'the price reaches the seller on chain' : 'the price returns to the buyer on chain', outcome === 'accept' ? seller : buyer, price);
  const feePaid = logsOf(deal.record, 'FeePaid');
  r.check('the adjudication fee goes to the appeal adjudicator', feePaid.length === 1 && lc(feePaid[0]!.args.adjudicator) === lc(appealAdj) && BigInt(feePaid[0]!.args.amount) === fee, feePaid.map((l) => `${round.amount(l.args.amount)} to ${short(l.args.adjudicator)}`).join('; ') || 'no FeePaid log');
  const toBuyer = logsOf(deal.record, 'KeyReleased').filter((l) => lc(l.args.recipient) === buyer);
  r.check(outcome === 'accept' ? 'the key reaches the buyer on chain' : 'no KeyReleased log names the buyer', toBuyer.length === (outcome === 'accept' ? 1 : 0), `${toBuyer.length} KeyReleased log(s) to the buyer`);
  // The appeal adjudicator's seed: the first beacon round after the escalation's block time plus the contract's
  // BEACON_MARGIN (HoldbackRules._escalationRound, ADR-0032: 29 s on Sepolia, 0 on anvil), proven as the rulebook's
  // beacon: a 48-byte BLS signature on drand quicknet, an empty proof on the sim beacon (anvil only).
  const all = decides(deal);
  const escalation = all.find((d) => ROLES[Number(d.m.role)] === 'primary');
  const final = all.find((d) => ROLES[Number(d.m.role)] === 'appeal');
  const source = String((await deal.buyer.club(round.demo.clubId)).rulebook.randomness?.source ?? 'sim');
  let detail = 'no escalation or no appeal decision among the transactions';
  let ok = false;
  if (escalation && final) {
    const at = (await chain.client.getBlock({ blockNumber: BigInt(escalation.block) })).timestamp;
    const margin = BigInt(await chain.beaconMarginSec());
    const expected = Number(await chain.client.readContract({ address: chain.deployment.beacon as Hex, abi: BEACON_ABI, functionName: 'roundAt', args: [at + margin] })) + 1;
    const sigBytes = (String(final.m.beaconSignature ?? '0x').length - 2) / 2;
    const proof = source === 'drand-quicknet' ? sigBytes === 48 : sigBytes === 0;
    ok = Number(final.m.beaconRound) === expected && lc(String(final.m.beaconSourceHash)) === keccak256(toBytes(source)) && proof;
    detail = `beacon round ${final.m.beaconRound}, the first round after the escalation at ${at} s + the margin ${margin} s is ${expected}; source ${source}${lc(String(final.m.beaconSourceHash)) === keccak256(toBytes(source)) ? '' : ' (the decision names another)'}; proof ${sigBytes} bytes`;
  }
  r.check("the appeal decision is seeded from the first beacon round after the escalation plus the margin, proven as the rulebook's beacon", ok, detail);
}

export const ESCALATION: Scenario[] = [
  {
    id: '5a',
    title: 'Escalation, then the default outcome (API)',
    waitsFor: [],
    run: defaultAfterEscalation,
  },
  {
    id: '5b',
    title: 'Escalation decided by the appeal adjudicator (API)',
    waitsFor: ['T-217'],
    async run(r) {
      await requires(r, ['T-217']);
      await decidedOnAppeal(r);
    },
  },
];
