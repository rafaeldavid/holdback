// Tidewater Data's cleaning agent (seller). It offers terms built from a terms file, naming the adjudicators
// the two agents chose; encrypts its deliverable under a fresh content key and seals that key to each
// adjudicator and the buyer (ADR-0012); and co-signs a mutual settlement it agrees with. Every message it
// sends is its own EIP-712 signature; operators only relay.
import { commitmentId, signMessage, signTerms, type Address, type Base64Url, type Commitment, type Delivery, type MimeType, type MutualSettlement, type Signature } from '@holdback/core';
import { seal, wrapKeyForRecipients } from '@holdback/core/crypto';
import { termsFromTemplate, type TermsTemplate } from '@holdback/testkit';
import type { Holdback } from '@holdback/sdk';
import type { AdjudicatorSeam } from './bench.js';
import type { AgentKeys } from './keys.js';
import { DOMAIN, type DemoWorld } from './world.js';

/** Who a party names in the terms: an address and the x25519 key its envelopes are sealed to. */
export interface Named {
  address: Address;
  encryptionPublicKey: Base64Url;
}

export interface OfferChoice {
  buyer: Named;
  /** The primary adjudicator; its policy and registry hashes bind at agreement. */
  primary: AdjudicatorSeam;
  fallback: Named;
  appeal: Named;
}

export type MutualSettlementBody = Omit<MutualSettlement, 'buyerSignature' | 'sellerSignature'>;

export class TidewaterAgent {
  private readonly hb: Holdback;

  constructor(
    readonly keys: AgentKeys,
    private readonly world: DemoWorld,
  ) {
    this.hb = world.sdk();
  }

  /** Signed terms for the buyer and the primary adjudicator. Not submitted: the buyer's one-shot hold carries them. */
  async offer(template: TermsTemplate, choice: OfferChoice): Promise<Commitment> {
    const terms = termsFromTemplate(template, {
      club: this.world.club,
      buyer: choice.buyer.address,
      seller: this.keys.address,
      adjudicator: choice.primary.keys.address,
      fallbackAdjudicator: choice.fallback.address,
      appealAdjudicator: choice.appeal.address,
      policyHash: choice.primary.policyHash,
      registryHash: choice.primary.registryHash,
      buyerEncryptionPublicKey: choice.buyer.encryptionPublicKey,
      nonce: this.world.ctx.rng.hex32(),
      createdAt: this.world.now(),
    });
    const seller = await signTerms(this.keys.signingKey, DOMAIN, terms);
    return { ...terms, id: commitmentId(terms), signatures: { seller } };
  }

  /**
   * Encrypts the deliverable, stores the ciphertext, and submits a signed delivery that carries only hashes,
   * the ciphertext pointer and the sealed keys: primary, fallback and appeal adjudicators, then the buyer.
   */
  async deliver(commitment: Commitment, plaintext: Uint8Array, recipients: { primary: Named; fallback: Named; appeal: Named }): Promise<{ delivery: Delivery; via: string }> {
    const sealed = await seal(plaintext, { random: this.world.random });
    const id = await this.world.store.put(sealed.ciphertext);
    const encryptedKeys = wrapKeyForRecipients(
      sealed.key,
      [recipients.primary, recipients.fallback, recipients.appeal, { address: commitment.buyer, encryptionPublicKey: commitment.buyerEncryptionPublicKey }].map((r) => ({
        recipient: r.address,
        publicKey: r.encryptionPublicKey,
      })),
      { random: this.world.random },
    );
    const body: Omit<Delivery, 'signature'> = {
      commitmentId: commitment.id,
      attempt: 1,
      ciphertext: { uri: `mem://ciphertext/${id}`, sha256: sealed.ciphertextSha256, bytes: sealed.ciphertext.length, cipher: 'aes-256-gcm' },
      plaintextSha256: sealed.plaintextSha256,
      plaintextMime: commitment.deliverable.format as MimeType,
      encryptedKeys,
      submittedAt: this.world.now(),
    };
    const delivery: Delivery = { ...body, signature: await signMessage(this.keys.signingKey, DOMAIN, { ...body, type: 'Delivery' }) };
    const submitted = await this.hb.deliver(delivery, this.world.call());
    return { delivery, via: submitted.via };
  }

  /** Co-signs a settlement the buyer proposed. An honest seller signs what it agreed to and nothing else. */
  async cosign(body: MutualSettlementBody, expect: { toSeller: bigint }): Promise<Signature> {
    const mine = body.payouts.find((p) => p.to.toLowerCase() === this.keys.address.toLowerCase());
    if (!mine || BigInt(mine.amount.amount) !== expect.toSeller) throw new Error(`Tidewater did not agree to ${JSON.stringify(body.payouts)}`);
    return signMessage(this.keys.signingKey, DOMAIN, body);
  }
}
