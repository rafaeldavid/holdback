// T-052: the read-only cost collector. Synthetic fixtures only (tests/costs/fixtures), no network: every source
// reads through a fake fetch, and git runs only on temporary repositories, with a stripped environment.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { addDecimals, canonicalDecimal, dollarsToCents, parseJsonExact, shiftDecimal } from '../../scripts/costs/money.mjs';
import { approve } from '../../scripts/costs/approve.mjs';
import { ApprovalRefused, checkApproved } from '../../scripts/costs/approved.mjs';
import { DirRefused, checkDir } from '../../scripts/costs/dir.mjs';
import { collect, runSource } from '../../scripts/costs/run.mjs';
import * as anthropic from '../../scripts/costs/sources/anthropic.mjs';
import * as claudeCode from '../../scripts/costs/sources/claude-code.mjs';
import * as cloudflareAnalytics from '../../scripts/costs/sources/cloudflare-analytics.mjs';
import * as cloudflareBilling from '../../scripts/costs/sources/cloudflare-billing.mjs';
import * as deepseek from '../../scripts/costs/sources/deepseek.mjs';
import * as github from '../../scripts/costs/sources/github.mjs';
import * as sepolia from '../../scripts/costs/sources/sepolia.mjs';
import * as telemetry from '../../scripts/costs/sources/telemetry.mjs';

const FIXTURES = join(dirname(new URL(import.meta.url).pathname), 'fixtures');
const COSTS = resolve('scripts/costs');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const json = (name: string) => JSON.parse(fixture(name));
const ACCOUNT = '0123456789abcdef0123456789abcdef';
const PERIOD = { from: '2026-11-01', to: '2026-11-03' };
const NOW = new Date('2026-11-03T12:00:00Z');
const BARE_ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' };

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

