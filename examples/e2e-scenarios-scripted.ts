// Round 1's scripted-adjudicator group (T-216): the scenarios where the round's own primary decides the outcome the
// scenario gives it, a wrong one included (e2e-adjudicator.ts, `serve(r, { decide })`). e2e-scenarios.ts registers
// this list; its tests go in e2e-scenarios-scripted.test.ts.
import { waiting, type Scenario } from './e2e-scenario-kit.ts';

export const SCRIPTED: Scenario[] = [
  waiting('3c', 'Timeouts: appeal expiry when the appeal adjudicator is silent (API)', ['T-221'], "the round's own primary deciding by script and its own silent appeal adjudicator; the appellant's bond approval from its own Sepolia ETH"),
  waiting('7', 'Appeal overturned both ways, paid from the first decider\'s bond (API)', ['T-217', 'T-221'], "the round's own primary, registered and bonded, deciding wrongly by script (accept failing work; reject passing work); a demo appeal adjudicator overturns; check BondSlashed pays the appellant the price"),
];
