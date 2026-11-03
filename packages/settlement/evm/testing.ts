// Test support for EvmSettlement: a deal whose messages are signed under the rules contract's EIP-712 domain, with
// the deployed token's address as the token identifier (ADR-0025), and funding signed as ERC-3009 for CPP.
// Keys are derived from public labels and guard no value.
import {
  canonicalKeccak,
  commitmentId,
  deliveryHash,
  panelSeed,
  plusSeconds,
  rulebookHash,
  signMessage,
  signTerms,
  type Address,
  type Club,
  type CommitmentTerms,
  type Decision,
  type Delivery,
  type EncryptedKey,
  type Hex32,
  type Mandate,
  type Rulebook,
  type Timestamp,
  type TokenAmount,
  type UnsignedMessage,
} from '@holdback/core';
import { keccak256, stringToBytes, type Hex } from 'viem';
import { privateKeyToAccount, sign } from 'viem/accounts';
import { b64url } from '../sim/actors.js';
import type { Genesis } from '../sim/simchain.js';
import type { Submission, TimeoutKind } from '../src/interface.js';
import type { EvmSettlement } from './evm-settlement.js';

export interface TestActor {
  name: string;
  key: Hex;
  address: Address;
}

export const testActor = (name: string): TestActor => {
  const key = keccak256(stringToBytes(`holdback/settlement-evm/v0/${name}`));
  return { name, key, address: privateKeyToAccount(key).address };
};

export const evmCast = () => ({
  buyer: testActor('buyer'),
  seller: testActor('seller'),
  primary: testActor('bench-a'),
  fallback: testActor('bench-b'),
  appeal: testActor('bench-c'),
  operator: testActor('op-1'),
  stranger: testActor('anyone'),
});
export type EvmCast = ReturnType<typeof evmCast>;

export function evmRulebook(token: string): Rulebook {
  const amt = (amount: string) => ({ token, amount }) as TokenAmount;
  return {
    version: '1.0',
    open: true,
    minWindowsSec: { judge: 120, fallback: 120, appealWindow: 300, appealDecide: 300 },
    windowCoverageRatioBps: 2000,
    appealBondRateBps: 500,
    sealedChecksMaxWeightBps: 3000,
    maxSubmissions: 1,
    defaultOutcome: { judged: { refundBuyer: true, sellerCompensationRateBps: 0 } },
    allowedSettlementModes: ['guaranteed_on_decision'],
    allowedTokens: [token],
    panelPolicyMin: { panelSize: 3, appealPanelSize: 5, minFamilies: 2 },
    appealFee: amt('0'),
    mutualSettlement: { allowed: true, adjudicatorFeeShareAfterDeliveryBps: 0, payoutsTo: 'any' },
    disclosureMin: 'public',
    identityModes: ['long-term'],
    firstLossShareMinBps: 1000,
    bondNoticePeriodMinSec: 600,
    randomness: { source: 'sim' },
    minInspectionWindowSec: 3600,
    disputeBond: amt('50000000'),
  };
}

export async function evmGenesis(o: { cast: EvmCast; token: string; chainId: number; rules: Address; start: Timestamp; buyer: bigint; bond: bigint }): Promise<{ genesis: Genesis; club: Club }> {
  const rulebook = evmRulebook(o.token);
  const club: Club = { id: 'evm-club', name: 'EVM test club', operator: o.cast.operator.address, rulebook, rulebookHash: rulebookHash(rulebook) };
  const domain = { name: 'Holdback' as const, version: '0.6' as const, chainId: BigInt(o.chainId), verifyingContract: o.rules };
  const big = { token: o.token, amount: '1000000000000000' } as TokenAmount;
  const mandates: Mandate[] = [];
  for (const who of [o.cast.buyer, o.cast.seller]) {
    const principal = testActor(`${who.name}-principal`);
    const body = { principal: principal.address, agent: who.address, clubId: club.id, scope: { roles: ['buyer', 'seller'], maxPerCommitment: big, maxDaily: big, expiresAt: plusSeconds(o.start, 365 * 86400) }, nonce: keccak256(stringToBytes(`mandate/${who.name}`)), issuedAt: o.start } as Omit<Mandate, 'signature'>;
    mandates.push({ ...body, signature: await signMessage(principal.key, domain, { ...body, type: 'Mandate' } as UnsignedMessage) } as Mandate);
  }
  const bond = { junior: o.bond.toString(), senior: '0' };
  return {
    club,
    genesis: {
      start: o.start,
      simSeed: keccak256(stringToBytes('holdback/evm-seed/0')),
      chainId: o.chainId,
      token: o.token,
      clubs: [club],
      mandates,
      members: [],
      balances: { [o.cast.buyer.address]: o.buyer.toString(), [o.cast.seller.address]: '0' },
      bonds: { [o.cast.primary.address]: bond, [o.cast.fallback.address]: bond, [o.cast.appeal.address]: bond },
    },
  };
}

export class EvmDeal {
  readonly terms: CommitmentTerms;
  readonly id: Hex32;
  readonly seed: Hex32;
  delivery: Delivery | null = null;
  private n = 0;

