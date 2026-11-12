// ADR-0036 section 6: the record replay, and attack.kept-version-drift. Each kept policy, on each read path, rebuilds
// the record recorded when the version was new (fixtures/replay/kept-policies.json). A changed filter, sampler or
// screen under an unchanged label fails it.
import { readFileSync } from 'node:fs';
import { aggregate, KEPT, parseVerdict, type KeptTable } from '@holdback/judgment';
import { describe, expect, it } from 'vitest';
import { keptPolicies, READ_PATHS, replay } from './replay.js';

const RECORDED = JSON.parse(readFileSync(new URL('../../../fixtures/replay/kept-policies.json', import.meta.url), 'utf8')) as { records: Record<string, string> };

describe('the record replay: a kept version never changes under its label', () => {
  for (const { label, versions } of keptPolicies()) {
    for (const path of READ_PATHS) {
      it(`${label} on the ${path} read path rebuilds its recorded record`, async () => {
        const { hash } = await replay(versions, path);
        const key = `${label}/${path}`;
        // A new version records its hash here once, in the change that adds it; a kept one never changes it.
        expect(RECORDED.records[key], `no recorded record for ${key}; a new version adds "${key}": "${hash}"`).toBeDefined();
        expect(hash, `${key} drifted under its label: make the change a new version`).toBe(RECORDED.records[key]);
      });
    }
  }

  it('records nothing for a version the build no longer keeps, so a dropped version cannot pass silently', () => {
    const live = new Set(keptPolicies().flatMap(({ label }) => READ_PATHS.map((p) => `${label}/${p}`)));
    expect(Object.keys(RECORDED.records).filter((k) => !live.has(k))).toEqual([]);
  });

  it('the read paths are what they say: whole, seeded, stride, and the appeal template', async () => {
    const v = keptPolicies().find((p) => p.versions.screenVersion === 'screen-1')!.versions;
    const sampling = async (path: (typeof READ_PATHS)[number]) => (await replay(v, path)).view.panel.members.map((m) => m.inputHash);
    expect(new Set(await sampling('whole')).size).toBe(3);
    const appeal = await replay(v, 'appeal');
    expect(appeal.view.panel.template).toBe('appeal');
    expect(appeal.view.panel.members).toHaveLength(5);
  });
});

describe('attack.kept-version-drift: the replay fails on a changed filter, sampler or screen under an unchanged label', () => {
  const screen1 = KEPT.screens.get('screen-1')!;
  const screen0 = KEPT.screens.get('screen-0')!;
  const with1 = (over: Partial<typeof screen1>): KeptTable => ({ ...KEPT, screens: new Map([...KEPT.screens, ['screen-1', { ...screen1, ...over }]]) });
  const v1 = keptPolicies().find((p) => p.versions.screenVersion === 'screen-1')!.versions;
  const recorded = (path: string) => RECORDED.records[`${keptPolicies().find((p) => p.versions.screenVersion === 'screen-1')!.label}/${path}`];

  it('a screen that flags one thing fewer', async () => {
    const drifted = with1({ screen: (i) => ({ ...screen1.screen(i), flagged: false, signals: [] }) });
    expect((await replay(v1, 'whole', drifted)).hash).not.toBe(recorded('whole'));
  });

  it("screen-0's screen swapped in under screen-1's label", async () => {
    expect((await replay(v1, 'whole', with1({ screen: screen0.screen }))).hash).not.toBe(recorded('whole'));
  });

  it("a sampler that reads one line fewer (screen-0's sampler under screen-1's label)", async () => {
    expect((await replay(v1, 'stride', with1({ stride: screen0.stride }))).hash).not.toBe(recorded('stride'));
  });

  it('a verdict filter that drops a judge it used to keep', async () => {
    const agg = KEPT.aggregations.get('agg-3')!;
    const drifted: KeptTable = {
      ...KEPT,
      aggregations: new Map([['agg-3', { ...agg, parseVerdict: (raw, o) => (raw.includes('fixed fail') ? { status: 'abstain', reason: 'schema' } : parseVerdict(raw, o)) as ReturnType<typeof parseVerdict> }]]),
    };
    expect((await replay(v1, 'whole', drifted)).hash).not.toBe(recorded('whole'));
  });

  it('an aggregation rule that leaves out one verdict', async () => {
    const agg = KEPT.aggregations.get('agg-3')!;
    const drifted: KeptTable = { ...KEPT, aggregations: new Map([['agg-3', { ...agg, aggregate: (i) => aggregate({ ...i, verdicts: i.verdicts.slice(1) }) }]]) };
    expect((await replay(v1, 'seeded', drifted)).hash).not.toBe(recorded('seeded'));
  });
});
