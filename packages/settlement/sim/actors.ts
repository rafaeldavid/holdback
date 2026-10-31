// Test and demo helpers: deterministic test keys, a stock club, and a Deal that builds the signed submissions
// the parties and adjudicators of one commitment would send. Nothing here enforces a rule; SimChain does.
// The keys are derived from public strings and guard no value (hard rule: no real money).
import {
  beaconRoundFor,
  canonicalKeccak,
  commitmentId,
  deliveryHash,
  holdbackDomain,
  panelSeed,
  rulebookHash,
  signMessage,
  signTerms,
  tokenAmount,
  type AcceptanceSpec,
  type Address,
  type Club,
  type Commitment,
  type CommitmentTerms,
  type Decision,
  type Delivery,
  type EncryptedKey,
  type Hex32,
  type Mandate,
  type Rulebook,
  type Scope,
  type Timestamp,
  type Payout,
  type TokenAmount,
  type UnsignedMessage,
} from '@holdback/core';
import { keccak256, stringToBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Submission, TimeoutKind } from '../src/interface.js';
import type { SimChain } from './simchain.js';

export const TOKEN = 'tUSD';
/** Local dev chain ID (Anvil/Hardhat). Never a mainnet ID. */
export const SIM_CHAIN_ID = 31337;

export function tusd(amount: string | bigint): TokenAmount {
  const r = tokenAmount(TOKEN, amount);
  if (!r.ok) throw new RangeError(`invalid ${TOKEN} amount ${String(amount)}: ${r.error.kind}`);
  return r.value;
}

export interface SimActor {
  name: string;
  key: Hex;
  address: Address;
}

/** A test actor whose key is derived from a public label. */
export function simActor(name: string, label = 'sim'): SimActor {
  const key = keccak256(stringToBytes(`holdback/settlement-sim/v0/${label}/${name}`));
  return { name, key, address: privateKeyToAccount(key).address };
}

export const SIM_RULEBOOK: Rulebook = {
  version: '1.0-sim',
  open: true,
  minWindowsSec: { judge: 120, fallback: 120, appealWindow: 300, appealDecide: 300 },
  windowCoverageRatioBps: 2000,
  appealBondRateBps: 500,
  sealedChecksMaxWeightBps: 3000,
  maxSubmissions: 1,
  defaultOutcome: { judged: { refundBuyer: true, sellerCompensationRateBps: 1000 } },
  allowedSettlementModes: ['guaranteed_on_decision'],
  allowedTokens: [TOKEN],
  panelPolicyMin: { panelSize: 3, appealPanelSize: 5, minFamilies: 2 },
  appealFee: tusd('25000000'),
  mutualSettlement: { allowed: true, adjudicatorFeeShareAfterDeliveryBps: 0, payoutsTo: 'parties' },
  disclosureMin: 'public',
  identityModes: ['long-term'],
  firstLossShareMinBps: 1000,
  bondNoticePeriodMinSec: 600,
  randomness: { source: 'sim' },
  minInspectionWindowSec: 3600,
  disputeBond: tusd('50000000'),
};

export function simClub(operator: Address, rulebook: Rulebook = SIM_RULEBOOK, id = 'sim-club'): Club {
  return { id, name: 'SimChain test club', operator, rulebook, rulebookHash: rulebookHash(rulebook) };
}

export const SIM_ACCEPTANCE: AcceptanceSpec = {
  deterministicChecks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] }],
  rubric: {
    criteria: [{ id: 'quality', description: 'Rows cleaned as described.', weight: 1, anchors: { '0': 'No', '2': 'Partly', '4': 'Yes' } }],
    passThreshold: 300,
  },
};

const domain = holdbackDomain(SIM_CHAIN_ID);

export async function sign<T extends UnsignedMessage>(actor: SimActor, message: T): Promise<T & { signature: Hex }> {
  return { ...message, signature: await signMessage(actor.key, domain, message) };
}

const plus = (ts: Timestamp, seconds: number): Timestamp => new Date(Date.parse(ts) + seconds * 1000).toISOString().replace('.000Z', 'Z');
const b64url = (hex: string): string => Buffer.from(hex.replace(/^0x/, ''), 'hex').toString('base64url');

export function wideScope(roles: Scope['roles'], expiresAt: Timestamp): Scope {
  return { roles, maxPerCommitment: tusd('1000000000000000'), maxDaily: tusd('1000000000000000'), expiresAt };
}

