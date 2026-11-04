// The round's chain helpers, offline: the chain guard (the check docs/team.md pairs with the no-real-money rule), the
// CPP payment key against the buyer's funding nonce, and the per-role encryption keys.
import { generatePrivateKey } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { SEPOLIA } from './deployments.ts';
import { ANVIL_CHAIN_ID, assertRoundChain, paymentHashOf, SEPOLIA_CHAIN_ID, termsTuple } from './e2e-chain.ts';
import { roundEncryptionKey, roundKey } from './e2e-keys.ts';
import { commitmentIdOf, fundingNonceOf, pinOf } from './verify.ts';

/** Public terms in the shape the operators serve, on Sepolia's token. */
const terms = {
  schemaVersion: '0.7', clubId: 'demo-club', rulebookHash: `0x${'11'.repeat(32)}`,
  buyer: '0x59d794504087069ded88dc3c8f3ff9dda8e44e36', seller: '0xd89876c20a42ffa707d0bb7a72607a03d5423ed7',
  deliverable: { kind: 'dataset', description: 'customers.csv', format: 'text/csv' },
  acceptance: { deterministicChecks: [{ id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 }], rubric: { criteria: [], passThreshold: 0 } },
  price: { token: SEPOLIA!.token.address.toLowerCase(), amount: '25000000' },
  adjudication: { adjudicator: '0x71f8a3e163528c773fb358a718294a0b32697c9e', fallbackAdjudicator: '0x0000000000000000000000000000000000000b0b', appealAdjudicator: '0x0000000000000000000000000000000000000c0c', policyId: 'demo-policy', fee: { token: SEPOLIA!.token.address.toLowerCase(), amount: '1000000' }, registryHash: `0x${'22'.repeat(32)}`, policyHash: `0x${'33'.repeat(32)}` },
  timing: { offerExpiresAt: '2026-11-04T10:00:00Z', fundBy: '2026-11-04T10:15:00Z', deliverBy: '2026-11-05T10:00:00Z', judgeBy: '2026-11-05T10:01:00Z', fallbackBy: '2026-11-05T10:02:00Z', appealWindowSec: 60, appealDecideSec: 60, maxSubmissions: 1 },
  settlement: { mode: 'guaranteed_on_decision', token: SEPOLIA!.token.address.toLowerCase() }, remedy: { onReject: 'full_refund' }, disclosure: { level: 'public' },
  buyerEncryptionPublicKey: 'A'.repeat(43), nonce: `0x${'44'.repeat(32)}`, createdAt: '2026-11-04T09:45:00Z',
};

describe('assertRoundChain', () => {
  it('refuses a mainnet, by name', () => {
    expect(() => assertRoundChain(1, 1)).toThrow(/chain 1 is a mainnet \(hard rule: no real money\)/);
    expect(() => assertRoundChain(8453, SEPOLIA_CHAIN_ID)).toThrow(/mainnet/);
  });
  it('refuses any chain but Sepolia and anvil, and an RPC on another chain than the pin', () => {
    expect(() => assertRoundChain(17000, 17000)).toThrow(/neither Sepolia \(11155111\) nor anvil \(31337\)/);
    expect(() => assertRoundChain(ANVIL_CHAIN_ID, SEPOLIA_CHAIN_ID)).toThrow(/the RPC serves chain 31337, but the pinned deployment is on chain 11155111/);
  });
  it('accepts Sepolia and anvil when the RPC matches the pin', () => {
    expect(() => assertRoundChain(SEPOLIA_CHAIN_ID, SEPOLIA_CHAIN_ID)).not.toThrow();
    expect(() => assertRoundChain(ANVIL_CHAIN_ID, ANVIL_CHAIN_ID)).not.toThrow();
  });
});

describe('paymentHashOf', () => {
  it("with the payer zeroed, equals the buyer's funding nonce (ADR-0025), and differs with the buyer as payer", () => {
    const id = commitmentIdOf(terms);
    const nonce = fundingNonceOf(terms, id, pinOf(SEPOLIA!).chain!);
    expect(paymentHashOf(terms, id, SEPOLIA!, '0x0000000000000000000000000000000000000000')).toBe(nonce);
    expect(paymentHashOf(terms, id, SEPOLIA!)).not.toBe(nonce);
  });
});

describe('termsTuple', () => {
  it('carries the enforced fields in the clear and the timing in seconds', () => {
    const t = termsTuple(terms);
    expect(t.price).toBe(25_000_000n);
    expect(t.fee).toBe(1_000_000n);
    expect(t.buyer).toBe('0x59D794504087069Ded88Dc3c8f3FF9dda8E44e36');
    expect(t.timing.deliverBy).toBe(BigInt(Date.parse('2026-11-05T10:00:00Z') / 1000));
    expect(t.timing.maxSubmissions).toBe(1);
    expect(t.timing.disputeBy).toBe(0n);
  });
});

describe('roundEncryptionKey', () => {
  it('is 32 bytes, the same every time, distinct per role and from the signing key', () => {
    const seed = generatePrivateKey();
    const buyer = roundEncryptionKey(seed, 'buyer');
    expect(buyer).toHaveLength(32);
    expect(roundEncryptionKey(seed, 'buyer')).toEqual(buyer);
    expect(roundEncryptionKey(seed, 'seller')).not.toEqual(buyer);
    expect(Buffer.from(buyer).toString('hex')).not.toBe(roundKey(seed, 'buyer').slice(2));
    expect(() => roundEncryptionKey('0x12', 'buyer')).toThrow(/32 bytes/);
  });
});
