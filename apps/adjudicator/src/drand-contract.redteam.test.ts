// Red team, T-217 (PR 186): the service's local BLS check (quicknetValue) against DrandQuicknetBeacon itself.
//
// A proof the local check accepts and the contract refuses would burn the relayer's gas (up to 250,000 in the pairing);
// a proof the contract accepts and the local check refuses would stop a valid fallback or appeal decision (liveness, and
// neutrality: the service would sign nothing while the chain would settle). This runs one corpus through both: the
// contract's own bytecode (contracts/out, `forge build`) on a local anvil (Prague, EIP-2537; 127.0.0.1, no network).
//
// Expected: the two agree on every input. Skipped when anvil or the artifact is missing.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { bls12_381 } from '@noble/curves/bls12-381';
import { createPublicClient, createWalletClient, http, numberToBytes, sha256, type Abi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUICKNET_DST, quicknetValue } from './drand.js';

const ARTIFACT = new URL('../../../contracts/out/DrandQuicknetBeacon.sol/DrandQuicknetBeacon.json', import.meta.url);
const haveAnvil = spawnSync('anvil', ['--version'], { encoding: 'utf8' }).status === 0;
const ready = haveAnvil && existsSync(ARTIFACT);
const KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

type Round = { round: number; signature: string };
const vectors = (JSON.parse(readFileSync(new URL('../../../fixtures/beacon/drand-quicknet.json', import.meta.url), 'utf8')) as { rounds: Round[] }).rounds;
const relays = JSON.parse(readFileSync(new URL('../../../fixtures/beacon/drand-relays.json', import.meta.url), 'utf8')) as { serviceRounds: { rounds: Round[] }; otherChains: Record<string, { body: string }> };
const real: Round[] = [...vectors, ...relays.serviceRounds.rounds];
const P = bls12_381.fields.Fp.ORDER;

/** A deterministic PRNG (mulberry32), so a failure names a reproducible input. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = prng(20261104);
const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const flipBit = (sig: string, bit: number): string => {
  const bytes = Uint8Array.from(Buffer.from(sig, 'hex'));
  bytes[bit >> 3]! ^= 1 << (7 - (bit & 7));
  return hexOf(bytes);
};
/** ZCash-compressed encoding of an affine point with x, y < p (compressed flag, sort flag from y). */
const compress = (x: bigint, y: bigint): string => {
  const b = numberToBytes(x, { size: 48 });
  b[0]! |= 0x80 | (y * 2n >= P ? 0x20 : 0);
  return hexOf(b);
};

function corpus(): Array<{ name: string; round: bigint; sig: string }> {
  const out: Array<{ name: string; round: bigint; sig: string }> = [];
  for (const r of real) out.push({ name: `real ${r.round}`, round: BigInt(r.round), sig: r.signature });
  for (const r of real.slice(0, 4)) {
    for (let bit = 0; bit < 8; bit++) out.push({ name: `round ${r.round}, flag bit ${bit} flipped`, round: BigInt(r.round), sig: flipBit(r.signature, bit) });
    for (let k = 0; k < 12; k++) {
      const bit = 8 + Math.floor(rand() * (384 - 8));
      out.push({ name: `round ${r.round}, bit ${bit} flipped`, round: BigInt(r.round), sig: flipBit(r.signature, bit) });
    }
    out.push({ name: `round ${r.round} at the round before`, round: BigInt(r.round - 1), sig: r.signature });
    out.push({ name: `round ${r.round} at the round after`, round: BigInt(r.round + 1), sig: r.signature });
    out.push({ name: `round ${r.round} at round 0`, round: 0n, sig: r.signature });
    out.push({ name: `round ${r.round} at 2^64 - 1`, round: 2n ** 64n - 1n, sig: r.signature });
  }
  for (const r of real) {
    // x + p, when it still fits in 381 bits (noble reduces it; the contract refuses x >= p).
    const top = parseInt(r.signature.slice(0, 2), 16);
    const x = BigInt(`0x${(top & 0x1f).toString(16).padStart(2, '0')}${r.signature.slice(2)}`) + P;
    if (x < 2n ** 381n) {
      const b = numberToBytes(x, { size: 48 });
      b[0]! |= top & 0xe0;
      out.push({ name: `round ${r.round} re-encoded with x + p`, round: BigInt(r.round), sig: hexOf(b) });
    }
  }
  const g = bls12_381.G1.ProjectivePoint.BASE.toAffine();
  out.push({ name: 'the G1 generator (in G1, not a signature)', round: BigInt(real[0]!.round), sig: compress(g.x, g.y) });
  // Curve points outside G1: x^3 + 4 a square, cofactor not cleared.
  const Fp = bls12_381.fields.Fp;
  let found = 0;
  for (let x = 1n; found < 4 && x < 200n; x++) {
    const rhs = Fp.add(Fp.pow(x, 3n), 4n);
    let y: bigint;
    try {
      y = Fp.sqrt(rhs);
    } catch {
      continue;
    }
    if (Fp.mul(y, y) !== rhs) continue;
    found++;
    out.push({ name: `curve point outside G1, x = ${x}`, round: BigInt(real[0]!.round), sig: compress(x, y) });
    out.push({ name: `curve point outside G1, x = ${x}, other y`, round: BigInt(real[0]!.round), sig: compress(x, Fp.neg(y)) });
  }
  out.push({ name: 'x = p - 1', round: BigInt(real[0]!.round), sig: compress(P - 1n, 0n) });
  out.push({ name: 'infinity, canonical', round: BigInt(real[0]!.round), sig: `c0${'00'.repeat(47)}` });
  out.push({ name: 'infinity flag with a real x', round: BigInt(real[0]!.round), sig: ((parseInt(real[0]!.signature.slice(0, 2), 16) | 0x40) & 0xff).toString(16) + real[0]!.signature.slice(2) });
  const quicknetT = JSON.parse(relays.otherChains['quicknet-t']!.body) as Round;
  out.push({ name: "quicknet-t's round 1000", round: 1000n, sig: quicknetT.signature });
  for (let k = 0; k < 24; k++) {
    const b = new Uint8Array(48).map(() => Math.floor(rand() * 256));
    b[0] = (b[0]! & 0x3f) | 0x80;
    out.push({ name: `random compressed bytes ${k}`, round: BigInt(real[k % real.length]!.round), sig: hexOf(b) });
  }
  return out;
}