/** A mandate from `principal` to `agent` in a club, signed by the principal. */
export async function mandateFor(principal: SimActor, agent: Address, clubId: string, scope: Scope, issuedAt: Timestamp): Promise<Mandate> {
  const body = { principal: principal.address, agent, clubId, scope, nonce: keccak256(stringToBytes(`${principal.name}/${agent}/${clubId}`)), issuedAt };
  const { signature } = await sign(principal, { ...body, type: 'Mandate' as const });
  return { ...body, signature };
}

export interface Cast {
  buyer: SimActor;
  seller: SimActor;
  primary: SimActor;
  fallback: SimActor;
  appeal: SimActor;
}

export function simCast(label = 'sim'): Cast {
  return {
    buyer: simActor('buyer', label),
    seller: simActor('seller', label),
    primary: simActor('bench-a', label),
    fallback: simActor('bench-b', label),
    appeal: simActor('bench-c', label),
  };
}

export interface DealOptions {
  price?: TokenAmount;
  fee?: TokenAmount;
  club: Club;
  /** Distinguishes several deals between the same parties. */
  tag?: string;
}

type Role = 'primary' | 'fallback' | 'appeal';

/**
 * One commitment's messages, signed by the cast. Every method returns a Submission; the caller submits or
 * validates it. Fake envelopes stand in for real encryption: SimChain never opens them (ADR-0012 step 7).
 */
export class Deal {
  readonly terms: CommitmentTerms;
  readonly id: Hex32;
  readonly seed: Hex32;
  delivery: Delivery | null = null;
  private n = 0;

  constructor(
    private readonly chain: SimChain,
    readonly cast: Cast,
    options: DealOptions,
  ) {
    const now = chain.now();
    const tag = options.tag ?? '0';
    this.terms = {
      schemaVersion: '0.6',
      clubId: options.club.id,
      rulebookHash: options.club.rulebookHash,
      buyer: cast.buyer.address,
      seller: cast.seller.address,
      deliverable: { kind: 'dataset', description: `SimChain deal ${tag}`, format: 'text/csv' },
      acceptance: SIM_ACCEPTANCE,
      price: options.price ?? tusd('2000000000'),
      adjudication: {
        adjudicator: cast.primary.address,
        fallbackAdjudicator: cast.fallback.address,
        appealAdjudicator: cast.appeal.address,
        policyId: 'bench-a/sim-p1',
        fee: options.fee ?? tusd('50000000'),
        registryHash: canonicalKeccak({ registry: 'sim' }),
        policyHash: canonicalKeccak({ policy: 'sim' }),
      },
      timing: {
        offerExpiresAt: plus(now, 900),
        fundBy: plus(now, 1800),
        deliverBy: plus(now, 3600),
        judgeBy: plus(now, 4200),
        fallbackBy: plus(now, 4800),
        appealWindowSec: 300,
        appealDecideSec: 300,
        maxSubmissions: 1,
      },
      settlement: { mode: 'guaranteed_on_decision', token: TOKEN },
      remedy: { onReject: 'full_refund' },
      disclosure: { level: 'public' },
      buyerEncryptionPublicKey: b64url(keccak256(stringToBytes(`buyer-key/${tag}`))),
      nonce: keccak256(stringToBytes(`terms/${tag}/${now}`)),
      createdAt: now,
    };
    this.id = commitmentId(this.terms);
    this.seed = keccak256(stringToBytes(`seed/${this.id}`));
  }

  private nonce(): Hex32 {
    return keccak256(stringToBytes(`${this.id}/nonce/${this.n++}`));
  }

  private far(): Timestamp {
    return plus(this.chain.now(), 30 * 86_400);
  }

  async offer(): Promise<Submission> {
    const signature = await signTerms(this.cast.seller.key, domain, this.terms);
    const commitment: Commitment = { ...this.terms, id: this.id, signatures: { seller: signature } };
    return { kind: 'offer', commitment };
  }

  async accept(over: { seed?: Hex32 } = {}): Promise<Submission> {
    const { adjudication, price } = this.terms;
    const message = await sign(this.cast.primary, {
      type: 'AdjudicatorAcceptance',
      commitmentId: this.id,
      adjudicator: this.cast.primary.address,
      seedCommitment: keccak256(over.seed ?? this.seed),
      policyHash: adjudication.policyHash,
      registryHash: adjudication.registryHash,
      fee: adjudication.fee,
      bondReserved: price,
      nonce: this.nonce(),
      expiresAt: this.terms.timing.offerExpiresAt,
    } as const);
    return { kind: 'adjudicator_accept', message };
  }

