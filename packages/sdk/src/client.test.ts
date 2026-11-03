// SDK failover (ADR-0005, ADR-0017 §3): ordered operators, one capped Retry-After wait, then direct submission.
// Operators here are stub HTTP servers, so each refusal shape is exact; apps/operator runs the real ones.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CommitmentStateView, Hex32 } from '@holdback/core';
import type { Settlement, Submission, SubmitOptions, SubmitResult } from '@holdback/settlement';
import { afterEach, describe, expect, it } from 'vitest';
import { Holdback, HoldbackError } from './index.js';

const ID = `0x${'ab'.repeat(32)}` as Hex32;

const view = (escrowState: CommitmentStateView['escrowState'], finalAt: string | null = null): CommitmentStateView => ({
  commitmentId: ID,
  escrowState,
  appealState: 'none',
  attempt: 0,
  deadlines: {},
  settledAt: null,
  finalAt,
  lastEventSeq: 3,
  updatedAt: '2026-11-01T00:00:00Z',
});

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;
const servers: Server[] = [];

async function stub(handler: Handler): Promise<string> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => handler(req, body, res));
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A URL nothing listens on: an operator that is offline. */
async function offline(): Promise<string> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await new Promise<void>((r) => server.close(() => r()));
  return url;
}

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

const throttled = (retryAfter: string) => (_req: IncomingMessage, _b: string, res: ServerResponse) =>
  json(res, 429, { type: 'rate_limited', title: 'rate_limited', status: 429, detail: 'slow down' }, { 'retry-after': retryAfter });

/** A Settlement that records direct submissions and accepts them. */
function directSettlement(state = view('Released')) {
  const calls: Array<{ submission: Submission; options: SubmitOptions | undefined }> = [];
  const validated: unknown[] = [];
  const settlement = {
    kind: 'sim',
    async submit(submission: Submission, options?: SubmitOptions): Promise<SubmitResult> {
      calls.push({ submission, options });
      return { ok: true, commitmentId: ID, state, events: [], replayed: false, dryRun: false, signatureCheck: 'verified' };
    },
    async validate(submission: unknown): Promise<SubmitResult> {
      validated.push(submission);
      return { ok: true, commitmentId: ID, state, events: [], replayed: false, dryRun: true, signatureCheck: 'skipped' };
    },
    async state() {
      return state;
    },
  } as unknown as Settlement;
  return { settlement, calls, validated };
}

const trigger = { kind: 'trigger', commitmentId: ID, timeout: 'reclaim' } as const;

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

