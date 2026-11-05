// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-206 M-2: whichever call lands the delivery (deliver, or a decision or early accept carrying it), it must land
/// before deliverBy. Otherwise a late delivery races the buyer's reclaim (SimChain refuses it at deliverBy).
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

    /// A late reject would also have beaten the reclaim, and cost the buyer the fee.
    function test_rejectCarryingADelivery_refusedFromDeliverBy() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Decision memory m, H.Delivery memory dv, bytes memory sig) = _carried(t, id, H.OUTCOME_REJECT);
        vm.warp(t.timing.deliverBy);
        vm.expectRevert(HoldbackRules.DeadlinePassed.selector);
        rules.decide(t, m, dv, sig);
        uint256 b0 = usdc.balanceOf(buyer);
        rules.reclaim(t);
        assertEq(usdc.balanceOf(buyer), b0 + PRICE + FEE, "price and fee back");
    }

    /// A late escalation would have turned a reclaimable hold into an appeal case.
    function test_escalateCarryingADelivery_refusedFromDeliverBy() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Decision memory m, H.Delivery memory dv, bytes memory sig) = _carried(t, id, H.OUTCOME_ESCALATE);
        vm.warp(t.timing.deliverBy);
        vm.expectRevert(HoldbackRules.DeadlinePassed.selector);
        rules.decide(t, m, dv, sig);
        rules.reclaim(t);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
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

    /// An early accept carries the delivery under the same deadline, so a late delivery cannot beat the buyer's
    /// reclaim, even one the buyer opened and named (ADR-0029).
    function test_earlyAcceptCarryingADelivery_refusedFromDeliverBy() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory dv, H.KeyProof memory k) = _delivery();
        bytes memory sig = _deliverySig(id, dv, SELLER_PK);
        H.EarlyAccept memory m = _early(t, id, BUYER_PK);
        vm.warp(t.timing.deliverBy);
        vm.expectRevert(HoldbackRules.DeadlinePassed.selector);
        rules.earlyAccept(t, m, dv, sig, k);
    }

    /// A buyer who wants the late work settles for it with the seller: both sign, so the deadline is theirs to waive.
    function test_lateWork_settlesByMutualSettlement() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory dv, H.KeyProof memory k) = _delivery();
        H.Mutual memory mu;
        mu.hasDelivery = true;
        mu.deliveryHash = hx.delivery(id, dv);
        mu.releaseKey = true;
        mu.payouts = new H.Payout[](1);
        mu.payouts[0] = H.Payout(seller, t.price);
        mu.expiresAt = type(uint64).max;
        bytes32 h = hx.mutual(id, t.token, mu);
        mu.buyerSignature = _sign(BUYER_PK, h);
        mu.sellerSignature = _sign(SELLER_PK, h);
        vm.warp(t.timing.deliverBy);
        rules.mutualSettle(t, mu, dv, k);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Settled));
    }
}
