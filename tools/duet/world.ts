// The world a duet runs in (T-391). Locally: the phase-one sim world (SimChain, two operators, three test
// adjudicators), started in this process with every key kept private. Or a world already running, named by its
// operators (`--world`), which is how the same command later runs against Sepolia. Either way the runner adds:
//   - a small web: the agent docs (llms.txt and sell.txt, with this world's operators filled in, when run locally) and
//     the seller's own public page, served from the seller's folder;
//   - the seller's job API: examples/seller-adapter-stub.ts, the repository's audit-report stub, unchanged.
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve, sep } from 'node:path';
import { startStubSellerApi, type StubSellerApi } from '../../examples/seller-adapter-stub.ts';
import type { Recorder } from './record.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface World {
  /** The operators as they are. */
  operators: string[];
  /** The docs both agents are pointed to. */
  docs: { guide: string; sell: string };
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
async function web(o: { docs?: { guide: string; sell: string }; sellers: Record<string, string> }): Promise<{ url: string; server: Server }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, type: string, text: string | Buffer) => res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }).end(text);
    if (req.method !== 'GET') return send(405, 'text/plain', 'GET only');
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://web.invalid').pathname);
    if (path === '/llms.txt' && o.docs) return send(200, TYPES['.txt']!, o.docs.guide);
    if (path === '/sell.txt' && o.docs) return send(200, TYPES['.txt']!, o.docs.sell);
    const m = /^\/sellers\/([a-z0-9-]+)\/(.*)$/.exec(path);
    const root = m ? o.sellers[m[1]!] : undefined;
    if (!m || !root) return send(404, 'text/plain', 'not found');
    const file = resolve(root, m[2] || 'index.html');
    if (!file.startsWith(root + sep) || !existsSync(file)) return send(404, 'text/plain', 'not found');
    const real = realpathSync(file);
    if (!real.startsWith(realpathSync(root) + sep) || lstatSync(file).isSymbolicLink() || !lstatSync(real).isFile()) return send(404, 'text/plain', 'not found');
    return send(200, TYPES[extname(file)] ?? 'application/octet-stream', readFileSync(real));
  });
  return { url: await listen(server), server };
}

/** llms.txt as the site publishes it, for this world: its operators in place of OP1 and OP2, editor notes left out. */
export function localGuide(operators: string[], repo: string): { guide: string; sell: string } {
  const strip = (t: string) => t.split('\n').filter((l) => !l.startsWith('%% ')).join('\n');
  const guide = strip(readFileSync(join(repo, 'site/llms.txt'), 'utf8'))
    .replaceAll('{{OP1}}', operators[0]!)
    .replaceAll('{{OP2}}', operators[1] ?? operators[0]!)
    .replaceAll('{{TRY_COMMAND}}', '# The one-command test deal runs on the public test service only, not on this local world.');
  return { guide, sell: strip(readFileSync(join(repo, 'site/sell.txt'), 'utf8')) };
}

export const PUBLIC_DOCS = { guide: 'https://crow.direct/llms.txt', sell: 'https://crow.direct/sell.txt' } as const;

export interface WorldOptions {
  repo: string;
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
  const discovery: J = await (await fetch(`${operators[0]}/.well-known/holdback.json`, { signal: AbortSignal.timeout(30_000) })).json();
  const chainId = Number(discovery?.domain?.chainId ?? discovery?.eip712Domain?.chainId ?? 0);
  if (chainId === 1) throw new Error('the world names Ethereum mainnet (chain 1): duet runs on SimChain, a local chain or a testnet only');
  const token = String(discovery?.demo?.token?.id ?? 'tUSD');
  const docs = local ? localGuide(operators, o.repo) : undefined;
  const w = await web({ ...(docs ? { docs } : {}), sellers: { [o.sellerName]: o.sellerPublic } });
  closers.push(() => closeServer(w.server));
  const jobApi = await startStubSellerApi({ port: 0, report: o.report, token, pollsUntilComplete: 1 });
  closers.push(() => jobApi.close());
  return {
    operators,
    docs: local ? { guide: `${w.url}/llms.txt`, sell: `${w.url}/sell.txt` } : (o.docs ?? PUBLIC_DOCS),
    web: w.url,
    jobApi,
    chainId,
    token,
    local,
    close: async () => { for (const c of closers.reverse()) await c().catch(() => undefined); },
  };
}
