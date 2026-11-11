// Seller: sell a service that prices by quote through Crow, with no protocol code of your own (T-318).
// You already run an HTTP API with a quote call, a start call and a result call. This adapter sits beside it:
//
//   1. Quote to offer.   A buyer POSTs {buyer, buyerEncryptionPublicKey, scope} to this adapter's /quote. The
//                        adapter checks the scope, asks your API for a price, fills your deal template with the
//                        scope, signs an offer that names the buyer, submits it, and answers
//                        {commitmentId, price, fees, expiresAt}. The buyer reads the commitment by its ID.
//   2. Hold to start.    The adapter follows the operators' event stream for `hold.funded`, and polls as well. It
//                        starts the job only when every operator shows the commitment Held.
//   3. Result to delivery. When your API returns the result, the adapter runs the adjudicator's first stage on
//                        those exact bytes (preflightDelivery). It encrypts and delivers only when the checks do
//                        not refuse them. Otherwise it does not deliver, and logs each failed check.
//
// You change the configuration below and nothing else. Your signing key comes from the environment. The adapter
// signs your offer and your delivery with it; it never holds a buyer's key, and the operators only relay.
//
// Your API, as the adapter calls it (seller-adapter-stub.ts is a working example):
//   quote:  POST <quote>   {scope}                        -> {price: {token, amount}, quoteId?, deliverWithinSec?}
//           `amount` is base units as a decimal string ("2000000000" is 2,000.00 of a 6-decimal token).
//   start:  POST <start>   {commitmentId, quoteId, scope} -> {jobId}, sent with `Idempotency-Key: <commitmentId>`.
//           The same key must return the same job: after a crash the adapter sends the start again.
//   result: GET  <result>  ({jobId} in the address)       -> 202 while the job runs; 200 with the result's bytes.
//
// It keeps a journal file of its deals, so a restart neither starts a job twice nor delivers twice: the journal
// records each job, and the settlement layer says whether a delivery is already there. Run one adapter per journal.
// It listens on 127.0.0.1 and makes public-level offers. Put your own HTTPS front and rate limit before /quote:
// every quote makes the adapter sign an offer.
// The deliverable is data: the adapter parses it only inside the check library, and runs nothing from it, from
// the template or from the scope.
//
//   pnpm install && pnpm build
//   HOLDBACK_KEY=0x… HOLDBACK_OPERATORS=https://…,https://… node examples/seller-adapter.ts
//   node examples/seller-adapter.ts --sim     (test keys, adjudicators and operators from a running `pnpm sim`)
// Env: HOLDBACK_KEY (the seller's signing key) and HOLDBACK_OPERATORS (two or more, comma-separated). The adapter
// signs under the settlement layer those operators serve, which must be one pinned in verify.ts: SimChain, Sepolia,
// or the deployment in HOLDBACK_DEPLOYMENT. Your API prices in that layer's token: `tUSD` on SimChain, the token's
// address on a chain (discovery, `demo.token.id`). Test tokens only: nothing here is real money.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Hex } from 'viem';
import { preflightDelivery } from '@holdback/judgment';
import { plain } from '@holdback/testkit';
import { Agent } from './agent.ts';
import { convertReport, loadReportMapping, ReportNotConverted } from './report-converter.ts';
import { jcs, knownPins, operatorFeeOf } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** What one field of a buyer's scope may hold. Anything else is refused before your API or your key sees it. */
export type ScopeRule =
  | { type: 'string'; pattern: string }
  | { type: 'strings'; pattern: string; min: number; max: number } // distinct strings
  | { type: 'integer'; min: number; max: number };

