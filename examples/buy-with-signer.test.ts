// The buyer's command (buy-with-signer.ts) as a separate process, on the world `pnpm sim` starts (T-368): a seller's
// own adapter configuration file, the shipped adapter and its stub API, and the command's approval stop. The sim's
// faucet admits each fresh buyer key, so the command funds and opens a delivered deal on a local chain.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSimWorld, type SimWorld } from '@holdback/operator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, startSellerAdapter, type RunningAdapter } from './seller-adapter.ts';
import { startStubSellerApi, type StubSellerApi } from './seller-adapter-stub.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
const root = here('../');
const SAMPLE = JSON.parse(readFileSync(here('../fixtures/data/audit-report/report.json'), 'utf8'));
/** The stub prices 3,000 lines at 2,000.00 tUSD; the adjudication fee is on top, and this world has no operator fee. */
const SCOPE = JSON.stringify({ commit: SAMPLE.commit, files: SAMPLE.filesReviewed, lines: 3000 });
const BUDGET = '2100000000';

let world: SimWorld;
let stub: StubSellerApi;
let adapter: RunningAdapter;
const dirs: string[] = [];
const dir = () => {
  const d = mkdtempSync(join(tmpdir(), 't368-'));
  dirs.push(d);
  return d;
};

beforeAll(async () => {
  world = await startSimWorld({ env: {}, onError: () => {} });
  stub = await startStubSellerApi({ port: 0 });
  // The seller's own configuration file, and a funded account from the sim service, as `seller-adapter.ts --sim` takes them.
  const config = join(dir(), 'seller.json');
  writeFileSync(config, JSON.stringify({ port: 0, sellerApi: stub.api, journal: join(dirname(config), 'journal.json') }));
  const account = (await (await fetch(`${world.url}/accounts`, { method: 'POST' })).json()) as { privateKey: string };
  adapter = await startSellerAdapter({ ...loadConfig(config), pollMs: 50, log: () => {} }, { HOLDBACK_KEY: account.privateKey, HOLDBACK_OPERATORS: world.info.operators.join(',') });
}, 60_000);
afterAll(async () => {
  await adapter?.close();
  await stub?.close();
  await world?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Run = { code: number | null; out: string; err: string };
const collect = (child: ReturnType<typeof spawn>) =>
  new Promise<Run>((resolve) => {
    let out = '', err = '';
    child.stdout!.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr!.on('data', (d: Buffer) => (err += d.toString()));
    child.on('exit', (code) => resolve({ code, out, err }));
  });
/** The command from the repository root, with `operators` as HOLDBACK_OPERATORS. */
const buy = (args: string[], operators = world.info.operators) =>
  collect(spawn(process.execPath, ['examples/buy-with-signer.ts', ...args], { cwd: root, env: { ...process.env, HOLDBACK_OPERATORS: operators.join(',') } }));
/** A line the command printed for the buyer to run, run as written by a shell, with this node first on PATH. */
const shell = (line: string) => collect(spawn('sh', ['-c', line], { cwd: root, env: { ...process.env, HOLDBACK_OPERATORS: '', PATH: `${dirname(process.execPath)}:${process.env['PATH']}` } }));
const quoteUrl = () => `${adapter.url}/quote`;
const stopped = (r: Run) => {
  expect(r.code, r.err).toBe(3);
  const shown = JSON.parse(r.out) as J;
  expect(r.err.trimEnd().split('\n').at(-1)).toBe(shown.approve);
  return shown;
};
/** A front to one operator: forwards every request, unless `answer` answers it; `rewrite` may change a JSON answer. */
async function front(target: string, o: { answer?: (method: string, path: string) => { status: number; headers: Record<string, string>; body: J } | null; rewrite?: (path: string, body: J) => J }) {
  const server = createServer(async (req, res) => {
    const own = o.answer?.(req.method!, req.url ?? '/');
    if (own) return void res.writeHead(own.status, { 'content-type': 'application/problem+json', ...own.headers }).end(JSON.stringify(own.body));
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const r = await fetch(`${target}${req.url}`, { method: req.method!, headers: { 'content-type': String(req.headers['content-type'] ?? 'application/json'), ...(req.headers['idempotency-key'] ? { 'idempotency-key': String(req.headers['idempotency-key']) } : {}) }, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    const type = r.headers.get('content-type') ?? 'application/json';
    let body: string | Buffer = Buffer.from(await r.arrayBuffer());
    if (o.rewrite && r.ok && type.includes('json')) body = JSON.stringify(o.rewrite(req.url ?? '/', JSON.parse(body.toString())));
    res.writeHead(r.status, { 'content-type': type }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}
const events = async (id: string) => ((await (await fetch(`${world.info.operators[0]}/v1/commitments/${id}/events?limit=200`)).json()) as { items: Array<{ type: string }> }).items.map((e) => e.type);
const balance = async (address: string) => ((await (await fetch(`${world.info.operators[1]}/v1/balances/${address}`)).json()) as { amount: string }).amount;

describe('buy-with-signer.ts: the approval stop', () => {
  it('stops before funding and shows every signed term; the approve line it prints funds exactly that offer, and another ID funds nothing', async () => {
    const store = dir();
    const shown = stopped(await buy([quoteUrl(), store, SCOPE, BUDGET, `${adapter.url}/defaults`]));
    const id = shown.commitmentId as string;
    expect(shown).toMatchObject({ approval: 'needed', budget: BUDGET, price: { token: 'tUSD', amount: '2000000000' }, settlement: { mode: expect.any(String) }, disclosure: { level: 'public' }, clubId: world.info.clubId, maxSubmissions: expect.any(Number) });
    for (const k of ['seller', 'fees', 'deliverable', 'checks', 'rubric', 'deadlines', 'windows', 'adjudicators', 'rulebookHash', 'policyId', 'policyHash', 'registryHash', 'differences']) expect(shown, k).toHaveProperty(k);
    expect(shown.fees.total.amount).toBe((2_000_000_000n + BigInt(shown.fees.adjudication.amount) + BigInt(shown.fees.operator.amount)).toString());
    expect(Date.parse(shown.deadlines.deliverBy)).toBeGreaterThan(Date.now());
    expect(shown.approve).toBe(`HOLDBACK_OPERATORS=${world.info.operators.join(',')} node examples/buy-with-signer.ts approve ${store} ${id} ${BUDGET}`);
    // Nothing is signed or paid: no agreement, no funding, and the faucet was not asked.
    const buyer = ((await (await fetch(`${world.info.operators[0]}/v1/commitments/${id}/terms`)).json()) as J).buyer as string;
    expect(await events(id)).not.toContain('hold.funded');
    expect(await balance(buyer)).toBe('0');

    // An approval that names an ID the stop did not show funds nothing.
    const other = `0x${'ab'.repeat(32)}`;
    const wrong = await buy(['approve', store, other, BUDGET]);
    expect(wrong.code).toBe(1);
    expect(wrong.err).toMatch(new RegExp(`no key in ${store} for ${other}`));
    expect(await events(id)).not.toContain('hold.funded');

    // The approve line, run as printed: the offer read again, funded, delivered and opened.
    const done = await shell(shown.approve);
    expect(done.code, done.err).toBe(0);
    const result = JSON.parse(done.out) as J;
    expect(result).toMatchObject({ commitmentId: id, buyer, outcome: 'Released', paid: shown.fees.total });
    expect(JSON.parse(result.work)).toMatchObject({ commit: SAMPLE.commit });
    expect(adapter.deals().find((d) => d.id === id)?.stage).toBe('delivered');
  }, 90_000);

  it('refuses an offer that changed between the stop and the approval, naming the field, and funds nothing', async () => {
    // Two front ends to the operators; after the stop they publish an operator fee the stop did not show.
    let fee = false;
    const fronts: Server[] = [];
    const urls: string[] = [];
    for (const target of world.info.operators) {
      const front = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const r = await fetch(`${target}${req.url}`, { method: req.method!, headers: { 'content-type': 'application/json', ...(req.headers['idempotency-key'] ? { 'idempotency-key': String(req.headers['idempotency-key']) } : {}) }, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
        let body = await r.text();
        if (fee && req.url === '/.well-known/holdback.json') body = JSON.stringify({ ...JSON.parse(body), fees: { operator: { to: world.info.accounts[0]!.address, token: 'tUSD', bps: 1, min: '10000', max: null, appliesAt: 'agree-and-fund', refundable: false } } });
        res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json' }).end(body);
      });
      await new Promise<void>((resolve) => front.listen(0, '127.0.0.1', resolve));
      fronts.push(front);
      urls.push(`http://127.0.0.1:${(front.address() as AddressInfo).port}`);
    }
    try {
      const store = dir();
      const shown = stopped(await buy([quoteUrl(), store, SCOPE, BUDGET], urls));
      expect(shown.fees.operator.amount).toBe('0');
      fee = true;
      const r = await buy(['approve', store, shown.commitmentId, BUDGET], urls);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/refusing to sign: fees\.operator is \{"amount":"200000","token":"tUSD"\}, not the shown \{"amount":"0","token":"tUSD"\}/);
      expect(await events(shown.commitmentId)).not.toContain('hold.funded');
    } finally {
      for (const f of fronts) {
        f.closeAllConnections();
        await new Promise<void>((resolve) => f.close(() => resolve()));
      }
    }
  }, 90_000);

  it('an unattended agent approves in one run with its own terms: it funds an offer that matches them, and stops on one that differs', async () => {
    // The buyer writes down what it accepts, in the defaults' format: here, from an offer it was shown before.
    const seen = stopped(await buy([quoteUrl(), dir(), SCOPE, BUDGET]));
    const terms = { deliverable: seen.deliverable, checks: seen.checks, rubric: seen.rubric, timing: seen.windows, fee: seen.fees.adjudication, adjudicators: seen.adjudicators, maxSubmissions: seen.maxSubmissions, price: seen.price };
    const file = join(dir(), 'terms.json');
    writeFileSync(file, JSON.stringify(terms));
    const done = await buy([quoteUrl(), dir(), SCOPE, BUDGET, '--expect-terms', file]);
    expect(done.code, done.err).toBe(0);
    expect(JSON.parse(done.out)).toMatchObject({ outcome: 'Released', paid: seen.fees.total });

    // One term the seller offers differently, and the price: the run stops, naming both.
    writeFileSync(file, JSON.stringify({ ...terms, maxSubmissions: seen.maxSubmissions + 1, price: { token: 'tUSD', amount: '1900000000' } }));
    const differs = stopped(await buy([quoteUrl(), dir(), SCOPE, BUDGET, '--expect-terms', file]));
    expect(differs.differences.map((d: J) => d.field)).toEqual(['deadlines.maxSubmissions', 'price']);
    expect(await events(differs.commitmentId)).not.toContain('hold.funded');

    // A file that leaves a term open approves nothing: the run makes no key and asks no seller.
    const open = { ...terms, adjudicators: undefined };
    writeFileSync(file, JSON.stringify(open));
    const store = dir();
    const refused = await buy([quoteUrl(), store, SCOPE, BUDGET, '--expect-terms', file]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('do not name adjudicators.primary, adjudicators.fallback, adjudicators.appeal');
  }, 120_000);

  it('shows an offer above the budget and stops with no approve line; refuses a misspelt term and a missing terms file', async () => {
    const store = dir();
    const over = await buy([quoteUrl(), store, SCOPE, '1']);
    expect(over.code, over.err).toBe(1);
    const shown = JSON.parse(over.out) as J;
    expect(shown).toMatchObject({ approval: 'over-budget', budget: '1', price: { token: 'tUSD', amount: '2000000000' } });
    expect(shown).not.toHaveProperty('approve');
    expect(over.err).toContain('above 1: nothing is signed or paid');
    expect(await events(shown.commitmentId)).not.toContain('hold.funded');
    // A misspelt term is refused before any key or quote, not dropped.
    const file = join(dir(), 'terms.json');
    writeFileSync(file, JSON.stringify({ deliverable: {}, checks: [], timing: {}, Price: { token: 'tUSD', amount: '1' } }));
    const misspelt = await buy([quoteUrl(), dir(), SCOPE, BUDGET, '--expect-terms', file]);
    expect(misspelt.code).toBe(1);
    expect(misspelt.err).toContain('a misspelt term must not be dropped unseen');
    const none = await buy([quoteUrl(), dir(), SCOPE, BUDGET, '--expect-terms']);
    expect(none.code).toBe(1);
    expect(none.err).toContain('--expect-terms takes the path of your terms file');
    const budget = await buy([quoteUrl(), dir(), SCOPE, '0x7d2b7500']);
    expect(budget.code).toBe(1);
    expect(budget.err).toContain('the most you pay is base units as a decimal string');
  }, 60_000);

  it('stops on a faucet 429 with one plain line: the grants are used, the seconds until it grants again, nothing paid (T-399 Finding 2)', async () => {
    const store = dir();
    const shown = stopped(await buy([quoteUrl(), store, SCOPE, BUDGET]));
    // The relay answers the faucet as the live one did at its 11th grant in an hour.
    const relay = await front(world.info.operators[0]!, {
      answer: (method, path) => (method === 'POST' && path === '/v1/faucet' ? { status: 429, headers: { 'retry-after': '2264' }, body: { type: 'rate_limited', status: 429, detail: 'too many faucet grants from this client; retry later', retryAfterSec: 2264 } } : null),
    });
    try {
      const r = await buy(['approve', store, shown.commitmentId, BUDGET], [relay.url, world.info.operators[1]!]);
      expect(r.code, r.err).toBe(1);
      expect(r.err).not.toMatch(/^\s+at /m); // no stack trace
      expect(r.err.trimEnd().split('\n')).toEqual(['Stopped: the faucet\'s grants for this client are used (429: too many faucet grants from this client; retry later). It grants again in 2264 s. Nothing is signed or paid: run the approve command again then, before offerExpiresAt.']);
      expect(r.out).toBe('');
      expect(await events(shown.commitmentId)).not.toContain('hold.funded');
    } finally {
      await relay.close();
    }
  }, 60_000);

  it('reads the events again when one operator lags a few seconds behind, and still stops when it stays behind (T-399 Finding 5)', async () => {
    // After the release, the second operator serves its event list without the last event: first three times, then always.
    let lies = 0, limit = 3;
    const lag = await front(world.info.operators[1]!, {
      rewrite: (path, body) => {
        if (!/^\/v1\/commitments\/0x[0-9a-f]{64}\/events/.test(path) || !body.items?.some((e: J) => e.type === 'settlement.released') || lies >= limit) return body;
        lies++;
        return { ...body, items: body.items.slice(0, -1) };
      },
    });
    try {
      const operators = [world.info.operators[0]!, lag.url];
      const store = dir();
      const shown = stopped(await buy([quoteUrl(), store, SCOPE, BUDGET], operators));
      const done = await buy(['approve', store, shown.commitmentId, BUDGET], operators);
      expect(done.code, done.err).toBe(0);
      expect(lies).toBe(3);
      expect(JSON.parse(done.out)).toMatchObject({ commitmentId: shown.commitmentId, outcome: 'Released' });

      // An operator that stays behind is a real disagreement: the run stops, as before, after reading again for about 15 s.
      lies = 0;
      limit = Infinity;
      const second = dir();
      const again = stopped(await buy([quoteUrl(), second, SCOPE, BUDGET], operators));
      const started = Date.now();
      const stuck = await buy(['approve', second, again.commitmentId, BUDGET], operators);
      expect(stuck.code).toBe(1);
      expect(stuck.err).toContain(`operators disagree on /v1/commitments/${again.commitmentId}/events?limit=200; do not proceed`);
      expect(Date.now() - started).toBeGreaterThan(15_000);
    } finally {
      await lag.close();
    }
  }, 150_000);

  it('approves and stops after funding; resume, in a later process, opens the delivered work', async () => {
    const store = dir();
    const shown = stopped(await buy([quoteUrl(), store, SCOPE, BUDGET, '--stop-after-funding']));
    expect(shown.approve).toMatch(/ approve .* --stop-after-funding$/);
    const funded = await buy(['approve', store, shown.commitmentId, BUDGET, '--stop-after-funding']);
    expect(funded.code, funded.err).toBe(0);
    expect(funded.out).toBe('');
    expect(JSON.parse(funded.err.trimEnd().split('\n').at(-1)!)).toEqual({ funded: shown.commitmentId, paid: shown.fees.total });
    const r = await buy(['resume', store]);
    expect(r.code, r.err).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ commitmentId: shown.commitmentId, outcome: 'Released' });
    // Approving again funds nothing twice: the key store holds the payment, and the run opens the same deal.
    const again = await buy(['approve', store, shown.commitmentId, BUDGET]);
    expect(again.code, again.err).toBe(0);
    expect(JSON.parse(again.out)).toMatchObject({ commitmentId: shown.commitmentId, outcome: 'Released' });
  }, 120_000);
});