// Temporary git repositories. git runs with a bare environment and no signing or identity settings of the user's.
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
  const r = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', env: BARE_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function cloneRepo(files: Record<string, string> = { 'scripts/costs/collect.mjs': '// stand-in\n' }) {
  const root = temp('crow-clone-');
  sh(root, 'init', '-q', '-b', 'main');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  writeFileSync(join(root, 'config.txt'), 'not covered\n');
  sh(root, 'add', '.');
  sh(root, 'commit', '-q', '-m', 'init');
  sh(root, 'remote', 'add', 'origin', 'https://github.com/example/holdback.git');
  return root;
}
const listTree = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && !join(e.parentPath, e.name).includes(`${dir}/.git/`))
        .map((e) => relative(dir, join(e.parentPath, e.name)))
        .sort()
    : [];

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

  it('refuses a number, a malformed string and an exponent that would make the work slow', () => {
    for (const bad of [0.1, '.5', '5.', '+5', ' 5', '1e-300000', '1e999999999', '1e101', '9'.repeat(101)]) {
      expect(() => canonicalDecimal(bad as string)).toThrow(TypeError);
    }
    expect(() => addDecimals(0.1 as unknown as string, '0.2')).toThrow(TypeError);
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

  it('cloudflare-analytics names a GraphQL error by a fixed word and its dataset, never by its message', async () => {
    const errors = json('cloudflare-graphql-errors.json');
    const expected: Record<string, string> = { permission: 'permission', query: 'query:storage', timeRange: 'time-range:durableObjects', budget: 'rate-limit', unknown: 'other:workers' };
    for (const [name, code] of Object.entries(expected)) {
      const fetch = fakeFetch((u) => (u.endsWith('/graphql') ? { body: JSON.stringify(errors[name]) } : undefined));
      const r = await runSource(cloudflareAnalytics, baseCtx({ env: cfEnv, fetch }));
      expect(r.status).toEqual({ source: 'cloudflare-analytics', ok: false, error: { type: 'graphql', status: null, code } });
      expect(JSON.stringify(r.status)).not.toMatch(/RESPONSE-BODY-TEXT|authorized|storedBytes|2678400|0123456789abcdef/);
    }
    // Cloudflare documents the same bodies on 4xx and 5xx answers too.
    const fetch = fakeFetch(() => ({ status: 403, body: JSON.stringify(errors.permission) }));
    const r = await runSource(cloudflareAnalytics, baseCtx({ env: cfEnv, fetch }));
    expect(r.status.error).toEqual({ type: 'http', status: 403, code: 'permission' });

    const kinds = Object.entries({
      'Unauthorized': 'permission',
      'zones [x] are not authorized': 'permission',
      'does not have access to the path viewer.accounts': 'permission',
      'Authentication error': 'permission',
      'Invalid access token': 'permission',
      'error parsing args for "x"': 'query',
      'scalar fields must have no selections': 'query',
      'object field must have selections': 'query',
      'query contains error, please review it and retry': 'query',
      'Cannot query field "x" on type "Y"': 'query',
      'Variable "$x" of type "string" used in position expecting type "Date"': 'query',
      'query time range is too large': 'time-range',
      "number of fields can't be more than 30": 'limits',
      'limit must be positive number and not greater than 10000': 'limits',
      'rate limiter budget depleted, try again after 5 minutes': 'rate-limit',
      'in combination, your request queries too many nodes, zones and accounts': 'rate-limit',
      'query consumed excessive resources, please try running smaller queries': 'rate-limit',
      'unable to execute query, please try again later': 'unavailable',
      'too many queries in progress, please try again later': 'unavailable',
      'Internal server error': 'unavailable',
    });
    for (const [message, kind] of kinds) expect(cloudflareAnalytics.graphqlCode([{ message }])).toBe(kind);
    const allowed = /^(permission|query|time-range|limits|rate-limit|unavailable|other)(:(workers|durableObjects|storage))?$/;
    const odd = [[null], ['text'], [7], [{ message: 7, path: 'storage' }], [{ path: [{ storage: 1 }], extensions: { code: 'rafael_at_example_com' } }], [{ ['__proto__']: { message: 'x' } }], [{ message: 'x'.repeat(1_000_000) }]];
    for (const errs of odd) expect(cloudflareAnalytics.graphqlCode(errs)).toMatch(allowed);
    expect(cloudflareAnalytics.graphqlCode(null)).toBeNull();
    expect(cloudflareAnalytics.graphqlCode([])).toBeNull();
  });

  it('an HTTP error keeps only the body error type, and only when it is a listed one', async () => {
    const env = { CROW_COSTS_ANTHROPIC_ADMIN_KEY: 'sk-ant-admin01-FAKE-SECRET' };
    const failWith = async (body: string) => runSource(anthropic, baseCtx({ env, fetch: fakeFetch(() => ({ status: 403, body })) }));
    const typed = await failWith('{"type":"error","error":{"type":"permission_error","message":"RESPONSE-BODY-TEXT sk-ant-admin01-FAKE-SECRET"},"request_id":"req_x"}');
    expect(typed.status).toEqual({ source: 'anthropic', ok: false, error: { type: 'http', status: 403, code: 'permission_error' } });
    for (const body of ['{"error":{"type":"sk-ant-admin01-FAKE-SECRET"}}', '{"error":{"type":"rafael_at_example_com"}}', '{"error":{"type":"constructor"}}', '{"error":"RESPONSE-BODY-TEXT"}', 'RESPONSE-BODY-TEXT']) {
      const r = await failWith(body);
      expect(r.status).toEqual({ source: 'anthropic', ok: false, error: { type: 'http', status: 403 } });
    }
    expect(JSON.stringify(typed.status)).not.toMatch(/RESPONSE-BODY-TEXT|FAKE-SECRET|req_x/);
  });

  it('anthropic follows pages, sums cents strings exactly, and groups tokens by key', async () => {
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
    const tokens = (unit: string) => r.lines.find((l: { product: string; unit: string }) => l.product === 'example-model [wrkspc_example] [key apikey_example]' && l.unit === unit)?.quantity;
    expect(tokens('input_tokens')).toBe('2000');
    expect(tokens('output_tokens')).toBe('600');
    expect(tokens('cache_write_5m_input_tokens')).toBe('30');
    expect(fetch.calls[0].init.headers).toMatchObject({ 'anthropic-version': '2023-06-01' });
    expect(fetch.calls.find((c) => c.url.includes('usage_report'))?.url).toContain('group_by%5B%5D=api_key_id');
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

  const sepoliaFetch = (balances: Record<string, string[]>, discovery = fixture('discovery.json')) =>
    fakeFetch(
      (u) => (u === 'https://api.crow.direct/' ? { body: discovery } : undefined),
      (u, init) => {
        if (u !== 'https://ethereum-sepolia-rpc.publicnode.com') return undefined;
        const req = JSON.parse(String(init.body));
        if (req.method === 'eth_chainId') return { body: '{"jsonrpc":"2.0","id":1,"result":"0xaa36a7"}' };
        return { body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: balances[req.params[0]].shift() }) };
      },
    );

  it('sepolia needs no credential, reads discovery and configured addresses, and reads a low deal lane twice', async () => {
    const fetch = sepoliaFetch({
      '0x1111111111111111111111111111111111111111': ['0xde0b6b3a7640000'],
      '0x2222222222222222222222222222222222222222': ['0x2386f26fc10000'],
      '0x3333333333333333333333333333333333333333': ['0x0'],
      '0x4444444444444444444444444444444444444444': ['0x5af3107a4000', '0x6a94d74f430000'],
    });
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

  it('sepolia says so when discovery stops naming the funding lane', async () => {
    const reworded = fixture('discovery.json').replace('funded from', 'paid by');
    const fetch = sepoliaFetch({ '0x2222222222222222222222222222222222222222': ['0x1'], '0x3333333333333333333333333333333333333333': ['0x1'] }, reworded);
    const r = await runSource(sepolia, baseCtx({ fetch }));
    expect(r.status.ok).toBe(true);
    expect(r.status.note).toMatch(/no funding lane found/);
  });

  it("the budgets template names the same discovery document as the sepolia source's default (T-313)", () => {
    const template = JSON.parse(readFileSync(resolve('config/costs.template.json'), 'utf8'));
    expect(template.sepolia.discoveryUrl).toBe('https://api.crow.direct/');
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
  const here = '/work/holdback';
  const entry = (o: Record<string, unknown>) => JSON.stringify({ type: 'assistant', sessionId: 's1', gitBranch: 't-052-x', cwd: here, timestamp: '2026-11-02T10:00:00Z', ...o });
  const usage = (input: number, output: number) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: 7, cache_creation: { ephemeral_5m_input_tokens: 3, ephemeral_1h_input_tokens: 0 } });
  const inPeriod = new Date('2026-11-02T12:00:00Z');
  function project(files: Record<string, string>) {
    const projects = temp('crow-projects-');
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(projects, path)), { recursive: true });
      writeFileSync(join(projects, path), text);
      utimesSync(join(projects, path), inPeriod, inPeriod);
    }
    return projects;
  }
  const membership = (cwd: string) => cwd === here || cwd.startsWith(`${here}/.claude/worktrees/`);

  it('counts each response once at its highest values, keeps subagents, follows the file, and never reads content', async () => {
    const clone = cloneRepo();
    const projects = project({
      '-work-holdback/s1.jsonl': [
        JSON.stringify({ type: 'user', cwd: here, message: { content: 'start' } }),
        entry({ requestId: 'r1', message: { model: 'example-opus', usage: usage(100, 4), content: [{ type: 'text', text: 'sk-ant-api03-SECRET-LOOKING-VALUE' }] } }),
        entry({ requestId: 'r1', message: { model: 'example-opus', usage: usage(100, 10), content: [{ type: 'tool_use', name: 'Bash' }] } }),
        entry({ requestId: 'r2', cwd: `${here}/contracts/lib/a-submodule`, message: { model: 'example-opus', usage: usage(5, 1) } }),
        entry({ requestId: 'r3', message: { model: '<synthetic>', usage: usage(9, 9) } }),
        entry({ requestId: 'r4', timestamp: '2026-10-31T23:00:00Z', message: { model: 'example-opus', usage: usage(9, 9) } }),
        'not json at all "usage"',
      ].join('\n'),
      '-work-holdback/s1/subagents/agent-a.jsonl': entry({ requestId: 'r5', cwd: `${here}/.claude/worktrees/t-052-x`, message: { model: 'example-sonnet', usage: usage(40, 4) } }),
      '-work-other/s2.jsonl': entry({ requestId: 'r6', cwd: '/work/other-repo', message: { model: 'example-opus', usage: usage(5000, 500) } }),
      // A session that starts elsewhere and moves into the repository: only its entries here count.
      '-work-elsewhere/s3.jsonl': [
        JSON.stringify({ type: 'user', cwd: '/work/elsewhere', message: { content: 'start' } }),
        entry({ requestId: 'r7', cwd: '/work/elsewhere', message: { model: 'example-sonnet', usage: usage(7000, 700) } }),
        entry({ requestId: 'r8', message: { model: 'example-sonnet', usage: usage(60, 6) } }),
      ].join('\n'),
    });
    const r = await runSource(claudeCode, baseCtx({ cloneRoot: clone, claudeProjectsDir: projects, membership }));
    expect(r.status).toEqual({ source: 'claude-code', ok: true, note: claudeCode.note });
    const q = (model: string, unit: string) => r.lines.find((l: { product: string; unit: string }) => l.product === `Claude Code ${model}` && l.unit === unit)?.quantity;
    expect(q('example-opus', 'input_tokens')).toBe('105');
    expect(q('example-opus', 'output_tokens')).toBe('11');
    expect(q('example-opus', 'cache_write_5m_input_tokens')).toBe('6');
    expect(q('example-sonnet', 'input_tokens')).toBe('100');
    expect(r.lines.some((l: { product: string }) => l.product.includes('synthetic'))).toBe(false);
    expect(r.files[0].data.rows.map((d: { branch: string; model: string }) => [d.branch, d.model])).toEqual([
      ['t-052-x', 'example-opus'],
      ['t-052-x', 'example-sonnet'],
    ]);
    expect(JSON.stringify(r)).not.toContain('SECRET-LOOKING');
    expect(JSON.stringify(r)).not.toContain('other-repo');
    expect(JSON.stringify(r)).not.toContain('7000');
  });

  it('counts an unreadable transcript in the note instead of skipping it silently', async () => {
    const clone = cloneRepo();
    const projects = project({ '-work-holdback/ok.jsonl': entry({ requestId: 'a', message: { model: 'm', usage: usage(1, 1) } }), '-work-holdback/locked.jsonl': entry({ requestId: 'b', message: { model: 'm', usage: usage(1, 1) } }) });
    chmodSync(join(projects, '-work-holdback/locked.jsonl'), 0o000);
    try {
      const r = await runSource(claudeCode, baseCtx({ cloneRoot: clone, claudeProjectsDir: projects, membership }));
      expect(r.status.ok).toBe(true);
      if (process.getuid?.() !== 0) expect(r.status.note).toMatch(/1 transcript file\(s\) could not be read/);
    } finally {
      chmodSync(join(projects, '-work-holdback/locked.jsonl'), 0o600);
    }
  });

  it('matches a checkout by its origin, and a removed folder by its nearest existing parent', () => {
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
    expect(member(`${mine}/.worktrees/deleted-long-ago`)).toBe(true);
    expect(member(`${theirs}/.claude/worktrees/deleted-long-ago`)).toBe(false);
    expect(member('relative/path')).toBe(false);
  });
});

