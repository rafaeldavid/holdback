// Reads config/judges.yaml (or another adjudicator's registry) into the judgment registry loader.
import { readFileSync } from 'node:fs';
import { err, problem, type Hex32, type Problem, type Result } from '@holdback/core';
import { loadRegistry, type LoadedRegistry } from '@holdback/judgment';
import { parse } from 'yaml';

export function loadRegistryYaml(text: string, expectedHash?: Hex32): Result<LoadedRegistry, Problem> {
  let doc: unknown;
  try {
    // Plain data only: no custom tags, no merge keys, unique keys.
    doc = parse(text, { schema: 'core', merge: false, uniqueKeys: true, customTags: [] });
  } catch (e) {
    return err(problem('invalid_terms', `registry: not valid YAML (${(e as Error).message.slice(0, 120)})`));
  }
  return loadRegistry(doc, expectedHash);
}

export const loadRegistryFile = (path: string, expectedHash?: Hex32) => loadRegistryYaml(readFileSync(path, 'utf8'), expectedHash);
