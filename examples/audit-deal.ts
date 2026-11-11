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
// The report is the seller's data. This file parses it as JSON inside the check library and counts its findings. It
// prints none of its text and runs nothing from it.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { preflightDelivery } from '@holdback/judgment';
import { plain } from '@holdback/testkit';
import type { Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { Agent } from './agent.ts';
import { makeKeys, type Approved, type Delivery, type Money, type Offer, type Paid } from './buyer-signer.ts';
import { config as adapterConfig, fill, startSellerAdapter, type RunningAdapter, type Stage } from './seller-adapter.ts';
import { startStubSellerApi, type StubSellerApi } from './seller-adapter-stub.ts';
import { jcs, knownPins, Refusal } from './verify.ts';

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
  outcome: 'released' | 'refused';
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
  outcome: 'Released' | 'Refunded';
  buyer: string;
  seller: string;
  /** The offer as both operators served it and the buyer approved it. */
  offer: Offer;
  paid: Paid;
  /** The seller adapter's last stage for the deal: `delivered` or `refused`. */
  sellerStage: Stage | undefined;
  delivery: Delivery;
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
  stub: StubSellerApi;
  adapter: RunningAdapter;
  close(): Promise<void>;
}

/**
 * The seller's side: the stub of its own API, pricing in the settlement layer's token, and the adapter with the
 * seller's key. The key reaches the adapter as an environment value and nothing here prints it.
 */
