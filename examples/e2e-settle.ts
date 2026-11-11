// The round's one-off close of one of its own deals by mutual settlement (T-216; Rafa, 2026-11-06: "close scenario 8's
// deal now with a mutual settlement signed by the round's own buyer and seller keys, a normal protocol path"). Both
// round keys sign one MutualSettlement. The first operator relays it, else the second; when both refuse, the buyer
// sends the same signed message to HoldbackRules itself (ADR-0005), as any party may. It prints addresses, the message
// and Etherscan links, never the seed or a key.
//
//   node --env-file-if-exists=.env examples/e2e-round.ts settle <commitmentId> [--to-buyer|--to-seller] [--dry-run]
//
// --to-buyer, the default, pays the price back to the buyer; --to-seller pays it to the seller. The adjudication fee
// returns to the buyer either way (HoldbackRules' MUTUAL_FEE_SHARE_BPS is 0), and the content key stays sealed.
//
// Why the direct send: round 1's scenario 8 delivered its deal 0x71f767…1197 from the seller's key before posting it,
// and both operators fell behind the chain. They hold no copy of its delivery, so they refuse every signed step on it
// (packages/settlement/evm/evm-settlement.ts, `send`), and their prepared settlement would name no delivery, which the
// contract refuses for a delivered deal. So the message is built here from the chain's own deliveryHashOf.
import { getAddress, keccak256, recoverTypedDataAddress, toBytes, type Hex } from 'viem';
import { termsTuple, type TxRecord } from './e2e-chain.ts';
import { get, reason, retry, Run, short, sleep, type Round } from './e2e-run.ts';
import { commitmentIdOf, freshNonce, Refusal, typedOf } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export type Direction = 'to-buyer' | 'to-seller';

/** The stages HoldbackRules.mutualSettle closes; it reverts WrongStage in any other. */
export const SETTLEABLE: readonly string[] = ['Held', 'Delivered', 'FallbackJudging', 'Escalated'];

const ZERO32 = `0x${'00'.repeat(32)}` as Hex;
const lc = (a: string) => a.toLowerCase();
const secs = (ts: string) => BigInt(Date.parse(ts) / 1000);
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');

/** The message both round keys sign, as the settlements route and verify.ts's MutualSettlement type take it. */
export interface SettlementMessage {
  type: 'MutualSettlement';
  commitmentId: Hex;
  deliveryHash: Hex | null;
  payouts: Array<{ to: string; amount: { token: string; amount: string } }>;
  releaseKey: false;
  nonce: Hex;
  expiresAt: string;
}

export interface SettlePlan {
  message: SettlementMessage;
  /** What each party gets from the hold, in base units: its payout, and for the buyer the adjudication fee too. */
  toBuyer: bigint;
  toSeller: bigint;
}

/** The command line after `settle`: one commitment ID and the known options only, so a mistyped `--dry-run` never sends. */
export function parseSettle(args: readonly string[]): { id: Hex; direction: Direction; dryRun: boolean } | { error: string } {
  const known = ['--to-buyer', '--to-seller', '--dry-run'];
  const unknown = args.filter((a) => a.startsWith('-') && !known.includes(a));
  if (unknown.length) return { error: `settle takes only --to-buyer, --to-seller and --dry-run, not ${unknown.join(' ')}` };
  const ids = args.filter((a) => !a.startsWith('-'));
  if (ids.length !== 1 || !/^0x[0-9a-fA-F]{64}$/.test(ids[0]!)) return { error: `settle takes one commitment ID, 0x and 64 hex digits${ids.length ? `, not ${ids.join(' ')}` : ''}` };
  if (args.includes('--to-buyer') && args.includes('--to-seller')) return { error: 'settle takes --to-buyer or --to-seller, not both' };
  return { id: lc(ids[0]!) as Hex, direction: args.includes('--to-seller') ? 'to-seller' : 'to-buyer', dryRun: args.includes('--dry-run') };
}

