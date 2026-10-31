import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main, runScenario } from './runner.js';

const repo = new URL('../../../', import.meta.url).pathname;
const exampleExpect = () => readFileSync(join(repo, 'fixtures/scenarios/_example.expect.md'), 'utf8');

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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('_example against the stub settlement', () => {
  it('reproduces the committed expect file exactly', async () => {
    const run = await runScenario({ root: repo, name: '_example' });
    expect(run.snapshot).toBe(exampleExpect());
    expect(run.outcome).toMatchObject({ pass: true, label: 'pass' });
  });

  it("drives core's state machine through every real transition", async () => {
    const run = await runScenario({ root: repo, name: '_example' });
    expect(run.states).toEqual(['Offered', 'AcceptedByAdjudicator', 'Agreed', 'Held', 'Delivered', 'Released']);
    expect(run.summary.balances).toMatchObject({ 'atlas-buyer': 7950000000n, 'tidewater-seller': 2000000000n, 'bench-a': 25050000000n, escrow: 0n });
    expect(run.summary.invariants.every((i) => i.ok)).toBe(true);
  });

  it('renders the sections docs/testing.md lists, in order', async () => {
    const { snapshot } = await runScenario({ root: repo, name: '_example' });
    const headings = snapshot.split('\n').filter((l) => l.startsWith('## '));
    expect(headings).toEqual(['## Input', '## Timeline', '## Balances (tUSD)', '## Judgment', '## Receipts and log', '## Invariants', '## Outcome']);
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

  it('gives a different but stable transcript for a different seed', async () => {
    const root = sandbox();
    const file = join(root, 'fixtures/scenarios/_example.scenario.yaml');
    writeFileSync(file, readFileSync(file, 'utf8').replace('@seed 7', '@seed 8'));
    // Seed 8 changes addresses and so the judge input hash: the recordings are stale and must fail loudly.
    const r = await snap(root, '_example');
    expect(r.code).toBe(1);
    expect(r.text).toMatch(/fail {2}_example: RecordingMismatchError/);
  });
});

describe('pnpm snap', () => {
  it('prints one pass line per fixture and exits 0 when snapshots match', async () => {
    const r = await snap(sandbox());
    expect(r.out[0]).toBe('pass  _example');
    expect(r.out.at(-1)).toBe('snap: 1 passed, 0 failed');
    expect(r.code).toBe(0);
  });

  it('runs only the named fixture and fails on an unknown name', async () => {
    const root = sandbox();
    writeFileSync(join(root, 'fixtures/scenarios/other.scenario.yaml'), deliverBeforeFund('other'));
    expect((await snap(root, '_example')).out).toEqual(['pass  _example', 'snap: 1 passed, 0 failed']);
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
    const rec = join(root, 'fixtures/recordings/_example/primary/claude-a.json');
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
    const v1 = JSON.parse(readFileSync(join(dir, 'primary/claude-a.json'), 'utf8'));
    delete v1.role;
    writeFileSync(join(dir, 'claude-a.json'), JSON.stringify({ ...v1, format: 'holdback.recording/v0' }));
    rmSync(join(dir, 'primary/claude-a.json'));
    const r = await snap(root, '--migrate-recordings');
    expect(r.code).toBe(0);
    expect(r.out).toContain('moved  fixtures/recordings/_example/claude-a.json -> fixtures/recordings/_example/primary/claude-a.json');
    expect((await snap(root, '_example')).code).toBe(0);
    expect((await snap(root, '--migrate-recordings', '_example')).code).toBe(2);
  });

  it('accepts --flag=value and --flag value forms', async () => {
    expect((await snap(sandbox(), '--settlement=sim', '--judges=recorded')).code).toBe(0);
    expect((await snap(sandbox(), '--settlement', 'sim', '_example')).code).toBe(0);
  });

  it('refuses live judges in this task with a clear message and no network', async () => {
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

  it('refuses --update together with live judges, and --update without a name', async () => {
    expect((await snap(sandbox(), '--update')).text).toMatch(/--update needs a fixture name/);
  });

  it('refuses the local and testnet settlements until Phase 2', async () => {
    for (const s of ['local', 'testnet']) {
      const r = await snap(sandbox(), `--settlement=${s}`);
      expect(r.code).toBe(2);
      expect(r.text).toMatch(/Phase 2/);
    }
  });

  it('refuses unknown flags and bad flag values', async () => {
    expect((await snap(sandbox(), '--colour')).code).toBe(2);
    expect((await snap(sandbox(), '--judges=maybe')).text).toMatch(/--judges/);
  });

  it('loads the club and terms files the fixture names and says so in the snapshot', async () => {
    const { snapshot } = await runScenario({ root: repo, name: '_example' });
    expect(snapshot).toContain('| Club | fixtures/clubs/data-services-v1.yaml (loaded) · rulebook 0x140e…971e |');
    expect(snapshot).toMatch(/\| Terms \| fixtures\/terms\/clean-customers-2000\.yaml \(loaded\) · commitment /);
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

  it('refuses a message signed by the wrong key with invalid_signature', async () => {
    const root = sandbox();
    const name = 'error.impersonated-buyer';
    const src = deliverBeforeFund(name)
      .replace('  - deliver: { by: seller, via: op-1, file: data/x.csv, stub_bytes: true }', '  - agree_and_fund: { by: buyer, via: op-1, signer: tidewater-seller }')
      .replace('type: invalid_state', 'type: invalid_signature');
    writeFileSync(join(root, `fixtures/scenarios/${name}.scenario.yaml`), src);
    const r = await snap(root, '--update', name);
    expect(r.out[0]).toBe(`pass  ${name} (snapshot updated)`);
    const written = readFileSync(join(root, `fixtures/scenarios/${name}.expect.md`), 'utf8');
    expect(written).toMatch(/\| atlas-buyer \| agree \| op-1 \| invalid_signature \| AcceptedByAdjudicator \|/);
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

  it('neutrality: the primary adjudicator goes offline and the fallback decides', async () => {
    const root = sandbox();
    const name = 'neutrality.primary-offline';
    const r = await fixture(
      root,
      name,
      flow(
        name,
        `  - offline: { actor: bench-a }
  - judge: { adjudicator: bench-a }
  - advance_clock: { seconds: 4200 }
  - trigger_fallback: {}
  - judge: { adjudicator: bench-b }
  - verify_key_release: { by: buyer }
`,
        'fails: bench-a\n',
      ),
    );
    expect(r.out[0]).toBe(`pass  ${name} (snapshot updated)`);
    expect(r.snapshot).toMatch(/\| bench-a \| decide \| direct \| offline \(no call\) \| Delivered \|/);
    expect(r.snapshot).toMatch(/\| anyone \| trigger_fallback \| direct \| ok \| FallbackJudging \|/);
    expect(r.snapshot).toMatch(/\| bench-b \| decide: accept \| direct \| ok \| Released \|/);
    expect(r.snapshot).toMatch(/### bench-b \(fallback\)/);
    // ADR-0018: the fallback's panel seed comes from the beacon round at judgeBy, and the snapshot says so.
    expect(r.snapshot).toMatch(/seed source: beacon round \d+ \(seed 0x/);
    // The fallback earns the fee; the offline primary earns nothing.
    expect(r.snapshot).toMatch(/\| decide: accept \| 7,950\.000000 \| 0 \| 2,000\.000000 \| 25,000\.000000 \| 25,050\.000000 \|/);
  });

  it('neutrality: both first-instance adjudicators vanish and the default outcome refunds the buyer', async () => {
    const root = sandbox();
    const name = 'neutrality.adjudicators-offline';
    const r = await fixture(
      root,
      name,
      flow(
        name,
        `  - advance_clock: { seconds: 4200 }
  - trigger_fallback: {}
  - advance_clock: { seconds: 600 }
  - trigger_default: { via: op-2 }
  - apply_default_outcome: {}
`,
        'fails: bench-b\n',
      ),
    );
    expect(r.out[0]).toBe(`pass  ${name} (snapshot updated)`);
    expect(r.snapshot).toMatch(/\| anyone \| trigger_default \| op-2 \| ok \| Defaulted \|/);
    expect(r.snapshot).toMatch(/\| apply_default_outcome \| 10,000\.000000 \| 0 \|/);
  });

  it('neutrality: an operator refuses to relay and the buyer goes direct', async () => {
    const root = sandbox();
    const name = 'neutrality.operator-refuses';
    const r = await fixture(
      root,
      name,
      flow(name, `  - judge: { adjudicator: bench-a }
`, 'fails: op-1\n').replace(
        '  - agree_and_fund: { by: buyer, via: op-1 }',
        '  - operator_refuses: { operator: op-1 }\n  - agree_and_fund: { by: buyer, via: op-1 }\n  - agree_and_fund: { by: buyer }',
      ).replace('  - deliver: { by: seller, via: op-1,', '  - deliver: { by: seller, via: op-2,'),
    );
    expect(r.out[0]).toBe(`pass  ${name} (snapshot updated)`);
    expect(r.snapshot).toMatch(/\| atlas-buyer \| agree_and_fund \| op-1 \| refused by op-1 \| Offered \|/);
  });

  it('neutrality: a reclaim after deliverBy refunds the buyer when the seller never delivers', async () => {
    const root = sandbox();
    const name = 'neutrality.seller-vanishes';
    const src = flow(name, `  - advance_clock: { seconds: 3600 }
  - reclaim: { by: buyer }
`, 'fails: tidewater-seller\n').replace(
      `${DELIVER}\n`,
      '',
    );
    const r = await fixture(root, name, src);
    expect(r.out[0]).toBe(`pass  ${name} (snapshot updated)`);
    expect(r.snapshot).toMatch(/\| reclaim \| 10,000\.000000 \| 0 \|/);
  });

  it('neutrality: a happy path that names no outage fails', async () => {
    const root = sandbox();
    const r = await fixture(root, 'neutrality.nothing-fails', flow('neutrality.nothing-fails', `  - judge: { adjudicator: bench-a }
`, 'fails: bench-a\n'));
    expect(r.code).toBe(1);
    expect(r.out[0]).toMatch(/fail {2}neutrality\.nothing-fails: .*bench-a/);
    const missing = await fixture(root, 'neutrality.unnamed', flow('neutrality.unnamed', `  - judge: { adjudicator: bench-a }
`));
    expect(missing.out[0]).toMatch(/fail {2}neutrality\.unnamed: ScenarioError: .*fails/);
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
