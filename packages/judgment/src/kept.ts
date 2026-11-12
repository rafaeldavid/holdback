// The versions this build keeps (ADR-0036 section 1): every screen version, template pair and aggregation version a released
// build registered, selected by the values a deal's bound policy names. A kept version is frozen in behaviour: a fix
// that changes what it flags or decides is a new version under a new label, and the replay
// (packages/testkit/src/replay.ts) holds each one to the results recorded when it was new. A version leaves this table
// only by a reviewed retirement that shows no open deal binds it (apps/adjudicator/src/kept-policies.json).
//
// What each value covers:
// - screenVersion: everything between the delivered bytes and the prompt the screen reads (normalization, the screen,
//   the read limit, the sampling, the rendering of the data section);
// - the two template hashes: the template text;
// - aggregationVersion: the verdict filter, the aggregation rule and signedOutcome.
import type { AdjudicatorPolicy, Hex32 } from '@holdback/core';
import { err, ok, type Result } from '@holdback/core';
import { aggregate, AGGREGATION_VERSION, preDecision, signedOutcome } from './aggregate.js';
import * as screen0 from './kept/screen-0.js';
import { strideSample0 } from './kept/stride-0.js';
import { strideSample1, TEMPLATE_PAIR, type StrideSampler, type TemplatePair } from './prompt.js';
import { screen, screenTerms, SCREEN_VERSION, type ScreenInput, type ScreenResult } from './screen.js';
import { parseVerdict } from './verdict.js';

export interface ScreenImpl {
  screen(input: ScreenInput): ScreenResult;
  /** The signals in the party-written terms the judges read. */
  screenTerms(texts: readonly string[]): ScreenResult['signals'];
  /** How it reads a deliverable over the budget without a seed. */
  stride: StrideSampler;
}

export interface AggregationImpl {
  parseVerdict: typeof parseVerdict;
  preDecision: typeof preDecision;
  aggregate: typeof aggregate;
  signedOutcome: typeof signedOutcome;
}

/** What a build carries, by label (and the template pairs by their two hashes). */
export interface KeptTable {
  screens: ReadonlyMap<string, ScreenImpl>;
  templatePairs: readonly TemplatePair[];
  aggregations: ReadonlyMap<string, AggregationImpl>;
}

/** The four policy values that name implementations. */
export type PolicyVersions = Pick<AdjudicatorPolicy, 'screenVersion' | 'promptTemplateHash' | 'appealPromptTemplateHash' | 'aggregationVersion'>;

/** The implementations a policy's values name. */
export interface PolicyImpl {
  versions: PolicyVersions;
  screen: ScreenImpl;
  templates: TemplatePair;
  aggregation: AggregationImpl;
}

const SCREEN_1: ScreenImpl = { screen, screenTerms, stride: strideSample1 };
const SCREEN_0: ScreenImpl = { screen: screen0.screen, screenTerms: screen0.screenTerms, stride: strideSample0 };
const AGG_3: AggregationImpl = { parseVerdict, preDecision, aggregate, signedOutcome };

export const KEPT: KeptTable = {
  screens: new Map([
    [screen0.SCREEN_VERSION, SCREEN_0],
    [SCREEN_VERSION, SCREEN_1],
  ]),
  templatePairs: [TEMPLATE_PAIR],
  aggregations: new Map([[AGGREGATION_VERSION, AGG_3]]),
};

/** The newest version of each: what a new build offers as its default unless its kept-policies file says otherwise. */
export const NEWEST_VERSIONS: PolicyVersions = {
  screenVersion: SCREEN_VERSION,
  promptTemplateHash: TEMPLATE_PAIR.firstHash,
  appealPromptTemplateHash: TEMPLATE_PAIR.appealHash,
  aggregationVersion: AGGREGATION_VERSION,
};

const short = (h: Hex32) => `${h.slice(0, 10)}...`;

/** The labels and hashes a table carries, for a data file or a guard to compare with. */
export function keptLabels(kept: KeptTable = KEPT): { screens: string[]; templatePairs: Array<{ promptTemplateHash: Hex32; appealPromptTemplateHash: Hex32 }>; aggregations: string[] } {
  return {
    screens: [...kept.screens.keys()],
    templatePairs: kept.templatePairs.map((p) => ({ promptTemplateHash: p.firstHash, appealPromptTemplateHash: p.appealHash })),
    aggregations: [...kept.aggregations.keys()],
  };
}

/**
 * The implementations the four values name, or the first one this build does not carry ("this build does not carry
 * screen-0"). Never another version in its place.
 */
export function implementationsFor(v: PolicyVersions, kept: KeptTable = KEPT): Result<PolicyImpl, string> {
  const s = kept.screens.get(v.screenVersion);
  if (!s) return err(`this build does not carry screen ${JSON.stringify(String(v.screenVersion).slice(0, 40))}`);
  const templates = kept.templatePairs.find((p) => p.firstHash === v.promptTemplateHash && p.appealHash === v.appealPromptTemplateHash);
  if (!templates) return err(`this build does not carry the template pair ${short(v.promptTemplateHash)} / ${short(v.appealPromptTemplateHash)}`);
  const aggregation = kept.aggregations.get(v.aggregationVersion);
  if (!aggregation) return err(`this build does not carry aggregation ${JSON.stringify(String(v.aggregationVersion).slice(0, 40))}`);
  return ok({ versions: { screenVersion: v.screenVersion, promptTemplateHash: v.promptTemplateHash, appealPromptTemplateHash: v.appealPromptTemplateHash, aggregationVersion: v.aggregationVersion }, screen: s, templates, aggregation });
}
