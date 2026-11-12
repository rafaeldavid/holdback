// Round 1's direct group (T-216): the scenarios that go past the operators or past a relay in flight. Scenario 8 sends
// the escape hatch's calls (ADR-0005) from the round's own keys on deals offered through the API; scenario 11 pauses
// between a relayed broadcast and its receipt while Rafa redeploys holdback-op1 (T-219). e2e-scenarios.ts registers
// this list; its tests are in e2e-scenarios-direct.test.ts.
import { randomBytes, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { concat, hashStruct, keccak256, toBytes, type Hex } from 'viem';
import { RoundAdjudicator } from './e2e-adjudicator.ts';
import { termsTuple, type TxRecord } from './e2e-chain.ts';
import { buyerKeys, buyerOpens, delta, deliver, ensureFunds, eventsOf, finish, fund, get, logsOf, openDeal, reason, refreshBefore, retry, short, shortWindows, sleep, trigger, until, waitPast, Waits, type Deal, type Run } from './e2e-run.ts';
import { CHECKS, CSV, DATASET, PRICE, bondFreedCheck, expireAppeal, here, lc, paidCheck, requires, settledChecks, type J, type Scenario } from './e2e-scenario-kit.ts';
import { ERC3009_TYPES, freshNonce, fundingNonceOf, TYPES, typedOf } from './verify.ts';

/** T-218's target: a direct call shows in the operators' view within one sync pass, 60 s or less. */
const SYNC_PASS_SEC = 60;
/** After Rafa types `deployed`, how long the driver looks for holdback-op1's restart: the Durable Object took up to 44 s to restart after T-220's deploy (docs/operations.md). */
const RESTART_WAIT_MS = 90_000;
const PROBE_EVERY_MS = 5000;

const str = (s: string): Hex => keccak256(toBytes(s));
const secs = (ts: string) => BigInt(Date.parse(ts) / 1000);
const originOf = (api: string) => new URL(api).origin;

/** An EncryptedKey's struct hash, as core encodes it: an absent unlock is an empty kind and round 0. */
const keyHash = (k: J): Hex => hashStruct({ types: TYPES, primaryType: 'EncryptedKey', data: { recipient: k.recipient, scheme: k.scheme, ciphertext: k.ciphertext, unlock: { kind: k.unlock?.kind ?? '', round: BigInt(k.unlock?.round ?? 0) } } });

/**
 * A seller-signed delivery as HoldbackRules takes it (`HoldbackTypes.Delivery`): its field encodings, so the contract
 * rebuilds the struct hash the seller signed. The ciphertext and the envelopes stay off chain.
 */
export function deliveryTuple(d: J) {
  return {
    attempt: d.attempt,
    ciphertextHash: hashStruct({ types: TYPES, primaryType: 'Ciphertext', data: { uri: d.ciphertext.uri, sha256: d.ciphertext.sha256, bytes: BigInt(d.ciphertext.bytes), cipher: d.ciphertext.cipher } }),
    plaintextSha256Hash: str(d.plaintextSha256),
    plaintextMimeHash: str(d.plaintextMime),
    encryptedKeysHash: keccak256(d.encryptedKeys.length ? concat(d.encryptedKeys.map(keyHash)) : '0x'),
    submittedAt: secs(d.submittedAt),
  };
}

/**
 * The buyer funds past the operators (ADR-0005): `agreeAndFund` from its own key, with the seller's signature and the
 * primary's signed acceptance as every operator serves them (`adjudicator.accepted`), its own `Agree`, and its ERC-3009
 * `ReceiveWithAuthorization` for price plus fee. It pays its own gas and no operator fee.
 */
async function directFund(r: Run, deal: Deal): Promise<TxRecord> {
  const { round } = r;
  const chain = round.chain!;
  const pin = round.pin.chain!;
  const t = deal.terms;
  const seller = await deal.buyer.trusted(`/v1/commitments/${deal.id}/terms`, (x) => x.signatures?.seller ?? null);
  const acc = await deal.buyer.trusted(`/v1/commitments/${deal.id}/events?limit=200`, (x) => x.items.find((e: J) => e.type === 'adjudicator.accepted')?.payload?.acceptance ?? null);
  if (!seller || !acc?.signature) throw new Error(`${short(deal.id)}: the operators serve no seller signature or no signed acceptance to fund with`);
  const hold = BigInt(t.price.amount) + BigInt(t.adjudication.fee.amount);
  await ensureFunds(r, 'buyer', hold);
  await refreshBefore(r, deal, deal.buyer.address);
  r.step = 'fund';
  const agree = { commitmentId: deal.id, buyer: t.buyer, nonce: freshNonce(), expiresAt: t.timing.offerExpiresAt };
  const agreeSignature = await deal.buyer.account.signTypedData(typedOf('Agree', agree, deal.buyer.domain));
  // On a chain the token pulls the hold on its own ERC-3009 signature to CPP's collector, its nonce fixed by the terms (ADR-0025).
  const funding = await deal.buyer.account.signTypedData({
    domain: pin.tokenDomain, types: { ReceiveWithAuthorization: ERC3009_TYPES.ReceiveWithAuthorization }, primaryType: 'ReceiveWithAuthorization',
    message: { from: t.buyer, to: pin.collector, value: hold, validAfter: 0n, validBefore: secs(t.timing.fundBy), nonce: fundingNonceOf(t, deal.id, pin) },
  } as J);
  const tx = await chain.send(round.key('buyer'), 'rules', 'agreeAndFund', [
    termsTuple(t),
    seller,
    { seedCommitment: acc.seedCommitment, bondReserved: BigInt(acc.bondReserved.amount), nonce: acc.nonce, expiresAt: secs(acc.expiresAt), signature: acc.signature },
    { nonce: agree.nonce, expiresAt: secs(agree.expiresAt), signature: agreeSignature },
    { method: 0, signature: funding },
  ]);
  deal.hold = hold;
  deal.sent.push({ step: 'agreeAndFund (direct)', tx });
  r.say(`agreeAndFund sent directly by the buyer: ${chain.link(tx.tx)} (${tx.gasUsed} gas); ${round.amount(hold)} held, no operator fee`);
  return tx;
}

/**
 * The seller delivers past the operators: `deliver` from its own key, then the same signed delivery posted to an
 * operator, since the contract keeps only its hash and the adjudicators need their envelopes (llms.txt, T-218).
 */
async function directDeliver(r: Run, deal: Deal, content: string): Promise<{ tx: TxRecord; at: number }> {
  const { round } = r;
  const chain = round.chain!;
  r.step = 'deliver';
  await until(r, deal.seller, deal.id, ['Held'], 120_000);
  const { prepared, intent } = await deal.seller.prepareDelivery(deal.terms, new TextEncoder().encode(content));
  const { path, body } = await deal.seller.sign(prepared, intent);
  const tx = await chain.send(round.key('seller'), 'rules', 'deliver', [termsTuple(deal.terms), deliveryTuple(body), body.signature]);
  const at = Date.now();
  deal.delivery = body;
  deal.sent.push({ step: 'deliver (direct)', tx });
  r.say(`deliver sent directly by the seller: ${chain.link(tx.tx)} (${tx.gasUsed} gas)`);
  const joined = await deal.seller.call('POST', path, body);
  r.say(`${joined.escrowState}: the seller posted the same signed delivery to ${originOf(deal.seller.operators[0]!)}, so the adjudicators get their envelopes`);
  return { tx, at };
}

/**
 * Polls both operators until each serves an event of `type` naming the round's own transaction, then checks it is
 * labelled `submittedVia: "direct"` and came within one sync pass (T-218) of the receipt the driver read at `at`.
 */
async function shownDirect(r: Run, deal: Deal, type: string, tx: TxRecord, at: number): Promise<void> {
  const want = lc(tx.tx);
  const apis = deal.buyer.sources();
  let seen: Array<J | null> = [];
  for (const end = at + 2 * SYNC_PASS_SEC * 1000; ; await sleep(1000)) {
    seen = await Promise.all(apis.map(async (api) => (await eventsOf(deal.buyer, deal.id, api)).find((e) => e.type === type && lc(String(e.payload?.tx ?? '')) === want) ?? null));
    if (seen.every((e) => e !== null) || Date.now() > end) break;
  }
  const sec = Math.round((Date.now() - at) / 1000);
  const ok = seen.every((e) => e?.submittedVia === 'direct') && sec <= SYNC_PASS_SEC;
  r.check(`${type} shows on both operators as submittedVia "direct" with the round's transaction, within one sync pass (${SYNC_PASS_SEC} s)`, ok, `${apis.map((api, i) => `${originOf(api)}: ${seen[i] ? `submittedVia ${seen[i].submittedVia}` : 'not shown'}`).join('; ')}; ${sec} s after the receipt of ${short(tx.tx)}`);
}

/**
 * The fallback takeover sent directly from the buyer's key, as soon as the latest block is at judgeBy. The deal's
 * fallback adjudicator also sends its own takeover once judgeBy has passed (apps/adjudicator, `takeoversDue`), so the
 * world's may land first; the check then names the transaction that did.
 */
async function directTakeover(r: Run, deal: Deal): Promise<{ tx: TxRecord; at: number } | null> {
  const chain = r.round.chain!;
  const judgeBy = secs(deal.terms.timing.judgeBy);
  r.step = 'fallback';
  r.say(`the primary stays silent; at judgeBy ${deal.terms.timing.judgeBy} the buyer sends triggerFallback directly`);
  while ((await retry(() => chain.client.getBlock())).timestamp < judgeBy) await sleep(1000);
  try {
    const tx = await chain.trigger(r.round.key('buyer'), 'triggerFallback', deal.terms);
    deal.sent.push({ step: 'triggerFallback (direct)', tx });
    r.check("triggerFallback is sent directly from the buyer's key", tx.status === 'success', `${chain.link(tx.tx)} (${tx.gasUsed} gas)`);
    return { tx, at: Date.now() };
  } catch (e) {
    const by = (await eventsOf(deal.buyer, deal.id, deal.buyer.operators[0]!)).find((x) => x.type === 'fallback.triggered');
    r.check("triggerFallback is sent directly from the buyer's key", false, `${reason(e)}; the takeover came from ${by ? `submittedVia ${by.submittedVia} in ${chain.link(String(by.payload?.tx))}` : 'nobody yet'}`);
    return null;
  }
}

/** The envelopes each operator serves to `recipient` at the key read. */
const keysTo = (deal: Deal, recipient: string) => Promise.all(deal.buyer.sources().map(async (api) => (await get(deal.buyer, `/v1/commitments/${deal.id}/key?recipient=${recipient}`, api)).items.length as number));

type Answer = { status: number; body: J; at: number } | { error: string; at: number };

/** A POST with the caller's own Idempotency-Key, so the same request can be retried after a restart. Never throws. */
async function post(api: string, path: string, key: string, body: J | Uint8Array): Promise<Answer> {
  try {
    const raw = body instanceof Uint8Array;
    const res = await fetch(`${api}${path}`, { method: 'POST', headers: { 'content-type': raw ? 'application/octet-stream' : 'application/json', 'idempotency-key': key }, body: raw ? body : JSON.stringify(body) });
    const text = await res.text();
    let parsed: J;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text.slice(0, 200);
    }
    return { status: res.status, body: parsed, at: Date.now() };
  } catch (e) {
    return { error: reason(e), at: Date.now() };
  }
}
const said = (a: Answer) => ('error' in a ? `no answer (${a.error})` : `HTTP ${a.status}${a.body?.escrowState ? ` ${a.body.escrowState}` : a.body?.type ? ` ${a.body.type}` : ''}`);

