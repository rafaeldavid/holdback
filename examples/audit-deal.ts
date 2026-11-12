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
// The pilot's cases (T-355), each one deal through the seller adapter, started from one configuration file the run
// writes, and the buyer signer, which shows every signed field and the differences from the seller's defaults:
//   pnpm audit-deal --case <case|all> [--report <file>] [--terms <file>] [--scope <JSON>] [--mapping <file>]
//                   [--refused-report <file>] [--out <dir>]
//   released         the report passes; Released, the seller paid
//   redelivered      the seller's check run refuses a first report and alerts the seller, which fixes it and says so;
//                    the fixed report is delivered before the deadline; Released
//   rubric           the buyer's terms carry a rubric (a terms file without one gets the template's): the report passes
//                    the checks and the panel; Released
//   refunded         the same, and the panel rejects the report after delivery; Refunded. Local only: the world's judges
//                    are a stand-in set to reject
//   missed-deadline  the job never finishes; the buyer's signer reclaims the hold after the deadline; Refunded
//   shown-mismatch   the operators raise their fee after the buyer saw the offer; the signer refuses before any
//                    signature; Not funded. Local only: an operator front of the local world raises the fee
//   resume           the buyer stops after funding, the seller's adapter restarts (with --mapping, a report mapping is
//                    set), days pass, and the buyer resumes from its key store; Released
//   two-addresses    the buyer's payment address is apart from its signing key (ADR-0033): a test key standing in for
//                    a person's wallet signs the signer's two typed-data files as it reads them; the payment address
//                    funds the deal, and the signing key's balance does not move; Released
// Each case prints its end state and the path of its deal record (deal-record.ts), in <out>/<case>/deal-record.json.
// Exit code 0 when every case ends as expected, 1 when one does not, 2 when the run cannot start or stops on an error.
// A live case: --live --case <case>, with HOLDBACK_OPERATORS, and optionally --keys <key store> --buyer <address> for
// an unused key in an existing key store (one key, one deal). Live, every wait is real time and no step has a limit.
// CROW_REHEARSAL_PAYMENT_KEY (live, a test key): its address pays for every case, as a person's wallet would, from the
// signer's typed-data files, and each case makes a fresh signing key that holds no deal money (item 81). Without it the
// two-addresses case makes a payment key of its own.
//
// The report is the seller's data. This file parses it as JSON inside the check library and counts its findings. It
// prints none of its text and runs nothing from it. The terms file is data too: it is parsed as YAML with no custom
// tags, checked against the commitment schema, and nothing in it runs.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { honestVerdict, preflightDelivery, type JudgeProvider } from '@holdback/judgment';
import { parseTermsYaml, plain, type TermsTemplate } from '@holdback/testkit';
import type { Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { Agent } from './agent.ts';
import { loadKeys, makeKeys, openDeals, printable, type Approved, type BuyerSigner, type Delivery, type Difference, type Money, type Offer, type Paid, type Report } from './buyer-signer.ts';
import type { Row } from './deal-record.ts';
import { config as adapterConfig, fill, loadConfig, startSellerAdapter, type RunningAdapter, type Stage } from './seller-adapter.ts';
import { startStubSellerApi, type StubSellerApi } from './seller-adapter-stub.ts';
import { checkPaymentFile, jcs, knownPins, operatorFeeOf, Refusal } from './verify.ts';

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
  outcome: 'Released' | 'Refunded' | 'Held' | 'Settled'; // Settled: a mutual settlement (T-390); the rehearsal makes none
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
export function readSellerFiles(o: { reportFile?: string | undefined; termsFile?: string | undefined }): SellerFiles {
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

/** The adapter's template from a terms file: its deliverable, checks, rubric and adjudication fee, in the shapes of an offer. */
const templateOf = (t: TermsTemplate) => ({ deliverable: t.deliverable, checks: t.acceptance.deterministicChecks, rubric: t.acceptance.rubric, fee: { token: t.adjudication.fee.token, amount: t.adjudication.fee.amount } });

/** A window in whole days when it is one, in seconds otherwise. */
const span = (sec: number) => (sec > 0 && sec % 86_400 === 0 ? `${sec / 86_400} day${sec === 86_400 ? '' : 's'}` : `${sec} s`);

/**
 * The seller's own report as every job's result: the report file's bytes, served unchanged, for a job the stub
 * started. The route sends no request. It compares the whole path with the paths of the jobs the stub holds in this
 * process, so nothing from the request is placed in a URL; any other path answers 404.
 */
async function serveReport(stub: StubSellerApi, bytes: Uint8Array | null): Promise<{ result: string; set(bytes: Uint8Array | null): void; close(): Promise<void> }> {
  // null: the job still runs, and the route answers 202 as the seller's API does (T-355).
  let current = bytes;
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://report').pathname;
    const job = req.method === 'GET' ? stub.jobs().find((j) => path === `/jobs/${encodeURIComponent(j.jobId)}/result`) : undefined;
    if (!job) return void res.writeHead(404, { 'content-type': 'application/json' }).end('{"detail":"not found"}');
    if (current === null) return void res.writeHead(202, { 'content-type': 'application/json' }).end('{"status":"running"}');
    res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(current);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { result: `${url}/jobs/{jobId}/result`, set: (b) => void (current = b), close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
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
      commitmentId: quote.commitmentId, // the approval names the offer it approves (T-368)
      seller,
      price: { token: pin.token.id, amount: priceUnits },
      fees: offer.fees,
      deliverable: expected.deliverable,
      checks: expected.checks,
      ...(panel ? { rubric: expected.rubric } : {}),
      deadlines: offer.deadlines,
      adjudicators,
      // Item 25 of the plan's follow-ups: the signed fields the offer view shows, approved as shown, as the pilot's cases do.
      settlement: offer.settlement, disclosure: offer.disclosure, clubId: offer.clubId, rulebookHash: offer.rulebookHash, policyId: offer.policyId, policyHash: offer.policyHash, registryHash: offer.registryHash, maxSubmissions: offer.maxSubmissions,
      sellerPayoutAddress: offer.sellerPayoutAddress,
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
  /**
   * What the judges decide on a rubric deal here (T-355). They stand in for the models: no model runs, each verdict's
   * rationale reads "fake judge: pass" or "fake judge: fail", and they pass until this is set.
   */
  setPanel(verdict: 'pass' | 'fail'): void;
  /**
   * The same world on two more origins: an operator front that, once `raiseFeeBps` is called, publishes an operator
   * fee that many basis points above this world's (T-355). What a buyer meets when the operators change their fee
   * after it was shown an offer. It rewrites the discovery document's answer only, and sends no request.
   */
  front(): Promise<{ operators: string[]; raiseFeeBps(bps: number): void; close(): Promise<void> }>;
  close(): Promise<void>;
}

/**
 * The public demo's world on SimChain, served in this process as two operator nodes, with a clock this process can
 * move. The operators charge 1 basis point, at least 0.01 tUSD, so the deal pays an operator fee as the live one does.
 * A rubric deal's judges are a stand-in this process sets (`setPanel`); a checks-only deal never meets them.
 */
export async function startLocalWorld(): Promise<LocalWorld> {
  const { MemoryStorage, PublicWorld } = await import('@holdback/demo-cloud');
  const { serveTwoOrigins } = await import('./two-origins.ts');
  let aheadMs = 0;
  let verdict: 'pass' | 'fail' = 'pass';
  const judgeProvider: JudgeProvider = { complete: async (req) => honestVerdict(req, verdict) };
  const world = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000' }, now: () => Date.now() + aheadMs, telemetryLog: () => {}, judgeProvider, liveCallsPerDay: 1_000_000 });
  const served = await serveTwoOrigins(world, { tickMs: 100 });
  const fronts: Array<{ close(): Promise<void> }> = [];
  return {
    operators: served.urls,
    advanceClock: (seconds) => void (aheadMs += seconds * 1000),
    setPanel: (v) => void (verdict = v),
    front: async () => {
      let extra: number | null = null;
      const rewrite = (_node: number, path: string, body: string): string | undefined => {
        if (extra === null || new URL(path, 'http://front').pathname !== '/.well-known/holdback.json') return undefined;
        const j = JSON.parse(body) as J;
        const fee = j.fees?.operator;
        if (!fee || !Number.isSafeInteger(fee.bps)) return undefined;
        return JSON.stringify({ ...j, fees: { ...j.fees, operator: { ...fee, bps: fee.bps + extra } } });
      };
      const f = await serveTwoOrigins(world, { rewrite });
      fronts.push(f);
      return { operators: f.urls, raiseFeeBps: (bps) => void (extra = bps), close: f.close };
    },
    close: async () => {
      for (const f of fronts) await f.close();
      await served.close();
    },
  };
}

// ---- The pilot's cases (T-355) ----
//
// Each case is one deal through the seller adapter, started from one configuration file the run writes, and the
// buyer signer, which shows the buyer every signed field and what differs from the seller's published defaults
// before it approves. Each case leaves a deal record (deal-record.ts) in its directory.

export const CASES = ['released', 'redelivered', 'rubric', 'refunded', 'missed-deadline', 'shown-mismatch', 'resume', 'two-addresses'] as const;
export type CaseName = (typeof CASES)[number];
/** `Not funded`: the buyer's signer refused before any signature, so the commitment never reached a hold. */
export type EndState = 'Released' | 'Refunded' | 'Held' | 'Not funded' | 'Settled'; // Settled: a mutual settlement (T-390); no case expects one
/** How each case should end. A case that ends otherwise makes the command exit 1. */
export const EXPECTED: Record<CaseName, EndState> = { released: 'Released', redelivered: 'Released', rubric: 'Released', refunded: 'Refunded', 'missed-deadline': 'Refunded', 'shown-mismatch': 'Not funded', resume: 'Released', 'two-addresses': 'Released' };
/** The cases only the local world can rehearse, and why. */
const LOCAL_ONLY: Partial<Record<CaseName, string>> = {
  refunded: "it needs the local world's stand-in for the judges, set to reject",
  'shown-mismatch': "it needs the local world's operator front, which raises the fee after the buyer saw the offer",
};

export interface RehearsalOptions {
  case: CaseName;
  /** Two or more operators at distinct origins. */
  operators: string[];
  /** The local world: its clock, its judges and its operator front. Without it (the live service) every wait is real time. */
  world?: LocalWorld | undefined;
  /** The case's directory: the seller's configuration file, template and journal, the buyer's key store, the deal record. */
  dir: string;
  reportFile?: string | undefined;
  termsFile?: string | undefined;
  /** redelivered: the seller's first report, which its check run refuses. Default: the seller's report cut to its first half. */
  refusedReportFile?: string | undefined;
  /** A mapping file (report-converter.ts): the report is in the seller's own shape, and the adapter converts it. */
  mappingFile?: string | undefined;
  /** The buyer's scope, as it sends it with the quote. Default SCOPE. */
  scope?: J;
  /** A key store and the address of an unused key in it (a rehearsal key), instead of fresh keys. One key serves one deal. */
  keys?: { store: string; buyer: string } | undefined;
  /**
   * The key of a payment address apart from the buyer's signing key (ADR-0033), standing in for a person's own wallet:
   * it signs the signer's typed-data files as it reads them, and nothing else. With it every case makes a fresh signing
   * key, which holds no deal money, and reuses this payment address (item 81). Test keys only. The two-addresses case
   * makes one when none is given.
   */
  paymentKey?: Hex | undefined;
  log?: (line: string) => void;
  /** The longest wait for one step, in milliseconds. Default: none (D31); the deal's own deadlines end it. */
  timeoutMs?: number | undefined;
  /** How often the adapter and the signer read the operators, in milliseconds. Default 1,000. */
  pollMs?: number | undefined;
  /** Tests: the seller's signing key. Default: a fresh key that stays in memory. */
  sellerKey?: Hex;
}

export interface RehearsalResult {
  case: CaseName;
  end: EndState;
  /** Whether the case ended as `EXPECTED` says. */
  expected: boolean;
  commitmentId: Hex;
  buyer: string;
  seller: string;
  dir: string;
  /** The offer as both operators served it, as the buyer was shown it. */
  offer: Offer;
  /** What the buyer was shown before it approved: the seven signed fields of T-332 with maxSubmissions, and the differences from the defaults. */
  shown: { signed: Record<string, J>; differences: Difference[] };
  paid: Paid | null;
  /** shown-mismatch: the signer's refusal. */
  refusal: string | null;
  delivery: Delivery | null;
  /** Settlement refunded the hold on the signer's reclaim, after the delivery deadline. */
  reclaimed: boolean;
  /** The kinds of report the signer's watch made, in order. */
  reports: Array<Report['kind']>;
  /** The alerts the seller's callback received, each with whether its signature checked. The seller's data: never printed whole. */
  alerts: Array<J & { type: string; signed: boolean }>;
  sellerReceived: Money;
  /** What the buyer's payment address holds at the end: its signing key's, when the two are one. */
  buyerHolds: Money;
  /** The buyer's payment address, and how much the signing key's balance moved after the test funds (0 when they are apart). */
  paymentAddress: string;
  signingKeyMoved: string;
  /** The deal record's path, and its one-row summary. */
  record: string;
  row: Row;
  steps: Array<{ step: string; ms: number }>;
  elapsedMs: number;
}

type Alerts = Array<J & { type: string; signed: boolean }>;

/**
 * The seller's alert callback: it keeps each alert the adapter posts, with whether its HMAC-SHA256 signature checks
 * against the secret the adapter signs with. It runs nothing from an alert and answers 204.
 */
async function alertSink(secret: string): Promise<{ url: string; alerts: Alerts; close(): Promise<void> }> {
  const alerts: Alerts = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= 1_048_576) chunks.push(c);
    });
    req.on('end', () => {
      if (req.method !== 'POST' || size > 1_048_576) return void res.writeHead(400).end();
      const text = Buffer.concat(chunks);
      const want = Buffer.from(`sha256=${createHmac('sha256', secret).update(text).digest('hex')}`);
      const got = Buffer.from(String(req.headers['x-crow-signature'] ?? ''));
      let body: J = null;
      try {
        body = JSON.parse(text.toString('utf8'));
      } catch {
        // Not JSON: not an alert this adapter sends.
      }
      if (body && typeof body.type === 'string') alerts.push({ ...body, signed: got.length === want.length && timingSafeEqual(got, want) });
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/alerts`;
  return { url, alerts, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

interface CaseSeller {
  address: string;
  /** The adapter's address: POST /quote, GET /defaults, POST /deals/<id>/ready. */
  url(): string;
  adapter(): RunningAdapter;
  alerts: Alerts;
  config: string;
  /** What the seller's API returns from now on: the good report, or the one its check run refuses. Ends a running job. */
  serve(which: 'good' | 'refused'): void;
  /** The seller says its fixed report is ready: POST /deals/<id>/ready with its credential. Returns the status. */
  ready(id: Hex): Promise<number>;
  /** Closes the adapter and starts it again from the same configuration file and journal. */
  restart(): Promise<void>;
  close(): Promise<void>;
}

/**
 * The seller's side of one case: the stub of its API (with the seller's own report served at a result route of this
 * file when it gave one), an alert callback, and the adapter started from one configuration file written to `dir`.
 * The configuration names environment variables only; the key and the two credentials reach the adapter as
 * environment values and nothing here prints them.
 */
async function startCaseSeller(o: {
  operators: string[]; dir: string; token: string; terms: TermsTemplate | undefined; template: J | null; report: { good: Uint8Array; refused: Uint8Array } | undefined;
  mapping: string | undefined; initial: 'good' | 'refused' | 'running'; pollMs: number; log: (line: string) => void; sellerKey?: Hex | undefined;
}): Promise<CaseSeller> {
  const sellerKey = o.sellerKey ?? generatePrivateKey();
  const address = privateKeyToAccount(sellerKey).address.toLowerCase();
  const t = o.terms;
  const builtIn = (which: 'good' | 'refused') => (which === 'refused' ? 'missing-file' : o.mapping ? 'own-shape' : 'ok') as 'ok' | 'missing-file' | 'own-shape';
  // A job that runs until the case says it finished answers 202 until then.
  const stub = await startStubSellerApi({
    port: 0, token: o.token, report: builtIn(o.initial === 'refused' ? 'refused' : 'good'), pollsUntilComplete: o.initial === 'running' ? Number.MAX_SAFE_INTEGER : 0,
    ...(t ? { quoteOverride: { price: { ...t.price }, deliverWithinSec: t.timing.deliverWithinSec } } : {}),
  });
  const closers: Array<() => Promise<void>> = [() => stub.close()];
  const closeAll = async () => {
    for (const close of closers.reverse()) await close();
  };
  try {
    const served = o.report ? await serveReport(stub, o.initial === 'running' ? null : o.initial === 'refused' ? o.report.refused : o.report.good) : undefined;
    if (served) closers.push(() => served.close());
    const secret = randomBytes(32).toString('hex');
    const readyCredential = randomBytes(32).toString('hex');
    const sink = await alertSink(secret);
    closers.push(() => sink.close());
    if (o.template) writeFileSync(join(o.dir, 'seller-template.json'), `${JSON.stringify(o.template, null, 2)}\n`);
    const w = t?.timing;
    const config = join(o.dir, 'seller-adapter.config.json');
    const settings = {
      port: 0,
      sellerApi: { ...stub.api, ...(served ? { result: served.result } : {}) },
      ...(o.template ? { template: 'seller-template.json' } : {}),
      ...(o.mapping ? { reportMapping: resolve(o.mapping) } : {}),
      scope: adapterConfig.scope,
      ...(w ? { timing: { offerExpiresInSec: w.offerExpiresInSec, fundWithinSec: w.fundWithinSec, deliverWithinSec: w.deliverWithinSec, judgeWithinSec: w.judgeWithinSec, fallbackWithinSec: w.fallbackWithinSec, appealWindowSec: w.appealWindowSec, appealDecideSec: w.appealDecideSec } } : {}),
      journal: join(o.dir, 'seller-journal.json'),
      pollMs: o.pollMs,
      alerts: { callback: sink.url, secretEnv: 'HOLDBACK_ALERT_SECRET' },
      // No scheduled refetch: the adapter fetches a fixed report when the seller says it is ready.
      redelivery: { readyAuth: { kind: 'bearer', env: 'HOLDBACK_READY_CREDENTIALS' } },
    };
    writeFileSync(config, `${JSON.stringify(settings, null, 2)}\n`);
    const env = { HOLDBACK_KEY: sellerKey, HOLDBACK_OPERATORS: o.operators.join(','), HOLDBACK_ALERT_SECRET: secret, HOLDBACK_READY_CREDENTIALS: readyCredential };
    const start = () => startSellerAdapter({ ...loadConfig(config), log: o.log }, env);
    let adapter = await start();
    closers.push(() => adapter.close());
    return {
      address, config, alerts: sink.alerts, url: () => adapter.url, adapter: () => adapter,
      serve: (which) => {
        if (served) served.set(which === 'good' ? o.report!.good : o.report!.refused);
        else stub.setReport(builtIn(which));
        stub.completeAll();
      },
      ready: async (id) => {
        const res = await fetch(`${adapter.url}/deals/${id}/ready`, { method: 'POST', headers: { authorization: `Bearer ${readyCredential}` } });
        await res.body?.cancel();
        return res.status;
      },
      restart: async () => {
        await adapter.close();
        adapter = await start();
      },
      close: closeAll,
    };
  } catch (e) {
    await closeAll();
    throw e;
  }
}

/** A value from the seller or the operators in one line: JSON, at most 120 code points, with no hidden characters. */
const brief = (v: J): string => printable([...JSON.stringify(v ?? null)].slice(0, 120).join(''));

/**
 * Runs one of the pilot's cases to its end and writes its deal record. Throws when a step fails, or when the buyer's
 * signer refuses an offer outside the shown-mismatch case. The report, the mapping and the terms stay data: nothing in
 * them runs, and no request's host comes from them.
 */
export async function rehearse(o: RehearsalOptions): Promise<RehearsalResult> {
  const say = o.log ?? ((line: string) => console.log(line));
  const name = o.case;
  const timeoutMs = o.timeoutMs ?? Number.MAX_SAFE_INTEGER;
  const pollMs = o.pollMs ?? 1000;
  const started = Date.now();
  const steps: RehearsalResult['steps'] = [];
  let number = 0;
  const step = (title: string, detail: string) => {
    steps.push({ step: title, ms: Date.now() - started });
    say(`${String(++number).padStart(2)}. ${title} (${((Date.now() - started) / 1000).toFixed(1)} s): ${detail}`);
  };
  if (!o.world && LOCAL_ONLY[name]) throw new UsageError(`--live cannot run ${name}: ${LOCAL_ONLY[name]}`);
  mkdirSync(o.dir, { recursive: true });
  // The seller's files are read and checked first: a terms file the schema refuses stops the case before anything starts.
  const files = readSellerFiles(o);
  const ownTerms = files.terms?.terms;
  const scope = o.scope ?? SCOPE;
  const panel = name === 'rubric' || name === 'refunded';
  const shipped = JSON.parse(readFileSync(TEMPLATE, 'utf8')) as J;

  // The deal's template. Built-in: the shipped one, and a buyer's option adds its rubric. With terms: the terms', and a
  // rubric case adds the shipped template's optional rubric when the terms carry none.
  let template: J | null = ownTerms ? templateOf(ownTerms) : null;
  let options: J = undefined;
  let addedRubric = false;
  if (panel && !ownTerms) options = { panel: true };
  if (panel && ownTerms && !(ownTerms.acceptance.rubric.criteria.length > 0)) {
    template = { ...template, rubric: shipped.optionalRubric };
    addedRubric = true;
  }
  // What the buyer expects, from its own scope and the terms both sides know, not read from the offer.
  const theirs = template ?? { deliverable: shipped.deliverable, checks: shipped.checks, rubric: options?.panel ? shipped.optionalRubric : EMPTY_RUBRIC };
  const expected = fill({ deliverable: theirs.deliverable, checks: theirs.checks, rubric: theirs.rubric ?? EMPTY_RUBRIC }, scope);
  const hasRubric = Array.isArray(expected.rubric?.criteria) && expected.rubric.criteria.length > 0;

  // The redelivered case's first report, which the seller's check run refuses.
  let report: { good: Uint8Array; refused: Uint8Array } | undefined;
  if (files.report) {
    const given = o.refusedReportFile !== undefined ? readSellerFiles({ reportFile: o.refusedReportFile }).report! : undefined;
    report = { good: files.report.bytes, refused: given?.bytes ?? files.report.bytes.slice(0, Math.floor(files.report.bytes.length / 2)) };
    if (name === 'redelivered' && !o.mappingFile) {
      const format = expected.deliverable.format;
      const pre = preflightDelivery({ plaintext: report.refused, mime: format, format, acceptance: { deterministicChecks: expected.checks, rubric: expected.rubric } });
      if (pre.result === 'accept' || pre.result === 'panel') throw new UsageError(`the seller's check run accepts the first report of the redelivered case too, so nothing would be refused: name one it refuses with --refused-report`);
    }
  }

  const { reader, pin, adjudicators } = await discover(o.operators);
  const money = (m: Money) => shown(m, pin.token.symbol, pin.token.decimals);
  const balance = async (address: string): Promise<Money> => ({ token: pin.token.id, amount: String((await reader.trusted(`/v1/balances/${address}`, (x) => x.amount)) ?? '0') });
  if (ownTerms && ownTerms.price.token.toLowerCase() !== pin.token.id.toLowerCase()) {
    throw new UsageError(`refusing the terms file ${plain(basename(files.terms!.path))}, before any deal opens: price.token is ${plain(ownTerms.price.token)}; this settlement layer holds ${pin.token.id} (${pin.token.symbol})`);
  }
  say(`Case ${name}: an audit-report deal on ${o.operators.join(' and ')}, settling on ${pin.chain ? `chain ${pin.domain.chainId}` : 'SimChain'} in ${pin.token.symbol}. Test tokens only.`);
  // The faucet is the only source of funds here: its largest grant is the most one deal can cost on this service.
  const maxGrant = await reader.trusted<J>('/.well-known/holdback.json', (x) => x.demo?.faucet?.maxGrant ?? null);
  if (maxGrant && typeof maxGrant.amount === 'string') say(`${o.world ? "This world's" : "The test service's"} faucet grants at most ${money({ token: pin.token.id, amount: maxGrant.amount })} a deal: a price plus both fees above that cannot be funded here. This tool adds no limit of its own (D31).`);
  say(`The seller's report: ${files.report ? `${plain(files.report.path)}, ${files.report.bytes.length} bytes` : "the stub's built-in sample, for the buyer's scope"}${o.mappingFile ? `, in the seller's own shape, converted by ${plain(o.mappingFile)}` : ''}. The terms: ${files.terms ? plain(files.terms.path) : 'the built-in template, examples/seller-adapter.template.json'}.`);
  if (addedRubric) say(`The terms carry no rubric: this case adds the template's optional rubric of ${shipped.optionalRubric.criteria.length} criteria, as a buyer's panel option would.`);
  if (name === 'redelivered') say(`The first report: ${o.refusedReportFile !== undefined ? plain(o.refusedReportFile) : files.report ? `the seller's report cut to its first half, ${report!.refused.length} of ${report!.good.length} bytes` : "the stub's report with the last file in scope left out"}.`);
  if (name === 'refunded') say("The judges: the local world's panel is a stand-in set to reject: no model runs, and each verdict reads \"fake judge: fail\".");

  const initial = name === 'redelivered' ? 'refused' : name === 'missed-deadline' || name === 'resume' ? 'running' : 'good';
  let selling: CaseSeller | undefined;
  let front: Awaited<ReturnType<LocalWorld['front']>> | undefined;
  if (name === 'refunded') o.world!.setPanel('fail');
  try {
    // ---- The seller: its API (a stub here), its alert callback, its adapter from one configuration file ----
    selling = await startCaseSeller({
      operators: o.operators, dir: o.dir, token: pin.token.id, terms: ownTerms, template, report, mapping: o.mappingFile, initial, pollMs,
      log: (line) => say(`      seller adapter: ${line}`), sellerKey: o.sellerKey,
    });
    const seller = selling.address;
    const sellerBefore = await balance(seller);
    step('The seller starts', `its adapter started from one configuration file, ${selling.config}, and serves POST ${selling.url()}/quote and GET ${selling.url()}/defaults for seller ${seller}.`);

    // ---- The buyer: keys, a quote, the offer shown with every signed field and the differences from the defaults ----
    if (name === 'shown-mismatch') front = await o.world!.front();
    const buyerOperators = front?.operators ?? o.operators;
    // A payment address apart from the signing key (ADR-0033): a test key standing in for a person's own wallet, which
    // only ever signs the typed-data files the signer writes. With it the signing key is fresh for every case (item 81).
    const paymentKey = o.paymentKey ?? (name === 'two-addresses' ? generatePrivateKey() : undefined);
    const wallet = paymentKey ? privateKeyToAccount(paymentKey) : undefined;
    if (wallet && o.keys) throw new UsageError('--keys and a payment key do not go together: with a payment address every case makes a fresh signing key, which holds no money');
    const store = o.keys?.store ?? join(o.dir, 'buyer-keys');
    const quiet = { operators: buyerOperators, log: (line: string) => say(`    ${line}`) };
    let signer: BuyerSigner = o.keys ? await loadKeys(o.keys.store, o.keys.buyer, quiet) : await makeKeys(store, { ...quiet, ...(wallet ? { paymentAddress: wallet.address } : {}) });
    step(o.keys ? 'The buyer opens its key' : 'The buyer makes keys', `buyer ${signer.address}; the key file is in ${store}${o.keys ? '' : ' with mode 0600'}${wallet ? `; the payment address ${signer.paymentAddress} funds the deal and receives every refund` : ''}.`);
    if (front) say(`    The buyer reads the operators through a front, ${front.operators.join(' and ')}, that serves this world unchanged until it raises the fee.`);

    const quote = await signer.quote(`${selling.url()}/quote`, scope, options);
    const id = quote.commitmentId;
    step('The buyer asks for a quote', `commitment ${id}, price ${money(quote.price)}${options ? `, with the option ${brief(options)}` : ''}, offer open until ${plain(quote.expiresAt)}.`);

    const offer = await signer.readOffer(id, { defaults: `${selling.url()}/defaults` });
    const signed: Record<string, J> = {
      'settlement.mode': offer.settlement.mode, 'disclosure.level': offer.disclosure.level, clubId: offer.clubId, rulebookHash: offer.rulebookHash,
      policyId: offer.policyId, policyHash: offer.policyHash, registryHash: offer.registryHash, maxSubmissions: offer.maxSubmissions,
    };
    const differences = offer.differences ?? [];
    const rubricSize = Array.isArray(offer.rubric?.criteria) ? offer.rubric.criteria.length : 0;
    step('The buyer is shown the offer', `price ${money(offer.price)}, adjudication fee ${money(offer.fees.adjudication)}, operator fee ${money(offer.fees.operator)}, total ${money(offer.fees.total)}; delivery by ${plain(String(offer.deadlines.deliverBy))} (${span(offer.windows.deliverWithinSec)}); ${offer.checks.length} checks; ${rubricSize ? `a rubric of ${rubricSize} criteria` : 'no rubric'}; adjudicators ${offer.adjudicators.primary}, ${offer.adjudicators.fallback} and ${offer.adjudicators.appeal}.`);
    say(`    Shown before approval: ${Object.entries(signed).map(([k, v]) => `${k} ${plain(String(v))}`).join(', ')}.`);
    say(`    Differences from the seller's defaults: ${differences.length ? differences.map((d) => `${plain(d.field)} ${brief(d.old)} -> ${brief(d.new)}`).join('; ') : 'none'}.`);

    // The approval: the buyer's own expectation, the fees it pays at most, and the differences and signed fields it saw.
    const schedule = ownTerms ? await reader.operatorFeeSchedule() : null;
    const maxFees = ownTerms ? BigInt(ownTerms.adjudication.fee.amount) + (schedule ? operatorFeeOf(offer.price, schedule) : 0n) : MAX_FEES_UNITS;
    const fees = BigInt(offer.fees.total.amount) - BigInt(offer.price.amount);
    if (fees > maxFees) throw new Refusal(`refusing to sign: the fees are ${money({ token: pin.token.id, amount: fees.toString() })}, above the ${money({ token: pin.token.id, amount: maxFees.toString() })} this buyer pays`);
    if (ownTerms) {
      const windowSec = Math.round((Date.parse(offer.deadlines.deliverBy) - (await reader.settlementNow())) / 1000);
      const agreed = ownTerms.timing.deliverWithinSec;
      if (!(windowSec > agreed - 900 && windowSec <= agreed + 60)) throw new Refusal(`refusing to sign: the delivery deadline ${plain(String(offer.deadlines.deliverBy))} is ${windowSec} s away, not the ${agreed} s agreed`);
    }
    const approved: Approved = {
      commitmentId: id, // the approval names the offer it approves (T-368)
      seller, price: { token: pin.token.id, amount: ownTerms?.price.amount ?? offer.price.amount }, fees: offer.fees,
      deliverable: expected.deliverable, checks: expected.checks, ...(hasRubric ? { rubric: expected.rubric } : {}), deadlines: offer.deadlines, adjudicators, differences,
      settlement: offer.settlement, disclosure: offer.disclosure, clubId: offer.clubId, rulebookHash: offer.rulebookHash, policyId: offer.policyId, policyHash: offer.policyHash, registryHash: offer.registryHash, maxSubmissions: offer.maxSubmissions,
      sellerPayoutAddress: offer.sellerPayoutAddress,
    };
    step('The buyer approves', `${ownTerms ? 'the terms file it shares with the seller' : 'the built-in template filled with its scope, at the price it was shown'}, the ${differences.length} ${differences.length === 1 ? 'difference' : 'differences'} and the eight signed fields above.`);

    const granted = await signer.testFunds(offer.fees.total.amount);
    step('The buyer takes test funds', wallet ? `the faucet granted the payment address ${money(granted)} (nothing when it already held the total), and the signing key a mandate.` : `the faucet granted ${money(granted)} and a mandate.`);
    const signingKeyBefore = await balance(signer.address);

    // The record and the result, once the case has ended.
    let refusal: string | null = null;
    let paid: Paid | null = null;
    let delivery: Delivery | null = null;
    let reclaimed = false;
    const reports: Array<Report['kind']> = [];
    const finish = async (end: EndState): Promise<RehearsalResult> => {
      const sellerReceived = { token: pin.token.id, amount: (BigInt((await balance(seller)).amount) - BigInt(sellerBefore.amount)).toString() };
      const buyerHolds = await balance(signer.paymentAddress);
      const signingKeyMoved = (BigInt((await balance(signer.address)).amount) - BigInt(signingKeyBefore.amount)).toString();
      // The buyer's own record, read from every operator by its signer, whose x25519 key opens its released envelope; the key never reaches the record.
      const record = await signer.record(o.operators);
      const path = join(o.dir, 'deal-record.json');
      writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
      const count = (ok: boolean | null) => record.checks.filter((c) => c.ok === ok).length;
      step('The buyer writes the deal record', `${path}: outcome ${plain(String(record.row.outcome))}, ${count(true)} checks passed, ${count(false)} failed, ${count(null)} not run${record.disagreements.length ? `; the operators differ on ${record.disagreements.map((d) => d.section).join(', ')}` : ''}.`);
      if (wallet) say(`    The payment address ${signer.paymentAddress} holds ${money(buyerHolds)}; the signing key's balance moved by ${signingKeyMoved} base units after the test funds.`);
      const ok = end === EXPECTED[name];
      say(`Case ${name}: ${end}, ${ok ? 'as expected' : `not the expected ${EXPECTED[name]}`}. Deal record: ${path}`);
      return {
        case: name, end, expected: ok, commitmentId: id, buyer: signer.address, seller, dir: o.dir, offer, shown: { signed, differences }, paid, refusal, delivery, reclaimed, reports,
        alerts: [...selling!.alerts], sellerReceived, buyerHolds, paymentAddress: signer.paymentAddress, signingKeyMoved, record: path, row: record.row, steps, elapsedMs: Date.now() - started,
      };
    };

    if (front) {
      front.raiseFeeBps(100);
      step('The operators raise their fee', 'the front now publishes an operator fee 100 basis points above the one the buyer was shown.');
    }
    // Refuses (throws Refusal, naming the field) unless the offer read again from every operator is the one shown and
    // approved. The adjudicator takes a deal within seconds or declines it: wait at most 5 minutes for that.
    try {
      await signer.checkOffer(id, approved, { timeoutMs: Math.min(timeoutMs, 300_000) });
    } catch (e) {
      if (!(e instanceof Refusal) || name !== 'shown-mismatch') throw e;
      refusal = e.message;
      step('The signer refuses', `${plain(e.message)}. Nothing was signed: no agreement, no funding, no fee.`);
      return await finish('Not funded');
    }
    if (name === 'shown-mismatch') throw new Error('the signer passed an offer whose operator fee changed after it was shown');
    step('The buyer checks the offer', 'every operator serves the offer it was shown and approved, the seller\'s signature recovers, and the primary adjudicator took the deal.');

    if (wallet) {
      // The person's wallet, as a test key: it reads each file the signer wrote and signs it as it is (eth_signTypedData_v4).
      const files = await signer.fundingFiles(id);
      step('The signer writes the payment messages', files.map((f) => `${f.path}: ${f.summary}`).join(' '));
      // The holder's own check first, as a person runs it before signing (red team M-1): the terms as every operator
      // serves them, this tool's pinned layer, the fee from the schedule every operator publishes. Never the file's word.
      const { id: _i, signatures: _s, ...served } = await reader.trusted(`/v1/commitments/${id}/terms`); // eslint-disable-line @typescript-eslint/no-unused-vars
      const feeSchedule = await reader.operatorFeeSchedule();
      const checks = files.map((f) => {
        const file = JSON.parse(readFileSync(f.path, 'utf8'));
        const fee = f.name === 'operator-fee' && feeSchedule ? { to: feeSchedule.to, amount: operatorFeeOf(served.price, feeSchedule).toString() } : undefined;
        return { f, file, r: checkPaymentFile(file, served, { kind: f.name, domain: pin.domain, chain: pin.chain, buyer: signer.address, token: pin.token, ...(fee ? { operatorFee: fee } : {}) }) };
      });
      step('The payment address checks each file', checks.map(({ f, r }) => `${f.name}: digest ${r.digest}`).join('; '));
      const signed = Object.fromEntries(await Promise.all(checks.map(async ({ f, file }) => [f.name === 'funding' ? 'funding' : 'operatorFee', await wallet.signTypedData(file)])));
      step('The payment address signs them in its wallet', `${files.length} ${files.length === 1 ? 'signature' : 'signatures'} by ${wallet.address.toLowerCase()}, each over the file it checked.`);
      paid = await signer.agreeAndFund(id, { funding: signed['funding'], operatorFee: signed['operatorFee'] });
    } else paid = await signer.agreeAndFund(id);
    step('The buyer funds the hold', `paid ${money(paid.total)}${wallet ? ` from ${signer.paymentAddress}` : ''}: ${money(paid.hold)} into the hold (price and adjudication fee) and ${money(paid.operatorFee)} to the operator.`);
    const deliverBy = String(offer.deadlines.deliverBy);

    // ---- The seller's turn: the adapter sees the hold, starts the job, checks the result, delivers or holds it ----
    const stage = () => selling!.adapter().deals().find((d) => d.id === id)?.stage;
    const until = async (what: string, done: () => boolean) => {
      for (const end = Date.now() + timeoutMs; !done(); await sleep(50)) if (Date.now() > end) throw new Error(`still waiting for ${what} after ${timeoutMs / 1000} s; the seller adapter is at ${stage()}`);
    };
    const alerted = (type: string) => selling!.alerts.some((a) => a.type === type);
    if (name === 'redelivered') {
      await until('the refusal and its alert', () => stage() === 'refused' && alerted('delivery.refused'));
      step('The seller\'s check run refuses the first report', `nothing is delivered, and the hold of ${money(paid.hold)} stays funded until ${plain(deliverBy)}.`);
      const a = selling.alerts.find((x) => x.type === 'delivery.refused')!;
      const why = Array.isArray(a.checks) && a.checks.length ? `failed ${a.checks.map((c: J) => plain(String(c.checkId))).join(', ')}` : `intake refused it (${plain(String(a.refused?.code ?? a.result))})`;
      step('The seller is alerted', `its callback got a ${a.signed ? 'signed' : 'NOT signed'} alert, delivery.refused, attempt ${Number(a.attempt)}: ${why}.`);
      selling.serve('good');
      const status = await selling.ready(id);
      if (status !== 202) throw new Error(`the adapter answered ${status} to the seller's ready signal, not 202`);
      step('The seller says the fixed report is ready', 'POST /deals/<id>/ready with its credential answered 202, and the adapter fetched the result again.');
      await until('the fixed delivery and its alert', () => stage() === 'delivered' && alerted('delivery.fixed'));
      step('The seller delivers the fixed report', `before the deadline ${plain(deliverBy)}; its callback got a second alert, delivery.fixed.`);
    } else if (name === 'missed-deadline') {
      await until('the job to start', () => stage() === 'started');
      step('The seller never delivers', 'the adapter started the job, and the job never finishes.');
      const waitSec = Math.ceil((Date.parse(deliverBy) - (await reader.settlementNow())) / 1000) + 2;
      if (o.world) {
        o.world.advanceClock(waitSec);
        step('The delivery deadline passes', `this world's clock moved ${waitSec} s (${span(waitSec)}) forward, past ${plain(deliverBy)}; the buyer's signer reclaims the hold.`);
      } else step('The buyer waits for the delivery deadline', `${waitSec} s in real time, to ${plain(deliverBy)}; then its signer reclaims the hold.`);
    } else if (name === 'resume') {
      await until('the job to start', () => stage() === 'started');
      step('The buyer stops after funding', `its key store ${store} keeps the deal; the process keeps nothing of it.`);
      await selling.restart();
      step('The seller\'s adapter restarts', `from the same configuration file and journal${o.mappingFile ? ', with the report mapping set' : ''}; it finds the deal at ${stage()}.`);
      const leftSec = Math.floor((Date.parse(deliverBy) - (await reader.settlementNow())) / 1000);
      if (o.world) {
        const sec = Math.max(0, Math.floor(leftSec / 2));
        o.world.advanceClock(sec);
        step('Days pass', `this world's clock moved ${sec} s (${span(sec)}) forward; the delivery deadline is still ${span(leftSec - sec)} ahead.`);
      } else step('Days pass', 'on the live service no clock moves: the job finishes and the buyer resumes at once.');
      selling.serve('good');
      await until('the delivery', () => stage() === 'delivered' || stage() === 'refused');
      if (stage() === 'refused') {
        step('The seller does not deliver', "the report failed the adapter's check run (the lines above name the check); the hold stays funded.");
        return await finish('Held');
      }
      step('The seller delivers', 'the job finished, the adapter checked the result and delivered the encrypted report.');
      const open = await openDeals(store, { operators: o.operators });
      signer = open.find((s) => s.commitmentId === id) ?? (() => { throw new Error(`the key store ${store} holds no open deal ${id}`); })();
      step('The buyer resumes from its key store', `openDeals found ${open.length} open ${open.length === 1 ? 'deal' : 'deals'} in ${store}, ${id} among them, funded with ${money(signer.paid!.total)}.`);
    } else {
      selling.serve('good');
      await until('the delivery', () => stage() === 'delivered' || stage() === 'refused');
      if (stage() === 'refused') {
        step('The seller does not deliver', "the report failed the adapter's check run (the lines above name the check); the hold stays funded.");
        return await finish('Held');
      }
      step('The seller delivers', `the report passed the adapter's check run, and it delivered the encrypted report${hasRubric ? '; the panel judges it next' : ''}.`);
    }

    // ---- The outcome: the buyer's signer waits for every operator, reclaims after a missed deadline, opens the report ----
    delivery = await signer.openDelivery(id, {
      timeoutMs, pollMs,
      onReport: (r) => {
        reports.push(r.kind);
        if (r.kind === 'refunded') reclaimed = r.reclaimed;
      },
    });
    if (delivery.outcome === 'Released') step('The deal ends Released', `the buyer opened the report, ${delivery.plaintextSha256}; the seller's balance rose by the price.`);
    else step('The deal ends Refunded', `${reclaimed ? `settlement refunded the hold of ${money(paid.hold)}, price and adjudication fee, on the signer's reclaim` : `the adjudicator rejected the report: the price of ${money(offer.price)} is back, and the adjudication fee paid for the judgment`}; the buyer's payment address holds ${money(await balance(signer.paymentAddress))}, and the operator fee is not refundable.`);
    return await finish(delivery.outcome);
  } finally {
    await front?.close();
    await selling?.close();
    if (name === 'refunded') o.world!.setPanel('pass');
  }
}

export interface AuditDealArgs {
  live: boolean;
  reportFile?: string;
  termsFile?: string;
  /** T-355: one case, or all of them. */
  case?: CaseName | 'all';
  refusedReportFile?: string;
  mappingFile?: string;
  scope?: J;
  out?: string;
  keys?: string;
  buyer?: string;
}

export const USAGE = [
  'usage: pnpm audit-deal [--live]',
  '       pnpm audit-deal [--report <report file>] [--terms <terms file>]   (the local world only)',
  '       pnpm audit-deal --case <case|all> [--report <file>] [--terms <file>] [--scope <JSON>] [--mapping <file>] [--refused-report <file>] [--out <dir>]',
  '       pnpm audit-deal --live --case <case> [--report <file>] [--terms <file>] [--scope <JSON>] [--keys <key store> --buyer <address>] [--out <dir>]',
  `cases: ${CASES.join(', ')}`,
].join('\n');

const VALUE_OPTIONS: Record<string, keyof AuditDealArgs> = {
  '--report': 'reportFile', '--terms': 'termsFile', '--case': 'case', '--refused-report': 'refusedReportFile', '--mapping': 'mappingFile', '--scope': 'scope', '--out': 'out', '--keys': 'keys', '--buyer': 'buyer',
};

/** The command line: `--live`, a seller's own files, and the cases of T-355. Anything else is refused. */
export function parseArgs(argv: readonly string[]): AuditDealArgs {
  const args: AuditDealArgs = { live: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--live') {
      args.live = true;
      continue;
    }
    const key = Object.hasOwn(VALUE_OPTIONS, a) ? VALUE_OPTIONS[a]! : undefined;
    if (!key) throw new UsageError(`unknown option ${plain(a)}`);
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${a} needs a ${a === '--case' ? 'case' : a === '--scope' ? 'JSON value' : a === '--buyer' ? 'address' : a === '--out' || a === '--keys' ? 'directory' : 'file'}`);
    if (args[key] !== undefined) throw new UsageError(`${a} is given twice`);
    if (key === 'case') {
      if (value !== 'all' && !(CASES as readonly string[]).includes(value)) throw new UsageError(`--case is one of ${CASES.join(', ')} or all`);
      args.case = value as CaseName | 'all';
    } else if (key === 'scope') {
      try {
        args.scope = JSON.parse(value);
      } catch {
        throw new UsageError('--scope is not JSON');
      }
    } else (args as unknown as Record<string, unknown>)[key] = value;
  }
  if ((args.keys === undefined) !== (args.buyer === undefined)) throw new UsageError('--keys and --buyer go together: the key store and the address of the key in it');
  if (args.case === undefined && [args.mappingFile, args.scope, args.refusedReportFile, args.out, args.keys, args.buyer].some((v) => v !== undefined)) throw new UsageError('--mapping, --scope, --refused-report, --out, --keys and --buyer need --case');
  if (args.live && args.case === undefined && (args.reportFile !== undefined || args.termsFile !== undefined)) throw new UsageError('--report and --terms run on the local world only, or with --case: leave out --live, or name a case');
  if (args.live && args.case === 'all') throw new UsageError('--live runs one case: a live deal takes a fresh or unused key, test tokens and real time');
  const why = args.live && args.case && args.case !== 'all' ? LOCAL_ONLY[args.case] : undefined;
  if (why) throw new UsageError(`--live cannot run ${args.case}: ${why}`);
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
  // Live: a test key whose address pays for every case, standing in for a person's wallet (item 81). Read, never printed.
  const paymentKey = live ? process.env['CROW_REHEARSAL_PAYMENT_KEY'] || undefined : undefined;
  if (paymentKey !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(paymentKey)) {
    console.error(`audit-deal: CROW_REHEARSAL_PAYMENT_KEY is not a private key: 0x and 64 hex characters\n${USAGE}`);
    process.exit(2);
  }
  if (paymentKey && args.keys !== undefined) {
    console.error(`audit-deal: --keys and CROW_REHEARSAL_PAYMENT_KEY do not go together: with a payment address every case makes a fresh signing key\n${USAGE}`);
    process.exit(2);
  }
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
    if (args.case !== undefined) {
      // T-355: the pilot's cases, each in its own directory under one output directory that stays.
      const names: CaseName[] = args.case === 'all' ? [...CASES] : [args.case];
      const out = args.out !== undefined ? resolve(args.out) : mkdtempSync(join(tmpdir(), live ? 'audit-deal-live-' : 'audit-deal-rehearsal-'));
      console.log(`Each case's configuration, journal, key store and deal record go in ${out}.`);
      let ended = 0;
      for (const [i, name] of names.entries()) {
        // The world's faucet grants 10 times a client in each hour of world time; a case takes about 4.
        if (world && i > 0) world.advanceClock(3601);
        console.log(`\n== Case: ${name} ==`);
        const r = await rehearse({
          case: name, operators, world, dir: join(out, name), reportFile: args.reportFile, termsFile: args.termsFile, refusedReportFile: args.refusedReportFile, mappingFile: args.mappingFile,
          ...(args.scope !== undefined ? { scope: args.scope } : {}), keys: args.keys !== undefined ? { store: args.keys, buyer: args.buyer! } : undefined, paymentKey: paymentKey as Hex | undefined,
          // A live deal waits for blocks: read every 3 s. No step has a time limit of its own (D31).
          pollMs: world ? 200 : 3000,
        });
        if (r.expected) ended++;
      }
      console.log(`\n${ended} of ${names.length} ${names.length === 1 ? 'case' : 'cases'} ended as expected.`);
      code = ended === names.length ? 0 : 1;
    }
    const outcomes: Array<AuditDealOptions['outcome']> = args.case !== undefined ? [] : custom ? [undefined] : live ? ['released'] : ['released', 'refused'];
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
    // The built-in run exits 1 on any failure, as before. With a seller's own files or a case, 1 means a deal did not
    // end as expected, and 2 that the run could not start or stopped on an error.
    code = custom || args.case !== undefined ? 2 : 1;
  } finally {
    for (const line of refusedRequests) console.error(`  refused request: ${line}`);
    await world?.close();
  }
  process.exit(code);
}
