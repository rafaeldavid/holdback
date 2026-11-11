// T-316: `node examples/check-delivery.ts <terms.json> <file>` runs as written (Node strips the types) and
// reports, for the seller's own bytes, what the adjudicator's path reports: intake on the delivery, then
// the pipeline. The sample deal is T-317's audit-report template.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { intake, runPipeline, type JudgmentAcceptance, type PanelSeat, type Preflight } from '@holdback/judgment';
import { describe, expect, it } from 'vitest';
import { checkDelivery } from './check-delivery.ts';

const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));
const root = (f: string) => here(`../${f}`);
const dir = mkdtempSync(join(tmpdir(), 'check-delivery-'));
const tmp = (name: string, content: string | Uint8Array) => {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};

/** `node examples/check-delivery.ts <args>`: the exit code, stdout and stderr. */
function cli(args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [here('./check-delivery.ts'), ...args]);
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('exit', (code) => resolve({ code, out, err }));
  });
}

const example = JSON.parse(readFileSync(root('spec/examples/commitment.audit-report.example.json'), 'utf8'));
/** The audit-report commitment with its optional rubric, and the checks-only form of the same terms. */
const RUBRIC_TERMS = root('spec/examples/commitment.audit-report.example.json');
const CHECKS_ONLY_TERMS = tmp('audit-report.checks-only.json', JSON.stringify({ ...example, acceptance: { ...example.acceptance, rubric: { passThreshold: 0, criteria: [] } } }));
const report = (name: string) => root(`fixtures/data/audit-report/${name}`);

