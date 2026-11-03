// T-052: the read-only cost collector. Synthetic fixtures only (tests/costs/fixtures), no network: every source
// reads through a fake fetch, and git runs only on temporary repositories.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { addDecimals, canonicalDecimal, dollarsToCents, parseJsonExact, shiftDecimal } from '../../scripts/costs/money.mjs';
import { approve } from '../../scripts/costs/approve.mjs';
import { ApprovalRefused, checkApproved } from '../../scripts/costs/approved.mjs';
import { DirRefused, checkDir } from '../../scripts/costs/dir.mjs';
import { collect, runSource } from '../../scripts/costs/collect.mjs';
import * as anthropic from '../../scripts/costs/sources/anthropic.mjs';
import * as claudeCode from '../../scripts/costs/sources/claude-code.mjs';
import * as cloudflareAnalytics from '../../scripts/costs/sources/cloudflare-analytics.mjs';
import * as cloudflareBilling from '../../scripts/costs/sources/cloudflare-billing.mjs';
import * as deepseek from '../../scripts/costs/sources/deepseek.mjs';
import * as github from '../../scripts/costs/sources/github.mjs';
import * as sepolia from '../../scripts/costs/sources/sepolia.mjs';
import * as telemetry from '../../scripts/costs/sources/telemetry.mjs';

