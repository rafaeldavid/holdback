// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {IHoldbackRules} from "../../src/IHoldbackRules.sol";
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
/// now < fundBy). Before SC-5 it reached the chain by direct submission with the buyer's signature (D32); since SC-5
/// (T-356, ADR-0031 §6, the hunt's L-8) the contract refuses terms out of order too, so the attack is closed on chain:
/// a `judgeBy` at or before funding means `judgeBy <= fundBy`, which `agreeAndFund` refuses.
contract KnownSeedFallbackTest is Base {
    function _pastJudgeBy() internal returns (H.Terms memory t) {
        t = _terms();
        t.timing.judgeBy = uint64(block.timestamp) - 1; // already passed when the terms are signed
    }

    /// Closed by SC-5: before anyone signs or funds, the beacon already serves the round, so the fallback's seed would
    /// be computable. Such terms put judgeBy before fundBy, and funding them is now refused, with nothing stored.
    function test_defense_judgeByInThePast_fallbackSeedKnownBeforeFunding_refusedAtFunding() public {
        H.Terms memory t = _pastJudgeBy();
        bytes32 id = hx.id(t);
        uint64 round = sim.roundAt(t.timing.judgeBy);
        // The beacon already serves the round (it refuses a future one: the control test below), so the seed would be
        // public before funding: the reason such terms must not fund.
        sim.beaconValue(round, "");
        bytes memory ss = _sellerSig(t, SELLER_PK);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.agreeAndFund(t, ss, acc, ag, f);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.None));
    }

    /// Closed by SC-5: the offering party could grind `nonce` until the fallback seed had a property it wanted (here a
    /// zero first byte, standing in for "a panel that favours me"). Every candidate still puts judgeBy before fundBy,
    /// so the ground terms are refused at funding like any other.
    function test_defense_judgeByInThePast_groundSeed_refusedAtFunding() public {
        H.Terms memory t = _pastJudgeBy();
        bytes32 value = sim.beaconValue(sim.roundAt(t.timing.judgeBy), "");
        uint256 tries;
        for (;; ++tries) {
            t.nonce = keccak256(abi.encode("grind", tries));
            if (uint8(hx.panelSeed(hx.id(t), H.ROLE_FALLBACK, 1, value)[0]) == 0) break;
            assertLt(tries, 4096, "a 1-in-256 property should be found quickly");
        }
        bytes memory ss = _sellerSig(t, SELLER_PK);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.agreeAndFund(t, ss, acc, ag, f);
        assertEq(uint8(_stage(hx.id(t))), uint8(IHoldbackRules.Stage.None));
    }

    /// Control: with judgeBy in the future the sim beacon refuses the round, so no seed exists at signing.
    function test_defense_judgeByInTheFuture_seedUnknownAtSigning() public {
        H.Terms memory t = _terms();
        uint64 round = sim.roundAt(t.timing.judgeBy);
        vm.expectRevert();
        sim.beaconValue(round, "");
    }
}
