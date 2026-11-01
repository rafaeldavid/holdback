// A Holdback agent with no Holdback package: fetch for the HTTP API, viem for EIP-712 signatures, tweetnacl and
// Web Crypto for the delivery encryption, and verify.ts to check every prepared message against the agent's
// own intent before signing. Copy it into your agent.
import nacl from 'tweetnacl';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { commitmentIdOf, configuredDomain, freshNonce, jcs, jcsHash, openOwnEnvelope, verifyPrepared, type Domain, type EnvelopeMaterial, type Intent } from './verify.ts';

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
  async call<T = J>(method: 'GET' | 'POST', path: string, body?: unknown, api = this.operators[0]): Promise<T> {
    const headers: Record<string, string> = { 'content-type': body instanceof Uint8Array ? 'application/octet-stream' : 'application/json' };
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
  /** Buyer: agree to the terms it was sent and hold price plus fee, with nonces it picked itself. */
  async agreeAndFund(terms: J, maxTotal: bigint): Promise<J> {
    const nonces = { agreeNonce: freshNonce(), fundingNonce: freshNonce() };
    const prepared = await this.call('POST', '/v1/prepare/agree-and-fund', { commitmentId: commitmentIdOf(terms), ...nonces });
    return this.signAndSubmit(prepared, { kind: 'agree-and-fund', terms, me: this.address, encryptionPublicKey: this.encryptionPublicKey, maxTotal, ...nonces });
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
   * carries the buyer's envelope, which the buyer opens before accepting (so the buyer sees the work first).
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
    const prepared = await this.call('POST', '/v1/prepare/delivery', { commitmentId: id, ciphertext: intent.ciphertext, plaintextSha256: intent.plaintextSha256, encryptedKeys });
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
   * then signs: an early accept releases the seller-supplied envelope with the payment (ADR-0012, T-024).
   */
  async earlyAccept(terms: J, delivery: J): Promise<J> {
    const opened = await openOwnEnvelope(await this.envelopeMaterial(terms, delivery));
    const nonce = freshNonce();
    const prepared = await this.call('POST', '/v1/prepare/early-accept', { commitmentId: commitmentIdOf(terms), nonce });
    return this.signAndSubmit(prepared, { kind: 'early-accept', terms, nonce, opened });
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