export interface SellerAdapterConfig {
  /** Where this adapter listens for POST /quote. */
  port: number;
  /** Your API's three addresses. `result` holds `{jobId}` where the job's ID goes. */
  sellerApi: { quote: string; start: string; result: string };
  /**
   * Your deal template: a JSON file with `deliverable`, `checks` and optionally `rubric`, in the shapes of an
   * offer. `{{field}}` stands for a scope field, and `{{field.length}}` for the size of a list.
   */
  template: string;
  /**
   * A mapping file (report-converter.ts) that turns your API's result into your template's JSON, so your API keeps
   * its own report shape. The adapter checks and delivers the converted bytes. Left out: it delivers the result as it comes.
   */
  reportMapping?: string;
  /** The fields a scope must have, and no others. */
  scope: Record<string, ScopeRule>;
  clubId: string;
  /** The three adjudicators you name in every offer; the buyer agrees to them by funding. */
  adjudicators: { primary: string; fallback: string; appeal: string };
  /** Windows in whole seconds. Your API's `deliverWithinSec`, when a quote carries one, replaces this one. */
  timing: { offerExpiresInSec: number; fundWithinSec: number; deliverWithinSec: number; judgeWithinSec: number; fallbackWithinSec: number; appealWindowSec: number; appealDecideSec: number };
  /** The journal file. Its directory must exist. */
  journal: string;
  /** How often the adapter polls the operators and your API, in milliseconds. */
  pollMs: number;
  /** Follow the first operator's event stream to learn of a funded hold sooner. Default true. */
  stream?: boolean;
  log?: (line: string) => void;
}

// ---- Configuration: change this, and nothing below it. ----
export const config: SellerAdapterConfig = {
  port: 8791,
  sellerApi: {
    quote: 'http://127.0.0.1:8790/quote',
    start: 'http://127.0.0.1:8790/jobs',
    result: 'http://127.0.0.1:8790/jobs/{jobId}/result',
  },
  template: fileURLToPath(new URL('./seller-adapter.template.json', import.meta.url)),
  scope: {
    commit: { type: 'string', pattern: '^[0-9a-f]{40}$' },
    files: { type: 'strings', pattern: '^[A-Za-z0-9_./-]{1,200}$', min: 1, max: 50 },
    lines: { type: 'integer', min: 1, max: 10_000_000 },
  },
  clubId: 'sim-club',
  adjudicators: {
    primary: '0x0000000000000000000000000000000000000000', // yours; --sim reads the sim's three
    fallback: '0x0000000000000000000000000000000000000000',
    appeal: '0x0000000000000000000000000000000000000000',
  },
  // 15 minutes to accept, 30 to fund, 7 days to deliver, 2 minutes for each adjudicator, 5 for appeals.
  timing: { offerExpiresInSec: 900, fundWithinSec: 1800, deliverWithinSec: 604_800, judgeWithinSec: 120, fallbackWithinSec: 120, appealWindowSec: 300, appealDecideSec: 300 },
  journal: 'seller-adapter.journal.json',
  pollMs: 5000,
};
// ---- End of configuration. ----

export type Stage = 'offered' | 'starting' | 'started' | 'delivered' | 'refused' | 'closed';
/** One deal in the journal. `refused`: the result failed preflight and was not delivered. */
export interface Deal {
  id: Hex;
  stage: Stage;
  terms: J;
  scope: J;
  quoteId?: string;
  jobId?: string;
  note?: string;
}
interface Journal {
  deals: Record<string, Deal>;
  /** Answers by Idempotency-Key, with the hash of the request they answered. */
  quotes: Record<string, { bodyHash: string; answer: J }>;
}

export interface RunningAdapter {
  url: string;
  /** A copy of the journal's deals. */
  deals(): Deal[];
  /** Whether the event stream is connected. */
  following(): boolean;
  close(): Promise<void>;
}

class Refused extends Error {
  readonly status: number;
  readonly type: string;
  constructor(status: number, type: string, detail: string) {
    super(detail);
    this.status = status;
    this.type = type;
  }
}

const BASE_UNITS = /^(0|[1-9][0-9]{0,77})$/;
const PLACEHOLDER = /\{\{([A-Za-z][A-Za-z0-9]*)(\.length)?\}\}/g;
const BEFORE_HOLD = ['Offered', 'AcceptedByAdjudicator', 'Agreed'];
const MAX_BODY_BYTES = 65_536;

