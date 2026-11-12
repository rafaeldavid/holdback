// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {IHoldbackRules} from "../../src/IHoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-206 H-2: a decision carries the buyer's key only with an accept, and never on a deal that stands Refunded
/// (ADR-0012: "on rejection or reclaim, the key is never released to the buyer"; formal model KeyOnlyWithPayment).
contract AppealKeyTest is Base {
    function _appealDecision(H.Terms memory t, bytes32 id, uint64 round, uint8 outcome, bool withKey)
        internal
        view
        returns (H.Decision memory m)
    {
        m = _beaconDecision(id, H.ROLE_APPEAL, outcome, round);
        (m.keyScheme, m.keyCiphertext) = withKey ? (KEY_SCHEME, KEY_CT) : ("", "");
        m = _signDecision(t, id, m, appealAdj, AP_PK);
    }

    // ------------------------------------------------------------ decisions that move the escrow

    function test_firstInstanceReject_refusesAKey() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        H.Decision memory m = _decision(H.ROLE_PRIMARY, H.OUTCOME_REJECT);
        (m.keyScheme, m.keyCiphertext) = (KEY_SCHEME, KEY_CT);
        m = _signDecision(t, id, m, adjudicator, ADJ_PK);
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    function test_escalatedReject_refusesAKey() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        uint64 round = uint64(rules.dealOf(id).t1) + 1;
        vm.warp(round);
        H.Decision memory m = _appealDecision(t, id, round, H.OUTCOME_REJECT, true);
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
    }
}
