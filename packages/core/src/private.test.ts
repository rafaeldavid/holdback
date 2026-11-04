// ADR-0024 (D34), stage 2a: two-part encrypted terms, the settlement projection, and the three new typed messages.
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { canonicalJson, canonicalKeccak } from './canonical.js';
import { CryptoError, encodePublicKey, generateEncryptionKeyPair } from './crypto/index.js';
import { commitmentId, holdbackDomain, signMessage, signTerms, termsDigest, typedDataOf, verifyMessage, verifyTerms } from './eip712.js';
import { parseAnyCommitment, parseMessage } from './parse.js';
import {
  isSealed,
  openPart,
  openTerms,
  parseReadTokenHeader,
  partKey,
  projectionOf,
  readTokenHeader,
  sealTerms,
  verifyDelegation,
} from './private.js';
import type { CommitmentTerms, Delegation, KeyRegistration, ReadToken } from './types.js';

const domain = holdbackDomain(31337);
const SELLER_KEY = `0x${'11'.repeat(32)}` as const;
const BUYER_KEY = `0x${'22'.repeat(32)}` as const;
const LONG_TERM_KEY = `0x${'33'.repeat(32)}` as const;
const seller = privateKeyToAccount(SELLER_KEY).address.toLowerCase() as `0x${string}`;
const buyer = privateKeyToAccount(BUYER_KEY).address.toLowerCase() as `0x${string}`;
const longTerm = privateKeyToAccount(LONG_TERM_KEY).address.toLowerCase() as `0x${string}`;
const PRIMARY = '0x5d10fecab9242e66cb134b77309a3566ed75e3dd' as const;
const OUTSIDER = '0x0000000000000000000000000000000000000bad' as const;

const buyerEnc = generateEncryptionKeyPair();
const primaryEnc = generateEncryptionKeyPair();
const outsiderEnc = generateEncryptionKeyPair();
const sellerEnc = generateEncryptionKeyPair();

const CANARY_D = 'CANARY-DELIVERABLE-7f3a';
const CANARY_A = 'CANARY-ACCEPTANCE-9b2c';

function terms(): CommitmentTerms {
  return {
    schemaVersion: '0.7',
    clubId: 'sim-club',
    rulebookHash: `0x${'ab'.repeat(32)}`,
    buyer,
    seller,
    deliverable: { kind: 'dataset', description: `clean the list ${CANARY_D}`, format: 'text/csv', salt: `0x${'5a'.repeat(32)}`, sellerEncryptionPublicKey: encodePublicKey(sellerEnc.publicKey) },
    acceptance: {
      deterministicChecks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['id', CANARY_A] }],
      rubric: { criteria: [], passThreshold: 0 },
      salt: `0x${'6b'.repeat(32)}`,
    },
    price: { token: 'tUSD', amount: '5000000' } as CommitmentTerms['price'],
    adjudication: {
      adjudicator: PRIMARY,
      fallbackAdjudicator: '0xf9e6283d068ff7016653ab6d36a7fab0294f4b8a',
      appealAdjudicator: '0xc372bd536a0f63fe9fde6bca1db179ce93612520',
      policyId: 'p1',
      fee: { token: 'tUSD', amount: '1000000' } as CommitmentTerms['price'],
      registryHash: `0x${'cd'.repeat(32)}`,
      policyHash: `0x${'ef'.repeat(32)}`,
    },
    timing: {
      offerExpiresAt: '2026-11-01T10:15:00Z',
      fundBy: '2026-11-01T10:30:00Z',
      deliverBy: '2026-11-02T10:00:00Z',
      judgeBy: '2026-11-02T10:05:00Z',
      fallbackBy: '2026-11-02T10:10:00Z',
      appealWindowSec: 300,
      appealDecideSec: 300,
      maxSubmissions: 1,
    },
    settlement: { mode: 'guaranteed_on_decision', token: 'tUSD' },
    remedy: { onReject: 'full_refund' },
    disclosure: { level: 'private' },
    buyerEncryptionPublicKey: encodePublicKey(buyerEnc.publicKey),
    nonce: `0x${'01'.repeat(32)}`,
    createdAt: '2026-11-01T10:00:00Z',
  };
}

const readers = [
  { recipient: buyer, publicKey: buyerEnc.publicKey },
  { recipient: PRIMARY, publicKey: primaryEnc.publicKey },
];

