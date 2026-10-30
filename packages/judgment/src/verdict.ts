// Verdict parsing (CLAUDE.md: judge output must match judge-verdict.schema.json, or the judge
// abstains). Any doubt about the output is an abstention, never a guess: no repair, no fence
// stripping, no partial reads. Every abstention here is a filter abstention, and the pipeline
// escalates the case on any of them, so a seller cannot shrink the panel by inducing one.
//
// URLs: a URL in the rationale or injectionEvidence abstains; a URL in a criterion's evidence is
// redacted, because honest evidence may quote a URL-like cell from the deliverable.
import { parseJudgeVerdict, type JudgeVerdict } from '@holdback/core';

export const MAX_OUTPUT_CHARS = 64 * 1024;
export const URL_REDACTION = '[link removed]';

export type AbstainReason = 'too_long' | 'canary_echo' | 'not_json' | 'schema' | 'criteria_mismatch' | 'url';
export type ParsedVerdict =
  | { status: 'ok'; verdict: JudgeVerdict; redactedUrls: number }
  | { status: 'abstain'; reason: AbstainReason; detail: string };

export interface VerdictOptions {
  /** The rubric's criterion IDs; the verdict must score each exactly once and nothing else. */
  criterionIds: readonly string[];
  /** This judge's canary; its appearance anywhere in the output is evidence of a hijack. */
  canary: string;
  /** The policy's rationale cap; the schema's 600 applies regardless. */
  rationaleMaxChars: number;
}

/** Undo common URL defanging: [.] (.) {.} " . " ideographic and fullwidth dots, hxxp, [:]. */
function refang(s: string): string {
  return s
    .replace(/\s*(?:\[\.\]|\(\.\)|\{\.\}|\[dot\]|\(dot\))\s*|\s+\.\s+|[\u3002\uFF0E\uFF61]/gi, '.')
    .replace(/hxxp/gi, 'http')
    .replace(/\[:\]/g, ':');
}

// Exfiltration (T15): a scheme://, mailto:, data:, javascript:, a www. host, an IPv4 address, or a
// domain followed by a slash.
const URL_TEST = /\b[a-z][a-z0-9+.-]{1,20}:\/\/|\bmailto:\S|\bdata:[a-z]+\/|\bjavascript:|\bwww\.[a-z0-9-]|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b[a-z0-9-][a-z0-9.-]{0,252}\.[a-z]{2,24}\//i;
const URL_ALL = /\b[a-z][a-z0-9+.-]{1,20}:\/\/\S*|\bmailto:\S+|\bdata:[a-z]+\/\S*|\bjavascript:\S*|\bwww\.[a-z0-9-]\S*|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b\S*|\b[a-z0-9-][a-z0-9.-]{0,252}\.[a-z]{2,24}\/\S*/gi;

export const hasUrl = (s: string): boolean => URL_TEST.test(refang(s));

const abstain = (reason: AbstainReason, detail: string): ParsedVerdict => ({ status: 'abstain', reason, detail });
const squash = (s: string) => s.toLowerCase().replace(/[^0-9a-z]/g, '');

/** Free-text string values in document order (everything except ids and enum fields), iteratively. */
function freeText(value: unknown): string[] {
  const out: string[] = [];
  const stack: Array<[unknown, string]> = [[value, '']];
  while (stack.length) {
    const [v, key] = stack.pop()!;
    if (typeof v === 'string') {
      if (key !== 'id' && key !== 'overall') out.push(v);
    } else if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) stack.push([v[i], key]);
    } else if (v !== null && typeof v === 'object') {
      const entries = Object.entries(v);
      for (let i = entries.length - 1; i >= 0; i--) stack.push([entries[i]![1], entries[i]![0]]);
    }
  }
  return out;
}

/** The canary in any case, with any separators, split across fields, or base64-encoded. */
function echoesCanary(raw: string, parsed: unknown, canary: string): boolean {
  const c = squash(canary);
  if (!c) return false;
  if (squash(raw).includes(c)) return true;
  const texts = parsed === undefined ? [] : freeText(parsed);
  if (squash(texts.join('')).includes(c)) return true;
  for (const t of [raw, ...texts]) {
    for (const m of t.matchAll(/[A-Za-z0-9+/_=-]{16,4096}/g)) {
      if (squash(Buffer.from(m[0], /[-_]/.test(m[0]) ? 'base64url' : 'base64').toString('latin1')).includes(c)) return true;
    }
  }
  return false;
}

export function parseVerdict(raw: string, opts: VerdictOptions): ParsedVerdict {
  if (raw.length > MAX_OUTPUT_CHARS) return abstain('too_long', `output is ${raw.length} characters`);

  let json: unknown;
  let jsonOk = true;
  try {
    json = JSON.parse(raw);
  } catch {
    jsonOk = false;
  }
  if (echoesCanary(raw, jsonOk ? json : undefined, opts.canary)) return abstain('canary_echo', 'output contains the canary');
  if (!jsonOk) return abstain('not_json', 'output is not a single JSON value');

  let parsed: ReturnType<typeof parseJudgeVerdict>;
  try {
    parsed = parseJudgeVerdict(json);
  } catch {
    return abstain('schema', 'output could not be validated');
  }
  if (!parsed.ok) return abstain('schema', parsed.error.detail.slice(0, 200));
  const verdict = parsed.value;
  if (verdict.rationale.length > opts.rationaleMaxChars) return abstain('schema', `rationale exceeds the policy cap of ${opts.rationaleMaxChars}`);

  const want = new Set(opts.criterionIds);
  const got = verdict.criteria.map((c) => c.id);
  if (got.length !== want.size || new Set(got).size !== got.length || !got.every((id) => want.has(id))) {
    return abstain('criteria_mismatch', 'criterion ids differ from the rubric');
  }

  if (hasUrl(verdict.rationale) || hasUrl(verdict.injectionEvidence ?? '')) return abstain('url', 'rationale or injectionEvidence contains a URL');
  let redactedUrls = 0;
  for (const c of verdict.criteria) {
    if (!hasUrl(c.evidence)) continue;
    c.evidence = refang(c.evidence).replace(URL_ALL, () => {
      redactedUrls++;
      return URL_REDACTION;
    }).slice(0, 300);
  }
  return { status: 'ok', verdict, redactedUrls };
}
