import { describe, expect, it } from 'vitest';
import { createContext, SIM_EPOCH } from './context.js';

describe('deterministic context', () => {
  it('starts the clock at the fixed sim epoch and only moves when told to', () => {
    const ctx = createContext({ seed: 7 });
    expect(ctx.clock.now()).toBe(SIM_EPOCH);
    expect(ctx.clock.elapsedMs()).toBe(0);
    ctx.clock.advanceSeconds(5);
    ctx.clock.advanceMs(20);
    expect(ctx.clock.elapsedMs()).toBe(5020);
    expect(ctx.clock.now()).toBe('2026-01-01T00:00:05.020Z');
  });

  it('refuses to move the clock backwards or by a non-integer amount', () => {
    const ctx = createContext({ seed: 1 });
    expect(() => ctx.clock.advanceMs(-1)).toThrow(RangeError);
    expect(() => ctx.clock.advanceMs(0.5)).toThrow(RangeError);
    expect(() => ctx.clock.advanceSeconds(Number.NaN)).toThrow(RangeError);
  });

  it('produces the same random stream and IDs for the same seed', () => {
    const a = createContext({ seed: 42 });
    const b = createContext({ seed: 42 });
    const draw = (c: typeof a) => [c.rng.hex32(), c.rng.nextU64(), c.rng.int(1000), c.ids.next('rcpt'), c.ids.next('rcpt'), c.ids.next('evt')];
    expect(draw(a)).toEqual(draw(b));
  });

  it('produces a different stream for a different seed', () => {
    expect(createContext({ seed: 1 }).rng.hex32()).not.toBe(createContext({ seed: 2 }).rng.hex32());
  });

  it('pins the generator output so a silent algorithm change shows up', () => {
    const ctx = createContext({ seed: 7 });
    expect(ctx.rng.hex32()).toMatch(/^0x[0-9a-f]{64}$/);
    expect([ctx.ids.next('rcpt'), ctx.ids.next('rcpt'), ctx.ids.next('evt')]).toEqual(['rcpt-0001', 'rcpt-0002', 'evt-0001']);
    // splitmix64 reference: first output for seed 0 is 0xe220a8397b1dcdaf.
    expect(createContext({ seed: 0 }).rng.nextU64()).toBe(0xe220a8397b1dcdafn);
  });

  it('keeps int() inside its bound and rejects a bad bound', () => {
    const ctx = createContext({ seed: 3 });
    for (let i = 0; i < 200; i++) {
      const n = ctx.rng.int(7);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
    }
    expect(() => ctx.rng.int(0)).toThrow(RangeError);
  });

  it('rejects a seed that is not a non-negative safe integer', () => {
    expect(() => createContext({ seed: -1 })).toThrow(RangeError);
    expect(() => createContext({ seed: 1.5 })).toThrow(RangeError);
  });
});
