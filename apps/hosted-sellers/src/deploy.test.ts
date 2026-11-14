// The hosted seller's deploy and secrets (T-436): the decisions in deploy-plan.ts with plain facts, and the runs with
// stand-ins for wrangler, git, the network, the files and the clock. No test uploads, fetches, waits or sets a secret.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkBundle } from './bundle.ts';
import { dealGuard, deploySeller, healthAfter, readSellerFolder, setSecrets, workspaceRefusal, wranglerConfig, type DeployEffects, type SecretsEffects } from './deploy-plan.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const EXAMPLE = here('../example/seller');
const fileOf = (name: string) => {
  try {
    return readFileSync(`${EXAMPLE}/${name}`, 'utf8');
  } catch {
    return undefined;
  }
};
const bundle = readSellerFolder(fileOf);
const seller = checkBundle(bundle);
const BASE = 'https://crow.direct/agents/example-audits';
const BEFORE = '545afdd8-1e1c-40ff-aa35-2eea83d9ec0e';
const AFTER = '6122d260-d59b-41a0-8699-3bc6cacaa354';

describe('a seller folder becomes its bundle (T-436)', () => {
  it('reads hosted.json, adapter.json and the files it names: the example folder is the example bundle', () => {
    expect(bundle).toEqual(JSON.parse(readFileSync(here('../example/bundle.json'), 'utf8')));
  });
  it('refuses a missing file, a file name with a path, and a file the configuration names that is not there', () => {
    expect(() => readSellerFolder((n) => (n === 'hosted.json' ? undefined : fileOf(n)))).toThrow("the seller's folder has no hosted.json");
    const withPath = (template: string) => (n: string) => (n === 'adapter.json' ? JSON.stringify({ ...JSON.parse(fileOf('adapter.json')!), template }) : fileOf(n));
    for (const t of ['../template.json', '/etc/passwd', 'sub/template.json']) expect(() => readSellerFolder(withPath(t)), t).toThrow('adapter.json: template must name one file');
    expect(() => readSellerFolder(withPath('other.json'))).toThrow('adapter.json: template names other.json, and the seller\'s folder has no such file');
  });
});

describe("the seller's Worker configuration (T-436)", () => {
  it('names the Worker after the slug, routes its two paths, binds its object and defers code updates', () => {
    const c = wranglerConfig(seller, { main: '/abs/entry.ts', bundlePath: '/abs/bundle.json', commit: 'a'.repeat(40) }) as J;
    expect(c.name).toBe('crow-seller-example-audits');
    expect(c.routes).toEqual([{ pattern: 'crow.direct/agents/example-audits', zone_name: 'crow.direct' }, { pattern: 'crow.direct/agents/example-audits/*', zone_name: 'crow.direct' }]);
    expect(c.alias).toEqual({ 'crow-hosted-seller-bundle': '/abs/bundle.json' });
    expect(c.vars).toEqual({ OPERATOR_URLS: 'https://api.crow.direct,https://api2.crow.direct', SELLER_URL: BASE, BUILD_COMMIT: 'a'.repeat(40) });
    expect(c.durable_objects).toEqual({ bindings: [{ name: 'SELLER', class_name: 'HostedSeller' }], code_update_strategy: { mode: 'deferred', max_delay: 300 } });
    expect(c.observability).toEqual({ enabled: true, logs: { invocation_logs: false } });
    expect(c.workers_dev).toBe(false);
    expect(c.compatibility_flags).toEqual(['nodejs_compat', 'nodejs_compat_do_not_populate_process_env', 'disallow_importable_env']);
    expect(JSON.stringify(c)).not.toMatch(/KEY|CREDENTIAL|secret/i);
  });
});

