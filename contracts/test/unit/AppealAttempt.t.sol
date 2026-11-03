// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-206 finding 1: the appeal adjudicator's panel seed is panelSeed(id, role, attempt, beaconValue), so the
/// attempt must be the delivery's, as it is for the fallback. Otherwise the decider picks one of 256 seeds for a
/// final decision (ADR-0018: no field the decider controls may change the seed).
contract AppealAttemptTest is Base {
    function _escalated() internal returns (H.Terms memory t, bytes32 id, uint64 at) {
        (t, id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        at = uint64(block.timestamp);
        vm.warp(at + 1); // the appeal round is the first one after the escalation
    }

    function _partyAppeal() internal returns (H.Terms memory t, bytes32 id, uint64 at) {
        (t, id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        vm.prank(buyer);
        usdc.approve(address(bonds), type(uint256).max);
        H.Appeal memory a =
            H.Appeal({appellant: 0, groundsHash: keccak256("g"), bond: 1_000, filedAt: 0, signature: ""});
        a.signature = _sign(BUYER_PK, hx.appeal(id, buyer, t.token, a));
        rules.fileAppeal(t, a);
        at = uint64(block.timestamp);
        vm.warp(at + 1); // the appeal round is the first one after the filing
    }

    /// A decision whose seed is the valid panel seed for `attempt`, signed by the appeal adjudicator.
    function _appealDecision(H.Terms memory t, bytes32 id, uint64 round, uint8 attempt)
        internal
        view
        returns (H.Decision memory m)
    {
        m = _beaconDecision(id, H.ROLE_APPEAL, H.OUTCOME_REJECT, round);
        m.attempt = attempt;
        m.seed = hx.panelSeed(id, H.ROLE_APPEAL, attempt, m.beaconValue);
        m = _signDecision(t, id, m, appealAdj, AP_PK);
    }

    function test_afterEscalation_refusesASeedFromAnotherAttempt() public {
        (H.Terms memory t, bytes32 id, uint64 at) = _escalated();
        H.Decision memory m = _appealDecision(t, id, at + 1, 2);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    function test_afterPartyAppeal_refusesASeedFromAnotherAttempt() public {
        (H.Terms memory t, bytes32 id, uint64 at) = _partyAppeal();
        H.Decision memory m = _appealDecision(t, id, at + 1, 2);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    function test_afterEscalation_decidesWithTheDeliveryAttempt() public {
        (H.Terms memory t, bytes32 id, uint64 at) = _escalated();
        rules.decide(t, _appealDecision(t, id, at + 1, 1), _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
    }

    function test_afterPartyAppeal_decidesWithTheDeliveryAttempt() public {
        (H.Terms memory t, bytes32 id, uint64 at) = _partyAppeal();
        rules.decide(t, _appealDecision(t, id, at + 1, 1), _noDelivery(), "");
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Overturned));
    }
}
