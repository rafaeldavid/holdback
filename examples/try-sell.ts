// One seller-started deal on the Crow demo (T-441), the goal of benchmark scenarios s3 and s6. Test tokens only.
//
// The seller, with fresh keys, sells to Crow's test buyer: the faucet admits it to the demo club, it reads the buyer's
// card, offers a checks-only deal on Crow naming the buyer (site/ref/http-seller.txt, "Offer"), posts the commitment
// ID to the buyer's intake, delivers the work encrypted once every operator shows Held, and reads the outcome. It is
// paid at its own signing address: the offer names no separate payout address, so the terms' sellerPayoutAddress is
// the seller's address.
//
// What it sells:
//   --sample customers   (the default) 3 rows of customer_id,email for 25 tUSDC, under three checks
//   --sample robot-log   one robot run's data log for 10 tUSDC, a CSV with one row per joint reading, under five
//                        checks that state its format: the four columns, 6 to 600 rows, one reading per joint and
//                        time, no empty position, and a joint name from base, shoulder, elbow and wrist
//   --work <file> --terms <file>   your own work, and a JSON file {"price": "<base units>", "deliverable":
//                        {"kind", "description", "format"}, "checks": [...]}; the test buyer takes 1 to 10 checks,
//                        at least one required, and a price of at most 50 tUSDC
//   --outcome refund     deliver work that fails a check (the samples only), to see the buyer refunded
//
// It calls only the two operators and the test buyer, keeps its keys in memory and reads only the two files you name.
// Exit 0 when the deal ends as asked (Released, or Refunded with --outcome refund), 3 when it refuses to sign, 1
// otherwise.
//
//   node try-sell.mjs [--buyer <url>] [--sample customers|robot-log] [--work <file> --terms <file>] [--outcome refund]
//   node examples/try-sell.ts ...   from the repository
import { readFileSync, statSync } from 'node:fs';
import type { Hex } from 'viem';
import { at, chainLines, connect, faucet, flags, fromParty, plain, run, say, short, sleep, TEST_BUYER, until, Unavailable, type J } from './goal-kit.ts';

const option = flags([
  "try-sell: sells work to Crow's test buyer under deterministic checks, with fresh keys and test tokens only. --sample robot-log sells a robot's joint log; --work and --terms sell your own; --outcome refund delivers work that fails a check.",
  'usage: node try-sell.mjs [--buyer <test buyer URL>] [--sample customers|robot-log] [--work <file> --terms <file>] [--outcome release|refund]',
  'example: node try-sell.mjs --sample robot-log',
], ['--buyer', '--sample', '--work', '--terms', '--outcome']);
const BUYER = (option('--buyer') ?? TEST_BUYER).replace(/\/+$/, '');
const OUTCOME = option('--outcome') ?? 'release';

