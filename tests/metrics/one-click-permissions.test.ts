// T-441: the benchmark's two live permission modes. prompt (Claude Code's default, every command asks) stays the
// headline; sandbox-auto (Bash runs unprompted inside the OS sandbox, edits accepted) fills its own block. In both, the
// harness's fences hold on every call, prompted or not, and the agent key is unset for every sandboxed command.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { check } from '../../scripts/metrics/check.mjs';
import { buildSummary } from '../../scripts/metrics/one-click-summary.mjs';
import { PERMISSIONS, fenceHook, fenced, queryOptions, sessionOptions } from '../../tools/one-click/bench-live.mjs';
import { COMMIT, NOW, ROOT } from './helpers';
import { liveRecord } from './one-click-records';

const BENCH = join(ROOT, 'tools/one-click/bench.mjs');
const KEY_VAR = 'HOLDBACK_AGENT_ANTHROPIC_API_KEY';
const SENTINEL = 'crow-T441-sentinel-not-a-key-0123456789';
const roots = ['/tmp/crow-bench-abc', '/tmp/crow-bench-probe-xyz'];
const cwd = roots[0];
const at = (n: number) => Date.parse('2026-11-14T10:00:00Z') + n * 60_000;
const envWith = (extra: Record<string, string>) => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string' && k !== KEY_VAR) env[k] = v;
  return { ...env, ...extra };
};
const run = (argv: string[], extra: Record<string, string> = { [KEY_VAR]: SENTINEL }) => spawnSync(process.execPath, [BENCH, ...argv], { encoding: 'utf8', env: envWith(extra) });

describe('the session options', () => {
  const base = { sandboxed: true, writable: roots, home: '/Users/someone' };

  it('prompt: Claude Code\'s default mode, and every sandboxed Bash command still asks', () => {
    const o = sessionOptions({ ...base, permissions: 'prompt' });
    expect(o.permissionMode).toBe('default');
    expect(o.sandbox).toMatchObject({ enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: false, allowUnsandboxedCommands: false });
  });

  it('sandbox-auto: Bash runs unprompted only inside the sandbox, which keeps the same network and write limits', () => {
    const o = sessionOptions({ ...base, permissions: 'sandbox-auto' });
    const p = sessionOptions({ ...base, permissions: 'prompt' });
    expect(o.permissionMode).toBe('acceptEdits');
    expect(o.sandbox).toMatchObject({ enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false });
    expect(o.sandbox?.network).toEqual(p.sandbox?.network);
    expect(o.sandbox?.network.strictAllowlist).toBe(true);
    expect(o.sandbox?.filesystem).toEqual(p.sandbox?.filesystem);
    expect(o.sandbox?.filesystem.allowWrite).toEqual(roots);
    expect(o.sandbox?.filesystem.denyRead).toContain('/Users/someone/.zsh_history');
  });

  it.each(PERMISSIONS)('%s: the agent key is unset for every sandboxed command, whatever the command says', (permissions) => {
    const env = sessionOptions({ ...base, permissions }).sandbox?.credentials.envVars ?? [];
    expect(env).toContainEqual({ name: 'ANTHROPIC_API_KEY', mode: 'deny' });
    expect(env).toContainEqual({ name: KEY_VAR, mode: 'deny' });
  });

  it('refuses sandbox-auto without the sandbox, and an unknown mode', () => {
    expect(() => sessionOptions({ ...base, sandboxed: false, permissions: 'sandbox-auto' })).toThrow(/needs the OS sandbox/);
    expect(() => sessionOptions({ ...base, permissions: 'bypassPermissions' as never })).toThrow(/permissions is one of/);
    expect(sessionOptions({ ...base, sandboxed: false, permissions: 'prompt' }).sandbox).toBeUndefined();
  });
});