/**
 * The settlement of deal `id`, or a refusal. It refuses unless the terms hash to `id` (so no operator can pass off
 * another deal under it) and name the round's own buyer and seller, and unless dealOf, read at `block`, shows a stage a
 * MutualSettlement closes. After a delivery the message names the delivery the contract holds (ADR-0029).
 */
export function planSettlement(i: { id: Hex; terms: J; buyer: string; seller: string; stage: string; block: bigint; deliveryHash: Hex | null; direction: Direction; nonce: Hex; expiresAt: string }): SettlePlan {
  const { id, terms: t } = i;
  const hashed = commitmentIdOf(t);
  if (lc(hashed) !== lc(id)) throw new Refusal(`refusing: the terms the operators serve for ${id} hash to ${hashed}, another commitment ID`);
  if (lc(t.buyer) !== lc(i.buyer) || lc(t.seller) !== lc(i.seller)) {
    throw new Refusal(`refusing: ${id} is not one of the round's own deals. Its terms name the buyer ${lc(t.buyer)} and the seller ${lc(t.seller)}; the round's keys are the buyer ${lc(i.buyer)} and the seller ${lc(i.seller)}. settle closes only a deal between the round's own buyer and seller`);
  }
  if (!SETTLEABLE.includes(i.stage)) throw new Refusal(`refusing: dealOf reads ${id} ${i.stage} at block ${i.block}, and a mutual settlement closes only a Held, Delivered, FallbackJudging or Escalated deal; this one holds nothing to settle`);
  const delivered = i.stage !== 'Held';
  if (delivered && (!i.deliveryHash || lc(i.deliveryHash) === ZERO32)) throw new Refusal(`refusing: dealOf reads ${id} ${i.stage} at block ${i.block}, but deliveryHashOf reads zero, and a settlement after a delivery must name it (ADR-0029)`);
  const price = BigInt(t.price.amount);
  if (price === 0n) throw new Refusal(`refusing: ${id} has a price of 0, and a mutual settlement needs at least one positive payout`);
  const fee = BigInt(t.adjudication.fee.amount);
  const toBuyer = i.direction === 'to-buyer';
  return {
    message: {
      type: 'MutualSettlement', commitmentId: lc(id) as Hex, deliveryHash: delivered ? (lc(i.deliveryHash!) as Hex) : null,
      payouts: [{ to: lc(toBuyer ? t.buyer : t.seller), amount: { token: t.price.token, amount: t.price.amount } }], releaseKey: false, nonce: i.nonce, expiresAt: i.expiresAt,
    },
    toBuyer: (toBuyer ? price : 0n) + fee,
    toSeller: toBuyer ? 0n : price,
  };
}

/** No delivery and no key proof: the contract reads them only when the settlement releases the key. */
const NO_DELIVERY = { attempt: 0, ciphertextHash: ZERO32, plaintextSha256Hash: ZERO32, plaintextMimeHash: ZERO32, encryptedKeysHash: ZERO32, submittedAt: 0n };
const NO_KEY = { scheme: '', ciphertext: '', unlockKindHash: keccak256(toBytes('')), unlockRound: 0n, keyHashes: [] as Hex[], index: 0n };

/**
 * `HoldbackRules.mutualSettle`'s arguments for a signed settlement that releases no key: the terms, the message as
 * HoldbackTypes.Mutual (the fields the operators' adapter encodes in `mutualView`), no delivery and no key proof.
 */
export const mutualSettleArgs = (terms: J, m: SettlementMessage & { buyerSignature: Hex; sellerSignature: Hex }) => [
  termsTuple(terms),
  {
    hasDelivery: m.deliveryHash !== null, deliveryHash: m.deliveryHash ?? ZERO32,
    payouts: m.payouts.map((p) => ({ to: getAddress(p.to), amount: BigInt(p.amount.amount) })),
    releaseKey: m.releaseKey, nonce: m.nonce, expiresAt: secs(m.expiresAt), buyerSignature: m.buyerSignature, sellerSignature: m.sellerSignature,
  },
  NO_DELIVERY,
  NO_KEY,
];

