// HTTP contract test (ADR-0017 §11, T-015). The snap runner drives SimChain directly, so the contract is proven
// on the HTTP flows instead: the examples' agent (examples/agent.ts: fetch, viem, tweetnacl and nothing else)
// and the sim-world flows run against a sim world's operators, every request to an operator is recorded, and
// every response is checked against spec/openapi.json: status listed, required headers present and valid,
// content type documented, body valid. Every documented operation must be exercised.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROBLEM_TYPES } from '../../packages/core/src/problem.ts';
import { testAccount } from '../../apps/operator/src/accounts.ts';
import { simRegistry } from '../../apps/operator/src/registry.ts';
import { startOperator, statusOf, SCHEMA_VERSION, type RunningOperator } from '../../apps/operator/src/server.ts';
import { API_PROBLEM_TYPES } from '../../apps/operator/src/problems.ts';
import { startSimWorld, type SimWorld } from '../../apps/operator/src/sim-world.ts';
import { PREPARE_KINDS } from '../../apps/operator/src/prepare.ts';
import { triggerPath } from '../../packages/sdk/src/operations.ts';
import { TIMEOUT_KINDS } from '../../packages/settlement/src/interface.ts';
import { simAgents, type Agent } from '../../examples/agent.ts';
// @ts-expect-error -- plain ESM helper without type declarations
import { buildOpenApi, checkOpenApiDocument, resolvePointer, serialize } from '../../scripts/openapi.mjs';
import { checkExchange, checkValue, DOC, OPERATIONS, routeOf, type Checked, type Exchange } from './openapi-check.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));

