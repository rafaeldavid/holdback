// The judge registry and adjudicator policy the runner binds into every commitment it drives.
// The registry is config/judges.yaml, the same file the adjudicator service (T-009) loads, so snapshots
// show its pinned model IDs. The policy mirrors the adjudicator service's defaults (apps/adjudicator
// policy.ts): panel of three over two families, appeal panel of five over three, this build's templates.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalKeccak, type AdjudicatorPolicy, type Hex32 } from '@holdback/core';
import { AGGREGATION_VERSION, APPEAL_PROMPT_TEMPLATE_HASH, loadRegistry, PROMPT_TEMPLATE_HASH, SCREEN_VERSION, type LoadedRegistry } from '@holdback/judgment';
import { parse } from 'yaml';

export const REGISTRY_FILE = 'config/judges.yaml';

/** The registry is missing or refused. Always loud: no panel can be drawn without it. */
export class RegistryError extends Error {
  override name = 'RegistryError';
}

/** Loads and validates <root>/config/judges.yaml. Refuses unpinned model IDs, unknown keys and duplicates. */
export function loadJudgeRegistry(root: string, file = REGISTRY_FILE): LoadedRegistry {
  const path = join(root, file);
  if (!existsSync(path)) throw new RegistryError(`${file} does not exist; the runner draws every panel from it`);
  let doc: unknown;
  try {
    doc = parse(readFileSync(path, 'utf8'), { schema: 'core', merge: false, uniqueKeys: true, customTags: [] });
  } catch (e) {
    throw new RegistryError(`${file}: not valid YAML (${(e as Error).message.slice(0, 120)})`);
  }
  const r = loadRegistry(doc);
  if (!r.ok) throw new RegistryError(`${file}: ${r.error.detail}`);
  return r.value;
}

/** The adjudicator policy the runner binds: apps/adjudicator defaultPolicy with this build's templates. */
export function runnerPolicy(id: string): AdjudicatorPolicy {
  return {
    id,
    panelSize: 3,
    appealPanelSize: 5,
    minFamilies: 2,
    minFamiliesAppeal: 3,
    minValid: 2,
    minValidAppeal: 4,
    acceptSupermajority: { numerator: 2, denominator: 3 },
    rejectSupermajority: { numerator: 2, denominator: 3 },
    judgeTimeoutSec: 60,
    rationaleMaxChars: 600,
    promptTemplateHash: PROMPT_TEMPLATE_HASH,
    appealPromptTemplateHash: APPEAL_PROMPT_TEMPLATE_HASH,
    aggregationVersion: AGGREGATION_VERSION,
    screenVersion: SCREEN_VERSION,
    providerPrivacy: 'standard',
    disclosureMin: 'public',
  };
}

export const policyHashOf = (policy: AdjudicatorPolicy): Hex32 => canonicalKeccak(policy);
