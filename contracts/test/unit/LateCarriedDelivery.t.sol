// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-206 M-2: a decision that carries the delivery lands it on chain, so the delivery must meet deliverBy then,
/// as `deliver` does. Otherwise a late delivery races the buyer's reclaim (SimChain refuses it at deliverBy).
contract LateCarriedDeliveryTest is Base {
    function _carried(H.Terms memory t, bytes32 id, uint8 outcome)
        internal
        view
        returns (H.Decision memory m, H.Delivery memory dv, bytes memory sig)
    {
        (dv,) = _delivery();
        sig = _deliverySig(id, dv, SELLER_PK);
        m = _primary(t, id, outcome);
    }

    function test_acceptCarryingADelivery_refusedFromDeliverBy() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Decision memory m, H.Delivery memory dv, bytes memory sig) = _carried(t, id, H.OUTCOME_ACCEPT);
        vm.warp(t.timing.deliverBy);
        vm.expectRevert(HoldbackRules.DeadlinePassed.selector);
        rules.decide(t, m, dv, sig);
        rules.reclaim(t);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
    }

    function test_escalateCarryingADelivery_refusedFromDeliverBy() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Decision memory m, H.Delivery memory dv, bytes memory sig) = _carried(t, id, H.OUTCOME_ESCALATE);
        vm.warp(t.timing.deliverBy);
        vm.expectRevert(HoldbackRules.DeadlinePassed.selector);
        rules.decide(t, m, dv, sig);
    }

    function test_carriedDeliveryBeforeDeliverBy_settles() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Decision memory m, H.Delivery memory dv, bytes memory sig) = _carried(t, id, H.OUTCOME_ACCEPT);
        vm.warp(t.timing.deliverBy - 1);
        rules.decide(t, m, dv, sig);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
    }

    /// A delivery posted before deliverBy may be judged until judgeBy.
    function test_postedDelivery_judgedAfterDeliverBy() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        vm.warp(t.timing.deliverBy);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
    }

    /// The buyer may still accept a late delivery itself: it is the buyer's own deadline to waive.
    function test_earlyAcceptCarryingALateDelivery_isTheBuyersChoice() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory dv, H.KeyProof memory k) = _delivery();
        bytes memory sig = _deliverySig(id, dv, SELLER_PK);
        H.EarlyAccept memory m = H.EarlyAccept({attempt: 1, nonce: 0, expiresAt: type(uint64).max, signature: ""});
        m.signature = _sign(BUYER_PK, hx.early(id, buyer, m));
        vm.warp(t.timing.deliverBy);
        rules.earlyAccept(t, m, dv, sig, k);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
    }
}
