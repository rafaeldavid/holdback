// A seller's check before it delivers (T-316). The rules contract takes one delivery, and a failed required
// check refunds the buyer. This runs the terms' deterministic checks on the exact file you will deliver and
// prints what the adjudicator's first stage will say about it: the same pass or fail for each check, with the
// same detail, and the same refusal when intake would refuse the file.
//
// It runs the adjudicator's own code (@holdback/judgment: intake's plaintext rules, then stage 1), offline.
// It reads two local files (and any reference files) and nothing else: no network, and nothing in the file
// or the terms is executed. It does not run the screen or the judges, so on a rubric deal it tells you only
// that the checks do not refuse the file.
//
//   pnpm install && pnpm build
//   node examples/check-delivery.ts <terms.json> <file> [--mime <type>] [--reference <file>]... [--json]
//
// <terms.json> is the commitment as you signed it: `GET /v1/commitments/<id>/terms`, or your own offer body.
// It needs `acceptance` and `deliverable.format`. `--mime` is the format you will declare in the delivery
// (default: the agreed format). `--reference` adds a file a `reference_row_match_min` check names.
// Exit code: 0 when the checks accept the file or pass it to the judges, 1 when the adjudicator would
// reject it, 2 when a check cannot be decided (the deal would escalate) or the command cannot run.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { preflightDelivery, type JudgmentAcceptance, type Preflight, type PreflightInput } from '@holdback/judgment';
import { plain, safeJson } from '@holdback/testkit';

type Mime = PreflightInput['mime'];

export interface CheckDeliveryOptions {
  /** Path of the terms: a JSON file with `acceptance` and `deliverable.format`. */
  terms: string;
  /** Path of the file to deliver. */
  file: string;
  /** The format the delivery will declare. Defaults to the agreed `deliverable.format`. */
  mime?: string;
  /** Paths of reference files, matched to checks by their SHA-256. */
  references?: readonly string[];
}

export interface CheckDeliveryResult {
  preflight: Preflight;
  mime: string;
  /** What to print: the result first, then the file, then one line per check. */
  lines: string[];
  /** 0: accept or panel. 1: reject. 2: escalate. */
  exitCode: 0 | 1 | 2;
}

/** The command cannot run: a missing file, terms without checks, an unknown flag. */
export class UsageError extends Error {}

const USAGE = 'usage: node examples/check-delivery.ts <terms.json> <file> [--mime <type>] [--reference <file>]... [--json]';
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function bytesOf(path: string): Uint8Array {
  try {
    return new Uint8Array(readFileSync(path));
  } catch {
    throw new UsageError(`cannot read ${plain(path)}`);
  }
}

/** The parts of the terms stage 1 uses. The check library itself refuses a check it cannot evaluate. */
function readTerms(path: string): { acceptance: JudgmentAcceptance; format: string } {
  let terms: unknown;
  try {
    terms = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytesOf(path)));
  } catch (e) {
    if (e instanceof UsageError) throw e;
    throw new UsageError(`${plain(path)} is not a JSON file`);
  }
  const acceptance = isRecord(terms) ? terms['acceptance'] : undefined;
  const deliverable = isRecord(terms) ? terms['deliverable'] : undefined;
  if (!isRecord(acceptance) || !Array.isArray(acceptance['deterministicChecks']) || !acceptance['deterministicChecks'].every(isRecord)) {
    throw new UsageError(`${plain(path)} has no acceptance.deterministicChecks list: pass the commitment as you signed it`);
  }
  const rubric = acceptance['rubric'];
  if (!isRecord(rubric) || !Array.isArray(rubric['criteria'])) throw new UsageError(`${plain(path)} has no acceptance.rubric.criteria list: pass the commitment as you signed it`);
  if (!isRecord(deliverable) || typeof deliverable['format'] !== 'string') throw new UsageError(`${plain(path)} has no deliverable.format`);
  return { acceptance: acceptance as unknown as JudgmentAcceptance, format: deliverable['format'] };
}

const list = (ids: readonly string[]) => ids.map(plain).join(', ');
const count = (n: number) => n.toLocaleString('en-US');

