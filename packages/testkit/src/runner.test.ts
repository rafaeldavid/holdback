import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  - deliver: { by: seller, via: op-1, file: data/x.csv }
expect: { problem: { step: 2, type: invalid_state } }
`;

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
    const rec = join(root, 'fixtures/recordings/_example/claude-a.json');
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
    const saved = JSON.parse(readFileSync(join(root, 'fixtures/recordings/_example/fam2-a.json'), 'utf8'));
    expect(saved).toMatchObject({ judgeId: 'fam2-a', capturedFrom: 'fake' });
    // Recorded mode replays the new recordings without a mismatch, then the snapshot matches.
    expect((await snap(root, '--update', '_example')).code).toBe(0);
    expect((await snap(root, '_example')).code).toBe(0);
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

  it('refuses to silently ignore a club or terms file that exists', async () => {
    const root = sandbox();
    mkdirSync(join(root, 'fixtures/clubs'), { recursive: true });
    writeFileSync(join(root, 'fixtures/clubs/data-services-v1.yaml'), 'id: data-services-v1\n');
    const r = await snap(root);
    expect(r.code).toBe(1);
    expect(r.out[0]).toMatch(/fail {2}_example: .*fixtures\/clubs\/data-services-v1\.yaml exists/);
  });

  it('refuses a message signed by the wrong key with invalid_signature', async () => {
    const root = sandbox();
    const name = 'error.impersonated-buyer';
    const src = deliverBeforeFund(name)
      .replace('  - deliver: { by: seller, via: op-1, file: data/x.csv }', '  - agree_and_fund: { by: buyer, via: op-1, signer: tidewater-seller }')
      .replace('type: invalid_state', 'type: invalid_signature');
    writeFileSync(join(root, `fixtures/scenarios/${name}.scenario.yaml`), src);
    const r = await snap(root, '--update', name);
    expect(r.out[0]).toBe(`pass  ${name} (snapshot updated)`);
    const written = readFileSync(join(root, `fixtures/scenarios/${name}.expect.md`), 'utf8');
    expect(written).toMatch(/\| atlas-buyer \| agree \| op-1 \| invalid_signature \| AcceptedByAdjudicator \|/);
  });

  it('never writes a snapshot when not asked to', async () => {
    const root = sandbox();
    writeFileSync(join(root, 'fixtures/scenarios/error.x.scenario.yaml'), deliverBeforeFund('error.x'));
    await snap(root);
    expect(existsSync(join(root, 'fixtures/scenarios/error.x.expect.md'))).toBe(false);
  });
});