  async agreeMessage() {
    return sign(this.cast.buyer, { type: 'Agree', commitmentId: this.id, buyer: this.cast.buyer.address, nonce: this.nonce(), expiresAt: this.terms.timing.offerExpiresAt } as const);
  }

  async fundingMessage(value?: bigint) {
    const total = BigInt(this.terms.price.amount) + BigInt(this.terms.adjudication.fee.amount);
    return sign(this.cast.buyer, {
      type: 'FundingAuthorization',
      scheme: 'erc3009',
      commitmentId: this.id,
      from: this.cast.buyer.address,
      value: (value ?? total).toString(),
      token: TOKEN,
      validAfter: this.terms.createdAt,
      validBefore: this.terms.timing.fundBy,
      nonce: this.nonce(),
      expiresAt: this.terms.timing.fundBy,
    } as const);
  }

  async agree(): Promise<Submission> {
    return { kind: 'agree', message: await this.agreeMessage() };
  }

  async fund(): Promise<Submission> {
    return { kind: 'fund', message: await this.fundingMessage() };
  }

  async agreeAndFund(): Promise<Submission> {
    return { kind: 'agree_and_fund', agree: await this.agreeMessage(), funding: await this.fundingMessage() };
  }

  /** Fake envelope for a recipient: a hash, never a real key. */
  envelope(recipient: Address): EncryptedKey {
    return { recipient, scheme: 'x25519-xsalsa20poly1305', ciphertext: b64url(canonicalKeccak({ contentKey: this.id, recipient })) };
  }

  async deliver(over: { recipients?: Address[]; signer?: SimActor } = {}): Promise<Submission> {
    const { adjudication, buyer } = this.terms;
    const recipients = over.recipients ?? [adjudication.adjudicator, adjudication.fallbackAdjudicator, adjudication.appealAdjudicator, buyer];
    const body: Omit<Delivery, 'signature'> = {
      commitmentId: this.id,
      attempt: 1,
      ciphertext: { uri: `sim://blobs/${this.id.slice(2, 14)}`, sha256: `sha256:${'c'.repeat(64)}`, bytes: 100, cipher: 'aes-256-gcm' },
      plaintextSha256: `sha256:${'d'.repeat(64)}`,
      plaintextMime: 'text/csv',
      encryptedKeys: recipients.map((r) => this.envelope(r)),
      submittedAt: this.chain.now(),
    };
    const { signature } = await sign(over.signer ?? this.cast.seller, { ...body, type: 'Delivery' as const });
    this.delivery = { ...body, signature };
    return { kind: 'deliver', delivery: this.delivery };
  }

  async earlyAccept(): Promise<Submission> {
    const message = await sign(this.cast.buyer, { type: 'EarlyAccept', commitmentId: this.id, buyer: this.cast.buyer.address, attempt: 1, nonce: this.nonce(), expiresAt: this.far() } as const);
    return { kind: 'early_accept', message };
  }

  /** The seed an honest adjudicator in `role` uses now: its committed seed, or the beacon seed (ADR-0018). */
  honestSeed(role: Role): Hex32 {
    if (role === 'primary') return this.seed;
    const state = this.chain.escrowState(this.id);
    const round = state ? beaconRoundFor(state, role) : null;
    const value = round === null ? null : this.chain.beacon(round);
    return value === null ? keccak256(stringToBytes(`no beacon yet/${role}`)) : panelSeed(this.id, role, 1, value);
  }

  async decide(role: Role, outcome: Decision['outcome'], over: { seed?: Hex32; withoutKey?: boolean; withKey?: boolean; withoutAppealEnvelope?: boolean; signer?: SimActor } = {}): Promise<Submission> {
    const actor = role === 'primary' ? this.cast.primary : role === 'fallback' ? this.cast.fallback : this.cast.appeal;
    const key = (outcome === 'accept' && !over.withoutKey) || over.withKey ? { keyForBuyer: { scheme: 'x25519-xsalsa20poly1305' as const, ciphertext: this.envelope(this.terms.buyer).ciphertext } } : {};
    const appealEnvelope = outcome === 'escalate' && !over.withoutAppealEnvelope ? { encryptedKeys: [this.envelope(this.terms.adjudication.appealAdjudicator)] } : {};
    const message = await sign(over.signer ?? actor, {
      type: 'Decision',
      commitmentId: this.id,
      attempt: 1,
      adjudicator: actor.address,
      role,
      outcome,
      seed: over.seed ?? this.honestSeed(role),
      policyHash: this.terms.adjudication.policyHash,
      registryHash: this.terms.adjudication.registryHash,
      judgmentRecordHash: keccak256(stringToBytes(`record/${this.id}/${role}/${outcome}`)),
      nonce: this.nonce(),
      expiresAt: this.far(),
      ...key,
      ...appealEnvelope,
    } as const);
    return { kind: 'decide', message: message as Decision };
  }

