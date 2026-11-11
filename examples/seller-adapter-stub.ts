// A stub of a seller's own HTTP API, for the seller adapter's tests (T-318). It stands for a service that
// prices by quote: it quotes a job from a size number, starts the job, and returns the result when the
// job is complete. The result is a JSON findings report in the shape of fixtures/terms/audit-report.yaml,
// built from the sample report in fixtures/data/audit-report/report.json.
//
// The three calls, as seller-adapter.ts expects them:
//   POST /quote              {scope}                         -> {quoteId, price: {token, amount}, deliverWithinSec}
//   POST /jobs               {commitmentId, quoteId, scope}  -> {jobId}; the same Idempotency-Key gives the same job
//   GET  /jobs/<id>/result                                   -> 202 while the job runs; 200 with the result's bytes
//
// The price is made up for the tests: 500.00 tUSD plus 0.50 tUSD a line, and one day plus one day for each
// 1,000 lines started. 3,000 lines cost 2,000.00 tUSD and take 4 days. Amounts are base units (6 decimals).
//
//   node examples/seller-adapter-stub.ts        (listens on http://127.0.0.1:8790)
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface StubOptions {
  port?: number;
  /**
   * `ok`: a report the sample deal's checks accept. `missing-file`: it leaves out the last file in scope.
   * `own-shape`: the `ok` report in a seller's own shape (fixtures/data/audit-report/seller-shape-a.report.json),
   * which the adapter delivers only after a mapping converts it (T-323).
   */
  report?: 'ok' | 'missing-file' | 'own-shape';
  /** How many times the result answers 202 before the job is complete. Default 1. */
  pollsUntilComplete?: number;
  /** The token the stub prices in: the settlement layer's token ID. Default `tUSD`, SimChain's; on a chain, the token's address. */
  token?: string;
  /** Fields that replace the quote's own, to test a seller API that answers badly. */
  quoteOverride?: J;
}

export interface StubSellerApi {
  url: string;
  /** The three addresses, as the adapter's `sellerApi` setting takes them. */
  api: { quote: string; start: string; result: string };
  /** Requests received, repeats included. */
  calls: { quote: number; start: number; result: number };
  /** The jobs started: one for each distinct Idempotency-Key. */
  jobs(): Array<{ jobId: string; commitmentId: string }>;
  /** Completes every job now, whatever `pollsUntilComplete` says. */
  completeAll(): void;
  /** Answers every result from now on with this report: the seller fixed its report (T-329). */
  setReport(kind: NonNullable<StubOptions['report']>): void;
  close(): Promise<void>;
}

const BASE = 500_000_000n; // 500.00 tUSD
const PER_LINE = 500_000n; // 0.50 tUSD
const SAMPLE = new URL('../fixtures/data/audit-report/report.json', import.meta.url);
const OWN_SHAPE = new URL('../fixtures/data/audit-report/seller-shape-a.report.json', import.meta.url);

/** The seller's own shape of the same report, rewritten for a job's scope in the same way. */
function ownShapeFor(scope: { commit: string; files: string[] }): Uint8Array {
  const own = JSON.parse(readFileSync(OWN_SHAPE, 'utf8'));
  const from: string[] = own.audit.inScope.map((f: J) => f.path);
  const to = (file: string) => scope.files[Math.min(Math.max(from.indexOf(file), 0), scope.files.length - 1)];
  own.audit.revision.sha = scope.commit;
  own.audit.overview = `The review covered ${scope.files.length} files at the commit above and reports ${own.issues.length} findings.`;
  own.audit.inScope = scope.files.map((path) => ({ path }));
  for (const issue of own.issues) for (const place of issue.affected) place.path = to(place.path);
  return new TextEncoder().encode(`${JSON.stringify(own, null, 2)}\n`);
}

/** The sample report rewritten for a job's scope: its commit, its files, and each finding's locations moved to files in scope. */
function reportFor(scope: { commit: string; files: string[] }, kind: 'ok' | 'missing-file' | 'own-shape'): Uint8Array {
  if (kind === 'own-shape') return ownShapeFor(scope);
  const sample = JSON.parse(readFileSync(SAMPLE, 'utf8'));
  const from: string[] = sample.filesReviewed;
  const to = (file: string) => scope.files[Math.min(Math.max(from.indexOf(file), 0), scope.files.length - 1)];
  const report = {
    commit: scope.commit,
    reportDate: sample.reportDate,
    summary: `The review covered ${scope.files.length} files at the commit above and reports ${sample.findings.length} findings.`,
    filesReviewed: kind === 'missing-file' ? scope.files.slice(0, -1) : scope.files,
    findings: sample.findings.map((f: J) => ({ ...f, locations: f.locations.map((l: J) => ({ ...l, file: to(l.file) })) })),
  };
  return new TextEncoder().encode(`${JSON.stringify(report, null, 2)}\n`);
}

async function json(req: IncomingMessage): Promise<J> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function startStubSellerApi(o: StubOptions = {}): Promise<StubSellerApi> {
  const calls = { quote: 0, start: 0, result: 0 };
  const jobs = new Map<string, { jobId: string; commitmentId: string; scope: J; polls: number }>(); // by Idempotency-Key
  let completeAll = false;
  let report = o.report ?? 'ok';

  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://stub').pathname;
      if (req.method === 'POST' && path === '/quote') {
        calls.quote++;
        const { scope } = await json(req);
        const lines = BigInt(scope.lines);
        const quote = { quoteId: `q-${calls.quote}`, price: { token: o.token ?? 'tUSD', amount: (BASE + lines * PER_LINE).toString() }, deliverWithinSec: 86_400 * (1 + Math.ceil(Number(lines) / 1000)) };
        return send(200, { ...quote, ...o.quoteOverride });
      }
      if (req.method === 'POST' && path === '/jobs') {
        calls.start++;
        const key = String(req.headers['idempotency-key'] ?? '');
        if (!key) return send(400, { detail: 'POST /jobs needs an Idempotency-Key' });
        const { commitmentId, scope } = await json(req);
        if (!jobs.has(key)) jobs.set(key, { jobId: `job-${jobs.size + 1}`, commitmentId, scope, polls: 0 });
        return send(200, { jobId: jobs.get(key)!.jobId });
      }
      const result = /^\/jobs\/([^/]+)\/result$/.exec(path);
      if (req.method === 'GET' && result) {
        calls.result++;
        const job = [...jobs.values()].find((j) => j.jobId === result[1]);
        if (!job) return send(404, { detail: 'no such job' });
        if (!completeAll && job.polls++ < (o.pollsUntilComplete ?? 1)) return send(202, { status: 'running' });
        return res.writeHead(200, { 'content-type': 'application/json' }).end(reportFor(job.scope, report));
      }
      return send(404, { detail: 'not found' });
    })().catch((e: Error) => send(400, { detail: e.message }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port ?? 8790, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    api: { quote: `${url}/quote`, start: `${url}/jobs`, result: `${url}/jobs/{jobId}/result` },
    calls,
    jobs: () => [...jobs.values()].map(({ jobId, commitmentId }) => ({ jobId, commitmentId })),
    completeAll: () => void (completeAll = true),
    setReport: (kind) => void (report = kind),
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const stub = await startStubSellerApi();
  console.log(`Stub seller API listening on ${stub.url}: POST /quote, POST /jobs, GET /jobs/<id>/result. Test data only.`);
}
