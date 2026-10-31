import { describe, expect, it } from 'vitest';
import type { BalanceRow, BeatTranscript } from '../transcript/types.js';
import { standInSource } from './stand-in.js';

const total = (rows: BalanceRow[]) => rows.reduce((s, r) => s + BigInt(r.amount.amount), 0n);

describe('stand-in source', () => {
  it('covers the core beats 1 to 7 and the mutual-settlement beat 10', () => {
    expect(standInSource().beats()).toEqual([1, 2, 3, 4, 5, 6, 7, 10]);
  });

  it('labels every transcript as a stand-in in recorded mode', async () => {
    const s = standInSource();
    for (const b of s.beats()) {
      const t = await s.run(b);
      expect(t.format).toBe('holdback.demo.transcript/v0');
      expect(t.mode).toBe('recorded');
      expect(t.source.kind).toBe('stand-in');
      expect(t.beat).toBe(b);
    }
  });

  it('is deterministic', async () => {
    const a = standInSource();
    const b = standInSource();
    for (const beat of a.beats()) expect(await a.run(beat)).toEqual(await b.run(beat));
  });

  it('refuses a beat it does not have', async () => {
    await expect(standInSource().run(9)).rejects.toThrow(/beat 9/);
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
      const t = await s.run(b);
      const times = t.events.map((e) => e.atMs);
      expect(times, `beat ${b}`).toEqual([...times].sort((x, y) => x - y));
      for (const ms of times) expect(Number.isInteger(ms)).toBe(true);
    }
  });

  it('beat 7 shows the three neutrality failures and still settles', async () => {
    const t = await standInSource().run(7);
    const failures = t.events.flatMap((e) => (e.kind === 'neutrality' ? [`${e.target}:${e.failure}`] : []));
    expect(failures).toEqual(['op1:refused', 'benchA:offline', 'club:revoked']);
    expect(t.events.some((e) => e.kind === 'decision' && e.role === 'fallback')).toBe(true);
    expect(t.events.some((e) => e.kind === 'settlement' && e.settlement === 'release')).toBe(true);
  });

  it('beat 3 seats three pinned judges from two families', async () => {
    const t = await standInSource().run(3);
    const panel = t.events.find((e) => e.kind === 'panel');
    expect(panel?.kind).toBe('panel');
    if (panel?.kind !== 'panel') return;
    expect(panel.judges).toHaveLength(3);
    expect(new Set(panel.judges.map((j) => j.family)).size).toBe(2);
    for (const j of panel.judges) expect(j.model).not.toMatch(/latest/);
  });

  it('beat 1 carries exactly one signed message', async () => {
    const t = await standInSource().run(1);
    expect(t.events.filter((e) => e.kind === 'signed')).toHaveLength(1);
  });
});
