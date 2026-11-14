// A stub of a seller's job API of another shape than seller-adapter-stub.ts, for the tests of T-366. It stands for a
// service that runs long jobs: every call needs a credential header, a quote is an estimate, a start returns a
// numeric run ID, a run is read by GET with a state field, and a finished run names proof files that are fetched
// one by one. Nothing in it is a real service's shape.
//
// Under <url>/api/v2/, each call with `X-Api-Key: <key>`:
//   POST estimates            {target, depth, client}           -> {estimate: {id, cost: {units}, validSeconds, turnaroundSeconds}}
//   POST runs                 {estimate, reference, input}      -> 201 {run: {id}}; the same X-Request-Key gives the same run
//   GET  runs/<id>                                              -> {run: {id, state}, output?}; state queued, running, complete or error
//   GET  runs/<id>/files/<path>                                 -> the file's bytes
// The price is made up for the tests: 100.00 tUSD plus 50.00 tUSD per depth, one day per depth. Test data only.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface JobStubOptions {
  /** The credential the stub takes in X-Api-Key. */
  key: string;
  /** How many reads of a run answer `queued` then `running` before it is complete. Default 2. */
  readsUntilComplete?: number;
  /** The run ends in state `error`: the job failed. */
  fail?: boolean;
  /** The first start makes the run, then answers 503: a crash between the seller's work and its answer. */
  failFirstStart?: boolean;
  /** The files the finished run names, in order. Default two proof files. */
  fileList?: J;
  /** Files by path. Default a short text for each default path. */
  files?: Record<string, string | Uint8Array>;
  /** Paths whose fetch answers 500, until `fixFiles()`. */
  brokenFiles?: string[];
  /** The run ID the start answers. Default 41, 42, … */
  runId?: J;
  /** Fields that replace the estimate's own. */
  estimateOverride?: J;
  /**
   * The stub serves accounts (T-435): estimates and runs live under `workspaces/<id>/`, and a run's answer names the
   * account it ran in as `run.workspace`. `reportsWorkspace` replaces that name, as a job that ran elsewhere would.
   */
  workspaces?: boolean;
  reportsWorkspace?: string;
}

export interface JobStub {
  url: string;
  base: string;
  /** Every request: method, path, and the headers the stub reads. */
  requests: Array<{ method: string; path: string; apiKey: string | undefined; requestKey: string | undefined; body: J }>;
  /** With `workspaces`: the account each estimate and run request named, in order. */
  workspacesNamed: string[];
  /** The runs made: one for each distinct X-Request-Key. */
  runs(): Array<{ id: J; key: string; reference: string }>;
  fixFiles(): void;
  close(): Promise<void>;
}

export const DEFAULT_FILES: Record<string, string> = {
  'poc/overflow.t.sol': '// proof: the counter overflows at 2**256 - 1\n',
  'poc/reentry.t.sol': '// proof: withdraw re-enters before the balance is cleared\n',
};

