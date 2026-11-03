// Atlas Research's procurement agent (buyer). Once the primary adjudicator has accepted, it checks the offer
// against its budget and holds price plus fee in one SDK call (agreement and funding together, applied both
// or neither), waits for the outcome, and
// opens the work with its own key, checking the plaintext against the hash the seller signed. It can also
// propose and submit a co-signed mutual settlement (ADR-0019, D23).
import { plusSeconds, signMessage, splitBps, type Commitment, type CommitmentStateView, type Hex32, type Sha256, type Signature } from '@holdback/core';
import { sha256 } from '@holdback/core/crypto';
import { decryptDeliverable, type Decrypted, type Holdback, type Submitted } from '@holdback/sdk';
import type { TermsTemplate } from '@holdback/testkit';
import { proposeSlate, type AdjudicatorProposal } from './adjudicators.js';
import type { Listing } from './bench.js';
import type { AgentKeys } from './keys.js';
import type { MutualSettlementBody } from './seller.js';
import { deliveryFacts, DOMAIN, type DemoWorld } from './world.js';

/** What Atlas's agent gets when it opens the work: the normalized text and what was stripped (ADR-0021). */
export interface OpenedWork {
  plaintextSha256: Sha256;
  /** The raw decrypted bytes hash to the delivery's signed plaintextSha256. */
  matchesDelivery: boolean;
  bytes: number;
  /** What the agent reads: hidden characters stripped, NFKC applied. */
  text: string;
  removed: Decrypted<string>['removed'];
  screen: Decrypted<string>['screen'];
}

export const ATLAS_BUDGET = 2_050_000_000n;

export class AtlasAgent {
  private readonly hb: Holdback;

  constructor(
    readonly keys: AgentKeys,
    private readonly world: DemoWorld,
    /** Most Atlas will hold for one job, price plus fee, in base units. */
    private readonly budget = ATLAS_BUDGET,
  ) {
    this.hb = world.sdk();
  }

  /**
   * Before any offer (T-017): reads the published registrations, keeps those the club rulebook allows for this
   * price and settlement mode, and proposes a primary, fallback and appeal adjudicator to the seller.
   */
  proposeAdjudicators(listings: readonly Listing[], terms: TermsTemplate): AdjudicatorProposal {
    return proposeSlate(listings, { rulebook: this.world.club.rulebook, price: BigInt(terms.price.amount), mode: terms.settlement.mode });
  }

  /** Agreement and funding in one call, after the primary accepted: the commitment goes from accepted to Held. */
  async agreeAndFund(commitment: Commitment): Promise<Submitted> {
    const total = BigInt(commitment.price.amount) + BigInt(commitment.adjudication.fee.amount);
    if (commitment.buyer.toLowerCase() !== this.keys.address.toLowerCase()) throw new Error('the offer names another buyer');
    if (commitment.buyerEncryptionPublicKey !== this.keys.encryptionPublicKey) throw new Error('the offer seals the work to a key Ledger does not hold');
    if (total > this.budget) throw new Error(`price plus fee ${total} exceeds Ledger's budget ${this.budget}`);
    const { rng } = this.world.ctx;
    const agree = await this.sign({ type: 'Agree', commitmentId: commitment.id, buyer: this.keys.address, nonce: rng.hex32(), expiresAt: commitment.timing.offerExpiresAt } as const);
    const funding = await this.sign({
      type: 'FundingAuthorization',
      scheme: 'erc3009',
      commitmentId: commitment.id,
      from: this.keys.address,
      value: total.toString(),
      token: commitment.price.token,
      validAfter: commitment.createdAt,
      validBefore: commitment.timing.fundBy,
      nonce: rng.hex32(),
      expiresAt: commitment.timing.fundBy,
    } as const);
    return this.hb.agree(agree, funding, this.world.call());
  }

  /** Waits until the commitment leaves Delivered: released, refunded, escalated or settled. */
  waitForOutcome(id: Hex32): Promise<CommitmentStateView> {
    return this.hb.waitFor(id, ['Released', 'Refunded', 'Escalated', 'Settled', 'Defaulted'], { timeoutMs: 10_000 });
  }

  /**
   * After the primary misses judgeBy, anyone may move the commitment to its fallback adjudicator (ADR-0001);
   * Ledger does it here. An unsigned trigger: SimChain checks the deadline, not the caller.
   */
  triggerFallback(id: Hex32): Promise<Submitted> {
    return this.hb.trigger(id, 'fallback', this.world.call());
  }

  /** Fetches Atlas's released key and the ciphertext, decrypts, and checks the plaintext hash. Throws without a key. */
  async openWork(id: Hex32): Promise<OpenedWork> {
    const facts = await deliveryFacts(this.world, id);
    const envelopes = await this.world.keysFor(id, this.keys.address);
    if (envelopes.length === 0) throw new Error(`no content key has been released to Ledger (Atlas Research) for ${id}`);
    const ciphertext = await this.world.store.get(facts.ciphertext.sha256);
    const input = { ciphertext, plaintextSha256: facts.plaintextSha256, envelopes, recipient: this.keys.address, secretKey: this.keys.encryption.secretKey, plaintextMime: 'text/csv' as const };
    // The raw bytes are checked against the signed hash; the agent reads the normalized view.
    const raw = await decryptDeliverable(input, { raw: true });
    const view = await decryptDeliverable(input);
    const hash = sha256(raw.plaintext);
    return { plaintextSha256: hash, matchesDelivery: hash === facts.plaintextSha256, bytes: raw.plaintext.length, text: view.plaintext, removed: view.removed, screen: view.screen };
  }

  /** A settlement paying `toSellerBps` of the price to the seller and the rest to Atlas, releasing the key. Signed by Atlas. */
  async proposeSplit(commitment: Commitment, toSellerBps: bigint): Promise<{ body: MutualSettlementBody; buyerSignature: Signature; toSeller: bigint }> {
    const split = splitBps(commitment.price, toSellerBps);
    if (!split.ok) throw new Error(`cannot split the price at ${toSellerBps} bps: ${split.error.kind}`);
    const facts = await deliveryFacts(this.world, commitment.id);
    const body: MutualSettlementBody = {
      type: 'MutualSettlement',
      commitmentId: commitment.id,
      deliveryHash: facts.deliveryHash,
      payouts: [
        { to: commitment.seller, amount: split.value.share },
        { to: commitment.buyer, amount: split.value.remainder },
      ].filter((p) => p.amount.amount !== '0'),
      releaseKey: true,
      nonce: this.world.ctx.rng.hex32(),
      expiresAt: plusSeconds(this.world.now(), 3600),
    };
    return { body, buyerSignature: await signMessage(this.keys.signingKey, DOMAIN, body), toSeller: BigInt(split.value.share.amount) };
  }

  settle(body: MutualSettlementBody, buyerSignature: Signature, sellerSignature: Signature): Promise<Submitted> {
    return this.hb.settle({ ...body, buyerSignature, sellerSignature }, this.world.call());
  }

  private async sign<T extends Parameters<typeof signMessage>[2]>(m: T): Promise<T & { signature: Signature }> {
    return { ...m, signature: await signMessage(this.keys.signingKey, DOMAIN, m) };
  }
}
