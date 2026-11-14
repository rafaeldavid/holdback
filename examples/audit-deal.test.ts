// One audit-shaped deal, end to end (T-321): the seller adapter (T-318) and the buyer signer (T-319) run together
// for the first time, on the public demo's world served in this process on two origins. The world's clock is this
// test's to move, so the refused outcome reaches its delivery deadline, 4 days away, at once.
//
// T-326 adds a seller's own report and terms, named by file: the two-files fixtures below are not the built-in ones.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflightDelivery } from '@holdback/judgment';
import { loadTermsFile } from '@holdback/testkit';
import { generatePrivateKey } from 'viem/accounts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeKeys } from './buyer-signer.ts';
import { CASES, DELIVERY_WINDOW_SEC, parseArgs, PRICE_UNITS, rehearse, runAuditDeal, SCOPE, shown, startLocalWorld, startSeller, type AuditDealOptions, type CaseName, type LocalWorld, type RehearsalOptions } from './audit-deal.ts';
import { Refusal } from './verify.ts';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const fixture = (path: string) => fileURLToPath(new URL(`../fixtures/${path}`, import.meta.url));
const TWO_FILES_TERMS = fixture('terms/audit-report-two-files.yaml');
const TWO_FILES_REPORT = fixture('data/audit-report/report.two-files.json');
const TWO_FILES_MISSING = fixture('data/audit-report/report.two-files.missing-file.json');
// T-355: terms in the shape of the pilot kit's terms.json (JSON, concrete values, checks on a job export), and an export that passes them.
const EXPORT_TERMS = fixture('terms/audit-export.json');
const EXPORT_REPORT = fixture('data/audit-report/export.json');
const OWN_SHAPE_MAPPING = fixture('data/audit-report/seller-shape-a.mapping.json');
const SCRIPT = fileURLToPath(new URL('./audit-deal.ts', import.meta.url));

/** Runs `node examples/audit-deal.ts <args>` to its exit, with its own local world. */
function cli(args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args]);
    let out = '', err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('exit', (code) => resolve({ code, out, err }));
  });
}

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
async function run(outcome: NonNullable<AuditDealOptions['outcome']>, more: Partial<AuditDealOptions> = {}) {
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
    const report = JSON.parse(r.delivery!.work!);
    expect(report).toMatchObject({ commit: SCOPE.commit, filesReviewed: SCOPE.files });
    const pre = preflightDelivery({ plaintext: new TextEncoder().encode(r.delivery!.work!), mime: 'application/json', format: 'application/json', acceptance: template.acceptance });
    expect(pre.result).toBe('accept');
    expect(r.report!.plaintextSha256).toBe(pre.plaintextSha256);

    // The receipt: what the buyer paid, the operator's signed receipt for the funding, and the deal's events.
    expect(r.delivery!.receipt).toMatchObject({ commitmentId: r.commitmentId, outcome: 'Released', paid: { token: 'tUSD', amount: '2001200000' } });
    expect(r.delivery!.receipt.funded).toMatchObject({ signature: expect.stringMatching(/^0x[0-9a-f]{130}$/) });
    expect(r.delivery!.receipt.events.map((e) => e.type)).toEqual(expect.arrayContaining(['hold.funded', 'delivery.submitted']));

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
    expect(r.delivery!.work).toBeNull();

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
      const node = (args: string[]) => new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
        const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, HOLDBACK_OPERATORS: world.operators.join(',') } });
        let out = '', err = '';
        child.stdout.on('data', (d: Buffer) => (out += d.toString()));
        child.stderr.on('data', (d: Buffer) => (err += d.toString()));
        child.on('exit', (code) => resolve({ code, out, err }));
      });
      // T-368: the script stops for approval first; the buyer approves the commitment ID it showed.
      const stop = await node([selling.quoteUrl, join(dir, 'buyer-keys'), JSON.stringify(SCOPE), '2001200000']);
      expect(stop.code, stop.err).toBe(3);
      const r = await node(['approve', join(dir, 'buyer-keys'), JSON.parse(stop.out).commitmentId, '2001200000']);
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

