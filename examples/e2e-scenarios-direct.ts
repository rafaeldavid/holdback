// Round 1's direct group (T-216): the scenarios that go past the operators or past a relay in flight: direct contract
// calls on API deals (the escape hatch, ADR-0005), and a restart between a relayed broadcast and its receipt.
// e2e-scenarios.ts registers this list; its tests go in e2e-scenarios-direct.test.ts.
import { waiting, type Scenario } from './e2e-scenario-kit.ts';

export const DIRECT: Scenario[] = [
  waiting('8', 'The escape hatch: direct calls on API deals', ['T-218', 'T-217', 'T-221'], 'direct agreeAndFund (the acceptance from adjudicator.accepted, the ERC-3009 funding signature) and direct deliver, with the delivery then posted to an operator; a direct reclaim (3a covers the call); a direct triggerFallback over the round\'s silent primary; check submittedVia "direct" with the transaction on both operators within one pass'),
  waiting('11', 'A restart between broadcast and receipt (live holdback-op1 redeploy)', ['T-219'], "the driver pauses after a relayed broadcast and before its receipt; Rafa redeploys holdback-op1 with the same code at that moment; then check the step's events and the buyer's key are served"),
];
