// T-024 (sim batch 1, F2): an early accept releases the seller-supplied buyer envelope with the payment, and
// nothing checks that envelope at delivery. The buyer's verifier therefore refuses to sign an early accept
// until the buyer has opened its own envelope, from the signed delivery the seller hands it, bound to the
// delivery the settlement layer holds, and the plaintext hash matches the signed one.
import { startSimWorld, type SimWorld } from '@holdback/operator';
import nacl from 'tweetnacl';
import { hexToBytes, keccak256, toBytes, type Hex } from 'viem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { commitmentIdOf, deliveryHashOf, freshNonce, openOwnEnvelope, Refusal, SIMCHAIN_DOMAIN, verifyPrepared, type EnvelopeMaterial, type Intent, type Opened } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const sha = async (b: Uint8Array) => `sha256:${Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array(b))).toString('hex')}`;
/** A key the buyer does not hold, derived from a public label (no key literal in source). */
const STRANGER_PUBLIC_KEY = b64(nacl.box.keyPair.fromSecretKey(hexToBytes(keccak256(toBytes('holdback/test/t-024-stranger')))).publicKey);
const WORK = new TextEncoder().encode('a\n1\n');

let world: SimWorld;
let seller: Agent;
let buyer: Agent;
beforeAll(async () => {
  world = await startSimWorld({ env: {}, onError: () => {} });
  const fresh = async () => {
    const a = (await (await fetch(`${world.url}/accounts`, { method: 'POST' })).json()) as J;
    return new Agent([...world.info.operators], a.privateKey, Buffer.from(a.encryptionSecretKey, 'base64url'));
  };
  seller = await fresh();
  buyer = await fresh();
});
afterAll(async () => {
  await world.close();
});

const now = () => Date.parse(world.chain.now());
const silence = (role: string, silent: boolean) => fetch(`${world.url}/adjudicators/${role}`, { method: 'POST', body: JSON.stringify({ silent }) });
let deals = 0;
/** A funded deal; the primary is silenced by the caller to keep it in Delivered. */
async function held(): Promise<{ id: Hex; terms: J }> {
  const a = world.info.adjudicators;
  const offer = await seller.offer({
    template: 'checks-only', clubId: world.info.clubId, seller: seller.address,
    buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
    adjudicators: { primary: a[0]!.address, fallback: a[1]!.address, appeal: a[2]!.address },
    price: { token: 'tUSD', amount: '25000000' },
    deliverable: { kind: 'dataset', description: `rows, early-accept deal ${++deals}`, format: 'text/csv' },
    checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['a'] }],
  });
  await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
  await buyer.agreeAndFund(offer.terms, 100_000_000n);
  return offer;
}

/**
 * A seller that seals the buyer's envelope to `buyerKey` while naming the right recipient (batch 1, F2). It
 * builds the delivery itself, as agent.ts does, but swaps the buyer's key; the settlement layer accepts it.
 */
async function misdirectedDelivery(terms: J, buyerKey: string): Promise<J> {
  const { intent } = await seller.prepareDelivery(terms, WORK);
  const d = intent as Extract<Intent, { kind: 'delivery' }>;
  // Re-seal a fresh content key, so the adjudicators' envelopes stay consistent with the ciphertext.
  const key = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array([...iv, ...new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, WORK))]);
  const stored = await seller.call('POST', '/v1/ciphertext', ciphertext);
  const recipients = await Promise.all(d.encryptedKeys.map(async (k: J, i: number) => ({ address: k.recipient, key: i === 3 ? buyerKey : (await seller.registration(k.recipient)).encryptionPublicKey })));
  const encryptedKeys = recipients.map((r) => {
    const eph = nacl.box.keyPair();
    const nonce = nacl.randomBytes(24);
    return { recipient: r.address, scheme: 'x25519-xsalsa20poly1305', ciphertext: b64(new Uint8Array([...eph.publicKey, ...nonce, ...nacl.box(key, nonce, Buffer.from(r.key, 'base64url'), eph.secretKey)])) };
  });
  const bad: Intent = { ...d, ciphertext: { uri: stored.uri, sha256: stored.id, bytes: ciphertext.length }, encryptedKeys };
  const again = await seller.call('POST', '/v1/prepare/delivery', { commitmentId: commitmentIdOf(terms), ciphertext: bad.ciphertext, plaintextSha256: d.plaintextSha256, encryptedKeys });
  const { body } = await seller.sign(again, bad);
  return body;
}

/** The material an honest buyer gathers: the handed delivery, what settlement holds, the ciphertext bytes. */
async function material(terms: J, delivery: J): Promise<EnvelopeMaterial> {
  return buyer.envelopeMaterial(terms, delivery);
}

