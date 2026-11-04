import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { panelSeed, type Decision } from '@holdback/core';
import { anvilAvailable } from '@holdback/settlement/evm';
import { SimChain } from '@holdback/settlement/sim';
import { diffLines, LOCAL_EXCLUSIONS, main, runScenario } from './runner.js';

const repo = new URL('../../../', import.meta.url).pathname;

/** A throwaway repo root holding a copy of the _example fixture and its recordings. */
function sandbox(): string {
  const root = mkdtempSync(join(tmpdir(), 'snap-'));
  mkdirSync(join(root, 'fixtures/scenarios'), { recursive: true });
  for (const f of ['_example.scenario.yaml', '_example.expect.md']) cpSync(join(repo, 'fixtures/scenarios', f), join(root, 'fixtures/scenarios', f));
  cpSync(join(repo, 'fixtures/recordings/_example'), join(root, 'fixtures/recordings/_example'), { recursive: true });
  for (const dir of ['clubs', 'terms', 'data']) cpSync(join(repo, 'fixtures', dir), join(root, 'fixtures', dir), { recursive: true });
  mkdirSync(join(root, 'config'));
  cpSync(join(repo, 'config/judges.yaml'), join(root, 'config/judges.yaml'));
  return root;
}

async function snap(root: string, ...argv: string[]) {
  const out: string[] = [];
  const code = await main(argv, { root, out: (l) => out.push(l) });
  return { code, out, text: out.join('\n') };
}

const deliverBeforeFund = (name: string) => `# @settlement sim @judges recorded @seed 3
name: ${name}
parties: { buyer: atlas-buyer, seller: tidewater-seller }
adjudicators: { primary: bench-a, fallback: bench-b, appeal: bench-c }
operators: [op-1]
faucet: { atlas-buyer: "10000000000", bench-a: "25000000000" }
steps:
  - offer: { by: seller, via: op-1 }
  - deliver: { by: seller, via: op-1, file: data/x.csv, stub_bytes: true }
expect: { problem: { step: 2, type: invalid_state } }
`;

/** A clean delivery the real deterministic checks pass, so the panel runs. */
const DELIVER = '  - deliver: { by: seller, via: op-1, file: data/dataset-cleaning/customers.clean.csv }';

/** A full-flow fixture with the given steps after delivery. */
const flow = (name: string, after: string, extra = '') => `# @settlement sim @judges fake @seed 11
name: ${name}
parties: { buyer: atlas-buyer, seller: tidewater-seller }
adjudicators: { primary: bench-a, fallback: bench-b, appeal: bench-c }
operators: [op-1, op-2]
faucet: { atlas-buyer: "10000000000", bench-a: "25000000000", bench-b: "25000000000", bench-c: "25000000000" }
${extra}steps:
  - offer: { by: seller, via: op-1 }
  - agree_and_fund: { by: buyer, via: op-1 }
${DELIVER}
${after}`;

async function fixture(root: string, name: string, text: string, ...argv: string[]) {
  writeFileSync(join(root, `fixtures/scenarios/${name}.scenario.yaml`), text);
  const r = await snap(root, '--judges', 'fake', '--update', name, ...argv);
  const path = join(root, `fixtures/scenarios/${name}.expect.md`);
  return { ...r, snapshot: existsSync(path) ? readFileSync(path, 'utf8') : '' };
}

