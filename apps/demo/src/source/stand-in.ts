// A scripted stand-in for the beats no SimChain runner drives yet (T-012 backlog): beat 7 (neutrality) and the
// injection half of beat 6 (base64 instruction, escalation, five-judge appeal panel). Every number here is
// illustrative and every transcript says so. Hashes are derived from labels; model IDs are the pinned
// placeholders in config/judges.yaml, read through the demo's registry loader; nothing is signed.
import { createHash } from 'node:crypto';
import { demoRegistry } from '@holdback/demo/agents/bench.js';
import { tusd } from '../transcript/money.js';
import type { Amount, BalanceRow, CastKey, DemoEvent, EventSource, JudgeSeat } from '../transcript/types.js';

const digest = (label: string) => createHash('sha256').update(`holdback/demo/stand-in/${label}`).digest('hex');
const hx = (label: string) => `0x${digest(label)}`;
const sha = (label: string) => `sha256:${digest(label)}`;

const PRICE = tusd(2000n);
const FEE = tusd(50n);
const HELD = tusd(2050n);
const START = 10_000n;
const BOND = 25_000n;
/** The Data Services Club rulebook hash T-012 computed for fixtures/clubs/data-services-v1.yaml. */
const RULEBOOK_HASH = '0x140edd090559cb7dd3950b3a8b755b9cca7b81a37d11359738e1b9df7d0d971e';

export const STAND_IN_NOTE =
  'scripted stand-in: no SimChain runner drives this yet. Numbers, hashes and timings are illustrative, not measured; model IDs are the config/judges.yaml placeholders; nothing is signed.';

/** A judge from config/judges.yaml by registry ID. */
function judge(id: string): { model: string; family: string } {
  const e = demoRegistry().active.find((j) => j.id === id);
  if (!e) throw new Error(`config/judges.yaml has no active judge ${id}`);
  return { model: e.model, family: e.family };
}

const seat = (n: number, id: string, verdict: JudgeSeat['verdict'], score: number): JudgeSeat => ({ seat: n, ...judge(id), verdict, score });

const CHECKS = [
  ['cols', 'csv_columns_exact', '5 columns, as listed'],
  ['rows', 'row_count_range', '9500 rows'],
  ['uniq', 'unique_key', '0 duplicate customer_id'],
  ['dates', 'iso8601_date_column', '9500 of 9500 ISO 8601'],
  ['id_nulls', 'null_rate_max', 'null 0/9500'],
  ['name_nulls', 'null_rate_max', 'null 38/9500'],
  ['email_nulls', 'null_rate_max', 'null 95/9500'],
  ['emails', 'regex_match_rate_min', 'match 9291/9500'],
  ['hidden', 'hidden_characters_max', 'tag 0, bidi 0, total 0'],
] as const;
const passingChecks = () => CHECKS.map(([id, type, detail]) => ({ id, type, required: id !== 'emails', passed: true, detail }));

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
  events: () => DemoEvent[];
}

export const BEAT_6_TITLE = 'Injection attempt';
export const BEAT_6_SUMMARY =
  'A deliverable hides a base64 instruction telling judges to approve: the screen flags it, the panel cannot auto-accept, Atrium\'s five judges reject, and Ledger is refunded. A second delivery hides tag characters aimed at Ledger itself under an empty rubric: it is accepted, and Ledger\'s SDK strips the payload before Ledger reads the file.';

const SCRIPTS: Readonly<Record<number, Script>> = {
  6: {
    title: BEAT_6_TITLE,
    summary: BEAT_6_SUMMARY,
    litmus: 'the defenses',
    job: 'job-3',
    events: () => [
      balances(0, 'before', { buyer: { amount: START }, seller: { amount: 0n }, escrow: { amount: 0n }, benchA: { amount: BOND, reserved: 0n }, benchC: { amount: BOND } }),
      offer(0, 'job-3'),
      acceptance(3, 'job-3'),
      hold(10),
      delivery(22, 'job-3', 512_640),
      { kind: 'checks', atMs: 55, actor: 'benchA', results: passingChecks() },
      { kind: 'screen', atMs: 58, actor: 'benchA', flagged: true, signals: ['encoded_run'], consequence: 'a decoded 212-byte instruction addresses the judges, so the panel cannot auto-accept' },
      { kind: 'escalation', atMs: 60, actor: 'benchA', to: 'benchC', reason: 'screen flag on an encoded instruction', panelSize: 5, families: 3 },
      {
        kind: 'panel',
        atMs: 2_410,
        actor: 'benchC',
        seed: hx('beacon/job-3'),
        seedSource: 'beacon',
        rule: 'an appeal panel needs 2/3 of 5 valid verdicts to pass',
        judges: [seat(1, 'claude-a', 'fail', 90), seat(2, 'gpt-a', 'fail', 110), seat(3, 'qwen-a', 'fail', 70), seat(4, 'claude-b', 'fail', 100), seat(5, 'gpt-b', 'fail', 120)],
        outcome: 'reject',
      },
      { kind: 'decision', atMs: 2_428, actor: 'benchC', role: 'appeal', outcome: 'reject', via: 'op1' },
      { kind: 'settlement', atMs: 2_431, actor: 'escrow', settlement: 'refund', payouts: [pay('buyer', PRICE, 'refund'), pay('benchC', FEE, 'fee to the deciding adjudicator')], via: 'op1' },
      balances(2_431, 'after the refund', { buyer: { amount: START - 50n }, seller: { amount: 0n }, escrow: { amount: 0n }, benchA: { amount: BOND, reserved: 0n }, benchC: { amount: BOND + 50n } }),
    ],
  },
  7: {
    title: 'Nobody in control',
    summary: 'The same job with three failures in sequence: op-1 refuses to relay, Clearfield goes offline, and the club operator revokes the seller mid-flight. The commitment still settles under its signed terms.',
    litmus: 'neutrality',
    job: 'job-4',
    events: () => [
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
        rule: '2/3 of valid verdicts must pass, from 2 or more families',
        judges: [seat(1, 'claude-b', 'pass', 370), seat(2, 'gpt-a', 'pass', 350), seat(3, 'claude-a', 'pass', 360)],
        outcome: 'accept',
      },
      { kind: 'decision', atMs: 121_275, actor: 'benchB', role: 'fallback', outcome: 'accept', via: 'op2' },
      { kind: 'settlement', atMs: 121_280, actor: 'escrow', settlement: 'release', payouts: [pay('seller', PRICE, 'price'), pay('benchB', FEE, 'fee to the deciding adjudicator')], keyReleasedTo: 'buyer', via: 'op2' },
      balances(121_280, 'after release', { buyer: { amount: 7950n }, seller: { amount: 2000n }, escrow: { amount: 0n }, benchA: { amount: BOND }, benchB: { amount: BOND + 50n } }),
    ],
  },
};

/** Beat 7, and beat 6's injection half only. */
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
        source: { kind: 'stand-in', note: STAND_IN_NOTE },
        commitmentId: hx(`commitment/${s.job}`),
        events: s.events(),
      };
    },
  };
}