/** How long settle waits for a relayed settlement to show on chain, at most (ms): a Sepolia block is about 12 s. */
export const SETTLE_TX_WAIT_MS = 180_000;

/**
 * Settles deal `id` as `direction` says, or with `dryRun` prints the plan and stops. Returns 0 when the settlement's
 * checks hold, 1 when one fails; throws a Refusal when the deal is not the round's own or not open. On a chain only:
 * dealOf is the deal's state.
 */
export async function settleDeal(round: Round, id: Hex, o: { direction: Direction; dryRun: boolean; waitMs?: number }): Promise<number> {
  const { chain } = round;
  if (!chain) throw new Refusal('refusing: settle reads the deal on chain and closes it there, and SimChain has none; run it against Sepolia (anvil in the tests)');
  const r = new Run(round, 'settle', `the mutual settlement of ${id}`);
  const reader = round.agent('master');
  const amount = (x: string | bigint) => round.amount(x);
  const [buyer, seller] = [round.address('buyer'), round.address('seller')];

  r.step = 'read';
  const served: J = await reader.trusted(`/v1/commitments/${id}/terms`);
  const terms: J = Object.fromEntries(Object.entries(served).filter(([k]) => k !== 'id' && k !== 'signatures'));
  // A pinned block, so every read of the plan is the state after one block, never a lagging node's older latest.
  const block = await chain.fresh();
  const deal = await chain.deal(id, block);
  const deliveryHash = SETTLEABLE.includes(deal.stage) && deal.stage !== 'Held' ? await chain.deliveryHashOf(id, block) : null;
  const now = await retry(() => reader.settlementNow());
  const plan = planSettlement({ id, terms, buyer, seller, stage: deal.stage, block, deliveryHash, direction: o.direction, nonce: freshNonce(), expiresAt: iso(now + 3_600_000) });
  const m = plan.message;
  const before = await chain.payment(terms, id, block);

  r.step = 'plan';
  r.say(`${id} is the round's own deal: the terms both operators serve hash to it and name the buyer ${buyer} and the seller ${seller}`);
  r.say(`dealOf reads ${deal.stage} at block ${block}; CPP can still capture ${amount(before.capturable)} for it`);
  const view: J = await get(reader, `/v1/commitments/${id}`).catch(() => null);
  const behind = ((view?.notices ?? []) as string[]).find((n) => n.startsWith('Behind the chain'));
  if (behind) r.say(`the operators show it behind the chain, so they may refuse a signed step on it: ${behind.replace(/^Behind the chain: /, '').split(/(?<=\.) /)[0]}`);
  const [payee, other] = o.direction === 'to-buyer' ? [['buyer', buyer], ['seller', seller]] : [['seller', seller], ['buyer', buyer]];
  r.say("the MutualSettlement the round's buyer and seller sign, exactly:");
  r.say(`  commitmentId ${m.commitmentId}`);
  r.say(`  hasDelivery  ${m.deliveryHash !== null}`);
  r.say(`  deliveryHash ${m.deliveryHash ?? `none (${ZERO32} on chain): nothing is delivered`}${m.deliveryHash ? ', the delivery dealOf holds' : ''}`);
  for (const p of m.payouts) r.say(`  payouts      ${p.amount.amount} base units of ${p.amount.token} (${amount(p.amount.amount)}) to the ${payee[0]} ${p.to}; the ${other[0]} ${other[1]} gets ${amount(0n)} of the price`);
  r.say('  releaseKey   false: the content key stays sealed');
  r.say(`  nonce        ${m.nonce}`);
  r.say(`  expiresAt    ${m.expiresAt}`);
  r.say(`  domain       ${round.pin.domain.name} ${round.pin.domain.version}, chain ${round.pin.domain.chainId}, rules ${round.pin.domain.verifyingContract}`);
  r.say(`the buyer gets back ${amount(plan.toBuyer)} and the seller ${amount(plan.toSeller)}; the ${amount(terms.adjudication.fee.amount)} adjudication fee returns to the buyer`);
  r.say(`it goes to ${round.operators.map((api) => new URL(api).origin).join(', then ')}; if both refuse, the buyer sends the same signed settlement to HoldbackRules directly, paying the gas from its own Sepolia ETH at 20 gwei per gas at most`);
  if (o.dryRun) {
    r.say('a real run picks a fresh nonce and expiresAt, and prints its own message before it signs');
    r.say('dry run: nothing signed, nothing sent');
    return 0;
  }

  r.step = 'sign';
  // Another process sending from the round's keys would race this one.
  await chain.untilIdle({ buyer, seller });
  // verify.ts's EIP-712 encoding under the pinned domain, as Agent.sign signs a checked prepared message, and as
  // scenario 8 signs its direct steps.
  const typed = typedOf('MutualSettlement', m, round.pin.domain);
  const buyerSignature = await round.agent('buyer').account.signTypedData(typed);
  const sellerSignature = await round.agent('seller').account.signTypedData(typed);
  for (const [who, signature] of [[buyer, buyerSignature], [seller, sellerSignature]] as const) {
    if (lc(await recoverTypedDataAddress({ ...typed, signature })) !== lc(who)) throw new Error(`the signature for ${who} does not recover to it`);
  }
  r.say(`signed by the buyer ${short(buyer)} and the seller ${short(seller)}; both signatures recover to them`);

  r.step = 'submit';
  const body = { ...m, buyerSignature, sellerSignature };
  let relayed = false;
  for (const api of round.operators) {
    try {
      const state = await round.agent('buyer').call('POST', `/v1/commitments/${id}/settlements`, body, api);
      r.say(`${new URL(api).origin} relayed it: ${state.escrowState}`);
      relayed = true;
      break;
    } catch (e) {
      r.say(`${new URL(api).origin} refused it: ${reason(e)}`);
    }
  }
  let tx: TxRecord | undefined;
  if (!relayed) {
    // An operator that failed after relaying may still have landed it: read the chain before sending.
    const at = await chain.fresh();
    const stage = (await chain.deal(id, at)).stage;
    if (SETTLEABLE.includes(stage)) {
      r.say('both operators refused it; the buyer sends mutualSettle to HoldbackRules directly');
      tx = await chain.send(round.key('buyer'), 'rules', 'mutualSettle', mutualSettleArgs(terms, body));
      r.say(`sent by the buyer ${short(buyer)}: ${chain.link(tx.tx)}`);
      // An operator that answered an error may have landed the same message first, on a block the simulation's node had
      // not seen: the buyer's copy then reverts WrongStage, and the settlement to read is the operator's.
      if (tx.status !== 'success') {
        r.say(`the buyer's transaction reverted, ${Number(tx.gasUsed).toLocaleString('en-US')} gas; looking for the settlement that landed first`);
        tx = undefined;
      }
    } else {
      r.say(`dealOf reads ${stage} at block ${at}: the settlement may have landed through an operator`);
    }
  }

  r.step = 'wait';
  tx ??= await settlementTx(r, id, block, m.nonce, o.waitMs ?? SETTLE_TX_WAIT_MS);
  r.say(`the settlement transaction: ${chain.link(tx.tx)}, ${Number(tx.gasUsed).toLocaleString('en-US')} gas, block ${tx.block}`);

  r.step = 'evidence';
  const at = BigInt(tx.block);
  const after = await chain.deal(id, at);
  const payment = await chain.payment(terms, id, at);
  const logs = (contract: string, event: string) => tx.logs.filter((l) => l.contract === contract && l.event === event);
  const received = (a: string) => logs('token', 'Transfer').filter((l) => lc(String(l.args.to)) === lc(a)).reduce((s, l) => s + BigInt(l.args.amount), 0n);
  // A fee share to the sitting adjudicator would come out of the buyer's part; this contract pays none.
  const feeShare = logs('rules', 'FeePaid').reduce((s, l) => s + BigInt(l.args.amount), 0n);
  const settled = logs('rules', 'MutuallySettled').filter((l) => lc(String(l.args.id)) === lc(id));
  // This message, by its nonce in the call the transaction carries, not an earlier one still within its hour.
  const call = tx.calls.find((c) => c.fn === 'mutualSettle' && lc(String(c.args?.[1]?.nonce)) === lc(m.nonce));
  r.check('the transaction succeeded', tx.status === 'success', `${chain.link(tx.tx)} ${tx.status}`);
  r.check('the settlement is this one, with no key released', call !== undefined && settled.length === 1 && settled[0]!.args.keyReleased === false && logs('rules', 'KeyReleased').length === 0, `${call ? 'mutualSettle with this nonce' : 'no mutualSettle call with this nonce'}; ${settled.length} MutuallySettled log(s) for the deal, keyReleased ${settled[0]?.args.keyReleased ?? 'none'}; ${logs('rules', 'KeyReleased').length} KeyReleased log(s)`);
  r.check(`dealOf reads Settled after block ${at}`, after.stage === 'Settled', after.stage);
  r.check(`the buyer receives ${amount(plan.toBuyer - feeShare)}`, received(buyer) === plan.toBuyer - feeShare, `${amount(received(buyer))} in ${logs('token', 'Transfer').filter((l) => lc(String(l.args.to)) === lc(buyer)).length} Transfer log(s) to ${short(buyer)}`);
  r.check(`the seller receives ${amount(plan.toSeller)}`, received(seller) === plan.toSeller, `${amount(received(seller))} in ${logs('token', 'Transfer').filter((l) => lc(String(l.args.to)) === lc(seller)).length} Transfer log(s) to ${short(seller)}`);
  r.check('CPP holds nothing to capture for the deal', payment.capturable === '0', `capturable ${amount(before.capturable)} at block ${block}, ${amount(payment.capturable)} after block ${at}; refundable ${amount(payment.refundable)}`);
  r.step = 'done';
  const failed = r.checks.filter((c) => !c.ok).length;
  r.say(failed ? `${failed} of ${r.checks.length} checks failed for ${id}; the settlement transaction is ${chain.link(tx.tx)}` : `${id} is Settled: ${chain.link(tx.tx)}`);
  return failed ? 1 : 0;
}