describe('telemetry export', () => {
  const day = { telemetry: 'day', day: '2026-11-02', requests: 1200, usage: { requests: { used: 900, limit: 100000, percent: 0 }, rowsRead: { used: 5, limit: 1, percent: 0 }, rowsWritten: { used: 7, limit: 1, percent: 0 } }, liveJudges: { day: '2026-11-02', calls: 3, inputTokens: 2968, outputTokens: 540 } };

  it('finds day lines in any JSON shape, writes one file a day, and reports usage with no amount', async () => {
    const dir = temp('crow-telemetry-');
    mkdirSync(join(dir, 'inbox'));
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

  it('copies only the day line\'s own fields, refuses a day that is not a string, and keeps paths out of the note', async () => {
    const dir = temp('crow-telemetry-');
    mkdirSync(join(dir, 'inbox'));
    const wrapped = { ...day, $workers: { request: { headers: { authorization: 'Bearer FAKE-READ-TOKEN', 'cf-connecting-ip': '192.0.2.1' } } } };
    writeFileSync(join(dir, 'inbox', 'a.json'), JSON.stringify([wrapped, { telemetry: 'day', day: ['2026-11-05'] }]));
    const r = await runSource(telemetry, baseCtx({ telemetryDir: dir }));
    expect(r.files).toHaveLength(1);
    expect(Object.keys(r.files[0].data).sort()).toEqual(['day', 'liveJudges', 'requests', 'telemetry', 'usage']);
    expect(JSON.stringify(r)).not.toContain('FAKE-READ-TOKEN');
    const empty = await runSource(telemetry, baseCtx({ telemetryDir: temp('crow-telemetry-') }));
    expect(empty.status.note).toMatch(/no inbox yet/);
    expect(empty.status.note).not.toContain('/');
  });
});

describe('the collector end to end', () => {
  const dirsFor = () => ({ CROW_COSTS_DIR: join(temp('crow-costs-'), 'costs'), CROW_TELEMETRY_DIR: join(temp('crow-tel-'), 'telemetry') });

  it('refuses before any request without an approval, after a change, with an untracked file, a symlink or a tracked record', async () => {
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
    writeFileSync(join(root, '.gitattributes'), 'scripts/costs/** -diff\n');
    await expect(run()).rejects.toThrow(/\.gitattributes/);
    rmSync(join(root, '.gitattributes'));
    sh(root, 'add', '-f', '.costs-approved');
    await expect(run()).rejects.toThrow(/tracked by git/);
    expect(fetch.calls).toHaveLength(0);
    expect(() => checkApproved(root)).toThrow(ApprovalRefused);

    const linked = cloneRepo();
    symlinkSync('/etc/hosts', join(linked, 'scripts', 'costs', 'link.mjs'));
    sh(linked, 'add', '.');
    sh(linked, 'commit', '-q', '-m', 'a symlink');
    expect(() => approve(linked)).toThrow(/symlinks/);
    writeFileSync(join(linked, '.costs-approved'), `${sh(linked, 'rev-parse', 'HEAD')}\n`);
    expect(() => checkApproved(linked)).toThrow(/symlinks.*link\.mjs/);
  });

  it('writes only latest.json and the day file, prints only statuses, and leaks no credential or body on any error path', async () => {
    const root = cloneRepo();
    approve(root);
    const before = listTree(root);
    const env = { ...dirsFor(), CROW_COSTS_DEEPSEEK_KEY: 'sk-FAKE-SECRET-VALUE-123', CROW_COSTS_GITHUB_TOKEN: 'ghp-FAKE-SECRET-VALUE-456', CROW_COSTS_CLOUDFLARE_TOKEN: 'cf-FAKE-SECRET-VALUE-789', CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CROW_COSTS_ANTHROPIC_ADMIN_KEY: 'sk-ant-admin01-FAKE-SECRET' };
    const echo = (u: string, init: RequestInit) => `${JSON.stringify(init.headers)} ${u} RESPONSE-BODY-TEXT`;
    const fetch = async (u: string, init: RequestInit = {}) => {
      if (u.includes('deepseek')) return new Response(JSON.stringify({ error: { type: 'authentication_error', message: echo(u, init) } }), { status: 401 });
      if (u.includes('github')) return new Response(`not json ${echo(u, init)}`, { status: 200 });
      if (u.includes('billable-usage')) return new Response(JSON.stringify({ success: false, note: echo(u, init) }), { status: 200 });
      if (u.includes('graphql')) throw new Error(`socket closed ${echo(u, init)}`);
      return new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error(`aborted ${echo(u, init)}`))));
    };
    const printed: string[] = [];
    const log = vi.spyOn(console, 'log');
    const err = vi.spyOn(console, 'error');
    const doc = await collect({ cloneRoot: root, env, fetchImpl: fetch, now: NOW, timeoutMs: 200, sources: [deepseek, github, cloudflareBilling, cloudflareAnalytics, anthropic, telemetry], log: (l: string) => printed.push(l) });
    expect(doc.sources.map((s: { source: string; error?: { type: string } }) => [s.source, s.error?.type ?? 'ok'])).toEqual([
      ['deepseek', 'http'],
      ['github', 'parse'],
      ['cloudflare-billing', 'shape'],
      ['cloudflare-analytics', 'network'],
      ['anthropic', 'timeout'],
      ['telemetry', 'ok'],
    ]);
    expect(printed.slice(0, 2)).toEqual(['deepseek: failed (http 401 authentication_error)', 'github: failed (parse)']);
    expect(doc.sources[0].error).toEqual({ type: 'http', status: 401, code: 'authentication_error' });
    const latest = readFileSync(join(env.CROW_COSTS_DIR, 'latest.json'), 'utf8');
    expect(JSON.parse(latest)).toEqual(doc);
    expect(listTree(env.CROW_COSTS_DIR)).toEqual(['2026-11-03.json', 'latest.json']);
    expect(listTree(env.CROW_TELEMETRY_DIR)).toEqual([]);
    expect(listTree(root)).toEqual(before);
    for (const text of [latest, printed.join('\n')]) {
      expect(text).not.toContain('FAKE-SECRET');
      expect(text).not.toContain('RESPONSE-BODY-TEXT');
    }
    expect(log).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    log.mockRestore();
    err.mockRestore();
  });

  it('refuses a missing, relative, in-clone, in-checkout, in-git-directory or linked-worktree directory', () => {
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
    refuse(join(other, 'costs'), /inside a git checkout/);
    refuse(join(other, 'ignored', 'costs'), /inside a git checkout/);
    refuse(join(other, '.git', 'costs', 'x'), /inside a git (directory|checkout)/);
    refuse(join(linked, 'ignored', 'costs'), /inside a git checkout/);
    const outside = join(temp('crow-outside-'), 'costs');
    expect(checkDir('CROW_COSTS_DIR', outside, root)).toBe(outside);
    expect(() => checkDir('X', undefined, root)).toThrow(DirRefused);
  });
});

