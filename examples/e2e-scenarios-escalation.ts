// Round 1's escalation group (T-216): the scenarios where the primary escalates and the appeal adjudicator decides
// alone, or the default outcome applies (docs/api.md, Escalation). e2e-scenarios.ts registers this list; its tests go
// in e2e-scenarios-escalation.test.ts.
import { waiting, type Scenario } from './e2e-scenario-kit.ts';

export const ESCALATION: Scenario[] = [
  waiting('5a', 'Escalation, then the default outcome (API)', [], 'a checks-only delivery that exhausts the check work budget on purpose, so the primary escalates with no panel; try it on a fork first (T-216, scenario 5)'),
  waiting('5b', 'Escalation decided by the appeal adjudicator (API)', ['T-217'], 'a rubric delivery that trips the screen without being an attack fixture, so the primary escalates (D27c); then the five-seat appeal panel with a drand proof'),
];
