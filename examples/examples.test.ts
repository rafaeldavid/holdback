// The examples run as a newcomer runs them: `pnpm example <name>` starts a separate Node process (types
// stripped) that reaches the sim over HTTP only, with fetch, viem and tweetnacl.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashTypedData } from 'viem';
import { startSimWorld, type SimWorld } from '@holdback/operator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
/** Nothing listens here, so run.ts starts its own sim for the run. */
const NO_SIM = 'http://127.0.0.1:9';
let world: SimWorld;

beforeAll(async () => {
  world = await startSimWorld({ env: {}, onError: () => {} });
});
afterAll(() => world.close());

/** `node examples/run.ts <args>` with HOLDBACK_SIM_URL set; resolves with the exit code and output. */
function example(args: string[], simUrl: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [here('./run.ts'), ...args], { env: { ...process.env, HOLDBACK_SIM_URL: simUrl } });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('exit', (code) => resolve({ code, out }));
  });
}

describe('examples', () => {
  it('buy-dataset settles against a running sim and the buyer opens the data', async () => {
    const r = await example(['buy-dataset'], world.url);
    expect(r.out).not.toContain('started one in this process');
    expect(r.out).toMatch(/offer 0x[0-9a-f]{64}: Offered/);
    expect(r.out).toContain('held: Held, 26000000 base units');
    expect(r.out).toContain('outcome: Released');
    expect(r.out).toContain('3,grace@example.com');
    expect(r.code, r.out).toBe(0);
  }, 60_000);

  it('sell-translation starts its own sim when none runs, and says the judges were fake', async () => {
    const r = await example(['sell-translation'], NO_SIM);
    expect(r.out).toContain('started one in this process');
    expect(r.out).toContain('outcome: Released');
    expect(r.out).toMatch(/panel of 3, FAKE JUDGES \(no model ran\): accept/);
    expect(r.out).toContain('key released to the primary adjudicator\nkey released to the buyer');
    expect(r.code, r.out).toBe(0);
  }, 60_000);

  it('sign.ts (the quickstart signer) signs an honest offer, and refuses the reviewer\'s edited one', async () => {
    const api = world.info.operators[0]!;
    const acct = (l: string) => world.info.accounts.find((a) => a.label === l)!;
    const [primary, fallback, appeal] = world.info.adjudicators.map((a) => a.address);
    const request = {
      nonce: `0x${'5a'.repeat(32)}`, // the agent's own nonce
      template: 'checks-only',
      clubId: world.info.clubId,
      seller: acct('seller-2').address,
      buyer: { address: acct('buyer-2').address, encryptionPublicKey: acct('buyer-2').encryptionPublicKey },
      adjudicators: { primary, fallback, appeal },
      price: { token: 'tUSD', amount: '5000000' },
      deliverable: { kind: 'dataset', description: 'x', format: 'text/csv' },
      checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['a'] }],
    };
    const prepared = await (await fetch(`${api}/v1/prepare/offer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) })).json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const dir = mkdtempSync(join(tmpdir(), 't020-sign-'));
    writeFileSync(join(dir, 'intent.json'), JSON.stringify(request));
    const sign = (p: unknown) =>
      new Promise<{ code: number | null; out: string }>((resolve) => {
        writeFileSync(join(dir, 'prepared.json'), JSON.stringify(p));
        const env = { ...process.env, HOLDBACK_KEY: acct('seller-2').privateKey, HOLDBACK_OPERATORS: world.info.operators.join(',') };
        const child = spawn(process.execPath, [here('./sign.ts'), join(dir, 'prepared.json'), join(dir, 'intent.json')], { env });
        let out = '';
        child.stdout.on('data', (d: Buffer) => (out += d.toString()));
        child.stderr.on('data', (d: Buffer) => (out += d.toString()));
        child.on('exit', (code) => resolve({ code, out }));
      });
    // The review's attack: buyer, price, primary, chainId and verifyingContract edited, digest recomputed, extra slot.
    const edited = structuredClone(prepared);
    const m = edited.sign[0].typedData;
    m.message.buyer = '0x000000000000000000000000000000000000dead';
    m.message.price.amount = '9000000000';
    m.message.adjudication.adjudicator = '0x000000000000000000000000000000000000beef';
    m.domain = { ...m.domain, chainId: 1, verifyingContract: '0x1111111111111111111111111111111111111111' };
    const types = { ...m.types };
    delete types.EIP712Domain;
    const ints = (t: string, v: any): any => (t.endsWith('[]') ? v.map((x: any) => ints(t.slice(0, -2), x)) : types[t] ? Object.fromEntries(types[t].map((x: any) => [x.name, ints(x.type, v[x.name])])) : /^u?int/.test(t) ? BigInt(v) : v); // eslint-disable-line @typescript-eslint/no-explicit-any
    edited.sign[0].digest = hashTypedData({ ...m, types, message: ints(m.primaryType, m.message) });
    edited.sign.push({ ...edited.sign[0], slot: 'signatures.buyer' });
    const refused = await sign(edited);
    expect(refused.code, refused.out).toBe(3);
    expect(refused.out).toMatch(/refusing to sign/);
    const ok = await sign(prepared);
    expect(ok.code, ok.out).toBe(0);
    const res = await fetch(`${api}/v1/commitments`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'sign-ts-1' }, body: ok.out });
    expect(((await res.json()) as { escrowState: string }).escrowState).toBe('Offered');
  }, 30_000);

  it('refuses an unknown example name', async () => {
    expect((await example(['nope'], world.url)).code).toBe(2);
  });

  it('keeps each example under 60 lines and free of Holdback packages', () => {
    for (const f of ['./buy-dataset.ts', './sell-translation.ts', './agent.ts']) {
      const src = readFileSync(here(f), 'utf8');
      if (f !== './agent.ts') expect(src.trimEnd().split('\n').length, f).toBeLessThanOrEqual(60);
      expect(src, f).not.toMatch(/from '@holdback\//);
    }
  });

  it('docs/api.md marks exactly the unbuilt routes as planned', async () => {
    const api = world.info.operators[0]!;
    const rows = [...readFileSync(here('../docs/api.md'), 'utf8').matchAll(/^\| (GET|POST) \| `([^`]+)`( \(planned[^)]*\))? \|/gm)];
    expect(rows.length).toBeGreaterThan(30);
    for (const [, method, raw, planned] of rows) {
      const path = raw!.split('?')[0]!.replace(/\{id\}/g, `0x${'0'.repeat(64)}`).replace(/\{(address|principal)\}/g, `0x${'0'.repeat(40)}`).replace(/\{kind\}/g, 'offer');
      if (path.includes('{') || path === '/v1/events') continue; // the event stream never ends a response
      const res = await fetch(`${api}${path}`, { method: method!, headers: { 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
      const unrouted = /no (such )?route/.test((await res.text()).toLowerCase());
      expect(unrouted, `${method} ${raw}`).toBe(Boolean(planned));
    }
  });

  it('every API path the quickstart curls is a route the operator serves', async () => {
    const doc = readFileSync(here('../docs/quickstart.md'), 'utf8');
    const paths = [...doc.matchAll(/\$API(\/v1\/[A-Za-z0-9/_.-]*|\/\.well-known\/holdback\.json)/g)].map((m) => m[1]!.replace(/\$\w+/g, ''));
    expect(paths.length).toBeGreaterThan(8);
    const api = world.info.operators[0]!;
    for (const p of new Set(paths)) {
      const path = p.replace(/\/commitments\/(?=\/|$)/, `/commitments/0x${'0'.repeat(64)}`).replace(/\/(balances|adjudicators)\/(?=$)/, `/$1/0x${'0'.repeat(40)}`);
      for (const method of ['GET', 'POST']) {
        const res = await fetch(`${api}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
        const body = (await res.text()).toLowerCase();
        if (!body.includes('no route')) break;
        if (method === 'POST') throw new Error(`the quickstart curls ${p}, which no operator route serves`);
      }
    }
  });
});