describe('the launcher', () => {
  it('runs the approval check before any other cost module loads, and loads the keys only after it', () => {
    const stub = [
      "import { writeFileSync } from 'node:fs';",
      "writeFileSync(new URL('../../marker.txt', import.meta.url), `top-level ran, key=${process.env.CROW_COSTS_TEST ?? 'none'}`);",
      'export const isRefusal = () => false;',
      'export async function collect() {}',
      '',
    ].join('\n');
    const root = cloneRepo({
      'scripts/costs/collect.mjs': readFileSync(join(COSTS, 'collect.mjs'), 'utf8'),
      'scripts/costs/approved.mjs': readFileSync(join(COSTS, 'approved.mjs'), 'utf8'),
      'scripts/costs/run.mjs': stub,
    });
    writeFileSync(join(root, '.env.costs'), 'CROW_COSTS_TEST=loaded\n');
    const launch = () => spawnSync(process.execPath, [join(root, 'scripts', 'costs', 'collect.mjs')], { cwd: root, encoding: 'utf8', env: BARE_ENV });
    const marker = join(root, 'marker.txt');

    let r = launch();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refused: no \.costs-approved/);
    expect(existsSync(marker)).toBe(false);

    approve(root);
    r = launch();
    expect(r.status).toBe(0);
    expect(readFileSync(marker, 'utf8')).toBe('top-level ran, key=loaded');
    rmSync(marker);

    writeFileSync(join(root, 'scripts', 'costs', 'run.mjs'), `${stub}// changed after approval\n`);
    r = launch();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refused: .*scripts\/costs\/run\.mjs/);
    expect(existsSync(marker)).toBe(false);
  });
});

