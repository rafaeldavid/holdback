// A scripted stand-in event source. It lets the narration, renderers and viewer be built and tested while
// T-012's SimChain beat runner (PR 45) is in flight, and covers beats that runner does not drive yet.
// Every number here is illustrative and every transcript says so. Hashes are derived from labels, not from
// real data; model IDs are placeholders until the Bench registrations land; nothing is signed.
import { createHash } from 'node:crypto';
import { tusd } from '../transcript/money.js';
import type { Amount, BalanceRow, CastKey, DemoEvent, EventSource, JudgeSeat } from '../transcript/types.js';

const digest = (label: string) => createHash('sha256').update(`holdback/demo/stand-in/${label}`).digest('hex');
const hx = (label: string) => `0x${digest(label)}`;
const sha = (label: string) => `sha256:${digest(label)}`;
const address = (who: string) => `0x${digest(`address/${who}`).slice(0, 40)}`;

const PRICE = tusd(2000n);
const FEE = tusd(50n);
const HELD = tusd(2050n);
const START = 10_000n;
const BOND = 25_000n;
/** The Data Services Club rulebook hash T-012 computed for fixtures/clubs/data-services-v1.yaml. */
const RULEBOOK_HASH = '0x140edd090559cb7dd3950b3a8b755b9cca7b81a37d11359738e1b9df7d0d971e';

const NOTE = 'scripted stand-in. Numbers, hashes and timings are illustrative, not measured; model IDs are placeholders; T-012\'s SimChain beat runner replaces this source.';

/** Placeholder pinned IDs: two Claude judges and one from another family, as docs/demo.md describes Bench A. */
const MODELS = {
  claudeA: { model: 'claude-opus-5-5-20260601', family: 'anthropic' },
  claudeB: { model: 'claude-haiku-5-20260601', family: 'anthropic' },
  otherA: { model: 'gemini-4-pro-001', family: 'google' },
  otherB: { model: 'gemini-4-flash-001', family: 'google' },
  thirdA: { model: 'mistral-large-2611', family: 'mistral' },
} as const;

const seat = (n: number, m: { model: string; family: string }, verdict: JudgeSeat['verdict'], score: number): JudgeSeat => ({ seat: n, ...m, verdict, score });

const CHECKS_PASS = [
  ['cols', 'csv_columns_exact', '5 columns, as listed'],
  ['rows', 'row_count_range', '9,500 rows; allowed 9,400 to 9,600'],
  ['uniq', 'unique_key', '0 duplicate customer_id'],
  ['dates', 'iso8601_date_column', '9,500 of 9,500 ISO 8601'],
  ['id_nulls', 'null_rate_max', '0 bps; max 0'],
  ['name_nulls', 'null_rate_max', '40 bps; max 100'],
  ['email_nulls', 'null_rate_max', '100 bps; max 200'],
  ['emails', 'regex_match_rate_min', '9,780 bps; min 9,700'],
  ['hidden', 'hidden_characters_max', '0 tag, 0 bidi'],
] as const;

const passingChecks = (except: string[] = []) =>
  CHECKS_PASS.filter(([id]) => !except.includes(id)).map(([id, type, detail]) => ({ id, type, required: id !== 'emails', passed: true, detail }));

/** Balances for the parties that matter in a beat, in whole tUSD. */
type Ledger = Partial<Record<CastKey, { amount: bigint; reserved?: bigint }>>;
const rows = (l: Ledger): BalanceRow[] =>
  (Object.entries(l) as [CastKey, { amount: bigint; reserved?: bigint }][]).map(([who, v]) => ({
    who,
    amount: tusd(v.amount),
    ...(v.reserved === undefined ? {} : { reserved: tusd(v.reserved) }),
  }));
const balances = (atMs: number, label: string, l: Ledger): DemoEvent => ({ kind: 'balances', atMs, actor: 'chain', label, rows: rows(l) });