const JOINTS = ['base', 'shoulder', 'elbow', 'wrist'];
const ROBOT_COLUMNS = ['t_ms', 'joint', 'position_rad', 'torque_nm'];
const robotRows = (times: number[]) => [ROBOT_COLUMNS.join(','), ...times.flatMap((t) => JOINTS.map((j, i) => `${t},${j},${((t + i) / 100).toFixed(3)},${(1.5 + i / 10).toFixed(2)}`))].join('\n') + '\n';
/** The two samples: what is sold, under which checks, and the work that passes them and the work that fails one. */
const SAMPLES: Record<string, { price: string; deliverable: J; checks: J[]; good: string; bad: string; says: string }> = {
  customers: {
    price: '25000000',
    deliverable: { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' },
    checks: [
      { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
      { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
      { id: 'uniq', type: 'unique_key', required: true, columns: ['customer_id'] },
    ],
    good: 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n3,grace@example.com\n',
    bad: 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n',
    says: '3 rows of customer_id,email',
  },
  'robot-log': {
    price: '10000000',
    deliverable: { kind: 'dataset', description: 'robot-log.csv: one pick-and-place run, one row per joint reading', format: 'text/csv' },
    checks: [
      { id: 'format', type: 'csv_columns_exact', required: true, columns: ROBOT_COLUMNS },
      { id: 'rows', type: 'row_count_range', required: true, min: 6, max: 600 },
      { id: 'one-reading', type: 'unique_key', required: true, columns: ['t_ms', 'joint'] },
      { id: 'positions', type: 'null_rate_max', required: true, column: 'position_rad', maxBps: 0 },
      { id: 'joints', type: 'regex_match_rate_min', required: true, column: 'joint', pattern: '^(base|shoulder|elbow|wrist)$', minBps: 10000 },
    ],
    good: robotRows([0, 20, 40]),
    bad: robotRows([0]), // 4 readings: the rows check (6 to 600) fails
    says: "one robot run's data log, 12 joint readings",
  },
};
/** The windows it offers: 10 minutes to agree, 15 to fund, the work due within the hour, one minute per judging window. */
const TIMING = { offerExpiresInSec: 600, fundWithinSec: 900, deliverWithinSec: 3600, judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 };
/** The largest file it reads with --work or --terms: 1 MiB. */
const MAX_FILE = 1 << 20;

/** The sample or your own files: price, deliverable, checks and the bytes to deliver. */
function whatToSell(): { price: string; deliverable: J; checks: J[]; work: Uint8Array; says: string } {
  const work = option('--work'), termsFile = option('--terms'), sample = option('--sample');
  if ((work === undefined) !== (termsFile === undefined)) throw new Error('--work and --terms go together: the work to deliver and the JSON file with its price, deliverable and checks');
  if (work !== undefined) {
    if (sample !== undefined || OUTCOME !== 'release') throw new Error('--work and --terms take neither --sample nor --outcome: the checks you wrote decide');
    for (const f of [work, termsFile!]) if (!(statSync(f).size <= MAX_FILE)) throw new Error(`${plain(f)} is over ${MAX_FILE} bytes`);
    const t = JSON.parse(readFileSync(termsFile!, 'utf8'));
    if (!/^[0-9]{1,30}$/.test(String(t?.price)) || typeof t?.deliverable?.kind !== 'string' || typeof t?.deliverable?.format !== 'string' || !Array.isArray(t?.checks)) throw new Error(`${plain(termsFile)} must be {"price": "<base units>", "deliverable": {"kind", "description", "format"}, "checks": [...]}`);
    return { price: String(t.price), deliverable: t.deliverable, checks: t.checks, work: new Uint8Array(readFileSync(work)), says: `${plain(work, 80)} (${statSync(work).size} bytes)` };
  }
  const s = SAMPLES[sample ?? 'customers'];
  if (!s) throw new Error(`--sample is customers or robot-log, not ${plain(sample)}`);
  if (OUTCOME !== 'release' && OUTCOME !== 'refund') throw new Error(`--outcome is release or refund, not ${plain(OUTCOME)}`);
  return { price: s.price, deliverable: s.deliverable, checks: s.checks, work: new TextEncoder().encode(OUTCOME === 'refund' ? s.bad : s.good), says: s.says };
}

await run(async () => {
  const started = Date.now();
  console.log("Crow seller deal with Crow's test buyer: test tokens only, nothing here is real money");
  if (!/^https?:\/\/\S+$/.test(BUYER)) throw new Error('--buyer takes the test buyer URL, such as https://crow.direct/agents/test-buyer');
  const sale = whatToSell();
  at('keys');
  const w = await connect();
  const seller = w.fresh();
  say(`seller ${short(seller.address)}: fresh keys, held in memory only; paid at this address (no separate payout address)`);
  at('faucet');
  await faucet(w, seller);

  at('buyer');
  const card = (await fromParty(`${BUYER}/agent.json`)).body;
  if (card?.type !== 'crow-buyer' || !/^0x[0-9a-fA-F]{40}$/.test(card.buyer ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(card.buyerEncryptionPublicKey ?? '')) throw new Unavailable(`${plain(BUYER)}/agent.json is not a crow-buyer card with an address and an encryption key`);
  if (new URL(card.intake?.api ?? 'x:').origin !== new URL(BUYER).origin) throw new Unavailable(`the card's intake is not on ${new URL(BUYER).origin}`);
  const buyer = String(card.buyer).toLowerCase();
  say(`Crow's test buyer at ${plain(BUYER)}: it buys from ${short(buyer)}`);

  at('offer'); // the operator fills the terms; the seller rebuilds them from its request before signing (verify.ts)
  const { id, terms } = await seller.offer({
    template: 'checks-only', clubId: w.clubId, seller: seller.address,
    buyer: { address: buyer, encryptionPublicKey: card.buyerEncryptionPublicKey },
    adjudicators: w.adjudicators, price: { token: w.pin.token.id, amount: sale.price }, deliverable: sale.deliverable, checks: sale.checks, timing: TIMING,
  });
  say(`${short(id)} offered: ${sale.says} for ${w.tusd(sale.price)}, checks ${sale.checks.map((c: J) => plain(c.id, 40)).join(', ')}`);
  at('post');
  const posted = await fetch(card.intake.api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commitmentId: id }), signal: AbortSignal.timeout(15_000) });
  const answer: J = await posted.json().catch(() => null);
  if (posted.status !== 202 && posted.status !== 200) throw new Error(`the test buyer answered ${posted.status}: ${plain(answer?.error)}${answer?.rule ? ` (rule ${plain(answer.rule, 60)})` : ''}`);
  say('the test buyer took the offer: it agrees and funds once the adjudicator accepts');

  at('held');
  await until(seller, id as Hex, ['Held'], 5 * 60_000, 2000);
  say('Held on every operator: the test buyer agreed and funded');
  at('deliver');
  const delivered = await seller.deliver(terms, sale.work);
  say(`${plain(delivered.escrowState, 40)}: ${sale.work.length} bytes, encrypted to the buyer and the three adjudicators`);

  at('outcome');
  const done = await until(seller, id as Hex, ['Released', 'Refunded'], 300_000, 2000);
  try {
    const j = await seller.call('GET', `/v1/commitments/${id}/judgment`);
    say(`${done.escrowState}: checks ${j.deterministic.map((c: J) => `${plain(c.checkId, 40)} ${c.passed ? 'pass' : 'FAIL'}`).join(', ')}; decision ${plain(j.aggregate?.decision, 20)}`);
  } catch {
    say(`${done.escrowState}: no judgment record served`);
  }
  // The buyer's own status, as a party reports it: informative only; the operators' state above is what settled.
  for (let i = 0; i < 10; i += 1, await sleep(2000)) {
    const s = (await fromParty(`${BUYER}/status/${id}`).catch(() => null))?.body;
    if (s && !['accepted', 'funded'].includes(s.status)) {
      say(`the test buyer reports ${plain(s.status, 20)}${s.detail ? `: ${plain(s.detail, 200)}` : ''}`);
      break;
    }
  }
  const expected = OUTCOME === 'refund' ? 'Refunded' : 'Released';
  if (done.escrowState !== expected) throw new Error(`the deal ended ${done.escrowState}, not ${expected}`);
  at('balances');
  say(`seller ${w.tusd(await seller.trusted(`/v1/balances/${seller.address}`, (x) => x.amount))}`);
  await chainLines(w, seller, id as Hex);
  at('final');
  say(`${done.escrowState} in ${Math.round((Date.now() - started) / 1000)} s with Crow's test buyer as the other party`);
  at('done');
  say(`commitment ${id} ${done.escrowState}`);
});
