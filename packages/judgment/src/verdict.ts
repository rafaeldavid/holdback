// Verdict parsing (CLAUDE.md: judge output must match judge-verdict.schema.json, or the judge
// abstains). Any doubt about the output is an abstention, never a guess: no repair, no fence
// stripping, no partial reads.
import { parseJudgeVerdict, type JudgeVerdict } from '@holdback/core';

export const MAX_OUTPUT_CHARS = 64 * 1024;

export type AbstainReason = 'too_long' | 'canary_echo' | 'not_json' | 'schema' | 'criteria_mismatch' | 'url';
export type ParsedVerdict = { status: 'ok'; verdict: JudgeVerdict } | { status: 'abstain'; reason: AbstainReason; detail: string };

export interface VerdictOptions {
  /** The rubric's criterion IDs; the verdict must score each exactly once and nothing else. */
  criterionIds: readonly string[];
  /** This judge's canary; its appearance anywhere in the output is evidence of a hijack. */
  canary: string;
  /** The policy's rationale cap; the schema's 600 applies regardless. */
  rationaleMaxChars: number;
}

// Exfiltration (T15): a scheme, a www. host, or a bare domain with a path.
const URL_LIKE = /\b[a-z][a-z0-9+.-]{1,20}:\/\/|\bwww\.[a-z0-9-]|\b[a-z0-9-]{1,63}\.[a-z]{2,24}\/[^\s]/i;

const abstain = (reason: AbstainReason, detail: string): ParsedVerdict => ({ status: 'abstain', reason, detail });

export function parseVerdict(raw: string, opts: VerdictOptions): ParsedVerdict {
  if (raw.length > MAX_OUTPUT_CHARS) return abstain('too_long', `output is ${raw.length} characters`);
  if (opts.canary && raw.includes(opts.canary)) return abstain('canary_echo', 'output contains the canary');

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return abstain('not_json', 'output is not a single JSON value');
  }
  const parsed = parseJudgeVerdict(json);
  if (!parsed.ok) return abstain('schema', parsed.error.detail.slice(0, 200));
  const verdict = parsed.value;
  if (verdict.rationale.length > opts.rationaleMaxChars) return abstain('schema', `rationale exceeds the policy cap of ${opts.rationaleMaxChars}`);

  const want = new Set(opts.criterionIds);
  const got = verdict.criteria.map((c) => c.id);
  if (got.length !== want.size || new Set(got).size !== got.length || !got.every((id) => want.has(id))) {
    return abstain('criteria_mismatch', 'criterion ids differ from the rubric');
  }

  const texts = [verdict.rationale, verdict.injectionEvidence ?? '', ...verdict.criteria.map((c) => c.evidence)];
  if (texts.some((t) => URL_LIKE.test(t))) return abstain('url', 'output contains a URL');
  return { status: 'ok', verdict };
}
