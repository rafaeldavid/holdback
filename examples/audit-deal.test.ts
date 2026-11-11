// One audit-shaped deal, end to end (T-321): the seller adapter (T-318) and the buyer signer (T-319) run together
// for the first time, on the public demo's world served in this process on two origins. The world's clock is this
// test's to move, so the refused outcome reaches its delivery deadline, 4 days away, at once.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflightDelivery } from '@holdback/judgment';
import { loadTermsFile } from '@holdback/testkit';
import { generatePrivateKey } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeKeys } from './buyer-signer.ts';
import { DELIVERY_WINDOW_SEC, PRICE_UNITS, runAuditDeal, SCOPE, shown, startLocalWorld, startSeller, type AuditDealOptions, type LocalWorld } from './audit-deal.ts';
import { Refusal } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let world: LocalWorld;
const dirs: string[] = [];
beforeAll(async () => {
  world = await startLocalWorld();
});
afterAll(async () => {
  await world.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** One run with its output captured, its key store kept for the test to read, and a seller key the test knows. */
async function run(outcome: AuditDealOptions['outcome'], more: Partial<AuditDealOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 't321-'));
  dirs.push(dir);
  const lines: string[] = [];
  const sellerKey = generatePrivateKey();
  const result = runAuditDeal({ operators: world.operators, outcome, advanceClock: world.advanceClock, dir, pollMs: 50, timeoutMs: 30_000, sellerKey, log: (l) => lines.push(l), ...more });
  const secrets = () => {
    const store = join(dir, 'buyer-keys');
    const saved = JSON.parse(readFileSync(join(store, readdirSync(store)[0]!), 'utf8')) as { privateKey: string; encryptionSecretKey: string };
    return [sellerKey, sellerKey.slice(2), saved.privateKey, saved.privateKey.slice(2), saved.encryptionSecretKey];
  };
  return { result, lines, secrets };
}
const get = async (node: number, path: string): Promise<J> => (await fetch(`${world.operators[node]}${path}`)).json();
const eventTypes = async (id: string): Promise<string[]> => ((await get(0, `/v1/commitments/${id}/events?limit=200`)).items as J[]).map((e) => e.type);