const FIXTURES = join(dirname(new URL(import.meta.url).pathname), 'fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const json = (name: string) => JSON.parse(fixture(name));
const ACCOUNT = '0123456789abcdef0123456789abcdef';
const PERIOD = { from: '2026-11-01', to: '2026-11-03' };
const NOW = new Date('2026-11-03T12:00:00Z');

type Route = (url: string, init: RequestInit) => { status?: number; body: string } | undefined;
function fakeFetch(...routes: Route[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    for (const r of routes) {
      const hit = r(url, init);
      if (hit) return new Response(hit.body, { status: hit.status ?? 200 });
    }
    return new Response('{"message":"no route"}', { status: 404 });
  };
  return Object.assign(fn, { calls });
}

const baseCtx = (over: Record<string, unknown> = {}) => ({
  env: {},
  fetch: fakeFetch(),
  now: NOW,
  period: PERIOD,
  config: {},
  sleep: async () => undefined,
  ...over,
});

// Temporary git repositories. Commits avoid the user's signing and identity settings.
const temps: string[] = [];
afterAll(() => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});
function temp(prefix: string) {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  temps.push(d);
  return d;
}
function sh(cwd: string, ...args: string[]) {
  const r = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function cloneRepo() {
  const root = temp('crow-clone-');
  sh(root, 'init', '-q', '-b', 'main');
  mkdirSync(join(root, 'scripts', 'costs'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'costs', 'collect.mjs'), '// stand-in\n');
  writeFileSync(join(root, 'config.txt'), 'not covered\n');
  sh(root, 'add', '.');
  sh(root, 'commit', '-q', '-m', 'init');
  sh(root, 'remote', 'add', 'origin', 'https://github.com/example/holdback.git');
  return root;
}

describe('money', () => {
  it('keeps decimals exact and never passes through a float', () => {
    expect(canonicalDecimal('0.10')).toBe('0.1');
    expect(canonicalDecimal('1e-7')).toBe('0.0000001');
    expect(canonicalDecimal('-0')).toBe('0');
    expect(shiftDecimal('1.5', 3)).toBe('1500');
    expect(dollarsToCents('0.1')).toBe('10');
    expect(dollarsToCents('1e-7')).toBe('0.00001');
    expect(addDecimals('0.1', '0.2')).toBe('0.3');
    expect(addDecimals('123.78912', '0.21088')).toBe('124');
    expect(parseJsonExact('{"a":0.1,"b":1e-7,"c":12345678901234567890}')).toEqual({ a: '0.1', b: '1e-7', c: '12345678901234567890' });
  });
});

describe('sources, on synthetic fixtures', () => {
  const cfEnv = { CROW_COSTS_CLOUDFLARE_TOKEN: 'cf-token', CLOUDFLARE_ACCOUNT_ID: ACCOUNT };

  it('cloudflare-billing sums charges per product exactly, fractional quantities included', async () => {
    const fetch = fakeFetch((u) => (u.endsWith(`/accounts/${ACCOUNT}/billable-usage`) ? { body: fixture('cloudflare-billing.json') } : undefined));
    const r = await runSource(cloudflareBilling, baseCtx({ env: cfEnv, fetch }));
    expect(r.status).toEqual({ source: 'cloudflare-billing', ok: true });
    expect(r.lines).toEqual([
      { source: 'cloudflare-billing', product: 'Workers Standard', unit: 'Requests', quantity: '3000', amount: { cents: '30', currency: 'USD' }, basis: 'billed', periodFrom: '2026-11-01', periodTo: '2026-11-02' },
      { source: 'cloudflare-billing', product: 'Durable Objects Storage', unit: 'GB-months', quantity: '1.5', amount: { cents: '0.00001', currency: 'USD' }, basis: 'billed', periodFrom: '2026-11-01', periodTo: '2026-11-01' },
    ]);
  });

  it('cloudflare-analytics reads Workers and Durable Objects usage with no amount', async () => {
    const fetch = fakeFetch((u, init) => (u.endsWith('/graphql') && init.method === 'POST' ? { body: fixture('cloudflare-graphql.json') } : undefined));
    const r = await runSource(cloudflareAnalytics, baseCtx({ env: cfEnv, fetch }));
    expect(r.status.ok).toBe(true);
    const find = (product: string, unit: string) => r.lines.find((l: { product: string; unit: string }) => l.product === product && l.unit === unit);
    expect(find('Worker example-op1', 'requests').quantity).toBe('1200');
    expect(find('Worker example-op1', 'cpu-time-p99-microseconds').quantity).toBe('1834.5');
    expect(find('Durable Objects', 'requests').quantity).toBe('1000');
    expect(find('Durable Objects', 'stored-bytes-max').quantity).toBe('8192');
    expect(r.lines.every((l: { amount: unknown; basis: string }) => l.amount === null && l.basis === 'estimated')).toBe(true);
  });

  it('anthropic follows pages and sums cents strings exactly', async () => {
    const a = json('anthropic.json');
    const fetch = fakeFetch((u) => {
      if (u.includes('/cost_report') && u.includes('page=page_two')) return { body: JSON.stringify(a.costPage2) };
      if (u.includes('/cost_report')) return { body: JSON.stringify(a.costPage1) };
      if (u.includes('/usage_report/messages')) return { body: JSON.stringify(a.usage) };
      return undefined;
    });
    const r = await runSource(anthropic, baseCtx({ env: { CROW_COSTS_ANTHROPIC_ADMIN_KEY: 'admin-key' }, fetch }));
    expect(r.status.ok).toBe(true);
    const input = r.lines.find((l: { product: string }) => l.product === 'Example Model Usage - Input Tokens [wrkspc_example]');
    expect(input.amount).toEqual({ cents: '124', currency: 'USD' });
    expect(r.lines.find((l: { product: string }) => l.product.endsWith('[Default workspace]')).amount.cents).toBe('10');
    const tokens = (unit: string) => r.lines.find((l: { product: string; unit: string }) => l.product === 'example-model [wrkspc_example]' && l.unit === unit)?.quantity;
    expect(tokens('input_tokens')).toBe('2000');
    expect(tokens('output_tokens')).toBe('600');
    expect(tokens('cache_write_5m_input_tokens')).toBe('30');
    expect(fetch.calls[0].init.headers).toMatchObject({ 'anthropic-version': '2023-06-01' });
  });

  it('github reads the login, then the month, and sums net amounts exactly', async () => {
    const g = json('github-deepseek.json');
    const fetch = fakeFetch(
      (u) => (u === 'https://api.github.com/user' ? { body: JSON.stringify(g.githubUser) } : undefined),
      (u) => (u.startsWith('https://api.github.com/users/example-user/settings/billing/usage?year=2026&month=11') ? { body: JSON.stringify(g.githubUsage) } : undefined),
    );
    const r = await runSource(github, baseCtx({ env: { CROW_COSTS_GITHUB_TOKEN: 'gh-token' }, fetch }));
    expect(r.lines).toEqual([
      { source: 'github', product: 'actions: Actions Linux', unit: 'minutes', quantity: '30', amount: { cents: '30', currency: 'USD' }, basis: 'billed', periodFrom: '2026-11-01', periodTo: '2026-11-03' },
    ]);
  });

  it('deepseek keeps the balance in its own currency', async () => {
    const g = json('github-deepseek.json');
    const fetch = fakeFetch((u) => (u === 'https://api.deepseek.com/user/balance' ? { body: JSON.stringify(g.deepseekBalance) } : undefined));
    const r = await runSource(deepseek, baseCtx({ env: { CROW_COSTS_DEEPSEEK_KEY: 'ds-key' }, fetch }));
    expect(r.lines[0]).toMatchObject({ product: 'Balance', amount: { cents: '11000', currency: 'CNY' }, basis: 'balance' });
  });

  it('sepolia needs no credential, reads discovery and configured addresses, and reads a low deal lane twice', async () => {
    const balances: Record<string, string[]> = {
      '0x1111111111111111111111111111111111111111': ['0xde0b6b3a7640000'],
      '0x2222222222222222222222222222222222222222': ['0x2386f26fc10000'],
      '0x3333333333333333333333333333333333333333': ['0x0'],
      '0x4444444444444444444444444444444444444444': ['0x5af3107a4000', '0x6a94d74f430000'],
    };
    const fetch = fakeFetch(
      (u) => (u === 'https://api.escrow.stream/' ? { body: fixture('discovery.json') } : undefined),
      (u, init) => {
        if (u !== 'https://ethereum-sepolia-rpc.publicnode.com') return undefined;
        const req = JSON.parse(String(init.body));
        if (req.method === 'eth_chainId') return { body: '{"jsonrpc":"2.0","id":1,"result":"0xaa36a7"}' };
        const result = balances[req.params[0]].shift();
        return { body: JSON.stringify({ jsonrpc: '2.0', id: 1, result }) };
      },
    );
    const sleep = vi.fn(async () => undefined);
    const config = { sepolia: { addresses: [{ label: 'deal lane 1', address: '0x4444444444444444444444444444444444444444', kind: 'deal-lane' }, { label: 'deployer', address: '', kind: 'deployer' }] } };
    const r = await runSource(sepolia, baseCtx({ fetch, sleep, config }));
    expect(r.status).toEqual({ source: 'sepolia', ok: true });
    expect(sleep).toHaveBeenCalledWith(120000);
    expect(r.lines.map((l: { product: string; quantity: string }) => [l.product, l.quantity])).toEqual([
      ['Sepolia funding lane 0x1111111111111111111111111111111111111111', '1000000000000000000'],
      ['Sepolia adjudicator (primary) 0x2222222222222222222222222222222222222222', '10000000000000000'],
      ['Sepolia adjudicator (fallback) 0x3333333333333333333333333333333333333333', '0'],
      ['Sepolia deal lane 1 0x4444444444444444444444444444444444444444', '100000000000000'],
      ['Sepolia deal lane 1 0x4444444444444444444444444444444444444444 (second read)', '30000000000000000'],
    ]);
    expect(r.lines.every((l: { unit: string; basis: string }) => l.unit === 'wei' && l.basis === 'balance')).toBe(true);
  });

  it('a source without its credentials is "not configured", and a failing source leaves the others intact', async () => {
    const g = json('github-deepseek.json');
    const fetch = fakeFetch(
      (u) => (u.includes('deepseek') ? { status: 500, body: 'oops' } : undefined),
      (u) => (u === 'https://api.github.com/user' ? { body: JSON.stringify(g.githubUser) } : undefined),
      (u) => (u.includes('/settings/billing/usage') ? { body: JSON.stringify(g.githubUsage) } : undefined),
    );
    const ctx = baseCtx({ env: { CROW_COSTS_DEEPSEEK_KEY: 'ds', CROW_COSTS_GITHUB_TOKEN: 'gh' }, fetch });
    const results = await Promise.all([deepseek, github, anthropic].map((s) => runSource(s, ctx)));
    expect(results.map((r) => r.status)).toEqual([
      { source: 'deepseek', ok: false, error: { type: 'http', status: 500 } },
      { source: 'github', ok: true },
      { source: 'anthropic', ok: false, error: { type: 'not_configured', status: null } },
    ]);
    expect(results[1].lines).toHaveLength(1);
  });
});

describe('claude-code transcripts', () => {
  it('counts each response once, keeps subagents, drops other repositories, and never reads content', async () => {
    const clone = cloneRepo();
    const projects = temp('crow-projects-');
    const here = '/work/holdback';
    const entry = (o: Record<string, unknown>) =>
      JSON.stringify({ type: 'assistant', sessionId: 's1', gitBranch: 't-052-x', cwd: here, timestamp: '2026-11-02T10:00:00Z', ...o });
    const usage = (input: number, output: number) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: 7, cache_creation: { ephemeral_5m_input_tokens: 3, ephemeral_1h_input_tokens: 0 } });
    const main = [
      entry({ requestId: 'r1', message: { model: 'example-opus', usage: usage(100, 10), content: [{ type: 'text', text: 'sk-ant-api03-SECRET-LOOKING-VALUE' }] } }),
      entry({ requestId: 'r1', message: { model: 'example-opus', usage: usage(100, 10), content: [{ type: 'tool_use', name: 'Bash' }] } }),
      entry({ requestId: 'r2', cwd: '/work/other-repo', message: { model: 'example-opus', usage: usage(5000, 500) } }),
      entry({ requestId: 'r3', message: { model: '<synthetic>', usage: usage(9, 9) } }),
      entry({ requestId: 'r4', timestamp: '2026-10-31T23:00:00Z', message: { model: 'example-opus', usage: usage(9, 9) } }),
      'not json at all "usage"',
    ].join('\n');
    const sub = entry({ requestId: 'r5', cwd: `${here}/.claude/worktrees/t-052-x`, message: { model: 'example-sonnet', usage: usage(40, 4) } });
    mkdirSync(join(projects, '-work-holdback', 's1', 'subagents'), { recursive: true });
    writeFileSync(join(projects, '-work-holdback', 's1.jsonl'), main);
    writeFileSync(join(projects, '-work-holdback', 's1', 'subagents', 'agent-a.jsonl'), sub);
    const inPeriod = new Date('2026-11-02T12:00:00Z');
    utimesSync(join(projects, '-work-holdback', 's1.jsonl'), inPeriod, inPeriod);
    utimesSync(join(projects, '-work-holdback', 's1', 'subagents', 'agent-a.jsonl'), inPeriod, inPeriod);

    const membership = (cwd: string) => cwd === here || cwd.startsWith(`${here}/.claude/worktrees/`);
    const r = await runSource(claudeCode, baseCtx({ cloneRoot: clone, claudeProjectsDir: projects, membership }));
    expect(r.status).toEqual({ source: 'claude-code', ok: true, note: claudeCode.note });
    const q = (model: string, unit: string) => r.lines.find((l: { product: string; unit: string }) => l.product === `Claude Code ${model}` && l.unit === unit)?.quantity;
    expect(q('example-opus', 'input_tokens')).toBe('100');
    expect(q('example-opus', 'output_tokens')).toBe('10');
    expect(q('example-opus', 'cache_write_5m_input_tokens')).toBe('3');
    expect(q('example-sonnet', 'input_tokens')).toBe('40');
    expect(r.lines.some((l: { product: string }) => l.product.includes('synthetic'))).toBe(false);
    const detail = r.files[0].data.rows;
    expect(detail.map((d: { branch: string; model: string }) => [d.branch, d.model])).toEqual([
      ['t-052-x', 'example-opus'],
      ['t-052-x', 'example-sonnet'],
    ]);
    expect(JSON.stringify(r)).not.toContain('SECRET-LOOKING');
    expect(JSON.stringify(r)).not.toContain('other-repo');
  });

  it('matches a checkout by its origin, and a deleted worktree by its parent', () => {
    const base = temp('crow-member-');
    const mine = join(base, 'holdback');
    const theirs = join(base, 'elsewhere');
    mkdirSync(mine);
    mkdirSync(theirs);
    const member = claudeCode.makeMembership('github.com/example/holdback', (dir: string) => (dir === mine ? 'github.com/example/holdback' : 'github.com/someone/else'));
    expect(claudeCode.repoKey('git@github.com:Example/Holdback.git')).toBe('github.com/example/holdback');
    expect(claudeCode.repoKey('https://github.com/example/holdback')).toBe('github.com/example/holdback');
    expect(member(mine)).toBe(true);
    expect(member(theirs)).toBe(false);
    expect(member(`${mine}/.claude/worktrees/deleted-long-ago`)).toBe(true);
    expect(member(`${theirs}/.claude/worktrees/deleted-long-ago`)).toBe(false);
    expect(member('/no/such/dir')).toBe(false);
  });
});

