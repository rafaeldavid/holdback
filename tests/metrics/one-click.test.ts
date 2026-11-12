// T-066 slice 1: tools/one-click/metrics.mjs on fixtures cut from the two harness runs of 2026-11-05 (T-066 Context):
// the SDK's init and result messages, without the assistant's text, and the harness's bookkeeping. No network, and the
// Agent SDK is not installed in CI: metrics.mjs imports none of it, and run.mjs --dry-run (T-370) plays a script in
// place of the SDK.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { check } from '../../scripts/metrics/check.mjs';
import { buildRunFile, childEnv, cloudflareOf, countTailEvent, decimalToMicros, deniedRequest, emptyTailCount, runIdOf, scrub, summaryOf, tokensOf, unionMs } from '../../tools/one-click/metrics.mjs';
import { FIXTURES, ONCE, ROOT, config, json } from './helpers';

const prices = config('model-prices.json');
const COMMIT = '7639613453bc367ed3ac0122cdb38e4e4553765d';
const STARTED = Date.parse('2026-11-05T13:35:12Z');
const options = { scenario: 'buyer', model: 'claude-opus-5-5', effort: 'medium', maxReplies: 6, timeoutMs: 600_000 };

function build(name: string, effortApplied: string | null = 'medium') {
  const f = json(name);
  return buildRunFile({ init: f.init, result: f.result, book: { ...f.book, effortApplied }, options, prices, startedAtMs: STARTED, generatedAtMs: STARTED + 120_000, commit: COMMIT, sdkVersion: '0.3.318' });
}

describe('the run file, run "once"', () => {
  const run = build('one-click-once.json');

  it('counts 4 approvals, all tool permissions for Bash', () => {
    expect(run.approvals).toMatchObject({ total: 4, toolPermission: 4, conversational: 0, byTool: { Bash: 4 } });
    expect(run.approvals.requests.map((r: { atMs: number }) => r.atMs)).toEqual([5500, 16000, 19800, 24500]);
    expect(run.approvals.requests[0].summary).toBe('curl -sS https://escrow.stream/llms.txt');
  });

  it('keeps the token fields of T-066 Context', () => {
    expect(run.tokens.byModel['claude-opus-5-5']).toEqual({ input: 12, cacheWrite5m: 0, cacheWrite1h: 13_201, cacheRead: 125_536, output: 2_331, thinking: 387 });
    expect(run.tokens.byModel['claude-haiku-5-5']).toEqual({ input: 1_194, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 17, thinking: 0 });
    expect(run.tokens.numTurns).toBe(6);
    expect(run.tokens.sdkUsage.cache_creation).toEqual({ ephemeral_1h_input_tokens: 13_201, ephemeral_5m_input_tokens: 0 });
  });

  it('prices every token at Opus 5.5 by hand', () => {
    // Opus: 12 × 4 + 13,201 × 8 + 125,536 × 0.20 + 2,331 × 20 = 177,383.2 µUSD.
    // Haiku at Opus prices: 1,194 × 4 + 17 × 20 = 5,116 µUSD. In all 182,499.2, rounded once to 182,499.
    expect(run.cost.atOpus55).toMatchObject({ usdMicros: '182499', byModel: { 'claude-opus-5-5': '177383', 'claude-haiku-5-5': '5116' } });
    expect(run.cost.atOpus55.priceTable).toEqual({ file: 'config/model-prices.json', model: 'claude-opus-5-5', source: 'https://platform.claude.com/docs/en/about-claude/pricing', readOn: '2026-11-05' });
  });

  it("reproduces the SDK's Opus 5.5 costUSD of 0.1773832 within 1% (the acceptance check)", () => {
    expect(run.cost.sdk).toEqual({ totalCostUsd: '0.17751109999999998', byModel: { 'claude-haiku-5-5': '0.0001279', 'claude-opus-5-5': '0.17738319999999996' } });
    const ours = BigInt(run.cost.atOpus55.byModel['claude-opus-5-5']);
    const sdk = decimalToMicros(run.cost.sdk.byModel['claude-opus-5-5']) as bigint;
    expect(sdk).toBe(177_383n);
    expect(ours - sdk).toBe(0n);
    // The whole run reads 2.81% above the SDK's total: the Haiku side call priced at Opus rates.
    expect(run.cost.deltaBps).toBe(281);
  });

  it('splits the wall time into model, tool, approval wait and the rest', () => {
    // Tool spans: 1.0 + 0 + 0.3 + 0.1 + 68.3 s = 69.7 s; the rest: 106 − 36.001 − 69.7 = 0.299 s.
    expect(run.time).toEqual({ wallMs: 106_000, modelMs: 36_001, toolMs: 69_700, approvalWaitMs: 0, otherMs: 299, sdkDurationMs: 104_755 });
  });

  it('records the outcome and the effort a hook reported', () => {
    expect(run.runId).toBe('2026-11-05T13-35-12Z-buyer');
    expect(run.outcome).toMatchObject({ state: 'Released', commitmentId: '0xa93a4a1d24e0cf57c846d17cdaa65094f8df73d5707ed142c35c532916d88f93', releasedAtMs: 92_800 });
    expect(run.outcome.txs).toHaveLength(3);
    expect(run.model).toEqual({ requested: 'claude-opus-5-5', init: 'claude-opus-5-5', effortRequested: 'medium', effortApplied: 'medium', effortSource: 'hook' });
    expect(run.harness).toEqual({ sdkVersion: '0.3.318', claudeCodeVersion: '2.1.318', maxReplies: 6, timeoutMs: 600_000 });
  });

  it('validates against its schema', () => {
    expect(check('one-click', run)).toEqual({ ok: true, errors: [] });
  });
});