describe('operator failover', () => {
  it('uses the first operator that answers and sends an Idempotency-Key', async () => {
    const seen: Array<string | undefined> = [];
    const op = await stub((req, _b, res) => {
      seen.push(req.headers['idempotency-key'] as string | undefined);
      json(res, 200, { ...view('Refunded'), receipt: { operator: `0x${'11'.repeat(20)}`, eventSeq: 3, eventHash: ID, commitmentId: ID, signature: `0x${'22'.repeat(65)}` } });
    });
    const hb = new Holdback({ operators: [op] });
    const r = await hb.submit(trigger);
    expect(r.via).toBe(op);
    expect(r.state.escrowState).toBe('Refunded');
    expect(r.receipt?.eventSeq).toBe(3);
    expect(seen[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('skips an offline operator and a refusing operator, keeping one Idempotency-Key across them', async () => {
    const keys: string[] = [];
    const refuses = await stub((req, _b, res) => {
      keys.push(req.headers['idempotency-key'] as string);
      json(res, 503, { type: 'invalid_state', title: 'refused', status: 503, detail: 'not relaying' });
    });
    const good = await stub((req, _b, res) => {
      keys.push(req.headers['idempotency-key'] as string);
      json(res, 200, view('Refunded'));
    });
    const hb = new Holdback({ operators: [await offline(), refuses, good] });
    const r = await hb.submit(trigger);
    expect(r.via).toBe(good);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("an operator's policy refusal (403) is not final: the SDK fails over, then submits directly under the same key (T-018)", async () => {
    const keys: string[] = [];
    const policy = await stub((req, _b, res) => {
      keys.push(req.headers['idempotency-key'] as string);
      json(res, 403, { type: 'relay_refused', title: 'relay_refused', status: 403, detail: 'operator policy: op-1 does not relay for this party' });
    });
    const { settlement, calls } = directSettlement(view('Delivered'));
    const hb = new Holdback({ operators: [policy, await offline()], settlement });
    const r = await hb.submit(trigger, { idempotencyKey: 'k-policy' });
    expect([r.via, r.state.escrowState]).toEqual(['direct', 'Delivered']);
    expect(keys).toEqual(['k-policy']);
    expect(calls.map((c) => c.options?.idempotencyKey)).toEqual(['k-policy']);
  });

  it('falls back to direct submission when every operator fails, with the same idempotency key', async () => {
    const { settlement, calls } = directSettlement();
    const hb = new Holdback({ operators: [await offline(), await offline()], settlement });
    const r = await hb.submit(trigger, { idempotencyKey: 'k-direct' });
    expect(r.via).toBe('direct');
    expect(r.receipt).toBeUndefined();
    expect(calls).toEqual([{ submission: trigger, options: { idempotencyKey: 'k-direct', via: 'direct' } }]);
  });

  it('throws the last problem when every operator fails and no settlement is configured', async () => {
    const op = await stub((_r, _b, res) => json(res, 409, { type: 'invalid_state', title: 'invalid_state', status: 409, detail: 'Held' }));
    const hb = new Holdback({ operators: [op] });
    const e = await hb.submit(trigger).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(HoldbackError);
    expect((e as HoldbackError).problem.type).toBe('invalid_state');
  });

  it('a refusal from the settlement layer itself is final', async () => {
    const settlement = {
      kind: 'sim',
      submit: async (): Promise<SubmitResult> => ({ ok: false, problem: { type: 'deadline_passed', detail: 'too early' } }),
    } as unknown as Settlement;
    const hb = new Holdback({ operators: [await offline()], settlement });
    const e = await hb.submit(trigger).catch((x: unknown) => x);
    expect((e as HoldbackError).problem.type).toBe('deadline_passed');
    expect((e as HoldbackError).via).toBe('direct');
  });
});

describe('Retry-After (ADR-0017 §3)', () => {
  it('waits once, for at most 2 seconds, on a large Retry-After, then fails over', async () => {
    const waits: number[] = [];
    let hits = 0;
    const slow = await stub((req, body, res) => {
      hits++;
      throttled('3600')(req, body, res);
    });
    const good = await stub((_r, _b, res) => json(res, 200, view('Refunded')));
    const hb = new Holdback({ operators: [slow, good], sleep: async (ms) => void waits.push(ms) });
    const r = await hb.submit(trigger);
    expect(waits).toEqual([2000]);
    expect(hits).toBe(2);
    expect(r.via).toBe(good);
  });

  it('never waits a second time in one call, even when the next operator also throttles', async () => {
    const waits: number[] = [];
    const a = await stub(throttled('1'));
    const b = await stub(throttled('1'));
    const { settlement } = directSettlement();
    const hb = new Holdback({ operators: [a, b], settlement, sleep: async (ms) => void waits.push(ms) });
    const r = await hb.submit(trigger);
    expect(waits).toEqual([1000]);
    expect(r.via).toBe('direct');
  });

  it('waits the cap, once, on a malformed Retry-After', async () => {
    const waits: number[] = [];
    const a = await stub(throttled('soon'));
    const good = await stub((_r, _b, res) => json(res, 200, view('Refunded')));
    const hb = new Holdback({ operators: [a, good], sleep: async (ms) => void waits.push(ms) });
    await hb.submit(trigger);
    expect(waits).toEqual([2000]);
  });
});

describe('preview (ADR-0017 §7)', () => {
  it('strips party signatures before any operator sees the body, and sends validateOnly', async () => {
    let url = '';
    let body: Record<string, unknown> = {};
    const op = await stub((req, b, res) => {
      url = req.url ?? '';
      body = JSON.parse(b) as Record<string, unknown>;
      json(res, 200, view('Released'), { 'holdback-dry-run': 'true', 'holdback-signature-check': 'skipped' });
    });
    const hb = new Holdback({ operators: [op] });
    const message = { type: 'EarlyAccept', commitmentId: ID, buyer: `0x${'33'.repeat(20)}`, attempt: 1, nonce: ID, expiresAt: '2026-12-01T00:00:00Z', signature: `0x${'44'.repeat(65)}` };
    const r = await hb.preview({ kind: 'early_accept', message } as never);
    expect(url).toBe(`/v1/commitments/${ID}/accept?validateOnly=true`);
    expect(body).not.toHaveProperty('signature');
    expect(r.dryRun).toBe(true);
    expect(r.signatureCheck).toBe('skipped');
  });

  it('strips both co-signatures from a mutual settlement preview', async () => {
    let body: Record<string, unknown> = {};
    const op = await stub((_req, b, res) => {
      body = JSON.parse(b) as Record<string, unknown>;
      json(res, 200, view('Settled'), { 'holdback-dry-run': 'true' });
    });
    const hb = new Holdback({ operators: [op] });
    await hb.preview({ kind: 'settle', message: { type: 'MutualSettlement', commitmentId: ID, buyerSignature: '0xaa', sellerSignature: '0xbb' } } as never);
    expect(body).not.toHaveProperty('buyerSignature');
    expect(body).not.toHaveProperty('sellerSignature');
  });

  it('previews directly through Settlement.validate when no operator answers', async () => {
    const { settlement, validated, calls } = directSettlement();
    const hb = new Holdback({ operators: [await offline()], settlement });
    const r = await hb.preview(trigger);
    expect(r.dryRun).toBe(true);
    expect(validated).toEqual([trigger]);
    expect(calls).toEqual([]);
  });
});

describe('reads and waitFor', () => {
  it('reads from the next operator, then the settlement layer', async () => {
    const { settlement } = directSettlement(view('Delivered'));
    const hb = new Holdback({ operators: [await offline()], settlement });
    expect((await hb.commitment(ID))?.escrowState).toBe('Delivered');
  });

  it("waitFor resolves on a target state, and on 'final' only once finalAt is set", async () => {
    const states = [view('Held'), view('Delivered'), view('Released'), view('Released', '2026-11-01T01:00:00Z')];
    let i = 0;
    const op = await stub((_r, _b, res) => json(res, 200, states[Math.min(i++, states.length - 1)]));
    const hb = new Holdback({ operators: [op], pollMs: 1 });
    expect((await hb.waitFor(ID, ['Released', 'Refunded'])).escrowState).toBe('Released');
    const final = await hb.waitFor(ID, 'final');
    expect(final.finalAt).toBe('2026-11-01T01:00:00Z');
  });

  it('waitFor times out with the last state it saw', async () => {
    const op = await stub((_r, _b, res) => json(res, 200, view('Held')));
    const hb = new Holdback({ operators: [op], pollMs: 1 });
    await expect(hb.waitFor(ID, ['Released'], { timeoutMs: 30 })).rejects.toThrow(/Held/);
  });
});