function headline(p: Preflight, rubricEmpty: boolean): string {
  if (p.refused) return `Result: reject. Intake refuses this file (${p.refused.code}: ${plain(p.refused.detail)}), so the adjudicator rejects it with no check run and the buyer is refunded.`;
  const open = new Set(p.inconclusive);
  const failed = p.deterministic.filter((o) => !o.passed && !open.has(o.checkId));
  const required = failed.filter((o) => o.required).map((o) => o.checkId);
  const optional = failed.filter((o) => !o.required).map((o) => o.checkId);
  switch (p.result) {
    case 'reject':
      return `Result: reject. The required ${required.length === 1 ? 'check' : 'checks'} ${list(required)} ${required.length === 1 ? 'fails' : 'fail'}, so the adjudicator rejects this file and the buyer is refunded.`;
    case 'escalate':
      return `Result: escalate. The ${p.inconclusive.length === 1 ? 'check' : 'checks'} ${list(p.inconclusive)} ran out of ${p.inconclusive.length === 1 ? 'its' : 'their'} work budget, so the adjudicator cannot decide ${p.inconclusive.length === 1 ? 'it' : 'them'} and the deal escalates.`;
    case 'accept':
      return 'Result: accept. Every check passes and the rubric is empty, so the checks alone decide and the adjudicator accepts this file.';
    case 'panel':
      if (rubricEmpty) return `Result: the judges decide. No required check fails, but the optional ${optional.length === 1 ? 'check' : 'checks'} ${list(optional)} ${optional.length === 1 ? 'fails' : 'fail'}, so a judge panel decides although the rubric is empty.`;
      return 'Result: the judges decide. No required check fails. A judge panel scores the rubric next; this command runs neither the screen nor the judges.';
  }
}

/** Runs the adjudicator's intake rules and deterministic checks on a local file. Reads files; changes nothing. */
export function checkDelivery(options: CheckDeliveryOptions): CheckDeliveryResult {
  const { acceptance, format } = readTerms(options.terms);
  const plaintext = bytesOf(options.file);
  const mime = options.mime ?? format;
  const references = new Map<string, Uint8Array>();
  for (const path of options.references ?? []) {
    const bytes = bytesOf(path);
    references.set(`sha256:${createHash('sha256').update(bytes).digest('hex')}`, bytes);
  }
  // The library refuses a format outside its allowlist, so an unknown string is safe to pass as the MIME.
  const preflight = preflightDelivery({ plaintext, mime: mime as Mime, format: format as Mime, acceptance, references });

  const open = new Set(preflight.inconclusive);
  // Every string that can come from the file or the terms is printed as one plain line (docs/team.md, output surfaces).
  const lines = [
    headline(preflight, acceptance.rubric.criteria.length === 0),
    `File: ${plain(options.file)}, ${count(preflight.bytes)} bytes, ${preflight.plaintextSha256}, checked as ${plain(mime)} (agreed: ${plain(format)}).`,
    ...(preflight.deterministic.length ? ['Checks:'] : []),
    ...preflight.deterministic.map((o) => {
      const state = open.has(o.checkId) ? 'OPEN' : o.passed ? 'pass' : 'FAIL';
      return `  ${state}  ${plain(o.checkId)} (${o.required ? 'required' : 'optional'})${o.detail === undefined ? '' : `: ${plain(o.detail)}`}`;
    }),
    'This result holds for these exact bytes: the hash above is the plaintextSha256 your delivery will carry.',
  ];
  return { preflight, mime, lines, exitCode: preflight.result === 'reject' ? 1 : preflight.result === 'escalate' ? 2 : 0 };
}

function parseArgs(argv: readonly string[]): CheckDeliveryOptions & { json: boolean } {
  const positional: string[] = [];
  const references: string[] = [];
  let mime: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--json') json = true;
    else if (a === '--mime' || a === '--reference') {
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`${a} needs a value`);
      if (a === '--mime') mime = value;
      else references.push(value);
    } else if (a.startsWith('--')) throw new UsageError(`unknown option ${plain(a)}`);
    else positional.push(a);
  }
  if (positional.length !== 2) throw new UsageError('give the terms file and the file to deliver');
  return { terms: positional[0]!, file: positional[1]!, references, json, ...(mime === undefined ? {} : { mime }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const r = checkDelivery(options);
    console.log(options.json ? safeJson({ file: options.file, mime: r.mime, ...r.preflight }) : r.lines.join('\n'));
    process.exitCode = r.exitCode;
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`check-delivery: ${e.message}\n${USAGE}`);
    process.exitCode = 2;
  }
}
