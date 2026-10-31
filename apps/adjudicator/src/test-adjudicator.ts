// A test adjudicator for local worlds (`pnpm sim`): the real adjudicator service (service.ts) on a SimChain,
// with fake judges in place of models. No model runs and no key is needed. Every verdict a fake judge
// writes is marked as fake in its rationale and evidence, so a record read through the API never passes for
// real model output; the model IDs come from config/judges.yaml, whose placeholders say the same.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdjudicatorRegistration, Address, Hex32, HoldbackDomain, TokenAmount } from '@holdback/core';
import { encodePublicKey, encryptionKeyPairFromSecretKey } from '@holdback/core/crypto';
import { fakeProvider, type FakeScript, type JudgeProvider, type LoadedRegistry } from '@holdback/judgment';
import { keccak256, stringToBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { defaultPolicy } from './policy.js';
import { loadRegistryFile } from './registry-file.js';
import { Adjudicator, type RunReport } from './service.js';
import { SettlementAdapter, type ContentStore, type SettlementReads } from './simchain-adapter.js';

export const FAKE_JUDGE_MARK = '[fake judge, no model ran]';
/** A delivery containing this text fails every fake judge, so the reject and appeal paths can be tried. */
export const FAIL_MARKER = 'FAIL-ME';

/** Fake judges that fail any work containing `marker` and otherwise follow `script` (unscripted judges pass). */
export function markerFake(script: FakeScript = {}, marker = FAIL_MARKER): JudgeProvider {
  const normal = fakeProvider(script);
  return {
    complete: (req) => (req.user.includes(marker) ? fakeProvider({ [req.judgeId]: 'fail' }).complete(req) : normal.complete(req)),
  };
}

const mark = (text: unknown, max: number): unknown => (typeof text === 'string' && !text.startsWith(FAKE_JUDGE_MARK) ? `${FAKE_JUDGE_MARK} ${text}`.slice(0, max) : text);

/** Wraps a provider so every verdict's rationale and evidence start with FAKE_JUDGE_MARK. */
export function markedFake(inner: JudgeProvider): JudgeProvider {
  return {
    async complete(req) {
      const res = await inner.complete(req);
      if (res.kind !== 'ok') return res;
      let v: Record<string, unknown>;
      try {
        v = JSON.parse(res.text) as Record<string, unknown>;
      } catch {
        return res;
      }
      const criteria = Array.isArray(v['criteria']) ? (v['criteria'] as Array<Record<string, unknown>>).map((c) => ({ ...c, evidence: mark(c['evidence'], 300) })) : v['criteria'];
      return { ...res, text: JSON.stringify({ ...v, criteria, rationale: mark(v['rationale'], 600) }) };
    },
  };
}

/** config/judges.yaml: pinned-format placeholder model IDs, used by fake judges only. */
export function placeholderRegistry(): LoadedRegistry {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'config/judges.yaml'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('config/judges.yaml not found above the adjudicator package');
    dir = up;
  }
  const r = loadRegistryFile(join(dir, 'config/judges.yaml'));
  if (!r.ok) throw new Error(`config/judges.yaml: ${r.error.detail}`);
  return r.value;
}

export interface TestAdjudicatorOptions {
  /** Display name, published in the registration. */
  name: string;
  /** Policy ID prefix, e.g. 'sim-a'. */
  label: string;
  signingKey: Hex;
  encryptionSecretKey: Uint8Array;
  chain: SettlementReads;
  /** Where it reads ciphertext by URI and publishes judgment records. */
  store: ContentStore;
  /** Registrations of every adjudicator, for the service's own checks. */
  registration(address: Address): Promise<AdjudicatorRegistration | null>;
  domain: HoldbackDomain;
  fee: TokenAmount;
  /** Per judge: 'pass', 'fail', 'timeout' or a function. Default: every judge passes. */
  judges?: FakeScript;
  registry?: LoadedRegistry;
}

export interface TestAdjudicator {
  readonly address: Address;
  readonly service: Adjudicator;
  /** The registration fields this adjudicator publishes (pool and status come from the settlement layer). */
  registration(): ReturnType<Adjudicator['registration']>;
  /** One pass: accept offers naming it, trigger due fallbacks, decide what is its turn. */
  runOnce(): Promise<RunReport>;
}

export function testAdjudicator(o: TestAdjudicatorOptions): TestAdjudicator {
  const address = privateKeyToAccount(o.signingKey).address.toLowerCase() as Address;
  const registry = o.registry ?? placeholderRegistry();
  const service = new Adjudicator({
    address,
    name: o.name,
    signingKey: o.signingKey,
    encryptionSecretKey: o.encryptionSecretKey,
    seedSecret: keccak256(stringToBytes(`${o.signingKey}/seed-secret`)) as Hex32,
    policy: defaultPolicy(`${o.label}/p1`),
    registry,
    registryUri: 'file:///config/judges.yaml',
    fee: { min: o.fee },
    domain: o.domain,
    provider: markedFake(markerFake(o.judges ?? {})),
    settlement: new SettlementAdapter({ chain: o.chain, store: o.store, registration: o.registration }),
  });
  return { address, service, registration: () => service.registration(), runOnce: () => service.runOnce() };
}

/** The encryption public key for a secret key, as a registration publishes it. */
export const encryptionPublicKeyOf = (secretKey: Uint8Array) => encodePublicKey(encryptionKeyPairFromSecretKey(secretKey).publicKey);
