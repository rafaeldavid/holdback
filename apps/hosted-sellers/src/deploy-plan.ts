// A hosted seller's deploy and secrets (T-436), without their effects: scripts/deploy.ts and scripts/secrets.ts pass
// in the shell, the network, the files and the clock, so a test runs every path with stand-ins (deploy.test.ts).
//
// A seller lives in a private folder, never in this repository:
//   hosted.json   {"slug": "<slug>", "card": {"name", "item", "description"?}}
//   adapter.json  the adapter configuration (examples/seller-adapter.config.json's shape); `template` and
//                 `reportMapping` name files in this folder
//   the files adapter.json names
// The deploy builds the seller's bundle from that folder (bundle.ts), writes a Wrangler configuration for its own
// Worker, crow-seller-<slug>, and checks the live seller before and after. The secrets are set once, by secrets.ts:
// a fresh signing key, the company's API key from standard input, and fresh quote and ready credentials written
// to files outside any repository. Nothing here prints a secret.
import { checkBundle, type HostedBundle, type HostedSeller } from './bundle.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const ZONE = 'crow.direct';
export const OPERATORS = 'https://api.crow.direct,https://api2.crow.direct';
/** Wrangler's version for every hosted-seller command: pinned, as the console's deploy pins it. */
export const WRANGLER = ['--yes', 'wrangler@4.151.3'];
/** The seller has this long after an upload to answer its health and card. */
export const CHECK_TIMEOUT_MS = 120_000;
export const POLL_MS = 5_000;

export const workerName = (slug: string) => `crow-seller-${slug}`;
export const sellerUrl = (slug: string) => `https://${ZONE}/agents/${slug}`;
/** Text from the network, made safe for one console line and the Markdown record. */
const plainLine = (text: unknown) => String(text).replace(/[^A-Za-z0-9 .,:;'()/_-]+/g, ' ').replace(/ +/g, ' ').trim().slice(0, 200);

/** A file name the configuration may give: one name in the seller's folder, no path. */
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Reads a seller's folder into its bundle. `read` returns a file's text, or undefined when there is none. */
export function readSellerFolder(read: (name: string) => string | undefined): HostedBundle {
  const json = (name: string): J => {
    const text = read(name);
    if (text === undefined) throw new Error(`the seller's folder has no ${name}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${name} in the seller's folder is not JSON`);
    }
  };
  const hosted = json('hosted.json');
  const config = json('adapter.json');
  const files: Record<string, string> = {};
  for (const field of ['template', 'reportMapping']) {
    const name = config?.[field];
    if (name === undefined) continue;
    if (typeof name !== 'string' || !FILE_NAME.test(name)) throw new Error(`adapter.json: ${field} must name one file in the seller's folder, with no path`);
    const text = read(name);
    if (text === undefined) throw new Error(`adapter.json: ${field} names ${name}, and the seller's folder has no such file`);
    files[name] = text;
  }
  return { slug: hosted?.slug, card: hosted?.card, config, files };
}

/** The Wrangler configuration of the seller's own Worker. `main` and `bundlePath` are absolute paths. */
export function wranglerConfig(s: HostedSeller, o: { main: string; bundlePath: string; commit: string }): Record<string, unknown> {
  return {
    name: workerName(s.slug),
    main: o.main,
    compatibility_date: '2025-09-15',
    // process.env stays empty: no module the Worker imports reads a variable or a secret (T-435 review).
    compatibility_flags: ['nodejs_compat', 'nodejs_compat_do_not_populate_process_env', 'disallow_importable_env'],
    workers_dev: false,
    preview_urls: false,
    // Two patterns, not "<slug>*": a seller named "acme" never takes "acme-two"'s paths.
    routes: [
      { pattern: `${ZONE}/agents/${s.slug}`, zone_name: ZONE },
      { pattern: `${ZONE}/agents/${s.slug}/*`, zone_name: ZONE },
    ],
    alias: { 'crow-hosted-seller-bundle': o.bundlePath },
    vars: { OPERATOR_URLS: OPERATORS, SELLER_URL: sellerUrl(s.slug), ...(/^[0-9a-f]{40}$/.test(o.commit) ? { BUILD_COMMIT: o.commit } : {}) },
    durable_objects: {
      bindings: [{ name: 'SELLER', class_name: 'HostedSeller' }],
      // An active object keeps its code for up to 300 s after a deploy, so a step in progress can finish (ADR-0037 §6).
      code_update_strategy: { mode: 'deferred', max_delay: 300 },
    },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['HostedSeller'] }],
    // The adapter's own lines only: invocation logs would record each caller's IP address.
    observability: { enabled: true, logs: { invocation_logs: false } },
  };
}

