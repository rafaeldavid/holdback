// The workspace guard (T-435, ADR-0037 section 5): a configuration names the account its jobs run in once, as
// `sellerApi.workspace`. The quote and start paths must carry it as {{workspace}}, filled from that field only, and a
// result that says its job ran in another account is never delivered. Deals run on SimChain against the job stub.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hex } from 'viem';
import { startSimWorld, type SimWorld } from '@holdback/operator';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { loadConfig, startSellerAdapter, type RunningAdapter } from './seller-adapter.ts';
import { sellerApiClient } from './seller-adapter-api.ts';
import { jobStubSellerApi, startJobStub, type JobStub, type JobStubOptions } from './seller-adapter-job-stub.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const KEY = 'workspace-test-credential-51c0';
const WS = 'ws-alpha+7'; // a plus, so the test sees it percent-encoded in the path
const SCOPE = { target: 'vault-core', depth: 2 };
const SCOPE_RULES = { target: { type: 'string', pattern: '^[a-z0-9-]{1,40}$' }, depth: { type: 'integer', min: 1, max: 10 } };
const FIELDS = { scope: ['target', 'depth'], options: [] };
const TEMPLATE = {
  deliverable: { kind: 'document', description: 'A review of {{target}} to depth {{depth}}.', format: 'application/json' },
  checks: [{ id: 'report', type: 'json_schema', required: true, schema: { type: 'object', required: ['summary', 'target'], properties: { target: { const: '{{target}}' } } } }],
};

/** The stub's mapping with the account in the quote and start paths, and the result read for it. */
function pinnedApi(base: string, resultPointer: string | undefined = '/run/workspace'): J {
  const api = jobStubSellerApi(base);
  delete api.result.files;
  api.quote.path = 'workspaces/{{workspace}}/estimates';
  api.start.path = 'workspaces/{{workspace}}/runs';
  api.workspace = { id: WS, ...(resultPointer === undefined ? {} : { resultPointer }) };
  return api;
}

let world: SimWorld;
let stub: JobStub | undefined;
const adapters: RunningAdapter[] = [];
const acct = (label: string) => world.info.accounts.find((a) => a.label === label)!;
const agent = (label: string) => new Agent(world.info.operators, acct(label).privateKey as Hex, Buffer.from(acct(label).encryptionSecretKey, 'base64url'));

beforeAll(async () => {
  world = await startSimWorld({ env: {}, onError: () => {} });
});
afterAll(() => world.close());
afterEach(async () => {
  for (const a of adapters.splice(0)) await a.close();
  await stub?.close();
  stub = undefined;
});

async function adapter(o: Partial<JobStubOptions>, api: (base: string) => J = (b) => pinnedApi(b)) {
  stub = await startJobStub({ key: KEY, readsUntilComplete: 1, workspaces: true, ...o });
  const dir = mkdtempSync(join(tmpdir(), 't435-'));
  writeFileSync(join(dir, 'template.json'), JSON.stringify(TEMPLATE));
  const file = join(dir, 'seller.json');
  writeFileSync(file, JSON.stringify({ port: 0, pollMs: 50, journal: join(dir, 'journal.json'), template: 'template.json', scope: SCOPE_RULES, redelivery: { refetchEverySec: 0 }, sellerApi: api(stub.base) }));
  const lines: string[] = [];
  const running = await startSellerAdapter({ ...loadConfig(file), log: (l) => lines.push(l) }, { HOLDBACK_KEY: acct('seller-1').privateKey, HOLDBACK_OPERATORS: world.info.operators.join(','), JOBS_API_KEY: KEY });
  adapters.push(running);
  return { running, lines };
}
async function quoteAndFund(a: RunningAdapter, label: string): Promise<{ buyer: Agent; id: Hex }> {
  const buyer = agent(label);
  const res = await fetch(`${a.url}/quote`, { method: 'POST', body: JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope: SCOPE }) });
  const q = (await res.json()) as J;
  expect(res.status, JSON.stringify(q)).toBe(200);
  const id = q.commitmentId as Hex;
  await buyer.waitFor(id, ['AcceptedByAdjudicator']);
  const terms = await buyer.call('GET', `/v1/commitments/${id}/terms`);
  delete terms.id;
  delete terms.signatures;
  await buyer.agreeAndFund(terms, 2_100_000_000n);
  return { buyer, id };
}
async function until(what: string, ok: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) if (await ok()) return;
  throw new Error(`timed out waiting for ${what}`);
}
const stageOf = (a: RunningAdapter, id: Hex) => a.deals().find((d) => d.id === id)?.stage;
const deliveries = async (buyer: Agent, id: Hex): Promise<J[]> => (await buyer.call('GET', `/v1/commitments/${id}/events?limit=200`)).items.filter((e: J) => e.type === 'delivery.submitted');