describe('the checks before and after an upload (T-436)', () => {
  it('the workspace must be named, and match', () => {
    expect(workspaceRefusal(seller, undefined)).toMatch(/^name the account/);
    expect(workspaceRefusal(seller, 'example-workspace')).toBeNull();
    expect(workspaceRefusal(seller, 'another')).toMatch(/pins another account/);
    expect(workspaceRefusal(seller, 'none')).toMatch(/pins an account/);
  });
  it('the deal guard waits for a deal at starting, and goes on only on an answer from this seller', () => {
    const h = (o: J, status = 200) => ({ status, body: JSON.stringify({ seller: 'example-audits', ...o }) });
    const g = (a: { status: number; body: string }) => dealGuard(a, 'example-audits');
    expect(g(h({ status: 'operational', open: 2, stages: { starting: 1, started: 1 } }))).toEqual({ go: false, why: expect.stringMatching(/^1 deal is at starting/) });
    expect(g(h({ status: 'operational', open: 1, stages: { 'start-unknown': 1 } })).go).toBe(true); // it sends no start
    expect(g(h({ status: 'degraded', reason: 'the seller could not start' }, 503))).toEqual({ go: true, note: 'the live seller reads degraded: it runs no start now' });
    expect(g({ status: 0, body: '' }).go).toBe(false); // no answer says nothing about the deals
    expect(g({ status: 200, body: JSON.stringify({ status: 'operational', seller: 'someone-else' }) }).go).toBe(false);
    expect(g({ status: 502, body: '<html>' }).go).toBe(false);
  });
  it('after an upload, the seller must serve this bundle, operational unless it is the first deploy', () => {
    const o = { sha256: seller.configSha256, slug: seller.slug };
    const h = (x: J, status = 200) => ({ status, body: JSON.stringify(x) });
    expect(healthAfter(h({ status: 'operational', seller: 'example-audits', configSha256: seller.configSha256 }), { ...o, first: false })).toEqual({ verdict: 'pass' });
    expect(healthAfter(h({ status: 'operational', seller: 'example-audits', configSha256: 'f'.repeat(64) }), { ...o, first: false }).verdict).toBe('wait');
    expect(healthAfter(h({ status: 'degraded', seller: 'example-audits', configSha256: seller.configSha256, reason: 'set HOLDBACK_KEY' }, 503), { ...o, first: true })).toEqual({ verdict: 'pass' });
    expect(healthAfter(h({ status: 'degraded', seller: 'example-audits', configSha256: seller.configSha256 }, 503), { ...o, first: false }).verdict).toBe('wait');
  });
});

/** Stand-ins for every effect of a deploy; `health` answers each /health read in turn. */
function deployFx(o: { args: string[]; live?: Array<string | null>; health?: Array<{ status: number; body: string }>; upload?: { code: number; out: string } }) {
  const calls: string[] = [];
  const lines: string[] = [];
  const live = [...(o.live ?? [BEFORE])];
  const health = [...(o.health ?? [])];
  let clock = 0;
  const fx: DeployEffects = {
    args: o.args,
    readSeller: (_f, n) => fileOf(n),
    writeGenerated: (_b, config) => (calls.push(`config ${JSON.stringify((config('/tmp/x/bundle.json') as J).name)}`), { bundlePath: '/tmp/x/bundle.json', configPath: '/tmp/x/wrangler.json' }),
    main: '/abs/entry.ts',
    sh: async (cmd, args) => (calls.push(`${cmd} ${args.join(' ')}`), o.upload ?? { code: 0, stdout: '', out: `Current Version ID: ${AFTER}` }),
    checkout: async () => ({ refused: null, commit: 'c'.repeat(40), branch: '' }),
    liveVersion: async () => (live.length > 1 ? live.shift()! : live[0]!),
    rollback: async (name, version) => (calls.push(`rollback ${name} ${version}`), true),
    recordLine: (r) => `record ${r.failure ?? 'pass'}`,
    probe: async (url) => (calls.push(`GET ${url.replace(BASE, '')}`), url.endsWith('/agent.json') ? { status: 200, body: JSON.stringify({ type: 'crow-agent', offers: [{ pricing: { quote: `${BASE}/quote` } }] }) } : (health.shift() ?? { status: 0, body: '' })),
    sleep: async (ms) => void (clock += ms),
    now: () => clock,
    log: (l) => lines.push(l),
    error: (l) => lines.push(`ERR ${l}`),
  };
  return { fx, calls, lines };
}
const ok = (stages: J = {}) => ({ status: 200, body: JSON.stringify({ status: 'operational', seller: 'example-audits', configSha256: seller.configSha256, open: 0, stages }) });
const ARGS = ['--seller', '/private/folder', '--workspace', 'example-workspace'];

