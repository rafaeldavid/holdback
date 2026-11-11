// A seller's check before it delivers (T-316). The rules contract takes one delivery, and a failed required
// check refunds the buyer. This runs the terms' deterministic checks on the exact file you will deliver and
// prints what the adjudicator's first stage will say about it: the same pass or fail for each check, with the
// same detail, and the same refusal when intake would refuse the file.
//
// It runs the adjudicator's own code (@holdback/judgment: intake's plaintext rules, then stage 1), offline.
// It reads two local files and nothing else: no network, and nothing in the file or the terms is executed.
// It does not run the screen or the judges, so on a rubric deal it tells you only that the checks do not
// refuse the file.
//
// A `reference_row_match_min` check compares the file with a reference file the terms name by URI and hash.
// The adjudicator loads that reference from its content store by the committed hash (T-327); give this
// command the same bytes with `--reference <file>` (download them from the URI in the terms). A reference
// you do not give fails its check here with "reference not available", as on an adjudicator whose store
// does not hold it.
//
//   pnpm install && pnpm build
//   node examples/check-delivery.ts <terms.json> <file> [--reference <file>]... [--mime <type>] [--json]
//
// <terms.json> is the commitment as you signed it: `GET /v1/commitments/<id>/terms`, or your own offer body.
// It needs `acceptance` and `deliverable.format`. `--mime` is the format you will declare in the delivery
// (default: the agreed format). `--reference` may be given once per reference file.
// Exit code: 0 when the checks accept the file or pass it to the judges, 1 when the adjudicator would
// reject it, 2 when a check cannot be decided (the deal would escalate) or the command cannot run.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { preflightDelivery, referenceLookups, type JudgmentAcceptance, type JudgmentCheck, type Preflight, type PreflightInput } from '@holdback/judgment';
import { plain, safeJson } from '@holdback/testkit';

type Mime = PreflightInput['mime'];

export interface CheckDeliveryOptions {
  /** Path of the terms: a JSON file with `acceptance` and `deliverable.format`. */
  terms: string;
  /** Path of the file to deliver. */
  file: string;
  /** The format the delivery will declare. Defaults to the agreed `deliverable.format`. */
  mime?: string;
  /** Paths of reference files, each the bytes a reference check commits to by hash. */
  references?: string[];
}

export interface CheckDeliveryResult {
  preflight: Preflight;
  mime: string;
  /** What to print: the result first, then the file, then one line per check. */
  lines: string[];
  /** 0: accept or panel. 1: reject. 2: escalate. */
  exitCode: 0 | 1 | 2;
}

/** The command cannot run: a missing file, terms without checks, an unknown option. */
export class UsageError extends Error {}

const USAGE = 'usage: node examples/check-delivery.ts <terms.json> <file> [--reference <file>]... [--mime <type>] [--json]';
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
  if (!isRecord(acceptance) || !Array.isArray(acceptance['deterministicChecks'])) {
    throw new UsageError(`${plain(path)} has no acceptance.deterministicChecks list: pass the commitment as you signed it`);
  }
  // The commitment schema gives every check a string id, a type and a required flag; an operator refuses terms without them.
  const malformed = acceptance['deterministicChecks'].findIndex((c) => !isRecord(c) || typeof c['id'] !== 'string' || typeof c['type'] !== 'string' || typeof c['required'] !== 'boolean');
  if (malformed >= 0) throw new UsageError(`${plain(path)}: acceptance.deterministicChecks[${malformed}] needs a string id, a string type and a boolean required`);
  const rubric = acceptance['rubric'];
  if (!isRecord(rubric) || !Array.isArray(rubric['criteria'])) throw new UsageError(`${plain(path)} has no acceptance.rubric.criteria list: pass the commitment as you signed it`);
  if (!isRecord(deliverable) || typeof deliverable['format'] !== 'string') throw new UsageError(`${plain(path)} has no deliverable.format`);
  return { acceptance: acceptance as unknown as JudgmentAcceptance, format: deliverable['format'] };
}