  constructor(
    private readonly chain: EvmSettlement,
    readonly cast: EvmCast,
    club: Club,
    tag: string,
    price = 2_000_000_000n,
    fee = 50_000_000n,
  ) {
    const now = chain.now();
    const amt = (v: bigint) => ({ token: chain.token, amount: v.toString() }) as TokenAmount;
    this.terms = {
      schemaVersion: '0.6',
      clubId: club.id,
      rulebookHash: club.rulebookHash,
      buyer: cast.buyer.address,
      seller: cast.seller.address,
      deliverable: { kind: 'dataset', description: `EVM deal ${tag}`, format: 'text/csv' },
      acceptance: { deterministicChecks: [], rubric: { criteria: [{ id: 'quality', description: 'Rows cleaned.', weight: 1, anchors: { '0': 'No', '2': 'Partly', '4': 'Yes' } }], passThreshold: 300 } },
      price: amt(price),
      adjudication: {
        adjudicator: cast.primary.address,
        fallbackAdjudicator: cast.fallback.address,
        appealAdjudicator: cast.appeal.address,
        policyId: 'bench-a/evm-p1',
        fee: amt(fee),
        registryHash: canonicalKeccak({ registry: 'evm' }),
        policyHash: canonicalKeccak({ policy: 'evm' }),
      },
      timing: { offerExpiresAt: plusSeconds(now, 900), fundBy: plusSeconds(now, 1800), deliverBy: plusSeconds(now, 3600), judgeBy: plusSeconds(now, 4200), fallbackBy: plusSeconds(now, 4800), appealWindowSec: 300, appealDecideSec: 300, maxSubmissions: 1 },
      settlement: { mode: 'guaranteed_on_decision', token: chain.token },
      remedy: { onReject: 'full_refund' },
      disclosure: { level: 'public' },
      buyerEncryptionPublicKey: b64url(keccak256(stringToBytes(`buyer-key/${tag}`))),
      nonce: keccak256(stringToBytes(`terms/${tag}/${now}`)),
      createdAt: now,
    } as CommitmentTerms;
    this.id = commitmentId(this.terms);
    this.seed = keccak256(stringToBytes(`seed/${this.id}`));
  }

  private nonce(): Hex32 {
    return keccak256(stringToBytes(`${this.id}/nonce/${this.n++}`));
  }

  private sign<T extends UnsignedMessage>(a: TestActor, m: T): Promise<T & { signature: Hex }> {
    return signMessage(a.key, this.chain.domain, m).then((signature) => ({ ...m, signature }));
  }

  async offer(): Promise<Submission> {
    return { kind: 'offer', commitment: { ...this.terms, id: this.id, signatures: { seller: await signTerms(this.cast.seller.key, this.chain.domain, this.terms) } } };
  }

  async accept(): Promise<Submission> {
    const { adjudication, price } = this.terms;
    const message = await this.sign(this.cast.primary, { type: 'AdjudicatorAcceptance', commitmentId: this.id, adjudicator: this.cast.primary.address, seedCommitment: keccak256(this.seed), policyHash: adjudication.policyHash, registryHash: adjudication.registryHash, fee: adjudication.fee, bondReserved: price, nonce: this.nonce(), expiresAt: this.terms.timing.offerExpiresAt } as const);
    return { kind: 'adjudicator_accept', message };
  }

  async agreeAndFund(o: { operatorFee?: { to: Address; value: bigint }; fundingSigner?: TestActor } = {}): Promise<Submission> {
    const agree = await this.sign(this.cast.buyer, { type: 'Agree', commitmentId: this.id, buyer: this.cast.buyer.address, nonce: this.nonce(), expiresAt: this.terms.timing.offerExpiresAt } as const);
    const f = await this.chain.fundingAuthorization(this.terms);
    const funding = {
      type: 'FundingAuthorization' as const,
      scheme: 'erc3009' as const,
      commitmentId: this.id,
      from: this.cast.buyer.address,
      value: f.value.toString(),
      token: this.chain.token,
      validAfter: f.validAfter,
      validBefore: f.validBefore,
      nonce: f.nonce,
      expiresAt: this.terms.timing.fundBy,
      signature: await sign({ hash: f.digest, privateKey: (o.fundingSigner ?? this.cast.buyer).key, to: 'hex' }),
    };
    if (!o.operatorFee) return { kind: 'agree_and_fund', agree, funding };
    const validAfter = '1970-01-01T00:00:00Z';
    const validBefore = this.terms.timing.fundBy;
    const fee = await this.chain.operatorFeeAuthorization(this.id, this.cast.buyer.address, o.operatorFee.to, o.operatorFee.value, validAfter, validBefore);
    const operatorFee = {
      type: 'TransferAuthorization' as const,
      scheme: 'erc3009' as const,
      purpose: 'operator_fee' as const,
      commitmentId: this.id,
      from: this.cast.buyer.address,
      to: o.operatorFee.to,
      value: o.operatorFee.value.toString(),
      token: this.chain.token,
      validAfter,
      validBefore,
      nonce: fee.nonce,
      expiresAt: validBefore,
      signature: await sign({ hash: fee.digest, privateKey: this.cast.buyer.key, to: 'hex' }),
    };
    return { kind: 'agree_and_fund', agree, funding, operatorFee };
  }

