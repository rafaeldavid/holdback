// The deterministic context every package takes instead of reading the wall clock or Math.random.
// Production code receives a SimContext (or a structurally equal object) from its caller; the testkit
// builds one from the fixture's @seed, so a scenario replays identically on every machine.
import type { Hex32, Timestamp } from '@holdback/core';

/** Fixed start of simulated time. Snapshots show offsets from it, never the machine's clock. */
export const SIM_EPOCH: Timestamp = '2026-01-01T00:00:00.000Z';

export interface Clock {
  /** The current simulated instant as RFC 3339 with milliseconds. */
  now(): Timestamp;
  /** Milliseconds since the start of this context. */
  elapsedMs(): number;
  advanceMs(ms: number): void;
  advanceSeconds(seconds: number): void;
}

export interface Rng {
  /** The next 64-bit output of splitmix64. */
  nextU64(): bigint;
  /** 32 random bytes as 0x-prefixed lowercase hex (nonces, seeds). */
  hex32(): Hex32;
  /** A uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
}

export interface IdGen {
  /** Sequential IDs per prefix: rcpt-0001, rcpt-0002, evt-0001, … */
  next(prefix: string): string;
}

export interface SimContext {
  readonly seed: number;
  readonly clock: Clock;
  readonly rng: Rng;
  readonly ids: IdGen;
}

const MASK64 = (1n << 64n) - 1n;

function splitmix64(seed: bigint): () => bigint {
  let state = seed & MASK64;
  return () => {
    state = (state + 0x9e3779b97f4a7c15n) & MASK64;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    return z ^ (z >> 31n);
  };
}

function wholeMs(ms: number, what: string): number {
  if (!Number.isSafeInteger(ms) || ms < 0) throw new RangeError(`${what} must be a non-negative whole number of milliseconds, got ${ms}`);
  return ms;
}

export function createContext(options: { seed: number; start?: Timestamp }): SimContext {
  const { seed } = options;
  if (!Number.isSafeInteger(seed) || seed < 0) throw new RangeError(`seed must be a non-negative safe integer, got ${seed}`);
  const startMs = Date.parse(options.start ?? SIM_EPOCH);
  if (!Number.isFinite(startMs)) throw new RangeError(`start ${options.start} is not a timestamp`);

  let elapsed = 0;
  const clock: Clock = {
    now: () => new Date(startMs + elapsed).toISOString(),
    elapsedMs: () => elapsed,
    advanceMs: (ms) => {
      elapsed += wholeMs(ms, 'clock advance');
    },
    advanceSeconds: (seconds) => {
      elapsed += wholeMs(seconds * 1000, 'clock advance');
    },
  };

  const next = splitmix64(BigInt(seed));
  const rng: Rng = {
    nextU64: next,
    hex32: () => `0x${[next(), next(), next(), next()].map((w) => w.toString(16).padStart(16, '0')).join('')}`,
    int: (maxExclusive) => {
      if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1) throw new RangeError(`int bound must be a positive safe integer, got ${maxExclusive}`);
      // Rejection sampling keeps the result uniform.
      const bound = BigInt(maxExclusive);
      const limit = (1n << 64n) - ((1n << 64n) % bound);
      for (;;) {
        const v = next();
        if (v < limit) return Number(v % bound);
      }
    },
  };

  const counters = new Map<string, number>();
  const ids: IdGen = {
    next: (prefix) => {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      return `${prefix}-${String(n).padStart(4, '0')}`;
    },
  };

  return { seed, clock, rng, ids };
}
