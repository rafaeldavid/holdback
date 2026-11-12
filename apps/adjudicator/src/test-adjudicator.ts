// A test adjudicator for local worlds (`pnpm sim`): the real adjudicator service (service.ts) on a SimChain,
// with fake judges in place of models. No model runs and no key is needed. Every verdict a fake judge
// writes is marked as fake in its rationale and evidence, so a record read through the API never passes for
// real model output; the model IDs come from config/judges.yaml, whose placeholders say the same.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdjudicatorPolicy, AdjudicatorRegistration, AdjudicatorRole, Address, AnyCommitment, Commitment, Hex32, HoldbackDomain, TokenAmount } from '@holdback/core';
import { fakeProvider, type FakeScript, type JudgeProvider, type LoadedRegistry } from '@holdback/judgment';
import { keccak256, stringToBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { defaultPolicy, type KeptPolicies } from './policy.js';
import type { RandomnessSource } from './randomness.js';
import { loadRegistryFile } from './registry-file.js';
import { Adjudicator, type KeptRegistry, type RunReport } from './service.js';
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

function repoRegistry(file: string): LoadedRegistry {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, file))) {
    const up = dirname(dir);
    if (up === dir) throw new Error(`${file} not found above the adjudicator package`);
    dir = up;
  }
  const r = loadRegistryFile(join(dir, file));
  if (!r.ok) throw new Error(`${file}: ${r.error.detail}`);
  return r.value;
}

/** config/judges.yaml: pinned-format placeholder model IDs, used by fake judges only. */
export const placeholderRegistry = (): LoadedRegistry => repoRegistry('config/judges.yaml');

export const LIVE_REGISTRY_URI = 'file:///config/judges-live.yaml';
/** config/judges-live.yaml: real pinned models from two families, which live judges can call. */
export const liveRegistry = (): LoadedRegistry => repoRegistry('config/judges-live.yaml');

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
  /** Every policy a registration carried, by hash, so a bound policy survives the primary's next registration (T-221 review). */
  policy?(hash: Hex32): Promise<AdjudicatorPolicy | null>;
  domain: HoldbackDomain;
  fee: TokenAmount;
  /** Per judge: 'pass', 'fail', 'timeout' or a function. Default: every judge passes. */
  judges?: FakeScript;
  registry?: LoadedRegistry;
  /** Where `registry` is published. Default file:///config/judges.yaml. */
  registryUri?: string;
  /** The kept-policies data it runs under (AdjudicatorConfig.kept). Default: the build's own file. */
  kept?: KeptPolicies;
  /** ADR-0036: the other registries this build carries, each with the provider that reaches its models. */
  keptRegistries?: ReadonlyArray<KeptRegistry>;
  /**
   * Replaces the marked fake judges (a live panel). Already routed by provider and wrapped in the judge
   * timeout; the caller labels anything scripted it routes to.
   */
  provider?: JudgeProvider;
  /** Accept sealed offers without reading them (AdjudicatorConfig.acceptSealedUnread). Default false: decline. */
  acceptSealedUnread?: boolean;
  /**
   * The fallback and appeal adjudicators it accepts offers with (AdjudicatorConfig.trustedAdjudicators). A world's
   * adjudicators trust each other; unset, it trusts only itself and declines every offer naming another.
   */
  trustedAdjudicators?: readonly Address[];
  /**
   * Where it reads drand quicknet rounds for a commitment whose rulebook names drand-quicknet (`drandQuicknet()`,
   * T-217). Unset: it decides no such commitment's fallback or appeal turn, and the deal takes its default path.
   */
  drand?: RandomnessSource;
}

export interface TestAdjudicator {
  readonly address: Address;
  readonly service: Adjudicator;
  /** The settlement port it decides through. */
  readonly settlement: SettlementAdapter;
  /** The registration fields this adjudicator publishes (pool and status come from the settlement layer). */
  registration(): ReturnType<Adjudicator['registration']>;
  /** One pass: accept offers naming it, trigger due fallbacks, decide what is its turn. */
  runOnce(): Promise<RunReport>;
}

/**
 * An operator's `declines` read over a world's own adjudicators (T-221 review): why the one at `address` would decline
 * `role` on these terms, from the terms alone; null when it would take it; undefined when the world does not run it.
 * Terms it cannot read (a sealed wire form) give null, so they add no notice and refuse nothing.
 */
export function declinesOf(adjudicators: () => readonly TestAdjudicator[]) {
  return async (address: Address, role: AdjudicatorRole, commitment: AnyCommitment): Promise<string | null | undefined> => {
    const a = adjudicators().find((x) => x.address === address.toLowerCase());
    if (!a) return undefined;
    try {
      return (await a.service.declines(commitment as Commitment, role))?.detail ?? null;
    } catch {
      return null;
    }
  };
}

export function testAdjudicator(o: TestAdjudicatorOptions): TestAdjudicator {
  const address = privateKeyToAccount(o.signingKey).address.toLowerCase() as Address;
  const registry = o.registry ?? placeholderRegistry();
  const settlement = new SettlementAdapter({ chain: o.chain, store: o.store, registration: o.registration, ...(o.policy ? { policy: o.policy } : {}), ...(o.drand ? { drand: o.drand } : {}) });
  const service = new Adjudicator({
    address,
    name: o.name,
    signingKey: o.signingKey,
    encryptionSecretKey: o.encryptionSecretKey,
    seedSecret: keccak256(stringToBytes(`${o.signingKey}/seed-secret`)) as Hex32,
    policy: defaultPolicy(`${o.label}/p1`),
    registry,
    registryUri: o.registryUri ?? 'file:///config/judges.yaml',
    ...(o.keptRegistries ? { keptRegistries: o.keptRegistries } : {}),
    ...(o.kept ? { kept: o.kept } : {}),
    fee: { min: o.fee },
    domain: o.domain,
    provider: o.provider ?? markedFake(markerFake(o.judges ?? {})),
    settlement,
    ...(o.acceptSealedUnread ? { acceptSealedUnread: true } : {}),
    ...(o.trustedAdjudicators ? { trustedAdjudicators: o.trustedAdjudicators } : {}),
  });
  return { address, service, settlement, registration: () => service.registration(), runOnce: () => service.runOnce() };
}
