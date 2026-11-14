// The scripted agent of scenario s6 (T-412): a robot fleet's agent sells one run's data log to Crow's test buyer, and
// the log's agreed format is the deal's checks: four named columns, a bounded number of rows, one reading per joint and
// time, no empty position, and a joint name from a fixed list. It follows apps/test-agents/src/sell-once.ts step for
// step (faucet, the buyer's card, discovery, offer, post, Held, deliver, the buyer's status), with its own deliverable
// and checks, against the in-process world bench.mjs serves. It ends with `done      commitment <id> Released`.
//
//   HOLDBACK_OPERATORS=<url>,<url> CROW_TEST_BUYER=<buyer base URL> node --experimental-transform-types tools/one-click/scripted/robot-log.ts
import { randomBytes } from 'node:crypto';
import { Agent } from '../../../examples/agent.ts';
import { knownPins } from '../../../examples/verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const operators = (process.env['HOLDBACK_OPERATORS'] ?? '').split(',').filter(Boolean);
const base = process.env['CROW_TEST_BUYER'] ?? '';
const pin = knownPins()[0]!; // SimChain: a scripted run settles only in the in-process world
const buyer = (path: string, init?: RequestInit) => fetch(`${base}${path}`, init);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PRICE_UNITS = '10000000'; // 10 test dollars, 6 decimals
const DELIVERABLE = { kind: 'dataset', description: 'robot-log.csv: one pick-and-place run, one row per joint reading', format: 'text/csv' };
const COLUMNS = ['t_ms', 'joint', 'position_rad', 'torque_nm'];
const CHECKS = [
  { id: 'format', type: 'csv_columns_exact', required: true, columns: COLUMNS },
  { id: 'rows', type: 'row_count_range', required: true, min: 6, max: 600 },
  { id: 'one-reading', type: 'unique_key', required: true, columns: ['t_ms', 'joint'] },
  { id: 'positions', type: 'null_rate_max', required: true, column: 'position_rad', maxBps: 0 },
  { id: 'joints', type: 'regex_match_rate_min', required: true, column: 'joint', pattern: '^(base|shoulder|elbow|wrist)$', minBps: 10000 },
];
const TIMING = { offerExpiresInSec: 600, fundWithinSec: 900, deliverWithinSec: 3600, judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 };
const JOINTS = ['base', 'shoulder', 'elbow', 'wrist'];
const LOG = [COLUMNS.join(','), ...[0, 20, 40].flatMap((t) => JOINTS.map((j, i) => `${t},${j},${((t + i) / 100).toFixed(3)},${(1.5 + i / 10).toFixed(2)}`))].join('\n') + '\n';

try {
  const seller = new Agent(operators, `0x${randomBytes(32).toString('hex')}`, new Uint8Array(randomBytes(32)), pin.domain, pin.chain);
  const card: J = await (await buyer('/agent.json')).json();
  if (card?.type !== 'crow-buyer' || !/^0x[0-9a-f]{40}$/.test(card.buyer)) throw new Error('the buyer card is not a crow-buyer card with an address');
  console.log(`buyer     ${card.buyer}`);
  await seller.call('POST', '/v1/faucet', { address: seller.address });
  const found = await seller.trusted('/.well-known/holdback.json', (x: J) => ({ clubId: x.demo?.clubId, adjudicators: x.demo?.adjudicators }));
  const role = (r: string) => found.adjudicators.find((a: J) => a.role === r).address as string;
  const { id, terms } = await seller.offer({
    template: 'checks-only', clubId: found.clubId, seller: seller.address,
    buyer: { address: card.buyer, encryptionPublicKey: card.buyerEncryptionPublicKey },
    adjudicators: { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') },
    price: { token: pin.token.id, amount: PRICE_UNITS }, deliverable: DELIVERABLE, checks: CHECKS, timing: TIMING,
  });
  console.log(`offered   ${id}: one robot run's data log, ${LOG.trim().split('\n').length - 1} readings`);
  const posted = await buyer('/offers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commitmentId: id }) });
  const answer: J = await posted.json();
  if (posted.status !== 202 && posted.status !== 200) throw new Error(`the test buyer answered ${posted.status}: ${answer.error} (rule ${answer.rule})`);
  await seller.waitFor(id, ['Held'], 120_000);
  console.log('held      the test buyer agreed and funded');
  await seller.deliver(terms, new TextEncoder().encode(LOG));
  console.log('deliver   the log, in the agreed format');
  let status: J;
  for (const end = Date.now() + 120_000; Date.now() < end; await sleep(500)) {
    status = await (await buyer(`/status/${id}`)).json();
    if (!['accepted', 'funded'].includes(status.status)) break;
  }
  if (status?.status !== 'released') throw new Error(`the deal ended ${status?.status}, not released`);
  console.log(`done      commitment ${id} Released`);
} catch (e) {
  console.log(`stopped at: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
