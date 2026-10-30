import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { rulebookHash } from './canonical.js';
import { commitmentId, holdbackDomain, messageDigest, termsDigest, termsOf, typedDataOf, type UnsignedMessage } from './eip712.js';
import { parseClub, parseCommitment, parseCommitmentState, parseDelivery, parseMandate, parseMessage, parsers } from './parse.js';
import { offer } from './state.js';
import { validateTiming } from './timing.js';
import type { Commitment, Rulebook } from './types.js';

const exampleDir = new URL('../../../spec/examples/', import.meta.url);
const schemaDir = new URL('../../../spec/schemas/', import.meta.url);
const examples = readdirSync(exampleDir)
  .filter((f) => f.endsWith('.example.json'))
  .map((file) => ({ file, data: JSON.parse(readFileSync(new URL(file, exampleDir), 'utf8')) as unknown }));
const schemaNames = readdirSync(schemaDir)
  .filter((f) => f.endsWith('.schema.json'))
  .map((f) => f.replace('.schema.json', ''));

function example(file: string): Record<string, unknown> {
  const found = examples.find((e) => e.file === file);
  if (!found) throw new Error(`missing example ${file}`);
  return structuredClone(found.data) as Record<string, unknown>;
}

describe('boundary parsers', () => {
  it('has a parser for every schema except the shared definitions', () => {
    expect(Object.keys(parsers).sort()).toEqual(schemaNames.filter((n) => n !== 'common').sort());
  });

  it('covers every example file', () => {
    expect(examples.length).toBeGreaterThanOrEqual(15);
  });

  it.each(examples.map((e) => [e.file, e.data] as const))('round-trips %s', (file, data) => {
    const parse = parsers[file.split('.')[0] as keyof typeof parsers];
    const first = parse(data);
    expect(first).toEqual({ ok: true, value: data });
    if (!first.ok) return;
    const again = parse(JSON.parse(JSON.stringify(first.value)));
    expect(again).toEqual(first);
  });

  it('refuses a fractional amount with invalid_terms and names the path', () => {
    const c = example('commitment.example.json');
    (c['price'] as Record<string, unknown>)['amount'] = '2000.5';
    const r = parseCommitment(c);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.type).toBe('invalid_terms');
      expect(r.error.detail).toContain('/price/amount');
    }
  });

  it('refuses non-objects', () => {
    expect(parseCommitment('nope').ok).toBe(false);
    expect(parseCommitment(null).ok).toBe(false);
  });

  it('accepts a SimChain beacon on a Decision and refuses other sources in Phase 1 (ADR-0018)', () => {
    const d = example('messages.decision.example.json');
    d['role'] = 'fallback';
    d['beacon'] = { source: 'sim', round: 1200, value: `0x${'11'.repeat(32)}` };
    expect(parseMessage(d).ok).toBe(true);
    d['beacon'] = { source: 'drand-quicknet', round: 1200, value: `0x${'11'.repeat(32)}`, signature: `0x${'ab'.repeat(48)}` };
    const r = parseMessage(d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.detail).toContain('sim only');
  });

  it('refuses optimistic commitments in Phase 1 (ADR-0015 is built in Phase 4)', () => {
    const c = example('commitment.example.json');
    (c['settlement'] as Record<string, unknown>)['mode'] = 'optimistic';
    Object.assign(c['timing'] as Record<string, unknown>, { disputeBy: '2026-11-06T17:00:00Z', disputeJudgeSec: 86400, disputeFallbackSec: 86400 });
    const r = parseCommitment(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.detail).toContain('not supported in Phase 1');
  });

  it('refuses settle_after_window in Phase 1', () => {
    const c = example('commitment.example.json');
    (c['settlement'] as Record<string, unknown>)['mode'] = 'settle_after_window';
    const r = parseCommitment(c);
    expect(r).toMatchObject({ ok: false, error: { type: 'invalid_terms' } });
    if (!r.ok) expect(r.error.detail).toContain('guaranteed_on_decision');
  });

  it('refuses maxSubmissions above 1 in Phase 1', () => {
    const c = example('commitment.example.json');
    (c['timing'] as Record<string, unknown>)['maxSubmissions'] = 2;
    const r = parseCommitment(c);
    expect(r).toMatchObject({ ok: false, error: { type: 'invalid_terms' } });
    if (!r.ok) expect(r.error.detail).toContain('maxSubmissions');
  });

  it('narrows messages by type', () => {
    const r = parseMessage(example('messages.decision.example.json'));
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === 'Decision') expect(r.value.outcome).toBe('accept');
  });

  it('refuses a message with an unknown type', () => {
    const m = example('messages.decision.example.json');
    m['type'] = 'Steal';
    expect(parseMessage(m).ok).toBe(false);
  });
});