describe('the run file, run "always"', () => {
  const run = build('one-click-always.json');

  it('counts 4 approvals and prices Opus 5.5 at the SDK figure', () => {
    expect(run.approvals.total).toBe(4);
    expect(run.tokens.byModel['claude-opus-5-5']).toEqual({ input: 12, cacheWrite5m: 0, cacheWrite1h: 15_403, cacheRead: 131_507, output: 2_238, thinking: 477 });
    // 12 × 4 + 15,403 × 8 + 131,507 × 0.20 + 2,238 × 20 = 194,333.4 µUSD; the SDK says 0.1944613 − 0.0001279 = 0.1943334.
    expect(run.cost.atOpus55.byModel['claude-opus-5-5']).toBe('194333');
    expect(run.cost.atOpus55.usdMicros).toBe('199449');
    expect(check('one-click', run).ok).toBe(true);
  });
});

describe('what the run file refuses to claim', () => {
  it('marks the effort unknown when no hook reported it', () => {
    const run = build('one-click-once.json', null);
    expect(run.model).toMatchObject({ effortApplied: null, effortSource: 'none' });
    expect(run.gaps.some((g: string) => /marks this run invalid/.test(g))).toBe(true);
    expect(check('one-click', run).ok).toBe(true);
  });

  it('reads the cost at Opus 5.5 as unknown with no price table', () => {
    const f = json('one-click-once.json');
    const run = buildRunFile({ init: f.init, result: f.result, book: f.book, options, prices: null, startedAtMs: STARTED, generatedAtMs: STARTED, commit: COMMIT, sdkVersion: '0.3.318' });
    expect(run.cost.atOpus55.usdMicros).toBe(null);
    expect(run.cost.deltaBps).toBe(null);
  });

  it('shows a run that stopped short as stopped', () => {
    const f = json('one-click-once.json');
    const run = buildRunFile({ init: f.init, result: f.result, book: { ...f.book, finalState: null, commitmentId: null }, options, prices, startedAtMs: STARTED, generatedAtMs: STARTED, commit: COMMIT, sdkVersion: '0.3.318' });
    expect(run.outcome.state).toBe('stopped');
  });
});