const offer = (atMs: number, job: string): DemoEvent => ({
  kind: 'offer',
  atMs,
  actor: 'seller',
  commitmentId: hx(`commitment/${job}`),
  price: PRICE,
  fee: FEE,
  primary: 'benchA',
  fallback: 'benchB',
  appeal: 'benchC',
  disclosure: 'public',
});
const acceptance = (atMs: number, job: string): DemoEvent => ({ kind: 'acceptance', atMs, actor: 'benchA', bondReserved: PRICE, seedCommitment: hx(`seed-commitment/${job}`) });
const hold = (atMs: number, via: 'op1' | 'op2' = 'op1'): DemoEvent => ({ kind: 'hold', atMs, actor: 'buyer', amount: HELD, via });
const delivery = (atMs: number, job: string, bytes: number, via: 'op1' | 'op2' | 'direct' = 'op1'): DemoEvent => ({
  kind: 'delivery',
  atMs,
  actor: 'seller',
  deliveryHash: hx(`delivery/${job}`),
  plaintextSha256: sha(`plaintext/${job}`),
  ciphertextBytes: bytes,
  keyRecipients: ['benchA'],
  via,
});
const pay = (to: CastKey, amount: Amount, reason: string) => ({ to, amount, reason });

interface Script {
  title: string;
  summary: string;
  litmus: string;
  job: string;
  events: DemoEvent[];
}

