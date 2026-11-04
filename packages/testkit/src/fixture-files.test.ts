// The club and terms fixture files (fixtures/clubs, fixtures/terms) load into schema-valid values, and the
// settlement layer accepts an offer built from them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { commitmentId, offer, parseCommitment, rulebookHash, type Hex32 } from '@holdback/core';
import { describe, expect, it } from 'vitest';
import { loadClubFile, loadTermsFile, parseClubYaml, parseTermsYaml, termsFromTemplate, type TermsParams } from './fixture-files.js';
import { ScenarioError } from './scenario.js';

const root = new URL('../../../', import.meta.url).pathname;
const CLUB = join(root, 'fixtures/clubs/data-services-v1.yaml');
const TERMS = join(root, 'fixtures/terms/clean-customers-2000.yaml');
const CHECKS_ONLY = join(root, 'fixtures/terms/clean-customers-2000-checks-only.yaml');

const hex32 = (b: string): Hex32 => `0x${b.repeat(32)}` as Hex32;
const addr = (b: string) => `0x${b.repeat(20)}` as const;

function params(over: Partial<TermsParams> = {}): TermsParams {
  return {
    club: loadClubFile(CLUB),
    buyer: addr('b1'),
    seller: addr('5e'),
    adjudicator: addr('a1'),
    fallbackAdjudicator: addr('a2'),
    appealAdjudicator: addr('a3'),
    policyHash: hex32('01'),
    registryHash: hex32('02'),
    buyerEncryptionPublicKey: 'AAAA',
    nonce: hex32('03'),
    createdAt: '2026-11-01T09:00:00Z',
    ...over,
  };
}

describe('fixtures/clubs/data-services-v1.yaml', () => {
  it('loads as a schema-valid club with the spec example rulebook and its computed hash', () => {
    const club = loadClubFile(CLUB);
    const example = JSON.parse(readFileSync(join(root, 'spec/examples/club.example.json'), 'utf8')) as { rulebook: object; rulebookHash: string };
    expect(club.rulebookHash).toBe(example.rulebookHash);
    expect(club.id).toBe('data-services-v1');
    expect(club.rulebook).toEqual(example.rulebook);
    expect(club.rulebookHash).toBe(rulebookHash(example.rulebook));
    expect(club.rulebookHash).toBe('0x140edd090559cb7dd3950b3a8b755b9cca7b81a37d11359738e1b9df7d0d971e');
  });

  it('refuses a rulebookHash written in the file: the loader computes it', () => {
    const src = readFileSync(CLUB, 'utf8') + `rulebookHash: "${hex32('ab')}"\n`;
    expect(() => parseClubYaml(src, 'x.yaml')).toThrow(/rulebookHash/);
  });

  it('refuses a fractional rate (ADR-0022) and a custom YAML tag', () => {
    const src = readFileSync(CLUB, 'utf8');
    expect(() => parseClubYaml(src.replace('appealBondRateBps: 500', 'appealBondRateBps: 5.5'), 'x.yaml')).toThrow(ScenarioError);
    expect(() => parseClubYaml(src.replace('open: true', 'open: !!js/function "x"'), 'x.yaml')).toThrow(ScenarioError);
  });
});

describe('fixtures/terms', () => {
  it('clean-customers-2000 builds terms that parse as a commitment and that core offer accepts under the club rulebook', () => {
    const p = params();
    const terms = termsFromTemplate(loadTermsFile(TERMS), p);
    expect(terms.schemaVersion).toBe('0.7');
    expect(terms.price).toEqual({ token: 'tUSD', amount: '2000000000' });
    expect(terms.adjudication.fee).toEqual({ token: 'tUSD', amount: '50000000' });
    expect(terms.acceptance.deterministicChecks.map((c) => c.id)).toEqual(['cols', 'rows', 'uniq', 'dates', 'id_nulls', 'name_nulls', 'email_nulls', 'emails', 'hidden']);
    expect(terms.acceptance.rubric.criteria.map((c) => c.id)).toEqual(['dedupe_quality', 'no_fabrication', 'notes']);
    expect(terms.timing).toEqual({
      offerExpiresAt: '2026-11-01T09:15:00Z',
      fundBy: '2026-11-01T09:30:00Z',
      deliverBy: '2026-11-03T09:00:00Z',
      judgeBy: '2026-11-03T09:02:00Z',
      fallbackBy: '2026-11-03T09:04:00Z',
      appealWindowSec: 300,
      appealDecideSec: 300,
      maxSubmissions: 1,
    });
    const id = commitmentId(terms);
    const commitment = { ...terms, id, signatures: { seller: `0x${'11'.repeat(65)}` as const } };
    expect(parseCommitment(commitment).ok).toBe(true);
    const scope = { roles: ['seller' as const], maxPerCommitment: terms.price, maxDaily: terms.price, expiresAt: '2027-01-01T00:00:00Z' };
    const r = offer({ commitment, at: terms.createdAt, sellerScope: scope, rulebook: p.club.rulebook, nonceUsed: false });
    expect(r.ok ? r.value.kind : r.error).toBe('Offered');
  });

  it('clean-customers-2000-checks-only has the same checks without hidden and an empty rubric', () => {
    const full = loadTermsFile(TERMS);
    const only = loadTermsFile(CHECKS_ONLY);
    expect(only.acceptance.rubric).toEqual({ passThreshold: 0, criteria: [] });
    expect(only.acceptance.deterministicChecks).toEqual(full.acceptance.deterministicChecks.filter((c) => c.id !== 'hidden'));
    expect({ ...only, acceptance: null }).toEqual({ ...full, acceptance: null });
    const terms = termsFromTemplate(only, params());
    expect(parseCommitment({ ...terms, id: commitmentId(terms), signatures: { seller: `0x${'11'.repeat(65)}` } }).ok).toBe(true);
  });

  it('refuses money written as a YAML number, an unknown key and a club that does not match clubId', () => {
    const src = readFileSync(TERMS, 'utf8');
    expect(() => parseTermsYaml(src.replace('amount: "2000000000"', 'amount: 2000000000'), 'x.yaml')).toThrow(/amount/);
    expect(() => parseTermsYaml(`${src}buyer: "${addr('b1')}"\n`, 'x.yaml')).toThrow(/buyer/);
    expect(() => parseTermsYaml(src.replace('deliverWithinSec: 172800', 'deliverWithinSec: 1.5'), 'x.yaml')).toThrow(/deliverWithinSec/);
    const other = { ...loadClubFile(CLUB), id: 'another-club' };
    expect(() => termsFromTemplate(loadTermsFile(TERMS), params({ club: other }))).toThrow(/clubId/);
  });
});