describe('helpers', () => {
  it('turns the SDK dollar strings into micro-dollars exactly', () => {
    expect(decimalToMicros('0.17751109999999998')).toBe(177_511n);
    expect(decimalToMicros('1e-7')).toBe(0n);
    expect(decimalToMicros('5e-7')).toBe(1n);
    expect(decimalToMicros('12')).toBe(12_000_000n);
    expect(decimalToMicros('NaN')).toBe(null);
  });

  it('counts an unsplit cache write as a 5-minute write', () => {
    expect(tokensOf({ inputTokens: 1, cacheCreationInputTokens: 10, cacheCreationEphemeral1hInputTokens: 4, outputTokens: 2 })).toMatchObject({ cacheWrite5m: 6, cacheWrite1h: 4 });
  });

  it('counts overlapping tool spans once', () => {
    expect(unionMs([{ startMs: 0, endMs: 10 }, { startMs: 5, endMs: 15 }, { startMs: 20, endMs: 25 }])).toBe(20);
  });

  it('keeps no local path, control character or long secret-like run in a summary', () => {
    expect(scrub('cat /Users/someone/.claude/x.txt | head')).toBe('cat <local path> | head');
    expect(scrub('echo sk-ant-abcdefghijkl')).toBe('echo <redacted>');
    expect(scrub(`a${String.fromCodePoint(0x7)}b${String.fromCodePoint(0x202e)}c`)).toBe('a b c');
    expect(scrub('x'.repeat(500))).toBe('<redacted>');
    expect(scrub('ab '.repeat(500))).toHaveLength(300);
  });

  it('names a run by its start and scenario', () => {
    expect(runIdOf(Date.parse('2026-11-05T13:35:12.345Z'), 'seller')).toBe('2026-11-05T13-35-12Z-seller');
  });

  it('drops header and credential values, query strings and IP addresses from a summary', () => {
    expect(scrub(`curl -H 'x-api-key: abc' http://10.0.0.5/v1?k=1`)).toBe('curl -H <value> http://<ip>/v1');
    expect(scrub('curl --header="Authorization: Bearer z" -u me:pw https://u:p@api.crow.direct/v1/x#f')).toBe('curl --header=<value> -u <value> https://api.crow.direct/v1/x');
    expect(scrub('sort -u -t: -k2')).toBe('sort -u -t: -k2');
    expect(scrub('curl http://[::1]:8787/')).toBe('curl http://<ip>:8787/');
  });

  it('drops credentials and personal data from hostile commands (the T-370 review)', () => {
    const KEY = `0x${'ab'.repeat(32)}`;
    const hostile = [
      `curl -H'x-api-key: S3CR3T' https://a.example/c`,
      'curl -H "a\\"S3CR3T" https://a.example/',
      'http POST https://api.crow.direct/x Authorization:"Bearer S3CR3T"',
      `curl -d '{"k":"S3CR3T"}' https://a.example/`,
      'API_KEY=S3CR3T node x.mjs',
      `node x --private-key ${KEY}`,
      'echo person@example.com',
      'cat /USERS/someone/x ~/Projects/y',
      'ping fe80::1',
      'git clone ssh://user:S3CR3T@host.example/repo',
      'curl --proxy-user u:S3CR3T https://a.example/',
      'wget --password=S3CR3T https://a.example/',
      'curl -E cert:S3CR3T https://a.example/',
    ];
    for (const c of hostile) for (const leak of ['S3CR3T', KEY, 'person@example.com', 'someone', 'Projects', 'fe80']) expect(scrub(c), c).not.toContain(leak);
    expect(scrub('curl -fsSLO https://crow.direct/try.mjs && node try.mjs')).toBe('curl -fsSLO https://crow.direct/try.mjs && node try.mjs');
  });

  it("shows a tool other than Bash, WebFetch or a file tool by its name only, never the assistant's input", () => {
    expect(summaryOf('Task', { prompt: 'secret plan' })).toBe('');
    expect(summaryOf('WebFetch', { url: 'https://crow.direct/llms.txt?x=1', prompt: 'text' })).toBe('https://crow.direct/llms.txt');
    expect(summaryOf('Read', { file_path: '/Users/a/b.txt' })).toBe('<local path>');
  });

  it("denies requests that name this machine's user's files", () => {
    expect(deniedRequest('Read', { file_path: '/Users/a/.ssh/id_ed25519' })).toBe(true);
    expect(deniedRequest('Bash', { command: 'cat .env.local' })).toBe(true);
    expect(deniedRequest('Bash', { command: 'security find-generic-password -s x' })).toBe(true);
    expect(deniedRequest('Bash', { command: 'curl -sS https://crow.direct/llms.txt' })).toBe(false);
  });

  it("denies commands that use this user's logins without naming a file (the T-370 review)", () => {
    for (const c of ['gh auth token', 'cd /Users/someone && cat .ssh/id_ed25519', 'cd ~ && cat .npmrc', 'cat ~/.netrc', 'npx wrangler whoami', 'ls /private/tmp/com.apple.launchd.x', 'git push origin main', 'ssh host.example', 'env | grep KEY']) expect(deniedRequest('Bash', { command: c }), c).toBe(true);
    for (const c of ['mkdir -p crow-try && cd crow-try && npm install --ignore-scripts viem@2.57.13 && node try.mjs', 'git clone https://github.com/x/y']) expect(deniedRequest('Bash', { command: c }), c).toBe(false);
  });

  it('passes the assistant no SSH agent, Anthropic, Claude or cloud variable', () => {
    const env = childEnv({ HOME: '/h', PATH: '/bin', SSH_AUTH_SOCK: '/s', ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_OAUTH_TOKEN: 't', AWS_SECRET_ACCESS_KEY: 'a', GITHUB_TOKEN: 'g' });
    expect(Object.keys(env).sort()).toEqual(['CLAUDE_AGENT_SDK_CLIENT_APP', 'HOME', 'PATH']);
  });
});