describe('spec/openapi.json, the document', () => {
  it('is a fresh build of spec/schemas and spec/openapi/paths.json, and validate:spec catches a stale copy', () => {
    expect(readFileSync(here('../../spec/openapi.json'), 'utf8')).toBe(serialize(buildOpenApi()));
    expect(checkOpenApiDocument()).toMatchObject({ ok: true, errors: [] });
    const stale = JSON.parse(readFileSync(here('../../spec/openapi.json'), 'utf8'));
    stale.components.schemas.TokenAmount.properties.amount.pattern = '^[0-9.]+$'; // a hand edit
    const file = join(mkdtempSync(join(tmpdir(), 't015-')), 'openapi.json');
    writeFileSync(file, serialize(stale));
    expect(checkOpenApiDocument({ file }).errors.join()).toMatch(/stale/);
  });

  it('documents exactly the routes docs/api.md says an operator serves, and lists the planned ones apart', () => {
    const api = readFileSync(here('../../docs/api.md'), 'utf8');
    const rows = [...api.matchAll(/^\| (GET|POST) \| `([^`]+)`( \(planned[^)]*\))? \|/gm)];
    const norm = (method: string, path: string) => `${method} ${path.split('?')[0]!.replace(/\{[^}]+\}/g, '{}')}`;
    // api.md writes one row per prepare kind as /v1/prepare/{kind}; the document has one operation per kind.
    const served = new Set(rows.filter((r) => !r[3]).flatMap(([, m, p]) => (p === '/v1/prepare/{kind}' ? Object.keys(DOC.paths).filter((x) => x.startsWith('/v1/prepare/')).map((x) => `POST ${x}`) : [norm(m!, p!)])));
    const planned = new Set(rows.filter((r) => r[3]).map(([, m, p]) => norm(m!, p!)));
    const documented = new Set(OPERATIONS.map((o) => norm(...(o.key.split(' ') as [string, string]))));
    expect([...documented].sort()).toEqual([...served].sort());
    expect(DOC['x-holdback-planned'].map((p: J) => norm(p.method, p.path)).sort()).toEqual([...planned].sort());
    // D39: a planned route answers 501 not_implemented with a Link to its source, so each row names one.
    for (const p of DOC['x-holdback-planned']) expect(p.source, p.path).toMatch(/^https:\/\/\S+$/);
    expect(rows.filter((r) => r[3]).every((r) => /^ \(planned: 501 today; /.test(r[3]!))).toBe(true);
  });

  it("documents every route the operator's router names: a route added to server.ts or the SDK's write table without the document fails", () => {
    // The router is code, not a table, so read the path literals it compares against: segments in server.ts
    // (s[N] === '...'), whole paths, and the write routes in the SDK's operationOf. Each must be a literal
    // segment of some documented path; the prepare kinds and trigger kinds must match the document exactly.
    const server = readFileSync(here('../../apps/operator/src/server.ts'), 'utf8');
    const ops = readFileSync(here('../../packages/sdk/src/operations.ts'), 'utf8');
    const start = ops.indexOf('export function operationOf');
    const operationOf = ops.slice(start, ops.indexOf('\n}\n', start));
    const literals = new Set([
      ...[...server.matchAll(/\bs\[\d\]!? [=!]== '([^']+)'/g)].map((m) => m[1]!),
      ...[...server.matchAll(/(?:pathname|join\('\/'\)) === '([^']+)'/g)].flatMap((m) => m[1]!.split('/').filter(Boolean)),
      ...[...operationOf.matchAll(/(?:segments\[\d\] [=!]== |action === |case )'([^']+)'/g)].map((m) => m[1]!),
    ]);
    expect(literals.size).toBeGreaterThan(25);
    const segments = new Set(Object.keys(DOC.paths).flatMap((p) => p.split('/').filter((x) => x && !x.startsWith('{'))));
    expect([...literals].filter((l) => !segments.has(l)).sort()).toEqual([]);
    expect(Object.keys(DOC.paths).filter((p) => p.startsWith('/v1/prepare/')).map((p) => p.slice('/v1/prepare/'.length)).sort()).toEqual([...PREPARE_KINDS].sort());
    expect(DOC.paths['/v1/commitments/{commitmentId}/triggers/{kind}'].post.parameters.find((p: J) => p.name === 'kind').schema.enum).toEqual(TIMEOUT_KINDS.map(triggerPath));
  });

  it('gives every operation an operationId, summary, a short description and a tag; prepare operations say verify before you sign', () => {
    const ids = OPERATIONS.map((o) => o.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = DOC.tags.map((t: J) => t.name).filter((n: string) => n !== 'core');
    for (const { key } of OPERATIONS) {
      const [method, path] = key.split(' ') as [string, string];
      const op = DOC.paths[path][method.toLowerCase()];
      expect(op.operationId, key).toMatch(/^[a-z][A-Za-z]+$/);
      expect(op.summary.length, key).toBeGreaterThan(5);
      expect(op.description.length, key).toBeGreaterThan(40);
      // T-030 (review F7): tool generators cap descriptions near 300 characters; the long lists live in externalDocs.
      expect(op.description.length, key).toBeLessThanOrEqual(300);
      expect(groups, key).toContain(op.tags[0]);
      expect(op.tags.slice(1), key).toEqual(op.tags.length > 1 ? ['core'] : []);
      if (path.startsWith('/v1/prepare/')) expect(op.description, key).toMatch(/\*\*Verify before you sign\.\*\*/);
    }
    expect(DOC.externalDocs.url).toMatch(/^https:\/\//);
    // The happy path, tagged `core` so a tool generator can load only these (D39).
    const core = OPERATIONS.filter((o) => DOC.paths[o.key.split(' ')[1]!][o.key.split(' ')[0]!.toLowerCase()].tags.includes('core')).map((o) => o.operationId);
    expect(core.sort()).toEqual(['fundFromFaucet', 'getAdjudicator', 'getCiphertext', 'getClub', 'getCommitment', 'getCommitmentTerms', 'getDiscovery', 'listCommitmentEvents', 'listReleasedKeys', 'prepareAgreeAndFund', 'prepareDelivery', 'prepareOffer', 'submitAgreement', 'submitDelivery', 'submitOffer', 'uploadCiphertext']);
    expect(DOC.paths['/v1/faucet'].post.tags[0]).toBe('demo');
  });

  it('keeps x-holdback-untrusted on every party-authored field of spec/schemas', () => {
    const dir = here('../../spec/schemas');
    let marked = 0;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.schema.json'))) {
      const pascal = file.replace('.schema.json', '').split('-').map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
      const walk = (node: J, pointer: string): void => {
        if (!node || typeof node !== 'object') return;
        if (node['x-holdback-untrusted'] === true) {
          const def = /^\/\$defs\/([^/]+)(.*)$/.exec(pointer);
          const mapped = def ? `/components/schemas/${def[1]}${def[2]}` : `/components/schemas/${pascal}${pointer}`;
          expect(resolvePointer(DOC, mapped)?.['x-holdback-untrusted'], `${file}#${pointer}`).toBe(true);
          marked++;
        }
        for (const [k, v] of Object.entries(node)) walk(v, `${pointer}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`);
      };
      walk(JSON.parse(readFileSync(join(dir, file), 'utf8')), '');
    }
    expect(marked).toBeGreaterThan(20);
  });

  it('describes each problem type under the status the operator answers it with', () => {
    expect(DOC.components.schemas.Problem.properties.type.enum).toEqual([...API_PROBLEM_TYPES]);
    expect(API_PROBLEM_TYPES).toEqual(expect.arrayContaining([...PROBLEM_TYPES]));
    for (const type of API_PROBLEM_TYPES) {
      const response = DOC.components.responses[`Problem${statusOf(type)}`];
      expect(response?.description, `${type} -> ${statusOf(type)}`).toContain(type);
    }
    expect(DOC.info['x-holdback-schema-version']).toBe(SCHEMA_VERSION);
  });

  it('adds no bound the operator does not have to negotiable values (D31)', () => {
    const timing = DOC.components.schemas.PrepareOfferInput.properties.timing.properties;
    for (const [k, s] of Object.entries<J>(timing)) expect(s, k).toEqual({ type: 'integer', minimum: 0 });
    const offer = { nonce: `0x${'9'.repeat(64)}`, disclosure: 'public', seller: `0x${'1'.repeat(40)}`, buyer: { address: `0x${'2'.repeat(40)}`, encryptionPublicKey: 'pOCSkrZRwni5dyxWn1-puxPZBrRqtoyd-dwrRAn4ogk' }, adjudicators: { primary: `0x${'3'.repeat(40)}`, fallback: `0x${'4'.repeat(40)}`, appeal: `0x${'5'.repeat(40)}` }, clubId: 'sim-club', price: { token: 'tUSD', amount: '25000000' }, deliverable: { kind: 'dataset', description: 'x', format: 'text/csv' } };
    const input = '/paths/~1v1~1prepare~1offer/post/requestBody/content/application~1json/schema';
    expect(checkValue(input, { ...offer, timing: { deliverWithinSec: 400 * 365 * 86_400, judgeWithinSec: 0 }, createdAt: '2020-01-01T00:00:00Z' })).toEqual([]);
  });
});

