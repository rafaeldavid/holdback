// ADR-0036 section 5 (T-377): when an adjudicator of this world cannot judge an open deal on its terms, the public state
// read says which adjudicator, why, what follows and when, as soon as the terms show it, for the primary too. The notice
// is computed at read time, so it shows on a Held deal and after a restart.
import nacl from 'tweetnacl';
import { generatePrivateKey } from 'viem/accounts';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from '../../../examples/agent.ts';
import { serveTwoOrigins } from '../../../examples/two-origins.ts';
import { KEPT_POLICIES, type KeptPolicies } from '@holdback/adjudicator';
import { problem, type Address, type EscrowState } from '@holdback/core';
import { MemoryStorage, PublicWorld, type PublicWorldOptions } from './index.js';
import { cannotJudgeNotice, rolesAhead } from './world.js';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const running: Array<() => Promise<void>> = [];
afterEach(async () => void (await Promise.all(running.splice(0).map((c) => c()))));

async function serve(options: Partial<PublicWorldOptions>, storage: MemoryStorage) {
  const world = await PublicWorld.open({ storage, env: {}, minWindowSec: 2, ...options });
  const { urls, close } = await serveTwoOrigins(world, { tickMs: 100, keepContentLength: true });
  running.push(close);
  return { world, urls, close };
}

/** The same build, with screen-1 (the default every demo deal binds) withdrawn by a recorded decision. */
const WITHDRAWN: KeptPolicies = {
  ...KEPT_POLICIES,
  screens: KEPT_POLICIES.screens.map((s) => (s.version === 'screen-1' ? { ...s, status: 'withdrawn' as const, decision: 'D-test', reason: 'it would put deliverable text in an instruction position' } : s)),
};

/** A rubric deal at the demo's three adjudicators, funded and Held: the seller has not delivered. */
async function heldDeal(urls: string[]): Promise<string> {
  const index = ((await (await fetch(`${urls[0]}/`)).json()) as J).demo;
  const agent = () => new Agent(urls, generatePrivateKey(), nacl.randomBytes(32));
  const buyer = agent();
  const seller = agent();
  for (const a of [buyer, seller]) await a.call('POST', '/v1/faucet', { address: a.address });
  const [primary, fallback, appeal] = index.adjudicators.map((a: J) => a.address);
  const offer = await seller.offer({
    template: 'default',
    clubId: index.clubId,
    seller: seller.address,
    buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
    adjudicators: { primary, fallback, appeal },
    price: { token: 'tUSD', amount: '30000000' },
    deliverable: { kind: 'other', description: 'A unified diff', format: 'text/plain' },
    checks: [{ id: 'hidden', type: 'hidden_characters_max', required: true, max: { tag: 0, bidi: 0, total: 0 } }],
    rubric: { passThreshold: 300, criteria: [{ id: 'fixes', description: 'It fixes the bug.', weight: 100, anchors: { '0': 'No', '2': 'Partly', '4': 'Yes' } }] },
    timing: { judgeWithinSec: 600, fallbackWithinSec: 600, appealWindowSec: 2, appealDecideSec: 2 },
  });
  await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
  await buyer.agreeAndFund(offer.terms, 40_000_000n);
  await buyer.waitFor(offer.id, ['Held']);
  return offer.id;
}

const notices = async (url: string, id: string): Promise<string[]> => ((await (await fetch(`${url}/v1/commitments/${id}`)).json()) as J).notices ?? [];

