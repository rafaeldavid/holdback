// One missed deadline and the buyer's reclaim on the Crow demo (T-441), the goal of benchmark scenario s5. Test
// tokens only.
//
// The buyer, with fresh keys, buys Crow's test seller's offer `customers-3-silent`: the dataset's terms with the work
// due 5 minutes after the offer, and a seller that never delivers. It checks the offer on both operators, agrees and
// funds, then waits for `deliverBy` and sends the reclaim itself (`POST /v1/commitments/<id>/triggers/reclaim`, no
// signature). The contract compares `deliverBy` with the timestamp of the block the reclaim lands in, not with this
// machine's clock, so a reclaim sent a few seconds after `deliverBy` can still answer 409; it then tries again every
// 10 s. The operators also send the reclaim on their own a minute or two after `deliverBy`; whichever lands first
// counts. The price and the adjudication fee come back; the operator fee does not. About 6 to 8 minutes in all.
//
// It calls only the two operators and the test seller, keeps its keys in memory and writes no files. Exit 0 when the
// hold came back (Refunded), 3 when it refuses to sign, 1 otherwise.
//
//   node try-reclaim.mjs [--seller <url>]   the bundle at https://crow.direct/try-reclaim.mjs
//   node examples/try-reclaim.ts ...         from the repository
import type { Hex } from 'viem';
import { at, checkOffer, chainLines, connect, faucet, flags, fund, plain, requestOffer, run, say, sellerCard, short, sleep, TEST_SELLER, type J } from './goal-kit.ts';

const option = flags([
  "try-reclaim: buys from Crow's test seller an offer it never delivers, waits for the delivery deadline and reclaims the hold, with fresh keys and test tokens only. Takes 6 to 8 minutes.",
  'usage: node try-reclaim.mjs [--seller <test seller URL>]',
  'example: node try-reclaim.mjs',
], ['--seller']);
const SELLER = (option('--seller') ?? TEST_SELLER).replace(/\/+$/, '');
const NAME = 'customers-3-silent';
/** The most this command pays in all, price and fees: 30 tUSDC. */
const MAX_TOTAL = 30_000_000n;
/** The windows it accepts: the work due within 10 minutes of the offer, so the hold comes back soon. */
const WINDOWS = { deliverBy: 600, judge: 60, fallback: 60, appealWindow: 0, appealDecide: 60 };
/** How long after deliverBy it keeps trying before it gives up: 10 minutes. */
const GIVE_UP_MS = 600_000;

await run(async () => {
  const started = Date.now();
  console.log("Crow missed-deadline deal with Crow's test seller: test tokens only, nothing here is real money");
  if (!/^https?:\/\/\S+$/.test(SELLER)) throw new Error('--seller takes the intake URL, such as https://crow.direct/agents/test-seller');
  at('keys');
  const w = await connect();
  const buyer = w.fresh();
  say(`buyer ${short(buyer.address)}: fresh keys, held in memory only`);
  at('faucet');
  await faucet(w, buyer);

  at('seller');
  const { card, seller } = await sellerCard(SELLER);
  const t = (card.offers ?? []).find((o: J) => o?.id === NAME)?.terms;
  if (!t?.price || !t.deliverable || !Array.isArray(t.checks)) throw new Error(`the test seller's card lists no offer ${NAME}`);
  if (t.price.token !== w.pin.token.id) throw new Error(`the offer is priced in ${plain(t.price.token)}, not ${w.pin.token.id}`);
  say(`offer ${NAME} from ${short(seller)}: the seller never delivers, so the hold comes back at the deadline`);

  at('propose');
  const proposal = {
    type: 'crow-proposal', offer: NAME, buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, want: '3 rows of customer_id,email, due in 5 minutes',
    budget: { token: t.price.token, amount: t.price.amount, covers: 'price' },
    terms: { price: t.price, deliverable: t.deliverable, template: t.template, disclosure: 'public', checks: t.checks },
  };
  const id: Hex = await requestOffer(buyer, card, seller, proposal, 'try-reclaim.mjs');
  // A checks-only deal: the checks alone decide, and the terms carry an empty rubric.
  const terms = await checkOffer(w, buyer, id, seller, { price: t.price, deliverable: t.deliverable, checks: t.checks, rubric: { criteria: [], passThreshold: 0 }, windows: WINDOWS });
  await fund(w, buyer, terms, MAX_TOTAL);

  at('wait');
  const deliverBy = Date.parse(terms.timing.deliverBy);
  say(`nothing is delivered; deliverBy is ${terms.timing.deliverBy}, judged by the block's timestamp, ${Math.max(0, Math.round((deliverBy - (await buyer.settlementNow())) / 1000))} s from now by settlement time`);
  let done: J;
  let tries = 0;
  for (const end = Date.now() + Math.max(0, deliverBy - (await buyer.settlementNow())) + GIVE_UP_MS; ; await sleep(10_000)) {
    const states = await Promise.all(buyer.sources().map((api) => buyer.call('GET', `/v1/commitments/${id}`, undefined, api)));
    if (states.every((s) => s.escrowState === 'Refunded')) {
      done = states[0];
      break;
    }
    if (states.some((s) => s.escrowState !== 'Held' && s.escrowState !== 'Refunded')) throw new Error(`the deal moved to ${states.map((s) => s.escrowState).join(' / ')}, not Refunded`);
    if (Date.now() > end) throw new Error(`still ${states.map((s) => s.escrowState).join(' / ')} ${Math.round(GIVE_UP_MS / 60_000)} minutes after deliverBy`);
    if ((await buyer.settlementNow()) < deliverBy) continue;
    at('reclaim');
    tries += 1;
    try {
      const r = await buyer.call('POST', `/v1/commitments/${id}/triggers/reclaim`, {});
      say(`reclaim sent (try ${tries}): ${plain(r.escrowState, 40)}`);
    } catch (e) {
      // 409: the block the reclaim would land in is not yet past deliverBy, or a reclaim is already on its way.
      say(`reclaim not taken yet (try ${tries}): ${plain((e as Error).message, 200)}; trying again in 10 s`);
    }
  }
  at('refunded');
  say(`Refunded on every operator: the price and the adjudication fee came back to the buyer's payment address; the operator fee did not`);
  at('balances');
  say(`buyer ${w.tusd(await buyer.trusted(`/v1/balances/${buyer.address}`, (x) => x.amount))}`);
  await chainLines(w, buyer, id);
  at('final');
  say(`${done.escrowState} by the reclaim in ${Math.round((Date.now() - started) / 1000)} s with Crow's test seller as the other party`);
  at('done');
  say(`commitment ${id} ${done.escrowState}`);
});