export async function startJobStub(o: JobStubOptions): Promise<JobStub> {
  const requests: JobStub['requests'] = [];
  const runs = new Map<string, { id: J; key: string; reference: string; input: J; reads: number; workspace?: string }>();
  const workspacesNamed: string[] = [];
  let broken = new Set(o.brokenFiles ?? []);
  let startsSeen = 0;
  const files = o.files ?? DEFAULT_FILES;

  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const text = Buffer.concat(chunks).toString('utf8');
      const body = text ? JSON.parse(text) : undefined;
      const path = new URL(req.url ?? '/', 'http://stub').pathname;
      const header = (h: string) => (typeof req.headers[h] === 'string' ? (req.headers[h] as string) : undefined);
      requests.push({ method: req.method ?? '', path, apiKey: header('x-api-key'), requestKey: header('x-request-key'), body });
      if (path === '/elsewhere') return send(200, { detail: 'a request outside the base URL' });
      if (path === '/api/v2/moved') return void res.writeHead(302, { location: `${url}/elsewhere` }).end();
      if (!path.startsWith('/api/v2/')) return send(404, { detail: 'not found' });
      if (header('x-api-key') !== o.key) return send(401, { detail: 'X-Api-Key is missing or wrong' });
      let route = path.slice('/api/v2/'.length);
      let account: string | undefined;
      if (o.workspaces) {
        const w = /^workspaces\/([^/]+)\/(estimates|runs)$/.exec(route);
        if (w) {
          account = decodeURIComponent(w[1]!);
          workspacesNamed.push(account);
          route = w[2]!;
        } else if (route === 'estimates' || route === 'runs') return send(404, { detail: 'estimates and runs live under workspaces/<id>/' });
      }
      if (req.method === 'POST' && route === 'estimates') {
        const depth = Number(body?.depth);
        if (typeof body?.target !== 'string' || !Number.isSafeInteger(depth)) return send(422, { detail: 'target and depth are required' });
        const units = (100_000_000n + 50_000_000n * BigInt(depth)).toString();
        return send(200, { estimate: { id: `est-${requests.length}`, cost: { units }, validSeconds: 600, turnaroundSeconds: 86_400 * depth, ...o.estimateOverride } });
      }
      if (req.method === 'POST' && route === 'runs') {
        const key = header('x-request-key');
        if (!key) return send(400, { detail: 'POST runs needs X-Request-Key' });
        if (!runs.has(key)) runs.set(key, { id: o.runId ?? 41 + runs.size, key, reference: body?.reference, input: body?.input, reads: 0, ...(account === undefined ? {} : { workspace: account }) });
        startsSeen++;
        if (o.failFirstStart && startsSeen === 1) return send(503, { detail: 'the run was made, but the answer was lost' });
        return send(201, { run: { id: runs.get(key)!.id } });
      }
      const file = /^runs\/([^/]+)\/files\/(.+)$/.exec(route);
      if (req.method === 'GET' && file) {
        const name = file[2]!.split('/').map(decodeURIComponent).join('/');
        if (broken.has(name)) return send(500, { detail: 'the file store is down' });
        const content = files[name];
        if (content === undefined) return send(404, { detail: 'no such file' });
        return res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(content);
      }
      const read = /^runs\/([^/]+)$/.exec(route);
      if (req.method === 'GET' && read) {
        const run = [...runs.values()].find((r) => String(r.id) === decodeURIComponent(read[1]!));
        if (!run) return send(404, { detail: 'no such run' });
        const n = run.reads++;
        const until = o.readsUntilComplete ?? 2;
        if (n < until) return send(200, { run: { id: run.id, state: n === 0 ? 'queued' : 'running' } });
        if (o.fail) return send(200, { run: { id: run.id, state: 'error' }, detail: 'the job ran out of memory' });
        const output = { summary: `Reviewed ${run.input?.target} to depth ${run.input?.depth}.`, target: run.input?.target, proofs: o.fileList ?? Object.keys(DEFAULT_FILES) };
        const named = o.reportsWorkspace ?? run.workspace;
        return send(200, { run: { id: run.id, state: 'complete', ...(named === undefined ? {} : { workspace: named }) }, output });
      }
      return send(404, { detail: 'not found' });
    })().catch((e: Error) => send(400, { detail: e.message }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    base: `${url}/api/v2/`,
    requests,
    workspacesNamed,
    runs: () => [...runs.values()].map(({ id, key, reference }) => ({ id, key, reference })),
    fixFiles: () => void (broken = new Set()),
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

/** The `sellerApi` block for this stub: what a seller with a job API writes in its configuration file. */
export function jobStubSellerApi(base: string, extra: { files?: J } = {}): J {
  return {
    baseUrl: base,
    auth: { env: 'JOBS_API_KEY', header: 'X-Api-Key' },
    quote: {
      method: 'POST',
      path: 'estimates',
      body: { target: '{{scope.target}}', depth: '{{scope.depth}}', client: '{{buyer}}' },
      read: { amount: '/estimate/cost/units', quoteId: '/estimate/id', deliverWithinSec: '/estimate/turnaroundSeconds', validForSec: '/estimate/validSeconds' },
    },
    start: {
      method: 'POST',
      path: 'runs',
      idempotencyHeader: 'X-Request-Key',
      body: { estimate: '{{quoteId}}', reference: '{{commitmentId}}', input: '{{scope}}' },
      read: { jobId: '/run/id' },
    },
    result: {
      method: 'GET',
      path: 'runs/{{jobId}}',
      status: { by: 'field', pointer: '/run/state', running: ['queued', 'running'], done: ['complete'], failed: ['error', 'cancelled'] },
      report: '/output',
      files: { list: '/proofs', path: 'runs/{{jobId}}/files/{{file}}', into: '/proofs', maxCount: 5, maxTotalBytes: 65_536, ...extra.files },
    },
  };
}
