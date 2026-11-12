// Shared readers for Crow Control's public metrics (T-066). A plain script, deterministic: no model call and no
// inference. Every number comes from a field a source publishes, or from integer arithmetic on those fields.
// The rules, from T-060's dependency status (crow-private control/deps.mjs):
// - each request has a 5 s timeout over the whole request, body included, and a 1 MiB cap, and follows no redirect;
// - a failed source never throws: it is recorded in `sources` with a word from ERROR_WORDS, and what it would have
//   given reads "unknown" (null), never 0;
// - nothing from a source reaches an output file as free text: hashes, addresses and numbers are checked against
//   patterns, and every word comes from a fixed list in this code.
// Money and gas are bigint inside and decimal strings outside (hard rule: no floats).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const TIMEOUT_MS = 5000;
export const MAX_BYTES = 1 << 20;
/** The only words a source's `error` can hold. */
export const ERROR_WORDS = ['timeout', 'unreachable', 'http', 'moved', 'too-large', 'not-json', 'shape', 'rpc', 'missing'];

export const HEX32 = /^0x[0-9a-fA-F]{64}$/;
export const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
export const UINT = /^(0|[1-9][0-9]*)$/;
export const INT = /^(0|-?[1-9][0-9]*)$/;

export const DEFAULTS = {
  op1: 'https://api.crow.direct',
  op2: 'https://api2.crow.direct',
  sepoliaRpc: 'https://ethereum-sepolia-rpc.publicnode.com',
  sepoliaRpcFallback: 'https://sepolia.gateway.tenderly.co',
  testSeller: 'https://crow.direct/agents/test-seller/agent.json',
};

export const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * The fetch: a timeout over the whole request, body included; a size cap that stops reading past it; no redirect.
 * Never throws. Returns { ok: true, text, bytes, ms } or { ok: false, error, ms }.
 */
export async function fetchCapped(url, { method = 'GET', headers, body, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES, fetchImpl = fetch } = {}) {
  const t0 = Date.now();
  const signal = AbortSignal.timeout(timeoutMs);
  const fail = (error) => ({ ok: false, error, ms: Date.now() - t0 });
  try {
    const r = await fetchImpl(url, { method, headers, body, signal, redirect: 'manual' });
    if (r.status !== 200) {
      await r.body?.cancel().catch(() => {});
      return fail(r.status >= 300 && r.status < 400 ? 'moved' : 'http');
    }
    if (Number(r.headers.get('content-length')) > maxBytes) {
      await r.body?.cancel().catch(() => {});
      return fail('too-large');
    }
    const chunks = [];
    let size = 0;
    if (r.body) {
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => {});
          return fail('too-large');
        }
        chunks.push(value);
      }
    }
    return { ok: true, text: new TextDecoder().decode(Buffer.concat(chunks)), bytes: size, ms: Date.now() - t0 };
  } catch {
    return fail(signal.aborted ? 'timeout' : 'unreachable');
  }
}

/**
 * A URL as a file may show it, never with a username or password. An RPC endpoint shows its origin only, since a
 * keyed endpoint carries its key in the path or the query.
 */
export function safeUrl(url, { keepQuery = true } = {}) {
  try {
    const u = new URL(url);
    return keepQuery ? `${u.origin}${u.pathname}${u.search}` : u.origin;
  } catch {
    return 'unknown';
  }
}

/**
 * Every read goes through one Sources, which records it for the output's `sources` list:
 * { id, url, readAt, ok, ms, error }.
 */
export class Sources {
  constructor({ fetchImpl = fetch, clock = Date.now, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES } = {}) {
    this.list = [];
    this.fetchImpl = fetchImpl;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
  }

  record(id, url, readAt, ok, ms, error) {
    this.list.push({ id, url, readAt: iso(readAt), ok, ms, error: ok ? null : ERROR_WORDS.includes(error) ? error : 'shape' });
  }

  /** GET (or POST) JSON. Returns the parsed value, or null when the source fails. */
  async json(id, url, init = {}, { keepQuery = true } = {}) {
    const readAt = this.clock();
    const r = await fetchCapped(url, { ...init, timeoutMs: this.timeoutMs, maxBytes: this.maxBytes, fetchImpl: this.fetchImpl });
    const shown = safeUrl(url, { keepQuery });
    if (!r.ok) {
      this.record(id, shown, readAt, false, r.ms, r.error);
      return null;
    }
    let value;
    try {
      value = JSON.parse(r.text);
    } catch {
      this.record(id, shown, readAt, false, r.ms, 'not-json');
      return null;
    }
    this.record(id, shown, readAt, true, r.ms, null);
    return value;
  }