describe('telemetry export', () => {
  it('finds day lines in any JSON shape, writes one file a day, and reports usage with no amount', async () => {
    const dir = temp('crow-telemetry-');
    mkdirSync(join(dir, 'inbox'));
    const day = { telemetry: 'day', day: '2026-11-02', usage: { requests: { used: 900, limit: 100000, percent: 0 }, rowsRead: { used: 5, limit: 1, percent: 0 }, rowsWritten: { used: 7, limit: 1, percent: 0 } }, liveJudges: { day: '2026-11-02', calls: 3, inputTokens: 2968, outputTokens: 540 } };
    const tail = JSON.stringify({ logs: [{ message: [JSON.stringify(day)], level: 'log' }] });
    writeFileSync(join(dir, 'inbox', 'tail.jsonl'), `${tail}\n{"telemetry":"hour","hour":"2026-11-02T10"}\n`);
    writeFileSync(join(dir, 'inbox', 'export.json'), JSON.stringify([{ $metadata: { message: 'x' }, source: { ...day, day: '2026-11-01' } }]));
    const r = await runSource(telemetry, baseCtx({ telemetryDir: dir }));
    expect(r.files.map((f: { name: string }) => f.name)).toEqual(['day-2026-11-01.json', 'day-2026-11-02.json']);
    const q = (product: string, unit: string) => r.lines.find((l: { product: string; unit: string }) => l.product === product && l.unit === unit)?.quantity;
    expect(q('World Durable Object', 'requests')).toBe('900');
    expect(q('Live judges', 'input_tokens')).toBe('2968');
    expect(r.lines.every((l: { periodFrom: string }) => l.periodFrom === '2026-11-02')).toBe(true);
  });
});

