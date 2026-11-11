// Terms set per quote (T-330), on SimChain: the seller adapter builds each offer's checks, windows and proof
// requirement from the scope and the buyer's options by the seller's declarative rules, and the buyer signer shows
// the buyer's agent how the offer differs from the seller's published defaults, and refuses a read-back that differs.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hex } from 'viem';
import { startSimWorld, type SimWorld } from '@holdback/operator';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { differencesOf, makeKeys } from './buyer-signer.ts';
import { config as shipped, loadConfig, startSellerAdapter, type RunningAdapter, type SellerAdapterConfig } from './seller-adapter.ts';
import { startStubSellerApi, type StubOptions, type StubSellerApi } from './seller-adapter-stub.ts';
import { Refusal } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
const SAMPLE = JSON.parse(readFileSync(here('../fixtures/data/audit-report/report.json'), 'utf8'));
const TEMPLATE = JSON.parse(readFileSync(here('./seller-adapter.template.json'), 'utf8'));
const SMALL = { commit: SAMPLE.commit as string, files: SAMPLE.filesReviewed as string[], lines: 3000 };
const LARGE = { ...SMALL, lines: 8000 };
const DAY = 86_400;

/** A larger job's extra check: the report must carry a summary. */
const SUMMARY = { id: 'summary', type: 'json_schema', required: true, schema: { type: 'object', required: ['summary'] } };
/** The buyer's option: every finding, whatever its severity, carries proof-of-concept files. */
const PROOF_ALL = { id: 'proof-all', type: 'json_schema', required: true, schema: { type: 'object', required: ['findings'], properties: { findings: { type: 'array', items: { type: 'object', required: ['pocFiles'] } } } } };
const PROOF_NOTE = 'Every finding, whatever its severity, carries the proof-of-concept files that show it.';
/** The seller's rules for this file: its own choices as a party (D31). */
const RULES: Partial<SellerAdapterConfig> = {
  options: { proofPerFinding: { type: 'boolean' } },
  termsRules: [
    { when: [{ field: 'scope.lines', atLeast: 1_000_001 }], refuse: 'this seller reviews at most 1,000,000 lines in one job' },
    { when: [{ field: 'scope.lines', atLeast: 5000 }], timing: { deliverWithinSec: 10 * DAY }, checks: [SUMMARY] },
    { when: [{ field: 'options.proofPerFinding', equals: true }], checks: [PROOF_ALL], describe: PROOF_NOTE },
  ],
};
/** The stub quotes no delivery window here, so the configured one and the rules set it. */
const NO_WINDOW: StubOptions = { pollsUntilComplete: 0, quoteOverride: { deliverWithinSec: undefined } };

let world: SimWorld;
let stub: StubSellerApi | undefined;
const adapters: RunningAdapter[] = [];
const dirs: string[] = [];
const tmp = (prefix: string) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};
const acct = (label: string) => world.info.accounts.find((a) => a.label === label)!;
const agent = (label: string) => new Agent(world.info.operators, acct(label).privateKey as Hex, Buffer.from(acct(label).encryptionSecretKey, 'base64url'));