describe.runIf(ready)('the local check against DrandQuicknetBeacon on anvil (red team T-217, differential)', () => {
  let anvil: ChildProcess | undefined;
  let call: (fn: 'beaconValue' | 'hashToG1', args: unknown[]) => Promise<Hex | null>;

  beforeAll(async () => {
    const port = await new Promise<number>((resolve, reject) => {
      const s = createServer();
      s.on('error', reject);
      s.listen(0, '127.0.0.1', () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => resolve(p));
      });
    });
    anvil = spawn('anvil', ['--host', '127.0.0.1', '--port', String(port), '--hardfork', 'prague', '--silent'], { stdio: 'ignore' });
    const transport = http(`http://127.0.0.1:${port}`);
    const pub = createPublicClient({ chain: foundry, transport });
    for (let i = 0; ; i++) {
      try {
        await pub.getChainId();
        break;
      } catch {
        if (i > 100) throw new Error('anvil did not start');
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const art = JSON.parse(readFileSync(ARTIFACT, 'utf8')) as { abi: Abi; bytecode: { object: Hex } };
    const wallet = createWalletClient({ chain: foundry, transport, account: privateKeyToAccount(KEY) });
    const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode.object });
    const address = (await pub.waitForTransactionReceipt({ hash })).contractAddress as Address;
    call = async (fn, args) => {
      try {
        return (await pub.readContract({ address, abi: art.abi, functionName: fn, args })) as Hex;
      } catch {
        return null;
      }
    };
  }, 30_000);

  afterAll(() => {
    anvil?.kill();
  });

  it('agrees with the contract on every signature in the corpus', async () => {
    const cases = corpus();
    const disagreements: string[] = [];
    let acceptedByBoth = 0;
    for (const c of cases) {
      const local = c.round <= BigInt(Number.MAX_SAFE_INTEGER) ? await quicknetValue(Number(c.round), `0x${c.sig}`) : null;
      const chain = await call('beaconValue', [c.round, `0x${c.sig}`]);
      if (local !== chain) disagreements.push(`${c.name}: local ${local}, contract ${chain}`);
      if (local && chain) acceptedByBoth++;
    }
    expect(disagreements).toEqual([]);
    expect(acceptedByBoth).toBe(real.length);
    // About 150 inputs: 14 real rounds, 4 x 24 mutations, every real round re-encoded with x + p where that fits in 381 bits,
    // 8 points outside G1, the generator, x = p - 1, two infinities, quicknet-t,
    // 24 random compressed strings.
    expect(cases.length).toBeGreaterThanOrEqual(140);
    expect(cases.filter((c) => c.name.includes('outside G1')).length).toBe(8);
  }, 120_000);

  it("agrees with the contract's hash to G1 on edge and random rounds (a valid relay proof is never refused locally)", async () => {
    const rounds = [1n, 2n, 3n, 255n, 256n, 2n ** 32n - 1n, 2n ** 32n, 2n ** 53n - 1n, 2n ** 63n, 2n ** 64n - 1n];
    for (let k = 0; k < 40; k++) rounds.push(BigInt(Math.floor(rand() * 2 ** 40)));
    const disagreements: string[] = [];
    for (const r of rounds) {
      const msg = sha256(numberToBytes(r, { size: 8 }), 'bytes');
      const q = bls12_381.G1.hashToCurve(msg, { DST: QUICKNET_DST }).toAffine();
      const local = `0x${'00'.repeat(16)}${q.x.toString(16).padStart(96, '0')}${'00'.repeat(16)}${q.y.toString(16).padStart(96, '0')}`;
      const chain = await call('hashToG1', [`0x${hexOf(msg)}`]);
      if (chain !== local) disagreements.push(`round ${r}`);
    }
    expect(disagreements).toEqual([]);
  }, 120_000);
});