  async appealBy(who: 'buyer' | 'seller', bond?: TokenAmount): Promise<Submission> {
    const actor = who === 'buyer' ? this.cast.buyer : this.cast.seller;
    const body = {
      commitmentId: this.id,
      appellant: who,
      appellantAddress: actor.address,
      grounds: 'wrong-outcome',
      bond: bond ?? tusd('100000000'),
      filedAt: this.chain.now(),
    };
    const { signature } = await sign(actor, { ...body, type: 'Appeal' as const });
    return { kind: 'appeal', appeal: { ...body, signature } };
  }

  /** Payouts that split the price between seller and buyer; zero amounts are left out (D23 requires amounts above zero). */
  split(toSeller: bigint): Payout[] {
    const toBuyer = BigInt(this.terms.price.amount) - toSeller;
    return [
      { to: this.terms.seller, amount: tusd(toSeller) },
      { to: this.terms.buyer, amount: tusd(toBuyer < 0n ? 0n : toBuyer) },
    ].filter((p) => p.amount.amount !== '0');
  }

  async mutual(over: { payouts?: Payout[]; releaseKey?: boolean; deliveryHash?: Hex32 | null; signers?: [SimActor, SimActor] } = {}): Promise<Submission> {
    const body = {
      type: 'MutualSettlement' as const,
      commitmentId: this.id,
      deliveryHash: over.deliveryHash !== undefined ? over.deliveryHash : this.delivery ? deliveryHash(this.delivery) : null,
      payouts: over.payouts ?? this.split((BigInt(this.terms.price.amount) * 7n) / 10n),
      releaseKey: over.releaseKey ?? false,
      nonce: this.nonce(),
      expiresAt: this.far(),
    };
    const [b, s] = over.signers ?? [this.cast.buyer, this.cast.seller];
    const buyerSignature = await signMessage(b.key, domain, body);
    const sellerSignature = await signMessage(s.key, domain, body);
    return { kind: 'mutual_settle', message: { ...body, buyerSignature, sellerSignature } };
  }

  trigger(timeout: TimeoutKind): Submission {
    return { kind: 'trigger', commitmentId: this.id, timeout };
  }
}

export interface GenesisOptions {
  cast: Cast;
  club: Club;
  start: Timestamp;
  simSeed?: Hex32;
  /** Party balances in base units, minted at genesis. */
  balances?: Partial<Record<keyof Cast, bigint>>;
  /** Junior bond (the adjudicator's own stake) in base units. */
  bonds?: Partial<Record<keyof Cast, bigint>>;
  /** Senior bond: Phase 1 has no deposit API, so only tests set it (ADR-0014 §2a). */
  seniorForTests?: Partial<Record<keyof Cast, bigint>>;
  extraClubs?: Club[];
  members?: Array<{ clubId: string; member: Address }>;
}

/** Genesis for a cast: mandates for buyer and seller from their principals, balances and bonds. */
export async function simGenesis(o: GenesisOptions): Promise<import('./simchain.js').Genesis> {
  const expires = plus(o.start, 365 * 86_400);
  const clubs = [o.club, ...(o.extraClubs ?? [])];
  const mandates: Mandate[] = [];
  for (const club of clubs) {
    for (const who of ['buyer', 'seller'] as const) {
      const agent = o.cast[who];
      mandates.push(await mandateFor(simActor(`${agent.name}-principal`), agent.address, club.id, wideScope(['buyer', 'seller'], expires), o.start));
    }
  }
  const pick = (m: Partial<Record<keyof Cast, bigint>> | undefined): Record<Address, string> =>
    Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [o.cast[k as keyof Cast].address, v.toString()]));
  const junior = pick(o.bonds);
  const senior = pick(o.seniorForTests);
  const bondOwners = new Set([...Object.keys(junior), ...Object.keys(senior)]);
  return {
    start: o.start,
    simSeed: o.simSeed ?? keccak256(stringToBytes('holdback/sim-seed/0')),
    chainId: SIM_CHAIN_ID,
    token: TOKEN,
    clubs,
    mandates,
    members: o.members ?? [],
    balances: pick(o.balances),
    bonds: Object.fromEntries([...bondOwners].map((a) => [a, { junior: junior[a as Address] ?? '0', senior: senior[a as Address] ?? '0' }])),
  };
}