describe('the Cloudflare counts', () => {
  it('counts a Durable Object event only in the Durable Object fields', () => {
    const c = emptyTailCount();
    countTailEvent(c, { cpuTime: 3, wallTime: 10 });
    countTailEvent(c, { executionModel: 'durableObject', cpuTime: 2, wallTime: 7 });
    expect(c).toEqual({ requests: 1, cpuMs: 3, wallMs: 10, durableObjectRequests: 1, durableObjectWallMs: 7 });
  });

  const window = { from: '2026-11-12T00:00:00.000Z', to: '2026-11-12T00:05:00.000Z' };
  const live = { connected: true, exitedEarly: false, count: { ...emptyTailCount(), requests: 4 } };

  it('reads unknown, not 0, when no tail connected', () => {
    const dead = { connected: false, exitedEarly: true, count: emptyTailCount() };
    const r = cloudflareOf({ tails: { 'holdback-op1': dead, 'holdback-op2': dead, 'crow-test-agents': dead }, window, otherDeals: 0, commitmentId: ONCE });
    expect(r.cloudflare).toBe(null);
    expect(r.gaps.at(-1)).toMatch(/read unknown/);
  });

  it('leaves out a Worker whose tail exited, with a gap line', () => {
    const r = cloudflareOf({ tails: { 'holdback-op1': live, 'holdback-op2': { ...live, exitedEarly: true } }, window, otherDeals: 2, commitmentId: ONCE });
    expect(Object.keys(r.cloudflare?.workers ?? {})).toEqual(['holdback-op1']);
    expect(r.cloudflare?.otherDealsInWindow).toBe(2);
    expect(r.gaps).toEqual(['wrangler tail on holdback-op2 exited before the run ended, so its counts are left out.']);
  });

  it('leaves out a tail that connected after the prompt was sent', () => {
    const r = cloudflareOf({ tails: { 'holdback-op1': { ...live, connectedAt: 900 }, 'holdback-op2': { ...live, connectedAt: 1100 } }, window, otherDeals: 0, commitmentId: ONCE, promptAt: 1000 });
    expect(Object.keys(r.cloudflare?.workers ?? {})).toEqual(['holdback-op1']);
    expect(r.gaps).toEqual(['wrangler tail on holdback-op2 connected after the prompt was sent, so its counts are left out.']);
  });

  it('writes no count of other deals when the run found no commitment', () => {
    expect(cloudflareOf({ tails: { 'holdback-op1': live }, window, otherDeals: 3, commitmentId: null }).cloudflare?.otherDealsInWindow).toBe(null);
  });
});

describe('run.mjs --dry-run: the harness end to end, with no model, key or network', () => {
  const RUN = join(ROOT, 'tools/one-click/run.mjs');
  const SCRIPT = join(FIXTURES, 'one-click-script.json');
  const harness = (...extra: string[]) => {
    const out = mkdtempSync(join(tmpdir(), 'one-click-test-'));
    const r = spawnSync(process.execPath, [RUN, '--dry-run', SCRIPT, '--out', out, ...extra], { encoding: 'utf8', timeout: 60_000 });
    const files = readdirSync(out);
    const run = files.length === 1 && files[0].endsWith('.json') ? JSON.parse(readFileSync(join(out, files[0]), 'utf8')) : null;
    rmSync(out, { recursive: true, force: true });
    return { status: r.status, stderr: r.stderr, files, run };
  };

  it('writes one valid run file for a Released deal', () => {
    const { status, files, run } = harness();
    expect(status).toBe(0);
    expect(files).toHaveLength(1);
    expect(check('one-click', run)).toEqual({ ok: true, errors: [] });
    expect(run.outcome).toMatchObject({ state: 'Released', commitmentId: ONCE });
    expect(run.outcome.txs).toHaveLength(3);
    expect(run.model).toMatchObject({ requested: 'claude-opus-5-5', effortRequested: 'medium', effortApplied: 'medium', effortSource: 'hook' });
    expect(run.cost.atOpus55.usdMicros).toBe('182499');
    expect(run.cloudflare).toBe(null);
  });

  it('counts four tool approvals and one chat reply, and denies the local key file', () => {
    const { run } = harness();
    expect(run.approvals).toMatchObject({ total: 5, toolPermission: 4, conversational: 1, byTool: { Bash: 3, WebFetch: 1 } });
    expect(run.errors).toEqual(['denied a Read request that named a local path']);
  });

  it('keeps no header value, query string, IP address, local path or assistant text in the run file', () => {
    const text = JSON.stringify(harness().run);
    for (const leak of ['abc123', 'token=zzz', '10.0.0.5', 'id_ed25519', 'ref=abc', 'must not reach', 'must not be read', '/Users/']) expect(text).not.toContain(leak);
  });

  it('passes the requested effort to the hooks', () => {
    expect(harness('--effort', 'high').run.model).toMatchObject({ effortRequested: 'high', effortApplied: 'high' });
  });

  it('refuses a model ID the schema would refuse, before it starts', () => {
    for (const model of ['Claude Opus', 'claude-opus-5-5[1m]']) {
      const { status, stderr, files } = harness('--model', model);
      expect(status, model).toBe(2);
      expect(stderr).toMatch(/--model is a model ID/);
      expect(files).toEqual([]);
    }
  });
});
