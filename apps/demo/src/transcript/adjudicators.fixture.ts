// A small beat-1 fixture for render and untrusted-text tests (T-017): the proposal and agreement steps and four
// adjudicator profiles. `name` replaces the declined listing's name, so a test can make it hostile. Not a test
// file itself; the real beat-1 transcript is checked in source/simchain.test.ts.
import type { AdjudicatorProfile, BeatTranscript, DemoEvent } from './types.js';

const tusd = (whole: bigint) => ({ token: 'tUSD', amount: (whole * 1_000_000n).toString() });

function profile(name: string, selected: AdjudicatorProfile['selected'], who?: AdjudicatorProfile['who']): AdjudicatorProfile {
  return {
    ...(who ? { who } : {}),
    name,
    tagline: `${name} tagline`,
    roles: selected === 'declined' ? ['primary'] : [selected],
    selected,
    ...(selected === 'declined' ? { declinedBecause: [`${name}: panel of 1 judge; the rulebook requires at least 3 (panelPolicyMin.panelSize)`] } : {}),
    judges: [{ id: 'gpt-a', model: 'placeholder-gpt-a-20260601', family: 'gpt', effort: `${name} effort` }],
    harness: [`${name} harness`],
    terms: [
      { label: 'Fee', value: '50 tUSD' },
      { label: 'Bond', value: '25,000 tUSD' },
    ],
    history: { rolePlay: true, lines: [`${name} history, 1,204 cases`] },
  };
}

export function withAdjudicators(t: BeatTranscript, name = 'Swiftline Verdicts'): BeatTranscript {
  const steps: DemoEvent[] = [
    {
      kind: 'adjudicator-proposal',
      atMs: 0,
      actor: 'buyer',
      registrations: 4,
      rules: ['panels of at least 3 judges from at least 2 model families (panelPolicyMin)', `free bond of at least ${tusd(2000n).amount} base units`],
      considered: [
        { name: 'Clearfield Adjudication', who: 'benchA', eligible: true, reasons: [] },
        { name, eligible: false, reasons: [`${name}: draws from 1 model family; the rulebook requires at least 2 (panelPolicyMin.minFamilies)`] },
      ],
      proposed: { primary: 'benchA', fallback: 'benchB', appeal: 'benchC' },
    },
    { kind: 'adjudicator-agreement', atMs: 1, actor: 'seller', agreed: { primary: 'benchA', fallback: 'benchB', appeal: 'benchC' }, checks: ['free bond at least 2,000 tUSD'] },
  ];
  return {
    ...t,
    events: [...steps, ...t.events],
    adjudicators: [profile('Clearfield Adjudication', 'primary', 'benchA'), profile('Northgate Review', 'fallback', 'benchB'), profile('Atrium Appeals', 'appeal', 'benchC'), profile(name, 'declined')],
  };
}