/** Why a scope breaks the configured rules, or null when it keeps them. */
function scopeError(scope: J, rules: Record<string, ScopeRule>): string | null {
  if (scope === null || typeof scope !== 'object' || Array.isArray(scope)) return 'scope must be an object';
  for (const k of Object.keys(scope)) if (!Object.hasOwn(rules, k)) return `scope has a field this seller does not take: ${plain(k).slice(0, 60)}`;
  for (const [k, rule] of Object.entries(rules)) {
    const v = scope[k];
    if (rule.type === 'integer') {
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < rule.min || v > rule.max) return `scope.${k} must be a whole number from ${rule.min} to ${rule.max}`;
    } else if (rule.type === 'string') {
      if (typeof v !== 'string' || !new RegExp(rule.pattern).test(v)) return `scope.${k} must be a string matching ${rule.pattern}`;
    } else {
      const re = new RegExp(rule.pattern);
      if (!Array.isArray(v) || v.length < rule.min || v.length > rule.max || !v.every((s) => typeof s === 'string' && re.test(s)) || new Set(v).size !== v.length) {
        return `scope.${k} must be ${rule.min} to ${rule.max} distinct strings, each matching ${rule.pattern}`;
      }
    }
  }
  return null;
}

/**
 * The template with each placeholder replaced by the scope's value. One pass: a scope value is never read as a
 * placeholder. Exported so a buyer can fill the same template with its own scope and compare the offer (audit-deal.ts).
 */
export function fill(node: J, scope: J): J {
  const value = (name: string, length: string | undefined): J => (length ? scope[name].length : scope[name]);
  if (typeof node === 'string') {
    const whole = new RegExp(`^${PLACEHOLDER.source}$`).exec(node);
    if (whole) return structuredClone(value(whole[1]!, whole[2])); // the value itself: a string, a number or a list
    return node.replace(PLACEHOLDER, (_m, name: string, length?: string) => {
      const v = value(name, length);
      return Array.isArray(v) ? v.join(', ') : String(v);
    });
  }
  if (Array.isArray(node)) return node.map((n) => fill(n, scope));
  if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fill(v, scope)]));
  return node;
}

function loadTemplate(c: SellerAdapterConfig): J {
  const text = readFileSync(c.template, 'utf8');
  const template = JSON.parse(text);
  if (!template.deliverable || !Array.isArray(template.checks)) throw new Error(`${c.template} needs "deliverable" and "checks"`);
  for (const [, name, length] of text.matchAll(PLACEHOLDER)) {
    const rule = c.scope[name!];
    if (!rule) throw new Error(`${c.template} uses {{${name}}}, which the scope rules do not define`);
    if (length && rule.type !== 'strings') throw new Error(`${c.template} uses {{${name}.length}}, and ${name} is not a list`);
  }
  return template;
}

async function readJson(req: IncomingMessage): Promise<J> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Refused(413, 'invalid_request', `the request is larger than ${MAX_BODY_BYTES} bytes`);
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Refused(400, 'invalid_request', 'the request body is not JSON');
  }
}

/**
 * Starts the adapter: the /quote route, the event stream and the polling loop. The key and the operators come
 * from `env` (HOLDBACK_KEY, HOLDBACK_OPERATORS), never from the configuration.
 */
