// The real effects for the hosted seller's deploy and secrets scripts (T-436): the shell, the files, the network and
// the clock. The decisions are in src/deploy-plan.ts, tested with stand-ins for all of these.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { HostedBundle } from '../src/bundle.ts';
import type { Shell } from '../src/deploy-plan.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Runs a command from the repository root; `input` goes to its standard input, and is never shown. */
export const shell: Shell = (cmd, args, { show = true, env = {}, timeoutMs = 600_000, input } = {}) =>
  new Promise((done) => {
    let stdout = '';
    let out = '';
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, FORCE_COLOR: '0', ...env }, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout!.on('data', (d) => ((stdout += d), (out += d), show && process.stdout.write(d)));
    child.stderr!.on('data', (d) => ((out += d), show && process.stderr.write(d)));
    child.on('error', (e) => ((out += e.message), clearTimeout(timer), done({ code: 1, stdout, out })));
    child.on('close', (code, signal) => (clearTimeout(timer), done({ code: signal ? null : code, stdout, out })));
    if (input !== undefined) child.stdin!.end(input);
  });

/** A file of the seller's folder, or undefined. A symbolic link is refused: it could pull in a file from elsewhere. */
export const readSeller = (folder: string, name: string): string | undefined => {
  const p = join(resolve(folder), name);
  if (!existsSync(p)) return undefined;
  if (lstatSync(p).isSymbolicLink() || !lstatSync(p).isFile()) throw new Error(`${name} in the seller's folder is a link or not a plain file`);
  return readFileSync(p, 'utf8');
};

export const fileExists = (dir: string, name: string) => existsSync(join(dir, name));

/** The generated bundle and Wrangler configuration, in a new directory only this user can read, outside the repository. */
export function writeGenerated(bundle: HostedBundle, config: (bundlePath: string) => Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), `crow-seller-${String(bundle.slug).replace(/[^a-z0-9-]/g, '')}-`));
  const bundlePath = join(dir, 'bundle.json');
  const configPath = join(dir, 'wrangler.json');
  writeFileSync(bundlePath, JSON.stringify(bundle), { mode: 0o600 });
  writeFileSync(configPath, JSON.stringify(config(bundlePath), null, 2), { mode: 0o600 });
  return { bundlePath, configPath };
}

export const main = fileURLToPath(new URL('../src/entry.ts', import.meta.url));

/** One GET, never followed past a redirect: its status and body, or status 0 with no answer in time. */
export async function probe(url: string, timeoutMs: number) {
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    return { status: r.status, body: await r.text() };
  } catch {
    return { status: 0, body: '' };
  }
}

/** A directory that exists, that only its owner can read, and that no git checkout holds. */
export function privateDir(dir: string): { ok: true } | { ok: false; why: string } {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return { ok: false, why: `${dir} is not a directory: make it with mkdir -m 700` };
  if ((statSync(dir).mode & 0o077) !== 0) return { ok: false, why: `${dir} can be read by others: chmod 700 it` };
  const git = spawnSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (git.status === 0 && git.stdout.trim() === 'true') return { ok: false, why: `${dir} is inside a git checkout: a credential there could be committed. Choose a directory outside every repository` };
  return { ok: true };
}

export function writeSecretFile(dir: string, name: string, text: string): void {
  writeFileSync(join(dir, name), text, { mode: 0o600, flag: 'wx' });
}

export function newSigningKey() {
  const key = generatePrivateKey();
  return { key, address: privateKeyToAccount(key).address };
}

export const newCredential = () => randomBytes(32).toString('hex');

export async function stdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