type Patch = (c: Record<string, any>) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

const OVER_UINT256 = (2n ** 256n).toString(); // 78 digits, passes the schema pattern

describe('parseCommitment refuses values that cannot be signed or settled', () => {
  it.each<[string, Patch]>([
    ['a fractional-second deadline', (c) => (c.timing.fundBy = '2026-10-30T10:30:00.500Z')],
    ['a fractional-second createdAt', (c) => (c.createdAt = '2026-10-30T10:00:00.1Z')],
    ['a pre-1970 createdAt', (c) => (c.createdAt = '1969-12-31T23:59:59Z')],
    ['a leap-second timestamp Date cannot parse', (c) => (c.timing.judgeBy = '2026-12-31T23:59:60Z')],
    ['a lowercase t and z', (c) => (c.timing.judgeBy = '2026-11-01t10:02:00z')],
    ['createdAt at the offer expiry', (c) => (c.createdAt = c.timing.offerExpiresAt)],
    ['a bad mixed-case checksum address', (c) => (c.buyer = '0x04D6c65223896ba94e731bc9eb765c19bd289b0d')],
    ['appealWindowSec 1e15', (c) => (c.timing.appealWindowSec = 1e15)],
    ['appealWindowSec 2^60', (c) => (c.timing.appealWindowSec = 2 ** 60)],
    ['appealDecideSec 1e20', (c) => (c.timing.appealDecideSec = 1e20)],
    ['a price above uint256', (c) => (c.price.amount = OVER_UINT256)],
    ['a fee above uint256', (c) => (c.adjudication.fee.amount = OVER_UINT256)],
    ['an acceptance bond above uint256', (c) => (c.adjudicatorAcceptance.bondReserved.amount = OVER_UINT256)],
  ])('refuses %s with invalid_terms', (_name, patch) => {
    const c = example('commitment.example.json');
    patch(c);
    expect(parseCommitment(c)).toMatchObject({ ok: false, error: { type: 'invalid_terms' } });
  });

  it('accepts a correctly checksummed address', () => {
    const c = example('commitment.example.json');
    c['buyer'] = '0x04D6c65223896Ba94e731bc9eB765C19Bd289b0d';
    expect(parseCommitment(c).ok).toBe(true);
  });

  it('accepts the largest uint256 amount', () => {
    const c = example('commitment.example.json');
    (c['price'] as Record<string, unknown>)['amount'] = (2n ** 256n - 1n).toString();
    expect(parseCommitment(c).ok).toBe(true);
  });
});

describe('other parsers refuse the same values', () => {
  it.each<[string, (json: unknown) => { ok: boolean }, string, Patch]>([
    ['a funding value above uint256', parseMessage, 'messages.funding.example.json', (m) => (m.value = OVER_UINT256)],
    ['a funding value with a leading zero', parseMessage, 'messages.funding.example.json', (m) => (m.value = '02050000000')],
    ['a decision attempt above uint8', parseMessage, 'messages.decision.example.json', (m) => (m.attempt = 256)],
    ['a fractional-second message expiry', parseMessage, 'messages.decision.example.json', (m) => (m.expiresAt = '2026-11-01T10:02:00.5Z')],
    ['a bad checksum adjudicator', parseMessage, 'messages.decision.example.json', (m) => (m.adjudicator = '0x5D10fecab9242e66cb134b77309a3566ed75e3dd')],
    ['a fractional-second delivery time', parseDelivery, 'delivery.example.json', (d) => (d.submittedAt = '2026-11-01T09:00:00.5Z')],
    ['a mandate cap above uint256', parseMandate, 'mandate.example.json', (m) => (m.scope.maxDaily.amount = OVER_UINT256)],
    ['a read-model balance above uint256', parseCommitmentState, 'commitment-state.example.json', (s) => (s.hold = { amount: { token: 'tUSD', amount: OVER_UINT256 }, railRef: 'x' })],
  ])('refuses %s', (_name, parse, file, patch) => {
    const v = example(file);
    patch(v);
    expect(parse(v)).toMatchObject({ ok: false, error: { type: 'invalid_terms' } });
  });
});

describe('parser hygiene', () => {
  it('returns a copy, so later changes to the input do not reach the parsed value', () => {
    const c = example('commitment.example.json');
    const r = parseCommitment(c);
    if (!r.ok) throw new Error(r.error.detail);
    expect(r.value).not.toBe(c);
    (c['price'] as Record<string, unknown>)['amount'] = '1';
    expect(r.value.price.amount).toBe('2000000000');
  });

  it('stops at the first schema error on untrusted input', () => {
    const c = example('commitment.example.json');
    c['buyer'] = 'nope';
    c['seller'] = 'nope';
    const r = parseCommitment(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.detail.split(';')).toHaveLength(1);
  });

  it('refuses values structuredClone cannot copy', () => {
    const c = example('commitment.example.json');
    c['extra'] = () => 1;
    expect(parseCommitment(c).ok).toBe(false);
  });
});