// ---- the running operator -------------------------------------------------------------------------------

let world: SimWorld;
let extra: RunningOperator;
let feeNode: RunningOperator;
const exchanges: Exchange[] = [];
const realFetch = globalThis.fetch;

/** Records every request to an operator of this test, response body included, and passes it through. */
function recording(operators: string[]): typeof fetch {
  const origins = new Set(operators.map((o) => new URL(o).origin));
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const res = await realFetch(input, init);
    if (!origins.has(url.origin)) return res;
    const headers = new Headers(init?.headers);
    const stream = (res.headers.get('content-type') ?? '').startsWith('text/event-stream');
    exchanges.push({
      method: (init?.method ?? 'GET').toUpperCase(),
      url,
      status: res.status,
      headers: res.headers,
      ...(stream ? {} : { body: Buffer.from(await res.clone().arrayBuffer()) }),
      request: { contentType: headers.get('content-type') ?? undefined, body: typeof init?.body === 'string' ? init.body : undefined },
    });
    return res;
  };
}

beforeAll(async () => {
  world = await startSimWorld({ env: {}, onError: () => {}, pollMs: 50 });
  // A third node over the same chain: one read per minute and a relay policy that declines everything, for
  // the 429 and 403 relay_refused answers.
  extra = await startOperator({
    settlement: world.chain,
    registry: simRegistry(world.chain),
    signerKey: testAccount('t015-operator').privateKey,
    operatorId: 't015-refuses',
    env: {},
    rateLimit: { reads: 1, writes: 100, windowMs: 60_000 },
    policy: () => ({ type: 'relay_refused', detail: 'this test node relays nothing' }),
  });
  // A fourth node that charges D33's operator fee (ADR-0023), for the third prepared slot and the 402 answer.
  feeNode = await startOperator({
    settlement: world.chain,
    registry: simRegistry(world.chain),
    signerKey: testAccount('t029-operator').privateKey,
    operatorId: 't029-fee',
    env: {},
    fee: { to: testAccount('t029-fees').address, token: 'tUSD', bps: 1, min: '10000', max: null, appliesAt: 'agree-and-fund', refundable: false },
  });
  globalThis.fetch = recording([...world.info.operators, extra.url, feeNode.url]);
}, 30_000);
afterAll(async () => {
  globalThis.fetch = realFetch;
  await extra?.close();
  await feeNode?.close();
  await world?.close();
});

