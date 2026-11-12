import { parseCommitment, type Hex32 } from '@holdback/core';
import { describe, expect, it } from 'vitest';
import { testAccount } from './accounts.js';
import { checksOnlyTerms, completeTerms, defaultTerms, DEFAULT_TIMING } from './terms.js';
import { wholeTusd } from './units.js';

const buyer = testAccount('terms/buyer');
const h = (n: number): Hex32 => `0x${n.toString(16).padStart(64, '0')}`;
const adjudicators = { primary: testAccount('terms/a').address, fallback: testAccount('terms/b').address, appeal: testAccount('terms/c').address };
const resolved = { seller: testAccount('terms/seller').address, rulebookHash: h(1), policyId: 'sim-a/p1', policyHash: h(2), registryHash: h(3), fee: wholeTusd('1'), nonce: h(4), createdAt: '2026-11-01T09:00:00Z' };
const csv = { kind: 'dataset', description: 'A cleaned customer list.', format: 'text/csv' } as const;

describe('terms presets', () => {
  it('defaultTerms fills timing, settlement, remedy and disclosure, and completes to a valid commitment', () => {
    const draft = defaultTerms({
      clubId: 'sim-club',
      buyer: buyer.identity,
      adjudicators,
      price: wholeTusd('25'),
      deliverable: { kind: 'document', description: 'Translate a memo.', format: 'text/plain' },
      rubric: { passThreshold: 300, criteria: [{ id: 'faithful', description: 'Meaning preserved.', weight: 1, anchors: { '0': 'No', '2': 'Partly', '4': 'Yes' } }] },
    });
    expect(draft.timing).toEqual(DEFAULT_TIMING);
    const terms = completeTerms(draft, resolved);
    expect(terms.timing.offerExpiresAt).toBe('2026-11-01T09:15:00Z');
    expect(terms.timing.deliverBy).toBe('2026-11-02T09:00:00Z');
    expect(terms.timing.judgeBy).toBe('2026-11-02T09:05:00Z');
    expect(terms.settlement).toEqual({ mode: 'guaranteed_on_decision', token: 'tUSD' });
    expect(terms.buyerEncryptionPublicKey).toBe(buyer.encryptionPublicKey);
    const r = parseCommitment({ ...terms, id: h(9), signatures: { seller: `0x${'1'.repeat(130)}` } });
    expect(r.ok ? 'ok' : r.error.detail).toBe('ok');
  });

  it('defaultTerms needs a rubric; checks-only terms need at least one check and sit no panel', () => {
    expect(() => defaultTerms({ clubId: 'sim-club', buyer: buyer.identity, adjudicators, price: wholeTusd('25'), deliverable: csv })).toThrow(/rubric/);
    expect(() => checksOnlyTerms({ clubId: 'sim-club', buyer: buyer.identity, adjudicators, price: wholeTusd('25'), deliverable: csv, checks: [] })).toThrow(/check/);
    const draft = checksOnlyTerms({
      clubId: 'sim-club',
      buyer: buyer.identity,
      adjudicators,
      price: wholeTusd('25'),
      deliverable: csv,
      checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['id', 'email'] }],
    });
    expect(draft.acceptance.rubric).toEqual({ criteria: [], passThreshold: 0 });
    const r = parseCommitment({ ...completeTerms(draft, resolved), id: h(9), signatures: { seller: `0x${'1'.repeat(130)}` } });
    expect(r.ok ? 'ok' : r.error.detail).toBe('ok');
  });

  it('refuses a createdAt that is not a whole second', () => {
    const draft = checksOnlyTerms({ clubId: 'sim-club', buyer: buyer.identity, adjudicators, price: wholeTusd('25'), deliverable: csv, checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['id'] }] });
    expect(() => completeTerms(draft, { ...resolved, createdAt: '2026-11-01T09:00:00.500Z' })).toThrow(/whole/);
  });
});
