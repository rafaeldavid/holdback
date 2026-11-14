// Seller: sell a service that prices by quote through Crow, with no protocol code of your own (T-318).
// You already run an HTTP API with a quote call, a start call and a result call. This adapter sits beside it:
//
//   1. Quote to offer.   A buyer POSTs {buyer, buyerEncryptionPublicKey, buyerPaymentAddress?, scope, options?} to this
//                        adapter's /quote (buyerPaymentAddress: where the buyer pays from and is refunded; left out,
//                        its signing address). The adapter checks the scope and options, asks your API for a price, fills your deal template
//                        with the scope, applies your terms rules (a window per size band, a check per option: T-330),
//                        signs an offer that names the buyer, submits it, and answers {commitmentId, price, fees,
//                        expiresAt}. The buyer reads the commitment by its ID, and compares it with your published
//                        defaults (GET /defaults: the template and your windows).
//   2. Hold to start.    The adapter polls the operators every `pollMs`, and starts the job only when every operator
//                        shows the commitment Held.
//   3. Result to delivery. When your API returns the result, the adapter runs the adjudicator's first stage on
//                        those exact bytes (preflightDelivery). It encrypts and delivers only when the checks do
//                        not refuse them. Otherwise it holds the delivery, alerts you with each failed check
//                        (`alerts`), and waits for a fixed report until `deliverBy`: it fetches the result again
//                        on your schedule, or when you POST /deals/<commitmentId>/ready (`redelivery`, T-329).
//
// You write one JSON configuration file and edit no source (T-331; seller-adapter.config.json is an example). Only
// `sellerApi` is required: every other field defaults to `DEFAULTS` in seller-adapter-core.ts, and the club and the three
// adjudicators default to the ones the operators' discovery document names. Your signing key comes from the
// environment. The adapter signs your offer and your delivery with it; it never holds a buyer's key, and the
// operators only relay. You need a mandate in the club to offer: on the test service the adapter takes one from the
// faucet and renews it before it runs out; elsewhere your club's principal gives you one, and the adapter stops
// at start, saying why, when you hold none.
//
// Your API, as the adapter calls it (seller-adapter-stub.ts is a working example):
//   quote:  POST <quote>   {scope, options?}              -> {price: {token, amount}, quoteId?, deliverWithinSec?}
//           `amount` is base units as a decimal string ("2000000000" is 2,000.00 of a 6-decimal token).
//   start:  POST <start>   {commitmentId, quoteId, scope, options?} -> {jobId}, with `Idempotency-Key: <commitmentId>`.
//           The same key must return the same job: after a crash the adapter sends the start again.
//   result: GET  <result>  ({jobId} in the address)       -> 202 while the job runs; 200 with the result's bytes.
//           After a refusal, the same address answers with your fixed report once you have one.
// An API of another shape needs no service in between (T-366, seller-adapter-api.ts): `sellerApi` can name a base
// URL, a credential from the environment, a method, path, headers and body template for each call, JSON pointers
// that read the answers, a job status field, and further files a result names, fetched one by one.
//
// This file is the adapter's Node shell (T-434): the journal file, the HTTP server and the poll. The rules are in
// seller-adapter-core.ts, which apps/hosted-sellers runs on Cloudflare too.
// It keeps a journal file of its deals, so a restart neither starts a job twice nor delivers twice: the journal
// records each job, and the settlement layer says whether a delivery is already there. Run one adapter per journal.
// It listens on 127.0.0.1 and makes public-level offers. Every quote makes the adapter sign an offer, so in production
// run it as seller-adapter-service.md says: behind an HTTPS proxy, with `quoteAuth` and `quoteRateLimit` set (T-324).
// The deliverable is data: the adapter parses it only inside the check library, and runs nothing from it, from
// the template, from a rule, from the scope or from an option.
//
//   pnpm install && pnpm build
//   HOLDBACK_KEY=0x… HOLDBACK_OPERATORS=https://…,https://… node examples/seller-adapter.ts seller.json
//   node examples/seller-adapter.ts examples/seller-adapter.config.json --sim   (a test key and the operators of a running `pnpm sim`)
// Env: HOLDBACK_KEY (the seller's signing key) and HOLDBACK_OPERATORS (two or more, comma-separated). The adapter
// signs under the settlement layer those operators serve, which must be one pinned in verify.ts: SimChain, Sepolia,
// or the deployment in HOLDBACK_DEPLOYMENT. Your API prices in that layer's token: `tUSD` on SimChain, the token's
// address on a chain (discovery, `demo.token.id`). Test tokens only: nothing here is real money.
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { plain } from '@holdback/testkit';
import { configFrom, createSellerAdapter, DEFAULTS, type Journal, type RunningAdapter, type SellerAdapterConfig } from './seller-adapter-core.ts';
import { help, helpAsked } from './help.ts';

export * from './seller-adapter-core.ts';

// ---- The defaults: what a configuration file leaves out (seller-adapter-core.ts), with the shipped template. ----
export const config: SellerAdapterConfig = { ...DEFAULTS, template: fileURLToPath(new URL('./seller-adapter.template.json', import.meta.url)) };

