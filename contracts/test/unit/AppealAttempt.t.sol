// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {IHoldbackRules} from "../../src/IHoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-206 H-1: every decision names the delivered attempt. The fallback and appeal seed is
/// panelSeed(id, role, attempt, beaconValue), so a free attempt would let the decider pick one of 256 seeds
/// (ADR-0018: no field the decider controls may change the seed). Rounds are read from the deal, because
/// block.timestamp is not re-read after a warp under via_ir.
contract AppealAttemptTest is Base {
    function _escalated() internal returns (H.Terms memory t, bytes32 id, uint64 round) {
        (t, id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        round = uint64(rules.dealOf(id).t1) + 1; // the first round after the escalation
        vm.warp(round);
    }

    /// A decision whose seed is the valid panel seed for `attempt`, signed by the role's adjudicator.
    function _beaconAttempt(H.Terms memory t, bytes32 id, uint8 role, uint64 round, uint8 attempt)
        internal
        view
        returns (H.Decision memory m)
    {
        m = _beaconDecision(id, role, H.OUTCOME_REJECT, round);
        m.attempt = attempt;
        m.seed = hx.panelSeed(id, role, attempt, m.beaconValue);
        (address who, uint256 pk) = role == H.ROLE_FALLBACK ? (fallbackAdj, FB_PK) : (appealAdj, AP_PK);
        m = _signDecision(t, id, m, who, pk);
    }

    function test_afterEscalation_refusesASeedFromAnotherAttempt() public {
        (H.Terms memory t, bytes32 id, uint64 round) = _escalated();
        H.Decision memory m = _beaconAttempt(t, id, H.ROLE_APPEAL, round, 2);
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    function test_fallback_refusesASeedFromAnotherAttempt() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        H.Decision memory m = _beaconAttempt(t, id, H.ROLE_FALLBACK, t.timing.judgeBy, 2);
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    function test_primary_refusesAnotherAttempt() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        H.Decision memory m = _decision(H.ROLE_PRIMARY, H.OUTCOME_ACCEPT);
        m.attempt = 2;
        m = _signDecision(t, id, m, adjudicator, ADJ_PK);
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    function test_primaryCarryingTheDelivery_refusesAnotherAttempt() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory dv,) = _delivery();
        bytes memory sig = _deliverySig(id, dv, SELLER_PK);
        H.Decision memory m = _decision(H.ROLE_PRIMARY, H.OUTCOME_ACCEPT);
        m.attempt = 2;
        m = _signDecision(t, id, m, adjudicator, ADJ_PK);
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, dv, sig);
    }

    function test_afterEscalation_decidesWithTheDeliveryAttempt() public {
        (H.Terms memory t, bytes32 id, uint64 round) = _escalated();
        rules.decide(t, _beaconAttempt(t, id, H.ROLE_APPEAL, round, 1), _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Refunded));
    }
}
