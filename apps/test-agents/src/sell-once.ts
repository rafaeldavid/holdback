// One seller-started deal with Crow's test buyer (T-239), played by an outside seller with a fresh key: the faucet
// admits it, it reads the buyer's card, offers 3 rows of customer_id,email on Crow naming the buyer (site/ref/intake.txt,
// "Sell to Crow's test buyer"), posts the commitment ID, delivers once the deal is Held, and reads the outcome.
// scripts/sell-to-test-buyer.mjs runs it against the live operators; buyer.test.ts runs it in process.
import nacl from 'tweetnacl';
import type { Hex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import { Agent } from '../../../examples/agent.ts';
import type { Pin } from '../../../examples/verify.ts';
import { BAD_CSV, CHECKS, DELIVERABLE, GOOD_CSV, PRICE_UNITS } from './catalog.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** release: work that passes the checks; refund: work that fails the rows check; reclaim: no delivery at all. */
export type SellOutcome = 'release' | 'refund' | 'reclaim';

export interface SellOnceOptions {
  operators: string[];
  pin: Pin;
  /** A request to the buyer, by path under its base URL (such as "/agent.json"). */
  buyer: (path: string, init?: RequestInit) => Promise<Response>;
  outcome?: SellOutcome;
  /** The windows the seller offers; the default delivers within an hour, judged in a minute. */
  timing?: Record<string, number>;
  /** How long to wait for the buyer's final status, in ms. Default 10 minutes. */
  timeoutMs?: number;
  log?: (line: string) => void;
}

const TIMING = { offerExpiresInSec: 600, fundWithinSec: 900, deliverWithinSec: 3600, judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 }; // phase one: no party appeal (ADR-0033 §2b)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sellOnce(o: SellOnceOptions): Promise<{ id: Hex; status: J }> {
  const log = o.log ?? ((l) => console.log(l));
  const outcome = o.outcome ?? 'release';
  const seller = new Agent(o.operators, generatePrivateKey(), nacl.randomBytes(32), o.pin.domain, o.pin.chain);
  const card: J = await (await o.buyer('/agent.json')).json();
  if (card?.type !== 'crow-buyer' || !/^0x[0-9a-f]{40}$/.test(card.buyer)) throw new Error('the buyer card is not a crow-buyer card with an address');
  log(`test buyer ${card.buyer}; seller ${seller.address}, fresh keys held in memory only`);
  const grant = await seller.call('POST', '/v1/faucet', { address: seller.address });
  log(`faucet: the seller is admitted to ${grant.clubId}`);
  const found = await seller.trusted('/.well-known/holdback.json', (x) => ({ clubId: x.demo?.clubId, adjudicators: x.demo?.adjudicators }));
  const role = (r: string) => found.adjudicators.find((a: J) => a.role === r).address as string;
  const { id, terms } = await seller.offer({
    template: 'checks-only', clubId: found.clubId, seller: seller.address,
    buyer: { address: card.buyer, encryptionPublicKey: card.buyerEncryptionPublicKey },
    adjudicators: { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') },
    price: { token: o.pin.token.id, amount: PRICE_UNITS }, deliverable: DELIVERABLE, checks: CHECKS, timing: o.timing ?? TIMING,
  });
  log(`offered ${id}: 3 rows of customer_id,email for 25 ${o.pin.token.symbol}`);
  const posted = await o.buyer('/offers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commitmentId: id }) });
  const answer: J = await posted.json();
  if (posted.status !== 202 && posted.status !== 200) throw new Error(`the test buyer answered ${posted.status}: ${answer.error} (rule ${answer.rule})`);
  log('the test buyer took the offer');
  await seller.waitFor(id, ['Held'], 5 * 60_000);
  log('Held: the test buyer agreed and funded');
  if (outcome !== 'reclaim') {
    await seller.deliver(terms, new TextEncoder().encode(outcome === 'refund' ? BAD_CSV : GOOD_CSV));
    log(`delivered ${outcome === 'refund' ? '2 rows, which fail the rows check' : '3 rows that pass every check'}`);
  } else {
    log(`no delivery: the test buyer reclaims after deliverBy, ${terms.timing.deliverBy}`);
  }
  const want = outcome === 'release' ? 'released' : outcome === 'refund' ? 'refunded' : 'reclaimed';
  let status: J;
  for (const end = Date.now() + (o.timeoutMs ?? 10 * 60_000); Date.now() < end; await sleep(2000)) {
    status = await (await o.buyer(`/status/${id}`)).json();
    if (!['accepted', 'funded'].includes(status.status)) break;
  }
  log(`${id}: ${status?.status}${status?.detail ? `: ${status.detail}` : ''}`);
  for (const t of status?.transactions ?? []) log(`  ${t.step}: ${t.url ?? t.tx}`);
  if (status?.status !== want) throw new Error(`the deal ended ${status?.status}, not ${want}`);
  return { id, status };
}