/**
 * Reads a configuration file (T-331): one JSON object, checked by `configFrom` (seller-adapter-core.ts). `template`
 * and `reportMapping` are read beside the file; `journal` is where the adapter runs, as before.
 */
export function loadConfig(file: string): SellerAdapterConfig {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`cannot read ${file}`);
  }
  let f: unknown;
  try {
    f = JSON.parse(text);
  } catch {
    throw new Error(`${file} is not JSON`);
  }
  return configFrom(f, file, { beside: (p) => resolve(dirname(file), p), readText: (p) => readFileSync(p, 'utf8'), shippedTemplate: config.template });
}

/** The longest request body the server reads: a little over the core's own limit, so the core can refuse it. */
const READ_CAP_BYTES = 65_536 + 1;

/** A Node request as a standard Request, its body read up to READ_CAP_BYTES and drained past it. */
async function asRequest(req: IncomingMessage): Promise<Request> {
  const url = new URL(req.url ?? '/', 'http://adapter');
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) for (const one of v) headers.append(k, one);
    else if (v !== undefined) headers.set(k, v);
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    req.resume();
    return new Request(url, { method: req.method ?? 'GET', headers });
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    if (size <= READ_CAP_BYTES) chunks.push(c as Buffer); // past the cap the rest is drained, not kept
    size += (c as Buffer).length;
  }
  return new Request(url, { method: req.method ?? 'POST', headers, body: Buffer.concat(chunks) });
}

/**
 * Starts the adapter on Node: the core of seller-adapter-core.ts with a journal file, the /quote server on 127.0.0.1
 * and a pass every `pollMs`. The key and the operators come from `env` (HOLDBACK_KEY, HOLDBACK_OPERATORS), never
 * from the configuration.
 */
export async function startSellerAdapter(c: SellerAdapterConfig, env: Readonly<Record<string, string | undefined>> = process.env): Promise<RunningAdapter> {
  const core = await createSellerAdapter(c, env, {
    readText: (p) => readFileSync(p, 'utf8'),
    shippedTemplate: config.template,
    loadJournal: () => (existsSync(c.journal) ? (JSON.parse(readFileSync(c.journal, 'utf8')) as Journal) : undefined),
    /** Writes the journal whole, then renames it into place: a crash leaves the old file or the new one. */
    saveJournal: (journal) => {
      writeFileSync(`${c.journal}.tmp`, JSON.stringify(journal, null, 2));
      renameSync(`${c.journal}.tmp`, c.journal);
    },
    ...(typeof c.events === 'string' && c.events !== '' ? { appendEvent: (line: string) => appendFileSync(c.events!, line) } : {}),
    journalPath: resolve(c.journal),
  });
  const server = createServer((req, res) => {
    void asRequest(req)
      .then((request) => core.handle(request, new URL(request.url).pathname))
      .then(async (response) => {
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      })
      .catch((e: Error) => {
        if (res.headersSent) return void res.destroy();
        res.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ type: 'internal', detail: `the adapter could not answer: ${plain(e.message)}` }));
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(c.port, '127.0.0.1', resolve);
  });
  const bound = server.address() as AddressInfo;
  const url = `http://${bound.address}:${bound.port}`;
  const timer = setInterval(core.wake, c.pollMs);
  core.wake(); // deals the journal left open
  core.announce(`serves POST ${url}/quote; journal ${plain(c.journal)}`);
  return {
    url,
    deals: core.deals,
    close: async () => {
      clearInterval(timer);
      const closing = core.close(); // no pass starts after this; the one running finishes
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closing;
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const sim = args.includes('--sim');
  const files = args.filter((a) => a !== '--sim');
  const asked = helpAsked(args);
  if (asked !== null) {
    (asked === 0 ? console.log : console.error)(help('seller-adapter', import.meta.url));
    process.exit(asked);
  }
  if (files.length !== 1 || files[0]!.startsWith('--')) {
    console.error(help('seller-adapter', import.meta.url));
    process.exit(2);
  }
  let adapter: RunningAdapter;
  try {
    const settings = loadConfig(files[0]!);
    let env: Readonly<Record<string, string | undefined>> = process.env;
    if (sim) {
      // A running `pnpm sim` hands out a funded test account and names its operators; discovery names the club and adjudicators.
      const at = process.env['HOLDBACK_SIM_URL'] ?? 'http://127.0.0.1:8780';
      const info = (await (await fetch(at)).json()) as { operators: string[] };
      const account = (await (await fetch(`${at}/accounts`, { method: 'POST' })).json()) as { privateKey: string };
      env = { ...process.env, HOLDBACK_KEY: account.privateKey, HOLDBACK_OPERATORS: info.operators.join(',') };
    }
    adapter = await startSellerAdapter(settings, env);
  } catch (e) {
    console.error(`seller-adapter: ${plain((e as Error).message)}`);
    process.exit(2);
  }
  // A service manager stops the adapter with SIGTERM: it stops taking quotes, lets the step in progress finish and
  // record itself in the journal, then exits. The next start resumes every open deal from the journal.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      console.log(`${new Date().toISOString()} ${signal}: the adapter stops after the step in progress; the journal keeps every open deal.`);
      void adapter.close().then(() => process.exit(0));
    });
  }
}