const ints = (types: J, type: string, v: J): J =>
  type.endsWith('[]') ? v.map((x: J) => ints(types, type.slice(0, -2), x)) : types[type] ? Object.fromEntries(types[type].map((f: J) => [f.name, ints(types, f.type, v[f.name])])) : /^u?int\d*$/.test(type) ? BigInt(v) : v;

/** Signs each slot of a prepared message with the agent that is its signer (no verification: a contract test). */
async function signed(p: J, agents: Agent[]): Promise<{ path: string; body: J }> {
  for (const s of p.sign) {
    const agent = agents.find((a) => a.address === s.signer.toLowerCase())!;
    const t = s.typedData;
    const sig = await agent.account.signTypedData({ ...t, message: ints(t.types, t.primaryType, t.message) });
    const keys = s.slot.split('.');
    keys.slice(0, -1).reduce((o: J, k: string) => o[k], p.submit.body)[keys.at(-1)!] = sig;
  }
  return { path: p.submit.path, body: p.submit.body };
}

/** A raw request to an operator, for answers an Agent would throw on. */
async function http(method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: J; headers: Headers }> {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text && /json/.test(res.headers.get('content-type') ?? '') ? JSON.parse(text) : text };
}

const CSV = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n3,grace@example.com\n';

describe('HTTP contract: every operator response matches spec/openapi.json', () => {
  it('runs the examples and sim-world flows over HTTP, and every response validates', async () => {
    const sim = await simAgents(world.url);
    const [api] = world.info.operators as [string];
    const [primary, fallback, appeal] = sim.info.adjudicators.map((a) => a.address);
    const nonce = () => `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;
    const request = (seller: Agent, buyer: Agent, extraFields: J = {}) => ({
      nonce: nonce(),
      disclosure: 'public',
      template: 'checks-only',
      clubId: sim.info.clubId,
      seller: seller.address,
      buyer: { address: buyer.address, encryptionPublicKey: buyer.encryptionPublicKey },
      adjudicators: { primary, fallback, appeal },
      price: { token: 'tUSD', amount: '25000000' },
      deliverable: { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' },
      checks: [
        { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
        { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
      ],
      ...extraFields,
    });
    const held = async () => {
      const buyer = await sim.fresh();
      const seller = await sim.fresh();
      const offer = await seller.offer(request(seller, buyer));
      await buyer.waitFor(offer.id, ['AcceptedByAdjudicator']);
      await buyer.agreeAndFund(offer.terms, 30_000_000n);
      return { buyer, seller, id: offer.id, terms: offer.terms };
    };

    // Discovery and documents.
    await http('GET', `${api}/.well-known/holdback.json`);
    await http('GET', `${api}/v1/status`);
    const served = await http('GET', `${api}/v1/openapi.json`);
    expect(served.body.servers).toEqual([{ url: api, description: 'This operator node' }]);
    expect({ ...served.body, servers: DOC.servers }).toEqual(DOC);
    const llms = await http('GET', `${api}/llms.txt`);
    expect(llms.body).toContain(`${api}/v1/openapi.json`);
    expect(llms.body).toContain('https://escrow.stream/llms.txt');
    expect(llms.body).toContain('https://raw.githubusercontent.com/rafaeldavid/holdback/main/docs/api.md');

    // 1. examples/buy-dataset: offer, agree and fund, encrypted delivery, release, the buyer opens the data.
    const a = await held();
    await a.seller.deliver(a.terms, new TextEncoder().encode(CSV));
    expect((await a.buyer.waitFor(a.id, ['Released', 'Refunded'])).escrowState).toBe('Released');
    expect(await a.buyer.openDelivery(a.id)).toContain('grace@example.com');
    await a.buyer.call('GET', `/v1/balances/${a.buyer.address}`);
    await a.buyer.call('GET', `/v1/commitments/${a.id}/receipts`);
    await a.buyer.call('GET', `/v1/commitments/${a.id}/judgment`);
    await a.buyer.call('GET', `/v1/commitments/${a.id}/terms`); // T-025
    await a.buyer.call('GET', `/v1/agents/${world.info.accounts[0]!.address}`);
    await a.buyer.call('GET', '/v1/adjudicators');
    await a.buyer.call('GET', `/v1/commitments?party=${a.buyer.address}&role=buyer&escrowState=Released&escrowState=Refunded`);
    const first = await a.buyer.call('GET', `/v1/commitments/${a.id}/events?limit=1`);
    expect(first.nextCursor).toEqual(expect.any(String));
    await a.buyer.call('GET', `/v1/commitments/${a.id}/events?limit=1&cursor=${first.nextCursor}`);

    // 2. Refund on failed checks, then the seller appeals.
    const b = await held();
    await b.seller.deliver(b.terms, new TextEncoder().encode('customer_id,email\n'));
    expect((await b.buyer.waitFor(b.id, ['Released', 'Refunded'])).escrowState).toBe('Refunded');
    const appealed = await signed(await b.seller.call('POST', '/v1/prepare/appeal', { commitmentId: b.id, appellant: b.seller.address }), [b.seller]);
    expect((await b.seller.call('POST', appealed.path, appealed.body)).appealState).not.toBe('none');

    // 3. Early accept by the buyer while the primary adjudicator is silent.
    const c = await held();
    world.silence('primary', true);
    try {
      await c.seller.deliver(c.terms, new TextEncoder().encode(CSV));
      const accepted = await signed(await c.buyer.call('POST', '/v1/prepare/early-accept', { commitmentId: c.id, nonce: nonce() }), [c.buyer]);
      expect((await c.buyer.call('POST', accepted.path, accepted.body)).escrowState).toBe('Released');
    } finally {
      world.silence('primary', false);
    }

    // 4. Mutual settlement before delivery: both parties sign the same typed data.
    const d = await held();
    const settled = await signed(await d.buyer.call('POST', '/v1/prepare/settlement', { commitmentId: d.id, toSellerBps: 3000, nonce: nonce() }), [d.buyer, d.seller]);
    expect((await d.buyer.call('POST', settled.path, settled.body)).escrowState).toBe('Settled');

    // 5. Dry run of an unsigned offer, then idempotent replay and conflict on the faucet.
    const e1 = await sim.fresh();
    const e2 = await sim.fresh();
    const draft = await e1.call('POST', '/v1/prepare/offer', { ...request(e1, e2), nonce: `0x${'e1'.repeat(32)}` });
    const unsigned = { ...draft.submit.body, signatures: {} };
    const dry = await http('POST', `${api}/v1/commitments?validateOnly=true`, unsigned, { 'idempotency-key': 't015-dry' });
    expect([dry.status, dry.headers.get('holdback-dry-run'), dry.headers.get('holdback-signature-check')]).toEqual([200, 'true', 'skipped']);
    // T-025: the prepared body exactly as returned, "signatures": { "seller": null }, previews too.
    expect(draft.submit.body.signatures).toEqual({ seller: null });
    const asReturned = await http('POST', `${api}/v1/commitments?validateOnly=true`, draft.submit.body);
    expect([asReturned.status, asReturned.headers.get('holdback-signature-check')]).toEqual([200, 'skipped']);
    const faucet = { address: e1.address, amount: '1000000' };
    const once = await http('POST', `${api}/v1/faucet`, faucet, { 'idempotency-key': 't015-faucet' });
    const again = await http('POST', `${api}/v1/faucet`, faucet, { 'idempotency-key': 't015-faucet' });
    expect([once.status, again.body]).toEqual([200, once.body]);
    expect((await http('POST', `${api}/v1/faucet`, { ...faucet, amount: '2' }, { 'idempotency-key': 't015-faucet' })).body.type).toBe('idempotency_conflict');
    expect((await http('POST', `${api}/v1/faucet`, { address: e2.address }, { 'idempotency-key': 't015-faucet-default' })).body.granted.token).toBe('tUSD');

    // 6. Problems a caller can meet on each kind of route.
    const zero = `0x${'0'.repeat(64)}`;
    const key = (k: string) => ({ 'idempotency-key': `t015-${k}` });
    expect((await http('GET', `${api}/v1/commitments/${zero}`)).status).toBe(404);
    expect((await http('GET', `${api}/v1/commitments?limit=999`)).body).toMatchObject({ type: 'invalid_terms', field: 'limit' });
    expect((await http('GET', `${api}/v1/commitments?cursor=@`)).body.type).toBe('invalid_cursor');
    expect((await http('GET', `${api}/v1/clubs/${sim.info.clubId}/members/${a.buyer.address}`)).status).toBe(404);
    expect((await http('GET', `${api}/v1/balances/not-an-address`)).status).toBe(400);
    expect((await http('GET', `${api}/v1/commitments/${a.id}/key`)).status).toBe(400);
    expect((await http('GET', `${api}/v1/ciphertext/sha256:${'0'.repeat(64)}`)).status).toBe(404);
    expect((await http('POST', `${api}/v1/prepare/offer`, { ...request(e1, e2), price: { token: 'tUSD', amount: '25.5' } })).status).toBe(400);
    expect((await http('POST', `${api}/v1/prepare/agree-and-fund`, { commitmentId: zero })).status).toBe(404);
    expect((await http('POST', `${api}/v1/prepare/delivery`, { commitmentId: a.id, ciphertext: { uri: 'x', sha256: 'sha256:00', bytes: 1 }, plaintextSha256: 'sha256:00', encryptedKeys: [] })).status).toBe(400);
    expect((await http('POST', `${api}/v1/commitments`, draft.submit.body)).status).toBe(400); // no Idempotency-Key
    expect((await http('POST', `${api}/v1/holds`, {}, key('hold'))).status).toBe(400);
    for (const route of ['acceptance', 'fund', 'decisions']) expect((await http('POST', `${api}/v1/commitments/${a.id}/${route}`, { commitmentId: a.id }, key(route))).status, route).toBe(400);
    expect((await http('POST', `${api}/v1/commitments/${a.id}/accept`, { ...settled.body, type: 'EarlyAccept' }, key('accept'))).status).toBe(400);
    expect((await http('POST', `${api}/v1/commitments/${b.id}/triggers/fallback`, {}, key('early-trigger'))).status).toBe(409);

    // 7. The third node throttles reads and declines to relay.
    expect((await http('GET', `${extra.url}/v1/status`)).status).toBe(200);
    const throttled = await http('GET', `${extra.url}/v1/status`);
    expect([throttled.status, throttled.body.type, throttled.headers.get('retry-after')]).toEqual([429, 'rate_limited', expect.stringMatching(/^\d+$/)]);
    const declined = await http('POST', `${extra.url}/v1/commitments`, await signed(draft, [e1]).then((s) => s.body), key('declined'));
    expect([declined.status, declined.body.type]).toEqual([403, 'relay_refused']);

    // 7b. The fee node (ADR-0023): status with fees, three slots, 402 without the fee, Held with it.
    expect((await http('GET', `${feeNode.url}/v1/status`)).body.fees.operator.bps).toBe(1);
    const feeOffer = await e1.offer(request(e1, e2));
    await e2.waitFor(feeOffer.id, ['AcceptedByAdjudicator']);
    const fp = (await http('POST', `${feeNode.url}/v1/prepare/agree-and-fund`, { commitmentId: feeOffer.id, agreeNonce: nonce(), fundingNonce: nonce(), operatorFeeNonce: nonce() })).body;
    expect(fp.sign.map((s: J) => s.slot)).toEqual(['signature', 'fund.signature', 'operatorFee.signature']);
    const paid = await signed(fp, [e2]);
    const { operatorFee, ...unpaid } = paid.body;
    expect(operatorFee.value).toBe('10000');
    const owed = await http('POST', `${feeNode.url}${paid.path}`, unpaid, key('unpaid'));
    expect([owed.status, owed.body.type, owed.body.fee.amount]).toEqual([402, 'payment_required', '10000']);
    expect((await http('POST', `${feeNode.url}${paid.path}`, paid.body, key('paid'))).body.escrowState).toBe('Held');

    // 8. Triggers once deadlines pass: an offer nobody agreed to expires; a hold with no delivery is reclaimed.
    const lapsed = await e1.offer(request(e1, e2));
    const r = await held();
    world.advance(2 * 86_400);
    expect((await http('POST', `${api}/v1/commitments/${lapsed.id}/triggers/expire-offer`, {}, key('expire'))).status).toBe(200);
    expect((await http('POST', `${api}/v1/commitments/${r.id}/triggers/reclaim`, {}, key('reclaim'))).body.escrowState).toBe('Refunded');

    // 8b. A private deal (ADR-0024): offered sealed under per-deal keys. Anyone reads the projection; a token from
    // someone who is not a party is 401; a co-signed Publish to judgment discloses the acceptance.
    const [pb, ps] = [await sim.fresh(), await sim.fresh()];
    const pPrice = { token: 'tUSD', amount: '5000000' };
    const { deal: pBuyer } = await pb.dealKeys(sim.info.clubId, 'buyer', pPrice);
    const { deal: pSeller } = await ps.dealKeys(sim.info.clubId, 'seller', pPrice);
    const po = await pSeller.offerPrivate({
      clubId: sim.info.clubId,
      buyer: { address: pBuyer.address, encryptionPublicKey: pBuyer.encryptionPublicKey },
      adjudicators: { primary: primary!, fallback: fallback!, appeal: appeal! },
      price: pPrice,
      deliverable: { kind: 'dataset', description: 'a private dataset', format: 'text/csv' },
      acceptance: { deterministicChecks: [{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['id'] }], rubric: { criteria: [], passThreshold: 0 } },
    });
    expect((await http('GET', `${api}/v1/commitments/${po.id}/terms`)).body.hashes.acceptanceHash).toMatch(/^0x/);
    const stranger = await http('GET', `${api}/v1/commitments/${po.id}/terms`, undefined, { authorization: await pb.readToken(po.id, api) });
    expect([stranger.status, stranger.body.type]).toEqual([401, 'unauthorized']);
    const pm = { commitmentId: po.id, level: 'judgment' as const, nonce: `0x${'7e'.repeat(32)}` as const, expiresAt: new Date(Math.floor((await pSeller.settlementNow()) / 1000) * 1000 + 3_600_000).toISOString().replace('.000Z', 'Z') };
    const publish = { type: 'Publish', ...pm, buyerSignature: await pBuyer.signPublish(pm), sellerSignature: await pSeller.signPublish(pm) };
    const disclosed = await http('POST', `${api}/v1/commitments/${po.id}/disclosure`, { commitmentId: po.id, publish, keys: { acceptanceKey: Buffer.from(po.keys.acceptance).toString('base64url') } }, key('disclose'));
    expect(disclosed.body.disclosed.acceptance.deterministicChecks[0].columns).toEqual(['id']);

    // 9. The event stream: headers, and the first event against the Event schema.
    const ctl = new AbortController();
    const stream = await fetch(`${api}/v1/events?from=0`, { signal: ctl.signal });
    const reader = stream.body!.getReader();
    let text = '';
    while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value);
    ctl.abort();
    const data = /^data: (.*)$/m.exec(text)![1]!;
    expect(checkValue('/paths/~1v1~1events/get/responses/200/content/text~1event-stream/x-holdback-item-schema', JSON.parse(data))).toEqual([]);

    // Every recorded exchange against the document.
    const results: Array<Checked & { status: number; line: string }> = exchanges.map((x) => ({ ...checkExchange(x), status: x.status, line: `${x.method} ${x.url.pathname}${x.url.search} -> ${x.status}` }));
    const failures = results.filter((x) => x.errors.length).map((x) => `${x.line}\n    ${x.errors.join('\n    ')}`);
    expect(failures, failures.join('\n')).toEqual([]);

    // Coverage: every documented operation was called. These few were reached only with a refusal: the sim
    // adjudicators sign acceptances and decisions and submit them to SimChain themselves, a separate fund and
    // a one-shot hold need signatures the prepare flow does not produce, and the sim club admits no members.
    const hit = new Set(results.map((x) => x.operationId));
    const ok = new Set(results.filter((x) => x.status < 300).map((x) => x.operationId));
    expect(OPERATIONS.map((o) => o.operationId).filter((id) => !hit.has(id))).toEqual([]);
    // ...and the operator routed each of them: no documented call was answered "no route".
    expect(exchanges.filter((x) => /no (such )?route/i.test(x.body?.toString('utf8') ?? '')).map((x) => `${x.method} ${x.url.pathname}`)).toEqual([]);
    expect(OPERATIONS.map((o) => o.operationId).filter((id) => !ok.has(id)).sort()).toEqual(['getClubMember', 'submitAdjudicatorAcceptance', 'submitDecision', 'submitFunding', 'submitHold']);
    const statuses = [...new Set(results.map((x) => x.status))].sort();
    expect(statuses).toEqual([200, 400, 401, 402, 403, 404, 409, 429]);
    console.log(`contract: ${exchanges.length} exchanges, ${hit.size}/${OPERATIONS.length} operations, ${ok.size} with a 2xx, statuses ${statuses.join(' ')}`);
  }, 120_000);

  it('matches each route to one documented operation', () => {
    expect(routeOf('POST', '/v1/prepare/offer')?.op.operationId).toBe('prepareOffer');
    expect(routeOf('GET', `/v1/commitments/0x${'a'.repeat(64)}/events`)?.op.operationId).toBe('listCommitmentEvents');
    expect(routeOf('POST', '/v1/commitments')?.op.operationId).toBe('submitOffer');
    expect(routeOf('POST', '/v1/clubs')).toBeUndefined(); // planned: not in the document
  });

  it('refuses an answer the document does not describe', () => {
    const headers = (h: Record<string, string>) => new Headers({ 'content-type': 'application/json', 'request-id': '6f1c2a8e-1b9d-4c3e-9f70-2d8a7b4e5c11', 'holdback-schema-version': '0.6', ...h });
    const x = (status: number, h: Record<string, string>, body: unknown): Exchange => ({ method: 'GET', url: new URL('http://op.test/v1/balances/0x0000000000000000000000000000000000000001'), status, headers: headers(h), body: Buffer.from(JSON.stringify(body)) });
    expect(checkExchange(x(200, {}, { token: 'tUSD', amount: '1' })).errors).toEqual([]);
    expect(checkExchange(x(200, {}, { token: 'tUSD', amount: '1.5' })).errors.join()).toMatch(/must match pattern/);
    expect(checkExchange(x(201, {}, { token: 'tUSD', amount: '1' })).errors.join()).toMatch(/status 201 is not listed/);
    expect(checkExchange(x(200, { 'holdback-schema-version': 'v0.6' }, { token: 'tUSD', amount: '1' })).errors.join()).toMatch(/Holdback-Schema-Version/);
    expect(checkExchange(x(200, { 'content-type': 'text/plain' }, 'x')).errors.join()).toMatch(/content type text\/plain/);
    const noId = x(200, {}, { token: 'tUSD', amount: '1' });
    noId.headers.delete('request-id');
    expect(checkExchange(noId).errors.join()).toMatch(/missing required header Request-Id/);
    const problem = { type: 'invalid_terms', title: 'invalid_terms', status: 400, detail: 'x', instance: 'urn:holdback:request:00000000-0000-0000-0000-000000000000' };
    expect(checkExchange(x(400, { 'content-type': 'application/problem+json' }, problem)).errors.join()).toMatch(/instance does not repeat Request-Id/);
  });
});