describe('what the collector may run and write', () => {
  it('holds only .mjs files that import node: modules and each other, with no dynamic or indirect loading', () => {
    const files = readdirSync(COSTS, { recursive: true, withFileTypes: true }).filter((e) => !e.isDirectory()).map((e) => join(e.parentPath, e.name));
    expect(files.length).toBeGreaterThanOrEqual(14);
    for (const f of files) {
      const name = relative(COSTS, f);
      expect(f.endsWith('.mjs'), `${name} is not a .mjs file`).toBe(true);
      expect(realpathSync(f), `${name} is a link`).toBe(f);
      const text = readFileSync(f, 'utf8');
      for (const banned of [/\brequire\s*\(/, /createRequire/, /['"]node:(module|vm|worker_threads)['"]/, /\bimport\s*\(\s*[^'"\s]/, /\beval\s*\(/, /new\s+Function\b/]) {
        expect(text, `${name} matches ${banned}`).not.toMatch(banned);
      }
      const specs = [...text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? m[2] ?? m[3]);
      for (const s of specs) {
        if (s.startsWith('node:')) continue;
        expect(s.startsWith('./') || s.startsWith('../'), `${name} imports ${s}`).toBe(true);
        const target = resolve(dirname(f), s);
        expect(relative(COSTS, target).startsWith('..'), `${name} imports ${s}`).toBe(false);
        expect(existsSync(target), `${name} imports a missing ${s}`).toBe(true);
      }
    }
  });

  it('keeps the launcher down to node: modules and the approval check', () => {
    const text = readFileSync(join(COSTS, 'collect.mjs'), 'utf8');
    const statics = [...text.matchAll(/(?:^|\n)import\s[^'";]*?from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(statics.filter((s) => !s.startsWith('node:'))).toEqual(['./approved.mjs']);
  });

  it('keeps the approval record out of git, and package.json has no cost script', () => {
    expect(spawnSync('git', ['check-ignore', '-q', '.costs-approved']).status).toBe(0);
    expect(readFileSync('package.json', 'utf8')).not.toMatch(/costs/);
  });
});