  /**
   * Batched JSON-RPC: one POST per 50 calls, run four at a time. Returns one result per call, in order, with null
   * for any call that failed. Records one source for the whole set; it is ok only when every call answered.
   */
  async rpc(id, url, calls, { batch = 50, parallel = 4 } = {}) {
    const readAt = this.clock();
    const t0 = Date.now();
    const results = new Array(calls.length).fill(null);
    let error = null;
    const chunks = [];
    for (let i = 0; i < calls.length; i += batch) chunks.push(i);
    let next = 0;
    const worker = async () => {
      while (next < chunks.length) {
        const start = chunks[next++];
        const slice = calls.slice(start, start + batch);
        const body = JSON.stringify(slice.map((c, k) => ({ jsonrpc: '2.0', id: start + k, method: c.method, params: c.params })));
        const r = await fetchCapped(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, timeoutMs: this.timeoutMs, maxBytes: this.maxBytes, fetchImpl: this.fetchImpl });
        if (!r.ok) {
          error ??= r.error;
          continue;
        }
        let answers;
        try {
          answers = JSON.parse(r.text);
        } catch {
          error ??= 'not-json';
          continue;
        }
        if (!Array.isArray(answers)) answers = [answers];
        for (const a of answers) {
          if (!a || typeof a !== 'object' || !Number.isSafeInteger(a.id) || a.id < start || a.id >= start + slice.length) continue;
          if (a.error !== undefined || a.result === undefined) {
            error ??= 'rpc';
            continue;
          }
          results[a.id] = a.result;
        }
      }
    };
    if (calls.length) await Promise.all(Array.from({ length: Math.min(parallel, chunks.length) }, worker));
    if (!error && results.some((r) => r === null)) error = 'rpc';
    if (calls.length) this.record(id, safeUrl(url, { keepQuery: false }), readAt, error === null, Date.now() - t0, error);
    return results;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The operators' event log. GET /v1/events?from=<seq> is a server-sent event stream that does not end on its own
// (measured on api.escrow.stream, 2026-11-05: still open after 15 s at the head), so the reader stops at the head
// that /v1/status gave. A page past the 1 MiB cap stops early, and the next page starts after its last whole event.

/** A minimal check of one event: the fields the metrics read. Anything else is dropped. */
export function isEvent(e) {
  return !!e && typeof e === 'object' && Number.isSafeInteger(e.seq) && e.seq >= 0 && typeof e.type === 'string' && /^[a-z]+\.[a-z]+$/.test(e.type) && typeof e.at === 'string' && Number.isFinite(Date.parse(e.at));
}

/** Parses server-sent event text into events; returns the events and the unparsed tail. */
export function parseSse(text) {
  const events = [];
  const blocks = text.split('\n\n');
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    const data = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) continue;
    try {
      const e = JSON.parse(data);
      if (isEvent(e)) events.push(e);
    } catch {
      // A malformed block is skipped; the gap shows as a missing seq.
    }
  }
  return { events, rest };
}

/** Reads one page of the stream, up to the head, the byte cap or the timeout. Never throws. */
export async function readEventPage(url, { stopAtSeq, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES, fetchImpl = fetch } = {}) {
  const t0 = Date.now();
  const signal = AbortSignal.timeout(timeoutMs);
  const events = [];
  let bytes = 0;
  let ended = 'eof';
  let error = null;
  try {
    const r = await fetchImpl(url, { headers: { accept: 'text/event-stream' }, signal, redirect: 'manual' });
    if (r.status !== 200) {
      await r.body?.cancel().catch(() => {});
      return { events, bytes, ms: Date.now() - t0, ended: 'error', error: r.status >= 300 && r.status < 400 ? 'moved' : 'http' };
    }
    if (r.body) {
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        const { events: got, rest } = parseSse(buffer);
        buffer = rest;
        let reached = false;
        for (const e of got) {
          events.push(e);
          if (e.seq >= stopAtSeq) reached = true;
        }
        if (reached) {
          ended = 'head';
          await reader.cancel().catch(() => {});
          break;
        }
        if (bytes > maxBytes) {
          ended = 'cap';
          await reader.cancel().catch(() => {});
          break;
        }
      }
    }
  } catch {
    if (signal.aborted) ended = 'timeout';
    else {
      ended = 'error';
      error = 'unreachable';
    }
  }
  return { events, bytes, ms: Date.now() - t0, ended, error };
}

/**
 * Reads the last `back` events up to the head, from the first node that answers. Returns
 * { node, head, from, events, complete } or null when no node answers.
 */
