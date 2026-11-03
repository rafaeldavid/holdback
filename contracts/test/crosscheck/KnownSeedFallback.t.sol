// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "../unit/Base.sol";

/// Red-team cross-check of X1 ("rounds are fixed by state and proven by BLS") against the retroactive-parameter class
/// (UMA DVM 2.0; UMA Early Resolver #4 "the first proposer fixes the settings"). The fallback's round is
/// `roundAt(judgeBy)`, a term. The contract accepts a `judgeBy` at or before the funding time (D31: any order), and
/// then the beacon value at that round is already public when the terms are written. The seed becomes a pure
/// function of the terms, which the offering party can grind through `nonce`; the primary can never decide
/// (`judgeBy` has passed) and the fallback takes over at once.
///
/// The reference path refuses this shape (`packages/core/src/timing.ts` requires fundBy < judgeBy and funding needs
/// now < fundBy), so it reaches the chain only by direct submission with the buyer's signature (D32).
contract KnownSeedFallbackTest is Base {
    function _pastJudgeBy() internal returns (H.Terms memory t) {
        t = _terms();
        t.timing.judgeBy = uint64(block.timestamp) - 1; // already passed when the terms are signed
    }

    function test_attack_judgeByInThePast_fallbackSeedIsKnownBeforeFunding() public {
        H.Terms memory t = _pastJudgeBy();
        bytes32 id = hx.id(t);
        uint64 round = sim.roundAt(t.timing.judgeBy);

        // Before anyone signs or funds, the beacon already serves the round and the seed is computable.
        bytes32 value = sim.beaconValue(round, "");
        bytes32 seedAtSigning = hx.panelSeed(id, H.ROLE_FALLBACK, 1, value);

        _fund(t);
        _deliver(t, id);
        // The primary never gets a turn.
        H.Decision memory p = _primary(t, id, H.OUTCOME_ACCEPT);
        vm.expectRevert(HoldbackRules.DeadlinePassed.selector);
        rules.decide(t, p, _noDelivery(), "");
        // The fallback is triggerable in the funding block and decides with the seed known at signing.
        rules.triggerFallback(t);
        H.Decision memory m = _beaconDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, round);
        assertEq(m.seed, seedAtSigning, "the fallback's seed equals the one computable before funding");
        rules.decide(t, _signDecision(t, id, m, fallbackAdj, FB_PK), _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
    }

    /// The offering party grinds `nonce` until the fallback seed has a property it wants (here: a zero first byte,
    /// standing in for "a panel that favours me"). Every candidate is a valid set of terms.
    function test_attack_judgeByInThePast_termsAuthorGrindsTheFallbackSeed() public {
        H.Terms memory t = _pastJudgeBy();
        bytes32 value = sim.beaconValue(sim.roundAt(t.timing.judgeBy), "");
        uint256 tries;
        bytes32 seed;
        for (;; ++tries) {
            t.nonce = keccak256(abi.encode("grind", tries));
            seed = hx.panelSeed(hx.id(t), H.ROLE_FALLBACK, 1, value);
            if (uint8(seed[0]) == 0) break;
            assertLt(tries, 4096, "a 1-in-256 property should be found quickly");
        }
        bytes32 id = _fund(t);
        _deliver(t, id);
        rules.triggerFallback(t);
        H.Decision memory m = _beaconDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, sim.roundAt(t.timing.judgeBy));
        assertEq(m.seed, seed);
        assertEq(uint8(m.seed[0]), 0, "the chosen property survived into the on-chain seed");
        rules.decide(t, _signDecision(t, id, m, fallbackAdj, FB_PK), _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
    }

    /// Control: with judgeBy in the future the sim beacon refuses the round, so no seed exists at signing.
    function test_defense_judgeByInTheFuture_seedUnknownAtSigning() public {
        H.Terms memory t = _terms();
        uint64 round = sim.roundAt(t.timing.judgeBy);
        vm.expectRevert();
        sim.beaconValue(round, "");
    }
}
