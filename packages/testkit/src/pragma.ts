// First-line pragmas: `# @settlement sim @judges recorded @mode guaranteed_on_decision @seed 7`.
// Read before the YAML so the runner can pick the settlement and judges without parsing the body.
import { err, ok, type Result, type SettlementMode } from '@holdback/core';

export type SettlementBackend = 'sim' | 'local' | 'testnet';
export type JudgeSource = 'recorded' | 'fake' | 'live';

export interface Pragmas {
  settlement: SettlementBackend;
  judges: JudgeSource;
  mode: SettlementMode;
  seed: number;
}

export const DEFAULT_PRAGMAS: Pragmas = { settlement: 'sim', judges: 'recorded', mode: 'guaranteed_on_decision', seed: 0 };

export const SETTLEMENTS: readonly SettlementBackend[] = ['sim', 'local', 'testnet'];
export const JUDGES: readonly JudgeSource[] = ['recorded', 'fake', 'live'];
const MODES: readonly SettlementMode[] = ['guaranteed_on_decision', 'settle_after_window'];

function oneOf<T extends string>(name: string, value: string, allowed: readonly T[]): Result<T, string> {
  return (allowed as readonly string[]).includes(value) ? ok(value as T) : err(`@${name} must be one of ${allowed.join(', ')}; got "${value}"`);
}

function parseSeed(value: string): Result<number, string> {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return err(`@seed must be a non-negative integer; got "${value}"`);
  const n = Number(value);
  return Number.isSafeInteger(n) ? ok(n) : err(`@seed must be at most ${Number.MAX_SAFE_INTEGER}; got "${value}"`);
}

export function parsePragmas(source: string): Result<Pragmas, string> {
  const first = source.split(/\r?\n/, 1)[0] ?? '';
  const match = /^#\s*(@.*)$/.exec(first.trim());
  if (!match) return err('the first line must be a pragma comment, e.g. "# @settlement sim @judges recorded @seed 7"');

  const tokens = match[1]!.trim().split(/\s+/);
  const seen = new Set<string>();
  const result: Pragmas = { ...DEFAULT_PRAGMAS };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!token.startsWith('@')) return err(`stray token "${token}" in the pragma line`);
    const name = token.slice(1);
    const value = tokens[i + 1];
    if (value === undefined || value.startsWith('@')) return err(`@${name} needs a value`);
    i++;
    if (seen.has(name)) return err(`@${name} appears twice`);
    seen.add(name);
    let parsed: Result<unknown, string>;
    switch (name) {
      case 'settlement':
        parsed = oneOf(name, value, SETTLEMENTS);
        break;
      case 'judges':
        parsed = oneOf(name, value, JUDGES);
        break;
      case 'mode':
        parsed = oneOf(name, value, MODES);
        break;
      case 'seed':
        parsed = parseSeed(value);
        break;
      default:
        return err(`unknown pragma @${name}; known: @settlement, @judges, @mode, @seed`);
    }
    if (!parsed.ok) return parsed;
    (result as unknown as Record<string, unknown>)[name] = parsed.value;
  }
  return ok(result);
}