// A small valid-looking change to the current value, so most mutants still parse and reach core.
const NUDGE = Symbol('nudge');
function nudge(v: unknown): unknown {
  if (typeof v === 'boolean') return !v;
  if (typeof v === 'number') return v + 1;
  if (typeof v !== 'string') return v;
  if (/^0x[0-9a-fA-F]+$/.test(v)) return v.slice(0, -1) + (v.endsWith('0') ? '1' : '0');
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(Date.parse(v) + 1000).toISOString().replace('.000Z', 'Z');
  if (/^\d+$/.test(v)) return (BigInt(v) + 1n).toString();
  return `${v}x`;
}
// Fixed seed: property runs are reproducible, so the suite and the mutation sweep are deterministic.
const SEED = 20261030;

// Anything a parser accepts must be safe to hand to the rest of core: no throws downstream.
const nasty = fc.constantFrom<unknown>(
  '2026-10-30T10:30:00.500Z',
  '1969-12-31T23:59:59Z',
  '2026-12-31T23:59:60Z',
  '9999-12-31T23:59:59Z',
  '0x04D6c65223896ba94e731bc9eb765c19bd289b0d',
  '0x04D6c65223896Ba94e731bc9eB765C19Bd289b0d',
  1e15,
  2 ** 60,
  1e20,
  2 ** 32,
  0,
  -1,
  255,
  256,
  OVER_UINT256,
  (2n ** 256n - 1n).toString(),
  '0',
  '',
  'x',
  'settle_after_window',
);
const anyValue = fc.oneof(fc.constant(NUDGE), fc.constant(NUDGE), nasty, fc.string(), fc.integer(), fc.double(), fc.boolean(), fc.bigInt({ min: 0n, max: 2n ** 260n }).map(String));

function leafPaths(value: unknown, path: string[] = []): string[][] {
  if (Array.isArray(value)) return value.flatMap((v, i) => leafPaths(v, [...path, String(i)]));
  if (value !== null && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => leafPaths(v, [...path, k]));
  return [path];
}

function withMutations(base: Record<string, unknown>, edits: Array<[number, unknown]>): Record<string, unknown> {
  const copy = structuredClone(base);
  const paths = leafPaths(copy);
  for (const [i, v] of edits) {
    const path = paths[i % paths.length]!;
    let cur = copy as Record<string, unknown>;
    for (const k of path.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
    const key = path[path.length - 1]!;
    cur[key] = v === NUDGE ? nudge(cur[key]) : v;
  }
  return copy;
}

const club = parseClub(example('club.example.json'));
if (!club.ok) throw new Error('club example must parse');
const rulebook: Rulebook = club.value.rulebook;
const domain = holdbackDomain(31337);
const edits = fc.array(fc.tuple(fc.nat(), anyValue), { minLength: 1, maxLength: 3 });

describe('parsed input never makes core throw', () => {
  it('commitments: commitmentId, termsDigest, validateTiming and offer', () => {
    let accepted = 0;
    fc.assert(
      fc.property(edits, (e) => {
        const r = parseCommitment(withMutations(example('commitment.example.json'), e));
        if (!r.ok) return;
        accepted++;
        const terms = { ...termsOf(r.value), rulebookHash: rulebookHash(rulebook) };
        const c: Commitment = { ...terms, id: commitmentId(terms), signatures: r.value.signatures };
        termsDigest(domain, terms);
        validateTiming(terms.timing, rulebook);
        offer({ commitment: c, at: '2026-10-30T10:00:00Z', sellerScope: { roles: ['seller'], maxPerCommitment: terms.price, maxDaily: terms.price, expiresAt: '2030-01-01T00:00:00Z' }, rulebook, nonceUsed: false });
      }),
      { numRuns: 500, seed: SEED },
    );
    expect(accepted).toBeGreaterThan(20);
  });

  it.each(['messages.acceptance', 'messages.decision', 'messages.funding', 'messages.member-admission'])('%s: typedDataOf and messageDigest', (name) => {
    let accepted = 0;
    fc.assert(
      fc.property(edits, (e) => {
        const r = parseMessage(withMutations(example(`${name}.example.json`), e));
        if (!r.ok) return;
        accepted++;
        const unsigned = { ...r.value, signature: undefined } as unknown as UnsignedMessage;
        typedDataOf(unsigned);
        messageDigest(domain, unsigned);
      }),
      { numRuns: 300, seed: SEED },
    );
    expect(accepted).toBeGreaterThan(20);
  });
});
