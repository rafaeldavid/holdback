// The judge registry (docs/judgment-and-defenses.md, Model registry; ADR-0006). A commitment binds the
// keccak256 of the registry's RFC 8785 canonical JSON (`adjudication.registryHash`), and the panel is
// drawn only from that registry's active entries. The loader takes the parsed document (the adjudicator
// app reads config/judges.yaml) and refuses anything that could let a floating model judge.
import { canonicalKeccak, err, ok, problem, type Hex32, type Problem, type Result } from '@holdback/core';
import { isPinnedModelId, type JudgeRegistry } from '../pipeline.js';

export type RegistryProvider = 'anthropic' | 'openai-compatible';
export type RegistryStatus = 'candidate' | 'active' | 'retired';

export interface RegistryEntry {
  id: string;
  provider: RegistryProvider;
  family: string;
  /** Pinned, dated model ID. Never an alias. */
  model: string;
  status: RegistryStatus;
  /** RFC 3339 date. */
  calibratedAt?: string;
  /** Integer basis points (ADR-0022): no floats in a hashed body. */
  metrics?: { falseAcceptBps: number; falseRejectBps: number; n: number };
}

export interface RegistryDoc {
  version: number;
  judges: RegistryEntry[];
}

export interface LoadedRegistry {
  doc: RegistryDoc;
  hash: Hex32;
  /** Active entries in id order: the population the seeded shuffle runs over. */
  active: readonly RegistryEntry[];
  /** Active model ID to family, for runPipeline's registry check. */
  judges: JudgeRegistry;
}

const ENTRY_KEYS = new Set(['id', 'provider', 'family', 'model', 'status', 'calibratedAt', 'metrics']);
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isSafeInteger(v) && v >= lo && v <= hi;

function entryProblem(e: unknown, k: number): string | undefined {
  if (!isObj(e)) return `judges[${k}] is not an object`;
  for (const key of Object.keys(e)) if (!ENTRY_KEYS.has(key)) return `judges[${k}] has unknown key ${key}`;
  if (typeof e.id !== 'string' || !ID.test(e.id)) return `judges[${k}].id is invalid`;
  if (e.provider !== 'anthropic' && e.provider !== 'openai-compatible') return `${e.id}: provider must be anthropic or openai-compatible`;
  if (typeof e.family !== 'string' || !ID.test(e.family)) return `${e.id}: family is invalid`;
  if (typeof e.model !== 'string' || !isPinnedModelId(e.model)) return `unpinned-model-refused: ${e.id} names ${JSON.stringify(String(e.model).slice(0, 80))}, not a pinned dated model ID`;
  if (e.status !== 'candidate' && e.status !== 'active' && e.status !== 'retired') return `${e.id}: status must be candidate, active or retired`;
  if (e.calibratedAt !== undefined && (typeof e.calibratedAt !== 'string' || !DATE.test(e.calibratedAt))) return `${e.id}: calibratedAt must be YYYY-MM-DD`;
  if (e.metrics !== undefined) {
    const m = e.metrics;
    if (!isObj(m) || Object.keys(m).sort().join() !== 'falseAcceptBps,falseRejectBps,n') return `${e.id}: metrics must be {falseAcceptBps, falseRejectBps, n}`;
    if (!isInt(m.falseAcceptBps, 0, 10_000) || !isInt(m.falseRejectBps, 0, 10_000) || !isInt(m.n, 0, 1_000_000)) return `${e.id}: metrics must be integers (basis points)`;
  }
  return undefined;
}

/**
 * Validates and hashes a registry document. With `expectedHash`, a registry that does not hash to it is
 * refused (`registry_mismatch`). Model IDs are checked on every entry, retired ones included.
 */
export function loadRegistry(doc: unknown, expectedHash?: Hex32): Result<LoadedRegistry, Problem> {
  const bad = (d: string) => err(problem('invalid_terms', `registry: ${d}`));
  if (!isObj(doc) || Object.keys(doc).sort().join() !== 'judges,version') return bad('must be {version, judges}');
  if (!isInt(doc.version, 1, 1_000_000)) return bad('version must be a positive integer');
  if (!Array.isArray(doc.judges)) return bad('judges must be a list');
  for (const [k, e] of doc.judges.entries()) {
    const p = entryProblem(e, k);
    if (p) return bad(p);
  }
  const judges = doc.judges as RegistryEntry[];
  if (new Set(judges.map((e) => e.id)).size !== judges.length) return bad('duplicate judge id');
  if (new Set(judges.map((e) => e.model)).size !== judges.length) return bad('duplicate model ID');
  const hash = canonicalKeccak(doc);
  if (expectedHash !== undefined && hash !== expectedHash) return err(problem('registry_mismatch', `registry hashes to ${hash}; the commitment binds ${expectedHash}`));
  const active = judges.filter((e) => e.status === 'active').sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return ok({ doc: doc as unknown as RegistryDoc, hash, active, judges: new Map(active.map((e) => [e.model, { family: e.family }])) });
}
