// T-425: the shared setup of the two local measurements (pitch-evidence-direct and pitch-evidence-leak). The demo's own
// world (apps/demo-cloud, the code the live operators run) on the phase-one contracts deployed to anvil, served as two
// operator nodes, as examples/e2e-world.ts's anvilWorld does, with two differences: its passes run only while this
// file ticks them, so the primary adjudicator can be kept from judging; and `stopOperators` takes both nodes away
// while anvil keeps the chain. Local chain only: anvil's accounts and tUSDC guard no value.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Agent } from '../../examples/agent.ts';
import { RoundChain, termsTuple, type TxRecord } from '../../examples/e2e-chain.ts';
import { deliveryTuple } from '../../examples/e2e-scenarios-direct.ts';
import { ENV, WORLD, root } from '../../examples/e2e-world.ts';
import { serveTwoOrigins, type TwoOrigins } from '../../examples/two-origins.ts';
import { deliveryHashOf, ERC3009_TYPES, freshNonce, pinOf, typedOf } from '../../examples/verify.ts';
import { keyProof, NO_DELIVERY, NO_KEY } from '../../packages/settlement/evm/encode.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Hex = `0x${string}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const secs = (iso: string) => BigInt(Date.parse(iso) / 1000);
/** A fresh secp256k1 key from 32 random bytes (below the curve order with overwhelming probability). */
export const freshKey = (): Hex => `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;
/** 25 test tUSDC, try.ts's price, in base units (6 decimals). */
export const PRICE_UNITS = 25_000_000n;
const CHECKS = [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] }];
export const CSV = 'customer_id,email\n1,ada@example.com\n';
/** Windows of 30 s each: long enough that no deadline passes by itself while a deal is set up on 1 s blocks. */
const TIMING = { judgeWithinSec: 30, fallbackWithinSec: 30, appealWindowSec: 0, appealDecideSec: 30 };

export interface Party {
  agent: Agent;
  key: Hex;
}

export interface LocalDeal {
  id: Hex;
  terms: J;
  buyer: Party;
  seller: Party;
  /** The seller-signed delivery body, as the seller hands it to the buyer; null before delivery. */
  delivery: J | null;
}

export class LocalWorld {
  ticking = true;
  private loop: Promise<void> = Promise.resolve();
  stopped = false;

  private constructor(
    readonly anvil: J,
    readonly world: J,
    readonly served: TwoOrigins,
    readonly deployment: J,
    readonly chain: RoundChain,
    readonly discovery: J,
  ) {}

  /** anvil with the phase-one contracts, the demo world on it, served as two nodes; resolves once the world is ready. */
  static async start(): Promise<LocalWorld> {
    const fromDemo = createRequire(join(root, 'apps/demo-cloud/package.json'));
    const fromExamples = createRequire(join(root, 'examples/package.json'));
    const evm = await import(pathToFileURL(fromDemo.resolve('@holdback/settlement/evm')).href);
    const live = await import(pathToFileURL(fromDemo.resolve('@holdback/settlement/live')).href);
    const demo = await import(pathToFileURL(fromExamples.resolve('@holdback/demo-cloud')).href);
    const viemAccounts = await import(pathToFileURL(fromExamples.resolve('viem/accounts')).href);
    const anvil = await evm.EvmWorld.start(root, { blockTimeSec: 1, token: 'test-usdc' });
    const d = anvil.deployment;
    const deployment = {
      chainId: anvil.chainId, fromBlock: Number(d.fromBlock),
      token: { address: d.token, name: anvil.tokenDomain.name, version: anvil.tokenDomain.version, symbol: 'tUSDC', decimals: 6 },
      escrow: d.escrow, erc3009Collector: d.erc3009Collector, multicall: d.multicall, rules: d.rules, beacon: d.beacon, expiryMarginSec: Number(anvil.expiryMargin),
    };
    // anvil's second dev account (Foundry's public default mnemonic; guards no value): the relayer's funding lane.
    const account = viemAccounts.mnemonicToAccount('test test test test test test test test test test test junk', { addressIndex: 1 });
    const relayerKey = `0x${Buffer.from(account.getHdKey().privateKey).toString('hex')}`;
    const chainLive = new live.LiveChain({ deployment, rpcUrls: [anvil.rpcUrl], relayerKey, pollMs: 200, rebroadcastMs: 10_000, mintBatchMs: 200 });
    const world = await demo.PublicWorld.open({ storage: new demo.MemoryStorage(), env: ENV, ...WORLD, live: { chain: chainLive } });
    const served = await serveTwoOrigins(world); // no tickMs: this class runs the passes
    const chain = await RoundChain.open(anvil.rpcUrl, deployment as J);
    const lw = new LocalWorld(anvil, world, served, deployment, chain, null);
    lw.tick();
    for (const end = Date.now() + 120_000; !world.ready() && Date.now() < end; ) await sleep(250);
    if (!world.ready()) throw new Error('the demo world on anvil was not ready within 120 s');
    (lw as J).discovery = await (await fetch(`${served.urls[0]}/.well-known/holdback.json`)).json();
    return lw;
  }

  /** Runs the world's passes every 200 ms until `pause`. */
  tick(): void {
    this.ticking = true;
    this.loop = (async () => {
      while (this.ticking && !this.stopped) {
        await this.world.work();
        await sleep(200);
      }
    })();
  }

  /** Stops the passes and waits for the one running: no adjudicator acts until `tick` again. */
  async pause(): Promise<void> {
    this.ticking = false;
    await this.loop;
  }

  /** Both operator nodes go away: no pass runs again and neither URL answers. anvil keeps the chain. */
  async stopOperators(): Promise<void> {
    await this.pause();
    this.stopped = true;
    await this.served.close();
  }

  async close(): Promise<void> {
    if (!this.stopped) await this.stopOperators();
    await this.anvil.stop();
  }

  pin() {
    return pinOf(this.deployment);
  }

  /** A party with a fresh key, its test tUSDC from the world's faucet, and `wei` of anvil ETH for direct calls. */
  async party(wei = 10n ** 18n): Promise<Party> {
    const key = freshKey();
    const pin = this.pin();
    const agent = new Agent([...this.served.urls], key, crypto.getRandomValues(new Uint8Array(32)), pin.domain, pin.chain);
    await agent.call('POST', '/v1/faucet', { address: agent.address });
    if (wei > 0n) await this.rpc('anvil_setBalance', [agent.address, `0x${wei.toString(16)}`]);
    return { agent, key };
  }

  async rpc(method: string, params: unknown[]): Promise<J> {
    const r = await fetch(this.anvil.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const body = (await r.json()) as J;
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  }

  /** Moves anvil's clock to at least `iso` and mines a block there. */
  async warpTo(iso: string): Promise<void> {
    const block = await this.chain.client.getBlock();
    const want = secs(iso) + 1n;
    if (want > block.timestamp) await this.rpc('evm_setNextBlockTimestamp', [Number(want)]);
    await this.rpc('evm_mine', []);
  }

  /** The latest block's time, in ms: anvil's clock, which `warpTo` moves ahead of the wall. */
  async chainNowMs(): Promise<number> {
    return Number((await this.chain.client.getBlock()).timestamp) * 1000;
  }

  /** An ISO expiry `sec` seconds after the chain's clock. */
  async expiry(sec = 3600): Promise<string> {
    return new Date((await this.chainNowMs()) + sec * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  /** The tUSDC balance of each address on the chain, in base units. */
  async balances(addresses: string[]): Promise<Record<string, bigint>> {
    const h = await this.chain.holdings(addresses);
    return Object.fromEntries(Object.entries(h).map(([a, x]) => [a.toLowerCase(), BigInt(x.token)]));
  }

  async stage(id: Hex): Promise<string> {
    return (await this.chain.deal(id)).stage;
  }

  /** Waits until both operators show one of `states` for `id`, while the passes run. */
  async until(agent: Agent, id: Hex, states: string[], ms = 60_000): Promise<string> {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) {
      const seen = await Promise.all(agent.sources().map((api) => agent.call('GET', `/v1/commitments/${id}`, undefined, api)));
      if (seen.every((s: J) => states.includes(s.escrowState))) return seen[0].escrowState;
    }
    throw new Error(`${id} did not reach ${states.join(' or ')} within ${ms / 1000} s`);
  }

  /**
   * One deal through the operators, as try.ts runs it, while the passes run: the seller offers, the primary accepts,
   * the buyer agrees and funds. It ends Held (AcceptedByAdjudicator with `fund: false`); `deliver` delivers it.
   */
  async deal(o: { buyer?: Party; seller?: Party; fund?: boolean } = {}): Promise<LocalDeal> {
    if (!this.ticking) this.tick();
    const buyer = o.buyer ?? (await this.party());
    const seller = o.seller ?? (await this.party());
    const a = (role: string) => this.discovery.demo.adjudicators.find((x: J) => x.role === role).address;
    const offer = await seller.agent.offer({
      template: 'checks-only', clubId: this.discovery.demo.clubId, seller: seller.agent.address,
      buyer: { address: buyer.agent.address, encryptionPublicKey: buyer.agent.encryptionPublicKey },
      adjudicators: { primary: a('primary'), fallback: a('fallback'), appeal: a('appeal') },
      price: { token: this.pin().token.id, amount: PRICE_UNITS.toString() },
      deliverable: { kind: 'dataset', description: `customers.csv, T-425 deal ${freshNonce().slice(2, 10)}`, format: 'text/csv' },
      checks: CHECKS, timing: TIMING,
    });
    await this.until(buyer.agent, offer.id, ['AcceptedByAdjudicator']);
    if (o.fund === false) return { id: offer.id, terms: offer.terms, buyer, seller, delivery: null };
    const hold = PRICE_UNITS + BigInt(offer.terms.adjudication.fee.amount);
    await buyer.agent.agreeAndFund(offer.terms, hold + 10_000_000n);
    await this.until(buyer.agent, offer.id, ['Held']);
    return { id: offer.id, terms: offer.terms, buyer, seller, delivery: null };
  }

  /**
   * The seller delivers through the operators. With the passes paused (the default) the primary never judges it;
   * with `judge` the passes run and the primary decides.
   */
  async deliver(deal: LocalDeal, o: { judge?: boolean; content?: string } = {}): Promise<void> {
    if (o.judge) {
      if (!this.ticking) this.tick();
    } else await this.pause();
    // The seller hands the buyer its signed delivery (agent.ts deliverAndShare): it carries the buyer's envelope.
    deal.delivery = (await deal.seller.agent.deliverAndShare(deal.terms, new TextEncoder().encode(o.content ?? CSV))).delivery;
  }

  /** The buyer's early accept, signed by `signer` and sent straight to HoldbackRules from `sender` (both keys). */
  async earlyAcceptDirect(deal: LocalDeal, signer: Party, sender: Hex): Promise<TxRecord> {
    const d = deal.delivery!;
    const m = { commitmentId: deal.id, buyer: deal.terms.buyer, attempt: d.attempt, deliveryHash: deliveryHashOf(d), nonce: freshNonce(), expiresAt: await this.expiry() };
    const signature = await signer.agent.account.signTypedData(typedOf('EarlyAccept', m, signer.agent.domain));
    const proof = keyProof(d, deal.terms.buyer);
    if (!proof) throw new Error('the delivery carries no envelope for the buyer');
    return this.chain.send(sender, 'rules', 'earlyAccept', [termsTuple(deal.terms), { attempt: m.attempt, deliveryHash: m.deliveryHash, nonce: m.nonce, expiresAt: secs(m.expiresAt), signature }, deliveryTuple(d), d.signature, proof]);
  }

  /**
   * The leaked key's whole tUSDC balance moved to `to` with no gas at the leaked address: the key signs an ERC-3009
   * TransferWithAuthorization and `sender` (the holder's own key) submits it. Returns the amount moved.
   */
  async drain(leaked: Party, to: string, sender: Hex): Promise<bigint> {
    const from = leaked.agent.address;
    const value = (await this.balances([from]))[from]!;
    if (value === 0n) return 0n;
    const pin = this.pin().chain!;
    const nonce = freshNonce();
    const validBefore = BigInt(Math.floor((await this.chainNowMs()) / 1000) + 3600);
    const signature = await leaked.agent.account.signTypedData({
      domain: pin.tokenDomain, types: { TransferWithAuthorization: ERC3009_TYPES.TransferWithAuthorization }, primaryType: 'TransferWithAuthorization',
      message: { from, to, value, validAfter: 0n, validBefore, nonce },
    } as J);
    const tx = await this.chain.send(sender, 'token', 'transferWithAuthorization', [from, to, value, 0n, validBefore, nonce, signature]);
    if (tx.status !== 'success') throw new Error('the transfer reverted');
    return value;
  }

  /**
   * A mutual settlement signed by `signer` alone, with `forged` standing in for the other party's signature, sent
   * straight to HoldbackRules from `sender`: what one leaked key can try without the counterparty.
   */
  async mutualDirect(deal: LocalDeal, signer: Party, payTo: string, sender: Hex): Promise<TxRecord> {
    const d = deal.delivery;
    const m = {
      commitmentId: deal.id, deliveryHash: d ? deliveryHashOf(d) : null, releaseKey: false, nonce: freshNonce(),
      payouts: [{ to: payTo, amount: deal.terms.price }], expiresAt: await this.expiry(),
    };
    const sig = await signer.agent.account.signTypedData(typedOf('MutualSettlement', m, signer.agent.domain));
    const view = {
      hasDelivery: d !== null, deliveryHash: m.deliveryHash ?? `0x${'00'.repeat(32)}`, payouts: [{ to: payTo, amount: BigInt(deal.terms.price.amount) }],
      releaseKey: false, nonce: m.nonce, expiresAt: secs(m.expiresAt), buyerSignature: sig, sellerSignature: sig,
    };
    return this.chain.send(sender, 'rules', 'mutualSettle', [termsTuple(deal.terms), view, d ? deliveryTuple(d) : NO_DELIVERY, NO_KEY]);
  }

  /** A timeout sent straight to HoldbackRules from `sender`, once anvil's clock is past its deadline. */
  async triggerDirect(deal: LocalDeal, fn: 'reclaim' | 'triggerFallback' | 'triggerDefault', sender: Hex): Promise<TxRecord> {
    return this.chain.send(sender, 'rules', fn, [termsTuple(deal.terms)]);
  }
}

/** The revert's reason as viem reports it (the custom error's name), or the message. */
export function revertOf(e: unknown): string {
  const msg = String((e as Error)?.message ?? e);
  return /(WrongStage|TooEarly|DeadlinePassed|MessageExpired|InvalidMessage|BadSignature|BadKeyProof|Unauthorized|[A-Z][A-Za-z]+Error)/.exec(msg)?.[1] ?? msg.slice(0, 120);
}
