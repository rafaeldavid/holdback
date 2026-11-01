// ADR-0024 §3: who may read a private deal at this operator. Named after the accepted fixture list where one applies.
import { holdbackDomain, readTokenHeader, signMessage, type Address, type ReadToken } from '@holdback/core';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { readerOf, type ReadCheck } from './read-auth.js';

const domain = holdbackDomain(31337);
const key = (b: string) => `0x${b.repeat(32)}` as const;
const addr = (k: `0x${string}`) => privateKeyToAccount(k).address.toLowerCase() as Address;
const BUYER = key('21');
const SELLER = key('22');
const PRIMARY = key('23');
const FALLBACK = key('24');
const OUTSIDER = key('25');
const OP_A = '0x00000000000000000000000000000000000000a1' as Address;
const OP_B = '0x00000000000000000000000000000000000000b2' as Address;
const ID = `0x${'aa'.repeat(32)}` as const;

const check = (over: Partial<ReadCheck> = {}): ReadCheck => ({
  domain,
  operator: OP_A,
  now: '2026-11-01T10:00:00Z',
  commitmentId: ID,
  parties: { buyer: addr(BUYER), seller: addr(SELLER), adjudicator: addr(PRIMARY), fallbackAdjudicator: addr(FALLBACK), appealAdjudicator: addr(key('26')) },
  state: { escrowState: 'Offered', appealState: 'none' },
  ...over,
});

async function token(k: `0x${string}`, over: Partial<Omit<ReadToken, 'signature' | 'type'>> = {}): Promise<string> {
  const unsigned = { type: 'ReadToken' as const, viewer: addr(k), commitmentId: ID, nonce: key('0f'), expiresAt: '2026-11-01T10:05:00Z', ...over };
  return readTokenHeader({ ...unsigned, signature: await signMessage(k, domain, unsigned) } as ReadToken);
}

describe('read tokens (ADR-0024 §3)', () => {
  it('reads anonymously without a header', async () => {
    expect(await readerOf(undefined, check())).toEqual({ ok: true, reader: { kind: 'anonymous' } });
  });

  it('admits the buyer, the seller and the primary', async () => {
    for (const [k, kind] of [[BUYER, 'party'], [SELLER, 'party'], [PRIMARY, 'adjudicator']] as const) {
      const r = await readerOf(await token(k), check());
      expect(r.ok && r.reader.kind, kind).toBe(kind);
    }
  });

  it('refuses an outsider, and the fallback until it is involved', async () => {
    const out = await readerOf(await token(OUTSIDER), check());
    expect(!out.ok && out.problem.type).toBe('unauthorized');
    const early = await readerOf(await token(FALLBACK), check());
    expect(early.ok).toBe(false);
    const late = await readerOf(await token(FALLBACK), check({ state: { escrowState: 'FallbackJudging', appealState: 'none' } }));
    expect(late.ok && late.reader.kind).toBe('adjudicator');
  });

  it('error.read-token-audience: a token for one operator is refused at another', async () => {
    const t = await token(BUYER, { audience: OP_A });
    expect((await readerOf(t, check({ operator: OP_A }))).ok).toBe(true);
    const replay = await readerOf(t, check({ operator: OP_B }));
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.problem.detail).toContain('not this one');
  });

  it('error.read-token-expired: refused at and after its expiry', async () => {
    const r = await readerOf(await token(BUYER), check({ now: '2026-11-01T10:05:00Z' }));
    expect(!r.ok && r.problem.detail).toContain('expired');
  });

  it('refuses a token for another commitment, a forged signature and a malformed header', async () => {
    expect((await readerOf(await token(BUYER, { commitmentId: `0x${'bb'.repeat(32)}` }), check())).ok).toBe(false);
    const forged = await token(OUTSIDER, { viewer: addr(BUYER) });
    const f = await readerOf(forged, check());
    expect(!f.ok && f.problem.detail).toContain('does not recover');
    expect((await readerOf('Bearer abc', check())).ok).toBe(false);
  });
});