export async function startSellerAdapter(c: SellerAdapterConfig, env: Readonly<Record<string, string | undefined>> = process.env): Promise<RunningAdapter> {
  const key = env['HOLDBACK_KEY'];
  const operators = (env['HOLDBACK_OPERATORS'] ?? '').split(',').filter(Boolean);
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('set HOLDBACK_KEY to the seller\'s signing key (0x and 64 hex characters)');
  const reader = new Agent(operators, key as Hex, new Uint8Array(32)); // sealing a delivery needs no secret encryption key
  reader.sources(); // refuses fewer than two operators at distinct origins
  // The settlement layer is the one every operator serves, and it must be one pinned in verify.ts (SimChain, Sepolia,
  // or HOLDBACK_DEPLOYMENT), as the buyer's signer pins it (buyer-signer.ts). The seller signs under that domain.
  const exact = (d: J) => jcs({ ...d, verifyingContract: String(d?.verifyingContract).toLowerCase() });
  const served = await reader.trusted('/.well-known/holdback.json', (x) => x.domain);
  const pins = knownPins();
  const pin = pins.find((p) => exact(p.domain) === exact(served));
  if (!pin) throw new Error(`the operators serve EIP-712 domain ${plain(jcs(served ?? null)).slice(0, 300)}, not one pinned in verify.ts (${pins.map((p) => jcs(p.domain)).join(' or ')})`);
  const seller = new Agent(operators, key as Hex, new Uint8Array(32), pin.domain, pin.chain);
  const token = pin.token; // the one token this settlement layer holds
  const template = loadTemplate(c);
  const reportMapping = c.reportMapping === undefined ? undefined : loadReportMapping(c.reportMapping);
  const log = (line: string) => (c.log ?? console.log)(`${new Date().toISOString()} ${line}`);
  const journal: Journal = existsSync(c.journal) ? JSON.parse(readFileSync(c.journal, 'utf8')) : { deals: {}, quotes: {} };
  /** Writes the journal whole, then renames it into place: a crash leaves the old file or the new one. */
  const save = () => {
    writeFileSync(`${c.journal}.tmp`, JSON.stringify(journal, null, 2));
    renameSync(`${c.journal}.tmp`, c.journal);
  };
  const record = (deal: Deal, change: Partial<Deal>) => {
    Object.assign(deal, change);
    save();
    log(`${deal.id} is ${deal.stage}${deal.note ? `: ${plain(deal.note)}` : ''}.`);
  };
  /** Your API. A failure names the call and the status only; the body is your API's and may be anything. */
  const api = async (what: string, url: string, init: RequestInit = {}): Promise<Response> => {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000), ...init });
    if (res.status !== 200 && res.status !== 202) throw new Error(`the seller API answered ${res.status} to ${what}`);
    return res;
  };
  const post = (what: string, url: string, body: unknown, headers: Record<string, string> = {}) => api(what, url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  // ---- 1. Quote to offer ----
  async function offerFor(buyer: string, buyerEncryptionPublicKey: string, scope: J): Promise<J> {
    let quoted: J;
    try {
      quoted = await (await post('the quote', c.sellerApi.quote, { scope })).json();
    } catch (e) {
      log(`Quote failed: ${plain((e as Error).message)}.`);
      throw new Refused(502, 'seller_api_failed', 'the seller could not price this scope');
    }
    const price = quoted?.price;
    // Money is base units as a decimal string, never a number (hard rule): refuse anything else from the seller API.
    if (!price || typeof price.token !== 'string' || typeof price.amount !== 'string' || !BASE_UNITS.test(price.amount)) {
      log('Quote refused: the seller API\'s price is not {token, amount} with the amount in base units as a decimal string.');
      throw new Refused(502, 'seller_api_failed', 'the seller could not price this scope');
    }
    // The settlement layer holds one token. A price in another is a seller API set up for another layer.
    if (price.token.toLowerCase() !== token.id.toLowerCase()) {
      log(`Quote refused: the seller API priced in ${plain(price.token).slice(0, 80)}; this settlement layer's token is ${token.id} (${token.symbol}).`);
      throw new Refused(502, 'seller_api_failed', 'the seller could not price this scope');
    }
    const deliverWithinSec = quoted.deliverWithinSec;
    if (deliverWithinSec !== undefined && (!Number.isSafeInteger(deliverWithinSec) || deliverWithinSec < 0)) throw new Refused(502, 'seller_api_failed', 'the seller could not price this scope');
    const filled = fill(template, scope);
    const panel = Array.isArray(filled.rubric?.criteria) && filled.rubric.criteria.length > 0;
    let offer;
    try {
      offer = await seller.offer({
        template: panel ? 'default' : 'checks-only',
        clubId: c.clubId,
        seller: seller.address,
        buyer: { address: buyer, encryptionPublicKey: buyerEncryptionPublicKey },
        adjudicators: c.adjudicators,
        price: { token: price.token, amount: price.amount },
        deliverable: filled.deliverable,
        checks: filled.checks,
        ...(panel ? { rubric: filled.rubric } : {}),
        timing: { ...c.timing, ...(deliverWithinSec === undefined ? {} : { deliverWithinSec }) },
      });
    } catch (e) {
      log(`Offer failed: ${plain((e as Error).message)}.`);
      throw new Refused(502, 'offer_failed', 'the seller could not make this offer');
    }
    const { id, terms } = offer;
    journal.deals[id] = { id, stage: 'offered', terms, scope, ...(typeof quoted.quoteId === 'string' ? { quoteId: quoted.quoteId } : {}) };
    save();
    log(`${id} is offered to ${terms.buyer} for ${terms.price.amount} base units of ${plain(terms.price.token)}; the offer expires ${terms.timing.offerExpiresAt}.`);
    // What the buyer pays on top of the price: the adjudication fee, and the operators' fee when they publish one.
    const schedule = await seller.operatorFeeSchedule();
    const operatorFee = schedule ? operatorFeeOf(terms.price, schedule) : 0n;
    const operator = schedule ? { token: schedule.token, amount: operatorFee.toString() } : null;
    // `total` is what the buyer funds: the price plus both fees. The buyer computes it again from the terms itself.
    const total = { token: terms.price.token, amount: (BigInt(terms.price.amount) + BigInt(terms.adjudication.fee.amount) + operatorFee).toString() };
    return { commitmentId: id, price: terms.price, fees: { adjudication: terms.adjudication.fee, operator, total }, expiresAt: terms.timing.offerExpiresAt };
  }

  const inFlight = new Map<string, { bodyHash: string; answer: Promise<J> }>();
  async function quote(req: IncomingMessage): Promise<J> {
    const body = await readJson(req);
    const { buyer, buyerEncryptionPublicKey, scope } = body ?? {};
    if (typeof buyer !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(buyer)) throw new Refused(400, 'invalid_request', 'buyer must be an address: 0x and 40 hex characters');
    if (typeof buyerEncryptionPublicKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(buyerEncryptionPublicKey)) throw new Refused(400, 'invalid_request', 'buyerEncryptionPublicKey must be an x25519 public key, base64url, 43 characters');
    const wrong = scopeError(scope, c.scope);
    if (wrong) throw new Refused(400, 'invalid_request', wrong);
    const idempotencyKey = req.headers['idempotency-key'];
    if (idempotencyKey === undefined) return offerFor(buyer.toLowerCase(), buyerEncryptionPublicKey, scope);
    // The same key with the same body replays the answer; with another body it is a conflict.
    if (typeof idempotencyKey !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(idempotencyKey)) throw new Refused(400, 'invalid_request', 'Idempotency-Key must be 1 to 200 printable characters');
    const bodyHash = createHash('sha256').update(jcs({ buyer: buyer.toLowerCase(), buyerEncryptionPublicKey, scope })).digest('hex');
    const seen = journal.quotes[idempotencyKey] ?? inFlight.get(idempotencyKey);
    if (seen && seen.bodyHash !== bodyHash) throw new Refused(409, 'idempotency_conflict', 'this Idempotency-Key was used with another request');
    if (seen) return seen.answer;
    const answer = offerFor(buyer.toLowerCase(), buyerEncryptionPublicKey, scope);
    inFlight.set(idempotencyKey, { bodyHash, answer });
    try {
      journal.quotes[idempotencyKey] = { bodyHash, answer: await answer };
      save();
      return await answer;
    } finally {
      inFlight.delete(idempotencyKey);
    }
  }

  // ---- 2 and 3. Funded hold to start, result to delivery ----
  /** Moves one deal as far as it can go now. A read every operator must answer the same way decides each step. */
  async function advance(deal: Deal): Promise<void> {
    const id = deal.id;
    const escrowState = () => seller.trusted<string>(`/v1/commitments/${id}`, (x) => x.escrowState);
    if (deal.stage === 'offered') {
      const state = await escrowState();
      if (BEFORE_HOLD.includes(state)) return;
      if (state !== 'Held') return record(deal, { stage: 'closed', note: `the offer ended ${state} with no job started` });
      record(deal, { stage: 'starting', note: 'every operator shows the hold funded' }); // recorded before the call, so a crash here repeats it under the same key
    }
    if (deal.stage === 'starting') {
      const started = (await (await post('the start', c.sellerApi.start, { commitmentId: id, ...(deal.quoteId ? { quoteId: deal.quoteId } : {}), scope: deal.scope }, { 'idempotency-key': id })).json()) as J;
      if (typeof started?.jobId !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(started.jobId)) throw new Error('the seller API\'s start answer has no usable jobId');
      record(deal, { stage: 'started', jobId: started.jobId, note: `job ${started.jobId}` });
    }
    if (deal.stage === 'started') {
      // The settlement layer, not the journal, says whether a delivery is already there.
      const state = await escrowState();
      if (state !== 'Held') {
        const delivered = await seller.trusted<boolean>(`/v1/commitments/${id}/events?limit=200`, (x) => x.items.some((e: J) => e.type === 'delivery.submitted'));
        return record(deal, delivered ? { stage: 'delivered', note: `the settlement layer already holds the delivery (${state})` } : { stage: 'closed', note: `the deal ended ${state} with no delivery` });
      }
      if (Date.parse(deal.terms.timing.deliverBy) <= (await seller.settlementNow())) return record(deal, { stage: 'closed', note: `the delivery deadline ${deal.terms.timing.deliverBy} passed` });
      const res = await api('the result', c.sellerApi.result.replace('{jobId}', encodeURIComponent(deal.jobId!)));
      if (res.status === 202) return; // the job still runs
      let bytes = new Uint8Array(await res.arrayBuffer());
      if (reportMapping) {
        // Your report in the template's shape (T-323). A report the mapping cannot convert is never delivered.
        try {
          const result = bytes.length;
          bytes = convertReport(reportMapping, bytes);
          log(`${id} converted the result with the report mapping: ${result} bytes to ${bytes.length} bytes.`);
        } catch (e) {
          if (!(e instanceof ReportNotConverted)) throw e;
          return record(deal, { stage: 'refused', note: `the result is not delivered: the report mapping cannot convert it: ${e.message}. To deliver another file by hand before ${deal.terms.timing.deliverBy}, use check-delivery.ts and seal.ts` });
        }
      }
      // The adjudicator's intake rules and stage 1, on the exact bytes that would be delivered (T-316).
      const format = deal.terms.deliverable.format;
      const pre = preflightDelivery({ plaintext: bytes, mime: format, format, acceptance: deal.terms.acceptance });
      const open = new Set(pre.inconclusive);
      log(`${id} preflight: ${pre.result}, ${pre.bytes} bytes, ${pre.plaintextSha256}.`);
      if (pre.refused) log(`  REFUSED ${pre.refused.code}: ${plain(pre.refused.detail)}`);
      for (const o of pre.deterministic) {
        if (!o.passed || open.has(o.checkId)) log(`  ${open.has(o.checkId) ? 'OPEN' : 'FAIL'} ${plain(o.checkId)} (${o.required ? 'required' : 'optional'})${o.detail === undefined ? '' : `: ${plain(o.detail)}`}`);
      }
      if (pre.result !== 'accept' && pre.result !== 'panel') {
        const why = pre.result === 'reject' ? 'the adjudicator would reject it and refund the buyer' : 'a check cannot be decided, so the deal would escalate';
        return record(deal, { stage: 'refused', note: `the result is not delivered: ${why}. To deliver another file by hand before ${deal.terms.timing.deliverBy}, use check-delivery.ts and seal.ts` });
      }
      await seller.deliver(deal.terms, bytes);
      record(deal, { stage: 'delivered', note: `${pre.bytes} bytes, ${pre.plaintextSha256}` });
    }
  }

  let closed = false;
  let running: Promise<void> | undefined;
  let again = false;
  const lastError = new Map<string, string>();
  async function pass(): Promise<void> {
    for (const deal of Object.values(journal.deals)) {
      if (closed) return;
      if (!['offered', 'starting', 'started'].includes(deal.stage)) continue;
      try {
        await advance(deal);
        lastError.delete(deal.id);
      } catch (e) {
        const message = plain((e as Error).message);
        if (!closed && lastError.get(deal.id) !== message) log(`${deal.id} waits at ${deal.stage}: ${message}. The adapter tries again at the next poll.`);
        lastError.set(deal.id, message);
      }
    }
  }
  /** Runs a pass now, or one more after the pass in progress. Passes never overlap. */
  const wake = () => {
    if (closed) return;
    if (running) return void (again = true);
    running = (async () => {
      do {
        again = false;
        await pass();
      } while (again && !closed);
    })().finally(() => (running = undefined));
  };

  // The event stream only wakes the loop; the trusted read in advance() decides. Polling covers a stream that drops.
  const abort = new AbortController();
  let following = false;
  async function follow(): Promise<void> {
    const node = seller.operators[0]!;
    while (!closed) {
      try {
        const head = ((await (await fetch(`${node}/.well-known/holdback.json`, { signal: abort.signal })).json()) as J).head.eventSeq;
        const res = await fetch(`${node}/v1/events?from=${head}`, { signal: abort.signal });
        if (!res.ok || !res.body) throw new Error(`the event stream answered ${res.status}`);
        following = true;
        const text = new TextDecoder();
        let buffer = '';
        for await (const chunk of res.body) {
          buffer += text.decode(chunk, { stream: true });
          for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (!/^event: hold\.funded$/m.test(frame)) continue;
            const data = /^data: (.*)$/m.exec(frame)?.[1];
            if (data && Object.hasOwn(journal.deals, String(JSON.parse(data).commitmentId))) wake();
          }
        }
      } catch {
        // Reconnect below. Polling finds a funded hold in the meantime.
      }
      following = false;
      if (!closed) await new Promise((r) => setTimeout(r, c.pollMs));
    }
  }

  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
    const path = new URL(req.url ?? '/', 'http://adapter').pathname;
    if (path !== '/quote') return void send(404, { type: 'not_found', detail: 'this adapter serves POST /quote' });
    if (req.method !== 'POST') return void send(405, { type: 'method_not_allowed', detail: 'this adapter serves POST /quote' });
    quote(req).then(
      (answer) => send(200, answer),
      (e: Error) => {
        if (e instanceof Refused) return send(e.status, { type: e.type, detail: e.message });
        log(`Quote failed: ${plain(e.message)}.`);
        return send(500, { type: 'internal', detail: 'the adapter could not answer' });
      },
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(c.port, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const timer = setInterval(wake, c.pollMs);
  const stream = c.stream === false ? Promise.resolve() : follow();
  wake(); // deals the journal left open
  log(`Seller adapter for ${seller.address} serves POST ${url}/quote; journal ${plain(c.journal)}, ${Object.keys(journal.deals).length} deals.`);

  return {
    url,
    deals: () => structuredClone(Object.values(journal.deals)),
    following: () => following,
    close: async () => {
      closed = true;
      clearInterval(timer);
      abort.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await Promise.all([running, stream]);
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let settings = config;
  let env: Readonly<Record<string, string | undefined>> = process.env;
  if (process.argv.includes('--sim')) {
    // A running `pnpm sim` hands out a funded test account and names its club, operators and adjudicators.
    const sim = process.env['HOLDBACK_SIM_URL'] ?? 'http://127.0.0.1:8780';
    const info = (await (await fetch(sim)).json()) as { clubId: string; operators: string[]; adjudicators: Array<{ address: string }> };
    const account = (await (await fetch(`${sim}/accounts`, { method: 'POST' })).json()) as { privateKey: string };
    const [primary, fallback, appeal] = info.adjudicators.map((a) => a.address);
    settings = { ...config, clubId: info.clubId, adjudicators: { primary: primary!, fallback: fallback!, appeal: appeal! } };
    env = { HOLDBACK_KEY: account.privateKey, HOLDBACK_OPERATORS: info.operators.join(',') };
  }
  try {
    await startSellerAdapter(settings, env);
  } catch (e) {
    console.error(`seller-adapter: ${plain((e as Error).message)}`);
    process.exit(2);
  }
}