export async function startSeller(o: { operators: string[]; report: 'ok' | 'missing-file'; journal: string; pollMs?: number; log?: (line: string) => void; sellerKey?: Hex; quoteOverride?: J }): Promise<RunningSeller> {
  const { reader, pin, clubId, adjudicators } = await discover(o.operators);
  const sellerKey = o.sellerKey ?? generatePrivateKey();
  const address = privateKeyToAccount(sellerKey).address.toLowerCase();
  // A seller is a member of the club before it offers. On the test service the faucet grants the mandate.
  await reader.call('POST', '/v1/faucet', { address });
  const stub = await startStubSellerApi({ port: 0, report: o.report, token: pin.token.id, ...(o.quoteOverride ? { quoteOverride: o.quoteOverride } : {}) });
  try {
    const adapter = await startSellerAdapter(
      { ...adapterConfig, port: 0, sellerApi: stub.api, clubId, adjudicators, journal: o.journal, pollMs: o.pollMs ?? 1000, ...(o.log ? { log: o.log } : {}) },
      { HOLDBACK_KEY: sellerKey, HOLDBACK_OPERATORS: o.operators.join(',') },
    );
    return { address, quoteUrl: `${adapter.url}/quote`, stub, adapter, close: async () => void (await adapter.close(), await stub.close()) };
  } catch (e) {
    await stub.close();
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
  const dir = o.dir ?? mkdtempSync(join(tmpdir(), 'audit-deal-'));
  let selling: RunningSeller | undefined;
  try {
    // ---- The buyer's discovery: the settlement layer both operators serve, and the demo's club and adjudicators ----
    const { reader, pin, clubId, adjudicators } = await discover(o.operators);
    const money = (m: Money) => shown(m, pin.token.symbol, pin.token.decimals);
    const balance = async (address: string): Promise<Money> => ({ token: pin.token.id, amount: String((await reader.trusted(`/v1/balances/${address}`, (x) => x.amount)) ?? '0') });
    say(`An audit-report deal on ${o.operators.join(' and ')}, settling on ${pin.chain ? `chain ${pin.domain.chainId}` : 'SimChain'} in ${pin.token.symbol}. Test tokens only.`);

    // ---- The seller: its own API (a stub here), its adapter, its key ----
    selling = await startSeller({
      operators: o.operators, report: o.outcome === 'refused' ? 'missing-file' : 'ok', journal: join(dir, 'seller-journal.json'), pollMs: o.pollMs ?? 1000,
      log: (line) => say(`      seller adapter: ${line}`), ...(o.sellerKey ? { sellerKey: o.sellerKey } : {}), ...(o.quoteOverride ? { quoteOverride: o.quoteOverride } : {}),
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
    // What the buyer expects, from its own scope and the template both sides know. It is not read from the offer.
    const expected = fill(JSON.parse(readFileSync(TEMPLATE, 'utf8')), SCOPE);
    const fees = BigInt(offer.fees.total.amount) - BigInt(offer.price.amount);
    if (fees > MAX_FEES_UNITS) throw new Refusal(`refusing to sign: the fees are ${money({ token: pin.token.id, amount: fees.toString() })}, above the ${money({ token: pin.token.id, amount: MAX_FEES_UNITS.toString() })} this buyer pays`);
    // The window: the offer's delivery deadline is 4 days after the seller made it, a moment ago.
    const windowSec = Math.round((Date.parse(offer.deadlines.deliverBy) - (await reader.settlementNow())) / 1000);
    if (!(windowSec > DELIVERY_WINDOW_SEC - 900 && windowSec <= DELIVERY_WINDOW_SEC + 60)) throw new Refusal(`refusing to sign: the delivery deadline ${plain(String(offer.deadlines.deliverBy))} is ${windowSec} s away, not the ${DELIVERY_WINDOW_SEC} s agreed`);
    const approved: Approved = {
      seller,
      price: { token: pin.token.id, amount: PRICE_UNITS },
      fees: offer.fees,
      deliverable: expected.deliverable,
      checks: expected.checks,
      deadlines: offer.deadlines,
      adjudicators,
    };
    step('The buyer approves the quote', `price ${money(approved.price)}, adjudication fee ${money(offer.fees.adjudication)}, operator fee ${money(offer.fees.operator)}, total ${money(offer.fees.total)}; delivery by ${plain(String(offer.deadlines.deliverBy))} (4 days); ${approved.checks.length} checks: ${approved.checks.map((c: J) => plain(String(c.id))).join(', ')}; no rubric.`);

    const granted = await signer.testFunds(offer.fees.total.amount);
    step('The buyer takes test funds', `the faucet granted ${money(granted)} and a mandate in club ${plain(clubId)}.`);

    // Refuses (throws Refusal, naming the field) unless the offer both operators serve equals what the buyer approved.
    await signer.checkOffer(quote.commitmentId, approved, { timeoutMs });
    step('The buyer checks the offer', 'both operators serve the approved terms, the seller\'s signature recovers, and the primary adjudicator took the deal.');

    const paid = await signer.agreeAndFund(quote.commitmentId);
    step('The buyer funds the hold', `paid ${money(paid.total)}: ${money(paid.hold)} into the hold (price and adjudication fee) and ${money(paid.operatorFee)} to the operator.`);

    // ---- The seller's turn: the adapter sees the hold, starts the job, checks the result, delivers or refuses ----
    const stage = () => adapter.deals().find((d) => d.id === quote.commitmentId)?.stage;
    const settled = o.outcome === 'released' ? 'delivered' : 'refused';
    for (const end = Date.now() + timeoutMs; stage() !== settled; await sleep(100)) {
      if (Date.now() > end) throw new Error(`the seller adapter is still at ${stage()} after ${timeoutMs / 1000} s, waiting for ${settled}`);
      if (stage() === 'closed' || (stage() === 'refused' && settled !== 'refused')) throw new Error(`the seller adapter ended at ${stage()}, not ${settled}`);
    }
    if (o.outcome === 'released') {
      step('The seller delivers', 'the adapter started the job, the report passed its preflight, and it delivered the encrypted report.');
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
      commitmentId: quote.commitmentId, outcome: delivery.outcome, buyer: signer.address, seller, offer, paid, sellerStage: stage(), delivery, report,
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const live = process.argv.includes('--live');
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
    const outcomes: Array<AuditDealOptions['outcome']> = live ? ['released'] : ['released', 'refused'];
    for (const outcome of outcomes) {
      console.log(`\n== Outcome: ${outcome} ==`);
      // On the live service the key store stays, in case the buyer's key still holds test tokens; its path is printed.
      const dir = live ? mkdtempSync(join(tmpdir(), 'audit-deal-live-')) : undefined;
      if (dir) console.log(`The buyer's key store and the seller's journal stay in ${dir}.`);
      // A live deal waits for blocks: poll every 3 s and wait up to 20 minutes for each step.
      const r = await runAuditDeal({ operators, outcome, ...(world ? { advanceClock: world.advanceClock, pollMs: 200 } : { pollMs: 3000, timeoutMs: 1_200_000 }), ...(dir ? { dir } : {}) });
      console.log(`Result: ${r.outcome}. Commitment ${r.commitmentId}; ${(r.elapsedMs / 1000).toFixed(1)} s.`);
    }
  } catch (e) {
    console.error(`audit-deal: ${plain((e as Error).message)}`);
    code = 1;
  } finally {
    for (const line of refusedRequests) console.error(`  refused request: ${line}`);
    await world?.close();
  }
  process.exit(code);
}
