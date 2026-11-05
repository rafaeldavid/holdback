// T-066: the shared readers, with fake fetches only. The event stream never ends on its own (measured on
// api.escrow.stream, 2026-11-05), so the fake one below stays open after its last event, as the live one does.
import { describe, expect, it } from 'vitest';
import { Sources, divRound, fetchCapped, msStats, parseSse, quantile, readEventPage, readEvents, safeUrl, weiToUsdMicros } from '../../scripts/metrics/lib.mjs';
import { onceEvents } from './helpers';

const sse = (events: unknown[]) => events.map((e) => `id: ${(e as { seq: number }).seq}\nevent: x\ndata: ${JSON.stringify(e)}\n\n`).join('');

/** A response whose body sends `text` in small chunks, then stays open until the request is aborted. */
function endless(text: string, signal?: AbortSignal | null) {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < bytes.length) {
        controller.enqueue(bytes.slice(i, i + 700));
        i += 700;
        return;
      }
      return new Promise<void>((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('fetchCapped (T-060 rules)', () => {
  it('follows no redirect', async () => {
    const r = await fetchCapped('https://x.test/', { fetchImpl: async () => new Response(null, { status: 301, headers: { location: 'https://y.test/' } }) });
    expect(r).toMatchObject({ ok: false, error: 'moved' });
  });

  it('stops reading past the cap', async () => {
    const r = await fetchCapped('https://x.test/', { maxBytes: 10, fetchImpl: async () => new Response('x'.repeat(100)) });
    expect(r).toMatchObject({ ok: false, error: 'too-large' });
  });

  it('times out over the whole request', async () => {
    const r = await fetchCapped('https://x.test/', { timeoutMs: 50, fetchImpl: async (_u: string, init: RequestInit) => endless('', init.signal) });
    expect(r).toMatchObject({ ok: false, error: 'timeout' });
  });

  it('records a failed source with a fixed word and never throws', async () => {
    const sources = new Sources({ fetchImpl: async () => new Response('not json') });
    expect(await sources.json('discovery', 'https://x.test/')).toBe(null);
    expect(sources.list[0]).toMatchObject({ id: 'discovery', ok: false, error: 'not-json' });
  });

  it('shows an RPC endpoint by its origin only, so a key in its path never reaches a file', () => {
    expect(safeUrl('https://rpc.example/v2/SECRETKEY?x=1', { keepQuery: false })).toBe('https://rpc.example');
    expect(safeUrl('https://api.escrow.stream/v1/events?from=3')).toBe('https://api.escrow.stream/v1/events?from=3');
  });
});

describe('batched JSON-RPC', () => {
  it('sends one POST per batch and keeps each answer in order', async () => {
    const bodies: number[] = [];
    const fetchImpl = async (_u: string, init: RequestInit) => {
      const calls = JSON.parse(String(init.body)) as { id: number; params: string[] }[];
      bodies.push(calls.length);
      return new Response(JSON.stringify(calls.reverse().map((c) => ({ jsonrpc: '2.0', id: c.id, result: c.params[0] }))));
    };
    const sources = new Sources({ fetchImpl });
    const calls = Array.from({ length: 45 }, (_, i) => ({ method: 'echo', params: [`0x${i.toString(16)}`] }));
    const out = await sources.rpc('test', 'https://rpc.test/key', calls, { batch: 20 });
    expect(bodies.sort((a, b) => a - b)).toEqual([5, 20, 20]);
    expect(out[44]).toBe('0x2c');
    expect(sources.list).toEqual([expect.objectContaining({ id: 'test', url: 'https://rpc.test', ok: true })]);
  });

  it('reads null, not 0, for a call that failed', async () => {
    const sources = new Sources({ fetchImpl: async () => new Response(JSON.stringify([{ jsonrpc: '2.0', id: 0, error: { code: -1 } }])) });
    expect(await sources.rpc('test', 'https://rpc.test', [{ method: 'x', params: [] }])).toEqual([null]);
    expect(sources.list[0]).toMatchObject({ ok: false, error: 'rpc' });
  });
});

describe('the event log reader', () => {
  const events = onceEvents();
  const head = events[events.length - 1].seq;

  it('parses server-sent events and keeps an unfinished block for later', () => {
    const text = sse(events.slice(0, 2));
    const { events: got, rest } = parseSse(`${text}id: 9\ndata: {"seq":`);
    expect(got.map((e: { seq: number }) => e.seq)).toEqual([events[0].seq, events[1].seq]);
    expect(rest).toBe('id: 9\ndata: {"seq":');
  });

  it('stops at the head on a stream that does not end', async () => {
    const r = await readEventPage('https://op.test/v1/events?from=0', { stopAtSeq: head, timeoutMs: 2000, fetchImpl: async (_u: string, init: RequestInit) => endless(sse(events), init.signal) });
    expect(r.ended).toBe('head');
    expect(r.events.length).toBe(events.length);
  });

  it('pages past the byte cap, starting each page after the last whole event', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      urls.push(url);
      if (url.endsWith('/v1/status')) return new Response(JSON.stringify({ head: { eventSeq: head } }));
      const from = Number(new URL(url).searchParams.get('from'));
      return endless(sse(events.filter((e) => e.seq >= from)), init.signal);
    };
    const sources = new Sources({ fetchImpl, maxBytes: 3000, timeoutMs: 2000 });
    const log = await readEvents(sources, ['https://op.test'], { back: events.length });
    expect(log?.complete).toBe(true);
    expect(log?.events.map((e: { seq: number }) => e.seq)).toEqual(events.map((e) => e.seq));
    expect(urls.filter((u) => u.includes('/v1/events')).length).toBeGreaterThan(1);
  });

  it('falls back to node 2 when node 1 does not answer', async () => {
    const fetchImpl = async (url: string, init: RequestInit) => {
      if (url.startsWith('https://one.test')) return new Response('down', { status: 503 });
      if (url.endsWith('/v1/status')) return new Response(JSON.stringify({ head: { eventSeq: head } }));
      return endless(sse(events), init.signal);
    };
    const log = await readEvents(new Sources({ fetchImpl, timeoutMs: 2000 }), ['https://one.test', 'https://two.test'], { back: 1000 });
    expect(log?.node).toBe('https://two.test');
    expect(log?.from).toBe(0);
  });
});

describe('integers', () => {
  it('takes nearest-rank quantiles as telemetry.ts does', () => {
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(quantile(ten, 50)).toBe(5);
    expect(quantile(ten, 90)).toBe(9);
    expect(quantile([7], 90)).toBe(7);
    expect(quantile([], 50)).toBe(null);
    expect(msStats([3000, 1000, 2000])).toEqual({ deals: 3, medianMs: 2000, p90Ms: 3000 });
  });

  it('rounds halves away from zero', () => {
    expect(divRound(5n, 10n)).toBe(1n);
    expect(divRound(4n, 10n)).toBe(0n);
    expect(divRound(-5n, 10n)).toBe(-1n);
  });

  it('prices 1,261,428 gas at 1 gwei and USD 3,000 an ETH as USD 3.784284', () => {
    expect(weiToUsdMicros(1_261_428n * 1_000_000_000n, 3_000_000_000n)).toBe(3_784_284n);
  });
});