describe('neutrality.notice-before-delivery: the state read names an adjudicator that cannot judge, before the seller delivers', () => {
  it('a Held deal shows the notice on both nodes once the build withdrew its version, and again after a restart', async () => {
    const storage = new MemoryStorage();
    const first = await serve({}, storage);
    const id = await heldDeal(first.urls);
    // The build that accepted it can judge it: no notice.
    expect((await notices(first.urls[0], id)).some((n) => /cannot judge/.test(n))).toBe(false);
    await first.close();

    const next = await serve({ kept: WITHDRAWN }, storage);
    for (const url of next.urls) {
      const said = (await notices(url, id)).join(' ');
      expect(said).toMatch(/^The primary adjudicator .* \(0x[0-9a-f]{40}\) cannot judge this deal: this build withdrew screen screen-1 \(D-test: it would put deliverable text in an instruction position\)/);
      expect(said).toMatch(/What follows: the fallback adjudicator .* cannot judge it either \(this build withdrew screen screen-1/);
      expect(said).toMatch(/it can take over from judgeBy 20\d\d-[0-9T:-]+Z and decide until fallbackBy 20\d\d-[0-9T:-]+Z\. If no adjudicator decides by fallbackBy, the default outcome applies: the buyer gets the price and the fee back, and the seller is paid \d+(\.\d+)?% of the price from the bonds of the adjudicators that missed their turns\. The parties can settle by mutual agreement before then\./);
      expect(said).toMatch(/The appeal adjudicator .* cannot judge this deal: this build withdrew screen screen-1/);
    }
    await next.close();

    // A restart: nothing was kept in memory, the notice is computed from the terms again.
    const again = await serve({ kept: WITHDRAWN }, storage);
    expect((await notices(again.urls[1], id)).join(' ')).toMatch(/^The primary adjudicator .* cannot judge this deal: this build withdrew screen screen-1/);
  });
});

describe('the notice text (ADR-0036 section 5)', () => {
  const A = '0x00000000000000000000000000000000000000aa' as Address;
  const B = '0x00000000000000000000000000000000000000bb' as Address;
  const C = '0x00000000000000000000000000000000000000cc' as Address;
  const terms = { adjudication: { adjudicator: A, fallbackAdjudicator: B, appealAdjudicator: C }, timing: { judgeBy: '2026-11-20T10:00:00Z', fallbackBy: '2026-11-21T10:00:00Z' } };
  const state = (kind: string, extra: object = {}) => ({ kind, terms, ...extra }) as unknown as EscrowState;
  const notCarried = problem('policy_mismatch', 'this build does not carry screen screen-0');
  const ours = (answers: Partial<Record<Address, 'can' | 'cannot'>>) => (address: Address) => {
    const a = answers[address];
    return a ? { name: `bench-${address.slice(-2)}`, cannotJudge: async () => (a === 'cannot' ? notCarried : null) } : undefined;
  };
  const PAYS = 'the buyer gets the price and the fee back';

  it('says nothing when every adjudicator it runs can judge, or the deal is not open', async () => {
    expect(await cannotJudgeNotice(state('Held'), ours({ [A]: 'can', [B]: 'can', [C]: 'can' }), PAYS)).toBeNull();
    expect(await cannotJudgeNotice(state('Offered'), ours({ [A]: 'cannot' }), PAYS)).toBeNull();
    expect(await cannotJudgeNotice(state('Released', { via: { kind: 'first_instance', appeal: { kind: 'expired' } } }), ours({ [C]: 'cannot' }), PAYS)).toBeNull();
  });

  it('the primary cannot, the fallback can: names both and the deadlines', async () => {
    const n = await cannotJudgeNotice(state('Delivered'), ours({ [A]: 'cannot', [B]: 'can', [C]: 'can' }), PAYS);
    expect(n).toBe(
      `The primary adjudicator bench-aa (${A}) cannot judge this deal: this build does not carry screen screen-0. What follows: the fallback adjudicator bench-bb can judge it; it can take over from judgeBy 2026-11-20T10:00:00Z and decide until fallbackBy 2026-11-21T10:00:00Z. If no adjudicator decides by fallbackBy, the default outcome applies: ${PAYS}. The parties can settle by mutual agreement before then.`,
    );
  });

  it('a fallback this operator does not run is unknown, never assumed', async () => {
    const n = await cannotJudgeNotice(state('Held'), ours({ [A]: 'cannot' }), PAYS);
    expect(n).toMatch(new RegExp(`whether the fallback adjudicator ${B} can judge it is unknown: this operator does not run it`));
  });

  it('the fallback cannot while the primary can: the default outcome follows only if the primary misses judgeBy', async () => {
    const n = await cannotJudgeNotice(state('Delivered'), ours({ [A]: 'can', [B]: 'cannot', [C]: 'can' }), PAYS);
    expect(n).toBe(
      `The fallback adjudicator bench-bb (${B}) cannot judge this deal: this build does not carry screen screen-0. What follows: The primary can judge it; if it does not decide by judgeBy, no fallback will decide, and at fallbackBy 2026-11-21T10:00:00Z the default outcome applies: ${PAYS}. The parties can settle by mutual agreement before then.`,
    );
  });

  it('an escalation the appeal adjudicator cannot judge defaults at appealDecideBy; an open appeal expires and the first decision stands', async () => {
    const esc = await cannotJudgeNotice(state('Escalated', { escalation: { by: 'primary', at: '2026-11-20T09:00:00Z', appealDecideBy: '2026-11-22T10:00:00Z' } }), ours({ [C]: 'cannot' }), PAYS);
    expect(esc).toMatch(/cannot judge this deal's escalation: .*at appealDecideBy 2026-11-22T10:00:00Z the default outcome applies/);
    const appeal = await cannotJudgeNotice(state('Released', { via: { kind: 'first_instance', appeal: { kind: 'open', appealDecideBy: '2026-11-23T10:00:00Z' } } }), ours({ [C]: 'cannot' }), PAYS);
    expect(appeal).toMatch(/cannot judge this deal's appeal: .*the appeal expires at 2026-11-23T10:00:00Z, and the first decision stands\./);
  });

  it('open means from the acceptance until no adjudicator can decide again', () => {
    expect(rolesAhead(state('Offered'))).toEqual([]);
    expect(rolesAhead(state('Held'))).toEqual(['primary', 'fallback', 'appeal']);
    expect(rolesAhead(state('FallbackJudging'))).toEqual(['fallback', 'appeal']);
    expect(rolesAhead(state('Escalated'))).toEqual(['appeal']);
    expect(rolesAhead(state('Refunded', { via: { kind: 'default_outcome', from: 'Escalated' } }))).toEqual([]);
  });
});

describe('the guard reads the open deals through the public reads (ADR-0036 section 4)', () => {
  it('lists a Held deal with its policy and registry hashes, and refuses a build that drops its screen', async () => {
    // @ts-expect-error -- a plain ESM script without type declarations
    const lib = (await import('../../../scripts/deploy-lib.mjs')) as { readOpenDeals: (node: string) => Promise<J>; guardDecision: (f: J) => J };
    const { policyHash } = await import('@holdback/core');
    const w = await serve({}, new MemoryStorage());
    const id = await heldDeal(w.urls);
    const read = await lib.readOpenDeals(w.urls[0]);
    expect(read.registrations).toHaveLength(3);
    const d = read.deals.find((x: J) => x.id === id);
    expect(d).toMatchObject({ state: 'Held', policyHash: expect.stringMatching(/^0x[0-9a-f]{64}$/), registryHash: KEPT_POLICIES.registries[0]!.hash });
    expect(d.nextDeadline).toMatch(/^\w+ 20\d\d-/);
    const facts = { live: { kept: KEPT_POLICIES, registrations: read.registrations }, deals: read.deals, hashOf: policyHash };
    expect(lib.guardDecision({ ...facts, next: KEPT_POLICIES }).refused).toBeNull();
    const dropped = { ...KEPT_POLICIES, screens: KEPT_POLICIES.screens.filter((s) => s.version !== 'screen-1'), default: { ...KEPT_POLICIES.default, screenVersion: 'screen-0' } };
    expect(lib.guardDecision({ ...facts, next: dropped }).refused).toMatch(new RegExp(`${id} Held, next deadline \\w+ .*: the new build does not carry screen-1`));
  });
});