describe('the workspace guard (T-435): deals', () => {
  it('sends every quote and start to the pinned account, and delivers a result from it', async () => {
    const { running, lines } = await adapter({});
    const { buyer, id } = await quoteAndFund(running, 'buyer-1');
    expect((await buyer.waitFor(id, ['Released', 'Refunded', 'Escalated'])).escrowState).toBe('Released');
    await until('the delivery', () => stageOf(running, id) === 'delivered');
    expect(stub!.workspacesNamed).toEqual([WS, WS]); // the quote, then the start
    expect(stub!.requests.filter((r) => r.method === 'POST').map((r) => r.path)).toEqual(['/api/v2/workspaces/ws-alpha%2B7/estimates', '/api/v2/workspaces/ws-alpha%2B7/runs']);
    expect(lines.join('\n')).toContain('every quote and start runs in the pinned workspace, and a result from another is not delivered');
  }, 45_000);

  it('never delivers a result whose job ran in another account: the deal holds and the seller is told once', async () => {
    const { running, lines } = await adapter({ reportsWorkspace: 'ws-beta' });
    const { buyer, id } = await quoteAndFund(running, 'buyer-2');
    await until('the refusal', () => stageOf(running, id) === 'refused');
    await new Promise((r) => setTimeout(r, 300)); // more passes: the same answer raises no second alert
    const alerts = lines.filter((l) => l.includes(`ALERT ${id} delivery.refused`));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain('the job did not run in the pinned workspace: the job ran in account ws-beta');
    expect(await deliveries(buyer, id)).toEqual([]);
    expect((await buyer.call('GET', `/v1/commitments/${id}`)).escrowState).toBe('Held');
  }, 45_000);
});

describe('the workspace guard (T-435): the mapping', () => {
  const base = 'http://127.0.0.1:1/api/v2/';
  const client = (api: J) => sellerApiClient(api, { JOBS_API_KEY: KEY }, FIELDS);
  it('takes a pinned account carried by the quote and start paths', () => {
    expect(client(pinnedApi(base)).describe).toContain('every quote and start runs in the pinned workspace');
  });
  it('refuses a quote or start path without {{workspace}}', () => {
    for (const k of ['quote', 'start']) {
      const api = pinnedApi(base);
      api[k].path = k === 'quote' ? 'estimates' : 'runs';
      expect(() => client(api), k).toThrow(`sellerApi.${k}.path must carry {{workspace}}`);
    }
  });
  it('refuses the account written as text in a path, so the two can never differ', () => {
    const api = pinnedApi(base);
    api.result.path = `workspaces/${encodeURIComponent(WS)}/runs/{{jobId}}`;
    expect(() => client(api)).toThrow('sellerApi.result: a path names the workspace as text; write {{workspace}}');
  });
  it('refuses {{workspace}} with no account named, and an account that is not one path segment', () => {
    const api = pinnedApi(base);
    delete api.workspace;
    expect(() => client(api)).toThrow('sellerApi uses {{workspace}}, and sellerApi.workspace names none');
    for (const id of ['', 'a/b', '..', 'x'.repeat(201), 7]) {
      const bad = pinnedApi(base);
      bad.workspace = { id };
      expect(() => client(bad), JSON.stringify(id)).toThrow('sellerApi.workspace.id must be 1 to 200 printable characters with no slash');
    }
    const extra = pinnedApi(base);
    extra.workspace.name = 'x';
    expect(() => client(extra)).toThrow('sellerApi.workspace has a field the adapter does not take: name');
  });
});
