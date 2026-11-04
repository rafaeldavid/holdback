// The drand quicknet randomness source (T-217; ADR-0018 §4 and §5; research §7). The rules contract's
// DrandQuicknetBeacon verifies a fallback or appeal panel's round on chain; this source fetches that round from public
// relays and checks it locally first, because a bad proof burns up to 250,000 gas in the pairing check.
//
// - The round is computed by the caller from settlement state, never asked for as `latest`: round 0 answers the latest
//   round on the relays (measured, fixtures/beacon/drand-relays.json), so it is never asked for.
// - Relays are tried in order, each with a timeout. 425 (drand.sh) and 404 (Cloudflare) mean "not published yet".
// - Each answer is checked as the contract checks it: a canonical 48-byte compressed G1 point, in G1, not the point at
//   infinity, whose pairing with quicknet's group key proves the round's message, sha256(round as 8 big-endian bytes),
//   hashed to G1 per RFC 9380 under the DST in DrandQuicknetBeacon.sol. The value is sha256(signature); the relay's own
//   `randomness` field is never read.
// - A relay that refuses, stalls, lies or lags is skipped for the next. When none proves the round the value is null and
//   the service waits for its next pass: nothing stands in, not another round, not a supplied value (ADR-0018 §5).
// Bounding what a relay outage or a lying relay costs a pass is security hardening, Phase 11 (T-225).
import { beaconRoundAt, DRAND_QUICKNET, DRAND_QUICKNET_CHAIN_HASH, type Hex32, type Timestamp } from '@holdback/core';
import { numberToBytes, sha256, type Hex } from 'viem';
import type { BeaconRound, RandomnessSource } from './randomness.js';

/** The relays in the research's order, fastest first when measured on 2026-11-03 (research §7). */
export const DRAND_RELAYS: readonly string[] = ['https://api2.drand.sh', 'https://drand.cloudflare.com', 'https://api.drand.sh', 'https://api3.drand.sh'];
/** Per relay request. */
export const RELAY_TIMEOUT_MS = 2_000;
/** quicknet's group public key, a compressed G2 point (https://api.drand.sh/<chain hash>/info; PK_0 to PK_7 in DrandQuicknetBeacon.sol). */
export const QUICKNET_PUBLIC_KEY =
  '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a';
/** RFC 9380 domain separation tag of the scheme bls-unchained-g1-rfc9380 (DST_A and DST_B in DrandQuicknetBeacon.sol). */
export const QUICKNET_DST = 'BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_';

/** p, the BLS12-381 base field modulus: a compressed x at or above it is not canonical, and the contract refuses it. */
const P = 0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;
const SIGNATURE = /^0x[0-9a-f]{96}$/;
/** Proven rounds kept per source: rounds never change, so a retry of the same decision asks no relay again. */
const KEEP = 256;

type Bls = typeof import('@noble/curves/bls12-381').bls12_381;
// Loaded on first use, not at import: the module costs about 48 ms of CPU to load (measured, PR 186 review), and
// every Worker that imports this package, the operators' included, has a startup CPU budget.
let curve: Promise<{ bls: Bls; groupKey: InstanceType<Bls['G2']['ProjectivePoint']> }> | undefined;
const loaded = () => (curve ??= import('@noble/curves/bls12-381').then(({ bls12_381 }) => ({ bls: bls12_381, groupKey: bls12_381.G2.ProjectivePoint.fromHex(QUICKNET_PUBLIC_KEY) })));

/**
 * The value of drand quicknet round `round`, sha256(signature), when `signature` is that round's BLS signature under
 * quicknet's group key; null for anything else. The same checks as DrandQuicknetBeacon.beaconValue.
 */