describe('early accept opens the buyer envelope first (T-024)', { timeout: 30_000 }, () => {
  it('the right key passes; the accept is signed and the buyer already holds the work', async () => {
    const { id, terms } = await held();
    await silence('primary', true);
    try {
      const { state, delivery } = await seller.deliverAndShare(terms, WORK);
      expect(state.escrowState).toBe('Delivered');
      // The buyer's held envelope is not readable before payment: it opens only from the handed delivery.
      expect((await buyer.call('GET', `/v1/commitments/${id}/key?recipient=${buyer.address}`)).items).toHaveLength(0);
      const m = await material(terms, delivery);
      expect(deliveryHashOf(delivery)).toBe(m.recorded.deliveryHash); // verify.ts computes the settlement layer's hash
      const opened = await openOwnEnvelope(m);
      expect(new TextDecoder().decode(opened.plaintext)).toBe('a\n1\n');
      const accepted = await buyer.earlyAccept(terms, delivery);
      expect(accepted.escrowState).toBe('Released');
      expect(await buyer.openDelivery(id)).toBe('a\n1\n');
    } finally {
      await silence('primary', false);
    }
  });

  it('an envelope sealed to another key refuses, and the deal stays undecided', async () => {
    const { id, terms } = await held();
    await silence('primary', true);
    try {
      const delivery = await misdirectedDelivery(terms, STRANGER_PUBLIC_KEY);
      expect((await seller.call('POST', `/v1/commitments/${id}/deliveries`, delivery)).escrowState).toBe('Delivered'); // settlement cannot tell
      await expect(buyer.earlyAccept(terms, delivery)).rejects.toThrow(/envelope does not open with your encryption key/);
      expect((await buyer.call('GET', `/v1/commitments/${id}`)).escrowState).toBe('Delivered');
    } finally {
      await silence('primary', false);
    }
  });

  it('wrong ciphertext, wrong plaintext hash, a substituted delivery and the wrong buyer key each refuse', async () => {
    const { terms } = await held();
    await silence('primary', true);
    try {
      const { delivery } = await seller.deliverAndShare(terms, WORK);
      const good = await material(terms, delivery);
      // Each case changes one thing; where the delivery changes, `recorded` follows it, so only that check fails.
      const rebind = (d: J): EnvelopeMaterial => ({ ...good, delivery: d, recorded: { ...good.recorded, deliveryHash: deliveryHashOf(d) } });
      const cases: Array<[string, EnvelopeMaterial, RegExp]> = [
        ['wrong ciphertext bytes', { ...good, ciphertext: new Uint8Array([...good.ciphertext.slice(0, -1), good.ciphertext.at(-1)! ^ 1]) }, /ciphertext you fetched/],
        ['ciphertext that does not decrypt', { ...rebind({ ...delivery, ciphertext: { ...delivery.ciphertext, sha256: await sha(new Uint8Array(64)) } }), ciphertext: new Uint8Array(64) }, /does not decrypt with the content key/],
        ['wrong signed plaintext hash', rebind({ ...delivery, plaintextSha256: `sha256:${'1'.repeat(64)}` }), /is not the delivery's signed plaintextSha256/],
        ['a delivery other than the one settlement holds', { ...good, delivery: { ...delivery, plaintextSha256: `sha256:${'1'.repeat(64)}` } }, /not the one the settlement layer holds/],
        ['no envelope for the buyer', rebind({ ...delivery, encryptedKeys: delivery.encryptedKeys.slice(0, 3) }), /no envelope for you/],
        ['two envelopes for the buyer', rebind({ ...delivery, encryptedKeys: [...delivery.encryptedKeys, delivery.encryptedKeys[3]] }), /more than one envelope/],
        ['a key that is not the terms key', { ...good, encryptionSecretKey: new Uint8Array(32).fill(7) }, /not the buyerEncryptionPublicKey in the terms/],
        ['another commitment', { ...good, delivery: { ...delivery, commitmentId: `0x${'cd'.repeat(32)}` } }, /another commitment/],
      ];
      for (const [name, m, why] of cases) await expect(openOwnEnvelope(m), name).rejects.toThrow(why);
      for (const [name, m] of cases) await expect(openOwnEnvelope(m), name).rejects.toBeInstanceOf(Refusal);
    } finally {
      await silence('primary', false);
    }
  });

  it('the verifier refuses an early accept with no opened envelope, a forged one, or one for another deal', async () => {
    const first = await held();
    const { id, terms } = await held();
    await silence('primary', true);
    try {
      const { delivery } = await seller.deliverAndShare(terms, WORK);
      const other = await seller.deliverAndShare(first.terms, WORK);
      const nonce = freshNonce();
      const prepared = await buyer.call('POST', '/v1/prepare/early-accept', { commitmentId: id, nonce });
      expect(prepared.check.join(' ')).toMatch(/open your envelope/);
      const verify = (opened: unknown) => verifyPrepared(prepared, { kind: 'early-accept', terms, nonce, opened } as Intent, buyer.address, SIMCHAIN_DOMAIN, now());
      expect(() => verify(undefined)).toThrow(/open your envelope first/);
      const opened = await openOwnEnvelope(await material(terms, delivery));
      expect(() => verify({ ...opened })).toThrow(/open your envelope first/); // a copy is a promise, not a proof
      const elsewhere = await openOwnEnvelope(await material(first.terms, other.delivery));
      expect(() => verify(elsewhere)).toThrow(/another commitment/);
      expect(verify(opened).toSign).toHaveLength(1);
      const o: Opened = opened;
      expect(o.commitmentId).toBe(id);
    } finally {
      await silence('primary', false);
    }
  });

  it("prepare's agree-and-fund check names the key and asks the buyer to confirm it holds it", async () => {
    const a = world.info.adjudicators;
    const offer = await seller.offer({
      template: 'checks-only', clubId: world.info.clubId, seller: seller.address,
      buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
      adjudicators: { primary: a[0]!.address, fallback: a[1]!.address, appeal: a[2]!.address },
      price: { token: 'tUSD', amount: '1000000' }, deliverable: { kind: 'dataset', description: 'check text', format: 'text/csv' }, checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['a'] }],
    });
    await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
    const prepared = await buyer.call('POST', '/v1/prepare/agree-and-fund', { commitmentId: offer.id, agreeNonce: freshNonce(), fundingNonce: freshNonce() });
    const text = prepared.check.join('\n');
    expect(text).not.toMatch(/sealed to your encryption key/);
    expect(text).toContain(buyer.encryptionPublicKey);
    expect(text).toMatch(/confirm you hold the secret key/);
  });
});