export async function readEvents(sources, nodes, { back = 8000, maxPages = 40 } = {}) {
  for (const node of nodes) {
    const status = await sources.json('status', `${node}/v1/status`);
    const head = status?.head?.eventSeq;
    if (!Number.isSafeInteger(head) || head < 0) continue;
    const from = Math.max(0, head - back + 1);
    const bySeq = new Map();
    let cursor = from;
    let complete = false;
    for (let page = 0; page < maxPages && cursor <= head; page++) {
      const url = `${node}/v1/events?from=${cursor}`;
      const readAt = sources.clock();
      const r = await readEventPage(url, { stopAtSeq: head, timeoutMs: sources.timeoutMs, maxBytes: sources.maxBytes, fetchImpl: sources.fetchImpl });
      const ok = r.ended === 'head' || ((r.ended === 'cap' || r.ended === 'timeout') && r.events.length > 0);
      sources.record('events', safeUrl(url), readAt, ok, r.ms, ok ? null : r.error ?? (r.ended === 'timeout' ? 'timeout' : 'shape'));
      for (const e of r.events) if (e.seq >= from && e.seq <= head) bySeq.set(e.seq, e);
      if (r.ended === 'head') {
        complete = true;
        break;
      }
      if (!r.events.length) break;
      cursor = Math.max(...r.events.map((e) => e.seq)) + 1;
    }
    if (!bySeq.size) continue;
    const events = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
    return { node, head, from, events, complete: complete && events.length === head - from + 1 };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Crow's own accounts: the ones whose gas Crow pays. Discovery names the funding lane (in a note), the demo
// adjudicators and, once slice 3 is deployed, `demo.relayer`; until then the deal lanes come from
// scripts/metrics/crow-accounts.json, which copies docs/operations.md.

/** { fundingLane, dealLanes, adjudicators, all, dealLanesSource } with lowercase addresses. */
export function crowAccounts(discovery, fallback = {}) {
  const low = (a) => (typeof a === 'string' && ADDRESS.test(a) ? a.toLowerCase() : null);
  const relayer = discovery?.demo?.relayer;
  let fundingLane = low(relayer?.fundingLane);
  if (!fundingLane) {
    for (const note of Array.isArray(discovery?.notes) ? discovery.notes : []) {
      const m = /funded from (0x[0-9a-fA-F]{40})/.exec(String(note).slice(0, 4000));
      if (m) fundingLane = low(m[1]);
    }
  }
  fundingLane ??= low(fallback.fundingLane);
  const published = Array.isArray(relayer?.dealLanes) ? relayer.dealLanes.map(low).filter(Boolean) : [];
  const dealLanes = published.length ? published : (Array.isArray(fallback.dealLanes) ? fallback.dealLanes : []).map(low).filter(Boolean);
  const dealLanesSource = published.length ? 'discovery demo.relayer.dealLanes' : dealLanes.length ? `scripts/metrics/crow-accounts.json (${fallback.source ?? 'by hand'}), not confirmed live` : 'none';
  const adjudicators = (Array.isArray(discovery?.demo?.adjudicators) ? discovery.demo.adjudicators : []).map((a) => low(a?.address)).filter(Boolean);
  const all = new Set([fundingLane, ...dealLanes, ...adjudicators].filter(Boolean));
  return { fundingLane, dealLanes, adjudicators, all, dealLanesSource };
}

// ---------------------------------------------------------------------------------------------------------------
// Integers.

/** Nearest-rank quantile of ascending integers, as apps/demo-cloud/src/telemetry.ts computes it; null when empty. */
export function quantile(sorted, pct) {
  if (!sorted.length) return null;
  const rank = Math.floor((pct * sorted.length + 99) / 100);
  return sorted[Math.max(0, rank - 1)];
}

/** Median and 90th percentile of integer milliseconds, with the count. */
export function msStats(values) {
  const s = values.filter((v) => Number.isSafeInteger(v)).sort((a, b) => a - b);
  return { deals: s.length, medianMs: quantile(s, 50), p90Ms: quantile(s, 90) };
}

/** Nearest-rank quantile of decimal strings, compared as bigint; null when empty. */
export function bigQuantile(values, pct) {
  const s = values.filter((v) => typeof v === 'string' && UINT.test(v)).map(BigInt).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const q = quantile(s, pct);
  return q === null ? null : q.toString();
}

/** n ÷ d rounded to the nearest integer, halves away from zero. bigint in, bigint out. */
export function divRound(n, d) {
  if (d <= 0n) throw new RangeError('divisor must be positive');
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = (a + d / 2n) / d;
  return neg ? -q : q;
}

/** wei × (micro-USD per ETH) ÷ 10^18, rounded: micro-USD as bigint. */
export function weiToUsdMicros(wei, usdMicrosPerEth) {
  return divRound(BigInt(wei) * BigInt(usdMicrosPerEth), 10n ** 18n);
}

/** A hex quantity from JSON-RPC as a decimal string, or null. */
export function hexToDec(hex) {
  return typeof hex === 'string' && /^0x[0-9a-fA-F]{1,64}$/.test(hex) ? BigInt(hex).toString() : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Output.

/** The commit of the holdback checkout the script runs from, or "unknown". */
export function gitCommit(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
    return /^[0-9a-f]{40}$/.test(out) ? out : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The fields every metrics file starts with. */
export function envelope(name, { script, commit, generatedAt, sources, gaps }) {
  return { schema: `crow.metrics.${name}/1`, generatedAt: iso(generatedAt), generator: { script, commit }, sources, gaps };
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Parses the command line; unknown options are refused. */
export function cli(options) {
  return parseArgs({ options, allowPositionals: false, strict: true }).values;
}

export const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');

/** True when the module at `url` is the script node was started with. */
export const isMain = (url) => !!process.argv[1] && url === pathToFileURL(process.argv[1]).href;