/**
 * Whether the deploy may go on for this workspace. `flag` is what Rafa typed after --workspace: the account the
 * configuration must pin, or "none" for a seller whose API has no accounts. The hosted form of the kit's guard.
 */
export function workspaceRefusal(s: HostedSeller, flag: string | undefined): string | null {
  const pinned: unknown = (s.config.sellerApi as J)?.workspace?.id;
  if (flag === undefined) return 'name the account the jobs run in: --workspace <id>, or --workspace none for an API with no accounts';
  if (flag === 'none') return pinned === undefined ? null : 'the configuration pins an account (sellerApi.workspace), and --workspace says none: check the folder';
  if (pinned === undefined) return 'the configuration pins no account (sellerApi.workspace), and --workspace names one: add it to adapter.json';
  return pinned === flag ? null : 'the configuration pins another account than --workspace names: nothing was deployed';
}

/** A /health answer, read: the seller's JSON, or why there is none. */
function parsed(answer: { status: number; body: string }): J | undefined {
  try {
    const v = JSON.parse(answer.body);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The deal guard (ADR-0037 §6): a deploy waits while a deal is at `starting`, between "the hold is funded" and "the
 * job has an ID", when a reset could lose the start's answer. A seller that cannot start runs no start, so a
 * degraded or silent one does not hold the deploy up: the deploy may be its fix.
 */
export function dealGuard(answer: { status: number; body: string }): { go: true; note: string } | { go: false; why: string } {
  const h = parsed(answer);
  if (answer.status === 200 && h?.status === 'operational') {
    const starting = Number(h.stages?.starting ?? 0);
    if (starting > 0) return { go: false, why: `${starting} deal${starting === 1 ? ' is' : 's are'} at starting: a deploy now could lose a start's answer. Wait a minute and run the deploy again.` };
    return { go: true, note: `the live seller reads operational with ${Number(h.open ?? 0)} open deals, none at starting` };
  }
  return { go: true, note: answer.status === 0 ? 'the live seller does not answer: it runs no start now' : `the live seller answers ${answer.status}${h?.reason ? ` (${plainLine(h.reason)})` : ''}: it runs no start now` };
}

/**
 * What one /health answer after an upload means. A first deploy has no secrets yet, so it passes once the seller
 * answers for this bundle, degraded or not; any other passes when the seller reads operational for this bundle.
 */
export function healthAfter(answer: { status: number; body: string }, o: { sha256: string; slug: string; first: boolean }): { verdict: 'pass' } | { verdict: 'wait' | 'fail'; why: string } {
  const h = parsed(answer);
  if (!h) return { verdict: 'wait', why: answer.status === 0 ? 'no answer' : `HTTP ${answer.status}, and the body is not JSON` };
  if (h.seller !== o.slug || h.configSha256 !== o.sha256) return { verdict: 'wait', why: `the seller does not serve this bundle yet (configSha256 ${plainLine(h.configSha256 ?? 'none').slice(0, 12)})` };
  if (o.first) return { verdict: 'pass' };
  if (h.status === 'operational') return { verdict: 'pass' };
  return { verdict: 'wait', why: `the seller reads ${plainLine(h.status)}${h.reason ? `: ${plainLine(h.reason)}` : ''}` };
}

/** The secrets a seller needs, by name. `apiVar` is the one Rafa types; every other is generated in memory. */
export function secretPlan(s: HostedSeller): { signing: 'HOLDBACK_KEY'; apiVar: string | undefined; generated: Array<{ name: string; file: string }> } {
  const c = s.config as J;
  const apiVar: string | undefined = c.sellerApi?.auth?.env;
  const generated: Array<{ name: string; file: string }> = [];
  if (c.quoteAuth?.env) generated.push({ name: c.quoteAuth.env, file: `${s.slug}.quote.credential` });
  if (c.redelivery?.readyAuth?.env) generated.push({ name: c.redelivery.readyAuth.env, file: `${s.slug}.ready.credential` });
  if (c.alerts?.secretEnv) generated.push({ name: c.alerts.secretEnv, file: `${s.slug}.alert.secret` });
  return { signing: 'HOLDBACK_KEY', apiVar, generated };
}

export { checkBundle };

// ---- The runs, with their effects passed in ----

export interface Shell {
  (cmd: string, args: string[], o?: { show?: boolean; env?: Record<string, string>; timeoutMs?: number; input?: string }): Promise<{ code: number | null; stdout: string; out: string }>;
}

export interface DeployEffects {
  args: string[];
  /** Reads a file of the seller's folder, or undefined when there is none. */
  readSeller(folder: string, name: string): string | undefined;
  /** Writes the generated bundle and configuration to a new private directory; returns their paths. */
  writeGenerated(bundle: HostedBundle, config: (bundlePath: string) => Record<string, unknown>): { bundlePath: string; configPath: string };
  /** apps/hosted-sellers/src/entry.ts, absolute. */
  main: string;
  sh: Shell;
  checkout(command: string): Promise<{ refused: string | null; commit: string; branch: string }>;
  liveVersion(name: string): Promise<string | null>;
  rollback(name: string, version: string, message: string): Promise<boolean>;
  recordLine(o: { title: string; startedAt: Date; commit: string; branch?: string; failure: string | null; workers: Array<{ name: string; version?: string | null; before?: string | null; rolledBack?: boolean }> }): string;
  probe(url: string, timeoutMs: number): Promise<{ status: number; body: string }>;
  sleep(ms: number): Promise<void>;
  now(): number;
  log(line: string): void;
  error(line: string): void;
}

const COMMAND = 'node apps/hosted-sellers/scripts/deploy.ts';

/** Reads `--name value` pairs and bare flags. Anything it does not know is refused, so nothing reaches wrangler unchecked. */
function options(args: string[], valued: string[], bare: string[]): { values: Record<string, string>; flags: Set<string>; refused: string | null } {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (valued.includes(a) && args[i + 1] !== undefined && !args[i + 1]!.startsWith('--')) values[a] = args[++i]!;
    else if (bare.includes(a)) flags.add(a);
    else return { values, flags, refused: `Refused: ${a.slice(0, 40)} is not an option here (it takes ${[...valued.map((v) => `${v} <value>`), ...bare].join(', ')})` };
  }
  return { values, flags, refused: null };
}

/**
 * Deploys one hosted seller, or checks it (`--check-only`):
 *   1. build and check the bundle from `--seller <folder>`, and the account against `--workspace`;
 *   2. pre-flight: a clean checkout that holds origin/main;
 *   3. the live version, the rollback target; `--first` for a Worker that has none yet, refused otherwise;
 *   4. the deal guard: no deal at starting on the live seller;
 *   5. upload with `wrangler deploy` from the generated configuration;
 *   6. every 5 s for at most 120 s, read /health until it serves this bundle (operational, unless `--first`), then
 *      /agent.json until it is JSON (not on a first deploy, which has no signing key yet);
 *   7. on a refused upload or a failed check, roll back when the live version changed; print the record line.
 * `--dry-run`: steps 1 and 5 only, with Wrangler's own dry run. Returns the exit code: 0 pass, 1 fail, 2 refused.
 */
export async function deploySeller(fx: DeployEffects): Promise<number> {
  const { values, flags, refused: bad } = options(fx.args, ['--seller', '--workspace'], ['--first', '--dry-run', '--check-only']);
  if (bad) return fx.error(bad), 2;
  const folder = values['--seller'];
  if (!folder) return fx.error('Refused: name the seller\'s private folder: --seller <folder>'), 2;
  let bundle: HostedBundle;
  let s: HostedSeller;
  try {
    bundle = readSellerFolder((name) => fx.readSeller(folder, name));
    s = checkBundle(bundle);
  } catch (e) {
    return fx.error(`Refused: ${(e as Error).message}`), 2;
  }
  const ws = workspaceRefusal(s, values['--workspace']);
  if (ws) return fx.error(`Refused: ${ws}`), 2;
  const name = workerName(s.slug);
  const base = sellerUrl(s.slug);
  fx.log(`Seller ${s.slug}: Worker ${name} at ${base}, bundle SHA-256 ${s.configSha256}.`);
  if (flags.has('--dry-run')) {
    const gen = fx.writeGenerated(bundle, (bundlePath) => wranglerConfig(s, { main: fx.main, bundlePath, commit: '' }));
    const r = await fx.sh('npx', [...WRANGLER, 'deploy', '--dry-run', '--config', gen.configPath]);
    return r.code === 0 ? 0 : (r.code ?? 1);
  }
  const first = flags.has('--first');
  const startedAt = new Date(fx.now());
  let before: string | null = null;
  let version: string | null = null;
  let uploaded = false;
  let failure: string | null = null;
  let rolledBack: boolean | undefined;
  let commit = '';
  let branch = '';
  const fail = (why: string): never => {
    throw new Error(why);
  };
  try {
    if (!flags.has('--check-only')) {
      const c = await fx.checkout(COMMAND);
      if (c.refused) return fx.error(c.refused), 2;
      commit = c.commit;
      branch = c.branch;
      before = await fx.liveVersion(name);
      if (first && before !== null) return fx.error(`Refused: ${name} already serves \`${before}\`; run the deploy without --first`), 2;
      if (!first && before === null) return fx.error(`Refused: wrangler reads no live version of ${name}. If it was never deployed, run the deploy with --first; otherwise log wrangler in and try again`), 2;
      if (!first) {
        const guard = dealGuard(await fx.probe(`${base}/health`, 10_000));
        if (!guard.go) return fx.error(`Refused: ${guard.why}`), 2;
        fx.log(`The deal guard: ${guard.note}.`);
      }
      const gen = fx.writeGenerated(bundle, (bundlePath) => wranglerConfig(s, { main: fx.main, bundlePath, commit }));
      fx.log(before ? `${name} serves \`${before}\` now: the rollback target. Uploading.` : `${name} has never been deployed. Uploading its first version.`);
      uploaded = true;
      const r = await fx.sh('npx', [...WRANGLER, 'deploy', '--config', gen.configPath]);
      version = /Current Version ID:\s*([0-9a-f-]{36})/.exec(r.out)?.[1] ?? null;
      if (r.code !== 0 || !version) fail(`${name}'s upload was refused`);
      fx.log(`Uploaded \`${version}\`. Reading ${base}/health every ${POLL_MS / 1000} s, for at most ${CHECK_TIMEOUT_MS / 1000} s.`);
    }
    const deadline = fx.now() + CHECK_TIMEOUT_MS;
    for (;;) {
      let pending: string;
      const health = healthAfter(await fx.probe(`${base}/health`, 10_000), { sha256: s.configSha256, slug: s.slug, first });
      if (health.verdict === 'pass') {
        if (first) break;
        const card = await fx.probe(`${base}/agent.json`, 10_000);
        const c = parsed(card);
        if (card.status === 200 && c?.type === 'crow-agent' && c?.offers?.[0]?.pricing?.quote === `${base}/quote`) break;
        pending = `${base}/agent.json did not answer with this seller's card (last answer: HTTP ${card.status})`;
      } else {
        if (health.verdict === 'fail') fail(health.why);
        pending = `${base}/health did not pass within ${CHECK_TIMEOUT_MS / 1000} s (last answer: ${health.why})`;
      }
      if (fx.now() + POLL_MS > deadline) fail(pending);
      await fx.sleep(POLL_MS);
    }
    fx.log(first ? `The seller answers for this bundle. It has no secrets yet: run apps/hosted-sellers/scripts/secrets.ts next.` : 'The seller reads operational for this bundle and serves its card.');
  } catch (e) {
    failure = (e as Error).message;
    fx.error(`FAIL: ${failure}`);
    if (uploaded && before !== null) {
      const now = await fx.liveVersion(name);
      if (now !== before) {
        rolledBack = await fx.rollback(name, before, 'apps/hosted-sellers/scripts/deploy.ts failed a check');
        if (!rolledBack) fx.error(`ROLLBACK FAILED for ${name}: roll back to ${before} with wrangler`);
      }
    }
  }
  if (!flags.has('--check-only')) fx.log(`\nThe record line for docs/operations.md:\n\n${fx.recordLine({ title: `Hosted seller ${s.slug} deploy`, startedAt, commit, branch, failure, workers: [{ name, version, before, ...(rolledBack === undefined ? {} : { rolledBack }) }] })}\n`);
  return failure ? 1 : 0;
}

export interface SecretsEffects {
  args: string[];
  readSeller(folder: string, name: string): string | undefined;
  /** Standard input, whole: the company's API key, typed at a hidden prompt and piped in. */
  stdin(): Promise<string>;
  /** Whether a directory exists, outside every git checkout, and only its owner can read it. */
  privateDir(dir: string): { ok: true } | { ok: false; why: string };
  /** Writes one file, mode 0600, refusing to overwrite. */
  writeSecretFile(dir: string, name: string, text: string): void;
  newSigningKey(): { key: string; address: string };
  newCredential(): string;
  sh: Shell;
  log(line: string): void;
  error(line: string): void;
}

/**
 * Sets a hosted seller's secrets on its Worker, once (`--replace` to make new ones):
 *   HOLDBACK_KEY      a fresh signing key, generated here and never shown; only its address is printed;
 *   the API key       the variable `sellerApi.auth.env` names, read from standard input;
 *   the credentials   fresh values for `quoteAuth.env`, `redelivery.readyAuth.env` and `alerts.secretEnv`, written
 *                     to files in `--credentials-out <dir>`, a private directory outside every repository.
 * They go to `wrangler secret bulk` on standard input, in one call. Returns 0 when set, 2 when refused, else 1.
 */
export async function setSecrets(fx: SecretsEffects): Promise<number> {
  const { values, flags, refused: bad } = options(fx.args, ['--seller', '--credentials-out'], ['--replace']);
  if (bad) return fx.error(bad), 2;
  const folder = values['--seller'];
  const out = values['--credentials-out'];
  if (!folder || !out) return fx.error('Refused: name the seller\'s private folder and where the credentials go: --seller <folder> --credentials-out <private directory>'), 2;
  let s: HostedSeller;
  try {
    s = checkBundle(readSellerFolder((name) => fx.readSeller(folder, name)));
  } catch (e) {
    return fx.error(`Refused: ${(e as Error).message}`), 2;
  }
  const where = fx.privateDir(out);
  if (!where.ok) return fx.error(`Refused: ${where.why}`), 2;
  const name = workerName(s.slug);
  const plan = secretPlan(s);
  const wanted = [plan.signing, ...(plan.apiVar ? [plan.apiVar] : []), ...plan.generated.map((g) => g.name)];
  const list = await fx.sh('npx', [...WRANGLER, 'secret', 'list', '--name', name, '--format', 'json'], { show: false });
  if (list.code !== 0) return fx.error(`wrangler secret list failed (exit ${list.code}): log wrangler in, and deploy ${name} once with --first`), 1;
  let have: string[];
  try {
    have = (JSON.parse(list.stdout.slice(list.stdout.indexOf('['))) as Array<{ name: string }>).map((x) => x.name);
  } catch {
    return fx.error('wrangler secret list did not answer JSON'), 1;
  }
  const present = wanted.filter((w) => have.includes(w));
  if (present.length && !flags.has('--replace')) return fx.error(`Refused: ${name} already has ${present.join(', ')}. A new signing key gives the seller a new address, and open deals keep the old one: pass --replace only when no deal is open`), 2;
  let apiKey: string | undefined;
  if (plan.apiVar) {
    apiKey = (await fx.stdin()).replace(/\r?\n$/, '');
    if (!apiKey || /[\0-\x1f\x7f]/.test(apiKey)) return fx.error(`Refused: standard input holds no API key for ${plan.apiVar}, or one with a control character. Nothing was set`), 2;
  }
  const signing = fx.newSigningKey();
  const generated = plan.generated.map((g) => ({ ...g, value: fx.newCredential() }));
  const secrets: Record<string, string> = { [plan.signing]: signing.key, ...(plan.apiVar ? { [plan.apiVar]: apiKey! } : {}), ...Object.fromEntries(generated.map((g) => [g.name, g.value])) };
  // The files first: a credential the buyer needs is never set on the Worker without a copy for Rafa.
  for (const g of generated) fx.writeSecretFile(out, g.file, `${g.value}\n`);
  const r = await fx.sh('npx', [...WRANGLER, 'secret', 'bulk', '--name', name], { input: JSON.stringify(secrets) });
  if (r.code !== 0) return fx.error(`wrangler secret bulk exited with ${r.code}: nothing was set. The credential files in ${out} are not in use; delete them`), 1;
  fx.log(`Set ${Object.keys(secrets).join(', ')} on ${name}.`);
  fx.log(`The seller signs as ${signing.address}; its payout address is the configuration's (payoutAddress).`);
  for (const g of generated) fx.log(`${g.name}: written to ${out}/${g.file} (mode 0600).`);
  return 0;
}