describe('the fence hook holds on every call, prompted or not', () => {
  const denied: string[] = [];
  const hook = fenceHook({ roots, cwd, onDeny: (t) => denied.push(t) });
  const call = (tool_name: string, tool_input: object) => hook({ hook_event_name: 'PreToolUse', tool_name, tool_input, tool_use_id: 't', session_id: 's', transcript_path: '', cwd });

  it.each([
    ['Bash', { command: 'node -e "console.log(process.env)"' }],
    ['Bash', { command: 'cd docs && echo $ANTHROPIC_API_KEY' }],
    ['Bash', { command: 'cat ~/.ssh/id_ed25519' }],
    ['Read', { file_path: '/Users/someone/.zsh_history' }],
    ['Write', { file_path: '/tmp/elsewhere/x.mjs' }],
    ['Grep', { pattern: 'API_KEY', path: '/Users/someone' }],
  ])('denies %s %j', async (tool, input) => {
    expect(fenced(tool, input, roots, cwd)).toBe(true);
    const out = await call(tool, input);
    expect(out).toMatchObject({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' } });
    expect(denied.at(-1)).toBe(tool);
  });

  it.each([
    ['Bash', { command: 'curl -sS https://crow.direct/llms.txt -o llms.txt' }],
    ['Bash', { command: 'node try.mjs --seller https://crow.direct/agents/test-seller' }],
    ['Write', { file_path: '/tmp/crow-bench-abc/buy.mjs' }],
    ['Read', { file_path: 'llms.txt' }],
  ])('lets %s %j through to Claude Code\'s own check', async (tool, input) => {
    const n = denied.length;
    expect(await call(tool, input)).toEqual({});
    expect(denied.length).toBe(n);
  });

  it('ignores other hook events', async () => {
    expect(await hook({ hook_event_name: 'Stop', tool_name: 'Bash', tool_input: { command: 'echo $ANTHROPIC_API_KEY' } } as never)).toEqual({});
  });
});

describe('the file-tool fence follows symlinks and absolute Glob patterns (review, finding 1)', () => {
  it('denies a file tool through a link the agent made in its own folder, and allows a plain file there', () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'crow-fence-')));
    const root = join(base, 'run');
    const outside = join(base, 'outside');
    mkdirSync(root);
    mkdirSync(outside);
    writeFileSync(join(outside, 'id_ed25519'), 'not a key');
    symlinkSync(outside, join(root, 'l'));
    try {
      expect(fenced('Read', { file_path: 'l/id_ed25519' }, [root], root)).toBe(true);
      expect(fenced('Write', { file_path: join(root, 'l', 'new.txt') }, [root], root)).toBe(true);
      expect(fenced('Edit', { file_path: join(root, 'l', 'id_ed25519') }, [root], root)).toBe(true);
      expect(fenced('Write', { file_path: join(root, 'buy.mjs') }, [root], root)).toBe(false);
      expect(fenced('Write', { file_path: join(root, 'deal-1', 'keys.json') }, [root], root)).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('denies a Glob whose pattern is an absolute path outside the run, and allows a relative one', () => {
    expect(fenced('Glob', { pattern: '/etc/**' }, roots, cwd)).toBe(true);
    expect(fenced('Glob', { pattern: '~/.ssh/*' }, roots, cwd)).toBe(true);
    expect(fenced('Glob', { pattern: '**/*.mjs' }, roots, cwd)).toBe(false);
    expect(fenced('Glob', { pattern: `${cwd}/**/*.json` }, roots, cwd)).toBe(false);
  });
});

describe('the options passed to query() (review, finding 2)', () => {
  const fence = async () => ({});
  const recordEffort = async () => ({});
  const opts = (permissions: 'prompt' | 'sandbox-auto', sandboxed = true) => queryOptions({ cwd, permissions, sandboxed, writable: roots, home: '/Users/someone', canUseTool: async () => ({}), env: {}, model: 'claude-opus-5-5', effort: 'medium', fence, recordEffort, stderr: () => {} });

  it.each(PERMISSIONS)('%s: the fence runs on every tool call, with no matcher, and the sandbox is on', (permissions) => {
    const o = opts(permissions);
    expect(o.hooks.PreToolUse).toHaveLength(1);
    expect(o.hooks.PreToolUse[0]).not.toHaveProperty('matcher');
    expect(o.hooks.PreToolUse[0].hooks).toContain(fence);
    expect(o.sandbox).toMatchObject({ enabled: true, autoAllowBashIfSandboxed: permissions === 'sandbox-auto' });
    expect(o.permissionMode).toBe(permissions === 'sandbox-auto' ? 'acceptEdits' : 'default');
    expect(o.settingSources).toEqual([]);
    expect(o.mcpServers).toEqual({});
  });

  it('an unsandboxed prompt run has no sandbox and keeps the fence', () => {
    const o = opts('prompt', false);
    expect(o).not.toHaveProperty('sandbox');
    expect(o.hooks.PreToolUse[0].hooks).toContain(fence);
  });
});

describe('the records and the summary keep the two modes apart', () => {
  it('an unknown mode throws rather than landing in the headline (review, finding 6)', () => {
    expect(() => liveRecord({ permissions: 'bypassPermissions' })).toThrow(/agent\.permissions is one of/);
  });

  it("each scenario's latest live run names its mode (review, finding 4)", () => {
    const s = buildSummary({ records: [liveRecord({ id: 's1', startedAtMs: at(1) }), liveRecord({ id: 's1', startedAtMs: at(2), permissions: 'sandbox-auto' })], generatedAtMs: NOW, commit: COMMIT });
    expect(s.byScenario.s1.latestLive).toMatchObject({ permissions: 'sandbox-auto' });
    expect(check('one-click-summary', s)).toEqual({ ok: true, errors: [] });
  });

  it('a live record names its mode; one without the field (before T-441) still passes and reads as prompt', () => {
    const auto = liveRecord({ permissions: 'sandbox-auto' });
    expect(auto.agent.permissions).toBe('sandbox-auto');
    expect(check('one-click', auto)).toEqual({ ok: true, errors: [] });
    expect(liveRecord().agent.permissions).toBe('prompt');
    const old = liveRecord();
    delete (old.agent as { permissions?: string }).permissions;
    expect(check('one-click', old)).toEqual({ ok: true, errors: [] });
    expect(check('one-click', { ...auto, agent: { ...auto.agent, permissions: 'bypassPermissions' } }).ok).toBe(false);
  });

  it('a sandbox-auto record never moves the headline; it fills sandboxAuto', () => {
    const old = liveRecord({ id: 's1', approvals: 20, startedAtMs: at(1) });
    delete (old.agent as { permissions?: string }).permissions;
    const records = [
      old,
      liveRecord({ id: 's3', approvals: 11, startedAtMs: at(2), permissions: 'prompt' }),
      liveRecord({ id: 's4', approvals: 8, startedAtMs: at(3), permissions: 'prompt' }),
      liveRecord({ id: 's1', approvals: 1, startedAtMs: at(4), permissions: 'sandbox-auto' }),
      liveRecord({ id: 's3', approvals: 0, startedAtMs: at(5), permissions: 'sandbox-auto' }),
      liveRecord({ id: 's4', approvals: 2, startedAtMs: at(6), permissions: 'sandbox-auto' }),
      liveRecord({ id: 's6', approvals: 99, startedAtMs: at(7), permissions: 'sandbox-auto', success: false }),
    ];
    const s = buildSummary({ records, generatedAtMs: NOW, commit: COMMIT });
    const without = buildSummary({ records: records.slice(0, 3), generatedAtMs: NOW, commit: COMMIT });
    expect(s.headline).toEqual(without.headline);
    expect(s.headline.approvalsPerDeal).toEqual({ state: 'measured', value: 11, deals: 3 });
    expect(s.sandboxAuto).toMatchObject({ live: 4, liveCompleted: 3, headline: { approvalsPerDeal: { state: 'measured', value: 1, deals: 3 } } });
    expect(s.gaps.some((g: string) => /4 live sandbox-auto record\(s\) fill sandboxAuto/.test(g))).toBe(true);
    expect(check('one-click-summary', s)).toEqual({ ok: true, errors: [] });
  });

  it('sandbox-auto records alone leave the headline missing, with the reason', () => {
    const s = buildSummary({ records: [liveRecord({ permissions: 'sandbox-auto' })], generatedAtMs: NOW, commit: COMMIT });
    expect(s.headline.approvalsPerDeal).toEqual({ state: 'missing', value: null, deals: 0 });
    expect(s.gaps.some((g: string) => /none in the prompt permission mode/.test(g))).toBe(true);
    expect(s.sandboxAuto.headline.approvalsPerDeal).toEqual({ state: 'measured', value: 3, deals: 1 });
  });
});

describe('the --permissions flag, before anything is sent', () => {
  it.each([
    [['--scenario', 's1', '--live', '--permissions', 'bypassPermissions'], /--permissions is one of prompt, sandbox-auto/],
    [['--scenario', 's1', '--live', '--permissions', 'sandbox-auto', '--unsandboxed'], /needs the OS sandbox/],
    [['--scenario', 's1', '--permissions', 'sandbox-auto'], /--permissions is for live runs/],
    [['--scenario', 's1', '--live', '--permissions', 'sandbox-auto', '--out', 'OUT/live'], /holds the other permission mode's records/],
    [['--scenario', 's1', '--live', '--out', 'OUT/live-sandbox-auto'], /holds the other permission mode's records/],
  ])('refuses %j, writes nothing and never prints the key', (argv, message) => {
    const out = mkdtempSync(join(tmpdir(), 'crow-bench-perm-'));
    try {
      const own = argv.includes('--out') ? argv.map((a) => a.replace(/^OUT/, out)) : [...argv, '--out', out];
      const r = run(own);
      expect(r.status, r.stderr).toBe(2);
      expect(r.stderr).toMatch(message);
      expect(r.stdout + r.stderr).not.toContain(SENTINEL.slice(8));
      expect(readdirSync(out)).toEqual([]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