describe('two-part encrypted terms (ADR-0024 §2)', () => {
  it('keeps the commitment ID and the seller signature: the struct binds only the body hashes', async () => {
    const plain = terms();
    const { sealed, id } = await sealTerms(plain, readers);
    expect(id).toBe(commitmentId(plain));
    expect(commitmentId(sealed)).toBe(id);
    expect(termsDigest(domain, sealed)).toBe(termsDigest(domain, plain));
    const sig = await signTerms(SELLER_KEY, domain, plain);
    expect(await verifyTerms(domain, sealed, sig, seller)).toBe(true);
    expect(sealed.privateTerms.deliverable.hash).toBe(canonicalKeccak(plain.deliverable));
    expect(sealed.privateTerms.acceptance.hash).toBe(canonicalKeccak(plain.acceptance));
  });

  it('carries no plaintext: the canaries are absent from the sealed form', async () => {
    const { sealed } = await sealTerms(terms(), readers);
    const wire = JSON.stringify(sealed);
    expect(wire).not.toContain(CANARY_D);
    expect(wire).not.toContain(CANARY_A);
    expect(isSealed(sealed)).toBe(true);
    expect(isSealed(terms())).toBe(false);
  });

  it('parses as a private commitment, and the plaintext form at private does not', async () => {
    const plain = terms();
    const { sealed, id } = await sealTerms(plain, readers);
    const sig = await signTerms(SELLER_KEY, domain, plain);
    const p = parseAnyCommitment({ ...sealed, id, signatures: { seller: sig } });
    expect(p.ok, p.ok ? '' : p.error.detail).toBe(true);
    const r = parseAnyCommitment({ ...plain, id, signatures: { seller: sig } });
    expect(r.ok).toBe(false);
  });

  it('opens for the buyer and the primary, and for nobody else', async () => {
    const plain = terms();
    const { sealed, id } = await sealTerms(plain, readers);
    expect(await openTerms(sealed, id, buyer, buyerEnc.secretKey)).toEqual(plain);
    expect(await openTerms(sealed, id, PRIMARY, primaryEnc.secretKey)).toEqual(plain);
    await expect(openTerms(sealed, id, OUTSIDER, outsiderEnc.secretKey)).rejects.toThrow(CryptoError);
    await expect(openTerms(sealed, id, buyer, outsiderEnc.secretKey)).rejects.toThrow(CryptoError);
  });

  it('uses two keys: the acceptance key does not open the deliverable', async () => {
    const { sealed, id, keys } = await sealTerms(terms(), readers);
    const acceptance = await openPart(sealed.privateTerms.acceptance, id, 'acceptance', keys.acceptance);
    expect(canonicalJson(acceptance)).toContain(CANARY_A);
    await expect(openPart(sealed.privateTerms.deliverable, id, 'deliverable', keys.acceptance)).rejects.toThrow(CryptoError);
  });

  it('binds each part to its commitment and name (AAD): swapped parts or another ID do not open', async () => {
    const { sealed, id, keys } = await sealTerms(terms(), readers);
    await expect(openPart(sealed.privateTerms.deliverable, id, 'acceptance', keys.deliverable)).rejects.toThrow(CryptoError);
    await expect(openPart(sealed.privateTerms.deliverable, `0x${'00'.repeat(32)}`, 'deliverable', keys.deliverable)).rejects.toThrow(CryptoError);
  });

  it('refuses a part whose plaintext does not hash to the bound hash', async () => {
    const { sealed, id } = await sealTerms(terms(), readers);
    const lying = { ...sealed, privateTerms: { ...sealed.privateTerms, deliverable: { ...sealed.privateTerms.deliverable, hash: `0x${'99'.repeat(32)}` as const } } };
    const key = partKey(sealed.privateTerms.deliverable, buyer, buyerEnc.secretKey);
    await expect(openPart(lying.privateTerms.deliverable, id, 'deliverable', key)).rejects.toThrow(/hash/);
  });
});

describe('settlement projection (ADR-0024 §3, §8)', () => {
  it('names the per-deal parties, money and deadlines, and hashes the rest', async () => {
    const plain = terms();
    const { sealed, id } = await sealTerms(plain, readers);
    const p = projectionOf({ ...sealed, id, signatures: { seller: `0x${'00'.repeat(65)}` } });
    expect(p.commitmentId).toBe(id);
    expect(p.buyer).toBe(buyer);
    expect(p.hashes.deliverableHash).toBe(canonicalKeccak(plain.deliverable));
    const text = JSON.stringify(p);
    for (const hidden of [CANARY_D, CANARY_A, 'sim-club', plain.buyerEncryptionPublicKey, sealed.privateTerms.deliverable.ciphertext]) expect(text).not.toContain(hidden);
  });
});

