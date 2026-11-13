// The world a duet runs in (T-391). Locally: the phase-one sim world (SimChain, two operators, three test
// adjudicators), started in this process with every key kept private. Or a world already running, named by its
// operators (`--world`), which is how the same command later runs against Sepolia. Either way the runner adds:
//   - a small web: the agent docs (llms.txt and sell.txt, with this world's operators filled in, when run locally) and
//     the seller's own public page, served from the seller's folder;
//   - the seller's job API: examples/seller-adapter-stub.ts, the repository's audit-report stub, unchanged.
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, resolve, sep } from 'node:path';
import { startStubSellerApi, type StubSellerApi } from '../../examples/seller-adapter-stub.ts';
import type { Recorder } from './record.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface World {
  /** The operators as they are. */
  operators: string[];
  /** The docs both agents are pointed to. */
  docs: { guide: string; sell: string; buy: string };
  /** What the runner changed in the docs it serves, in plain words: empty for a running world's own docs. */
  docsChanges: string[];
  /** The engine, as a person should read it: the local simulator, or the chain by name and ID. */
  engine: string;
  /** The web's base URL; the seller's page is `${web}/sellers/<name>/`. */
  web: string;
  jobApi: StubSellerApi;
  /** The settlement layer's chain ID, from discovery. */
  chainId: number;
  /** The token ID discovery names (`demo.token.id`). */
  token: string;
  local: boolean;
  close(): Promise<void>;
}

