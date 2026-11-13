// The buyer signer a seller ships inside its client (T-319), against the public demo's own world served in this
// process on two origins (as try.test.ts). The seller here is a few lines in this file: an Agent that answers
// POST /quote with an offer and delivers once the hold is funded. It stands in for T-318's seller adapter.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStorage, PublicWorld } from '@holdback/demo-cloud';
import nacl from 'tweetnacl';
import { generatePrivateKey } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent } from './agent.ts';
import { differencesOf, loadKeys, makeKeys, printable } from './buyer-signer.ts';
import { serveTwoOrigins, type TwoOrigins } from './two-origins.ts';
import { jcsHash, operatorFeeOf, Refusal } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));

const PRICE = { token: 'tUSD', amount: '25000000' };
const DELIVERABLE = { kind: 'dataset', description: 'customers.csv, one row per customer', format: 'text/csv' };
const CHECKS = [
  { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'email'] },
  { id: 'rows', type: 'row_count_range', required: true, min: 3, max: 3 },
  { id: 'uniq', type: 'unique_key', required: true, columns: ['customer_id'] },
];
const TIMING = { judgeWithinSec: 60, fallbackWithinSec: 60, appealWindowSec: 0, appealDecideSec: 60 }; // phase one: no party appeal, so the window is 0 (ADR-0033 §2b)
const CSV = 'customer_id,email\n1,ada@example.com\n2,alan@example.com\n3,grace@example.com\n';
/** Price 25 tUSD, adjudication fee 1 tUSD, operator fee 0.01 tUSD (1 bp, at least 10,000 base units). */
const TOTAL = '26010000';

let demo: TwoOrigins;
let seller: { quoteUrl: string; address: string; swapKey: boolean; credential: string | null; close(): Promise<void> };
const stores: string[] = [];
const store = () => {
  const dir = mkdtempSync(join(tmpdir(), 'buyer-signer-'));
  stores.push(dir);
  return dir;
};