describe('ReadToken, Delegation, KeyRegistration (ADR-0024 §3, §6, §7)', () => {
  const token = (audience?: `0x${string}`): Omit<ReadToken, 'signature'> => ({
    type: 'ReadToken',
    viewer: buyer,
    commitmentId: `0x${'aa'.repeat(32)}`,
    ...(audience ? { audience } : {}),
    nonce: `0x${'0f'.repeat(32)}`,
    expiresAt: '2026-11-01T11:00:00Z',
  });

  it('signs a ReadToken; the audience is bound, so a token for one operator is a different message for another', async () => {
    const opA = '0x00000000000000000000000000000000000000a1' as const;
    const opB = '0x00000000000000000000000000000000000000b2' as const;
    const t: ReadToken = { ...token(opA), signature: await signMessage(BUYER_KEY, domain, token(opA)) };
    expect(parseMessage(t).ok).toBe(true);
    expect(await verifyMessage(domain, t, buyer)).toBe(true);
    expect(await verifyMessage(domain, { ...t, audience: opB }, buyer)).toBe(false);
    expect(await verifyMessage(domain, { ...token(), signature: t.signature } as ReadToken, buyer)).toBe(false);
    expect(typedDataOf(token()).message['hasAudience']).toBe(false);
  });

  it('round-trips a ReadToken through the Authorization header', async () => {
    const t: ReadToken = { ...token(), signature: await signMessage(BUYER_KEY, domain, token()) };
    const h = readTokenHeader(t);
    expect(h).toMatch(/^Holdback-ReadToken [A-Za-z0-9_-]+$/);
    const back = parseReadTokenHeader(h);
    expect(back.ok && back.value).toEqual(t);
    expect(parseReadTokenHeader('Bearer x').ok).toBe(false);
    expect(parseReadTokenHeader('Holdback-ReadToken !!!').ok).toBe(false);
  });

  it('verifies a Delegation signed by the long-term key for this per-deal key', async () => {
    const unsigned: Omit<Delegation, 'signature'> = {
      type: 'Delegation',
      principal: '0x23f0af4dc12c97f0714cd2b12f30dd95da5dd5e4',
      agent: longTerm,
      dealKey: buyer,
      dealEncryptionKey: encodePublicKey(buyerEnc.publicKey),
      clubId: 'sim-club',
      scope: { roles: ['buyer'], maxPerCommitment: { token: 'tUSD', amount: '9000000' } as CommitmentTerms['price'], maxDaily: { token: 'tUSD', amount: '9000000' } as CommitmentTerms['price'], expiresAt: '2027-01-01T00:00:00Z' },
      nonce: `0x${'0e'.repeat(32)}`,
      expiresAt: '2026-11-02T00:00:00Z',
    };
    const d: Delegation = { ...unsigned, signature: await signMessage(LONG_TERM_KEY, domain, unsigned) };
    expect(parseMessage(d).ok).toBe(true);
    const ok = await verifyDelegation(domain, d, { dealKey: buyer, dealEncryptionKey: unsigned.dealEncryptionKey, clubId: 'sim-club', role: 'buyer', price: { token: 'tUSD', amount: '5000000' } as CommitmentTerms['price'], at: '2026-11-01T10:00:00Z' });
    expect(ok).toEqual({ ok: true, value: true });
    const forged: Delegation = { ...d, signature: await signMessage(BUYER_KEY, domain, unsigned) }; // signed by the deal key itself
    expect((await verifyDelegation(domain, forged, { dealKey: buyer, clubId: 'sim-club', role: 'buyer', price: { token: 'tUSD', amount: '1' } as CommitmentTerms['price'], at: '2026-11-01T10:00:00Z' })).ok).toBe(false);
    const other = await verifyDelegation(domain, d, { dealKey: seller, clubId: 'sim-club', role: 'buyer', price: { token: 'tUSD', amount: '1' } as CommitmentTerms['price'], at: '2026-11-01T10:00:00Z' });
    expect(other.ok).toBe(false);
    const over = await verifyDelegation(domain, d, { dealKey: buyer, clubId: 'sim-club', role: 'buyer', price: { token: 'tUSD', amount: '9000001' } as CommitmentTerms['price'], at: '2026-11-01T10:00:00Z' });
    expect(over.ok).toBe(false);
    const role = await verifyDelegation(domain, d, { dealKey: buyer, clubId: 'sim-club', role: 'seller', price: { token: 'tUSD', amount: '1' } as CommitmentTerms['price'], at: '2026-11-01T10:00:00Z' });
    expect(role.ok).toBe(false);
  });

  it('signs a KeyRegistration', async () => {
    const unsigned: Omit<KeyRegistration, 'signature'> = { type: 'KeyRegistration', adjudicator: buyer, encryptionPublicKey: encodePublicKey(primaryEnc.publicKey), keyId: 'k-2026-11', nonce: `0x${'0d'.repeat(32)}`, expiresAt: '2027-11-01T00:00:00Z' };
    const k: KeyRegistration = { ...unsigned, signature: await signMessage(BUYER_KEY, domain, unsigned) };
    expect(parseMessage(k).ok).toBe(true);
    expect(await verifyMessage(domain, k, buyer)).toBe(true);
    expect(await verifyMessage(domain, { ...k, keyId: 'k-2026-12' }, buyer)).toBe(false);
  });
});
