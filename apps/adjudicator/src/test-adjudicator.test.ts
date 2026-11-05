import { holdbackDomain, type Commitment, type TokenAmount } from '@holdback/core';
import { fakeProvider, type JudgeRequest } from '@holdback/judgment';
import { describe, expect, it } from 'vitest';
import { fakeRelays } from './_sim.js';
import { drandQuicknet } from './drand.js';
import type { SettlementReads } from './simchain-adapter.js';
import { FAIL_MARKER, FAKE_JUDGE_MARK, markedFake, markerFake, placeholderRegistry, testAdjudicator } from './test-adjudicator.js';

const req = {
  judgeId: 'claude-a',
  provider: 'anthropic',
  model: 'placeholder-claude-a-20260601',
  system: 'rules\n6. "criteria" must contain each of these ids exactly once: faithful, fluent.\n7. more',
  user: 'data',
  temperature: 0,
  maxOutputTokens: 2048,
} as JudgeRequest;

describe('test adjudicator fake judges', () => {
  it('marks every rationale and evidence string as fake, within the schema limits', async () => {
    const res = await markedFake(fakeProvider({ 'claude-a': 'fail' })).complete(req);
    expect(res.kind).toBe('ok');
    const v = JSON.parse((res as { text: string }).text) as { rationale: string; overall: string; criteria: Array<{ id: string; evidence: string }> };
    expect(v.overall).toBe('fail');
    expect(v.rationale.startsWith(FAKE_JUDGE_MARK)).toBe(true);
    expect(v.criteria.map((c) => c.id)).toEqual(['faithful', 'fluent']);
    for (const c of v.criteria) {
      expect(c.evidence.startsWith(FAKE_JUDGE_MARK)).toBe(true);
      expect(c.evidence.length).toBeLessThanOrEqual(300);
    }
  });

  it('fails work that contains the FAIL-ME marker, and passes it otherwise', async () => {
    const verdict = async (user: string) => JSON.parse(((await markedFake(markerFake()).complete({ ...req, user })) as { text: string }).text).overall;
    expect(await verdict('a faithful translation')).toBe('pass');
    expect(await verdict(`a translation ${FAIL_MARKER} with a marker`)).toBe('fail');
  });

  it('passes timeouts through untouched', async () => {
    expect(await markedFake(fakeProvider({ 'claude-a': 'timeout' })).complete(req)).toEqual({ kind: 'timeout' });
  });

  it('uses the placeholder registry, whose model IDs say they are placeholders', () => {
    expect(placeholderRegistry().active.every((j) => j.model.startsWith('placeholder-'))).toBe(true);
  });
});

// T-217: the Sepolia world passes its drand source here (T-220); a world without one decides drand deals never.
describe("the test adjudicator's randomness source", () => {
  const options = { name: 'bench-a', label: 'bench-a', signingKey: `0x${'01'.repeat(32)}` as const, encryptionSecretKey: new Uint8Array(32).fill(7), store: { ciphertext: async () => new Uint8Array(), publishRecord: async () => '' }, registration: async () => null, domain: holdbackDomain(31337), fee: { token: 'tUSD', amount: '1' } as TokenAmount };
  const chain = { escrowState: () => ({ kind: 'FallbackJudging', beaconSource: 'drand-quicknet' }) } as unknown as SettlementReads;
  const c = { id: `0x${'12'.repeat(32)}` } as Commitment;

  it('reads drand-quicknet rounds from the source it is given, and from none without one', () => {
    const drand = drandQuicknet({ fetch: fakeRelays().fetch });
    expect(testAdjudicator({ ...options, chain, drand }).settlement.randomness(c)).toBe(drand);
    expect(testAdjudicator({ ...options, chain }).settlement.randomness(c)).toBeNull();
  });
});
