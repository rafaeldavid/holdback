// A Holdback agent with no Holdback package: fetch for the HTTP API, viem for EIP-712 signatures, tweetnacl and
// Web Crypto for the delivery encryption, and verify.ts to check every prepared message against the agent's
// own intent before signing. Copy it into your agent.
import nacl from 'tweetnacl';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  commitmentIdOf,
  configuredDomain,
  freshNonce,
  jcs,
  jcsHash,
  openOwnEnvelope,
  openPrivateTerms,
  privateOfferTerms,
  sealPrivateTerms,
  typedOf,
  verifyDelegation,
  verifyPrepared,
  type Domain,
  type EnvelopeMaterial,
  type Intent,
} from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const bytes = (b: Uint8Array) => new Uint8Array(b); // a plain ArrayBuffer view, as Web Crypto wants
const sha = async (b: Uint8Array) => `sha256:${Buffer.from(await crypto.subtle.digest('SHA-256', bytes(b))).toString('hex')}`;

export class Agent {
  readonly account;
  /** Operator base URLs. The first relays; trusted reads must agree on at least two. */
  readonly operators: string[];
  readonly encryptionSecretKey: Uint8Array;
  readonly encryptionPublicKey: string;
  readonly domain: Domain;
  constructor(operators: string[], privateKey: Hex, encryptionSecretKey: Uint8Array, domain: Domain = configuredDomain()) {
    this.operators = operators;
    this.account = privateKeyToAccount(privateKey);
    this.encryptionSecretKey = encryptionSecretKey;
    this.encryptionPublicKey = b64(nacl.box.keyPair.fromSecretKey(encryptionSecretKey).publicKey);
    this.domain = domain;
  }
  get address() {
    return this.account.address.toLowerCase();
  }
  async call<T = J>(method: 'GET' | 'POST', path: string, body?: unknown, api = this.operators[0], extra: Record<string, string> = {}): Promise<T> {
    const headers: Record<string, string> = { 'content-type': body instanceof Uint8Array ? 'application/octet-stream' : 'application/json', ...extra };
    if (method === 'POST' && !path.startsWith('/v1/prepare/')) headers['idempotency-key'] = crypto.randomUUID();
    const res = await fetch(`${api}${path}`, { method, headers, ...(body === undefined ? {} : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }) });
    const out = (await res.json()) as J;
    if (!res.ok) throw new Error(`${method} ${path}: ${out.type}: ${out.detail}`);
    return out as T;
  }
  /** The configured operators, one per distinct origin (the same node listed twice is one source). */
  sources(): string[] {
    const byOrigin = new Map<string, string>();
    for (const api of this.operators) byOrigin.set(new URL(api).origin.toLowerCase(), api.replace(/\/+$/, ''));
    if (byOrigin.size < 2) throw new Error('trusted reads need at least two operators at distinct origins');
    return [...byOrigin.values()];
  }
  /** A read every distinct operator must answer identically (on `pick`): one lying operator is caught. */
  async trusted<T = J>(path: string, pick: (x: J) => T = (x) => x): Promise<T> {
    const answers = await Promise.all(this.sources().map(async (api) => pick(await this.call('GET', path, undefined, api))));
    if (new Set(answers.map((a) => jcs(a))).size !== 1) throw new Error(`operators disagree on ${path}; do not proceed`);
    return answers[0]!;
  }
  /** Settlement-layer time as every distinct operator reports it; they must agree within 5 seconds. */
  async settlementNow(): Promise<number> {
    const times = await Promise.all(this.sources().map(async (api) => Date.parse((await (await fetch(`${api}/.well-known/holdback.json`)).json() as J).settlementTime)));
    if (times.some((t) => !Number.isFinite(t)) || Math.max(...times) - Math.min(...times) > 5000) throw new Error('operators disagree on settlement-layer time; do not proceed');
    return Math.max(...times);
  }
  /** An adjudicator's registration as every operator serves it, with its policy hash checked. */
  async registration(address: string) {
    const r = await this.trusted(`/v1/adjudicators/${address}`, (x) => ({ address: x.address, encryptionPublicKey: x.encryptionPublicKey, policy: x.policy, policyHash: x.policyHash, registry: x.registry, fee: x.fee }));
    if (jcsHash(r.policy) !== r.policyHash) throw new Error(`adjudicator ${address} publishes a policyHash that does not match its policy`);
    return r;
  }
  /** The club's rulebook as every operator serves it, with its hash checked. */
  async club(clubId: string): Promise<{ rulebook: J; rulebookHash: Hex }> {
    const club = await this.trusted(`/v1/clubs/${clubId}`, (x) => ({ rulebook: x.rulebook, rulebookHash: x.rulebookHash }));
    if (jcsHash(club.rulebook) !== club.rulebookHash) throw new Error(`club ${clubId}'s rulebookHash does not match its rulebook`);
    return club;
  }
  rulebookHash = async (clubId: string): Promise<Hex> => (await this.club(clubId)).rulebookHash;
  /** Verifies a prepared message against this agent's intent and signs its own typed data into its own body. */
  async sign(prepared: J, intent: Intent): Promise<{ path: string; body: J }> {
    const { path, body, toSign } = verifyPrepared(prepared, intent, this.address, this.domain, await this.settlementNow());
    for (const s of toSign) {
      const keys = s.slot.split('.');
      const parent = keys.slice(0, -1).reduce((o: J, k: string) => o[k], body);
      parent[keys.at(-1)!] = await this.account.signTypedData(s.typed);
    }
    return { path, body };
  }
  /** Verifies a prepared message against this agent's intent, signs its own typed data, submits its own body. */
  async signAndSubmit(prepared: J, intent: Intent): Promise<J> {
    const { path, body } = await this.sign(prepared, intent);
    return this.call('POST', path, body);
  }
  /** Seller: an offer from a request, checked against the club and primary as every operator serves them. */
  async offer(given: J): Promise<{ id: Hex; terms: J; state: J }> {
    const request = { nonce: freshNonce(), ...given }; // the agent picks its own nonce
    const prepared = await this.call('POST', '/v1/prepare/offer', request);
    const intent: Intent = { kind: 'offer', request, registration: await this.registration(request.adjudicators.primary), rulebookHash: await this.rulebookHash(request.clubId) };
    const terms = { ...verifyPrepared(prepared, intent, this.address, this.domain, await this.settlementNow()).body };
    const id = terms.id as Hex;
    delete terms.id;
    delete terms.signatures;
    return { id, terms, state: await this.signAndSubmit(prepared, intent) };
  }
  /**
   * The relaying operator's fee schedule (ADR-0023), as every configured operator serves it, or null when they
   * publish none. They must agree: the public demo's two nodes are one operator with one schedule.
   */
  operatorFeeSchedule = (): Promise<J | null> => this.trusted('/.well-known/holdback.json', (x) => x.fees?.operator ?? null);
  /**
   * Buyer: agree to the terms it was sent and hold price plus fee, with nonces it picked itself. When the operators
   * publish a fee, the agent computes it from that schedule and pays it with the agreement; maxTotal covers it too.
   */
  async agreeAndFund(terms: J, maxTotal: bigint): Promise<J> {
    const schedule = await this.operatorFeeSchedule();
    const nonces = { agreeNonce: freshNonce(), fundingNonce: freshNonce() };
    const feeNonce = freshNonce();
    const prepared = await this.call('POST', '/v1/prepare/agree-and-fund', { commitmentId: commitmentIdOf(terms), ...nonces, ...(schedule ? { operatorFeeNonce: feeNonce } : {}) });
    return this.signAndSubmit(prepared, { kind: 'agree-and-fund', terms, me: this.address, encryptionPublicKey: this.encryptionPublicKey, maxTotal, ...nonces, ...(schedule ? { operatorFee: { schedule, nonce: feeNonce } } : {}) });
  }
  async waitFor(id: Hex, states: string[], timeoutMs = 20_000): Promise<{ escrowState: string; deadlines: Record<string, string> }> {
    for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) {
      const s = await this.call('GET', `/v1/commitments/${id}`);
      if (states.includes(s.escrowState)) return s;
    }
    throw new Error(`${id} did not reach ${states.join(' | ')}`);
  }
  /**
   * Seller: encrypt (AES-256-GCM), upload, seal the content key, sign the delivery. The buyer's key comes from
   * the terms the seller signed; each adjudicator's key from its registration as every operator serves it.
   * An operator's /recipients answer is only cross-checked, never trusted.
   */
  async deliver(terms: J, plaintext: Uint8Array): Promise<J> {
    return (await this.deliverAndShare(terms, plaintext)).state;
  }
  /**
   * Seller: deliver, and keep the signed delivery body. To be paid by an early accept, hand it to the buyer: it
   * carries the buyer's envelope, which the buyer opens before accepting. That gives the buyer the content key
   * before payment: if the buyer does not accept early and the deal is then refunded, the buyer keeps the work.
   * Handing it over is your choice (D32); otherwise wait for the adjudicator.
   */
  async deliverAndShare(terms: J, plaintext: Uint8Array): Promise<{ state: J; delivery: J }> {
    const { prepared, intent } = await this.prepareDelivery(terms, plaintext);
    const { path, body } = await this.sign(prepared, intent);
    return { state: await this.call('POST', path, body), delivery: body };
  }
  async prepareDelivery(terms: J, plaintext: Uint8Array): Promise<{ prepared: J; intent: Intent }> {
    const a = terms.adjudication;
    const recipients = [];
    for (const address of [a.adjudicator, a.fallbackAdjudicator, a.appealAdjudicator]) recipients.push({ address, encryptionPublicKey: (await this.registration(address)).encryptionPublicKey });
    recipients.push({ address: terms.buyer, encryptionPublicKey: terms.buyerEncryptionPublicKey });
    const id = commitmentIdOf(terms);
    const offered = (await this.call('GET', `/v1/commitments/${id}/recipients`)).recipients.map((r: J) => ({ address: r.address, encryptionPublicKey: r.encryptionPublicKey }));
    if (jcs(offered.map((r: J) => ({ ...r, address: r.address.toLowerCase() }))) !== jcs(recipients.map((r) => ({ ...r, address: r.address.toLowerCase() })))) throw new Error('the operator lists recipients or keys other than the terms and the registrations; do not seal to them');
    const key = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aes = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
    const ciphertext = new Uint8Array([...iv, ...new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, bytes(plaintext)))]);
    const stored = await this.call('POST', '/v1/ciphertext', ciphertext);
    if (stored.id !== (await sha(ciphertext))) throw new Error('the store answered another hash');
    const encryptedKeys = recipients.map((r) => {
      const eph = nacl.box.keyPair();
      const nonce = nacl.randomBytes(24);
      const box = nacl.box(key, nonce, Buffer.from(r.encryptionPublicKey, 'base64url'), eph.secretKey);
      return { recipient: r.address, scheme: 'x25519-xsalsa20poly1305', ciphertext: b64(new Uint8Array([...eph.publicKey, ...nonce, ...box])) };
    });
    const intent: Intent = { kind: 'delivery', terms, ciphertext: { uri: stored.uri, sha256: stored.id, bytes: ciphertext.length }, plaintextSha256: await sha(plaintext), encryptedKeys };
    // plaintextMime from your own terms: at private and judgment the operator cannot read the deliverable's format.
    const prepared = await this.call('POST', '/v1/prepare/delivery', { commitmentId: id, ciphertext: intent.ciphertext, plaintextSha256: intent.plaintextSha256, plaintextMime: terms.deliverable.format, encryptedKeys });
    return { prepared, intent };
  }
  /**
   * Buyer: what openOwnEnvelope needs for a delivery the seller handed over: the delivery the settlement layer
   * recorded, as every operator serves it, and the ciphertext bytes it names.
   */
  async envelopeMaterial(terms: J, delivery: J): Promise<EnvelopeMaterial> {
    const id = commitmentIdOf(terms);
    const recorded = await this.trusted(`/v1/commitments/${id}/events?limit=200`, (x) => x.items.filter((e: J) => e.type === 'delivery.submitted').at(-1)?.payload ?? null);
    if (!recorded) throw new Error(`no delivery recorded for ${id} yet`);
    const res = await fetch(recorded.ciphertext.uri);
    if (!res.ok) throw new Error(`could not fetch the ciphertext at ${recorded.ciphertext.uri}`);
    return { terms, delivery, recorded, ciphertext: new Uint8Array(await res.arrayBuffer()), encryptionSecretKey: this.encryptionSecretKey };
  }
  /**
   * Buyer: accept a delivery before any decision. It opens this agent's own envelope from the signed delivery
   * the seller handed over, checks it against what the settlement layer holds and the signed hashes, and only
   * then signs: an early accept releases the seller-supplied envelope with the payment, and no appeal follows it (D32).
   */
  async earlyAccept(terms: J, delivery: J): Promise<J> {
    await openOwnEnvelope(await this.envelopeMaterial(terms, delivery)); // throws Refusal if it does not open
    const nonce = freshNonce();
    const prepared = await this.call('POST', '/v1/prepare/early-accept', { commitmentId: commitmentIdOf(terms), nonce });
    return this.signAndSubmit(prepared, { kind: 'early-accept', terms, nonce });
  }
  /** Buyer: fetch this agent's released envelope and the ciphertext, decrypt, check the signed hashes. */
  async openDelivery(id: Hex): Promise<string> {
    const { items } = await this.call('GET', `/v1/commitments/${id}/key?recipient=${this.address}`);
    if (!items.length) throw new Error('no content key released to this agent yet');
    const env = Buffer.from(items[0].ciphertext, 'base64url');
    const key = nacl.box.open(env.subarray(56), env.subarray(32, 56), env.subarray(0, 32), this.encryptionSecretKey);
    if (!key) throw new Error('envelope did not open with this agent key');
    const events = (await this.call('GET', `/v1/commitments/${id}/events?limit=200`)).items;
    const d = events.find((e: { type: string }) => e.type === 'delivery.submitted').payload;
    const ct = new Uint8Array(await (await fetch(d.ciphertext.uri)).arrayBuffer());
    const aes = await crypto.subtle.importKey('raw', bytes(key), 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ct.slice(0, 12) }, aes, ct.slice(12)));
    if ((await sha(plain)) !== d.plaintextSha256 || (await sha(ct)) !== d.ciphertext.sha256) throw new Error('hash mismatch');
    return new TextDecoder().decode(plain);
  }

  // ---- Private deals (ADR-0024): per-deal keys, read tokens, the client-side recipe ----------------------------

  /**
   * A one-time signing key and x25519 key for one deal, and the Delegation this long-term key signs for them
   * (ADR-0024 §7). Use the returned agent for everything in that deal; send the certificate to the counterparty
   * before agree, and to the primary with the offer. Random keys, not derived ones: one xpub would link every deal.
   * Funding the deal key from your treasury links the two on chain (residual 11); fund it how you choose.
   */
  async dealKeys(clubId: string, role: 'buyer' | 'seller', cap: { token: string; amount: string }, ttlSec = 7 * 86_400): Promise<{ deal: Agent; delegation: J }> {
    const deal = new Agent(this.operators, `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`, crypto.getRandomValues(new Uint8Array(32)), this.domain);
    const mandates = (await this.trusted(`/v1/agents/${this.address}`, (x) => x.mandates)) as J[];
    const mandate = mandates.find((m) => m.clubId === clubId) ?? (() => { throw new Error(`no mandate for ${this.address} in ${clubId}`); })();
    const unsigned = {
      type: 'Delegation', principal: mandate.principal.toLowerCase(), agent: this.address, dealKey: deal.address, dealEncryptionKey: deal.encryptionPublicKey, clubId,
      scope: { roles: [role], maxPerCommitment: cap, maxDaily: cap, expiresAt: mandate.scope.expiresAt }, nonce: freshNonce(),
      expiresAt: new Date(Math.floor((await this.settlementNow()) / 1000) * 1000 + ttlSec * 1000).toISOString().replace('.000Z', 'Z'),
    };
    return { deal, delegation: { ...unsigned, signature: await this.account.signTypedData(typedOf('Delegation', unsigned, this.domain)) } };
  }

  /**
   * Checks a counterparty's Delegation before you sign with it (ADR-0024 §7, D32): the certificate itself
   * (verify.ts verifyDelegation), then the certifying agent's mandate from its principal in this club, as every
   * operator serves it, allowing the role and the price. Settlement does not run this check; you do.
   */
  async checkDelegation(d: J, want: { dealKey: string; dealEncryptionKey?: string; clubId: string; role: 'buyer' | 'seller'; price: J }): Promise<void> {
    await verifyDelegation(d, { ...want, nowMs: await this.settlementNow() }, this.domain);
    const mandates = (await this.trusted(`/v1/agents/${d.agent}`, (x) => x.mandates)) as J[];
    const m = mandates.find((x) => x.clubId === want.clubId && x.principal.toLowerCase() === String(d.principal).toLowerCase());
    if (!m) throw new Error(`the certifying agent ${d.agent} holds no mandate from ${d.principal} in ${want.clubId}`);
    if (!m.scope.roles.includes(want.role) || m.scope.maxPerCommitment.token !== want.price.token || BigInt(m.scope.maxPerCommitment.amount) < BigInt(want.price.amount)) throw new Error("the certifying agent's mandate does not cover this role and price");
  }

  /** The operator's receipt signer, from its own discovery document: the audience a ReadToken for it names. */
  async operatorAddress(api = this.operators[0]!): Promise<string> {
    return ((await (await fetch(`${api}/.well-known/holdback.json`)).json()) as J).receiptSigner.toLowerCase();
  }

  /**
   * An Authorization header with a ReadToken for one commitment at one operator (ADR-0024 §3). The audience binds it
   * to that operator, so it cannot be replayed at another; you pick the expiry (D31).
   */
  async readToken(id: Hex, api = this.operators[0]!, ttlSec = 300): Promise<string> {
    const unsigned = { type: 'ReadToken', viewer: this.address, commitmentId: id, audience: await this.operatorAddress(api), nonce: freshNonce(), expiresAt: new Date(Math.floor((await this.settlementNow()) / 1000) * 1000 + ttlSec * 1000).toISOString().replace('.000Z', 'Z') };
    const signature = await this.account.signTypedData(typedOf('ReadToken', unsigned, this.domain));
    return `Holdback-ReadToken ${Buffer.from(JSON.stringify({ ...unsigned, signature })).toString('base64url')}`;
  }

  /** A private read: GET with this agent's ReadToken for that operator. */
  async readPrivate<T = J>(path: string, id: Hex, api = this.operators[0]!): Promise<T> {
    return this.call<T>('GET', path, undefined, api, { authorization: await this.readToken(id, api) });
  }

  /**
   * Seller, with its per-deal agent: a private offer from the recipe, with no operator prepare (ADR-0024 §4). The
   * agent reads the rulebook hash, the primary's registration and settlement time from every operator, picks its own
   * nonce and salts, builds the terms, seals both bodies to the buyer's per-deal key and the primary's registered key,
   * signs and submits ciphertext. The operator never sees the bodies. Keep `keys`: they are what you disclose later.
   */
  async offerPrivate(given: Omit<Parameters<typeof privateOfferTerms>[0], 'rulebookHash' | 'registration' | 'createdAt' | 'nonce' | 'salts' | 'seller' | 'sellerEncryptionPublicKey'>): Promise<{ id: Hex; terms: J; sealed: J; keys: { deliverable: Uint8Array; acceptance: Uint8Array }; state: J }> {
    const registration = await this.registration(given.adjudicators.primary);
    const createdAt = new Date(Math.floor((await this.settlementNow()) / 1000) * 1000).toISOString().replace('.000Z', 'Z');
    const terms = privateOfferTerms({
      ...given, rulebookHash: await this.rulebookHash(given.clubId), registration, createdAt, seller: this.address, sellerEncryptionPublicKey: this.encryptionPublicKey,
      nonce: freshNonce().toLowerCase() as Hex, salts: { deliverable: freshNonce().toLowerCase() as Hex, acceptance: freshNonce().toLowerCase() as Hex },
    });
    const readers = [{ address: terms.buyer, encryptionPublicKey: terms.buyerEncryptionPublicKey }, { address: terms.adjudication.adjudicator, encryptionPublicKey: registration.encryptionPublicKey }];
    const { sealed, id, keys } = await sealPrivateTerms(terms, readers);
    const signature = await this.account.signTypedData(typedOf('CommitmentTerms', terms, this.domain));
    const state = await this.call('POST', '/v1/commitments', { ...sealed, id, signatures: { seller: signature } });
    return { id, terms, sealed, keys, state };
  }

  /**
   * Buyer (or the primary), with its per-deal agent: the sealed terms as every operator serves them to this agent's
   * ReadToken, opened with this agent's key and checked against the hashes the commitment binds (D32).
   */
  async openTerms(id: Hex): Promise<J> {
    const answers = await Promise.all(this.sources().map((api) => this.readPrivate(`/v1/commitments/${id}/terms`, id, api)));
    if (new Set(answers.map((a) => jcs(a))).size !== 1) throw new Error(`operators disagree on the terms of ${id}; do not proceed`);
    return openPrivateTerms(answers[0], id, this.address, this.encryptionSecretKey);
  }

  /** This party's signature over a Publish both parties sign (ADR-0020); raising only. */
  async signPublish(m: { commitmentId: Hex; level: 'judgment' | 'public'; nonce: Hex; expiresAt: string }): Promise<Hex> {
    return this.account.signTypedData(typedOf('Publish', { type: 'Publish', ...m }, this.domain));
  }

  /** Posts disclosure keys (with the co-signed Publish that raises the level, if any) to every configured operator. */
  async disclose(id: Hex, body: { publish?: J; keys: { acceptanceKey?: string; deliverableKey?: string } }): Promise<J[]> {
    return Promise.all(this.sources().map((api) => this.call('POST', `/v1/commitments/${id}/disclosure`, { commitmentId: id, ...body }, api)));
  }
}

/** Fresh funded test accounts from a sim (`pnpm sim`; HOLDBACK_SIM_URL), as agents on all its operators. */
export async function simAgents(sim = process.env['HOLDBACK_SIM_URL'] ?? 'http://127.0.0.1:8780') {
  const info = (await (await fetch(sim)).json()) as { clubId: string; operators: string[]; adjudicators: Array<{ address: string }> };
  const fresh = async () => {
    const a = (await (await fetch(`${sim}/accounts`, { method: 'POST' })).json()) as { privateKey: Hex; encryptionSecretKey: string };
    return new Agent(info.operators, a.privateKey, Buffer.from(a.encryptionSecretKey, 'base64url'));
  };
  return { info, fresh };
}
