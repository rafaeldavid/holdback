// One rubric-judged purchase on the Crow demo (T-441), the goal of benchmark scenario s2. Test tokens only.
//
// The buyer, with fresh keys, buys Crow's test seller's offer `summary-judged`: a 40-to-120-word summary of the
// payment hold, judged first by one deterministic check (no hidden characters) and then by the operators' live panel
// of pinned models from two families against the offer's rubric (two criteria, `accurate` and `complete`). It reads
// the offer from the seller's card on the seller's own domain, proposes exactly those terms, checks the offer on both
// operators against them, prints the rubric, agrees and funds, waits for the panel, and opens the text. With
// --outcome refund it buys `summary-judged-fails`, whose text the panel rejects, to see the price come back.
//
// It calls only the two operators and the test seller, keeps its keys in memory and writes no files. Exit 0 when the
// deal ends as asked (Released, or Refunded with --outcome refund), 3 when it refuses to sign, 1 otherwise.
//
//   node try-judged.mjs [--seller <url>] [--outcome release|refund]   the bundle at https://crow.direct/try-judged.mjs
//   node examples/try-judged.ts ...                                    from the repository
import type { Hex } from 'viem';
import { at, checkOffer, chainLines, connect, faucet, flags, fund, plain, requestOffer, run, say, sellerCard, short, TEST_SELLER, until, type J } from './goal-kit.ts';

const option = flags([
  "try-judged: buys a short text from Crow's test seller that a live judge panel grades against a rubric, with fresh keys and test tokens only. --outcome refund buys the text the panel rejects.",
  'usage: node try-judged.mjs [--seller <test seller URL>] [--outcome release|refund]',
  'example: node try-judged.mjs',
], ['--seller', '--outcome']);
const SELLER = (option('--seller') ?? TEST_SELLER).replace(/\/+$/, '');
const OUTCOME = option('--outcome') ?? 'release';
/** The most this command pays in all, price and fees: 20 tUSDC. */
const MAX_TOTAL = 20_000_000n;
/** The windows it accepts from the test seller, in seconds: the seller's published ones. */
const WINDOWS = { offer: 1800, fund: 2400, deliverBy: 3600, judge: 60, fallback: 60, appealWindow: 0, appealDecide: 60 };

await run(async () => {
  const started = Date.now();
  console.log("Crow rubric-judged deal with Crow's test seller: test tokens only, nothing here is real money");
  if (OUTCOME !== 'release' && OUTCOME !== 'refund') throw new Error(`--outcome is release or refund, not ${plain(OUTCOME)}`);
  if (!/^https?:\/\/\S+$/.test(SELLER)) throw new Error('--seller takes the intake URL, such as https://crow.direct/agents/test-seller');
  at('keys');
  const w = await connect();
  const buyer = w.fresh();
  say(`buyer ${short(buyer.address)}: fresh keys, held in memory only`);
  at('faucet');
  await faucet(w, buyer);

  at('seller');
  const { card, seller } = await sellerCard(SELLER);
  const name = OUTCOME === 'refund' ? 'summary-judged-fails' : 'summary-judged';
  const offer = (card.offers ?? []).find((o: J) => o?.id === name);
  const t = offer?.terms;
  if (!t?.rubric || !Array.isArray(t.rubric.criteria) || !t.price || !t.deliverable) throw new Error(`the test seller's card lists no judged offer ${name} with a rubric`);
  if (t.price.token !== w.pin.token.id) throw new Error(`the offer is priced in ${plain(t.price.token)}, not ${w.pin.token.id}`);
  say(`offer ${name} from ${short(seller)}: ${plain(t.deliverable.description, 160)}...`);
  say(`rubric: ${t.rubric.criteria.map((c: J) => `${plain(c.id, 40)} (weight ${Number(c.weight)})`).join(', ')}; passes at ${Number(t.rubric.passThreshold)}, scores 0 to 4 per criterion, weighted`);

  at('propose');
  const proposal = {
    type: 'crow-proposal', offer: name, buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, want: 'a short summary of the payment hold, judged against the rubric',
    budget: { token: t.price.token, amount: t.price.amount, covers: 'price' },
    terms: { price: t.price, deliverable: t.deliverable, template: t.template, disclosure: 'public', checks: t.checks, rubric: t.rubric },
  };
  const id: Hex = await requestOffer(buyer, card, seller, proposal, 'try-judged.mjs');
  const terms = await checkOffer(w, buyer, id, seller, { price: t.price, deliverable: t.deliverable, checks: t.checks, rubric: t.rubric, windows: WINDOWS });
  await fund(w, buyer, terms, MAX_TOTAL);

  at('judge');
  say('the test seller delivers once every operator shows Held; the check runs, then the panel reads the text against the rubric');
  const done = await until(buyer, id, ['Released', 'Refunded'], 300_000, 2000);
  at('outcome');
  try {
    const j = await buyer.call('GET', `/v1/commitments/${id}/judgment`);
    const members = (j.panel?.members ?? []).map((m: J) => `${plain(m.model ?? m.modelId ?? 'judge', 60)} ${plain(m.verdict?.overall, 10)}`);
    say(`${done.escrowState}: checks ${j.deterministic.map((c: J) => `${plain(c.checkId, 40)} ${c.passed ? 'pass' : 'FAIL'}`).join(', ')}; panel ${members.join(', ') || 'none recorded'}; decision ${plain(j.aggregate?.decision, 20)}`);
  } catch {
    say(`${done.escrowState}: no judgment record served`);
  }
  const expected = OUTCOME === 'refund' ? 'Refunded' : 'Released';
  if (done.escrowState !== expected) throw new Error(`the deal ended ${done.escrowState}, not ${expected}`);
  if (done.escrowState === 'Released') {
    at('open');
    const text = await buyer.openDelivery(id);
    say(`the buyer decrypted its copy, sha256 checked: ${text.trim().split(/\s+/).length} words: ${plain(text, 600)}`);
  } else {
    at('refund');
    say('the price came back to the buyer; no key was released, so the seller keeps the text. The adjudication and operator fees do not come back');
  }
  at('balances');
  say(`buyer ${w.tusd(await buyer.trusted(`/v1/balances/${buyer.address}`, (x) => x.amount))}`);
  await chainLines(w, buyer, id);
  at('final');
  say(`${done.escrowState} in ${Math.round((Date.now() - started) / 1000)} s with Crow's test seller as the other party`);
  at('done');
  say(`commitment ${id} ${done.escrowState}`);
});