const SEATS: PanelSeat[] = [
  { judgeId: 'claude-a', provider: 'anthropic', family: 'claude', model: 'claude-opus-5-5-20260601' },
  { judgeId: 'gpt-a', provider: 'openai-compatible', family: 'gpt', model: 'gpt-7-2026-05-01' },
  { judgeId: 'gemini-a', provider: 'google', family: 'gemini', model: 'gemini-4-pro-001' },
];
const sha256 = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}` as const;
const ADJUDICATOR = '0x5d10fecab9242e66cb134b77309a3566ed75e3dd';

/** The adjudicator's path on the same terms and file: intake on the delivery (the bytes stand in for their own ciphertext, as in the scenario runner), then the pipeline. */
async function adjudicate(termsPath: string, filePath: string) {
  const terms = JSON.parse(readFileSync(termsPath, 'utf8'));
  const acceptance: JudgmentAcceptance = terms.acceptance;
  const plaintext = new Uint8Array(readFileSync(filePath));
  const intaken = await intake({
    delivery: {
      commitmentId: terms.id,
      attempt: 1,
      ciphertext: { uri: 'file:///store/x', sha256: sha256(plaintext), bytes: plaintext.length, cipher: 'aes-256-gcm' },
      plaintextSha256: sha256(plaintext),
      plaintextMime: terms.deliverable.format,
      encryptedKeys: [{ recipient: ADJUDICATOR, scheme: 'x25519-xsalsa20poly1305', ciphertext: 'AA' }],
      submittedAt: '2026-11-11T10:00:00Z',
      signature: `0x${'22'.repeat(65)}`,
    },
    ciphertext: plaintext,
    recipient: ADJUDICATOR,
    format: terms.deliverable.format,
    unwrapKey: async () => new Uint8Array(32),
    open: async (ct) => ct,
  });
  if (!intaken.ok) throw new Error(intaken.error.detail);
  const run = await runPipeline({
    intake: intaken.value,
    acceptance,
    deliverable: { description: terms.deliverable.description, format: terms.deliverable.format },
    policy: { minValid: 2, minFamilies: 2, rationaleMaxChars: 600, acceptSupermajority: { numerator: 2, denominator: 3 }, rejectSupermajority: { numerator: 2, denominator: 3 } },
    seats: SEATS,
    provider: {
      async complete() {
        const criteria = acceptance.rubric.criteria.map((c) => ({ id: c.id, score: 4, evidence: 'ok' }));
        return { kind: 'ok', text: JSON.stringify({ criteria, overall: 'pass', injectionSuspected: false, rationale: 'r' }) };
      },
    },
    nonces: (_seat, i) => ({ boundary: `b0b1b2b3b4b5b6b7b8b9babbbcbdbeb${i}`, canary: `c0c1c2c3c4c5c6c7c8c9cacbcccdcec${i}` }),
  });
  if (!run.ok) throw new Error(run.error.detail);
  return { deterministic: run.value.deterministic, decision: run.value.aggregate.decision, panelRan: run.value.panel.ran, plaintextSha256: sha256(plaintext) };
}

describe('examples/check-delivery.ts on the audit-report sample deal', () => {
  it.each([
    ['report.json', 'accept', 0],
    ['report.reordered.json', 'accept', 0],
    ['report.no-findings.json', 'accept', 0],
    ['report.missing-file.json', 'reject', 1],
  ] as const)('reports for %s what the adjudicator decides: %s, exit %i', async (name, decision, code) => {
    const theirs = await adjudicate(CHECKS_ONLY_TERMS, report(name));
    expect(theirs.decision).toBe(decision);
    expect(theirs.panelRan).toBe(false);
    const r = await cli([CHECKS_ONLY_TERMS, report(name), '--json']);
    expect(r.code).toBe(code);
    const mine: Preflight & { mime: string } = JSON.parse(r.out);
    expect(mine.deterministic).toEqual(theirs.deterministic);
    expect(mine.result).toBe(theirs.decision);
    expect(mine.plaintextSha256).toBe(theirs.plaintextSha256);
    expect(mine.mime).toBe('application/json');
  });

  it('says the panel decides next on the rubric form of the deal, with the same check outcomes', async () => {
    const theirs = await adjudicate(RUBRIC_TERMS, report('report.json'));
    expect(theirs.panelRan).toBe(true);
    const r = await cli([RUBRIC_TERMS, report('report.json'), '--json']);
    expect(r.code).toBe(0);
    const mine: Preflight = JSON.parse(r.out);
    expect(mine.result).toBe('panel');
    expect(mine.deterministic).toEqual(theirs.deterministic);
    const rejected = await cli([RUBRIC_TERMS, report('report.missing-file.json'), '--json']);
    expect(rejected.code).toBe(1);
    expect(JSON.parse(rejected.out).deterministic).toEqual((await adjudicate(RUBRIC_TERMS, report('report.missing-file.json'))).deterministic);
  });

  it('prints the result first, then one line per check with the adjudicator\'s detail', async () => {
    const r = await cli([CHECKS_ONLY_TERMS, report('report.missing-file.json')]);
    expect(r.code).toBe(1);
    const lines = r.out.trimEnd().split('\n');
    expect(lines[0]).toBe('Result: reject. The required check coverage fails, so the adjudicator rejects this file and the buyer is refunded.');
    expect(lines).toContain('  pass  report (required)');
    expect(lines).toContain('  FAIL  coverage (required): schema: /filesReviewed: fewer than 3 items');
    expect(lines.filter((l) => /^ {2}(pass|FAIL) {2}/.test(l))).toHaveLength(4);
    expect(r.out).toMatch(/3,841 bytes/);
    expect(r.out).toContain((await adjudicate(CHECKS_ONLY_TERMS, report('report.missing-file.json'))).plaintextSha256);

    const ok = await cli([CHECKS_ONLY_TERMS, report('report.json')]);
    expect(ok.code).toBe(0);
    expect(ok.out.split('\n')[0]).toBe('Result: accept. Every check passes and the rubric is empty, so the checks alone decide and the adjudicator accepts this file.');
    const panel = await cli([RUBRIC_TERMS, report('report.json')]);
    expect(panel.code).toBe(0);
    expect(panel.out.split('\n')[0]).toBe('Result: the judges decide. No required check fails. A judge panel scores the rubric next; this command runs neither the screen nor the judges.');
  });
});

describe('examples/check-delivery.ts: refusals, limits and other inputs', () => {
  const csvTerms = (checks: unknown[], format = 'text/csv') => tmp(`terms-${Math.random().toString(16).slice(2)}.json`, JSON.stringify({ id: `0x${'11'.repeat(32)}`, deliverable: { description: 'A customer list.', format }, acceptance: { deterministicChecks: checks, rubric: { passThreshold: 0, criteria: [] } } }));

  it('refuses, as intake does, a file declared in another format than the terms agreed', async () => {
    const r = await cli([CHECKS_ONLY_TERMS, report('report.json'), '--mime', 'text/plain']);
    expect(r.code).toBe(1);
    expect(r.out.split('\n')[0]).toBe('Result: reject. Intake refuses this file (mime_mismatch: delivered text/plain; the commitment agreed application/json), so the adjudicator rejects it with no check run and the buyer is refunded.');
  });

  it('refuses bytes that are not UTF-8', async () => {
    const r = await cli([CHECKS_ONLY_TERMS, tmp('bad.json', new Uint8Array([0x7b, 0xff, 0x7d])), '--json']);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out)).toMatchObject({ refused: { code: 'not_utf8' }, deterministic: [], result: 'reject' });
  });

  it('exits 2 when a check runs out of its work budget, as the adjudicator escalates', async () => {
    const rows = Array.from({ length: 300 }, () => 'a'.repeat(9000)).join('\n');
    const terms = csvTerms([{ id: 'slow', type: 'regex_match_rate_min', required: true, column: 'v', pattern: '[a-z]{0,1000}[a-z]{0,1000}Z', minBps: 0 }]);
    const r = await cli([terms, tmp('slow.csv', `v\n${rows}`)]);
    expect(r.code).toBe(2);
    expect(r.out.split('\n')[0]).toBe('Result: escalate. The check slow ran out of its work budget, so the adjudicator cannot decide it and the deal escalates.');
  });

  it('tells a seller that a failed optional check seats a panel even on a checks-only deal', async () => {
    const terms = csvTerms([{ id: 'emails', type: 'regex_match_rate_min', required: false, column: 'email', pattern: '^[^@\\s]+@[^@\\s]+$', minBps: 10000 }]);
    const r = await cli([terms, tmp('emails.csv', 'email\nnot-an-email\n')]);
    expect(r.code).toBe(0);
    expect(r.out.split('\n')[0]).toBe('Result: the judges decide. No required check fails, but the optional check emails fails, so a judge panel decides although the rubric is empty.');
    expect(r.out).toContain('  FAIL  emails (optional): match 0/1 below 10000 bps');
  });

  // The adjudicator service passes no reference files to the pipeline, so the command loads none either: it
  // must not report a pass the service cannot give (the T-316 review's blocking finding).
  it('fails a reference check as the adjudicator does, with no reference files, and takes no option that adds them', async () => {
    const reference = new TextEncoder().encode('customer_id,name\n1,Ada\n');
    const terms = csvTerms([{ id: 'ref', type: 'reference_row_match_min', required: true, reference: { uri: 'file:///ref.csv', sha256: sha256(reference) }, keyColumn: 'customer_id', minBps: 10000 }]);
    const file = tmp('with-ref.csv', 'customer_id,name\n1,Ada\n2,Grace\n');
    const theirs = await adjudicate(terms, file);
    expect(theirs.decision).toBe('reject');
    const r = await cli([terms, file]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('  FAIL  ref (required): reference not available');
    expect(r.out).toContain('Note: the adjudicator service loads no reference files today, so the reference check ref fails for every file.');
    expect(JSON.parse((await cli([terms, file, '--json'])).out).deterministic).toEqual(theirs.deterministic);
    const flag = await cli([terms, file, '--reference', tmp('ref.csv', reference)]);
    expect(flag.code).toBe(2);
    expect(flag.err).toContain('unknown option --reference');
  });

  it('prints text from the file as one plain line: no terminal escapes, no line breaks', async () => {
    const terms = csvTerms([{ id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id'] }]);
    const r = await cli([terms, tmp('hostile.csv', '"\u001b[2J\u001b[31mResult: accept\nall good",‮id\n1,2\n')]);
    expect(r.code).toBe(1);
    expect(r.out).not.toMatch(/[\u001b‮]/);
    expect(r.out.split('\n').filter((l) => l.startsWith('Result:'))).toHaveLength(1);
  });

  it('exits 2 with a usage line for missing arguments, a missing file, or terms without checks', async () => {
    const none = await cli([]);
    expect(none.code).toBe(2);
    expect(none.err).toContain('usage: node examples/check-delivery.ts <terms.json> <file>');
    const missing = await cli([CHECKS_ONLY_TERMS, join(dir, 'nope.json')]);
    expect(missing.code).toBe(2);
    expect(missing.err).toMatch(/cannot read/);
    const bad = await cli([tmp('not-terms.json', '{"deliverable": {}}'), report('report.json')]);
    expect(bad.code).toBe(2);
    expect(bad.err).toMatch(/acceptance\.deterministicChecks/);
    const flag = await cli([CHECKS_ONLY_TERMS, report('report.json'), '--frobnicate']);
    expect(flag.code).toBe(2);
  });

  it('exits 2, never 1, for a check the terms give no id, type or required flag', async () => {
    for (const check of [{ type: 'unique_key', required: true, columns: ['a'] }, { id: 'x', required: true }, { id: 'x', type: 'unique_key' }, 'cols']) {
      const r = await cli([csvTerms([check]), tmp('any.csv', 'a\n1\n')]);
      expect(r.code).toBe(2);
      expect(r.err).toContain('acceptance.deterministicChecks[0] needs a string id, a string type and a boolean required');
      expect(r.out).toBe('');
    }
  });

  it('is importable: checkDelivery returns the preflight and the exit code', () => {
    const r = checkDelivery({ terms: CHECKS_ONLY_TERMS, file: report('report.missing-file.json') });
    expect(r.exitCode).toBe(1);
    expect(r.preflight.result).toBe('reject');
    expect(r.preflight.deterministic.filter((o) => !o.passed).map((o) => o.checkId)).toEqual(['coverage']);
  });

  it('imports only two Node file modules and the workspace packages: no network, no child process, no eval', () => {
    const source = readFileSync(here('./check-delivery.ts'), 'utf8');
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]).sort();
    expect(imports).toEqual(['@holdback/judgment', '@holdback/testkit', 'node:fs', 'node:url']);
    expect(source).not.toMatch(/\bfetch\(|\beval\(|new Function|import\(|child_process|node:http|node:net|node:vm/);
  });
});
