// The judge registry and adjudicator policy the runner binds into every commitment it drives.
// The registry is config/judges.yaml, the same file the adjudicator service loads, so snapshots
// show its pinned model IDs. The policy mirrors the adjudicator service's defaults (apps/adjudicator
// policy.ts): panel of three over two families, appeal panel of five over three, this build's templates.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdjudicatorPolicy } from '@holdback/core';
import { loadRegistry, NEWEST_VERSIONS, type LoadedRegistry, type PolicyVersions } from '@holdback/judgment';
import { parse } from 'yaml';

export const REGISTRY_FILE = 'config/judges.yaml';

/**
 * The registry files the adjudicator build carries (ADR-0036): apps/adjudicator/src/kept-policies.json's kept entries.
 * The runner judges a deal under the one its terms bind.
 */
export function keptRegistryFiles(root: string): string[] {
  const path = join(root, 'apps/adjudicator/src/kept-policies.json');
  if (!existsSync(path)) return [REGISTRY_FILE];
  const doc = JSON.parse(readFileSync(path, 'utf8')) as { registries?: Array<{ file?: unknown; status?: unknown }> };
  return (doc.registries ?? []).filter((r) => r.status === 'kept' && typeof r.file === 'string').map((r) => r.file as string);
}

/**
 * The default versions of the adjudicator build (ADR-0036): kept-policies.json's `default`, which a primary accepts new
 * deals under. It can differ from the newest code while a new version ships "carried first, default second".
 */
export function buildDefaultVersions(root: string): PolicyVersions {
  const path = join(root, 'apps/adjudicator/src/kept-policies.json');
  if (!existsSync(path)) return NEWEST_VERSIONS;
  const d = (JSON.parse(readFileSync(path, 'utf8')) as { default?: PolicyVersions }).default;
  return d ? { screenVersion: d.screenVersion, promptTemplateHash: d.promptTemplateHash, appealPromptTemplateHash: d.appealPromptTemplateHash, aggregationVersion: d.aggregationVersion } : NEWEST_VERSIONS;
}

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

/**
 * The adjudicator policy the runner binds: apps/adjudicator defaultPolicy, with the versions of the build the
 * adjudicators run (ADR-0036; the newest unless a restart_adjudicators step names another).
 */
export function runnerPolicy(id: string, versions: PolicyVersions = NEWEST_VERSIONS): AdjudicatorPolicy {
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
    promptTemplateHash: versions.promptTemplateHash,
    appealPromptTemplateHash: versions.appealPromptTemplateHash,
    aggregationVersion: versions.aggregationVersion,
    screenVersion: versions.screenVersion,
    providerPrivacy: 'standard',
    disclosureMin: 'public',
  };
}