beforeAll(async () => {
  world = await startSimWorld({ env: {}, onError: () => {} });
});
afterAll(async () => {
  await world.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
afterEach(async () => {
  for (const a of adapters.splice(0)) await a.close();
  await stub?.close();
  stub = undefined;
});

async function adapter(overrides: Partial<SellerAdapterConfig> = {}, stubOptions: StubOptions = NO_WINDOW) {
  stub ??= await startStubSellerApi({ port: 0, ...stubOptions });
  const [primary, fallback, appeal] = world.info.adjudicators.map((a) => a.address);
  const lines: string[] = [];
  const running = await startSellerAdapter(
    { ...shipped, ...RULES, port: 0, sellerApi: stub.api, clubId: world.info.clubId, adjudicators: { primary: primary!, fallback: fallback!, appeal: appeal! }, journal: join(tmp('t330-'), 'journal.json'), pollMs: 50, log: (line) => lines.push(line), ...overrides },
    { HOLDBACK_KEY: acct('seller-1').privateKey, HOLDBACK_OPERATORS: world.info.operators.join(',') },
  );
  adapters.push(running);
  return { running, lines };
}
async function quoteFor(a: RunningAdapter, buyer: Agent, scope: unknown, options?: unknown): Promise<{ status: number; body: J }> {
  const res = await fetch(`${a.url}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ buyer: buyer.address, buyerEncryptionPublicKey: buyer.encryptionPublicKey, scope, ...(options === undefined ? {} : { options }) }) });
  return { status: res.status, body: await res.json() };
}
async function termsOf(buyer: Agent, id: Hex): Promise<J> {
  const terms = await buyer.call('GET', `/v1/commitments/${id}/terms`);
  delete terms.id;
  delete terms.signatures;
  return terms;
}
async function fund(buyer: Agent, id: Hex): Promise<void> {
  await buyer.waitFor(id, ['AcceptedByAdjudicator']);
  await buyer.agreeAndFund(await termsOf(buyer, id), 6_000_000_000n);
}
const windowOf = (t: J) => (Date.parse(t.timing.deliverBy) - Date.parse(t.createdAt)) / 1000;
const checkIds = (t: J) => t.acceptance.deterministicChecks.map((c: J) => c.id);
async function until(what: string, ok: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, 25))) if (await ok()) return;
  throw new Error(`timed out waiting for ${what}`);
}

describe('seller adapter: terms set per quote', () => {
  it('two scopes yield different checks and delivery windows, and each deal ends Released', async () => {
    const { running } = await adapter();
    const [b1, b2] = [agent('buyer-1'), agent('buyer-2')];
    const small = await quoteFor(running, b1, SMALL);
    const large = await quoteFor(running, b2, LARGE);
    expect(small.status, JSON.stringify(small.body)).toBe(200);
    expect(large.status, JSON.stringify(large.body)).toBe(200);
    const [ts, tl] = [await termsOf(b1, small.body.commitmentId), await termsOf(b2, large.body.commitmentId)];
    expect(windowOf(ts)).toBe(shipped.timing.deliverWithinSec); // the configured 7 days
    expect(windowOf(tl)).toBe(10 * DAY); // the rule for 5,000 lines or more
    expect(checkIds(ts)).toEqual(TEMPLATE.checks.map((c: J) => c.id));
    expect(checkIds(tl)).toEqual([...TEMPLATE.checks.map((c: J) => c.id), 'summary']);
    expect(tl.acceptance.deterministicChecks.at(-1)).toEqual(SUMMARY);
    await fund(b1, small.body.commitmentId);
    await fund(b2, large.body.commitmentId);
    expect((await b1.waitFor(small.body.commitmentId, ['Released', 'Refunded', 'Escalated'])).escrowState).toBe('Released');
    expect((await b2.waitFor(large.body.commitmentId, ['Released', 'Refunded', 'Escalated'])).escrowState).toBe('Released');
  }, 45_000);

  it('an option adds a proof requirement, and a report without the proof is not delivered', async () => {
    const { running, lines } = await adapter();
    const buyer = agent('buyer-1');
    const q = await quoteFor(running, buyer, SMALL, { proofPerFinding: true });
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    const id = q.body.commitmentId as Hex;
    const terms = await termsOf(buyer, id);
    expect(checkIds(terms)).toEqual([...TEMPLATE.checks.map((c: J) => c.id), 'proof-all']);
    expect(terms.deliverable.description.endsWith(` ${PROOF_NOTE}`)).toBe(true);
    expect(stub!.quotes.at(-1)).toEqual({ scope: SMALL, options: { proofPerFinding: true } }); // the seller's API prices the option
    // The stub's report has a Low finding with no proof-of-concept files: the seller's own preflight refuses it.
    await fund(buyer, id);
    await until('the adapter to refuse the result', () => running.deals().find((d) => d.id === id)?.stage === 'refused');
    expect(lines.join('\n')).toContain('FAIL proof-all (required)');
    expect(stub!.starts.at(-1)).toMatchObject({ commitmentId: id, options: { proofPerFinding: true } });
  }, 45_000);

  it('refuses an option or a scope outside the seller\'s rules with 400, names the field, and makes no offer', async () => {
    const { running } = await adapter();
    const buyer = agent('buyer-1');
    const refused: Array<[unknown, unknown, string]> = [
      [SMALL, { proofPerFinding: 'yes' }, 'options.proofPerFinding must be true or false'],
      [SMALL, { rush: true }, 'options has a field this seller does not take: rush'],
      [SMALL, ['proofPerFinding'], 'options must be an object'],
      [{ ...SMALL, lines: 2_000_000 }, undefined, 'scope.lines: this seller reviews at most 1,000,000 lines in one job'],
    ];
    for (const [scope, options, detail] of refused) {
      const r = await quoteFor(running, buyer, scope, options);
      expect(r.status, detail).toBe(400);
      expect(r.body).toEqual({ type: 'invalid_request', detail });
    }
    expect(stub!.calls.quote).toBe(0);
    expect(running.deals()).toEqual([]);
  });

  it('refuses to start on a rule that is malformed, naming it', async () => {
    const bad: Array<[J, RegExp]> = [
      [{ termsRules: [{ when: [{ field: 'scope.size', atLeast: 1 }] }] }, /termsRules\[0\]\.when\[0\]: scope\.size is not a field of the scope rules/],
      [{ termsRules: [{ when: [{ field: 'scope.lines.length', atLeast: 1 }] }] }, /termsRules\[0\]\.when\[0\]: scope\.lines is not a list/],
      [{ termsRules: [{ when: [], timeing: {} }] }, /termsRules\[0\] has a field rules do not take: timeing/],
      [{ termsRules: [{ when: [], timing: { deliverWithinSec: -1 } }] }, /termsRules\[0\]\.timing\.deliverWithinSec must be a whole number of seconds, 0 or more/],
      [{ termsRules: [{ when: [], checks: [{ type: 'json_schema' }] }] }, /termsRules\[0\]\.checks\[0\] needs a string id and type/],
      [{ termsRules: [{ when: [{ field: 'options.x', equals: true }] }] }, /termsRules\[0\]\.when\[0\]: options\.x is not a field of the option rules/],
    ];
    for (const [overrides, message] of bad) await expect(adapter(overrides)).rejects.toThrow(message);
  });

  it('publishes its defaults, keeps an escaped placeholder literal, and offers the template\'s adjudication fee', async () => {
    const reader = agent('buyer-1');
    const min = (await reader.registration(world.info.adjudicators[0]!.address)).fee.min;
    const fee = { token: 'tUSD', amount: (BigInt(min.amount) * 2n).toString() };
    const own = { ...TEMPLATE, fee, deliverable: { ...TEMPLATE.deliverable, description: `${TEMPLATE.deliverable.description} Write \\{{commit}} as is.` } };
    const file = join(tmp('t330-template-'), 'template.json');
    writeFileSync(file, JSON.stringify(own));
    const { running } = await adapter({ template: file });
    const published = await (await fetch(`${running.url}/defaults`)).json();
    expect(published).toEqual({ version: 1, deliverable: own.deliverable, checks: own.checks, optionalRubric: own.optionalRubric, timing: shipped.timing, fee, scope: shipped.scope, options: RULES.options });
    const q = await quoteFor(running, reader, SMALL);
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    expect(q.body.fees.adjudication).toEqual(fee);
    const terms = await termsOf(reader, q.body.commitmentId);
    expect(terms.adjudication.fee).toEqual(fee);
    expect(terms.deliverable.description.endsWith(' Write {{commit}} as is.')).toBe(true);
  });

  it('a buyer\'s option adds the template\'s optional rubric to one offer, and an offer without it carries none (T-331)', async () => {
    // The shipped configuration: the option `panel` and its rule, with the template's five audit criteria.
    expect(shipped.options).toMatchObject({ panel: { type: 'boolean' } });
    expect(shipped.termsRules).toContainEqual({ when: [{ field: 'options.panel', equals: true }], rubric: true });
    expect(TEMPLATE.optionalRubric.criteria.map((c: J) => c.id)).toEqual(['root_cause', 'impact', 'severity', 'fix', 'distinct']);
    expect(TEMPLATE.rubric).toBeUndefined(); // no offer carries a rubric unless a rule adds it
    const { running } = await adapter({ options: shipped.options!, termsRules: shipped.termsRules! }, {});
    const [b1, b2] = [agent('buyer-1'), agent('buyer-2')];
    const withPanel = await quoteFor(running, b1, SMALL, { panel: true });
    const without = await quoteFor(running, b2, SMALL, { panel: false });
    expect(withPanel.status, JSON.stringify(withPanel.body)).toBe(200);
    expect(without.status, JSON.stringify(without.body)).toBe(200);
    const [tp, tn] = [await termsOf(b1, withPanel.body.commitmentId), await termsOf(b2, without.body.commitmentId)];
    expect(tp.acceptance.rubric).toEqual(TEMPLATE.optionalRubric);
    expect(tn.acceptance.rubric?.criteria ?? []).toEqual([]);
    expect(checkIds(tp)).toEqual(checkIds(tn)); // the rule adds the panel and changes nothing else
    // The primary adjudicator takes the panel offer.
    expect((await b1.waitFor(withPanel.body.commitmentId, ['AcceptedByAdjudicator'])).escrowState).toBe('AcceptedByAdjudicator');
    // The buyer reads what the option adds before it asks: the defaults publish the optional rubric.
    expect(((await (await fetch(`${running.url}/defaults`)).json()) as J).optionalRubric).toEqual(TEMPLATE.optionalRubric);
  }, 45_000);

  it('refuses a malformed rubric rule, and a rubric rule over a template that holds no optional rubric', async () => {
    await expect(adapter({ termsRules: [{ when: [], rubric: 'yes' as unknown as boolean }] })).rejects.toThrow(/termsRules\[0\]\.rubric must be true or false/);
    const dir = tmp('t331-template-');
    const bare = { ...TEMPLATE };
    delete bare.optionalRubric;
    writeFileSync(join(dir, 'template.json'), JSON.stringify(bare));
    const rule = { when: [{ field: 'options.panel', equals: true }], rubric: true };
    // A configuration file with that rule does not load, and names the rule.
    const file = join(dir, 'seller.json');
    writeFileSync(file, JSON.stringify({ sellerApi: { quote: 'http://127.0.0.1:1/q', start: 'http://127.0.0.1:1/s', result: 'http://127.0.0.1:1/{jobId}' }, template: 'template.json', scope: shipped.scope, options: { panel: { type: 'boolean' } }, termsRules: [rule] }));
    expect(() => loadConfig(file)).toThrow(/termsRules\[0\]\.rubric: the template has no optionalRubric for the rule to add/);
    // Set in code, the adapter starts, and a buyer who asks for the panel gets 400 and no offer: never an offer without it.
    const { running } = await adapter({ template: join(dir, 'template.json'), options: { panel: { type: 'boolean' } }, termsRules: [rule] });
    const buyer = agent('buyer-1');
    const asked = await quoteFor(running, buyer, SMALL, { panel: true });
    expect(asked.status).toBe(400);
    expect(asked.body).toEqual({ type: 'invalid_request', detail: 'options.panel: this seller\'s template has no optional rubric to add' });
    expect(running.deals()).toEqual([]);
    expect((await quoteFor(running, buyer, SMALL)).status).toBe(200);
  });
});

/** Two proxies, at two origins, in front of the world's two operators. With `fee` set they publish that fee schedule. */
async function proxies(): Promise<{ urls: string[]; fee: J; close(): Promise<void> }> {
  const state = { fee: null as J };
  const servers: Server[] = world.info.operators.map((target) =>
    createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const up = await fetch(`${target}${req.url}`, { method: req.method!, headers: { 'content-type': String(req.headers['content-type'] ?? 'application/json'), ...(req.headers['idempotency-key'] ? { 'idempotency-key': String(req.headers['idempotency-key']) } : {}) }, ...(body && req.method !== 'GET' ? { body } : {}) });
      let text = await up.text();
      if (state.fee && new URL(req.url!, 'http://p').pathname === '/.well-known/holdback.json') {
        const j = JSON.parse(text);
        j.fees = { ...j.fees, operator: state.fee };
        text = JSON.stringify(j);
      }
      res.writeHead(up.status, { 'content-type': up.headers.get('content-type') ?? 'application/json' }).end(text);
    }),
  );
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.listen(0, '127.0.0.1', r))));
  const urls = servers.map((s) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`);
  return {
    urls,
    get fee() {
      return state.fee;
    },
    set fee(v: J) {
      state.fee = v;
    },
    close: async () => {
      for (const s of servers) s.closeAllConnections();
      await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
    },
  };
}

describe('buyer signer: differencesOf', () => {
  const a = { id: 'a', type: 'contains', required: true, value: '0xDEADBEEF' };
  const b = { id: 'b', type: 'contains', required: true, value: 'x' };
  const windows = { offerExpiresInSec: 1, fundWithinSec: 1, deliverWithinSec: 1, judgeWithinSec: 1, fallbackWithinSec: 1, appealWindowSec: 1, appealDecideSec: 1 };
  const offer = (checks: J[]) => ({ deliverable: { kind: 'document' }, checks, rubric: { criteria: [], passThreshold: 0 }, windows, fees: {} }) as J;
  const defaults = { deliverable: { kind: 'document' }, checks: [a, b], timing: {} };

  it('lists a second check under an id already used, a new order with another change, and a change of case', () => {
    const b2 = { ...b, value: 'y' };
    expect(differencesOf(defaults, offer([a, { ...a, required: false }, b2]))).toEqual([
      { field: 'checks.a', old: a, new: [a, { ...a, required: false }] },
      { field: 'checks.b', old: b, new: b2 },
    ]);
    expect(differencesOf(defaults, offer([b2, a]))).toEqual([
      { field: 'checks.b', old: b, new: b2 },
      { field: 'checks', old: ['a', 'b'], new: ['b', 'a'] },
    ]);
    expect(differencesOf(defaults, offer([{ ...a, value: '0xdeadbeef' }, b]))).toEqual([{ field: 'checks.a', old: a, new: { ...a, value: '0xdeadbeef' } }]);
    expect(differencesOf(defaults, offer([a, b]))).toEqual([]);
  });
});

describe('buyer signer: what differs from the seller\'s defaults', () => {
  it('lists each changed check, window and requirement, old value and new, and none for a default offer', async () => {
    const { running } = await adapter();
    const defaults = `${running.url}/defaults`;
    const fillDefault = (s: string) => s.replace('{{commit}}', LARGE.commit).replace('{{files}}', LARGE.files.join(', '));

    const plain = await makeKeys(tmp('t330-keys-'), { operators: world.info.operators });
    const q0 = await plain.quote(`${running.url}/quote`, SMALL);
    expect((await plain.readOffer(q0.commitmentId, { defaults })).differences).toEqual([]);

    const signer = await makeKeys(tmp('t330-keys-'), { operators: world.info.operators });
    const q = await signer.quote(`${running.url}/quote`, LARGE, { proofPerFinding: true });
    const offer = await signer.readOffer(q.commitmentId, { defaults });
    expect(offer.windows.deliverWithinSec).toBe(10 * DAY);
    expect(offer.differences).toEqual([
      { field: 'deliverable.description', old: fillDefault(TEMPLATE.deliverable.description), new: `${fillDefault(TEMPLATE.deliverable.description)} ${PROOF_NOTE}` },
      { field: 'checks.summary', old: null, new: SUMMARY },
      { field: 'checks.proof-all', old: null, new: PROOF_ALL },
      { field: 'deadlines.deliverWithinSec', old: shipped.timing.deliverWithinSec, new: 10 * DAY },
    ]);
    // The approved offer, differences included, passes; checkOffer reads it again from every operator.
    expect(await signer.checkOffer(q.commitmentId, offer)).toEqual(offer);
  }, 45_000);

  it('refuses to sign when the offer it reads back differs from the one it showed, or was never shown', async () => {
    const { running } = await adapter();
    const front = await proxies();
    try {
      const signer = await makeKeys(tmp('t330-keys-'), { operators: front.urls });
      const q = await signer.quote(`${running.url}/quote`, SMALL);
      const offer = await signer.readOffer(q.commitmentId, { defaults: `${running.url}/defaults` });
      expect(offer.fees.operator).toEqual({ token: 'tUSD', amount: '0' });
      // A client that hides a difference from the buyer's agent: refused.
      const hidden = await signer.checkOffer(q.commitmentId, { ...offer, differences: [{ field: 'checks.extra', old: null, new: { id: 'extra' } }] }).then(() => null, (e: unknown) => e);
      expect(hidden).toBeInstanceOf(Refusal);
      expect((hidden as Error).message).toMatch(/^refusing to sign: differences is .*, not the approved /);
      // Both operators now publish a 1% fee: the offer read back costs more than the one shown.
      front.fee = { to: `0x${'11'.repeat(20)}`, token: 'tUSD', bps: 100, min: '0', max: null, refundable: false, appliesAt: 'agree-and-fund' };
      const e = await signer.checkOffer(q.commitmentId, offer).then(() => null, (x: unknown) => x);
      expect(e).toBeInstanceOf(Refusal);
      expect((e as Error).message).toMatch(/^refusing to sign: fees\.operator is \{"amount":"20000000","token":"tUSD"\}, not the shown \{"amount":"0","token":"tUSD"\}/);
      await expect(signer.agreeAndFund(q.commitmentId)).rejects.toThrow(/checkOffer/);

      // A key that never showed this offer to the buyer's agent signs nothing for it.
      const other = await makeKeys(tmp('t330-keys-'), { operators: front.urls });
      await expect(other.checkOffer(q.commitmentId, offer)).rejects.toThrow(/^refusing to sign: readOffer has not shown 0x[0-9a-f]{64} with this key/);
    } finally {
      await front.close();
    }
  }, 45_000);
});