/**
 * The settlement an operator relayed, from the chain: once dealOf reads Settled at a pinned block, the deal's
 * successful transaction with a MutuallySettled log since block `from`, the one carrying `nonce` first. Stops when the
 * deal closes another way or `waitMs` passes.
 */
async function settlementTx(r: Run, id: Hex, from: bigint, nonce: Hex, waitMs: number): Promise<TxRecord> {
  const chain = r.round.chain!;
  for (const end = Date.now() + waitMs; ; await sleep(3000)) {
    const at = await retry(() => chain.fresh());
    const { stage } = await chain.deal(id, at);
    if (stage === 'Settled') {
      const found: TxRecord[] = [];
      for (const h of await chain.dealTransactions(id, from, at, [])) {
        const rec = await chain.transaction(h);
        if (rec.status === 'success' && rec.logs.some((l) => l.contract === 'rules' && l.event === 'MutuallySettled')) found.push(rec);
      }
      // Another settlement than this one fails the evidence's "this one" check, by name.
      const pick = found.find((t) => t.calls.some((c) => c.fn === 'mutualSettle' && lc(String(c.args?.[1]?.nonce)) === lc(nonce))) ?? found[0];
      if (pick) return pick;
    } else if (!SETTLEABLE.includes(stage)) {
      throw new Error(`dealOf reads ${id} ${stage} at block ${at}: it closed another way than this settlement`);
    }
    if (Date.now() > end) throw new Error(`dealOf still reads ${id} ${stage} at block ${at}, ${Math.round(waitMs / 1000)} s after the relay; read it again on Etherscan before settling again`);
  }
}
