import { demoRegistry } from '@holdback/demo/agents/bench.js';
import { describe, expect, it } from 'vitest';
import type { BalanceRow, BeatTranscript } from '../transcript/types.js';
import { standInSource } from './stand-in.js';

const total = (rows: BalanceRow[]) => rows.reduce((s, r) => s + BigInt(r.amount.amount), 0n);

describe('stand-in source', () => {
  it('covers only what no SimChain runner drives yet: beat 7 and beat 6\'s injection half', () => {
    expect(standInSource().beats()).toEqual([6, 7]);
  });

  it('labels every transcript as a stand-in in recorded mode', async () => {
    const s = standInSource();
    for (const b of s.beats()) {
      const t = await s.run(b);
      expect(t.format).toBe('holdback.demo.transcript/v0');
      expect(t.mode).toBe('recorded');
      expect(t.source.kind).toBe('stand-in');
      expect(t.source.note).toMatch(/illustrative/);
      expect(t.beat).toBe(b);
    }
  });

  it('is deterministic', async () => {
    const a = standInSource();
    const b = standInSource();
    for (const beat of a.beats()) expect(await a.run(beat)).toEqual(await b.run(beat));
  });

  it('refuses a beat it does not have', async () => {
    await expect(standInSource().run(1)).rejects.toThrow(/beat 1/);
  });

  it('conserves money: every balance snapshot in a beat sums to the same total', async () => {
    const s = standInSource();
    for (const b of s.beats()) {
      const t: BeatTranscript = await s.run(b);
      const snapshots = t.events.flatMap((e) => (e.kind === 'balances' ? [total(e.rows)] : []));
      expect(snapshots.length, `beat ${b}`).toBeGreaterThan(0);
      expect(new Set(snapshots).size, `beat ${b}`).toBe(1);
    }
  });

  it('keeps time moving forward within a beat', async () => {
    const s = standInSource();
    for (const b of s.beats()) {
      const times = (await s.run(b)).events.map((e) => e.atMs);
      expect(times, `beat ${b}`).toEqual([...times].sort((x, y) => x - y));
    }
  });

  it('beat 7 shows the three neutrality failures and still settles', async () => {
    const t = await standInSource().run(7);
    const failures = t.events.flatMap((e) => (e.kind === 'neutrality' ? [`${e.target}:${e.failure}`] : []));
    expect(failures).toEqual(['op1:refused', 'benchA:offline', 'club:revoked']);
    expect(t.events.some((e) => e.kind === 'decision' && e.role === 'fallback')).toBe(true);
    expect(t.events.some((e) => e.kind === 'settlement' && e.settlement === 'release')).toBe(true);
  });

  it('takes every model ID from config/judges.yaml, never an invented one', async () => {
    const registered = new Map(demoRegistry().active.map((j) => [j.model, j.family]));
    const s = standInSource();
    for (const b of s.beats()) {
      for (const e of (await s.run(b)).events) {
        if (e.kind !== 'panel') continue;
        for (const j of e.judges) expect(registered.get(j.model), j.model).toBe(j.family);
      }
    }
  });

  it('beat 6 seats five judges from three families on the appeal panel', async () => {
    const panel = (await standInSource().run(6)).events.find((e) => e.kind === 'panel');
    if (panel?.kind !== 'panel') throw new Error('no panel');
    expect(panel.judges).toHaveLength(5);
    expect(new Set(panel.judges.map((j) => j.family)).size).toBe(3);
  });
});