describe('deploySeller (T-436), with stand-ins', () => {
  it('refuses an unknown option, a missing folder or workspace, and a workspace that does not match', async () => {
    for (const args of [[...ARGS, '--name', 'x'], ['--workspace', 'example-workspace'], ['--seller', '/f'], ['--seller', '/f', '--workspace', 'other']]) {
      const { fx, calls } = deployFx({ args });
      expect(await deploySeller(fx), args.join(' ')).toBe(2);
      expect(calls.filter((c) => c.startsWith('npx'))).toEqual([]);
    }
  });
  it('a dry run bundles with wrangler and uploads nothing', async () => {
    const { fx, calls } = deployFx({ args: [...ARGS, '--dry-run'] });
    expect(await deploySeller(fx)).toBe(0);
    expect(calls).toEqual(['config "crow-seller-example-audits"', 'npx --yes wrangler@4.151.3 deploy --dry-run --config /tmp/x/wrangler.json']);
  });
  it('a deploy reads the guard, uploads, and passes once the seller serves this bundle and its card', async () => {
    const { fx, calls, lines } = deployFx({ args: ARGS, health: [ok(), { status: 0, body: '' }, ok()] });
    expect(await deploySeller(fx)).toBe(0);
    expect(calls).toEqual(['GET /health', 'config "crow-seller-example-audits"', 'npx --yes wrangler@4.151.3 deploy --config /tmp/x/wrangler.json', 'GET /health', 'GET /health', 'GET /agent.json']);
    expect(lines.join('\n')).toContain('record pass');
  });
  it('refuses while a deal is at starting, before any upload', async () => {
    const { fx, calls, lines } = deployFx({ args: ARGS, health: [ok({ starting: 1 })] });
    expect(await deploySeller(fx)).toBe(2);
    expect(calls).toEqual(['GET /health']);
    expect(lines.join('\n')).toMatch(/Refused: 1 deal is at starting/);
  });
  it('--first refuses a Worker that is already live or a seller that already answers, and the plain deploy one that is not', async () => {
    expect(await deploySeller(deployFx({ args: [...ARGS, '--first'] }).fx)).toBe(2);
    const answering = deployFx({ args: [...ARGS, '--first'], live: [null], health: [ok()] }); // wrangler read no version, but it answers
    expect(await deploySeller(answering.fx)).toBe(2);
    expect(answering.calls.filter((c) => c.startsWith('npx'))).toEqual([]);
    expect(await deploySeller(deployFx({ args: ARGS, live: [null] }).fx)).toBe(2);
  });
  it('a seller that does not answer three reads refuses the deploy before any upload', async () => {
    const { fx, calls, lines } = deployFx({ args: ARGS, health: [{ status: 0, body: '' }, { status: 0, body: '' }, { status: 0, body: '' }] });
    expect(await deploySeller(fx)).toBe(2);
    expect(calls).toEqual(['GET /health', 'GET /health', 'GET /health']);
    expect(lines.join('\n')).toMatch(/does not answer, so the deal guard cannot read its deals\. Nothing was uploaded/);
  });
  it('waits out the deferred code update: a seller on its old bundle for 300 s still passes', async () => {
    const stale = { status: 200, body: JSON.stringify({ status: 'operational', seller: 'example-audits', configSha256: 'f'.repeat(64) }) };
    const { fx } = deployFx({ args: ARGS, live: [BEFORE], health: [ok(), ...Array(61).fill(stale), ok()] }); // 61 reads 5 s apart: 305 s
    expect(await deploySeller(fx)).toBe(0);
  });
  it('a first deploy passes once the seller answers for this bundle, with no secrets yet', async () => {
    const degraded = { status: 503, body: JSON.stringify({ status: 'degraded', seller: 'example-audits', configSha256: seller.configSha256, reason: 'the seller could not start' }) };
    const { fx, calls, lines } = deployFx({ args: [...ARGS, '--first'], live: [null], health: [{ status: 0, body: '' }, degraded] });
    expect(await deploySeller(fx)).toBe(0);
    expect(calls.filter((c) => c.startsWith('GET'))).toEqual(['GET /health', 'GET /health']); // nothing answers before the upload; no card after it
    expect(lines.join('\n')).toContain('run apps/hosted-sellers/scripts/secrets.ts next');
  });
  it('a seller that never serves the new bundle fails the deploy and rolls back to the version before', async () => {
    const stale = { status: 200, body: JSON.stringify({ status: 'operational', seller: 'example-audits', configSha256: 'f'.repeat(64) }) };
    const { fx, calls, lines } = deployFx({ args: ARGS, live: [BEFORE, AFTER], health: [ok(), ...Array(100).fill(stale)] });
    expect(await deploySeller(fx)).toBe(1);
    expect(calls).toContain(`rollback crow-seller-example-audits ${BEFORE}`);
    expect(lines.join('\n')).toContain('record');
  });
});

/** Stand-ins for every effect of setting the secrets. */
function secretsFx(o: { args?: string[]; existing?: string[]; stdin?: string; dir?: { ok: true } | { ok: false; why: string }; bulk?: number; health?: J; there?: string[] } = {}) {
  const files: Record<string, string> = {};
  const lines: string[] = [];
  const sent: Array<{ args: string[]; input?: string }> = [];
  let n = 0;
  const fx: SecretsEffects = {
    args: o.args ?? ['--seller', '/private/folder', '--credentials-out', '/private/out'],
    readSeller: (_f, name) => fileOf(name),
    probe: async () => (o.health === undefined ? { status: 0, body: '' } : { status: 200, body: JSON.stringify(o.health) }),
    fileExists: (_d, name) => (o.there ?? []).includes(name) || Object.hasOwn(files, name),
    stdin: async () => o.stdin ?? 'the-company-api-key\n',
    privateDir: () => o.dir ?? { ok: true },
    writeSecretFile: (_d, name, text) => void (files[name] = text),
    newSigningKey: () => ({ key: `0x${'ab'.repeat(32)}`, address: '0x1111111111111111111111111111111111111111' }),
    newCredential: () => `generated-credential-${++n}`,
    sh: async (_cmd, args, opts) => {
      sent.push({ args, ...(opts?.input === undefined ? {} : { input: opts.input }) });
      if (args.includes('list')) return { code: 0, stdout: JSON.stringify((o.existing ?? []).map((name) => ({ name, type: 'secret_text' }))), out: '' };
      return { code: o.bulk ?? 0, stdout: '', out: '' };
    },
    log: (l) => lines.push(l),
    error: (l) => lines.push(`ERR ${l}`),
  };
  return { fx, files, lines, sent };
}

