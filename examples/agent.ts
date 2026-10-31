// A Holdback agent in about 100 lines: fetch for the HTTP API, viem for EIP-712 signatures, tweetnacl and Web
// Crypto for the delivery encryption. No Holdback package. The examples import it; copy it into your agent.
import nacl from 'tweetnacl';
import { hashTypedData, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

type Field = { name: string; type: string };
export type Prepared = { commitmentId: Hex; sign: Array<{ slot: string; signer: string; typedData: Typed; digest: Hex }>; submit: { path: string; body: Record<string, unknown> }; check: string[] };
type Typed = { domain: Record<string, unknown>; types: Record<string, Field[]>; primaryType: string; message: Record<string, unknown> };
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const bytes = (b: Uint8Array) => new Uint8Array(b); // a plain ArrayBuffer view, as Web Crypto wants
const sha = async (b: Uint8Array) => `sha256:${Buffer.from(await crypto.subtle.digest('SHA-256', bytes(b))).toString('hex')}`;

/** The operator's typed data carries integers as decimal strings; EIP-712 libraries want integers. */
function ints(types: Record<string, Field[]>, type: string, v: unknown): unknown {
  if (type.endsWith('[]')) return (v as unknown[]).map((x) => ints(types, type.slice(0, -2), x));
  if (types[type]) return Object.fromEntries(types[type].map((f) => [f.name, ints(types, f.type, (v as Record<string, unknown>)[f.name])]));
  return /^u?int\d*$/.test(type) ? BigInt(v as string) : v;
}

export class Agent {
  readonly account;
  readonly api: string;
  readonly encryptionSecretKey: Uint8Array;
  constructor(api: string, privateKey: Hex, encryptionSecretKey: Uint8Array) {
    this.api = api;
    this.account = privateKeyToAccount(privateKey);
    this.encryptionSecretKey = encryptionSecretKey;
  }
  get address() {
    return this.account.address.toLowerCase();
  }
  async call<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const headers: Record<string, string> = { 'content-type': body instanceof Uint8Array ? 'application/octet-stream' : 'application/json' };
    if (method === 'POST' && !path.startsWith('/v1/prepare/')) headers['idempotency-key'] = crypto.randomUUID();
    const res = await fetch(`${this.api}${path}`, { method, headers, ...(body === undefined ? {} : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }) });
    const out = await res.json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!res.ok) throw new Error(`${method} ${path}: ${out.type}: ${out.detail}`);
    return out as T;
  }
  /** Signs the slots that are this agent's, after checking the typed data hashes to the operator's digest. */
  async sign(p: Prepared): Promise<Prepared> {
    for (const s of p.sign.filter((x) => x.signer.toLowerCase() === this.address)) {
      const typed = { ...s.typedData, message: ints(s.typedData.types, s.typedData.primaryType, s.typedData.message) } as Parameters<typeof hashTypedData>[0];
      if (hashTypedData(typed) !== s.digest) throw new Error('typed data does not hash to the digest; do not sign');
      const path = s.slot.split('.');
      const parent = path.slice(0, -1).reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, p.submit.body);
      parent[path.at(-1)!] = await this.account.signTypedData(typed as Parameters<typeof this.account.signTypedData>[0]);
    }
    return p;
  }
  submit = (p: Prepared) => this.call('POST', p.submit.path, p.submit.body);
  async waitFor(id: Hex, states: string[], timeoutMs = 20_000): Promise<{ escrowState: string; deadlines: Record<string, string> }> {
    for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) {
      const s = await this.call('GET', `/v1/commitments/${id}`);
      if (states.includes(s.escrowState)) return s;
    }
    throw new Error(`${id} did not reach ${states.join(' | ')}`);
  }
  /** Seller: encrypt (AES-256-GCM), upload the ciphertext, seal the content key to every recipient, prepare the delivery. */
  async prepareDelivery(id: Hex, plaintext: Uint8Array): Promise<Prepared> {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aes = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
    const ciphertext = new Uint8Array([...iv, ...new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, bytes(plaintext)))]);
    const stored = await this.call('POST', '/v1/ciphertext', ciphertext);
    const { recipients } = await this.call('GET', `/v1/commitments/${id}/recipients`);
    const encryptedKeys = recipients.map((r: { address: string; encryptionPublicKey: string }) => {
      const eph = nacl.box.keyPair();
      const nonce = nacl.randomBytes(24);
      const box = nacl.box(key, nonce, Buffer.from(r.encryptionPublicKey, 'base64url'), eph.secretKey);
      return { recipient: r.address, scheme: 'x25519-xsalsa20poly1305', ciphertext: b64(new Uint8Array([...eph.publicKey, ...nonce, ...box])) };
    });
    return this.call('POST', '/v1/prepare/delivery', { commitmentId: id, ciphertext: { uri: stored.uri, sha256: stored.id, bytes: stored.bytes }, plaintextSha256: await sha(plaintext), encryptedKeys });
  }
  /** Buyer: fetch this agent's released envelope and the ciphertext, decrypt, check the signed plaintext hash. */
  async openDelivery(id: Hex): Promise<string> {
    const { items } = await this.call('GET', `/v1/commitments/${id}/key?recipient=${this.address}`);
    if (!items.length) throw new Error('no content key released to this agent yet');
    const env = Buffer.from(items[0].ciphertext, 'base64url');
    const key = nacl.box.open(env.subarray(56), env.subarray(32, 56), env.subarray(0, 32), this.encryptionSecretKey);
    const events = (await this.call('GET', `/v1/commitments/${id}/events?limit=200`)).items;
    const d = events.find((e: { type: string }) => e.type === 'delivery.submitted').payload;
    const ct = new Uint8Array(await (await fetch(d.ciphertext.uri)).arrayBuffer());
    if (!key) throw new Error('envelope did not open with this agent key');
    const aes = await crypto.subtle.importKey('raw', bytes(key), 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ct.slice(0, 12) }, aes, ct.slice(12)));
    if ((await sha(plain)) !== d.plaintextSha256 || (await sha(ct)) !== d.ciphertext.sha256) throw new Error('hash mismatch');
    return new TextDecoder().decode(plain);
  }
}

/** The sim's test accounts as agents on its first operator (`pnpm sim`; HOLDBACK_SIM_URL). */
export async function simAgents(sim = process.env['HOLDBACK_SIM_URL'] ?? 'http://127.0.0.1:8780') {
  type Account = { label: string; address: string; privateKey: Hex; encryptionPublicKey: string; encryptionSecretKey: string };
  const info = (await (await fetch(sim)).json()) as { clubId: string; operators: string[]; adjudicators: Array<{ role: string; address: string }>; accounts: Account[] };
  const agent = (label: string) => {
    const a = info.accounts.find((x) => x.label === label)!;
    return new Agent(info.operators[0]!, a.privateKey, Buffer.from(a.encryptionSecretKey, 'base64url'));
  };
  return { info, agent, identity: (label: string) => info.accounts.find((x) => x.label === label)! };
}