describe('the collector end to end', () => {
  const dirsFor = () => ({ CROW_COSTS_DIR: join(temp('crow-costs-'), 'costs'), CROW_TELEMETRY_DIR: join(temp('crow-tel-'), 'telemetry') });

  it('refuses before any request without an approval, with a tracked approval, and after a change', async () => {
    const root = cloneRepo();
    const fetch = fakeFetch();
    const run = () => collect({ cloneRoot: root, env: { ...dirsFor(), CROW_COSTS_DEEPSEEK_KEY: 'k' }, fetchImpl: fetch, now: NOW, sources: [deepseek], log: () => undefined });
    await expect(run()).rejects.toThrow(/no \.costs-approved/);
    approve(root);
    writeFileSync(join(root, 'scripts', 'costs', 'collect.mjs'), '// changed after approval\n');
    await expect(run()).rejects.toThrow(/changed since the approved commit.*: scripts\/costs\/collect\.mjs$/);
    sh(root, 'checkout', '--', 'scripts/costs/collect.mjs');
    writeFileSync(join(root, 'scripts', 'costs', 'extra.mjs'), '// untracked\n');
    await expect(run()).rejects.toThrow(/scripts\/costs\/extra\.mjs/);
    rmSync(join(root, 'scripts', 'costs', 'extra.mjs'));
    sh(root, 'add', '-f', '.costs-approved');
    await expect(run()).rejects.toThrow(/tracked by git/);
    expect(fetch.calls).toHaveLength(0);
    expect(() => checkApproved(root)).toThrow(ApprovalRefused);
  });

  it('writes latest.json and prints only statuses, with no credential value or response body anywhere', async () => {
    const root = cloneRepo();
    approve(root);
    const env = { ...dirsFor(), CROW_COSTS_DEEPSEEK_KEY: 'sk-FAKE-SECRET-VALUE-123', CROW_COSTS_GITHUB_TOKEN: 'ghp-FAKE-SECRET-VALUE-456' };
    const fetch = fakeFetch((u, init) => ({ status: 401, body: `{"error":"bad key ${JSON.stringify(init.headers)} at ${u} RESPONSE-BODY-TEXT"}` }));
    const printed: string[] = [];
    const log = vi.spyOn(console, 'log');
    const err = vi.spyOn(console, 'error');
    const doc = await collect({ cloneRoot: root, env, fetchImpl: fetch, now: NOW, sources: [deepseek, github, cloudflareBilling], log: (l: string) => printed.push(l) });
    expect(doc.sources).toEqual([
      { source: 'deepseek', ok: false, error: { type: 'http', status: 401 } },
      { source: 'github', ok: false, error: { type: 'http', status: 401 } },
      { source: 'cloudflare-billing', ok: false, error: { type: 'not_configured', status: null } },
    ]);
    expect(printed.slice(0, 3)).toEqual(['deepseek: failed (http 401)', 'github: failed (http 401)', 'cloudflare-billing: not configured']);
    const latest = readFileSync(join(env.CROW_COSTS_DIR, 'latest.json'), 'utf8');
    expect(JSON.parse(latest)).toEqual(doc);
    expect(readdirSync(env.CROW_COSTS_DIR).sort()).toEqual(['2026-11-03.json', 'latest.json']);
    for (const text of [latest, printed.join('\n')]) {
      expect(text).not.toContain('FAKE-SECRET');
      expect(text).not.toContain('RESPONSE-BODY-TEXT');
    }
    expect(log).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    log.mockRestore();
    err.mockRestore();
  });

  it('refuses a missing, relative, in-clone, unignored or linked-worktree directory', () => {
    const root = cloneRepo();
    const other = cloneRepo();
    writeFileSync(join(other, '.gitignore'), 'ignored/\n');
    sh(other, 'add', '.gitignore');
    sh(other, 'commit', '-q', '-m', 'ignore');
    const linked = join(temp('crow-linked-'), 'wt');
    sh(other, 'worktree', 'add', '-q', '-b', 'side', linked);
    const refuse = (value: string | undefined, why: RegExp) => expect(() => checkDir('CROW_COSTS_DIR', value, root)).toThrow(why);
    refuse(undefined, /not set/);
    refuse('reports/costs', /full path/);
    refuse(join(root, 'reports', 'costs'), /inside the clone/);
    refuse(join(other, 'costs'), /not git-ignored/);
    refuse(join(linked, 'ignored', 'costs'), /linked worktree/);
    expect(checkDir('CROW_COSTS_DIR', join(other, 'ignored', 'costs'), root)).toBe(join(other, 'ignored', 'costs'));
    expect(() => checkDir('X', undefined, root)).toThrow(DirRefused);
  });
});

describe('what the collector may run and write', () => {
  const COSTS = resolve('scripts/costs');

  it('imports only node: modules and its own files', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name));
        else if (e.name.endsWith('.mjs')) files.push(join(d, e.name));
      }
    };
    walk(COSTS);
    expect(files.length).toBeGreaterThanOrEqual(12);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      const specs = [...text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? m[2] ?? m[3]);
      expect(text).not.toMatch(/\brequire\s*\(/);
      for (const s of specs) {
        if (s.startsWith('node:')) continue;
        expect(s.startsWith('./') || s.startsWith('../'), `${relative(COSTS, f)} imports ${s}`).toBe(true);
        expect(relative(COSTS, resolve(dirname(f), s)).startsWith('..'), `${relative(COSTS, f)} imports ${s}`).toBe(false);
      }
    }
  });

  it('keeps the approval record out of git', () => {
    expect(spawnSync('git', ['check-ignore', '-q', '.costs-approved']).status).toBe(0);
  });
});