describe('examples/audit-deal.ts with a seller\'s own report and terms (T-326)', () => {
  // The world's faucet grants 10 times per client per hour of world time, and each deal takes 2 grants. This world's
  // clock is the test's, so each test starts a fresh window.
  beforeEach(() => world.advanceClock(3601));
  it('released: a two-file report under its own terms, 1,234.56 tUSD and a 2-day window, ends Released and the buyer opens the exact bytes', async () => {
    const { result, lines, secrets } = await run('released', { reportFile: TWO_FILES_REPORT, termsFile: TWO_FILES_TERMS });
    const r = await result;
    expect(r.outcome).toBe('Released');
    expect(r.sellerStage).toBe('delivered');
    expect(r.failedChecks).toEqual([]);
    for (const node of [0, 1]) expect((await get(node, `/v1/commitments/${r.commitmentId}`)).escrowState).toBe('Released');

    // The offer carries the terms file's deliverable, checks, price and windows.
    const file = loadTermsFile(TWO_FILES_TERMS);
    const terms = await get(1, `/v1/commitments/${r.commitmentId}/terms`);
    expect(terms.deliverable).toEqual(file.deliverable);
    expect(terms.acceptance).toEqual(file.acceptance);
    expect(terms.price).toEqual({ token: 'tUSD', amount: '1234560000' });
    const after = (at: string) => (Date.parse(at) - Date.parse(terms.createdAt)) / 1000;
    expect(after(terms.timing.deliverBy)).toBe(172_800);
    expect(after(terms.timing.offerExpiresAt)).toBe(file.timing.offerExpiresInSec);
    expect(after(terms.timing.fundBy)).toBe(file.timing.fundWithinSec);
    expect(terms.timing).toMatchObject({ appealWindowSec: file.timing.appealWindowSec, appealDecideSec: file.timing.appealDecideSec, maxSubmissions: 1 });

    // The seller received the price; the buyer opened the report file's own bytes, unchanged.
    expect(r.sellerReceived).toEqual({ token: 'tUSD', amount: '1234560000' });
    const bytes = readFileSync(TWO_FILES_REPORT);
    expect(r.delivery!.work).toBe(bytes.toString('utf8'));
    expect(r.report).toEqual({ bytes: bytes.length, plaintextSha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, checks: 'accept', findings: 2 });

    const out = lines.join('\n');
    expect(out).toContain(`The seller's report: ${TWO_FILES_REPORT}, ${bytes.length} bytes.`);
    expect(out).toContain(`The terms: ${TWO_FILES_TERMS}.`);
    expect(out).toContain('price 1,234.56 tUSD');
    expect(out).toContain('(2 days)');
    expect(out).toContain('5 checks: report, proof, scope, coverage, hidden');
    for (const secret of secrets()) expect(out).not.toContain(secret);
    expect(out).not.toContain(JSON.parse(bytes.toString('utf8')).findings[0].title);
  }, 60_000);

  it('refused: the seller\'s check run refuses the report, nothing is delivered, the commitment stays Held, and the run names the failed check', async () => {
    const { result, lines } = await run('released', { reportFile: TWO_FILES_MISSING, termsFile: TWO_FILES_TERMS });
    const r = await result;
    expect(r.outcome).toBe('Held');
    expect(r.sellerStage).toBe('refused');
    for (const node of [0, 1]) expect((await get(node, `/v1/commitments/${r.commitmentId}`)).escrowState).toBe('Held');
    const types = await eventTypes(r.commitmentId);
    expect(types).toContain('hold.funded');
    expect(types).not.toContain('delivery.submitted');
    expect(r.delivery).toBeNull();
    expect(r.report).toBeNull();
    expect(r.sellerReceived).toEqual({ token: 'tUSD', amount: '0' });
    expect(r.failedChecks).toEqual(['coverage (required): schema: /filesReviewed: fewer than 2 items']);

    const out = lines.join('\n');
    expect(r.steps.map((s) => s.step).slice(-2)).toEqual(['The seller does not deliver', 'The deal stays Held']);
    expect(out).toContain('FAIL coverage (required): schema: /filesReviewed: fewer than 2 items');
    expect(out).toContain('the seller\'s check run refuses the report: coverage (required): schema: /filesReviewed: fewer than 2 items.');
  }, 60_000);

  it('a report file alone runs under the built-in terms: the built-in sample, named as a file, ends Released', async () => {
    const { result } = await run('released', { reportFile: fixture('data/audit-report/report.json') });
    const r = await result;
    expect(r.outcome).toBe('Released');
    // The built-in terms carry the salt (T-431): the report file's own bytes, with one salt field put first.
    const work = r.delivery!.work!;
    expect(work).toMatch(/^\{\s*"salt": "0x[0-9a-f]{64}",/);
    expect(work.replace(/^\{\s*"salt": "0x[0-9a-f]{64}",/, '{')).toBe(readFileSync(fixture('data/audit-report/report.json'), 'utf8'));
    expect(r.sellerReceived).toEqual({ token: 'tUSD', amount: PRICE_UNITS });
  }, 60_000);

  it('refuses a terms file before any deal opens, and names the field', async () => {
    const dir = mkdtempSync(join(tmpdir(), 't326-'));
    dirs.push(dir);
    const source = readFileSync(TWO_FILES_TERMS, 'utf8');
    const variant = (name: string, from: string, to: string, all = false) => {
      expect(source).toContain(from);
      const path = join(dir, name);
      writeFileSync(path, all ? source.replaceAll(from, to) : source.replace(from, to));
      return path;
    };
    const cases: Array<[string, RegExp]> = [
      // A price that is not base units fails the commitment schema.
      [variant('decimal-price.yaml', 'amount: "1234560000"', 'amount: "1234.56"'), /price\/amount/],
      [variant('no-format.yaml', '  format: application/json\n', ''), /deliverable.*format/],
      [variant('unknown-key.yaml', 'clubId: data-services-v1', 'clubId: data-services-v1\ncolour: blue'), /terms\.colour is not a known key/],
      [variant('two-submissions.yaml', 'maxSubmissions: 1', 'maxSubmissions: 2'), /timing\.maxSubmissions 2/],
      [variant('other-mode.yaml', 'mode: guaranteed_on_decision', 'mode: optimistic'), /\/timing must have required property 'disputeBy'/],
      [variant('other-level.yaml', 'level: public', 'level: judgment'), /must have required property 'privateTerms'/],
      // Valid terms that the offer route cannot make are refused with the reason, not run as other terms.
      [variant('other-settlement-token.yaml', 'settlement: { mode: guaranteed_on_decision, token: tUSD }', 'settlement: { mode: guaranteed_on_decision, token: tUSDX }'), /settlement\.token is tUSDX/],
      // The settlement layer here holds tUSD only: terms that price and settle in another token are refused.
      [variant('other-token.yaml', 'token: tUSD', 'token: tUSDX', true), /price\.token is tUSDX; this settlement layer holds tUSD/],
    ];
    for (const [termsFile, message] of cases) {
      const { result, lines } = await run('released', { termsFile });
      await expect(result).rejects.toThrow(message);
      expect(lines.join('\n')).not.toContain('The seller starts');
    }
    await expect((await run('released', { reportFile: join(dir, 'no-such-report.json') })).result).rejects.toThrow(/cannot read .*no-such-report\.json/);
  }, 60_000);

  it('the report route serves the file only for a job the stub started, and sends no request: hostile paths answer 404', async () => {
    const dir = mkdtempSync(join(tmpdir(), 't326-'));
    dirs.push(dir);
    const bytes = new Uint8Array(readFileSync(TWO_FILES_REPORT));
    const selling = await startSeller({ operators: world.operators, report: 'ok', journal: join(dir, 'seller-journal.json'), pollMs: 50, log: () => {}, reportBytes: bytes });
    try {
      const at = (job: string) => selling.resultUrl.replace('{jobId}', job);
      const hostile = [
        'job-1', // no job started yet
        '..%2F..%2Fquote', '%2E%2E', '..', 'http%3A%2F%2Fother.example%2F', '%2F%2Fother.example', 'job-1%2F..%2F..%2Fquote', '',
      ];
      for (const job of hostile) expect((await fetch(at(job))).status, job).toBe(404);
      expect((await fetch(selling.resultUrl.replace('/jobs/{jobId}/result', '/quote'), { method: 'POST', body: '{}' })).status).toBe(404);
      expect(selling.stub.calls).toEqual({ quote: 0, start: 0, result: 0 });

      // A job the stub started: the route serves the file's bytes, unchanged, and still sends the stub no request.
      const started = await fetch(selling.stub.api.start, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' }, body: JSON.stringify({ commitmentId: '0x01', scope: SCOPE }) });
      expect(await started.json()).toEqual({ jobId: 'job-1' });
      const served = await fetch(at('job-1'));
      expect(served.status).toBe(200);
      expect(new Uint8Array(await served.arrayBuffer())).toEqual(bytes);
      expect((await fetch(at('job-2'))).status).toBe(404);
      expect(selling.stub.calls.result).toBe(0);
    } finally {
      await selling.close();
    }
  }, 60_000);

  it('a terms file alone runs with the stub\'s built-in report: a report for another commit is refused, Held, and the run names the checks', async () => {
    const { result } = await run('released', { termsFile: TWO_FILES_TERMS });
    const r = await result;
    expect(r.outcome).toBe('Held');
    expect(r.failedChecks.map((c) => c.split(' ')[0])).toEqual(['scope', 'coverage']);
  }, 60_000);

  it('reads its command line: no arguments as before, --report and --terms on the local world only', () => {
    expect(parseArgs([])).toEqual({ live: false });
    expect(parseArgs(['--live'])).toEqual({ live: true });
    expect(parseArgs(['--report', 'r.json', '--terms', 't.yaml'])).toEqual({ live: false, reportFile: 'r.json', termsFile: 't.yaml' });
    expect(parseArgs(['--terms', 't.yaml'])).toEqual({ live: false, termsFile: 't.yaml' });
    expect(() => parseArgs(['--report'])).toThrow('--report needs a file');
    expect(() => parseArgs(['--report', '--terms', 't.yaml'])).toThrow('--report needs a file');
    expect(() => parseArgs(['--live', '--report', 'r.json'])).toThrow('--report and --terms run on the local world only');
    expect(() => parseArgs(['--colour'])).toThrow('unknown option --colour');
    expect(() => parseArgs(['r.json'])).toThrow('unknown option r.json');
  });

  it('the terms file\'s adjudication fee reaches the offer (T-330 triage row 1)', async () => {
    const { result } = await run('released', { reportFile: TWO_FILES_REPORT, termsFile: TWO_FILES_TERMS });
    const r = await result;
    expect(r.outcome).toBe('Released');
    // 50.00 tUSD, as the file says, not the adjudicator's published minimum of 1.00 tUSD.
    expect(r.offer.fees.adjudication).toEqual({ token: 'tUSD', amount: '50000000' });
    expect(r.paid.hold).toEqual({ token: 'tUSD', amount: '1284560000' });
  }, 60_000);

  it('the command: exit 0 on a released report, 1 on a refused one with the failed check, 2 when it cannot run', async () => {
    const [released, refused, bad] = await Promise.all([
      cli(['--report', TWO_FILES_REPORT, '--terms', TWO_FILES_TERMS]),
      cli(['--report', TWO_FILES_MISSING, '--terms', TWO_FILES_TERMS]),
      cli(['--terms']),
    ]);
    expect(released.code, released.err).toBe(0);
    expect(released.out).toMatch(/Result: Released\. Commitment 0x[0-9a-f]{64}/);
    expect(refused.code, refused.err).toBe(1);
    expect(refused.out).toContain('FAIL coverage (required): schema: /filesReviewed: fewer than 2 items');
    expect(refused.out).toMatch(/Result: Held\. Commitment 0x[0-9a-f]{64}/);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('audit-deal: --terms needs a file');
    expect(bad.err).toContain('usage: pnpm audit-deal');
  }, 90_000);
});

describe('examples/audit-deal.ts rehearses the pilot\'s cases (T-355)', () => {
  // Each case takes about 4 faucet grants (the seller's mandate, the buyer's funds); the world allows 10 a client per hour.
  beforeEach(() => world.advanceClock(3601));

  /** One case in a fresh directory, its output captured. The world's panel passes unless the case sets it. */
  async function rehearsal(name: CaseName, more: Partial<RehearsalOptions> = {}) {
    const dir = mkdtempSync(join(tmpdir(), 't355-'));
    dirs.push(dir);
    const lines: string[] = [];
    const r = await rehearse({ case: name, operators: world.operators, world, dir, pollMs: 50, timeoutMs: 30_000, log: (l) => lines.push(l), ...more });
    const record = JSON.parse(readFileSync(r.record, 'utf8')) as J;
    return { r, out: lines.join('\n'), record, dir };
  }
  const state = async (id: string) => Promise.all([0, 1].map(async (node) => (await get(node, `/v1/commitments/${id}`)).escrowState));
  const check = (record: J, name: string) => (record.checks as J[]).find((c) => c.check === name)?.ok;

  it('names eight cases', () => {
    expect(CASES).toEqual(['released', 'redelivered', 'rubric', 'refunded', 'missed-deadline', 'shown-mismatch', 'resume', 'two-addresses']);
  });

  it('two-addresses: a payment key standing in for a wallet signs the signer\'s typed-data files; the payment address funds the deal, the signing key\'s balance does not move, and the record names who was paid', async () => {
    const { r, out, record } = await rehearsal('two-addresses');
    expect(r.end).toBe('Released');
    expect(r.expected).toBe(true);
    expect(r.paymentAddress).not.toBe(r.buyer);
    expect(r.signingKeyMoved).toBe('0');
    expect(r.sellerReceived).toEqual({ token: 'tUSD', amount: PRICE_UNITS });
    expect(out).toMatch(/The signer writes the payment messages .*\.funding\.typed\.json: The funding \(digest 0x[0-9a-f]{64}\): 0x[0-9a-f]{40} pays /);
    expect(out).toMatch(/The payment address checks each file .*funding: digest 0x[0-9a-f]{64}; operator-fee: digest 0x[0-9a-f]{64}/);
    expect(out).toMatch(/The payment address signs them in its wallet .*2 signatures by 0x[0-9a-f]{40}, each over the file it checked\./);
    expect(record.row).toMatchObject({ buyer: r.buyer, buyerPaymentAddress: r.paymentAddress, paidTo: r.seller, refundedTo: null });
  }, 60_000);

  it('item 81: one payment key for several cases, a fresh signing key for each; a refund returns to the payment address', async () => {
    const paymentKey = generatePrivateKey();
    const first = await rehearsal('released', { paymentKey });
    world.advanceClock(3601);
    const second = await rehearsal('missed-deadline', { paymentKey });
    expect(second.r.paymentAddress).toBe(first.r.paymentAddress);
    expect(second.r.buyer).not.toBe(first.r.buyer);
    expect([first.r.end, second.r.end]).toEqual(['Released', 'Refunded']);
    expect([first.r.signingKeyMoved, second.r.signingKeyMoved]).toEqual(['0', '0']);
    expect(second.record.row).toMatchObject({ refundedTo: second.r.paymentAddress, reclaimed: true });
    await expect(rehearse({ case: 'released', operators: world.operators, world, dir: mkdtempSync(join(tmpdir(), 't379-')), paymentKey, keys: { store: first.dir, buyer: first.r.buyer } })).rejects.toThrow(/--keys and a payment key do not go together/);
  }, 90_000);

  it('released: the report passes, the deal ends Released, the seller is paid, and the record shows it', async () => {
    const { r, out, record } = await rehearsal('released');
    expect(r.end).toBe('Released');
    expect(r.expected).toBe(true);
    expect(await state(r.commitmentId)).toEqual(['Released', 'Released']);
    expect(r.sellerReceived).toEqual({ token: 'tUSD', amount: PRICE_UNITS });

    // Before it approved, the buyer was shown every signed field and what differs from the seller's defaults.
    expect(r.shown.signed).toMatchObject({ 'settlement.mode': 'guaranteed_on_decision', 'disclosure.level': 'public', clubId: expect.any(String), maxSubmissions: 1 });
    for (const f of ['rulebookHash', 'policyHash', 'registryHash']) expect(r.shown.signed[f]).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r.shown.signed.policyId).toEqual(expect.any(String));
    // The stub quotes 4 days; the adapter's published default is 7.
    expect(r.shown.differences).toEqual([{ field: 'deadlines.deliverWithinSec', old: 604_800, new: DELIVERY_WINDOW_SEC }]);
    expect(out).toContain('Shown before approval: settlement.mode guaranteed_on_decision, disclosure.level public, clubId ');
    expect(out).toContain('Differences from the seller\'s defaults: deadlines.deliverWithinSec 604800 -> 345600.');

    // The record: the outcome, the price to the seller, every operator answering.
    expect(r.record).toBe(join(r.dir, 'deal-record.json'));
    expect(record.row).toMatchObject({ commitmentId: r.commitmentId, outcome: 'Released', price: { token: 'tUSD', amount: PRICE_UNITS }, reclaimed: false });
    expect(check(record, 'postings follow the outcome')).toBe(true);
    expect(check(record, 'all operators answered')).toBe(true);
    expect(out).toContain(`Case released: Released, as expected. Deal record: ${r.record}`);
    // The seller's adapter started from one configuration file the run wrote.
    expect(JSON.parse(readFileSync(join(r.dir, 'seller-adapter.config.json'), 'utf8'))).toMatchObject({ sellerApi: expect.any(Object), alerts: { secretEnv: 'HOLDBACK_ALERT_SECRET' } });
  }, 60_000);

  it('redelivered: the seller\'s check run refuses the first report, alerts the seller, and delivers the fixed one before the deadline', async () => {
    const { r, out, record } = await rehearsal('redelivered');
    expect(r.end).toBe('Released');
    expect(await state(r.commitmentId)).toEqual(['Released', 'Released']);
    // The alert callback got two signed alerts: the refusal with the failed check, then the fixed delivery.
    expect(r.alerts.map((a) => [a.type, a.signed])).toEqual([['delivery.refused', true], ['delivery.fixed', true]]);
    expect(r.alerts[0]!.checks.map((c: J) => c.checkId)).toEqual(['coverage']);
    expect(out).toMatch(/seller adapter: \S+ ALERT 0x[0-9a-f]{64} delivery\.refused \(attempt 1\)/);
    expect(out).toContain('The seller says the fixed report is ready');
    expect(Date.parse(record.row.deliveredAt)).toBeLessThan(Date.parse(record.terms.signed.timing.deliverBy));
    expect(record.row.outcome).toBe('Released');
    expect(r.sellerReceived).toEqual({ token: 'tUSD', amount: PRICE_UNITS });
  }, 60_000);

  it('rubric: the buyer asks for the panel; the report passes the checks and the panel, and the deal ends Released', async () => {
    const { r, record } = await rehearsal('rubric');
    expect(r.end).toBe('Released');
    expect(r.offer.rubric.criteria.length).toBe(5);
    expect(r.shown.differences.map((d) => d.field)).toContain('rubric');
    expect(record.row).toMatchObject({ outcome: 'Released', panelDecision: 'accept' });
  }, 60_000);

  it('refunded: the report passes the checks the seller can run, the panel rejects it after delivery, and the hold comes back', async () => {
    const { r, out, record } = await rehearsal('refunded');
    expect(r.end).toBe('Refunded');
    expect(r.expected).toBe(true);
    expect(await state(r.commitmentId)).toEqual(['Refunded', 'Refunded']);
    expect(r.reclaimed).toBe(false);
    // A judged refund returns the price; the adjudication fee paid for the judgment.
    expect(r.buyerHolds).toEqual({ token: 'tUSD', amount: PRICE_UNITS });
    expect(r.sellerReceived).toEqual({ token: 'tUSD', amount: '0' });
    expect(record.row).toMatchObject({ outcome: 'Refunded', panelDecision: 'reject', reclaimed: false });
    expect(record.row.deliveredAt).toEqual(expect.any(String));
    expect(out).toContain('the local world\'s panel is a stand-in set to reject: no model runs');
  }, 60_000);

  it('missed-deadline: the seller never delivers, and the buyer\'s signer reclaims the hold after the deadline', async () => {
    const { r, record } = await rehearsal('missed-deadline');
    expect(r.end).toBe('Refunded');
    expect(r.reclaimed).toBe(true);
    expect(r.reports).toEqual(expect.arrayContaining(['deliverBy-passed', 'refunded']));
    expect(await eventTypes(r.commitmentId)).not.toContain('delivery.submitted');
    expect(r.buyerHolds).toEqual(r.paid!.hold);
    expect(record.row).toMatchObject({ outcome: 'Refunded', reclaimed: true, deliveredAt: null });
  }, 60_000);

  it('shown-mismatch: the operators raise their fee after the buyer saw the offer, and the signer refuses before any signature', async () => {
    const { r, out, record } = await rehearsal('shown-mismatch');
    expect(r.end).toBe('Not funded');
    expect(r.expected).toBe(true);
    expect(r.refusal).toMatch(/^refusing to sign: fees\.operator is \{"amount":"\d+","token":"tUSD"\}, not the shown \{"amount":"200000","token":"tUSD"\}/);
    expect(r.paid).toBeNull();
    expect(await eventTypes(r.commitmentId)).not.toContain('hold.funded');
    expect(['Offered', 'AcceptedByAdjudicator']).toContain((await state(r.commitmentId))[0]);
    expect(record.row.fundedAt).toBeNull();
    expect(out).toMatch(/The signer refuses \([\d.]+ s\): refusing to sign: fees\.operator is/);
  }, 60_000);

  it('resume: the buyer stops after funding, the seller\'s adapter restarts with a report mapping, and the buyer resumes from its key store days later', async () => {
    const { r, out, record } = await rehearsal('resume', { mappingFile: OWN_SHAPE_MAPPING });
    expect(r.end).toBe('Released');
    const names = r.steps.map((s) => s.step);
    for (const step of ['The buyer stops after funding', 'The seller\'s adapter restarts', 'Days pass', 'The buyer resumes from its key store', 'The deal ends Released']) expect(names).toContain(step);
    expect(names.indexOf('The buyer resumes from its key store')).toBeGreaterThan(names.indexOf('Days pass'));
    // The restarted adapter read the same journal and converted the seller's own shape before it delivered.
    expect(out).toMatch(/seller adapter: \S+ 0x[0-9a-f]{64} converted the result with the report mapping/);
    expect(record.row.outcome).toBe('Released');
  }, 60_000);

  it('a seller\'s own report and terms in the kit\'s shape (JSON terms on a job export): released and redelivered, with the file\'s fee', async () => {
    const files = { reportFile: EXPORT_REPORT, termsFile: EXPORT_TERMS, scope: { commit: '9b1d4e7a3c5f20864d1e3b5a7c9f0e2d4b6a8c1e', files: ['src/Vault.sol', 'src/Oracle.sol', 'src/Fees.sol'], lines: 1200 } };
    const released = await rehearsal('released', files);
    expect(released.r.end).toBe('Released');
    expect(released.r.offer.price).toEqual({ token: 'tUSD', amount: '1500000000' });
    expect(released.r.offer.fees.adjudication).toEqual({ token: 'tUSD', amount: '50000000' });
    expect(released.r.offer.windows.deliverWithinSec).toBe(604_800);
    expect(released.r.delivery!.work).toBe(readFileSync(EXPORT_REPORT, 'utf8'));
    expect(released.r.shown.differences).toEqual([]);

    world.advanceClock(3601);
    // No refused report named: the run cuts the seller's report in half, which intake refuses as JSON.
    const redelivered = await rehearsal('redelivered', files);
    expect(redelivered.r.end).toBe('Released');
    expect(redelivered.r.alerts.map((a) => a.type)).toEqual(['delivery.refused', 'delivery.fixed']);
    expect(redelivered.out).toContain('The first report: the seller\'s report cut to its first half');
  }, 90_000);

  it('an unused key from an existing key store, as the live run takes the rehearsal key: one key, one deal', async () => {
    const store = mkdtempSync(join(tmpdir(), 't355-keys-'));
    dirs.push(store);
    const key = await makeKeys(store, { operators: world.operators });
    const { r } = await rehearsal('released', { keys: { store, buyer: key.address } });
    expect(r.end).toBe('Released');
    expect(r.buyer).toBe(key.address);
    // The key now serves that deal: a second case with it stops before any quote.
    world.advanceClock(3601);
    await expect(rehearsal('released', { keys: { store, buyer: key.address } })).rejects.toThrow(/this key already serves 0x[0-9a-f]{64}: one key, one deal/);
  }, 60_000);

  it('refuses before any deal opens: a case the live service cannot run, a scope that is not JSON', () => {
    expect(parseArgs(['--case', 'all'])).toEqual({ live: false, case: 'all' });
    expect(parseArgs(['--case', 'resume', '--mapping', 'm.json', '--scope', '{"commit":"a"}', '--out', 'o', '--refused-report', 'x.json'])).toEqual({ live: false, case: 'resume', mappingFile: 'm.json', scope: { commit: 'a' }, out: 'o', refusedReportFile: 'x.json' });
    expect(parseArgs(['--live', '--case', 'released', '--report', 'r.json', '--terms', 't.json', '--keys', 'k', '--buyer', '0x15c01fd0877f748f72a572aac5f2d5579af76044'])).toEqual({ live: true, case: 'released', reportFile: 'r.json', termsFile: 't.json', keys: 'k', buyer: '0x15c01fd0877f748f72a572aac5f2d5579af76044' });
    expect(() => parseArgs(['--case', 'colour'])).toThrow(/--case is one of released, redelivered, rubric, refunded, missed-deadline, shown-mismatch, resume, two-addresses or all/);
    expect(() => parseArgs(['--scope', 'three files'])).toThrow('--scope is not JSON');
    expect(() => parseArgs(['--live', '--case', 'all'])).toThrow('--live runs one case');
    expect(() => parseArgs(['--live', '--case', 'refunded'])).toThrow(/--live cannot run refunded/);
    expect(() => parseArgs(['--live', '--case', 'shown-mismatch'])).toThrow(/--live cannot run shown-mismatch/);
    expect(() => parseArgs(['--keys', 'k'])).toThrow('--keys and --buyer go together');
    expect(() => parseArgs(['--live', '--report', 'r.json'])).toThrow('--report and --terms run on the local world only, or with --case');
    expect(() => parseArgs(['--mapping', 'm.json'])).toThrow('--mapping, --scope, --refused-report, --out, --keys and --buyer need --case');
  });

  it('the command: --case all runs every case on the in-process chain and prints each end state and record; no arguments as before', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 't355-cli-'));
    dirs.push(outDir);
    const [all, plainRun] = await Promise.all([cli(['--case', 'all', '--out', outDir]), cli([])]);
    expect(readdirSync(outDir).sort()).toEqual([...CASES].sort());
    expect(all.code, all.err).toBe(0);
    for (const name of CASES) expect(all.out).toMatch(new RegExp(`Case ${name}: (Released|Refunded|Not funded), as expected\\. Deal record: \\S+deal-record\\.json`));
    expect(all.out).toMatch(/This world's faucet grants at most 1,000,000\.00 tUSD a deal/);
    expect(all.out).toContain('8 of 8 cases ended as expected.');
    expect(plainRun.code, plainRun.err).toBe(0);
    expect(plainRun.out).toContain('== Outcome: released ==');
    expect(plainRun.out).toContain('== Outcome: refused ==');
    expect(plainRun.out).not.toContain('Case ');
  }, 120_000);
});
