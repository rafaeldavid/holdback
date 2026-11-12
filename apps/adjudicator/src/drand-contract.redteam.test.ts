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
import {
  beaconRoundFor,
  commitmentId,
  holdbackDomain,
  plusSeconds,
  rulebookHash,
  signMessage,
  signTerms,
  type AdjudicatorRegistration,
  type Address as CoreAddress,
  type Club,
  type CommitmentTerms,
  type Decision,
  type Delivery,
  type Judgment,
  type Mandate,
  type Rulebook,
  type TokenAmount,
  type UnsignedMessage,
} from '@holdback/core';
import { encodePublicKey, encryptionKeyPairFromSecretKey, seal, wrapKeyForRecipients } from '@holdback/core/crypto';
import { EvmWorld } from '@holdback/settlement/evm';
import { EvmSettlement, rebindToken } from '@holdback/settlement/live';
import { SIM_RULEBOOK, type Genesis } from '@holdback/settlement/sim';
import { keccak256, stringToBytes } from 'viem';
import { sign } from 'viem/accounts';
import { QUICKNET_DST, quicknetValue } from './drand.js';
import { policyHashOf } from './policy.js';
import { placeholderRegistry, testAdjudicator, type TestAdjudicator } from './test-adjudicator.js';

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

// ADR-0032 (T-380, R8 fix 2), the done test: the reference adjudicator decides a fallback turn and an escalation on
// anvil, against HoldbackRules deployed with a beacon margin of 7 s over the sim beacon (round(t) = t). The fallback's
// round is judgeBy + 7 and the escalation's t1 + 8. The service reads the margin from the settlement layer
// (EvmSettlement.beaconMarginSec, the contract's BEACON_MARGIN()); a service that kept the old rule would sign rounds
// judgeBy and t1 + 1, which the contract refuses with BadSeed and core with seed_mismatch. Gated like the suite above.
const RULES_ARTIFACT = new URL('../../../contracts/out/HoldbackRules.sol/HoldbackRules.json', import.meta.url);
describe.runIf(ready && existsSync(RULES_ARTIFACT))('the reference adjudicator with a beacon margin on anvil (ADR-0032)', () => {
  const MARGIN = 7;
  const root = new URL('../../../', import.meta.url).pathname;
  const EXAMPLE = JSON.parse(readFileSync(new URL('../../../spec/examples/commitment.example.json', import.meta.url), 'utf8')) as CommitmentTerms;
  const CSV = readFileSync(new URL('../../../fixtures/data/dataset-cleaning/customers.clean.csv', import.meta.url), 'utf8');
  const secs = (ts: string) => Math.floor(Date.parse(ts) / 1000);
  const at = (t: number) => new Date(t * 1000).toISOString().replace('.000Z', 'Z');
  /** Keys from public labels; they guard no value. */
  const actor = (name: string) => {
    const key = keccak256(stringToBytes(`holdback/t-380-margin/${name}`));
    return { name, key, address: privateKeyToAccount(key).address.toLowerCase() as CoreAddress, enc: encryptionKeyPairFromSecretKey(Uint8Array.from(Buffer.from(keccak256(stringToBytes(`enc/${name}`)).slice(2), 'hex'))) };
  };
  let world: EvmWorld;
  beforeAll(async () => {
    world = await EvmWorld.start(root, { beaconMarginSec: MARGIN });
  }, 60_000);
  afterAll(async () => {
    await world?.stop();
  });

  it('decides the fallback on round judgeBy + 7 (it escalates) and the escalation on round t1 + 8; the contract accepts both', async () => {
    const [buyer, seller, primary, fallback, appeal] = ['buyer', 'seller', 'primary', 'fallback', 'appeal'].map(actor) as [ReturnType<typeof actor>, ReturnType<typeof actor>, ReturnType<typeof actor>, ReturnType<typeof actor>, ReturnType<typeof actor>];
    const token = world.deployment.token.toLowerCase();
    const amount = (v: bigint) => ({ token, amount: v.toString() }) as TokenAmount;
    const domain = holdbackDomain(world.chainId, world.deployment.rules.toLowerCase() as CoreAddress);
    const rulebook: Rulebook = { ...rebindToken(SIM_RULEBOOK, 'tUSD', token), disclosureMin: 'public', minWindowsSec: { judge: 10, fallback: 60, appealWindow: 0, appealDecide: 60 }, appealFee: amount(0n), randomness: { source: 'sim' } };
    const club: Club = { id: 't-380-margin', name: 'T-380 margin club', operator: primary.address, rulebook, rulebookHash: rulebookHash(rulebook) };
    const start = '2026-01-01T00:00:00Z';
    const mandates: Mandate[] = [];
    for (const who of [buyer, seller]) {
      const principal = actor(`${who.name}-principal`);
      const big = amount(10n ** 15n);
      const body = { principal: principal.address, agent: who.address, clubId: club.id, scope: { roles: ['buyer', 'seller'], maxPerCommitment: big, maxDaily: big, expiresAt: plusSeconds(start, 365 * 86_400) }, nonce: keccak256(stringToBytes(`mandate/${who.name}`)), issuedAt: start } as Omit<Mandate, 'signature'>;
      mandates.push({ ...body, signature: await signMessage(principal.key, domain, { ...body, type: 'Mandate' } as UnsignedMessage) } as Mandate);
    }
    const price = 5_000_000n;
    const fee = 1_000_000n;
    const bond = { junior: '0', senior: '0' };
    const genesis: Genesis = { start, simSeed: keccak256(stringToBytes('t-380-margin')), chainId: world.chainId, token, clubs: [club], mandates, members: [], balances: { [buyer.address]: (100n * price).toString(), [seller.address]: '0' }, bonds: { [primary.address]: bond, [fallback.address]: bond, [appeal.address]: bond } };
    const evm = await EvmSettlement.create(world, genesis, [buyer, seller, primary, fallback, appeal].map((a) => a.address));
    expect(evm.beaconMarginSec).toBe(MARGIN);

    const blobs = new Map<string, Uint8Array>();
    const records = new Map<string, Judgment>();
    const registrations = new Map<string, AdjudicatorRegistration>();
    const registry = placeholderRegistry();
    const service = (a: ReturnType<typeof actor>, judges?: Parameters<typeof testAdjudicator>[0]['judges']): TestAdjudicator => {
      const adj = testAdjudicator({
        name: a.name,
        label: `t380-${a.name}`,
        signingKey: a.key,
        encryptionSecretKey: a.enc.secretKey,
        chain: evm,
        store: { ciphertext: async (uri) => blobs.get(uri)!, publishRecord: async (r) => (records.set(r.recordHash, r), `mem://records/${r.recordHash}`) },
        registration: async (address) => registrations.get(address.toLowerCase()) ?? null,
        domain,
        fee: amount(fee),
        registry,
        trustedAdjudicators: [primary.address, fallback.address, appeal.address],
        ...(judges ? { judges } : {}),
      });
      registrations.set(adj.address, { ...adj.registration(), pool: {} as never, poolTermsHash: `0x${'00'.repeat(32)}`, status: 'active' });
      return adj;
    };
    const p = service(primary);
    // Only one family answers at the fallback, so its panel cannot accept or reject: it escalates.
    const f = service(fallback, { 'gpt-a': 'timeout', 'gpt-b': 'timeout', 'qwen-a': 'timeout', 'qwen-b': 'timeout' });
    const a = service(appeal);
    const must = (r: { ok: boolean; problem?: { detail: string } }) => {
      if (!r.ok) throw new Error(r.problem?.detail);
      evm.advance(1);
    };
    const signed = async <T extends UnsignedMessage>(who: ReturnType<typeof actor>, m: T) => ({ ...m, signature: await signMessage(who.key, domain, m) });

    const now = evm.now();
    const terms = {
      ...EXAMPLE,
      schemaVersion: '0.8',
      clubId: club.id,
      rulebookHash: club.rulebookHash,
      buyer: buyer.address,
      seller: seller.address,
      buyerPaymentAddress: buyer.address,
      sellerPayoutAddress: seller.address,
      price: amount(price),
      adjudication: { adjudicator: primary.address, fallbackAdjudicator: fallback.address, appealAdjudicator: appeal.address, policyId: p.service.policy.id, fee: amount(fee), registryHash: registry.hash, policyHash: policyHashOf(p.service.policy) },
      timing: { offerExpiresAt: plusSeconds(now, 60), fundBy: plusSeconds(now, 70), deliverBy: plusSeconds(now, 80), judgeBy: plusSeconds(now, 90), fallbackBy: plusSeconds(now, 600), appealWindowSec: 0, appealDecideSec: 300, maxSubmissions: 1 },
      settlement: { mode: 'guaranteed_on_decision', token },
      remedy: { onReject: 'full_refund' },
      disclosure: { level: 'public' },
      buyerEncryptionPublicKey: encodePublicKey(buyer.enc.publicKey),
      nonce: keccak256(stringToBytes('t-380-margin/terms')),
      createdAt: now,
    } as unknown as CommitmentTerms;
    delete (terms as Partial<{ id: unknown; signatures: unknown }>).id;
    delete (terms as Partial<{ id: unknown; signatures: unknown }>).signatures;
    const id = commitmentId(terms);
    must(await evm.submit({ kind: 'offer', commitment: { ...terms, id, signatures: { seller: await signTerms(seller.key, domain, terms) } } }));
    expect((await p.runOnce()).accepted).toEqual([id]);
    evm.advance(1);
    const agree = await signed(buyer, { type: 'Agree', commitmentId: id, buyer: buyer.address, nonce: keccak256(stringToBytes(`agree/${id}`)), expiresAt: terms.timing.offerExpiresAt } as const);
    const fa = await evm.fundingAuthorization(terms);
    const funding = { type: 'FundingAuthorization' as const, scheme: 'erc3009' as const, commitmentId: id, from: buyer.address, value: fa.value.toString(), token, validAfter: fa.validAfter, validBefore: fa.validBefore, nonce: fa.nonce, expiresAt: terms.timing.fundBy, signature: await sign({ hash: fa.digest, privateKey: buyer.key, to: 'hex' }) };
    must(await evm.submit({ kind: 'agree_and_fund', agree, funding }, { idempotencyKey: `fund/${id}` }));
    const sealed = await seal(new TextEncoder().encode(CSV));
    const uri = `mem://ciphertext/${sealed.ciphertextSha256}`;
    blobs.set(uri, sealed.ciphertext);
    const recipients = [primary, fallback, appeal, buyer].map((x) => ({ recipient: x.address, publicKey: x.enc.publicKey }));
    const body: Omit<Delivery, 'signature'> = { commitmentId: id, attempt: 1, ciphertext: { uri, sha256: sealed.ciphertextSha256, bytes: sealed.ciphertext.length, cipher: 'aes-256-gcm' }, plaintextSha256: sealed.plaintextSha256, plaintextMime: 'text/csv', encryptedKeys: wrapKeyForRecipients(sealed.key, recipients), submittedAt: evm.now() };
    must(await evm.submit({ kind: 'deliver', delivery: (await signed(seller, { ...body, type: 'Delivery' as const })) as unknown as Delivery }, { idempotencyKey: `deliver/${id}` }));
    expect(evm.escrowState(id)?.kind).toBe('Delivered');

    // The primary stays silent. At judgeBy the fallback triggers its takeover; its round, judgeBy + 7, is not out yet.
    const judgeBy = secs(terms.timing.judgeBy);
    evm.advanceTo(terms.timing.judgeBy);
    const early = await f.runOnce();
    expect(evm.escrowState(id)?.kind).toBe('FallbackJudging');
    expect(early.decided).toEqual([]);
    expect(beaconRoundFor(evm.escrowState(id)!, 'fallback', MARGIN)).toBe(judgeBy + MARGIN);
    evm.advanceTo(at(judgeBy + MARGIN));
    expect((await f.runOnce()).decided.map((d) => d.role)).toEqual(['fallback']);
    const escalated = evm.escrowState(id)!;
    if (escalated.kind !== 'Escalated') throw new Error(`expected Escalated, got ${escalated.kind}`);
    expect(escalated.escalation.by).toBe('fallback');
    const t1 = secs(escalated.escalation.at);
    expect(beaconRoundFor(escalated, 'appeal', MARGIN)).toBe(t1 + MARGIN + 1);

    // The appeal adjudicator waits for round t1 + 8, then decides on it; the work passes.
    evm.advanceTo(at(t1 + MARGIN));
    expect((await a.runOnce()).decided).toEqual([]);
    evm.advanceTo(at(t1 + MARGIN + 1));
    expect((await a.runOnce()).decided.map((d) => d.role)).toEqual(['appeal']);
    const after = evm.escrowState(id)!;
    expect(after.kind).toBe('Released');
    const final = after.kind === 'Released' && after.via.kind === 'escalation' ? after.via.decision : (undefined as never as Decision);
    expect(final).toMatchObject({ role: 'appeal', outcome: 'accept', beacon: { source: 'sim', round: t1 + MARGIN + 1 } });
    // Both decisions name the margin rounds in the settlement log.
    const decided = evm.log().filter((e) => e.type === 'judgment.decided' && e.commitmentId === id).map((e) => e.payload as { role?: string; beaconRound?: number });
    expect(decided.map((d) => [d.role, d.beaconRound])).toEqual([['fallback', judgeBy + MARGIN], ['appeal', t1 + MARGIN + 1]]);
  }, 120_000);
});