const SCRIPTS: Readonly<Record<number, Script>> = {
  1: {
    title: 'Choose, agree and hold',
    summary: 'Tide-7 offers terms naming three adjudicators the two agents chose; Clearfield accepts and reserves bond; Ledger holds price plus fee in one call.',
    litmus: 'the agents choose the adjudicator; the hold; machine speed',
    job: 'job-1',
    events: [
      balances(0, 'before', { buyer: { amount: START }, seller: { amount: 0n }, escrow: { amount: 0n }, benchA: { amount: BOND, reserved: 0n } }),
      offer(0, 'job-1'),
      acceptance(4, 'job-1'),
      {
        kind: 'signed',
        atMs: 9,
        actor: 'buyer',
        messageType: 'FundingAuthorization',
        signer: address('buyer'),
        body: {
          type: 'FundingAuthorization',
          scheme: 'erc3009',
          commitmentId: hx('commitment/job-1'),
          from: address('buyer'),
          value: HELD.amount,
          token: 'tUSD',
          validAfter: '2026-11-01T09:00:00Z',
          validBefore: '2026-11-01T09:30:00Z',
          nonce: hx('nonce/job-1/funding'),
          expiresAt: '2026-11-01T09:30:00Z',
        },
        signature: 'stand-in, not signed: the SimChain runner supplies the EIP-712 signature',
      },
      hold(11),
      balances(11, 'after hold', { buyer: { amount: START - 2050n }, seller: { amount: 0n }, escrow: { amount: 2050n }, benchA: { amount: BOND, reserved: 2000n } }),
    ],
  },
  2: {
    title: 'Deliver without revealing',
    summary: 'Tide-7 uploads the cleaned CSV encrypted. Ledger sees only hashes; the content key is sealed to Clearfield.',
    litmus: 'the two-sided hold: money and work',
    job: 'job-1',
    events: [
      delivery(0, 'job-1', 511_940),
      balances(6, 'after delivery', { buyer: { amount: 7950n }, seller: { amount: 0n }, escrow: { amount: 2050n }, benchA: { amount: BOND, reserved: 2000n } }),
    ],
  },
  3: {
    title: 'Defended judgment',
    summary: 'Deterministic checks pass; the panel seed is revealed; three pinned judges from two families give recorded verdicts; Clearfield accepts.',
    litmus: 'defended multi-model judgment',
    job: 'job-1',
    events: [
      { kind: 'checks', atMs: 38, actor: 'benchA', results: passingChecks() },
      { kind: 'screen', atMs: 41, actor: 'benchA', flagged: false, signals: [], consequence: 'the panel may decide' },
      {
        kind: 'panel',
        atMs: 1_174,
        actor: 'benchA',
        seed: hx('seed/job-1'),
        seedSource: 'commit-reveal',
        threshold: '2/3',
        judges: [seat(1, MODELS.claudeA, 'pass', 380), seat(2, MODELS.claudeB, 'pass', 360), seat(3, MODELS.otherA, 'pass', 340)],
        outcome: 'accept',
      },
      { kind: 'decision', atMs: 1_190, actor: 'benchA', role: 'primary', outcome: 'accept', via: 'op1' },
      balances(1_190, 'at the decision', { buyer: { amount: 7950n }, seller: { amount: 0n }, escrow: { amount: 2050n }, benchA: { amount: BOND, reserved: 2000n } }),
    ],
  },
  4: {
    title: 'Settle',
    summary: 'Funds go to Tide-7 and the content key to Ledger in the same step; Ledger checks the plaintext hash; a receipt is signed.',
    litmus: 'fair exchange',
    job: 'job-1',
    events: [
      { kind: 'settlement', atMs: 1_203, actor: 'escrow', settlement: 'release', payouts: [pay('seller', PRICE, 'price'), pay('benchA', FEE, 'fee')], keyReleasedTo: 'buyer', via: 'op1' },
      { kind: 'finality', atMs: 1_203, actor: 'chain', payee: 'seller', appealWindowSec: 300, bondAtRisk: PRICE, bondHolder: 'benchA' },
      { kind: 'open', atMs: 1_219, actor: 'buyer', plaintextSha256: sha('plaintext/job-1'), matchesDelivery: true, bytes: 511_912 },
      { kind: 'receipt', atMs: 1_224, actor: 'op1', receiptHash: hx('receipt/job-1') },
      balances(1_224, 'after release', { buyer: { amount: 7950n }, seller: { amount: 2000n }, escrow: { amount: 0n }, benchA: { amount: BOND + 50n, reserved: 2000n } }),
    ],
  },
  5: {
    title: 'Bad work',
    summary: 'A second job: the deliverable drops 8% of rows. A required check fails and Ledger is refunded in one step; Tide-7 keeps the work.',
    litmus: 'the hold; delivery versus payment for data',
    job: 'job-2',
    events: [
      balances(0, 'before', { buyer: { amount: START }, seller: { amount: 0n }, escrow: { amount: 0n }, benchA: { amount: BOND, reserved: 0n } }),
      offer(0, 'job-2'),
      acceptance(3, 'job-2'),
      hold(9),
      delivery(21, 'job-2', 471_224),
      {
        kind: 'checks',
        atMs: 52,
        actor: 'benchA',
        results: passingChecks().map((c) => (c.id === 'rows' ? { ...c, passed: false, detail: '8,740 rows; allowed 9,400 to 9,600' } : c)),
      },
      { kind: 'decision', atMs: 58, actor: 'benchA', role: 'primary', outcome: 'reject', via: 'op1' },
      { kind: 'settlement', atMs: 61, actor: 'escrow', settlement: 'refund', payouts: [pay('buyer', PRICE, 'refund'), pay('benchA', FEE, 'fee earned for judging')], via: 'op1' },
      balances(61, 'after refund', { buyer: { amount: START - 50n }, seller: { amount: 0n }, escrow: { amount: 0n }, benchA: { amount: BOND + 50n, reserved: 0n } }),
    ],
  },
  6: {
    title: 'Injection attempt',
    summary:
      'A deliverable hides a base64 instruction telling judges to approve: the screen flags it, the panel cannot auto-accept, Atrium\'s five judges reject, and Ledger is refunded. A second delivery hides tag characters aimed at Ledger itself under an empty rubric: it is accepted, and Ledger\'s SDK strips the payload before Ledger reads the file.',
    litmus: 'the defenses',
    job: 'job-3',
    events: [
      balances(0, 'before', { buyer: { amount: START }, seller: { amount: 0n }, escrow: { amount: 0n }, benchA: { amount: BOND, reserved: 0n }, benchC: { amount: BOND } }),
      offer(0, 'job-3'),
      acceptance(3, 'job-3'),
      hold(10),
      delivery(22, 'job-3', 512_640),
      { kind: 'checks', atMs: 55, actor: 'benchA', results: passingChecks() },
      { kind: 'screen', atMs: 58, actor: 'benchA', flagged: true, signals: ['base64_instruction'], consequence: 'a decoded 212-byte instruction addresses the judges, so the panel cannot auto-accept' },
      { kind: 'escalation', atMs: 60, actor: 'benchA', to: 'benchC', reason: 'screen flag on an encoded instruction', panelSize: 5, families: 3 },
      {
        kind: 'panel',
        atMs: 2_410,
        actor: 'benchC',
        seed: hx('beacon/job-3'),
        seedSource: 'beacon',
        threshold: '2/3',
        judges: [
          seat(1, MODELS.claudeA, 'fail', 90),
          seat(2, MODELS.otherA, 'fail', 110),
          seat(3, MODELS.thirdA, 'fail', 70),
          seat(4, MODELS.claudeB, 'fail', 100),
          seat(5, MODELS.otherB, 'fail', 120),
        ],
        outcome: 'reject',
      },
      { kind: 'decision', atMs: 2_428, actor: 'benchC', role: 'appeal', outcome: 'reject', via: 'op1' },
      { kind: 'settlement', atMs: 2_431, actor: 'escrow', settlement: 'refund', payouts: [pay('buyer', PRICE, 'refund'), pay('benchC', FEE, 'fee to the deciding adjudicator')], via: 'op1' },
      balances(2_431, 'after the first refund', { buyer: { amount: START - 50n }, seller: { amount: 0n }, escrow: { amount: 0n }, benchA: { amount: BOND, reserved: 0n }, benchC: { amount: BOND + 50n } }),
      offer(2_500, 'job-3b'),
      acceptance(2_503, 'job-3b'),
      hold(2_510),
      delivery(2_522, 'job-3b', 512_384),
      { kind: 'checks', atMs: 2_554, actor: 'benchA', results: passingChecks(['hidden']) },
      {
        kind: 'screen',
        atMs: 2_557,
        actor: 'benchA',
        flagged: true,
        signals: ['unicode_tags'],
        consequence: 'recorded in the signed screen report; with an empty rubric and no hidden-character check in the terms, the flag moves no money (ADR-0021)',
      },
      { kind: 'decision', atMs: 2_561, actor: 'benchA', role: 'primary', outcome: 'accept', via: 'op1' },
      { kind: 'settlement', atMs: 2_564, actor: 'escrow', settlement: 'release', payouts: [pay('seller', PRICE, 'price'), pay('benchA', FEE, 'fee')], keyReleasedTo: 'buyer', via: 'op1' },
      { kind: 'open', atMs: 2_580, actor: 'buyer', plaintextSha256: sha('plaintext/job-3b'), matchesDelivery: true, bytes: 512_356, stripped: { what: 'Unicode tag characters', count: 111 } },
      balances(2_580, 'after the second release', {
        buyer: { amount: START - 50n - 2050n },
        seller: { amount: 2000n },
        escrow: { amount: 0n },
        benchA: { amount: BOND + 50n, reserved: 2000n },
        benchC: { amount: BOND + 50n },
      }),
    ],
  },
  7: {
    title: 'Nobody in control',
    summary: 'The same job with three failures in sequence: op-1 refuses to relay, Clearfield goes offline, and the club operator revokes the seller mid-flight. The commitment still settles under its signed terms.',
    litmus: 'neutrality',
    job: 'job-4',
    events: [
      balances(0, 'before', { buyer: { amount: START }, seller: { amount: 0n }, escrow: { amount: 0n }, benchA: { amount: BOND, reserved: 0n }, benchB: { amount: BOND } }),
      offer(0, 'job-4'),
      acceptance(3, 'job-4'),
      {
        kind: 'neutrality',
        atMs: 5,
        actor: 'buyer',
        target: 'op1',
        failure: 'refused',
        consequence: 'Ledger\'s SDK got 1 refusal (HTTP 503) and failed over to op-2 within 9 ms; Tide-7 later submits its signed delivery directly to SimChain, so no operator is required',
        via: 'op2',
      },
      hold(14, 'op2'),
      delivery(30, 'job-4', 511_940, 'direct'),
      {
        kind: 'neutrality',
        atMs: 120_030,
        actor: 'chain',
        target: 'benchA',
        failure: 'offline',
        consequence: 'Clearfield missed judgeBy, 120 s after delivery. Anyone may trigger the fallback; Northgate Review takes over and receives the content key only now',
      },
      {
        kind: 'neutrality',
        atMs: 120_050,
        actor: 'club',
        target: 'club',
        failure: 'revoked',
        consequence: `The club revoked Tide-7's membership. The commitment still settles under the rulebook both agents signed, ${RULEBOOK_HASH.slice(0, 10)}…; revocation blocks only new commitments`,
      },
      { kind: 'checks', atMs: 120_090, actor: 'benchB', results: passingChecks() },
      {
        kind: 'panel',
        atMs: 121_260,
        actor: 'benchB',
        seed: hx('beacon/job-4'),
        seedSource: 'beacon',
        threshold: '2/3',
        judges: [seat(1, MODELS.claudeB, 'pass', 370), seat(2, MODELS.otherA, 'pass', 350), seat(3, MODELS.claudeA, 'pass', 360)],
        outcome: 'accept',
      },
      { kind: 'decision', atMs: 121_275, actor: 'benchB', role: 'fallback', outcome: 'accept', via: 'op2' },
      { kind: 'settlement', atMs: 121_280, actor: 'escrow', settlement: 'release', payouts: [pay('seller', PRICE, 'price'), pay('benchB', FEE, 'fee to the deciding adjudicator')], keyReleasedTo: 'buyer', via: 'op2' },
      balances(121_280, 'after release', { buyer: { amount: 7950n }, seller: { amount: 2000n }, escrow: { amount: 0n }, benchA: { amount: BOND }, benchB: { amount: BOND + 50n } }),
    ],
  },
  10: {
    title: 'Agree without a judge',
    summary: 'A third job. Ledger finds a gap; both agents co-sign a 70/30 split. Ledger gets the key, Clearfield never judges and its reservation is released, and the fee returns to Ledger.',
    litmus: '2-of-3: consent first, adjudicator only on disagreement',
    job: 'job-5',
    events: [
      balances(0, 'before', { buyer: { amount: START }, seller: { amount: 0n }, escrow: { amount: 0n }, benchA: { amount: BOND, reserved: 0n } }),
      offer(0, 'job-5'),
      acceptance(3, 'job-5'),
      hold(10),
      delivery(23, 'job-5', 511_940),
      {
        kind: 'settlement',
        atMs: 41,
        actor: 'escrow',
        settlement: 'mutual',
        payouts: [pay('seller', tusd(1400n), '70% of price'), pay('buyer', tusd(600n), '30% of price'), pay('buyer', FEE, 'fee returned; no adjudicator judged')],
        keyReleasedTo: 'buyer',
        via: 'op1',
      },
      { kind: 'open', atMs: 55, actor: 'buyer', plaintextSha256: sha('plaintext/job-5'), matchesDelivery: true, bytes: 511_912 },
      balances(55, 'after the split', { buyer: { amount: 8600n }, seller: { amount: 1400n }, escrow: { amount: 0n }, benchA: { amount: BOND, reserved: 0n } }),
    ],
  },
};

export function standInSource(): EventSource {
  const beats = Object.keys(SCRIPTS).map(Number).sort((a, b) => a - b);
  return {
    name: 'stand-in',
    beats: () => beats,
    run: async (beat) => {
      const s = SCRIPTS[beat];
      if (!s) throw new RangeError(`the stand-in source has no beat ${beat}; available: ${beats.join(', ')}`);
      return {
        format: 'holdback.demo.transcript/v0',
        beat,
        title: s.title,
        summary: s.summary,
        litmus: s.litmus,
        mode: 'recorded',
        source: { kind: 'stand-in', note: NOTE },
        commitmentId: hx(`commitment/${s.job}`),
        events: structuredClone(s.events),
      };
    },
  };
}