const list = (ids: readonly string[]) => ids.map(plain).join(', ');
/** The id a content store keeps bytes under, and the form the terms commit a reference to. */
const sha256 = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
type ReferenceCheck = Extract<JudgmentCheck, { type: 'reference_row_match_min' }>;
const isReferenceCheck = (c: JudgmentCheck): c is ReferenceCheck => c.type === 'reference_row_match_min';
/** The committed hash, or '' for a hostile check without one (the library fails it). */
const committed = (c: ReferenceCheck): string => (typeof c.reference?.sha256 === 'string' ? c.reference.sha256 : '');
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
  // The references the adjudicator loads: those whose URI ends in their committed hash (referenceLookups). The
  // command passes a file only under one of those hashes, so it reports what the adjudicator can report.
  const refChecks = acceptance.deterministicChecks.filter(isReferenceCheck);
  const loadable = new Set<string>(referenceLookups(acceptance.deterministicChecks).map((l) => l.sha256));
  const references = new Map<string, Uint8Array>();
  for (const path of options.references ?? []) {
    const bytes = bytesOf(path);
    const hash = sha256(bytes);
    if (!refChecks.some((c) => committed(c) === hash)) throw new UsageError(`the reference file ${plain(path)} hashes to ${hash}, which no reference check in the terms commits to`);
    if (loadable.has(hash)) references.set(hash, bytes);
  }
  // The library refuses a format outside its allowlist, so an unknown string is safe to pass as the MIME.
  const preflight = preflightDelivery({ plaintext, mime: mime as Mime, format: format as Mime, acceptance, references });

  const open = new Set(preflight.inconclusive);
  const unloadable = refChecks.filter((c) => !loadable.has(committed(c))).map((c) => c.id);
  const missing = refChecks.filter((c) => loadable.has(committed(c)) && !references.has(committed(c))).map((c) => c.id);
  const notes = preflight.refused
    ? []
    : [
        ...(unloadable.length
          ? [`Note: the URI of the reference ${unloadable.length === 1 ? 'check' : 'checks'} ${list(unloadable)} does not end in ${unloadable.length === 1 ? 'its' : 'their'} committed hash, so the adjudicator never loads ${unloadable.length === 1 ? 'it' : 'them'} and the ${unloadable.length === 1 ? 'check fails' : 'checks fail'} for every file.`]
          : []),
        ...(missing.length
          ? [`Note: no reference file given for ${list(missing)}. The adjudicator loads it from its content store by the committed hash; download it from the URI in the terms and pass it with --reference <file>.`]
          : []),
      ];
  // Every string that can come from the file or the terms is printed as one plain line (docs/team.md, output surfaces).
  const lines = [
    headline(preflight, acceptance.rubric.criteria.length === 0),
    `File: ${plain(options.file)}, ${count(preflight.bytes)} bytes, ${preflight.plaintextSha256}, checked as ${plain(mime)} (agreed: ${plain(format)}).`,
    ...(preflight.deterministic.length ? ['Checks:'] : []),
    ...preflight.deterministic.map((o) => {
      const state = open.has(o.checkId) ? 'OPEN' : o.passed ? 'pass' : 'FAIL';
      return `  ${state}  ${plain(o.checkId)} (${o.required ? 'required' : 'optional'})${o.detail === undefined ? '' : `: ${plain(o.detail)}`}`;
    }),
    ...notes,
    'This result holds for these exact bytes: the hash above is the plaintextSha256 your delivery will carry.',
  ];
  return { preflight, mime, lines, exitCode: preflight.result === 'reject' ? 1 : preflight.result === 'escalate' ? 2 : 0 };
}

function parseArgs(argv: readonly string[]): CheckDeliveryOptions & { json: boolean } {
  const positional: string[] = [];
  let mime: string | undefined;
  let json = false;
  const references: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--json') json = true;
    else if (a === '--reference') {
      const path = argv[++i];
      if (path === undefined) throw new UsageError('--reference needs a file');
      references.push(path);
    } else if (a === '--mime') {
      mime = argv[++i];
      if (mime === undefined) throw new UsageError('--mime needs a value');
    } else if (a.startsWith('--')) throw new UsageError(`unknown option ${plain(a)}`);
    else positional.push(a);
  }
  if (positional.length !== 2) throw new UsageError('give the terms file and the file to deliver');
  return { terms: positional[0]!, file: positional[1]!, json, references, ...(mime === undefined ? {} : { mime }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const r = checkDelivery(options);
    console.log(options.json ? safeJson({ file: options.file, mime: r.mime, ...r.preflight }) : r.lines.join('\n'));
    process.exitCode = r.exitCode;
  } catch (e) {
    // Exit 1 means "the adjudicator would reject", so no failure of this command may exit 1.
    console.error(e instanceof UsageError ? `check-delivery: ${e.message}\n${USAGE}` : `check-delivery: could not run (${plain(e instanceof Error ? e.name : 'error')}); this says nothing about the file`);
    process.exitCode = 2;
  }
}