/**
 * Resolves when `word` arrives as a line on `input` (Rafa types it at scenario 11's pause), ignoring case and spaces
 * around it. Any other line goes to `other` and is ignored: nothing reads stdin before the pause, so an Enter typed
 * earlier in a 1.5 to 2 hour run is still buffered and must not end it. Rejects when `input` closes first.
 */
export function typed(word: string, input: NodeJS.ReadableStream = process.stdin, other: (line: string) => void = () => undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input });
    let got = false;
    rl.on('line', (line) => {
      if (got) return;
      if (line.trim().toLowerCase() !== word) return other(line);
      got = true;
      rl.close();
      resolve();
    });
    rl.once('close', () => {
      (input as NodeJS.ReadStream & { unref?: () => void }).unref?.();
      if (!got) reject(new Error(`stdin closed before "${word}" was typed: scenario 11 waits for Rafa at a terminal`));
    });
  });
}

/** The holdback checkout this driver runs from, for the commands Rafa runs at the pause. */
const CHECKOUT = here('..').replace(/\/+$/, '');

export const DIRECT: Scenario[] = [
  {
    id: '8',
    title: 'The escape hatch: direct calls on API deals',
    waitsFor: ['T-218', 'T-217', 'T-221'],
    async run(r) {
      const { round } = r;
      const chain = round.chain;
      if (!chain) throw new Error('scenario 8 calls the contracts directly, and SimChain has none: run it against Sepolia (or anvil in the tests)');
      await requires(r, ['T-218']);
      const [buyer, seller] = [round.address('buyer'), round.address('seller')];
      const price = BigInt(PRICE);

      // 1. Offered and accepted through the API, then funded and delivered from the parties' own keys.
      {
        const deal = await openDeal(r, { label: 'offered through the API, funded and delivered directly', template: 'checks-only', deliverable: DATASET, checks: CHECKS, price: PRICE }, [buyer, seller, round.demo.adjudicators.primary]);
        const funded = await directFund(r, deal);
        await shownDirect(r, deal, 'hold.funded', funded, Date.now());
        const delivered = await directDeliver(r, deal, CSV);
        await shownDirect(r, deal, 'delivery.submitted', delivered.tx, delivered.at);
        r.step = 'outcome';
        const done = await until(r, deal.buyer, deal.id, ['Released', 'Refunded', 'Escalated'], 300_000);
        r.check('direct: the demo primary decides and the deal ends Released', done.escrowState === 'Released', done.escrowState);
        if (done.escrowState === 'Released') r.check('direct: the buyer opens the work with its released key', await buyerOpens(r, deal, CSV), 'decrypted, sha256 checked against the delivery');
        if (done.deadlines?.appealBy) await expireAppeal(r, deal, done.deadlines.appealBy);
        await finish(r, deal);
        const fee = BigInt(deal.terms.adjudication.fee.amount);
        r.check('direct: the seller is paid the price', delta(deal.record, seller) === price, `seller ${round.amount(delta(deal.record, seller))}`);
        r.check('direct: the buyer pays the price and the adjudication fee, and no operator fee', delta(deal.record, buyer) === -(price + fee), `buyer ${round.amount(delta(deal.record, buyer))}`);
        const to = lc(round.demo.feeSchedule?.to ?? '');
        const fees = logsOf(deal.record, 'Transfer').filter((l) => lc(l.args.from) === buyer && lc(l.args.to) === to);
        r.check('direct: no transfer from the buyer to the operator fee address', fees.length === 0, `${fees.length} Transfer log(s) to ${short(to)}`);
        const delivers = deal.record.transactions.flatMap((t) => t.calls).filter((c) => c.fn === 'deliver').length;
        r.check('direct: the posted copy joins the delivery with no second deliver transaction', delivers === 1, `${delivers} deliver call(s) among the deal's transactions`);
        settledChecks(r, deal, 'Released');
        paidCheck(r, deal, 'direct: the price reaches the seller on chain', seller, price);
        bondFreedCheck(r, deal);
      }

      // 2. A direct reclaim: scenario 3a sends it from the buyer's key on its second deal, so 8 does not repeat it.
      r.note("a deal ended by a direct reclaim: scenario 3a's second deal sends reclaim from the buyer's key (see its record)");

      // 3. The fallback takeover sent directly over the round's own silent primary. The takeover and its sync need
      // T-221 (the round's adjudicator); the demo fallback's decision needs T-217 (a drand quicknet proof on a chain).
      // Without T-217 the deal ends by its default and the scenario waits for it, with the takeover's checks recorded.
      await requires(r, ['T-221']);
      const drand = await requires(r, ['T-217']).then(
        () => true,
        (e: unknown) => {
          if (!(e instanceof Waits)) throw e;
          r.waitsFor = [];
          return false;
        },
      );
      const primary = await RoundAdjudicator.ready(r, 'adjudicator-1', { bond: price });
      const { fallback, appeal } = round.demo.adjudicators;
      const serving = await primary.serve(r, 'silent');
      try {
        const m = round.demo.minWindowSec;
        // offerExpiresAt < fundBy < deliverBy (core's timing rule), with room to fund and deliver before deliverBy, and
        // a fallback window long enough for the takeover's sync, the beacon round and the fallback's decision.
        const timing = shortWindows(r, { offerExpiresInSec: 2 * m, fundWithinSec: 3 * m, deliverWithinSec: 4 * m, fallbackWithinSec: 3 * m });
        const deal = await openDeal(r, { label: "the round's silent primary, the fallback takeover sent directly", template: 'checks-only', deliverable: DATASET, checks: CHECKS, price: PRICE, timing, adjudicators: { primary: primary.address, fallback, appeal } }, [buyer, seller, primary.address, fallback]);
        await fund(r, deal);
        await deliver(r, deal, CSV);
        const taken = await directTakeover(r, deal);
        if (taken) await shownDirect(r, deal, 'fallback.triggered', taken.tx, taken.at);
        let keys: number[] = [];
        for (const end = Date.now() + 2 * SYNC_PASS_SEC * 1000; Date.now() < end; await sleep(1000)) if ((keys = await keysTo(deal, fallback)).every((n) => n > 0)) break;
        r.check('fallback: both operators serve the fallback adjudicator its envelope', keys.every((n) => n > 0), `the key read serves ${keys.join(' and ')} envelope(s) to ${short(fallback)}`);
        r.step = 'outcome';
        if (!drand) {
          // No fallback decides on this chain yet: the default after fallbackBy closes the deal, so the next scenario's
          // balances are its own, and the scenario waits for T-217 with the takeover's checks recorded.
          await waitPast(r, deal.buyer, deal.terms.timing.fallbackBy);
          await trigger(r, deal, 'default');
          await until(r, deal.buyer, deal.id, ['Refunded'], 120_000);
          await finish(r, deal);
          settledChecks(r, deal, 'Refunded');
          r.step = 'outcome';
          r.waitsFor = ['T-217'];
          throw new Waits(r.waitsFor, "the demo fallback decides on a chain only with a drand quicknet proof: the takeover, its sync and the fallback's envelope are checked, and the deal ended by its default");
        }
        const fallbackBy = Date.parse(deal.terms.timing.fallbackBy);
        let done = await until(r, deal.buyer, deal.id, ['Released', 'Refunded', 'Escalated'], Math.max(fallbackBy - Date.now(), 0) + 60_000).catch((e: Error) => {
          r.say(`no decision: ${reason(e)}`);
          return null;
        });
        if (!done) {
          // The fallback did not decide: the default trigger closes the deal, so the next scenario's balances are its own.
          await trigger(r, deal, 'default');
          done = await until(r, deal.buyer, deal.id, ['Refunded'], 120_000);
        }
        r.check('fallback: the fallback adjudicator decides and the deal ends Released', done.escrowState === 'Released', done.escrowState);
        if (done.escrowState === 'Released') r.check('fallback: the buyer opens the work with its released key', await buyerOpens(r, deal, CSV), 'decrypted, sha256 checked against the delivery');
        if (done.deadlines?.appealBy) await expireAppeal(r, deal, done.deadlines.appealBy);
        await finish(r, deal);
        const decisions = deal.record.transactions.flatMap((t) => t.calls).filter((c) => c.fn === 'decide').map((c) => Number(c.args?.[1]?.role));
        r.check("fallback: the decision on chain is the fallback's", decisions.length === 1 && decisions[0] === 1, `decide roles ${decisions.join(', ') || 'none'} (0 primary, 1 fallback, 2 appeal)`);
        settledChecks(r, deal, 'Released');
        paidCheck(r, deal, 'fallback: the price reaches the seller on chain', seller, price);
      } finally {
        await serving.stop();
      }
    },
  },
  {
    id: '11',
    title: 'A restart between broadcast and receipt (live holdback-op1 redeploy)',
    waitsFor: ['T-219'],
    async run(r) {
      const { round } = r;
      const chain = round.chain;
      if (!chain) throw new Error('scenario 11 pauses between a relayed broadcast and its receipt, and SimChain has neither: run it against Sepolia (or anvil in the tests)');
      await requires(r, ['T-219']);
      const [buyer, seller] = [round.address('buyer'), round.address('seller')];
      const op1 = round.operators[0]!;
      const label = round.status[0]?.operatorId as string | undefined;
      r.say(`this scenario pauses once, for Rafa to redeploy holdback-op1 (${originOf(op1)}). Build it now in another terminal, so the deploy at the pause is quick:`);
      r.say(`  pnpm -C ${CHECKOUT}/apps/demo-cloud build`);
      const deal = await openDeal(r, { label: 'a delivery relayed by holdback-op1 while it restarts', template: 'checks-only', deliverable: DATASET, checks: CHECKS, price: PRICE, relay: 0 }, [buyer, seller, round.demo.adjudicators.primary]);
      await fund(r, deal);
      // The deal's relayer lane: the address that sent its funding (a commitment keeps one deal lane, ADR-0028 §3).
      const funded = (await eventsOf(deal.buyer, deal.id, op1)).find((e) => e.type === 'hold.funded');
      const lane = lc(String(funded?.payload?.sender ?? ''));
      if (!/^0x[0-9a-f]{40}$/.test(lane)) throw new Error(`${short(deal.id)}: hold.funded names no relayer lane`);
      if (!/^[0-9]+$/.test(String(funded?.payload?.block ?? ''))) throw new Error(`${short(deal.id)}: hold.funded names no block`);
      r.step = 'deliver';
      await until(r, deal.seller, deal.id, ['Held'], 120_000);
      const { prepared, intent } = await deal.seller.prepareDelivery(deal.terms, new TextEncoder().encode(CSV));
      const { path, body } = await deal.seller.sign(prepared, intent);
      // The restart probe: holdback-op1 keeps a write's Idempotency-Key in memory until it restarts (discovery's
      // limits.idempotency.retention is "process"), so the same key with other bytes answers 409 until then, and 200 after.
      const probeKey = `t-216/11/${randomUUID()}`;
      const probed = await post(op1, '/v1/ciphertext', probeKey, randomBytes(32));
      if (!('status' in probed) || probed.status !== 200) throw new Error(`the restart probe's first upload failed: ${said(probed)}`);
      // The lane's nonce once the funding is in, counted at the funding's block or later (T-232): a node behind it still
      // counts the nonce before the funding, and the loop below would take the funding for the delivery's broadcast.
      const nonce = await retry(() => chain.nonceAfter(lane, BigInt(String(funded!.payload.block))));
      const key = randomUUID();
      const sentAt = Date.now();
      const relay: { answer: Answer | null } = { answer: null };
      const answer = post(op1, path, key, body).then((a) => (relay.answer = a));
      // Paused once the lane's nonce moves (its transaction is out) while holdback-op1 has not answered: its receipt is
      // then not applied yet, whether or not a block holds the transaction.
      let seen: 'pending' | 'mined' | null = null;
      for (const end = Date.now() + 120_000; !seen && !relay.answer && Date.now() < end; await sleep(250)) {
        const [pending, latest] = await Promise.all((['pending', 'latest'] as const).map((blockTag) => chain.client.getTransactionCount({ address: lane as Hex, blockTag }).catch(() => nonce)));
        if (latest! > nonce) seen = 'mined';
        else if (pending! > nonce) seen = 'pending';
      }
      const early = relay.answer as Answer | null;
      const paused = seen !== null && early === null;
      r.check('the driver pauses after the relayed broadcast and before holdback-op1 answers it', paused, seen ? `lane ${short(lane)} nonce ${nonce} ${seen === 'pending' ? 'pending, not yet in a block' : 'already in a block'} ${Math.round((Date.now() - sentAt) / 1000)} s after the delivery was posted; holdback-op1 ${early ? `had answered: ${said(early)}` : 'had not answered'}` : `the lane's nonce did not move; holdback-op1 ${early ? `answered first: ${said(early)}` : 'did not answer'} within 120 s`);
      let restarted = false;
      let probes = 0;
      if (paused) {
        r.step = 'PAUSED';
        r.say(`holdback-op1 broadcast the delivery from lane ${lane} at nonce ${nonce} and has not answered yet.`);
        r.say('Now redeploy holdback-op1 with the same code, from the holdback checkout at the commit it runs (docs/operations.md, the latest deploy):');
        r.say(`  npx -y wrangler@4 deploy -c ${CHECKOUT}/apps/demo-cloud/wrangler.op1.jsonc`);
        r.say('Then type deployed and press Enter here; any other line is ignored, so an Enter typed earlier cannot end the pause. The driver then checks that holdback-op1 restarted, and that the delivery\'s events and the buyer\'s key are served.');
        const pausedAt = Date.now();
        await typed('deployed', process.stdin, () => r.say('ignored a line that is not "deployed"; type deployed and press Enter once holdback-op1 is redeployed'));
        r.step = 'restart';
        r.say(`"deployed" typed ${Math.round((Date.now() - pausedAt) / 1000)} s after the pause; looking for holdback-op1's restart for up to ${RESTART_WAIT_MS / 1000} s`);
        for (const end = Date.now() + RESTART_WAIT_MS; ; await sleep(PROBE_EVERY_MS)) {
          const p = await post(op1, '/v1/ciphertext', probeKey, randomBytes(32));
          probes++;
          if ('status' in p && p.status === 200) restarted = true;
          if (restarted || Date.now() > end) break;
        }
        r.check('holdback-op1 restarted during the pause', restarted, restarted ? `its Idempotency-Key from before the pause is gone: other bytes under the same key answered 200 (probe ${probes})` : `other bytes under the key from before the pause still answer 409 idempotency_conflict after ${probes} probes over ${RESTART_WAIT_MS / 1000} s: no restart seen`);
        const first = await Promise.race([answer, sleep(120_000).then((): Answer => ({ error: 'no answer 120 s after "deployed"', at: Date.now() }))]);
        r.check('the restart cut the relayed delivery before holdback-op1 answered it', !('status' in first && first.status === 200), `the delivery's own request: ${said(first)}${'status' in first && first.status === 200 ? ', so holdback-op1 applied the receipt before it restarted' : ''}`, 'inferred');
      }
      // The client's retry (T-219): the same Idempotency-Key and body get the mined result, not invalid_state.
      const retried = await post(op1, path, key, body);
      r.check('a retry with the same Idempotency-Key and body gets the mined result', 'status' in retried && retried.status === 200 && ['Delivered', 'Released'].includes(retried.body?.escrowState), said(retried));
      r.step = 'outcome';
      const done = await until(r, deal.buyer, deal.id, ['Released', 'Refunded', 'Escalated'], 300_000);
      // The step's events: the delivery from the transaction the lane broadcast at the paused nonce, as holdback-op1's relay.
      const posted = await Promise.all(deal.buyer.sources().map(async (api) => (await eventsOf(deal.buyer, deal.id, api)).find((e) => e.type === 'delivery.submitted') ?? null));
      const tx = String(posted[0]?.payload?.tx ?? '');
      const sent = /^0x[0-9a-f]{64}$/i.test(tx) ? await retry(() => chain.client.getTransaction({ hash: tx as Hex })) : null;
      const same = posted.every((e) => e && lc(String(e.payload?.tx)) === lc(tx) && e.submittedVia === posted[0]!.submittedVia);
      r.check("both operators serve the delivery's events from the paused broadcast, as holdback-op1's relay", same && sent !== null && lc(sent.from) === lane && sent.nonce === nonce && posted[0]!.submittedVia === label, `delivery.submitted ${posted.map((e) => (e ? `submittedVia ${e.submittedVia}` : 'not shown')).join(' / ')}; ${sent ? `${chain.link(tx)} from ${short(sent.from)} at nonce ${sent.nonce}` : 'no transaction named'}; expected lane ${short(lane)} nonce ${nonce}, ${label ?? 'the first operator'}`);
      r.check('the primary gets its envelope and decides: the deal ends Released', done.escrowState === 'Released', done.escrowState);
      const keys = await buyerKeys(deal);
      r.check("both operators serve the buyer's key", keys.every((n) => n > 0), `the key read serves ${keys.join(' and ')} envelope(s) to the buyer`);
      if (done.escrowState === 'Released') r.check('the buyer opens the work with its released key', await buyerOpens(r, deal, CSV), 'decrypted, sha256 checked against the delivery');
      if (done.deadlines?.appealBy) await expireAppeal(r, deal, done.deadlines.appealBy);
      await finish(r, deal);
      settledChecks(r, deal, 'Released');
      deal.record.notes.push("The lane telemetry (the world's lastRecovery) is not served by the API: read it in holdback-op1's Workers Logs (docs/operations.md, Telemetry).");
    },
  },
];
