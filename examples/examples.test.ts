// The examples run as a newcomer runs them: `pnpm example <name>` starts a separate Node process (types
// stripped) that reaches the sim over HTTP only, with fetch, viem and tweetnacl.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
    expect(r.out).toContain('check: price 25 tUSD; adjudication fee 1 tUSD');
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

  it('sign.ts (the quickstart signer) signs a prepared offer the operator accepts', async () => {
    const api = world.info.operators[0]!;
    const acct = (l: string) => world.info.accounts.find((a) => a.label === l)!;
    const [primary, fallback, appeal] = world.info.adjudicators.map((a) => a.address);
    const prepared = await (
      await fetch(`${api}/v1/prepare/offer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          template: 'checks-only',
          clubId: world.info.clubId,
          seller: acct('seller-2').address,
          buyer: { address: acct('buyer-2').address, encryptionPublicKey: acct('buyer-2').encryptionPublicKey },
          adjudicators: { primary, fallback, appeal },
          price: { token: 'tUSD', amount: '5000000' },
          deliverable: { kind: 'dataset', description: 'x', format: 'text/csv' },
          checks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['a'] }],
        }),
      })
    ).text();
    const body = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [here('./sign.ts')], { env: { ...process.env, HOLDBACK_KEY: acct('seller-2').privateKey } });
      let out = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      child.stderr.on('data', (d: Buffer) => (out += d.toString()));
      child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(out))));
      child.stdin.end(prepared);
    });
    const res = await fetch(`${api}/v1/commitments`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'sign-ts-1' }, body });
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