  envelope(recipient: Address): EncryptedKey {
    return { recipient, scheme: 'x25519-xsalsa20poly1305', ciphertext: b64url(canonicalKeccak({ contentKey: this.id, recipient })) };
  }

  async deliver(): Promise<Submission> {
    const { adjudication, buyer } = this.terms;
    const body: Omit<Delivery, 'signature'> = {
      commitmentId: this.id,
      attempt: 1,
      ciphertext: { uri: `sim://blobs/${this.id.slice(2, 14)}`, sha256: `sha256:${'c'.repeat(64)}`, bytes: 100, cipher: 'aes-256-gcm' },
      plaintextSha256: `sha256:${'d'.repeat(64)}`,
      plaintextMime: 'text/csv',
      encryptedKeys: [adjudication.adjudicator, adjudication.fallbackAdjudicator, adjudication.appealAdjudicator, buyer].map((r) => this.envelope(r)),
      submittedAt: this.chain.now(),
    };
    const { signature } = await this.sign(this.cast.seller, { ...body, type: 'Delivery' as const });
    this.delivery = { ...body, signature };
    return { kind: 'deliver', delivery: this.delivery };
  }

  async earlyAccept(): Promise<Submission> {
    return { kind: 'early_accept', message: await this.sign(this.cast.buyer, { type: 'EarlyAccept', commitmentId: this.id, buyer: this.cast.buyer.address, attempt: 1, nonce: this.nonce(), expiresAt: plusSeconds(this.chain.now(), 86400) } as const) };
  }

  async decide(role: 'primary' | 'fallback' | 'appeal', outcome: Decision['outcome'], round?: number): Promise<Submission> {
    const actor = role === 'primary' ? this.cast.primary : role === 'fallback' ? this.cast.fallback : this.cast.appeal;
    const value = round === undefined ? null : this.chain.beacon(round);
    const seed = role === 'primary' ? this.seed : panelSeed(this.id, role, 1, value!);
    const message = await this.sign(actor, {
      type: 'Decision',
      commitmentId: this.id,
      attempt: 1,
      adjudicator: actor.address,
      role,
      outcome,
      seed,
      policyHash: this.terms.adjudication.policyHash,
      registryHash: this.terms.adjudication.registryHash,
      judgmentRecordHash: keccak256(stringToBytes(`record/${this.id}/${role}/${outcome}`)),
      nonce: this.nonce(),
      expiresAt: plusSeconds(this.chain.now(), 86400),
      ...(round !== undefined ? { beacon: { source: 'sim' as const, round, value: value! } } : {}),
      ...(outcome === 'accept' ? { keyForBuyer: { scheme: 'x25519-xsalsa20poly1305' as const, ciphertext: this.envelope(this.terms.buyer).ciphertext } } : {}),
      ...(outcome === 'escalate' ? { encryptedKeys: [this.envelope(this.terms.adjudication.appealAdjudicator)] } : {}),
    } as UnsignedMessage);
    return { kind: 'decide', message: message as unknown as Decision };
  }

  async appealBy(who: 'buyer' | 'seller', bond: bigint): Promise<Submission> {
    const actor = who === 'buyer' ? this.cast.buyer : this.cast.seller;
    const body = { commitmentId: this.id, appellant: who, appellantAddress: actor.address, grounds: 'wrong-outcome', bond: { token: this.chain.token, amount: bond.toString() } as TokenAmount, filedAt: this.chain.now() };
    const { signature } = await this.sign(actor, { ...body, type: 'Appeal' as const });
    return { kind: 'appeal', appeal: { ...body, signature } };
  }

  async mutual(toSeller: bigint, releaseKey: boolean): Promise<Submission> {
    const price = BigInt(this.terms.price.amount);
    const payouts = [
      { to: this.terms.seller, amount: { token: this.chain.token, amount: toSeller.toString() } as TokenAmount },
      { to: this.terms.buyer, amount: { token: this.chain.token, amount: (price - toSeller).toString() } as TokenAmount },
    ].filter((p) => p.amount.amount !== '0');
    const body = { type: 'MutualSettlement' as const, commitmentId: this.id, deliveryHash: this.delivery ? deliveryHash(this.delivery) : null, payouts, releaseKey, nonce: this.nonce(), expiresAt: plusSeconds(this.chain.now(), 86400) };
    const buyerSignature = await signMessage(this.cast.buyer.key, this.chain.domain, body);
    const sellerSignature = await signMessage(this.cast.seller.key, this.chain.domain, body);
    return { kind: 'mutual_settle', message: { ...body, buyerSignature, sellerSignature } };
  }

  trigger(timeout: TimeoutKind): Submission {
    return { kind: 'trigger', commitmentId: this.id, timeout };
  }
}
