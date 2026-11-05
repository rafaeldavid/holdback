// Round 1's silent-adjudicator group (T-216): the scenarios where the round's own adjudicator accepts a deal and then
// never decides (e2e-adjudicator.ts, `serve(r, 'silent')`), so a timeout, the fallback, an early accept or a mutual
// settlement can land first. e2e-scenarios.ts registers this list; its tests go in e2e-scenarios-silent.test.ts.
import { waiting, type Scenario } from './e2e-scenario-kit.ts';

export const SILENT: Scenario[] = [
  waiting('3b', 'Timeouts: the default outcome when primary and fallback are silent (API)', ['T-221'], "the round's own primary and fallback adjudicators, registered through the API, that accept and never decide (e2e-adjudicator, after T-221 merges)"),
  waiting('4', 'Fallback when the primary is silent (API)', ['T-217', 'T-221'], "the round's own silent primary with demo fallback and appeal adjudicators; then check the fallback decision's beacon is drand-quicknet at the round of judgeBy"),
  waiting('9', 'Early accept before the primary decides (API)', ['T-221'], "the round's own silent primary; the buyer opens its envelope from the seller's signed delivery and accepts early (agent.earlyAccept); a later decision by the primary is refused"),
  waiting('10b', 'Mutual settlement after delivery (API)', ['T-221'], "the round's own silent primary, so the settlement lands before a decision; releaseKey true, and the key reaches the buyer"),
];