describe('setSecrets (T-436), with stand-ins', () => {
  it('sets the signing key, the API key from standard input and fresh credentials in one bulk call, and prints no secret', async () => {
    const { fx, files, lines, sent } = secretsFx();
    expect(await setSecrets(fx)).toBe(0);
    const bulk = sent.find((s) => s.args.includes('bulk'))!;
    expect(bulk.args).toEqual(['--yes', 'wrangler@4.151.3', 'secret', 'bulk', '--name', 'crow-seller-example-audits']);
    expect(JSON.parse(bulk.input!)).toEqual({ HOLDBACK_KEY: `0x${'ab'.repeat(32)}`, JOBS_API_KEY: 'the-company-api-key', QUOTE_CREDENTIALS: 'generated-credential-1', READY_CREDENTIALS: 'generated-credential-2' });
    expect(files).toEqual({ 'example-audits.quote.credential': 'generated-credential-1\n', 'example-audits.ready.credential': 'generated-credential-2\n' });
    const shown = lines.join('\n');
    for (const secret of ['ab'.repeat(32), 'the-company-api-key', 'generated-credential-1', 'generated-credential-2']) expect(shown).not.toContain(secret);
    expect(shown).toContain('The seller signs as 0x1111111111111111111111111111111111111111');
  });
  it('refuses secrets that are already set, unless --replace; a directory that is not private; and an empty API key', async () => {
    const already = secretsFx({ existing: ['HOLDBACK_KEY'] });
    expect(await setSecrets(already.fx)).toBe(2);
    expect(already.sent.some((s) => s.args.includes('bulk'))).toBe(false);
    expect(already.lines.join('\n')).toMatch(/already has HOLDBACK_KEY/);
    expect(await setSecrets(secretsFx({ existing: ['HOLDBACK_KEY'], args: ['--seller', '/f', '--credentials-out', '/o', '--replace'] }).fx)).toBe(0);
    expect(await setSecrets(secretsFx({ dir: { ok: false, why: '/o is inside a git checkout' } }).fx)).toBe(2);
    const empty = secretsFx({ stdin: '' });
    expect(await setSecrets(empty.fx)).toBe(2);
    expect(Object.keys(empty.files)).toEqual([]);
  });
  it('--replace waits for a seller with no open deal, and a credential file already there refuses before any is written', async () => {
    const busy = secretsFx({ existing: ['HOLDBACK_KEY'], args: ['--seller', '/f', '--credentials-out', '/o', '--replace'], health: { status: 'operational', seller: 'example-audits', open: 2 } });
    expect(await setSecrets(busy.fx)).toBe(2);
    expect(busy.lines.join('\n')).toMatch(/has 2 open deals/);
    expect(await setSecrets(secretsFx({ existing: ['HOLDBACK_KEY'], args: ['--seller', '/f', '--credentials-out', '/o', '--replace'], health: { status: 'operational', seller: 'example-audits', open: 0 } }).fx)).toBe(0);
    const clash = secretsFx({ there: ['example-audits.ready.credential'] });
    expect(await setSecrets(clash.fx)).toBe(2);
    expect(Object.keys(clash.files)).toEqual([]); // the quote credential, first in line, was not written either
    expect(clash.sent.some((s) => s.args.includes('bulk'))).toBe(false);
  });

  it('a refused bulk call sets nothing and says the credential files are not in use', async () => {
    const { fx, lines } = secretsFx({ bulk: 1 });
    expect(await setSecrets(fx)).toBe(1);
    expect(lines.join('\n')).toMatch(/nothing was set/);
  });
});

describe('the bundle (T-436 red team)', () => {
  it('refuses one variable for two credentials, so a generated one never overwrites the API key', () => {
    const c = { ...JSON.parse(fileOf('adapter.json')!), quoteAuth: { kind: 'bearer', env: 'JOBS_API_KEY' } };
    expect(() => checkBundle({ ...bundle, config: c })).toThrow('names one variable for two credentials');
  });
});