/** A sandbox whose only fixture is a fast refusal with its snapshot: CLI tests need no judgment run. */
const REFUSAL = 'error.deliver-before-fund';
async function refusalOnly(): Promise<string> {
  const root = sandbox();
  for (const f of ['_example.scenario.yaml', '_example.expect.md']) rmSync(join(root, 'fixtures/scenarios', f));
  writeFileSync(join(root, `fixtures/scenarios/${REFUSAL}.scenario.yaml`), deliverBeforeFund(REFUSAL));
  await snap(root, '--update', REFUSAL);
  return root;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('_example on SimChain', () => {
  it("drives core's state machine through every real transition", async () => {
    const run = await runScenario({ root: repo, name: '_example' });
    expect(run.states).toEqual(['Offered', 'AcceptedByAdjudicator', 'Agreed', 'Held', 'Delivered', 'Released']);
    expect(run.summary.balances).toMatchObject({ 'atlas-buyer': 7950000000n, 'tidewater-seller': 2000000000n, 'bench-a': 25050000000n, escrow: 0n });
    expect(run.summary.invariants.every((i) => i.ok)).toBe(true);
  });

  it('leaks no wall-clock time or Math.random into the snapshot', async () => {
    const random = vi.spyOn(Math, 'random');
    vi.useFakeTimers({ now: new Date('2031-03-04T05:06:07.000Z'), toFake: ['Date'] });
    const a = await runScenario({ root: repo, name: '_example' });
    vi.setSystemTime(new Date('2099-12-31T23:59:59.000Z'));
    const b = await runScenario({ root: repo, name: '_example' });
    expect(a.snapshot).toBe(b.snapshot);
    expect(a.snapshot).not.toMatch(/2031|2099/);
    expect(random).not.toHaveBeenCalled();
  });
});

describe('pnpm snap', () => {
  it('prints one pass line per fixture and exits 0 when snapshots match', async () => {
    const r = await snap(await refusalOnly());
    expect(r.out[0]).toBe(`pass  ${REFUSAL}`);
    expect(r.out.at(-1)).toBe('snap: 1 passed, 0 failed');
    expect(r.code).toBe(0);
  });

  it('runs only the named fixture and fails on an unknown name', async () => {
    const root = await refusalOnly();
    writeFileSync(join(root, 'fixtures/scenarios/other.scenario.yaml'), deliverBeforeFund('other'));
    expect((await snap(root, REFUSAL)).out).toEqual([`pass  ${REFUSAL}`, 'snap: 1 passed, 0 failed']);
    const missing = await snap(root, 'nope');
    expect(missing.code).toBe(1);
    expect(missing.text).toMatch(/fail {2}nope: no fixture/);
  });

  it('prints a fail line with the first differing line and exits 1 on a snapshot diff', async () => {
    const root = sandbox();
    const file = join(root, 'fixtures/scenarios/_example.expect.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace('Released', 'Refunded'));
    const r = await snap(root);
    expect(r.code).toBe(1);
    expect(r.out[0]).toMatch(/^fail {2}_example: snapshot differs at line \d+/);
    expect(r.text).toMatch(/- .*Refunded/);
    expect(r.text).toMatch(/\+ .*Released/);
    expect(r.out.at(-1)).toBe('snap: 0 passed, 1 failed');
  });

  it('fails a fixture with no expect file and tells you how to create one', async () => {
    const root = sandbox();
    writeFileSync(join(root, 'fixtures/scenarios/error.deliver-before-fund.scenario.yaml'), deliverBeforeFund('error.deliver-before-fund'));
    const r = await snap(root);
    expect(r.code).toBe(1);
    expect(r.text).toMatch(/fail {2}error\.deliver-before-fund: no snapshot; run pnpm snap --update error\.deliver-before-fund/);
  });

  it('--update writes the snapshot, after which the fixture passes', async () => {
    const root = sandbox();
    const name = 'error.deliver-before-fund';
    writeFileSync(join(root, `fixtures/scenarios/${name}.scenario.yaml`), deliverBeforeFund(name));
    const u = await snap(root, '--update', name);
    expect(u.out[0]).toBe(`pass  ${name} (snapshot updated)`);
    const written = readFileSync(join(root, `fixtures/scenarios/${name}.expect.md`), 'utf8');
    expect(written).toMatch(/\| deliver .*\| invalid_state \|/);
    expect((await snap(root, name)).code).toBe(0);
  });

  it('applies prefix semantics: the same refusal passes as error. and fails as a normal fixture', async () => {
    const root = sandbox();
    writeFileSync(join(root, 'fixtures/scenarios/plain.scenario.yaml'), deliverBeforeFund('plain').replace(/expect:.*\n/, ''));
    const r = await snap(root, '--update', 'plain');
    expect(r.code).toBe(1);
    expect(r.out[0]).toMatch(/^fail {2}plain: .*terminal/);
  });

  it('fails an attack. fixture that auto-accepts', async () => {
    const root = sandbox();
    const src = readFileSync(join(root, 'fixtures/scenarios/_example.scenario.yaml'), 'utf8').replace('name: _example', 'name: attack.copy');
    writeFileSync(join(root, 'fixtures/scenarios/attack.copy.scenario.yaml'), src);
    cpSync(join(root, 'fixtures/recordings/_example'), join(root, 'fixtures/recordings/attack.copy'), { recursive: true });
    const r = await snap(root, '--judges', 'fake', '--update', 'attack.copy');
    expect(r.out[0]).toMatch(/^fail {2}attack\.copy: .*auto-accept/);
  });

  it('fails loudly when a recording no longer matches the judge input', async () => {
    const root = sandbox();
    // _example's primary panel under agg-3 (the policy hash seeds the panel): claude-b, gpt-a, qwen-a.
    const rec = join(root, 'fixtures/recordings/_example/primary/claude-b.json');
    const json = JSON.parse(readFileSync(rec, 'utf8'));
    writeFileSync(rec, JSON.stringify({ ...json, promptTemplateHash: `0x${'0'.repeat(64)}` }));
    const r = await snap(root);
    expect(r.code).toBe(1);
    expect(r.out[0]).toMatch(/^fail {2}_example: RecordingMismatchError: .*stale/);
    expect(r.text).toMatch(/promptTemplateHash/);
  });

  it('--judges fake --record writes recordings that recorded mode then replays', async () => {
    const root = sandbox();
    writeFileSync(join(root, 'fixtures/scenarios/_example.scenario.yaml'), readFileSync(join(root, 'fixtures/scenarios/_example.scenario.yaml'), 'utf8').replace('@seed 7', '@seed 9'));
    expect((await snap(root, '--judges', 'fake', '--record', '--update', '_example')).code).toBe(0);
    const saved = JSON.parse(readFileSync(join(root, 'fixtures/recordings/_example/primary/claude-a.json'), 'utf8'));
    expect(saved).toMatchObject({ role: 'primary', judgeId: 'claude-a', model: 'placeholder-claude-a-20260601', capturedFrom: 'fake' });
    // Recorded mode replays the new recordings without a mismatch, then the snapshot matches.
    expect((await snap(root, '--update', '_example')).code).toBe(0);
    expect((await snap(root, '_example')).code).toBe(0);
  });

  it('--migrate-recordings moves v0 recordings under their role and runs alone', async () => {
    const root = sandbox();
    const dir = join(root, 'fixtures/recordings/_example');
    const v1 = JSON.parse(readFileSync(join(dir, 'primary/claude-b.json'), 'utf8'));
    delete v1.role;
    writeFileSync(join(dir, 'claude-b.json'), JSON.stringify({ ...v1, format: 'holdback.recording/v0' }));
    rmSync(join(dir, 'primary/claude-b.json'));
    const r = await snap(root, '--migrate-recordings');
    expect(r.code).toBe(0);
    expect(r.out).toContain('moved  fixtures/recordings/_example/claude-b.json -> fixtures/recordings/_example/primary/claude-b.json');
    expect((await snap(root, '_example')).code).toBe(0);
    expect((await snap(root, '--migrate-recordings', '_example')).code).toBe(2);
  });

  it('accepts --flag=value and --flag value forms', async () => {
    const root = await refusalOnly();
    expect((await snap(root, '--settlement=sim', '--judges=recorded')).code).toBe(0);
    expect((await snap(root, '--settlement', 'sim', REFUSAL)).code).toBe(0);
  });

  it('refuses live judges with a clear message and no network', async () => {
    const r = await snap(sandbox(), '--judges', 'live', '_example');
    expect(r.code).toBe(2);
    expect(r.text).toMatch(/live judges are unavailable/);
    expect(r.text).not.toMatch(/not implemented yet/);
  });

  it('refuses --record without --judges live or fake', async () => {
    const r = await snap(sandbox(), '--record', '_example');
    expect(r.code).toBe(2);
    expect(r.text).toMatch(/--record needs --judges live/);
  });

  it('refuses --update without a fixture name', async () => {
    expect((await snap(sandbox(), '--update')).text).toMatch(/--update needs a fixture name/);
  });

  it('refuses the testnet settlement (T-206 gate)', async () => {
    const r = await snap(sandbox(), '--settlement=testnet');
    expect(r.code).toBe(2);
    expect(r.text).toMatch(/T-206/);
  });

  it('names every fixture kept on SimChain until Phase 4, each with a reason', () => {
    expect(Object.keys(LOCAL_EXCLUSIONS).length).toBeGreaterThan(0);
    for (const [name, reason] of Object.entries(LOCAL_EXCLUSIONS)) {
      expect(existsSync(join(repo, 'fixtures/scenarios', `${name}.scenario.yaml`))).toBe(true);
      expect(reason).toMatch(/Phase 4/);
    }
  });

  it('diffs normalised transcripts line by line', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual(['- b', '+ x']);
    expect(diffLines(['a'], ['a'])).toEqual([]);
  });

  const anvil = anvilAvailable() && existsSync(join(repo, 'contracts/out/HoldbackRules.sol/HoldbackRules.json'));
  it.skipIf(!anvil)(`runs a fixture on the contract and compares it with SimChain${anvil ? '' : ' (SKIPPED: needs anvil and forge build)'}`, async () => {
    const root = sandbox();
    const r = await main(['--settlement=local', '_example'], { root, contractsRoot: repo, out: () => undefined });
    expect(r).toBe(0);
    const out: string[] = [];
    await main(['--settlement=local', '_example'], { root, contractsRoot: repo, out: (l) => out.push(l) });
    const text = out.join('\n');
    expect(text).toMatch(/pass {2}_example on the contract/);
    expect(text).toMatch(/excluded until Phase 4/);
    expect(text).toMatch(/gas \d/);
  }, 120_000);

  it('refuses unknown flags and bad flag values', async () => {
    expect((await snap(sandbox(), '--colour')).code).toBe(2);
    expect((await snap(sandbox(), '--judges=maybe')).text).toMatch(/--judges/);
  });

  it('fails a fixture whose club file exists but is invalid, rather than ignoring it', async () => {
    const root = sandbox();
    writeFileSync(join(root, 'fixtures/clubs/data-services-v1.yaml'), 'id: data-services-v1\n');
    const r = await snap(root);
    expect(r.code).toBe(1);
    expect(r.out[0]).toMatch(/fail {2}_example: .*data-services-v1\.yaml: /);
  });

  it('fails a fixture whose terms file exists but is invalid, rather than ignoring it', async () => {
    const root = sandbox();
    const terms = join(root, 'fixtures/terms/clean-customers-2000.yaml');
    writeFileSync(terms, readFileSync(terms, 'utf8').replace('amount: "2000000000"', 'amount: 2000000000'));
    const r = await snap(root);
    expect(r.code).toBe(1);
    expect(r.out[0]).toMatch(/fail {2}_example: .*clean-customers-2000\.yaml: .*amount/);
  });

  it('refuses an offer whose terms are signed by the buyer instead of the seller', async () => {
    const root = sandbox();
    const name = 'error.offer-signed-by-buyer';
    const src = deliverBeforeFund(name)
      .replace('  - offer: { by: seller, via: op-1 }', '  - offer: { by: seller, via: op-1, signer: atlas-buyer }')
      .replace('{ step: 2, type: invalid_state }', '{ step: 1, type: invalid_signature }');
    const r = await fixture(root, name, src);
    expect(r.out[0]).toBe(`pass  ${name} (snapshot updated)`);
    expect(r.snapshot).toMatch(/\| tidewater-seller \| offer \| op-1 \| invalid_signature \| — \|/);
  });

  it('fails a deliver whose file is absent unless the fixture opts into stub bytes', async () => {
    const root = sandbox();
    const r = await fixture(root, 'nofile', flow('nofile', '').replace('data/dataset-cleaning/customers.clean.csv', 'data/x.csv'));
    expect(r.code).toBe(1);
    expect(r.out[0]).toMatch(/fail {2}nofile: ScenarioError: .*fixtures\/data\/x\.csv.*stub_bytes: true/);
  });

  it('a normal fixture may end with the buyer reclaiming after the seller never delivers', async () => {
    const root = sandbox();
    const src = flow('reclaimed', '  - advance_clock: { seconds: 172800 }\n  - reclaim: { by: buyer }\n').replace(`${DELIVER}\n`, '');
    const r = await fixture(root, 'reclaimed', src);
    expect(r.out[0]).toBe('pass  reclaimed (snapshot updated)');
    // Any other outage still needs the neutrality. prefix.
    const offline = flow('offline-plain', '  - offline: { actor: bench-a }\n  - judge: { adjudicator: bench-a }\n');
    expect((await fixture(root, 'offline-plain', offline)).out[0]).toMatch(/bench-a failed at step 5; use the neutrality\. prefix/);
  });

  it('expire: an accepted offer the buyer never agrees to expires after offerExpiresAt', async () => {
    const root = sandbox();
    const name = 'neutrality.buyer-never-funds';
    const src = flow(name, '', 'fails: atlas-buyer\n')
      .replace('  - agree_and_fund: { by: buyer, via: op-1 }\n', '  - adjudicator_accept: {}\n  - advance_clock: { seconds: 900 }\n  - expire: {}\n')
      .replace(`${DELIVER}\n`, '');
    const r = await fixture(root, name, src);
    expect(r.out[0]).toBe(`pass  ${name} (snapshot updated)`);
    expect(r.snapshot).toMatch(/\| anyone \| expire \| direct \| ok \| Expired \|/);
  });

  it('attack: an empty attack fixture fails, as does one that stops at Held', async () => {
    const root = sandbox();
    const empty = deliverBeforeFund('attack.empty').replace(/steps:[\s\S]*$/, 'steps: []\n');
    expect((await fixture(root, 'attack.empty', empty)).out[0]).toMatch(/fail {2}attack\.empty: .*(escalat|reject)/);
    const held = flow('attack.held', '').replace(`${DELIVER}\n`, '');
    expect((await fixture(root, 'attack.held', held)).out[0]).toMatch(/fail {2}attack\.held: /);
  });

  it('todo: a fixture the runner cannot run records the error in its snapshot and passes', async () => {
    const root = sandbox();
    const name = 'todo.milestone-delivery';
    const src = deliverBeforeFund(name).replace('  - offer: { by: seller, via: op-1 }', '  - deliver_milestone: { by: seller, milestone: 1 }');
    const r = await fixture(root, name, src);
    expect(r.out[0]).toBe(`pass  ${name} (todo) (snapshot updated)`);
    expect(r.snapshot).toMatch(/## Error/);
    expect(r.snapshot).toMatch(/ScenarioError: steps\[1\]: unknown step "deliver_milestone"/);
    expect((await snap(root, name)).out[0]).toBe(`pass  ${name} (todo)`);
  });

  it('todo: a recording error still fails loudly', async () => {
    const root = sandbox();
    const src = readFileSync(join(root, 'fixtures/scenarios/_example.scenario.yaml'), 'utf8').replace('name: _example', 'name: todo.copy');
    writeFileSync(join(root, 'fixtures/scenarios/todo.copy.scenario.yaml'), src);
    const r = await snap(root, '--update', 'todo.copy');
    expect(r.code).toBe(1);
    expect(r.out[0]).toMatch(/fail {2}todo\.copy: RecordingMissingError/);
  });

  it('early_accept: the buyer accepts before any decision; price to the seller, fee back, key released', async () => {
    const root = sandbox();
    const r = await fixture(root, 'early', flow('early', '  - early_accept: { by: buyer }\n  - verify_key_release: { by: buyer }\n'));
    expect(r.out[0]).toBe('pass  early (snapshot updated)');
    expect(r.snapshot).toMatch(/\| atlas-buyer \| early_accept \| direct \| ok \| Released \|/);
    expect(r.snapshot).toMatch(/\| early_accept \| 8,000\.000000 \| 0 \| 2,000\.000000 \| 25,000\.000000 \|/);
    expect(r.snapshot).toMatch(/fetch key \+ verify plaintext hash \| direct \| hash matches/);
  });

  it('mutual_settle: both parties sign payouts that split the price; Settled is terminal and the key can be released', async () => {
    const root = sandbox();
    const name = 'settled';
    const r = await fixture(root, name, flow(name, '  - mutual_settle: { payouts: { tidewater-seller: "1500000000", atlas-buyer: "500000000" }, release_key: true }\n  - verify_key_release: { by: buyer }\n'));
    expect(r.out[0]).toBe(`pass  ${name} (snapshot updated)`);
    expect(r.snapshot).toMatch(/\| atlas-buyer \+ tidewater-seller \| mutual_settle \| direct \| ok \| Settled \|/);
    expect(r.snapshot).toMatch(/\| mutual_settle \| 8,500\.000000 \| 0 \| 1,500\.000000 \|/);
    expect(r.snapshot).toMatch(/Final state: Settled\./);
  });

  it('mutual_settle refuses payouts that do not sum to the price', async () => {
    const root = sandbox();
    const name = 'error.short-settlement';
    const src = flow(name, '  - mutual_settle: { payouts: { tidewater-seller: "1000000000" } }\n') + 'expect: { problem: { step: 4, type: invalid_terms } }\n';
    expect((await fixture(root, name, src)).out[0]).toBe(`pass  ${name} (snapshot updated)`);
  });

  it('deliver attempt: a second delivery after the first is refused with invalid_state, before the attempt count', async () => {
    const root = sandbox();
    const name = 'error.second-attempt';
    const src = flow(name, '  - deliver: { by: seller, file: data/dataset-cleaning/customers.clean.csv, attempt: 2 }\n') + 'expect: { problem: { step: 4, type: invalid_state } }\n';
    const r = await fixture(root, name, src);
    // Delivered is not Held, so the state machine refuses before the attempt count; from Held it is the
    // limit (fixtures/scenarios/error.submission-limit).
    expect(r.out[0]).toBe(`pass  ${name} (snapshot updated)`);
    expect(r.snapshot).toMatch(/deliver \(attempt 2\)/);
  });

  it('expire_appeal closes the appeal window after appealBy', async () => {
    const root = sandbox();
    const r = await fixture(root, 'closed', flow('closed', '  - judge: { adjudicator: bench-a }\n  - advance_clock: { seconds: 300 }\n  - expire_appeal: {}\n'));
    expect(r.out[0]).toBe('pass  closed (snapshot updated)');
    expect(r.snapshot).toMatch(/\| anyone \| expire_appeal \| direct \| ok \| Released \|/);
  });

  it('tamper: each deliberate message fault is refused with its problem type', async () => {
    const root = sandbox();
    const accept = (tamper: string) => flow('x', '').replace('  - agree_and_fund: { by: buyer, via: op-1 }', `  - adjudicator_accept: { tamper: ${tamper} }`).replace(`${DELIVER}\n`, '');
    const cases: Array<[string, string, number, string]> = [
      ['policy', accept('wrong_policy_hash'), 2, 'policy_mismatch'],
      ['registry', accept('wrong_registry_hash'), 2, 'registry_mismatch'],
      ['acceptance', accept('wrong_commitment_id'), 2, 'not_found'],
      ['seed', flow('x', '  - judge: { adjudicator: bench-a, tamper: wrong_seed }\n'), 4, 'seed_mismatch'],
      ['preimage', flow('x', '  - judge: { adjudicator: bench-a }\n').replace('  - agree_and_fund: { by: buyer, via: op-1 }', '  - adjudicator_accept: { tamper: wrong_seed_commitment }\n  - agree_and_fund: { by: buyer, via: op-1 }'), 5, 'seed_mismatch'],
      ['decision-nonce', flow('x', '  - judge: { adjudicator: bench-a, tamper: reuse_nonce }\n'), 4, 'nonce_reused'],
      ['attempt', flow('x', '  - judge: { adjudicator: bench-a, tamper: wrong_attempt }\n'), 4, 'invalid_terms'],
      // The terms' row-count check fails on the row-drop file, so Bench A rejects, and a key on the reject is refused.
      ['buyer-key', flow('x', '  - judge: { adjudicator: bench-a, tamper: buyer_key }\n', 'terms: fixtures/terms/clean-customers-2000.yaml\n').replace('customers.clean.csv', 'customers.clean.row-drop.csv'), 4, 'invalid_terms'],
      ['terms-nonce', flow('x', '  - offer: { by: seller, commitment: 2, tamper: reuse_nonce }\n'), 4, 'nonce_reused'],
    ];
    for (const [label, src, step, type] of cases) {
      const name = `error.tamper-${label}`;
      const r = await fixture(root, name, `${src.replace('name: x', `name: ${name}`)}expect: { problem: { step: ${step}, type: ${type} } }\n`);
      expect(r.out[0], label).toBe(`pass  ${name} (snapshot updated)`);
    }
    const bad = await fixture(root, 'x-tamper', flow('x-tamper', '  - reclaim: { by: buyer, tamper: wrong_seed }\n'));
    expect(bad.out[0]).toMatch(/reclaim signs nothing that can be tampered with/);
    const wrong = await fixture(root, 'x-tamper2', flow('x-tamper2', '  - judge: { adjudicator: bench-a, tamper: wrong_commitment_id }\n'));
    expect(wrong.out[0]).toMatch(/must be one of reuse_nonce, wrong_seed/);
  });

  it('tamper: wrong_attempt signs a beacon role the seed of the attempt it names (T-206 H-1)', async () => {
    // Settlement refuses the attempt before the seed, so only the signed message shows the seed is the right one.
    const submitted: Decision[] = [];
    const submit = SimChain.prototype.submit;
    vi.spyOn(SimChain.prototype, 'submit').mockImplementation(function (this: SimChain, s, o) {
      if (s.kind === 'decide' && s.message.role === 'appeal') submitted.push(s.message);
      return submit.call(this, s, o);
    });
    const root = sandbox();
    const name = 'error.tamper-appeal-attempt';
    const steps = '  - advance_clock: { seconds: 5 }\n  - judge: { adjudicator: bench-a }\n  - judge: { adjudicator: bench-c, tamper: wrong_attempt }\n  - judge: { adjudicator: bench-c }\n';
    // The long record leaves the judges a stride sample: Bench A escalates and Bench C decides.
    const src = flow(name, steps, 'club: fixtures/clubs/data-services-v1.yaml\nterms: fixtures/terms/clean-customers-2000.yaml\n').replace('customers.clean.csv', 'customers.clean.long-record.csv');
    const r = await fixture(root, name, `${src}expect: { problem: { step: 6, type: invalid_terms } }\n`);
    expect(r.out[0]).toBe(`pass  ${name} (snapshot updated)`);
    const [tampered, honest] = submitted;
    expect(tampered && honest && tampered.beacon).toEqual(honest?.beacon);
    expect([tampered?.attempt, honest?.attempt]).toEqual([2, 1]);
    expect(tampered?.seed).toBe(panelSeed(honest!.commitmentId, 'appeal', 2, honest!.beacon!.value));
    expect(honest?.seed).toBe(panelSeed(honest!.commitmentId, 'appeal', 1, honest!.beacon!.value));
  });

  it('tamper: a fault the step never applied is a run error, not a pass', async () => {
    const root = sandbox();
    // The seller has no earlier terms nonce to reuse on its first offer.
    const r = await fixture(root, 'error.no-prior-nonce', `${flow('error.no-prior-nonce', '').replace('  - offer: { by: seller, via: op-1 }', '  - offer: { by: seller, via: op-1, tamper: reuse_nonce }')}expect: { problem: { step: 1, type: nonce_reused } }\n`);
    expect(r.out[0]).toMatch(/fail {2}error\.no-prior-nonce: ScenarioError: steps\[1\]\.offer: tamper reuse_nonce was never applied/);
    // An honest accept already carries the buyer's key, so buyer_key changes nothing there.
    const k = await fixture(root, 'error.key-on-accept', `${flow('error.key-on-accept', '  - judge: { adjudicator: bench-a, tamper: buyer_key }\n')}expect: { problem: { step: 4, type: invalid_terms } }\n`);
    expect(k.out[0]).toMatch(/fail {2}error\.key-on-accept: ScenarioError: steps\[4\]\.judge: tamper buyer_key was never applied/);
  });

  it('attack: placeholder bytes fail the fixture, since no defense is exercised', async () => {
    const root = sandbox();
    const src = flow('attack.stub', '  - judge: { adjudicator: bench-a }\n').replace(DELIVER, '  - deliver: { by: seller, via: op-1, file: data/absent.csv, stub_bytes: true }');
    const r = await fixture(root, 'attack.stub', `${src}expect: { terminal: Refunded }\n`);
    expect(r.out[0]).toMatch(/fail {2}attack\.stub: .*placeholder bytes .*use the todo\. prefix/);
  });

  it('attack: an expect block does not excuse an attack that was neither rejected, escalated nor refused', async () => {
    const root = sandbox();
    const held = flow('attack.held2', '').replace(`${DELIVER}\n`, '');
    const r = await fixture(root, 'attack.held2', `${held}expect: { balances: { escrow: "2050000000" } }\n`);
    expect(r.out[0]).toMatch(/fail {2}attack\.held2: .*must end escalated, rejected or refused/);
  });

  it('refuses steps the settlement cannot run yet, with the reason', async () => {
    const root = sandbox();
    for (const [step, why] of [
      ['dispute', /Phase 4/],
      ['revoke_member', /member revocation/],
      ['revoke_mandate', /mandate revocation/],
    ] as const) {
      const r = await fixture(root, `x-${step}`, flow(`x-${step}`, `  - ${step}: { by: buyer }\n`));
      expect(r.out[0]).toMatch(why);
    }
    const r = await fixture(root, 'x-commit', flow('x-commit', '  - advance_clock: { seconds: 1, commitment: 2 }\n'));
    expect(r.out[0]).toMatch(/advance_clock does not act on a commitment/);
  });

  it('refuses --record without a fixture name', async () => {
    const r = await snap(sandbox(), '--judges', 'fake', '--record');
    expect(r.code).toBe(2);
    expect(r.text).toMatch(/--record needs a fixture name/);
  });

  it('never writes a snapshot when not asked to', async () => {
    const root = sandbox();
    writeFileSync(join(root, 'fixtures/scenarios/error.x.scenario.yaml'), deliverBeforeFund('error.x'));
    await snap(root);
    expect(existsSync(join(root, 'fixtures/scenarios/error.x.expect.md'))).toBe(false);
  });
});