/** A seller that answers POST /quote with an offer to the buyer it names, and delivers CSV once the hold is funded. */
async function serveSeller(operators: string[]): Promise<typeof seller> {
  const agent = new Agent(operators, generatePrivateKey(), nacl.randomBytes(32));
  await agent.call('POST', '/v1/faucet', { address: agent.address });
  const found = await agent.trusted('/.well-known/holdback.json', (x) => ({ clubId: x.demo.clubId, adjudicators: x.demo.adjudicators, schedule: x.fees?.operator ?? null }));
  const role = (r: string): string => found.adjudicators.find((a: J) => a.role === r).address;
  const adjudicators = { primary: role('primary'), fallback: role('fallback'), appeal: role('appeal') };
  let open = true;
  // With a credential the quote route answers 401 to a request without `Authorization: Bearer <credential>` (T-324).
  const state = { swapKey: false, credential: null as string | null };
  const deliverWhenHeld = async (id: `0x${string}`, terms: J) => {
    while (open) {
      const s = await agent.call('GET', `/v1/commitments/${id}`);
      if (s.escrowState === 'Held') return void (await agent.deliver(terms, new TextEncoder().encode(CSV)));
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    if (req.method !== 'POST' || req.url !== '/quote') return void res.writeHead(404).end('{}');
    if (state.credential && req.headers.authorization !== `Bearer ${state.credential}`) return void res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' }).end('{"type":"unauthorized","detail":"a bearer credential is required"}');
    const asked = JSON.parse(Buffer.concat(chunks).toString()) as { buyer: string; buyerEncryptionPublicKey: string };
    // With swapKey the seller offers to an encryption key of its own in place of the buyer's.
    const encryptionPublicKey = state.swapKey ? agent.encryptionPublicKey : asked.buyerEncryptionPublicKey;
    const offer = await agent.offer({ template: 'checks-only', clubId: found.clubId, seller: agent.address, buyer: { address: asked.buyer, encryptionPublicKey }, adjudicators, price: PRICE, deliverable: DELIVERABLE, checks: CHECKS, timing: TIMING });
    void deliverWhenHeld(offer.id, offer.terms).catch(() => undefined);
    const adjudication = (await agent.registration(adjudicators.primary)).fee.min;
    const operator = found.schedule ? operatorFeeOf(PRICE, found.schedule) : 0n;
    const fees = { adjudication, operator: { token: PRICE.token, amount: operator.toString() }, total: { token: PRICE.token, amount: (BigInt(PRICE.amount) + BigInt(adjudication.amount) + operator).toString() } };
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ commitmentId: offer.id, price: PRICE, fees, expiresAt: offer.terms.timing.offerExpiresAt }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    quoteUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/quote`,
    address: agent.address,
    get swapKey() {
      return state.swapKey;
    },
    set swapKey(v: boolean) {
      state.swapKey = v;
    },
    get credential() {
      return state.credential;
    },
    set credential(v: string | null) {
      state.credential = v;
    },
    close: async () => {
      open = false;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    },
  };
}

beforeAll(async () => {
  const world = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000' }, faucetPerClient: 100 });
  demo = await serveTwoOrigins(world, { tickMs: 100 });
  seller = await serveSeller(demo.urls);
});
afterAll(async () => {
  await seller.close();
  await demo.close();
  for (const dir of stores) rmSync(dir, { recursive: true, force: true });
});

const balance = async (address: string) => ((await (await fetch(`${demo.urls[1]}/v1/balances/${address}`)).json()) as { amount: string }).amount;

describe('buyer-signer.ts', () => {
  it('a script of at most 50 lines imports the file, stops for approval, funds the approved deal and stops, and a later run resumes it from the key store', async () => {
    const script = here('./buy-with-signer.ts');
    expect(readFileSync(script, 'utf8').trimEnd().split('\n').length).toBeLessThanOrEqual(50);
    const dir = store();
    const node = (args: string[]) => new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
      const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, HOLDBACK_OPERATORS: demo.urls.join(',') } });
      let out = '', err = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      child.stderr.on('data', (d: Buffer) => (err += d.toString()));
      child.on('exit', (code) => resolve({ code, out, err }));
    });
    // T-368: the first run stops for approval, before it signs or pays anything, with exit status 3. It shows the
    // seven signed fields of T-332 and maxSubmissions with the rest of the offer.
    const stop = await node([seller.quoteUrl, dir, JSON.stringify('3 rows of customer_id,email'), TOTAL, '--stop-after-funding']);
    expect(stop.code, stop.err).toBe(3);
    const approval = JSON.parse(stop.out) as J;
    expect(approval).toMatchObject({ approval: 'needed', settlement: { mode: 'guaranteed_on_decision' }, disclosure: { level: 'public' }, clubId: expect.any(String), rulebookHash: expect.any(String), policyId: expect.any(String), policyHash: expect.any(String), registryHash: expect.any(String), maxSubmissions: 1, fees: { total: { token: 'tUSD', amount: TOTAL } } });
    expect(approval.approve).toMatch(new RegExp(` approve ${dir} ${approval.commitmentId} ${TOTAL} --stop-after-funding$`));
    // T-332: the approval stops once the hold is funded; the process ends with the deal open.
    const funding = await node(['approve', dir, approval.commitmentId, TOTAL, '--stop-after-funding']);
    expect(funding.code, funding.err).toBe(0);
    expect(funding.out).toBe('');
    const funded = JSON.parse(funding.err.trimEnd().split('\n').at(-1)!) as { funded: string; paid: J };
    expect(funded.paid).toEqual({ token: 'tUSD', amount: TOTAL });
    // A second process with only the key store follows the deal to its outcome and opens the work.
    const r = await node(['resume', dir]);
    expect(r.code, r.err).toBe(0);
    const done = JSON.parse(r.out) as { commitmentId: string; buyer: string; paid: { token: string; amount: string }; outcome: string; work: string };
    expect(done.commitmentId).toBe(funded.funded);
    expect(done.outcome).toBe('Released');
    expect(done.work).toBe(CSV);
    expect(done.paid).toEqual({ token: 'tUSD', amount: TOTAL });
    // A third run finds no open deal and prints nothing; with the ID it opens that deal's work again.
    expect(await node(['resume', dir])).toMatchObject({ code: 0, out: '' });
    const again = await node(['resume', dir, funded.funded]);
    expect(again.code, again.err).toBe(0);
    expect(JSON.parse(again.out)).toMatchObject({ commitmentId: funded.funded, outcome: 'Released', work: CSV });
    r.err = funding.err + r.err;
    for (const url of demo.urls) expect(((await (await fetch(`${url}/v1/commitments/${done.commitmentId}`)).json()) as { escrowState: string }).escrowState).toBe('Released');
    // The faucet gave the deal's total and the deal took all of it; the seller has the price.
    expect(await balance(done.buyer)).toBe('0');
    // Neither the script's output nor its errors carry a secret key.
    const saved = JSON.parse(readFileSync(join(dir, readdirSync(dir)[0]!), 'utf8')) as { privateKey: string; encryptionSecretKey: string };
    for (const secret of [saved.privateKey, saved.privateKey.slice(2), saved.encryptionSecretKey]) expect(r.out + r.err).not.toContain(secret);
  }, 60_000);

  it('makeKeys saves fresh keys with file mode 0600 and shows no secret key', async () => {
    const dir = store();
    const a = await makeKeys(dir, { operators: demo.urls });
    const b = await makeKeys(dir, { operators: demo.urls });
    expect(a.address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(a.encryptionPublicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b.address).not.toBe(a.address);
    const files = readdirSync(dir).sort();
    expect(files).toEqual([`${a.address}.json`, `${b.address}.json`].sort());
    for (const f of files) expect(statSync(join(dir, f)).mode & 0o777).toBe(0o600);
    const saved = JSON.parse(readFileSync(join(dir, `${a.address}.json`), 'utf8')) as { privateKey: string; encryptionSecretKey: string };
    expect(saved.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    for (const secret of [saved.privateKey, saved.encryptionSecretKey]) expect(JSON.stringify(a) + Object.values(a).join(' ')).not.toContain(secret);
  });

  it('checkOffer refuses an offer whose price, check list or adjudicator differs from the approved one, naming the field', async () => {
    const signer = await makeKeys(store(), { operators: demo.urls });
    const quote = await signer.quote(seller.quoteUrl, '3 rows of customer_id,email');
    const offer = await signer.readOffer(quote.commitmentId);
    expect(offer).toMatchObject({ commitmentId: quote.commitmentId, seller: seller.address, price: PRICE, deliverable: DELIVERABLE, checks: CHECKS, fees: { adjudication: { token: 'tUSD', amount: '1000000' }, operator: { token: 'tUSD', amount: '10000' }, total: { token: 'tUSD', amount: TOTAL } } });
    const refused = async (approved: J, field: RegExp) => {
      const e = await signer.checkOffer(quote.commitmentId, approved).then(() => null, (x: unknown) => x);
      expect(e).toBeInstanceOf(Refusal);
      expect((e as Error).message).toMatch(field);
    };
    await refused({ ...offer, price: { ...offer.price, amount: '24000000' } }, /^refusing to sign: price is /);
    await refused({ ...offer, checks: offer.checks.slice(0, 2) }, /^refusing to sign: checks is /);
    await refused({ ...offer, checks: [...offer.checks, { id: 'extra', type: 'row_count_range', required: true, min: 1, max: 9 }] }, /^refusing to sign: checks is /);
    await refused({ ...offer, adjudicators: { ...offer.adjudicators, primary: offer.adjudicators.fallback } }, /^refusing to sign: adjudicators is /);
    await refused({ ...offer, fees: { ...offer.fees, operator: { token: 'tUSD', amount: '0' } } }, /^refusing to sign: fees\.operator is /);
    await refused({ ...offer, deliverable: { ...offer.deliverable, format: 'application/json' } }, /^refusing to sign: deliverable is /);
    await refused({ ...offer, deadlines: { ...offer.deadlines, appealWindowSec: 3600 } }, /^refusing to sign: deadlines is /);
    await refused({ ...offer, seller: offer.adjudicators.primary }, /^refusing to sign: seller is /);
    // Nothing passed the check, so nothing is signed: the signer holds no approved terms for this deal.
    await expect(signer.agreeAndFund(quote.commitmentId)).rejects.toThrow(/checkOffer/);
    // The refusals above return before checkOffer waits for the adjudicator, and the adjudicator accepts on the
    // world's next pass (tickMs). So the deal is Offered or AcceptedByAdjudicator here, whichever the pass made it:
    // asserting AcceptedByAdjudicator at this point raced that pass and failed about one run in three.
    const stateNow = async () => ((await (await fetch(`${demo.urls[0]}/v1/commitments/${quote.commitmentId}`)).json()) as { escrowState: string }).escrowState;
    expect(['Offered', 'AcceptedByAdjudicator']).toContain(await stateNow());
    // The approved offer itself passes. checkOffer waits for the adjudicator, so the state is now settled, and
    // the buyer has still signed nothing: the deal is not Agreed.
    expect(await signer.checkOffer(quote.commitmentId, offer)).toEqual(offer);
    expect(await stateNow()).toBe('AcceptedByAdjudicator');
  }, 60_000);

  // T-332: seven fields the buyer signs that the offer did not show before. An approval that changes one is refused,
  // naming it: one test per field, on one offer.
  describe('the seven signed fields the offer shows (T-332)', () => {
    let signer: Awaited<ReturnType<typeof makeKeys>>;
    let offer: J;
    let discovered: { clubId: string; modes: string[] };
    beforeAll(async () => {
      signer = await makeKeys(store(), { operators: demo.urls });
      const quote = await signer.quote(seller.quoteUrl, '3 rows of customer_id,email');
      offer = await signer.readOffer(quote.commitmentId);
      const d = (await (await fetch(`${demo.urls[0]}/.well-known/holdback.json`)).json()) as J;
      discovered = { clubId: d.demo.clubId, modes: d.settlementModes };
    }, 60_000);

    it('readOffer shows them, as the terms every operator serves carry them', async () => {
      const terms = (await (await fetch(`${demo.urls[1]}/v1/commitments/${offer.commitmentId}/terms`)).json()) as J;
      expect(offer).toMatchObject({
        settlement: { mode: terms.settlement.mode }, disclosure: { level: 'public' }, clubId: discovered.clubId, rulebookHash: terms.rulebookHash,
        policyId: terms.adjudication.policyId, policyHash: terms.adjudication.policyHash, registryHash: terms.adjudication.registryHash,
      });
      expect(discovered.modes).toContain(offer.settlement.mode);
      for (const h of [offer.rulebookHash, offer.policyHash, offer.registryHash]) expect(h).toMatch(/^0x[0-9a-f]{64}$/);
    });

    const other = `0x${'7'.repeat(64)}`;
    it.each([
      ['settlement.mode', (o: J) => ({ ...o, settlement: { ...o.settlement, mode: 'optimistic' } })],
      ['disclosure.level', (o: J) => ({ ...o, disclosure: { ...o.disclosure, level: 'private' } })],
      ['clubId', (o: J) => ({ ...o, clubId: 'another-club' })],
      ['rulebookHash', (o: J) => ({ ...o, rulebookHash: other })],
      ['policyId', (o: J) => ({ ...o, policyId: 'another-policy' })],
      ['policyHash', (o: J) => ({ ...o, policyHash: other })],
      ['registryHash', (o: J) => ({ ...o, registryHash: other })],
      ['maxSubmissions', (o: J) => ({ ...o, maxSubmissions: 3 })],
    ])('checkOffer refuses an approval that changes %s, naming it', async (field, change) => {
      const e = await signer.checkOffer(offer.commitmentId, change(offer)).then(() => null, (x: unknown) => x);
      expect(e).toBeInstanceOf(Refusal);
      expect((e as Error).message).toMatch(new RegExp(`^refusing to sign: ${field.replace('.', '\\.')} is .*, not the approved `));
    });

    it('the difference list shows the adjudicators and maxSubmissions the defaults name, addresses ignoring case', () => {
      const base = { deliverable: offer.deliverable, checks: offer.checks, timing: {} };
      expect(differencesOf({ ...base, adjudicators: { primary: offer.adjudicators.primary.toUpperCase().replace('0X', '0x'), appeal: offer.adjudicators.appeal }, maxSubmissions: offer.maxSubmissions }, offer)).toEqual([]);
      expect(differencesOf({ ...base, adjudicators: { primary: offer.adjudicators.fallback }, maxSubmissions: 2 }, offer)).toEqual([
        { field: 'deadlines.maxSubmissions', old: 2, new: offer.maxSubmissions },
        { field: 'adjudicators.primary', old: offer.adjudicators.fallback.toLowerCase(), new: offer.adjudicators.primary.toLowerCase() },
      ]);
    });

    it('the approved offer itself passes', async () => {
      expect(await signer.checkOffer(offer.commitmentId, offer)).toEqual(offer);
    }, 60_000);
  });

  it('printable escapes control, bidirectional and invisible characters, and the JSON parses to the same value', () => {
    // Built from code points, so this source holds none of the characters it tests: U+202E, U+202C, U+200B, U+0007, a tag character.
    const hidden = (...n: number[]) => String.fromCodePoint(...n);
    const value = { note: `pay ${hidden(0x202e)}evil${hidden(0x202c)} now${hidden(0x200b, 0x7, 0xe0041)}`, fine: `caf${hidden(0xe9)}, 25 tUSD` };
    const text = printable(JSON.stringify(value));
    expect(text).toBe(`{"note":"pay \\u202eevil\\u202c now\\u200b\\u0007\\udb40\\udc41","fine":"caf${hidden(0xe9)}, 25 tUSD"}`);
    expect(JSON.parse(text)).toEqual(value);
    // Default-ignorable code points too: the combining grapheme joiner, a halfwidth Hangul filler, a variation selector supplement.
    const more = { s: hidden(0x34f, 0xffa0, 0xe0100) };
    expect(printable(JSON.stringify(more))).toBe('{"s":"\\u034f\\uffa0\\udb40\\udd00"}');
    expect(JSON.parse(printable(JSON.stringify(more)))).toEqual(more);
  });

  it('a buyer expectation that is not a setting stops makeKeys, naming it', async () => {
    await expect(makeKeys(store(), { operators: demo.urls, expect: { clubID: 'acme' } as J })).rejects.toThrow(/^expect\."clubID" is not a setting: the settings are settlementMode, clubId, /);
    await expect(makeKeys(store(), { operators: demo.urls, expect: { clubId: 7 } as J })).rejects.toThrow(/^expect\.clubId is not a string/);
    await expect(makeKeys(store(), { operators: demo.urls, expect: 'acme' as J })).rejects.toThrow(/^expect is not an object/);
  });

  // T-332: each of the seven is checked against what the buyer's configuration expects, before the offer is shown.
  it.each([
    ['settlement.mode', { settlementMode: 'optimistic' }, /^refusing to sign: settlement\.mode is "guaranteed_on_decision", not the expected "optimistic" \(expect\.settlementMode\)/],
    ['clubId', { clubId: 'another-club' }, /^refusing to sign: clubId is "[^"]+", not the expected "another-club" \(expect\.clubId\)/],
    ['rulebookHash', { rulebookHash: `0x${'7'.repeat(64)}` }, /^refusing to sign: rulebookHash is "0x[0-9a-f]{64}", not the expected "0x7{64}" \(expect\.rulebookHash\)/],
    ['policyId', { policyId: 'another-policy' }, /^refusing to sign: policyId is "[^"]+", not the expected "another-policy" \(expect\.policyId\)/],
    ['policyHash', { policyHash: `0x${'7'.repeat(64)}` }, /^refusing to sign: policyHash is "0x[0-9a-f]{64}", not the expected "0x7{64}" \(expect\.policyHash\)/],
    ['registryHash', { registryHash: `0x${'7'.repeat(64)}` }, /^refusing to sign: registryHash is "0x[0-9a-f]{64}", not the expected "0x7{64}" \(expect\.registryHash\)/],
  ])('readOffer and checkOffer refuse an offer whose %s differs from the buyer\'s expectation', async (_field, expected, message) => {
    const dir = store();
    const plain = await makeKeys(dir, { operators: demo.urls });
    const quote = await plain.quote(seller.quoteUrl, '3 rows of customer_id,email');
    const offer = await plain.readOffer(quote.commitmentId);
    // The same key, reopened with the expectation: it shows nothing, and it signs nothing.
    const expecting = await loadKeys(dir, plain.address, { operators: demo.urls, expect: expected });
    const shown = await expecting.readOffer(quote.commitmentId).then(() => null, (x: unknown) => x);
    expect(shown).toBeInstanceOf(Refusal);
    expect((shown as Error).message).toMatch(message);
    await expect(expecting.checkOffer(quote.commitmentId, offer)).rejects.toThrow(message);
    await expect(expecting.agreeAndFund(quote.commitmentId)).rejects.toThrow(/checkOffer/);
  }, 60_000);

  // T-332: what every operator publishes, changed after the buyer's agent approved. Both nodes serve the change, so
  // the reads agree; the signer compares the terms with them and refuses, naming the field.
  describe('what every operator publishes, against the terms (T-332)', () => {
    let tampered: TwoOrigins;
    let other: Awaited<ReturnType<typeof serveSeller>>;
    let tamper: ((path: string, body: J) => J | undefined) | null = null;
    let onlyNode: number | null = null; // null: both nodes serve the change
    beforeAll(async () => {
      const world = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000' } });
      tampered = await serveTwoOrigins(world, {
        tickMs: 100,
        rewrite: (node, path, body) => {
          if (onlyNode !== null && node !== onlyNode) return undefined;
          const out = tamper?.(path, JSON.parse(body));
          return out === undefined ? undefined : JSON.stringify(out);
        },
      });
      other = await serveSeller(tampered.urls);
    }, 60_000);
    afterAll(async () => {
      await other.close();
      await tampered.close();
    });

    const rehash = (policy: J) => jcsHash(policy);
    it.each([
      ['settlement.mode', (path: string, b: J) => (path === '/.well-known/holdback.json' ? { ...b, settlementModes: ['optimistic'] } : undefined), /^refusing to sign: settlement\.mode is "guaranteed_on_decision", not a mode every operator lists \(\["optimistic"\]\)/],
      ['clubId', (path: string, b: J) => (path === '/.well-known/holdback.json' ? { ...b, demo: { ...b.demo, clubId: 'another-club' } } : undefined), /^refusing to sign: clubId is "[^"]+", not the demo club every operator names \("another-club"\)/],
      ['clubId, with none named', (path: string, b: J) => (path === '/.well-known/holdback.json' ? Object.fromEntries(Object.entries(b).filter(([k]) => k !== 'demo')) : undefined), /^refusing to sign: clubId is "[^"]+", and the operators name no demo club: set expect\.clubId/],
      ['rulebookHash', (path: string, b: J) => {
        if (!path.startsWith('/v1/clubs/')) return undefined;
        const rulebook = { ...b.rulebook, note: 'changed' };
        return { ...b, rulebook, rulebookHash: jcsHash(rulebook) };
      }, /^refusing to sign: rulebookHash is "0x[0-9a-f]{64}", not the hash every operator serves for club "[^"]+" \("0x[0-9a-f]{64}"\)/],
      ['policyId', (path: string, b: J) => {
        if (!path.startsWith('/v1/adjudicators/')) return undefined;
        const policy = { ...b.policy, id: 'another-policy' };
        return { ...b, policy, policyHash: rehash(policy) };
      }, /^refusing to sign: policyId is "[^"]+", not the primary adjudicator's as every operator serves it \("another-policy"\)/],
      ['policyHash', (path: string, b: J) => {
        if (!path.startsWith('/v1/adjudicators/')) return undefined;
        const policy = { ...b.policy, note: 'changed' };
        return { ...b, policy, policyHash: rehash(policy) };
      }, /^refusing to sign: policyHash is "0x[0-9a-f]{64}", not the primary adjudicator's as every operator serves it \("0x[0-9a-f]{64}"\)/],
      ['registryHash', (path: string, b: J) => (path.startsWith('/v1/adjudicators/') ? { ...b, registry: { ...b.registry, hash: `0x${'7'.repeat(64)}` } } : undefined), /^refusing to sign: registryHash is "0x[0-9a-f]{64}", not the primary adjudicator's as every operator serves it \("0x7{64}"\)/],
      // The terms themselves at another level: refused by name before the ID is recomputed.
      ['disclosure.level', (path: string, b: J) => (path.endsWith('/terms') ? { ...b, disclosure: { level: 'judgment' } } : undefined), /^refusing to sign: disclosure\.level is "judgment", not "public", the one level whose terms this file can read and show/],
    ])('checkOffer refuses when every operator serves another %s after the approval', async (_field, change, message) => {
      const signer = await makeKeys(store(), { operators: tampered.urls });
      const quote = await signer.quote(other.quoteUrl, '3 rows of customer_id,email');
      const offer = await signer.readOffer(quote.commitmentId);
      tamper = change;
      try {
        const e = await signer.checkOffer(quote.commitmentId, offer).then(() => null, (x: unknown) => x);
        expect(e).toBeInstanceOf(Refusal);
        expect((e as Error).message).toMatch(message);
        await expect(signer.agreeAndFund(quote.commitmentId)).rejects.toThrow(/checkOffer/);
      } finally {
        tamper = null;
      }
    }, 60_000);

    it('checkOffer stops when only one operator serves another rulebook: the reads must agree', async () => {
      const signer = await makeKeys(store(), { operators: tampered.urls });
      const quote = await signer.quote(other.quoteUrl, '3 rows of customer_id,email');
      const offer = await signer.readOffer(quote.commitmentId);
      onlyNode = 0;
      tamper = (path, b) => {
        if (!path.startsWith('/v1/clubs/')) return undefined;
        const rulebook = { ...b.rulebook, note: 'changed' };
        return { ...b, rulebook, rulebookHash: jcsHash(rulebook) };
      };
      try {
        await expect(signer.checkOffer(quote.commitmentId, offer)).rejects.toThrow(/^operators disagree on \/v1\/clubs\/[^;]+; do not proceed/);
        await expect(signer.agreeAndFund(quote.commitmentId)).rejects.toThrow(/checkOffer/);
      } finally {
        tamper = null;
        onlyNode = null;
      }
    }, 60_000);
  });

  it('checkOffer refuses an offer made to another encryption key than the one in the key store', async () => {
    const signer = await makeKeys(store(), { operators: demo.urls });
    seller.swapKey = true;
    try {
      const quote = await signer.quote(seller.quoteUrl, '3 rows of customer_id,email');
      const offer = await signer.readOffer(quote.commitmentId);
      await expect(signer.checkOffer(quote.commitmentId, offer)).rejects.toThrow(/^refusing to sign: buyerEncryptionPublicKey is /);
    } finally {
      seller.swapKey = false;
    }
  }, 60_000);

  it('quote sends the bearer credential its configuration names, read from the environment, and keeps it nowhere', async () => {
    const credential = randomBytes(24).toString('base64url');
    const variable = 'T325_QUOTE_CREDENTIAL';
    seller.credential = credential;
    try {
      const dir = store();
      // Without a credential this seller refuses the quote.
      await expect((await makeKeys(dir, { operators: demo.urls })).quote(seller.quoteUrl, 'x')).rejects.toThrow(/answered 401: a bearer credential is required/);
      // A configuration that names an unset variable stops before any request, naming the variable only.
      delete process.env[variable];
      await expect((await makeKeys(dir, { operators: demo.urls, quoteCredentialEnv: variable })).quote(seller.quoteUrl, 'x')).rejects.toThrow(`${variable}, which is not set`);
      process.env[variable] = credential;
      const signer = await makeKeys(dir, { operators: demo.urls, quoteCredentialEnv: variable });
      const quote = await signer.quote(seller.quoteUrl, '3 rows of customer_id,email');
      expect(quote.commitmentId).toMatch(/^0x[0-9a-f]{64}$/);
      // The credential is in no file of the key store and not on the signer.
      for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f), 'utf8')).not.toContain(credential);
      expect(JSON.stringify(signer) + Object.values(signer).join(' ')).not.toContain(credential);
    } finally {
      seller.credential = null;
      delete process.env[variable];
    }
  }, 60_000);

  it('agreeAndFund refuses a prepared message an operator altered, and signs nothing', async () => {
    // Node 0 raises the funding's value in what it prepares; node 1 is honest.
    const world = await PublicWorld.open({ storage: new MemoryStorage(), env: { OPERATOR_FEE_BPS: '1', OPERATOR_FEE_MIN: '10000' } });
    const lying = await serveTwoOrigins(world, {
      tickMs: 100,
      rewrite: (node, path, body) => {
        if (node !== 0 || path !== '/v1/prepare/agree-and-fund') return undefined;
        const prepared = JSON.parse(body);
        prepared.submit.body.fund.value = '9000000000';
        return JSON.stringify(prepared);
      },
    });
    const other = await serveSeller(lying.urls);
    try {
      const signer = await makeKeys(store(), { operators: lying.urls });
      const quote = await signer.quote(other.quoteUrl, '3 rows of customer_id,email');
      const offer = await signer.readOffer(quote.commitmentId);
      await signer.testFunds(offer.fees.total.amount);
      await signer.checkOffer(quote.commitmentId, offer);
      const e = await signer.agreeAndFund(quote.commitmentId).then(() => null, (x: unknown) => x);
      expect(e).toBeInstanceOf(Refusal);
      expect((e as Error).message).toMatch(/^refusing to sign: /);
      expect(((await (await fetch(`${lying.urls[1]}/v1/commitments/${quote.commitmentId}`)).json()) as { escrowState: string }).escrowState).toBe('AcceptedByAdjudicator');
      expect(((await (await fetch(`${lying.urls[1]}/v1/balances/${signer.address}`)).json()) as { amount: string }).amount).toBe(TOTAL);
    } finally {
      await other.close();
      await lying.close();
    }
  }, 60_000);

  it('the key store survives a restart between funding and opening the delivery', async () => {
    const dir = store();
    const first = await makeKeys(dir, { operators: demo.urls });
    const quote = await first.quote(seller.quoteUrl, '3 rows of customer_id,email');
    const offer = await first.readOffer(quote.commitmentId);
    expect(await first.testFunds(offer.fees.total.amount)).toEqual({ token: 'tUSD', amount: TOTAL });
    await first.checkOffer(quote.commitmentId, offer);
    const paid = await first.agreeAndFund(quote.commitmentId);
    expect(paid).toMatchObject({ total: { token: 'tUSD', amount: TOTAL }, hold: { token: 'tUSD', amount: '26000000' }, operatorFee: { token: 'tUSD', amount: '10000' } });

    // A new process has only the directory and the commitment ID.
    const second = await loadKeys(dir, quote.commitmentId, { operators: demo.urls });
    expect(second.address).toBe(first.address);
    const done = await second.openDelivery(quote.commitmentId);
    expect(done.outcome).toBe('Released');
    expect(done.work).toBe(CSV);
    expect(done.plaintextSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(done.receipt).toMatchObject({ commitmentId: quote.commitmentId, outcome: 'Released', paid: { token: 'tUSD', amount: TOTAL } });
    expect(done.receipt.funded).toMatchObject({ signature: expect.stringMatching(/^0x[0-9a-f]{130}$/) });
    expect(done.receipt.events.map((e: J) => e.type)).toEqual(expect.arrayContaining(['hold.funded', 'delivery.submitted']));
    expect(done.transactions).toEqual([]); // SimChain has no transactions; on Sepolia each money step links one
    // A run that funded the hold and stopped before it saved: the next run finds the funding recorded and pays nothing more.
    const file = join(dir, `${first.address}.json`);
    const beforeSave = JSON.parse(readFileSync(file, 'utf8')) as { paid?: unknown };
    delete beforeSave.paid;
    writeFileSync(file, JSON.stringify(beforeSave), { mode: 0o600 });
    const third = await loadKeys(dir, first.address, { operators: demo.urls });
    expect(await third.agreeAndFund(quote.commitmentId)).toEqual({ ...paid, receipt: null });
    expect(await balance(first.address)).toBe('0');
    // A second agreement on the same key is refused before any signature: one key, one deal.
    await expect(second.quote(seller.quoteUrl, 'again')).rejects.toThrow(/one deal/);
    await expect(loadKeys(dir, `0x${'0'.repeat(64)}`, { operators: demo.urls })).rejects.toThrow(/no key/);
  }, 60_000);
});