describe('examples/audit-deal.ts', () => {
  it('formats base units with at least two decimals, in integer arithmetic', () => {
    expect(shown({ token: 'tUSD', amount: '2000000000' }, 'tUSD')).toBe('2,000.00 tUSD');
    expect(shown({ token: 'tUSD', amount: '2001200000' }, 'tUSD')).toBe('2,001.20 tUSD');
    expect(shown({ token: 'tUSD', amount: '4710001' }, 'tUSDC')).toBe('4.710001 tUSDC');
    expect(shown({ token: 'tUSD', amount: '0' }, 'tUSD')).toBe('0.00 tUSD');
  });

  it('released: a 2,000.00 tUSD deal with a 4-day window on the T-320 template ends Released, and the buyer opens the report', async () => {
    const { result, lines, secrets } = await run('released');
    const r = await result;
    expect(r.outcome).toBe('Released');
    expect(r.sellerStage).toBe('delivered');
    for (const node of [0, 1]) expect((await get(node, `/v1/commitments/${r.commitmentId}`)).escrowState).toBe('Released');

    // The terms: the price, the window, and the audit-report template filled with the buyer's scope.
    expect(r.offer.price).toEqual({ token: 'tUSD', amount: PRICE_UNITS });
    const terms = await get(1, `/v1/commitments/${r.commitmentId}/terms`);
    expect((Date.parse(terms.timing.deliverBy) - Date.parse(terms.createdAt)) / 1000).toBe(DELIVERY_WINDOW_SEC);
    const template = loadTermsFile(new URL('../fixtures/terms/audit-report.yaml', import.meta.url).pathname);
    expect(terms.acceptance).toEqual(template.acceptance);
    expect(terms.deliverable.description).toContain(`commit ${SCOPE.commit}. Scope: ${SCOPE.files.join(', ')}.`);
    expect(terms.buyer).toBe(r.buyer);
    expect(terms.seller).toBe(r.seller);

    // The amounts: price 2,000.00, adjudication fee 1.00, operator fee 0.20 (1 basis point). The hold is the first two.
    expect(r.offer.fees).toEqual({ adjudication: { token: 'tUSD', amount: '1000000' }, operator: { token: 'tUSD', amount: '200000' }, total: { token: 'tUSD', amount: '2001200000' } });
    expect(r.paid).toMatchObject({ total: { token: 'tUSD', amount: '2001200000' }, hold: { token: 'tUSD', amount: '2001000000' }, operatorFee: { token: 'tUSD', amount: '200000' } });
    expect(r.sellerReceived).toEqual({ token: 'tUSD', amount: PRICE_UNITS });
    expect(r.buyerHolds).toEqual({ token: 'tUSD', amount: '0' }); // the faucet gave the total and the deal took it

    // The report the buyer opened is the one the seller delivered, and it passes the template's checks.
    expect(r.report).toMatchObject({ checks: 'accept', findings: 3 });
    const report = JSON.parse(r.delivery.work!);
    expect(report).toMatchObject({ commit: SCOPE.commit, filesReviewed: SCOPE.files });
    const pre = preflightDelivery({ plaintext: new TextEncoder().encode(r.delivery.work!), mime: 'application/json', format: 'application/json', acceptance: template.acceptance });
    expect(pre.result).toBe('accept');
    expect(r.report!.plaintextSha256).toBe(pre.plaintextSha256);

    // The receipt: what the buyer paid, the operator's signed receipt for the funding, and the deal's events.
    expect(r.delivery.receipt).toMatchObject({ commitmentId: r.commitmentId, outcome: 'Released', paid: { token: 'tUSD', amount: '2001200000' } });
    expect(r.delivery.receipt.funded).toMatchObject({ signature: expect.stringMatching(/^0x[0-9a-f]{130}$/) });
    expect(r.delivery.receipt.events.map((e) => e.type)).toEqual(expect.arrayContaining(['hold.funded', 'delivery.submitted']));

    // The output: each step in order, the amounts paid, the receipt, and no secret key and no report text.
    const out = lines.join('\n');
    const names = r.steps.map((s) => s.step);
    expect(names).toEqual([
      'The seller starts', 'The buyer makes keys', 'The buyer asks for a quote', 'The buyer approves the quote', 'The buyer takes test funds',
      'The buyer checks the offer', 'The buyer funds the hold', 'The seller delivers', 'The deal ends Released',
    ]);
    for (const [i, name] of names.entries()) expect(out).toContain(`${String(i + 1).padStart(2)}. ${name} (`);
    expect(out).toContain('price 2,000.00 tUSD, adjudication fee 1.00 tUSD, operator fee 0.20 tUSD, total 2,001.20 tUSD');
    expect(out).toContain('5 checks: report, proof, scope, coverage, hidden');
    expect(out).toContain('Paid: 2,001.20 tUSD (hold 2,001.00 tUSD, operator fee 0.20 tUSD).');
    expect(out).toContain(`Receipt: {"commitmentId":"${r.commitmentId}","outcome":"Released"`);
    expect(out).toMatch(/seller adapter: \S+ 0x[0-9a-f]{64} preflight: accept, /);
    for (const secret of secrets()) expect(out).not.toContain(secret);
    expect(out).not.toContain(report.findings[0].title);
  }, 60_000);

  it('refused: the report misses a file in scope, the adapter does not deliver, and the hold comes back after the delivery deadline', async () => {
    const { result, lines, secrets } = await run('refused');
    const r = await result;
    expect(r.outcome).toBe('Refunded');
    expect(r.sellerStage).toBe('refused');
    for (const node of [0, 1]) expect((await get(node, `/v1/commitments/${r.commitmentId}`)).escrowState).toBe('Refunded');

    // Nothing was delivered, so nothing was judged and no report was released.
    const types = await eventTypes(r.commitmentId);
    expect(types).toContain('hold.funded');
    expect(types).not.toContain('delivery.submitted');
    expect(r.report).toBeNull();
    expect(r.delivery.work).toBeNull();

    // The hold, price plus adjudication fee, is back on the buyer's key. The operator fee is not refundable.
    expect(r.paid).toMatchObject({ total: { token: 'tUSD', amount: '2001200000' }, hold: { token: 'tUSD', amount: '2001000000' } });
    expect(r.buyerHolds).toEqual(r.paid.hold);
    expect(r.sellerReceived).toEqual({ token: 'tUSD', amount: '0' });

    const out = lines.join('\n');
    expect(r.steps.map((s) => s.step).slice(-4)).toEqual(['The seller does not deliver', 'The delivery deadline passes', 'The buyer reclaims the hold', 'The deal ends Refunded']);
    expect(out).toContain('FAIL coverage (required): schema: /filesReviewed: fewer than 3 items');
    expect(out).toMatch(/seller adapter: .* is refused: the result is not delivered: the adjudicator would reject it and refund the buyer/);
    expect(out).toContain('the buyer\'s key holds 2,001.00 tUSD of the 2,001.20 tUSD it paid');
    for (const secret of secrets()) expect(out).not.toContain(secret);
  }, 60_000);

  it('the 20-line script a seller ships (buy-with-signer.ts) buys from the adapter: its scope argument is JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 't321-'));
    dirs.push(dir);
    const selling = await startSeller({ operators: world.operators, report: 'ok', journal: join(dir, 'seller-journal.json'), pollMs: 50, log: () => {} });
    try {
      const script = fileURLToPath(new URL('./buy-with-signer.ts', import.meta.url));
      const r = await new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
        const child = spawn(process.execPath, [script, selling.quoteUrl, join(dir, 'buyer-keys'), JSON.stringify(SCOPE), '2001200000'], { env: { ...process.env, HOLDBACK_OPERATORS: world.operators.join(',') } });
        let out = '', err = '';
        child.stdout.on('data', (d: Buffer) => (out += d.toString()));
        child.stderr.on('data', (d: Buffer) => (err += d.toString()));
        child.on('exit', (code) => resolve({ code, out, err }));
      });
      expect(r.code, r.err).toBe(0);
      const done = JSON.parse(r.out) as { commitmentId: string; paid: J; outcome: string; work: string };
      expect(done.outcome).toBe('Released');
      expect(done.paid).toEqual({ token: 'tUSD', amount: '2001200000' });
      expect(JSON.parse(done.work)).toMatchObject({ commit: SCOPE.commit, filesReviewed: SCOPE.files });
      expect(selling.adapter.deals().map((d) => [d.id, d.stage])).toEqual([[done.commitmentId, 'delivered']]);
      // A scope the seller does not take: the signer's error carries the seller's reason, so the buyer can fix it.
      const other = await makeKeys(join(dir, 'buyer-keys'), { operators: world.operators });
      await expect(other.quote(selling.quoteUrl, 'three files at some commit')).rejects.toThrow("the seller's quote route answered 400: scope must be an object");
    } finally {
      await selling.close();
    }
  }, 60_000);

  it('stops before any signature when the offer is not what the buyer approved: another price', async () => {
    // The seller's API quotes 2,500.00; the buyer approved 2,000.00.
    const { result, lines } = await run('released', { quoteOverride: { price: { token: 'tUSD', amount: '2500000000' } } });
    const e = await result.then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(Refusal);
    expect((e as Error).message).toMatch(/^refusing to sign: price is \{"amount":"2500000000","token":"tUSD"\}, not the approved \{"amount":"2000000000","token":"tUSD"\}/);
    const id = /commitment (0x[0-9a-f]{64})/.exec(lines.join('\n'))![1]!;
    expect(['Offered', 'AcceptedByAdjudicator']).toContain((await get(0, `/v1/commitments/${id}`)).escrowState);
    expect(await eventTypes(id)).not.toContain('hold.funded');
  }, 60_000);
});