const listen = (s: Server): Promise<string> =>
  new Promise((ok, fail) => {
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${(s.address() as AddressInfo).port}`));
  });
const closeServer = (s: Server) => new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()); });

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };

/**
 * The web: the docs, and each seller's public folder at /sellers/<name>/. A seller's page is the files it wrote in
 * `public/` of its own folder, served read-only: GET only, no link followed, nothing outside that folder.
 */
async function web(o: { docs?: { guide: string; sell: string; home?: string; notFound?: string; pages?: Record<string, string> }; sellers: Record<string, string> }): Promise<{ url: string; server: Server }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, type: string, text: string | Buffer) => res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }).end(text);
    if (req.method !== 'GET') return send(405, 'text/plain', 'GET only');
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://web.invalid').pathname);
    if ((path === '/' || path === '/index.html') && o.docs?.home) return send(200, TYPES['.html']!, o.docs.home);
    if (path === '/llms.txt' && o.docs) return send(200, TYPES['.txt']!, o.docs.guide);
    if (path === '/sell.txt' && o.docs) return send(200, TYPES['.txt']!, o.docs.sell);
    if (o.docs?.pages && Object.hasOwn(o.docs.pages, path.slice(1))) return send(200, TYPES['.txt']!, o.docs.pages[path.slice(1)]!);
    const m = /^\/sellers\/([a-z0-9-]+)(?:\/(.*))?$/.exec(path); // with or without the trailing slash
    const root = m ? o.sellers[m[1]!] : undefined;
    // A miss on the site gets the site's own 404 page (site/404.html), as crow.direct answers it.
    if (!m && o.docs?.notFound) return send(404, TYPES['.html']!, o.docs.notFound);
    if (!m || !root) return send(404, 'text/plain', 'not found');
    const file = resolve(root, m[2] || 'index.html');
    if (!file.startsWith(root + sep) || !existsSync(file)) return send(404, 'text/plain', 'not found');
    const real = realpathSync(file);
    if (!real.startsWith(realpathSync(root) + sep) || lstatSync(file).isSymbolicLink() || !lstatSync(real).isFile()) return send(404, 'text/plain', 'not found');
    return send(200, TYPES[extname(file)] ?? 'application/octet-stream', readFileSync(real));
  });
  return { url: await listen(server), server };
}

/**
 * The agent docs exactly as the site publishes them (site/build.mjs: editor notes left out, the one-command try filled
 * in), with one change: this world's operators in place of the public ones. Every stall is then a finding about the
 * real docs. The change is listed in the record's header.
 */
export async function localGuide(operators: string[]): Promise<{ guide: string; sell: string; home: string; notFound: string; pages: Record<string, string>; changes: string[] }> {
  const build: string = '../../site/build.mjs'; // plain JavaScript with no declarations: its three functions are typed here
  const site = (await import(build)) as { strip(md: string): string; tryCommand(): string; sellerPage(txt: string): string; guidePage(txt: string, name: string): string };
  const listing: string = '../../site/guides.mjs';
  const guides = (await import(listing)) as { guideFiles(): string[]; guideSource(path: string): string };
  const pages = Object.fromEntries(guides.guideFiles().filter((p) => p !== 'llms.txt').map((p) => [p, site.guidePage(guides.guideSource(p), p)]));
  const guide = site.strip(readFileSync(new URL('../../site/llms.txt', import.meta.url), 'utf8')).replace('{{OP1}}', operators[0]!).replace('{{OP2}}', operators[1] ?? operators[0]!).replace('{{TRY_COMMAND}}', () => site.tryCommand());
  if (/\{\{[A-Z0-9_]+\}\}/.test(guide)) throw new Error('site/llms.txt has a placeholder the published build does not fill');
  const sell = site.sellerPage(readFileSync(new URL('../../site/sell.txt', import.meta.url), 'utf8'));
  const home = readFileSync(new URL('../../site/index.html', import.meta.url), 'utf8');
  const notFound = readFileSync(new URL('../../site/404.html', import.meta.url), 'utf8');
  return { guide, sell, home, notFound, pages, changes: [`llms.txt: OP1 and OP2 name this world's operators (${operators.slice(0, 2).join(', ')}) in place of the public test service's; nothing else differs from the published file`, 'buy.txt, sell.txt and ref/*.txt: as published, unchanged'] };
}

/** The engine in plain words. A simulator run must never read as a testnet run. */
export const engineOf = (local: boolean, chainId: number): string => (local ? `the local simulator, phase-one rules (SimChain, chain ${chainId})` : chainId === 11155111 ? 'Ethereum Sepolia, a public test network (chain 11155111)' : `the chain with ID ${chainId}, a test network`);

export const PUBLIC_DOCS = { guide: 'https://crow.direct/llms.txt', sell: 'https://crow.direct/sell.txt', buy: 'https://crow.direct/buy.txt' } as const;

export interface WorldOptions {
  rec: Recorder;
  /** Operators of a running world; left out, a local phase-one world starts here. */
  world?: string[];
  /** The docs to point agents to, for a running world. Default: the public site's. */
  docs?: { guide: string; sell: string };
  /** The seller's public folder, served at /sellers/<sellerName>/. */
  sellerPublic: string;
  sellerName: string;
  /** What the job API returns: a report the checks pass, or one that leaves out the last file in scope. */
  report: 'ok' | 'missing-file';
  /** Called with the world's own secrets, so they are scrubbed everywhere. */
  onSecret(v: string): void;
}

export async function startWorld(o: WorldOptions): Promise<World> {
  const closers: Array<() => Promise<void>> = [];
  let operators = o.world;
  let local = false;
  if (!operators) {
    const { startSimWorld } = await import('../../apps/operator/dist/index.js');
    const sim = await startSimWorld({ profile: 'phase_one', publishSecrets: false, port: 0, operatorPorts: [0, 0], onError: (e: Error) => o.rec.add('runner', 'world.error', { error: e.message }) });
    if (sim.keySecret) o.onSecret(sim.keySecret);
    for (const a of sim.info.accounts) { o.onSecret(a.privateKey); o.onSecret(a.encryptionSecretKey); }
    operators = [...sim.info.operators];
    local = true;
    closers.push(() => sim.close());
  }
  try {
    return await rest(o, operators, local, closers);
  } catch (e) {
    for (const c of closers.reverse()) await c().catch(() => undefined);
    throw e;
  }
}

async function rest(o: WorldOptions, operators: string[], local: boolean, closers: Array<() => Promise<void>>): Promise<World> {
  const discovery: J = await (await fetch(`${operators[0]}/.well-known/holdback.json`, { signal: AbortSignal.timeout(30_000) })).json();
  const chainId = Number(discovery?.domain?.chainId ?? 0);
  // No real money: the repository's one list of mainnet chain IDs, and a world that names no chain, are refused.
  const { MAINNET_CHAIN_IDS } = (await import('../../packages/core/dist/chains.js')) as { MAINNET_CHAIN_IDS: readonly number[] };
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('the world\'s discovery names no chain ID: duet runs only where it can see the chain is a test chain');
  if (MAINNET_CHAIN_IDS.includes(chainId)) throw new Error(`the world names chain ${chainId}, a mainnet: duet runs on SimChain, a local chain or a testnet only`);
  const token = String(discovery?.demo?.token?.id ?? 'tUSD');
  const docs = local ? await localGuide(operators) : undefined;
  const w = await web({ ...(docs ? { docs: { guide: docs.guide, sell: docs.sell, home: docs.home, notFound: docs.notFound, pages: docs.pages } } : {}), sellers: { [o.sellerName]: o.sellerPublic } });
  closers.push(() => closeServer(w.server));
  const jobApi = await startStubSellerApi({ port: 0, report: o.report, token, pollsUntilComplete: 1 });
  closers.push(() => jobApi.close());
  return {
    operators,
    docs: local ? { guide: `${w.url}/llms.txt`, sell: `${w.url}/sell.txt`, buy: `${w.url}/buy.txt` } : o.docs ? { ...o.docs, buy: new URL('buy.txt', o.docs.guide).href } : PUBLIC_DOCS,
    docsChanges: docs?.changes ?? [],
    engine: engineOf(local, chainId),
    web: w.url,
    jobApi,
    chainId,
    token,
    local,
    close: async () => { for (const c of closers.reverse()) await c().catch(() => undefined); },
  };
}