export async function quicknetValue(round: number, signature: string): Promise<Hex32 | null> {
  if (!Number.isSafeInteger(round) || round < 1 || !SIGNATURE.test(signature)) return null;
  const top = parseInt(signature.slice(2, 4), 16);
  // ZCash flags: compressed set, infinity clear; x is the remaining 381 bits and must be below p.
  if ((top & 0x80) === 0 || (top & 0x40) !== 0) return null;
  if (BigInt(`0x${(top & 0x1f).toString(16).padStart(2, '0')}${signature.slice(4)}`) >= P) return null;
  const { bls, groupKey } = await loaded();
  try {
    const point = bls.G1.ProjectivePoint.fromHex(signature.slice(2));
    // On the curve and in the prime-order subgroup G1.
    point.assertValidity();
    if (point.equals(bls.G1.ProjectivePoint.ZERO)) return null;
    const message = sha256(numberToBytes(BigInt(round), { size: 8 }), 'bytes');
    if (!bls.verifyShortSignature(point, message, groupKey, { DST: QUICKNET_DST })) return null;
  } catch {
    return null;
  }
  return sha256(signature as Hex);
}

export interface DrandOptions {
  /** Relay base URLs, tried in order. Default DRAND_RELAYS. */
  relays?: readonly string[];
  /** Per relay, in milliseconds. Default RELAY_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Default the global fetch (a Worker's own). */
  fetch?: typeof fetch;
  /** The clock that says which rounds are due: a round after its latest is never asked for. Default the wall clock. */
  now?: () => Timestamp;
  /** The rulebook's chain hash. Only quicknet's is accepted: its group key is the one this source holds. */
  chainHash?: Hex32;
  /** One line for each relay skipped, and why. */
  log?: (line: string) => void;
}

/** The drand-quicknet RandomnessSource: rounds on quicknet's clock, each value proven before it is returned. */
export function drandQuicknet(o: DrandOptions = {}): RandomnessSource {
  const chainHash = (o.chainHash ?? DRAND_QUICKNET_CHAIN_HASH).toLowerCase();
  if (chainHash !== DRAND_QUICKNET_CHAIN_HASH) {
    throw new RangeError(`this source verifies drand quicknet (${DRAND_QUICKNET_CHAIN_HASH}) only; ${chainHash} is another drand network, whose group key it does not hold`);
  }
  const relays = o.relays ?? DRAND_RELAYS;
  if (relays.length === 0) throw new RangeError('a drand source needs at least one relay');
  const timeoutMs = o.timeoutMs ?? RELAY_TIMEOUT_MS;
  const get = o.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const now = o.now ?? (() => new Date().toISOString());
  const log = o.log ?? (() => undefined);
  const proven = new Map<number, BeaconRound>();

  /** One relay's proven answer for the round, or why it gave none. */
  async function ask(relay: string, round: number): Promise<BeaconRound | string> {
    let res: Response;
    try {
      res = await get(`${relay}/${chainHash.slice(2)}/public/${round}`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
    } catch (e) {
      const why = (e as Error)?.name === 'TimeoutError' ? `no answer within ${timeoutMs} ms` : 'no connection';
      return `${why} (${String((e as Error)?.message ?? e).slice(0, 80)})`;
    }
    if (res.status === 425 || res.status === 404) return `round ${round} not published there yet (HTTP ${res.status})`;
    if (!res.ok) return `HTTP ${res.status}`;
    let body: { round?: unknown; signature?: unknown };
    try {
      body = ((await res.json()) ?? {}) as typeof body;
    } catch {
      return 'a body that is not JSON';
    }
    if (body.round !== round) return `round ${String(body.round).slice(0, 24)} in place of round ${round}`;
    if (typeof body.signature !== 'string') return 'no signature';
    const signature = `0x${body.signature.toLowerCase()}` as Hex;
    const value = await quicknetValue(round, signature);
    return value ? { value, signature } : `a signature that does not prove round ${round} under the quicknet key`;
  }

  return {
    kind: 'drand-quicknet',
    clock: DRAND_QUICKNET,
    async value(round) {
      if (!Number.isSafeInteger(round) || round < 1) return null;
      const known = proven.get(round);
      if (known) return known;
      const seconds = Math.floor(Date.parse(now()) / 1000);
      if (!Number.isSafeInteger(seconds) || seconds < 0 || round > beaconRoundAt(DRAND_QUICKNET, seconds)) return null;
      for (const relay of relays) {
        const answer = await ask(relay, round);
        if (typeof answer === 'string') {
          log(`drand ${relay}: ${answer}; trying the next relay`);
          continue;
        }
        if (proven.size >= KEEP) proven.delete(proven.keys().next().value!);
        proven.set(round, answer);
        return answer;
      }
      return null;
    },
  };
}
