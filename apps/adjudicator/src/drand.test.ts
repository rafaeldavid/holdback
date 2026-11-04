// The drand quicknet source (T-217, research §7) on recorded relay answers: no network. The local check runs on the
// seven real rounds of T-209 and on mutated copies; the source on a fake relay network (_sim.ts) that answers each
// request from fixtures/beacon/drand-relays.json, or refuses, stalls or lies as a test sets it.
import { readFileSync } from 'node:fs';
import { DRAND_QUICKNET, DRAND_QUICKNET_CHAIN_HASH, type Hex32 } from '@holdback/core';
import { sha256, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import { fakeRelays, RELAYS_AT } from './_sim.js';
import { DRAND_RELAYS, drandQuicknet, quicknetValue, RELAY_TIMEOUT_MS } from './drand.js';

const vectors = JSON.parse(readFileSync(new URL('../../../fixtures/beacon/drand-quicknet.json', import.meta.url), 'utf8')) as { rounds: Array<{ round: number; signature: string; randomness: string }> };
const recorded = JSON.parse(readFileSync(new URL('../../../fixtures/beacon/drand-relays.json', import.meta.url), 'utf8')) as {
  relays: string[];
  published: { request: string; answers: Record<string, { body: string }> };
  otherChains: Record<string, { body: string }>;
  serviceRounds: { rounds: Array<{ round: number; signature: string; randomness: string }> };
};
const serviceRounds = recorded.serviceRounds.rounds;
const hex = (s: string): Hex => `0x${s}`;
const round1000 = vectors.rounds.find((r) => r.round === 1000)!;
const PUBLISHED = 33_666_095;
const published = JSON.parse(recorded.published.answers['https://api2.drand.sh']!.body) as { signature: string; randomness: string };
/** p, the BLS12-381 base field modulus. */
const P = '1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab';
/** Flips the bits `mask` of hex digit `at`. */
const flip = (sig: string, at: number, mask = 1): string => sig.slice(0, at) + (parseInt(sig[at]!, 16) ^ mask).toString(16) + sig.slice(at + 1);

describe('the local check: quicknet BLS on G1, RFC 9380 hash to curve (T-217)', () => {
  it.each(vectors.rounds)('accepts round $round and returns sha256 of its signature, which is the relay randomness', ({ round, signature, randomness }) => {
    expect(quicknetValue(round, hex(signature))).toBe(hex(randomness));
    expect(quicknetValue(round, hex(signature))).toBe(sha256(hex(signature)));
  });

  it.each<[string, number, string]>([
    ['a flipped bit in the signature', 1000, flip(round1000.signature, 40)],
    ['the sign flag flipped (the negated point)', 1000, flip(round1000.signature, 0, 2)],
    ['the compression flag cleared', 1000, flip(round1000.signature, 0, 8)],
    ["another round's signature", 1001, round1000.signature],
    ['the right signature for the round before', 999, round1000.signature],
    ["quicknet-t's round 1000 (the same scheme under another key)", 1000, (JSON.parse(recorded.otherChains['quicknet-t']!.body) as { signature: string }).signature],
    ["the default chain's 96-byte G2 signature", 1000, (JSON.parse(recorded.otherChains['default']!.body) as { signature: string }).signature],
    ['the point at infinity', 1000, `c0${'00'.repeat(47)}`],
    ['an x coordinate equal to p', 1000, (parseInt(P.slice(0, 2), 16) | 0x80).toString(16) + P.slice(2)],
    ['47 bytes', 1000, round1000.signature.slice(0, -2)],
    ['49 bytes', 1000, `${round1000.signature}00`],
    ['upper-case hex', 1000, round1000.signature.toUpperCase()],
    ['not hex', 1000, 'zz'.repeat(48)],
    ['round 0, which drand never signs', 0, round1000.signature],
    ['a negative round', -1000, round1000.signature],
    ['a fractional round', 1000.5, round1000.signature],
  ])('refuses %s', (_name, round, signature) => {
    expect(quicknetValue(round, hex(signature))).toBeNull();
  });

  // noble reduces a compressed x modulo p, so x + p decodes to the real point; DrandQuicknetBeacon refuses x >= p.
  it('refuses a real signature re-encoded with x + p, which decodes to the same point', () => {
    const { signature } = serviceRounds.find((r) => r.round === 33_574_633)!;
    expect(quicknetValue(33_574_633, hex(signature))).not.toBeNull();
    const top = parseInt(signature.slice(0, 2), 16);
    const x = BigInt(`0x${(top & 0x1f).toString(16).padStart(2, '0')}${signature.slice(2)}`) + BigInt(`0x${P}`);
    const wide = x.toString(16).padStart(96, '0');
    expect(BigInt(`0x${wide}`) < 2n ** 381n).toBe(true);
    const reencoded = (parseInt(wide.slice(0, 2), 16) | (top & 0xe0)).toString(16) + wide.slice(2);
    expect(quicknetValue(33_574_633, hex(reencoded))).toBeNull();
  });
});

describe('the drand-quicknet source (T-217, research §7)', () => {
  const source = (net: ReturnType<typeof fakeRelays>, timeoutMs?: number) => drandQuicknet({ fetch: net.fetch, now: () => RELAYS_AT, ...(timeoutMs ? { timeoutMs } : {}) });

  it('is the quicknet source on the quicknet clock, with the research relay order and a 2 s timeout', () => {
    const s = drandQuicknet({ fetch: fakeRelays().fetch });
    expect(s.kind).toBe('drand-quicknet');
    expect(s.clock).toEqual(DRAND_QUICKNET);
    expect(DRAND_RELAYS).toEqual(recorded.relays);
    expect(RELAY_TIMEOUT_MS).toBe(2000);
  });

  it('asks the first relay for the computed round, by its chain hash, and returns the value and the proof: one request', async () => {
    const net = fakeRelays();
    expect(await source(net).value(PUBLISHED)).toEqual({ value: hex(published.randomness), signature: hex(published.signature) });
    expect(net.requests).toEqual([`https://api2.drand.sh${recorded.published.request}`]);
    expect(recorded.published.request).toContain(DRAND_QUICKNET_CHAIN_HASH.slice(2));
  });

  it('never asks a relay for round 0, which answers the latest round, nor for a negative or fractional round', async () => {
    const net = fakeRelays();
    for (const round of [0, -1, 1.5, Number.NaN]) expect(await source(net).value(round)).toBeNull();
    expect(net.requests).toEqual([]);
  });

  it('does not ask for a round its clock has not reached', async () => {
    const net = fakeRelays();
    const latest = Math.floor((Date.parse(RELAYS_AT) / 1000 - DRAND_QUICKNET.genesis) / DRAND_QUICKNET.period) + 1;
    expect(await source(net).value(latest + 1)).toBeNull();
    expect(net.requests).toEqual([]);
  });

  it('reads 425 and 404 as not published yet, asks the next relay, and stops at the first proven answer', async () => {
    const net = fakeRelays({ 'https://api2.drand.sh': 'not-yet', 'https://drand.cloudflare.com': 'not-yet' });
    expect(net.statusFor('https://api2.drand.sh')).toBe(425);
    expect(net.statusFor('https://drand.cloudflare.com')).toBe(404);
    expect((await source(net).value(PUBLISHED))?.value).toBe(hex(published.randomness));
    expect(net.requests.map((u) => new URL(u).origin)).toEqual(['https://api2.drand.sh', 'https://drand.cloudflare.com', 'https://api.drand.sh']);
  });

  it('keeps a proven round, so a retry of the same decision asks no relay again', async () => {
    const net = fakeRelays();
    const s = source(net);
    await s.value(PUBLISHED);
    await s.value(PUBLISHED);
    expect(net.requests).toHaveLength(1);
  });

  it('refuses to build for another drand chain: the public key it checks against is quicknet’s', () => {
    expect(() => drandQuicknet({ chainHash: `0x${'cc'.repeat(32)}` as Hex32 })).toThrow(/quicknet/);
    expect(() => drandQuicknet({ relays: [] })).toThrow(/relay/);
  });
});

// The plan's neutrality.beacon-relay-refuses at the source: one relay refuses or lies and the next is used; when all
// refuse, nothing stands in. The service half (no decision signed, a retry at the next pass) is in service.test.ts.
describe('neutrality.beacon-relay-refuses (source)', () => {
  it.each([
    ['answers 500', 'refuse', 'HTTP 500'],
    ['stalls past the timeout', 'stall', 'no answer within 50 ms'],
    ['fails to connect', 'throw', 'no answer within 50 ms'],
    ['answers a tampered signature', 'tamper', 'does not prove round 33666095'],
    ['answers another round (as /public/0 answers the latest)', 'other-round', 'round 33666202 in place of round 33666095'],
    ["answers another chain's round", 'other-chain', 'does not prove round 33666095'],
    ['answers a body that is not JSON', 'bad-json', 'not JSON'],
  ] as const)('the first relay %s: the next relay is used', async (_name, mode, reason) => {
    const net = fakeRelays({ 'https://api2.drand.sh': mode });
    const lines: string[] = [];
    const s = drandQuicknet({ fetch: net.fetch, now: () => RELAYS_AT, timeoutMs: 50, log: (l) => lines.push(l) });
    expect(await s.value(PUBLISHED)).toEqual({ value: hex(published.randomness), signature: hex(published.signature) });
    expect(net.requests.map((u) => new URL(u).origin)).toEqual(['https://api2.drand.sh', 'https://drand.cloudflare.com']);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('api2.drand.sh');
    expect(lines[0]).toContain(reason);
  });

  it("takes the value as sha256 of the signature, never the relay's randomness field", async () => {
    const net = fakeRelays({ 'https://api2.drand.sh': 'wrong-randomness' });
    expect((await drandQuicknet({ fetch: net.fetch, now: () => RELAYS_AT }).value(PUBLISHED))?.value).toBe(sha256(hex(published.signature)));
    expect(net.requests).toHaveLength(1);
  });

  it.each([
    ['all four refuse', { 'https://api2.drand.sh': 'refuse', 'https://drand.cloudflare.com': 'stall', 'https://api.drand.sh': 'throw', 'https://api3.drand.sh': 'not-yet' }],
    ['all four lie', { 'https://api2.drand.sh': 'tamper', 'https://drand.cloudflare.com': 'other-round', 'https://api.drand.sh': 'other-chain', 'https://api3.drand.sh': 'tamper' }],
  ] as const)('%s: no value, and nothing stands in', async (_name, modes) => {
    const net = fakeRelays(modes);
    expect(await drandQuicknet({ fetch: net.fetch, now: () => RELAYS_AT, timeoutMs: 50 }).value(PUBLISHED)).toBeNull();
    expect(net.requests).toHaveLength(4);
  });
});
