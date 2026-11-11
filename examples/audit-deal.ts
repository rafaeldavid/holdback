// One audit-shaped deal, end to end (T-321): a buyer buys a code-audit report from a seller that prices by quote.
// Test tokens only: nothing here is real money.
//
// Both halves run in this process, each with its own key, and talk only over HTTP:
//   the seller   seller-adapter-stub.ts (a stand-in for the seller's own API) and seller-adapter.ts, which turns a
//                quote into a signed offer, starts the job on a funded hold, and delivers only a report that passes
//                the adjudicator's first stage;
//   the buyer    buyer-signer.ts: fresh keys in a key store, a quote, the offer read from both operators, test funds
//                from the faucet, the agreement and the funding, and the delivered report opened and checked.
// The operators relay. Each party signs its own messages.
//
// The terms: 2,000.00 of the test token, a 4-day delivery window, and the audit-report template (T-320), filled
// with the buyer's scope. The buyer fills the same template itself and refuses an offer that differs from it.
//
// Two outcomes:
//   released   the report passes the checks; the adjudicator accepts; the seller is paid and the buyer opens the report.
//   refused    the stub's report misses one file in scope; the adapter's preflight refuses to deliver it; after the
//              delivery deadline the buyer's hold comes back.
//
//   pnpm audit-deal                both outcomes, on a world served in this process (SimChain, its own clock)
//   pnpm audit-deal --live         the released outcome on the live test service (Sepolia test tokens)
// Env for --live: HOLDBACK_OPERATORS, two or more, comma-separated. Default: the public test service's two nodes.
//
// A seller's own report and terms (T-326), on the local world only:
//   pnpm audit-deal --report <file> --terms <file>
// The seller's API returns the report file's bytes, unchanged, as the job's result. The terms file has the shape of
// fixtures/terms/audit-report.yaml (YAML or JSON, windows in seconds): the seller offers its deliverable, checks,
// rubric, price and windows, and the buyer approves against the same file. Either option alone works; the other part
// is the built-in one. The terms file is checked as a full commitment before any deal opens. The club, the
// adjudicators and the adjudication fee come from discovery, as in every deal here. One run:
//   Released   the report passes; exit code 0.
//   Held       the seller's check run refuses the report: nothing is delivered, the hold stays funded, the run prints
//              each failed check; exit code 1. (A rubric deal the judges reject ends Refunded, also exit code 1.)
// Exit code 2: the run could not start or stopped on an error, such as a terms file the commitment schema refuses.
// Paths are read from the directory pnpm runs in, the repository's root.
//
// The report is the seller's data. This file parses it as JSON inside the check library and counts its findings. It
// prints none of its text and runs nothing from it. The terms file is data too: it is parsed as YAML with no custom
// tags, checked against the commitment schema, and nothing in it runs.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { preflightDelivery } from '@holdback/judgment';
import { parseTermsYaml, plain, type TermsTemplate } from '@holdback/testkit';
import type { Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { Agent } from './agent.ts';
import { makeKeys, type Approved, type Delivery, type Money, type Offer, type Paid } from './buyer-signer.ts';
import { config as adapterConfig, fill, startSellerAdapter, type RunningAdapter, type Stage } from './seller-adapter.ts';
import { startStubSellerApi, type StubSellerApi } from './seller-adapter-stub.ts';
import { jcs, knownPins, operatorFeeOf, Refusal } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The job: a commit, the files in scope and their size. The stub prices 3,000 lines at 2,000.00 and quotes 4 days. */
export const SCOPE = {
  commit: '7c1e4b9a2d3f5068a1b2c3d4e5f60718293a4b5c',
  files: ['contracts/Vault.sol', 'contracts/InterestModel.sol', 'contracts/PriceFeed.sol'],
  lines: 3000,
};
/** What the buyer approved before it asked: the price in base units (2,000.00 of a 6-decimal token) and the window. */
export const PRICE_UNITS = '2000000000';
export const DELIVERY_WINDOW_SEC = 4 * 86_400;
/** The most the buyer pays on top of the price, adjudication and operator fee together: 60.00, in base units. */
export const MAX_FEES_UNITS = 60_000_000n;
const LIVE_OPERATORS = 'https://api.crow.direct,https://api2.crow.direct';
const TEMPLATE = fileURLToPath(new URL('./seller-adapter.template.json', import.meta.url));
const EMPTY_RUBRIC = { criteria: [], passThreshold: 0 };

export interface AuditDealOptions {
  /** Two or more operators at distinct origins. */
  operators: string[];
  /**
   * Which built-in report the stub returns: `released` (the default) or `refused` (one file in scope missing). Not
   * read when `reportFile` or `termsFile` is set: then the seller's check run on the report decides.
   */
  outcome?: 'released' | 'refused';
  /** A seller's own report: the file whose bytes the seller's API returns, unchanged, as the job's result. */
  reportFile?: string;
  /** A seller's own terms: a file in the shape of fixtures/terms/audit-report.yaml, YAML or JSON. */
  termsFile?: string;
  /**
   * A world with its own clock (the local one): moves settlement time forward by this many seconds. Without it the
   * refused outcome waits in real time for the delivery deadline, and stops when that is more than `timeoutMs` away.
   */
  advanceClock?: (seconds: number) => void | Promise<void>;
  /** Where the buyer's key store and the seller's journal go. Default: a fresh directory, removed at the end. */
  dir?: string;
  log?: (line: string) => void;
  /** How long to wait for the outcome, in milliseconds. Default 10 minutes. */
  timeoutMs?: number;
  /** How often the adapter polls, in milliseconds. Default 1,000. */
  pollMs?: number;
  /** Tests: the seller's signing key, to check that no output shows it. Default: a fresh key that stays in memory. */
  sellerKey?: Hex;
  /** Tests: fields that replace the stub seller API's quote. */
  quoteOverride?: J;
}

export interface AuditDealResult {
  commitmentId: Hex;
  /** `Held`: with a seller's own report, the seller's check run refused it, nothing was delivered and the run stopped. */
  outcome: 'Released' | 'Refunded' | 'Held';
  buyer: string;
  seller: string;
  /** The offer as both operators served it and the buyer approved it. */
  offer: Offer;
  paid: Paid;
  /** The seller adapter's stage when it decided: `delivered` or `refused` (after `deliverBy` it closes a refused deal, T-329). */
  sellerStage: Stage | undefined;
  /** What the buyer opened when the deal ended; null when the run stopped at `Held`. */
  delivery: Delivery | null;
  /** On a refused report, each check the seller's check run failed, with its detail; empty otherwise. */
  failedChecks: string[];
  /** The opened report, on a release: its size, its hash, the buyer's own run of the checks and the finding count. */
  report: { bytes: number; plaintextSha256: string; checks: string; findings: number } | null;
  /** What the seller's balance rose by, and what the buyer's key holds at the end, in base units. */
  sellerReceived: Money;
  buyerHolds: Money;
  /** Each step and the milliseconds since the start when it finished. */
  steps: Array<{ step: string; ms: number }>;
  elapsedMs: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The run cannot start: an unknown option, a file it cannot read, a terms file it refuses. Exit code 2. */
export class UsageError extends Error {}

/** A seller's own files, read and checked before any deal opens. Both stay data: nothing in them runs. */
export interface SellerFiles {
  report?: { path: string; bytes: Uint8Array };
  terms?: { path: string; terms: TermsTemplate };
}

/**
 * Reads the report as bytes and the terms as a full commitment (`parseTermsYaml`, which names the field the
 * commitment schema refuses). Refuses the terms the offer route cannot make, rather than offering other terms.
 * No amount or window is capped (D31): any value the schema takes is offered as written.
 */
export function readSellerFiles(o: { reportFile?: string; termsFile?: string }): SellerFiles {
  const read = (what: string, path: string): Buffer => {
    try {
      return readFileSync(path);
    } catch {
      throw new UsageError(`cannot read the ${what} file ${plain(path)}`);
    }
  };
  const files: SellerFiles = {};
  if (o.reportFile !== undefined) files.report = { path: o.reportFile, bytes: new Uint8Array(read('report', o.reportFile)) };
  if (o.termsFile !== undefined) {
    const source = read('terms', o.termsFile).toString('utf8');
    let terms: TermsTemplate;
    try {
      terms = parseTermsYaml(source, basename(o.termsFile));
    } catch (e) {
      throw new UsageError(`refusing the terms file, before any deal opens: ${plain((e as Error).message)}`);
    }
    // The offer route (apps/operator/src/terms.ts) settles in the price's token: terms that name another are refused
    // here rather than offered with it. The commitment parser already refuses the other terms that route cannot make:
    // a maxSubmissions other than 1, optimistic settlement (it needs windows this format does not take) and a private
    // disclosure level (it needs sealed terms).
    if (terms.settlement.token !== terms.price.token) {
      throw new UsageError(`refusing the terms file ${plain(basename(o.termsFile))}, before any deal opens: settlement.token is ${plain(terms.settlement.token)}; the offer route settles in the price's token, ${plain(terms.price.token)}`);
    }
    files.terms = { path: o.termsFile, terms };
  }
  return files;
}

/** The adapter's template from a terms file: its deliverable, checks and rubric, in the shapes of an offer. */
const templateOf = (t: TermsTemplate) => ({ deliverable: t.deliverable, checks: t.acceptance.deterministicChecks, rubric: t.acceptance.rubric });

/** A window in whole days when it is one, in seconds otherwise. */
const span = (sec: number) => (sec > 0 && sec % 86_400 === 0 ? `${sec / 86_400} day${sec === 86_400 ? '' : 's'}` : `${sec} s`);

/**
 * The seller's own report as every job's result: the report file's bytes, served unchanged, for a job the stub
 * started. The route sends no request. It compares the whole path with the paths of the jobs the stub holds in this
 * process, so nothing from the request is placed in a URL; any other path answers 404.
 */
async function serveReport(stub: StubSellerApi, bytes: Uint8Array): Promise<{ result: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://report').pathname;
    const job = req.method === 'GET' ? stub.jobs().find((j) => path === `/jobs/${encodeURIComponent(j.jobId)}/result`) : undefined;
    if (!job) return void res.writeHead(404, { 'content-type': 'application/json' }).end('{"detail":"not found"}');
    res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(bytes);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { result: `${url}/jobs/{jobId}/result`, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

/**
 * What a party reads before it deals: the settlement layer every operator serves, which must be one pinned in
 * verify.ts, and the test demo's club, token and adjudicators. Each party reads it for itself.
 */
async function discover(operators: string[]) {
  const reader = new Agent(operators, generatePrivateKey(), new Uint8Array(32)); // reads and unsigned calls only
  const found = await reader.trusted('/.well-known/holdback.json', (x) => ({ domain: x.domain, clubId: x.demo?.clubId, token: x.demo?.token?.id, adjudicators: x.demo?.adjudicators }));
  const exact = (d: J) => jcs({ ...d, verifyingContract: String(d?.verifyingContract).toLowerCase() });
  const pin = knownPins().find((p) => exact(p.domain) === exact(found.domain));
  if (!pin) throw new Refusal(`refusing to sign: the operators serve EIP-712 domain ${plain(jcs(found.domain ?? null)).slice(0, 300)}, not one pinned in verify.ts`);
  if (typeof found.clubId !== 'string' || String(found.token).toLowerCase() !== pin.token.id.toLowerCase()) throw new Error('these operators run no test demo: discovery has no demo.clubId or another demo.token');
  const role = (r: string): string => {
    const a = found.adjudicators?.find((x: J) => x.role === r)?.address;
    if (typeof a !== 'string') throw new Error(`discovery names no ${r} adjudicator under demo.adjudicators`);
    return a.toLowerCase();
  };
  return { reader, pin, clubId: found.clubId as string, adjudicators: { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') } };
}

export interface RunningSeller {
  /** The seller's address: its signing key's. */
  address: string;
  /** Where a buyer asks for a quote. */
  quoteUrl: string;
  /** Where the seller's API returns a job's result: `{jobId}` stands for the job's ID. */
  resultUrl: string;
  stub: StubSellerApi;
  adapter: RunningAdapter;
  close(): Promise<void>;
}

/**
 * The seller's side: the stub of its own API, pricing in the settlement layer's token, and the adapter with the
 * seller's key. The key reaches the adapter as an environment value and nothing here prints it.
 *
 * With `reportBytes`, every job's result is those bytes. With `terms`, the adapter offers the terms' deliverable,
 * checks, rubric and windows, and the quote carries the terms' price and delivery window.
 */
export async function startSeller(o: { operators: string[]; report: 'ok' | 'missing-file'; journal: string; pollMs?: number; log?: (line: string) => void; sellerKey?: Hex; quoteOverride?: J; reportBytes?: Uint8Array; terms?: TermsTemplate }): Promise<RunningSeller> {
  const { reader, pin, clubId, adjudicators } = await discover(o.operators);
  const sellerKey = o.sellerKey ?? generatePrivateKey();
  const address = privateKeyToAccount(sellerKey).address.toLowerCase();
  // A seller is a member of the club before it offers. On the test service the faucet grants the mandate.
  await reader.call('POST', '/v1/faucet', { address });
  const t = o.terms;
  const quoteOverride = { ...(t ? { price: { ...t.price }, deliverWithinSec: t.timing.deliverWithinSec } : {}), ...o.quoteOverride };
  const stub = await startStubSellerApi({ port: 0, report: o.report, token: pin.token.id, ...(Object.keys(quoteOverride).length ? { quoteOverride } : {}) });
  const closers: Array<() => Promise<void>> = [() => stub.close()];
  const closeAll = async () => {
    for (const close of closers.reverse()) await close();
  };
  try {
    const served = o.reportBytes ? await serveReport(stub, o.reportBytes) : undefined;
    if (served) closers.push(() => served.close());
    const sellerApi = { ...stub.api, ...(served ? { result: served.result } : {}) };
    let template = adapterConfig.template;
    if (t) {
      template = join(dirname(o.journal), 'seller-template.json');
      writeFileSync(template, JSON.stringify(templateOf(t), null, 2));
    }
    // The terms' windows; maxSubmissions is the offer route's (the commitment parser refuses any other than 1).
    const w = t?.timing;
    const timing = w
      ? { offerExpiresInSec: w.offerExpiresInSec, fundWithinSec: w.fundWithinSec, deliverWithinSec: w.deliverWithinSec, judgeWithinSec: w.judgeWithinSec, fallbackWithinSec: w.fallbackWithinSec, appealWindowSec: w.appealWindowSec, appealDecideSec: w.appealDecideSec }
      : adapterConfig.timing;
    const adapter = await startSellerAdapter(
      { ...adapterConfig, port: 0, sellerApi, template, timing, clubId, adjudicators, journal: o.journal, pollMs: o.pollMs ?? 1000, ...(o.log ? { log: o.log } : {}) },
      { HOLDBACK_KEY: sellerKey, HOLDBACK_OPERATORS: o.operators.join(',') },
    );
    closers.push(() => adapter.close());
    return { address, quoteUrl: `${adapter.url}/quote`, resultUrl: sellerApi.result, stub, adapter, close: closeAll };
  } catch (e) {
    await closeAll();
    throw e;
  }
}

/** Base units as a decimal amount with at least two decimals, in integer arithmetic: "2000000000" is 2,000.00. */
export function shown(m: Money, symbol: string, decimals = 6): string {
  const units = BigInt(m.amount);
  const scale = 10n ** BigInt(decimals);
  const whole = (units / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (units % scale).toString().padStart(decimals, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${whole}.${fraction} ${symbol}`;
}

/** Runs one deal to its end and returns what happened. Throws when a step fails or the buyer refuses the offer. */
export async function runAuditDeal(o: AuditDealOptions): Promise<AuditDealResult> {
  const say = o.log ?? ((line: string) => console.log(line));
  const timeoutMs = o.timeoutMs ?? 600_000;
  const started = Date.now();
  const steps: AuditDealResult['steps'] = [];
  let number = 0;
  const step = (name: string, detail: string) => {
    steps.push({ step: name, ms: Date.now() - started });
    say(`${String(++number).padStart(2)}. ${name} (${((Date.now() - started) / 1000).toFixed(1)} s): ${detail}`);
  };
  // A seller's own files are read and checked first: a terms file the schema refuses stops the run before anything starts.
  const files = readSellerFiles(o);
  const custom = files.report !== undefined || files.terms !== undefined;
  const outcome = o.outcome ?? 'released';
  const ownTerms = files.terms?.terms;
  const dir = o.dir ?? mkdtempSync(join(tmpdir(), 'audit-deal-'));
  let selling: RunningSeller | undefined;
  try {
    // ---- The buyer's discovery: the settlement layer both operators serve, and the demo's club and adjudicators ----
    const { reader, pin, clubId, adjudicators } = await discover(o.operators);
    const money = (m: Money) => shown(m, pin.token.symbol, pin.token.decimals);
    const balance = async (address: string): Promise<Money> => ({ token: pin.token.id, amount: String((await reader.trusted(`/v1/balances/${address}`, (x) => x.amount)) ?? '0') });
    // The settlement layer holds one token: terms priced in another are malformed for it.
    if (ownTerms && ownTerms.price.token.toLowerCase() !== pin.token.id.toLowerCase()) {
      throw new UsageError(`refusing the terms file ${plain(basename(files.terms!.path))}, before any deal opens: price.token is ${plain(ownTerms.price.token)}; this settlement layer holds ${pin.token.id} (${pin.token.symbol})`);
    }
    say(`An audit-report deal on ${o.operators.join(' and ')}, settling on ${pin.chain ? `chain ${pin.domain.chainId}` : 'SimChain'} in ${pin.token.symbol}. Test tokens only.`);
    if (custom) {
      say(`The seller's report: ${files.report ? `${plain(files.report.path)}, ${files.report.bytes.length} bytes.` : 'the stub\'s built-in sample, for the buyer\'s scope.'}`);
      say(`The terms: ${files.terms ? `${plain(files.terms.path)}.` : 'the built-in template, examples/seller-adapter.template.json.'}${ownTerms ? ` The club, the adjudicators and the adjudication fee come from discovery, not from the file's clubId ${plain(ownTerms.clubId)} and policyId ${plain(ownTerms.adjudication.policyId)}.` : ''}`);
    }

    // ---- The seller: its own API (a stub here), its adapter, its key ----
    selling = await startSeller({
      operators: o.operators, report: outcome === 'refused' ? 'missing-file' : 'ok', journal: join(dir, 'seller-journal.json'), pollMs: o.pollMs ?? 1000,
      log: (line) => say(`      seller adapter: ${line}`), ...(o.sellerKey ? { sellerKey: o.sellerKey } : {}), ...(o.quoteOverride ? { quoteOverride: o.quoteOverride } : {}),
      ...(files.report ? { reportBytes: files.report.bytes } : {}), ...(ownTerms ? { terms: ownTerms } : {}),
    });
    const { address: seller, adapter } = selling;
    const sellerBefore = await balance(seller);
    step('The seller starts', `its API answers at ${selling.stub.url} and its adapter serves POST ${selling.quoteUrl} for seller ${seller}.`);

    // ---- The buyer: fresh keys, a quote, the offer checked against its own expectation ----
    const signer = await makeKeys(join(dir, 'buyer-keys'), { operators: o.operators });
    step('The buyer makes keys', `buyer ${signer.address}; the key file is in ${join(dir, 'buyer-keys')} with mode 0600.`);

    const quote = await signer.quote(selling.quoteUrl, SCOPE);
    step('The buyer asks for a quote', `commitment ${quote.commitmentId}, price ${money(quote.price)}, offer open until ${plain(quote.expiresAt)}.`);

    const offer = await signer.readOffer(quote.commitmentId);
    // What the buyer expects, from its own scope and the terms both sides know: the built-in template, or the same
    // terms file the seller offers. It is not read from the offer.
    const expected = fill(ownTerms ? templateOf(ownTerms) : JSON.parse(readFileSync(TEMPLATE, 'utf8')), SCOPE);
    const priceUnits = ownTerms?.price.amount ?? PRICE_UNITS;
    const deliverWithinSec = ownTerms?.timing.deliverWithinSec ?? DELIVERY_WINDOW_SEC;
    // The most this buyer pays on top of the price. With its own terms: the adjudication fee they name, plus the
    // operator fee the operators publish for this price.
    const schedule = ownTerms ? await reader.operatorFeeSchedule() : null;
    const maxFees = ownTerms ? BigInt(ownTerms.adjudication.fee.amount) + (schedule ? operatorFeeOf(offer.price, schedule) : 0n) : MAX_FEES_UNITS;
    const fees = BigInt(offer.fees.total.amount) - BigInt(offer.price.amount);
    if (fees > maxFees) throw new Refusal(`refusing to sign: the fees are ${money({ token: pin.token.id, amount: fees.toString() })}, above the ${money({ token: pin.token.id, amount: maxFees.toString() })} this buyer pays`);
    // The window: the offer's delivery deadline is the agreed window after the seller made it, a moment ago.
    const windowSec = Math.round((Date.parse(offer.deadlines.deliverBy) - (await reader.settlementNow())) / 1000);
    if (!(windowSec > deliverWithinSec - 900 && windowSec <= deliverWithinSec + 60)) throw new Refusal(`refusing to sign: the delivery deadline ${plain(String(offer.deadlines.deliverBy))} is ${windowSec} s away, not the ${deliverWithinSec} s agreed`);
    const panel = Array.isArray(expected.rubric?.criteria) && expected.rubric.criteria.length > 0;
    const approved: Approved = {
      seller,
      price: { token: pin.token.id, amount: priceUnits },
      fees: offer.fees,
      deliverable: expected.deliverable,
      checks: expected.checks,
      ...(panel ? { rubric: expected.rubric } : {}),
      deadlines: offer.deadlines,
      adjudicators,
    };
    step('The buyer approves the quote', `price ${money(approved.price)}, adjudication fee ${money(offer.fees.adjudication)}, operator fee ${money(offer.fees.operator)}, total ${money(offer.fees.total)}; delivery by ${plain(String(offer.deadlines.deliverBy))} (${span(deliverWithinSec)}); ${approved.checks.length} checks: ${approved.checks.map((c: J) => plain(String(c.id))).join(', ')}; ${panel ? `a rubric of ${expected.rubric.criteria.length} criteria` : 'no rubric'}.`);

    const granted = await signer.testFunds(offer.fees.total.amount);
    step('The buyer takes test funds', `the faucet granted ${money(granted)} and a mandate in club ${plain(clubId)}.`);

    // Refuses (throws Refusal, naming the field) unless the offer both operators serve equals what the buyer approved.
    // The adjudicator takes a deal within seconds or declines it: wait at most 5 minutes for that.
    await signer.checkOffer(quote.commitmentId, approved, { timeoutMs: Math.min(timeoutMs, 300_000) });
    step('The buyer checks the offer', 'both operators serve the approved terms, the seller\'s signature recovers, and the primary adjudicator took the deal.');

    const paid = await signer.agreeAndFund(quote.commitmentId);
    step('The buyer funds the hold', `paid ${money(paid.total)}: ${money(paid.hold)} into the hold (price and adjudication fee) and ${money(paid.operatorFee)} to the operator.`);

    // ---- The seller's turn: the adapter sees the hold, starts the job, checks the result, delivers or refuses ----
    const stage = () => adapter.deals().find((d) => d.id === quote.commitmentId)?.stage;
    // With the seller's own files the seller's check run decides; with the built-in ones the outcome says which report.
    const ends: Stage[] = custom ? ['delivered', 'refused'] : [outcome === 'released' ? 'delivered' : 'refused'];
    for (const end = Date.now() + timeoutMs; !ends.includes(stage()!); await sleep(100)) {
      if (Date.now() > end) throw new Error(`the seller adapter is still at ${stage()} after ${timeoutMs / 1000} s, waiting for ${ends.join(' or ')}`);
      if (stage() === 'closed' || (stage() === 'refused' && !ends.includes('refused'))) throw new Error(`the seller adapter ended at ${stage()}, not ${ends.join(' or ')}`);
    }
    const sellerStage = stage();
    let failedChecks: string[] = [];
    if (stage() === 'delivered') {
      step('The seller delivers', 'the adapter started the job, the report passed its preflight, and it delivered the encrypted report.');
    } else if (custom) {
      step('The seller does not deliver', 'the report failed the adapter\'s preflight (the lines above name the check), so the adapter delivered nothing.');
      // The seller's check run again, on the exact bytes the seller's API returned, to name each failed check: the
      // report file's, or the stub's for the buyer's scope. A fresh stub starts one job a run, `job-1`, so that request
      // goes to the stub's own address and a fixed path; nothing from a file or a request chooses it.
      const jobId = adapter.deals().find((d) => d.id === quote.commitmentId)?.jobId;
      if (!files.report && jobId !== 'job-1') throw new Error(`the seller adapter started job ${plain(String(jobId))}, not the stub's job-1`);
      const bytes = files.report ? files.report.bytes : new Uint8Array(await (await fetch(`${selling.stub.url}/jobs/job-1/result`)).arrayBuffer());
      const format = approved.deliverable.format;
      const pre = preflightDelivery({ plaintext: bytes, mime: format, format, acceptance: { deterministicChecks: approved.checks, rubric: approved.rubric ?? EMPTY_RUBRIC } });
      const open = new Set(pre.inconclusive);
      failedChecks = pre.refused
        ? [`intake refuses the file (${pre.refused.code}: ${plain(pre.refused.detail)})`]
        : pre.deterministic.filter((c) => !c.passed || open.has(c.checkId)).map((c) => `${plain(c.checkId)} (${c.required ? 'required' : 'optional'})${open.has(c.checkId) ? ' cannot be decided' : ''}${c.detail === undefined ? '' : `: ${plain(c.detail)}`}`);
      // Nothing is delivered and the deadline is the agreed window away: the run stops here, with the hold funded.
      const state = await reader.trusted<string>(`/v1/commitments/${quote.commitmentId}`, (x) => x.escrowState);
      if (state !== 'Held') throw new Error(`the commitment is ${plain(String(state))} on both operators, not Held, after the seller delivered nothing`);
      step('The deal stays Held', `the seller's check run refuses the report: ${failedChecks.join('; ')}. Nothing was delivered. The hold of ${money(paid.hold)} stays funded until the delivery deadline ${plain(String(offer.deadlines.deliverBy))}; after it the buyer may reclaim the hold. This local world ends with the run.`);
      const sellerReceived = { token: pin.token.id, amount: (BigInt((await balance(seller)).amount) - BigInt(sellerBefore.amount)).toString() };
      say(`    Paid: ${money(paid.total)} (hold ${money(paid.hold)}, operator fee ${money(paid.operatorFee)}).`);
      return {
        commitmentId: quote.commitmentId, outcome: 'Held', buyer: signer.address, seller, offer, paid, sellerStage, delivery: null, failedChecks, report: null,
        sellerReceived, buyerHolds: await balance(signer.address), steps, elapsedMs: Date.now() - started,
      };
    } else {
      step('The seller does not deliver', 'the report failed the adapter\'s preflight (the lines above name the check), so the adapter delivered nothing.');
      // Nothing is delivered, so nothing is judged. After the delivery deadline anyone may send the reclaim.
      const deliverBy = Date.parse(offer.deadlines.deliverBy);
      const waitSec = Math.ceil((deliverBy - (await reader.settlementNow())) / 1000) + 2;
      if (o.advanceClock) await o.advanceClock(waitSec);
      else if (waitSec * 1000 > timeoutMs) throw new Error(`the delivery deadline is ${waitSec} s away, and this world has no clock to move: run the refused outcome on the local world`);
      while ((await reader.settlementNow()) <= deliverBy) await sleep(200);
      step('The delivery deadline passes', `${o.advanceClock ? `this world's clock moved ${waitSec} s forward` : `waited ${waitSec} s`}; settlement time is past ${plain(String(offer.deadlines.deliverBy))}.`);
      // The reclaim needs no signature: the deadline is its authority. On a chain the operators send it themselves.
      const state = await reader.trusted<string>(`/v1/commitments/${quote.commitmentId}`, (x) => x.escrowState);
      if (state === 'Held') await reader.call('POST', `/v1/commitments/${quote.commitmentId}/triggers/reclaim`, {});
      step('The buyer reclaims the hold', 'POST /v1/commitments/<id>/triggers/reclaim, with no signature.');
    }

    // ---- The outcome: the buyer waits for both operators, opens the report on a release, keeps the receipt ----
    const delivery = await signer.openDelivery(quote.commitmentId, { timeoutMs });
    let report: AuditDealResult['report'] = null;
    if (delivery.work !== null) {
      // The buyer's own run of the adjudicator's first stage on the opened bytes, against the checks it approved.
      const bytes = new TextEncoder().encode(delivery.work);
      const format = approved.deliverable.format;
      const pre = preflightDelivery({ plaintext: bytes, mime: format, format, acceptance: { deterministicChecks: approved.checks, rubric: EMPTY_RUBRIC } });
      let findings = 0;
      try {
        const parsed = JSON.parse(delivery.work);
        findings = Array.isArray(parsed?.findings) ? parsed.findings.length : 0;
      } catch {
        // Not JSON: the checks above already say so.
      }
      report = { bytes: bytes.length, plaintextSha256: delivery.plaintextSha256 ?? pre.plaintextSha256, checks: pre.result, findings };
    }
    const after = await balance(seller);
    const sellerReceived = { token: pin.token.id, amount: (BigInt(after.amount) - BigInt(sellerBefore.amount)).toString() };
    const buyerHolds = await balance(signer.address);
    if (delivery.outcome === 'Released') {
      step('The deal ends Released', `the seller received ${money(sellerReceived)}. The buyer opened the report: ${report!.bytes} bytes, ${report!.plaintextSha256}, ${report!.findings} findings; the buyer's own run of the ${approved.checks.length} checks says ${report!.checks}.`);
    } else {
      step('The deal ends Refunded', `the hold is back: the buyer's key holds ${money(buyerHolds)} of the ${money(paid.total)} it paid; the operator fee is not refundable. The seller received ${money(sellerReceived)}. No report was released.`);
    }

    say(`    Paid: ${money(paid.total)} (hold ${money(paid.hold)}, operator fee ${money(paid.operatorFee)}).`);
    say(`    Receipt: ${JSON.stringify(delivery.receipt)}`);
    if (delivery.transactions.length === 0) say('    Transactions: none; SimChain has no transactions.');
    for (const t of delivery.transactions) say(`    Transaction, ${plain(t.step)}: ${t.url ?? t.tx}`);
    return {
      commitmentId: quote.commitmentId, outcome: delivery.outcome, buyer: signer.address, seller, offer, paid, sellerStage, delivery, failedChecks, report,
      sellerReceived, buyerHolds, steps, elapsedMs: Date.now() - started,
    };
  } finally {
    await selling?.close();
    if (!o.dir) rmSync(dir, { recursive: true, force: true });
  }
}

export interface LocalWorld {
  operators: string[];
  /** Moves this world's settlement time forward. */
  advanceClock(seconds: number): void;
  close(): Promise<void>;
}

/**
 * The public demo's world on SimChain, served in this process as two operator nodes, with a clock this process can
 * move. The operators charge 1 basis point, at least 0.01 tUSD, so the deal pays an operator fee as the live one does.
 */
export async function startLocalWorld(): Promise<LocalWorld> {
  const { MemoryStorage, PublicWorld } = await import('@holdback/demo-cloud');
  const { serveTwoOrigins } = await import('./two-origins.ts');
  let aheadMs = 0;
  const world = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000' }, now: () => Date.now() + aheadMs, telemetryLog: () => {} });
  const served = await serveTwoOrigins(world, { tickMs: 100 });
  return { operators: served.urls, advanceClock: (seconds) => void (aheadMs += seconds * 1000), close: served.close };
}

export interface AuditDealArgs {
  live: boolean;
  reportFile?: string;
  termsFile?: string;
}

export const USAGE = 'usage: pnpm audit-deal [--live]\n       pnpm audit-deal [--report <report file>] [--terms <terms file>]   (the local world only)';

/** The command line: `--live`, or a seller's own `--report` and `--terms` files. Anything else is refused. */
export function parseArgs(argv: readonly string[]): AuditDealArgs {
  const args: AuditDealArgs = { live: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--live') args.live = true;
    else if (a === '--report' || a === '--terms') {
      const file = argv[++i];
      if (file === undefined || file.startsWith('--')) throw new UsageError(`${a} needs a file`);
      const key = a === '--report' ? 'reportFile' : 'termsFile';
      if (args[key] !== undefined) throw new UsageError(`${a} is given twice`);
      args[key] = file;
    } else throw new UsageError(`unknown option ${plain(a)}`);
  }
  if (args.live && (args.reportFile !== undefined || args.termsFile !== undefined)) throw new UsageError('--report and --terms run on the local world only: leave out --live');
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let args: AuditDealArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`audit-deal: ${plain((e as Error).message)}\n${USAGE}`);
    process.exit(2);
  }
  const { live } = args;
  const custom = args.reportFile !== undefined || args.termsFile !== undefined;
  const world = live ? undefined : await startLocalWorld();
  const operators = world?.operators ?? (process.env['HOLDBACK_OPERATORS'] || LIVE_OPERATORS).split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  // Every request an operator refuses, with its Request-Id: the operators keep one log line per request under that ID.
  const refusedRequests: string[] = [];
  const send = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const res = await send(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (res.status >= 400 && operators.some((op) => new URL(op).origin === url.origin)) refusedRequests.push(`${init?.method ?? 'GET'} ${url.pathname} answered ${res.status}, Request-Id ${plain(res.headers.get('request-id') ?? 'none')}`);
    return res;
  };
  let code = 0;
  try {
    const outcomes: Array<AuditDealOptions['outcome']> = custom ? [undefined] : live ? ['released'] : ['released', 'refused'];
    for (const outcome of outcomes) {
      console.log(outcome ? `\n== Outcome: ${outcome} ==` : '\n== The seller\'s own report and terms ==');
      // On the live service the key store stays, in case the buyer's key still holds test tokens; its path is printed.
      const dir = live ? mkdtempSync(join(tmpdir(), 'audit-deal-live-')) : undefined;
      if (dir) console.log(`The buyer's key store and the seller's journal stay in ${dir}.`);
      // A live deal waits for blocks: poll every 3 s and wait up to 20 minutes for each step.
      const r = await runAuditDeal({
        operators, ...(outcome ? { outcome } : {}), ...(args.reportFile !== undefined ? { reportFile: args.reportFile } : {}), ...(args.termsFile !== undefined ? { termsFile: args.termsFile } : {}),
        ...(world ? { advanceClock: world.advanceClock, pollMs: 200 } : { pollMs: 3000, timeoutMs: 1_200_000 }), ...(dir ? { dir } : {}),
      });
      console.log(`Result: ${r.outcome}. Commitment ${r.commitmentId}; ${(r.elapsedMs / 1000).toFixed(1)} s.`);
      if (custom && r.outcome !== 'Released') code = 1;
    }
  } catch (e) {
    console.error(`audit-deal: ${plain((e as Error).message)}${e instanceof UsageError ? `\n${USAGE}` : ''}`);
    // The built-in run exits 1 on any failure, as before. With a seller's own files, 1 means the report does not settle.
    code = custom ? 2 : 1;
  } finally {
    for (const line of refusedRequests) console.error(`  refused request: ${line}`);
    await world?.close();
  }
  process.exit(code);
}
