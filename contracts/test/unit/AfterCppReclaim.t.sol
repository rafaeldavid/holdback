// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {IHoldbackRules} from "../../src/IHoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-206 M-1: after authorizationExpiry the buyer may reclaim on CPP directly (ADR-0003's backstop). The rules
/// contract's timeouts must still close the deal, moving no money and reporting no refund it did not make. If the
/// buyer has not reclaimed, they still void. Phase one has no bond vault (T-346, ADR-0031 §8), so closing the deal is
/// all a timeout owes after a CPP reclaim.
contract AfterCppReclaimTest is Base {
    bytes32 internal constant REFUNDED = keccak256("Refunded(bytes32,address,uint256)");

    function _expiry(H.Terms memory t) internal pure returns (uint256) {
        return uint256(t.timing.fallbackBy) + t.timing.appealDecideSec + MARGIN;
    }

    function _cppReclaim(H.Terms memory t) internal {
        AuthCaptureEscrow.PaymentInfo memory pi = _pi(t);
        vm.prank(buyer);
        escrow.reclaim(pi);
    }

    function _capturable(H.Terms memory t) internal view returns (uint256 c) {
        (, c,) = escrow.paymentState(escrow.getHash(_pi(t)));
    }

    /// The Refunded events the rules contract emitted since recordLogs, and the last one's amount.
    function _refunds() internal returns (uint256 n, uint256 amount) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(rules) && logs[i].topics[0] == REFUNDED) {
                n++;
                amount = abi.decode(logs[i].data, (uint256));
            }
        }
    }

    function _escalated() internal returns (H.Terms memory t, bytes32 id) {
        (t, id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
    }

    // ------------------------------------------------------------ after the buyer's CPP reclaim

    function test_held_reclaimClosesTheDeal() public {
        (H.Terms memory t, bytes32 id) = _funded();
        vm.warp(_expiry(t));
        _cppReclaim(t);
        uint256 b0 = usdc.balanceOf(buyer);
        vm.recordLogs();
        rules.reclaim(t);
        (uint256 n,) = _refunds();
        assertEq(n, 0, "no Refunded for money the rules contract did not move");
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Refunded));
        assertEq(usdc.balanceOf(buyer), b0, "the buyer was refunded once, by CPP");
        vm.expectRevert(abi.encodeWithSelector(IHoldbackRules.WrongStage.selector, IHoldbackRules.Stage.Refunded));
        rules.reclaim(t);
    }

    function test_delivered_fallbackThenDefaultClosesTheDeal() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        vm.warp(_expiry(t));
        _cppReclaim(t);
        rules.triggerFallback(t);
        rules.triggerDefault(t);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Refunded));
    }

    function test_escalated_defaultClosesTheDeal() public {
        (H.Terms memory t, bytes32 id) = _escalated();
        vm.warp(_expiry(t));
        _cppReclaim(t);
        vm.recordLogs();
        rules.triggerDefault(t);
        (uint256 n,) = _refunds();
        assertEq(n, 0, "no Refunded for money the rules contract did not move");
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Refunded));
    }

    /// Before SC-5, D31 let a deliverBy fall after authorizationExpiry: nobody could reclaim through the rules contract
    /// before CPP let the buyer reclaim, and the deal closed only once deliverBy passed. A deliverBy after the expiry is
    /// after fallbackBy, so since SC-5 (T-356, ADR-0031 §6) such terms are refused at funding and the shape cannot arise.
    function test_deliverByAfterExpiry_refusedAtFunding() public {
        H.Terms memory t = _terms();
        t.timing.deliverBy = uint64(_expiry(t) + 1 days);
        bytes memory ss = _sellerSig(t, SELLER_PK);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.agreeAndFund(t, ss, acc, ag, f);
        assertEq(uint8(_stage(hx.id(t))), uint8(IHoldbackRules.Stage.None));
    }

    /// The other money paths still revert after a CPP reclaim (nothing left to capture or void); the timeouts
    /// close the deal instead.
    function test_otherPathsRevert_timeoutsClose() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory dv, H.KeyProof memory k) = _deliver(t, id);
        vm.warp(_expiry(t));
        _cppReclaim(t);
        H.EarlyAccept memory m = _early(t, id, BUYER_PK);
        bytes memory dsig = _deliverySig(id, dv, SELLER_PK);
        vm.expectRevert(
            abi.encodeWithSelector(
                AuthCaptureEscrow.AfterAuthorizationExpiry.selector, uint48(block.timestamp), uint48(_expiry(t))
            )
        );
        rules.earlyAccept(t, m, dv, dsig, k);
        rules.triggerFallback(t);
        rules.triggerDefault(t);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Refunded));
    }

    // ------------------------------------------------------------ moved from CppReclaimStrandsBonds.t.sol (T-346)

    /// M-1, fixed in PR #122. Was test_attack_cpp_reclaim_in_held_strands_primary_bond (T-335's port of the T-206
    /// pass, against baac930): after the buyer's CPP reclaim, `rules.reclaim` reverted and the deal never closed. Now
    /// it closes the deal and pays nothing twice. The bond half of the test left with the vault.
    function test_regression_cppReclaimInHeld_rulesReclaimClosesTheDeal() public {
        (H.Terms memory t, bytes32 id) = _funded();
        AuthCaptureEscrow.PaymentInfo memory pi = _pi(t);
        uint256 b0 = usdc.balanceOf(buyer);
        vm.warp(_expiry(t));
        vm.prank(buyer);
        escrow.reclaim(pi);
        assertEq(usdc.balanceOf(buyer), b0 + PRICE + FEE, "the buyer has the money back");

        rules.reclaim(t);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Refunded), "the deal closes");
        assertEq(usdc.balanceOf(buyer), b0 + PRICE + FEE, "paid back once");
    }

    /// M-1, fixed in PR #122. Was test_regression_cpp_reclaim_in_fallbackJudging_strands_two_bonds. A mutual
    /// settlement after the buyer's CPP reclaim still reverts, because CPP holds nothing to void; `triggerDefault`
    /// closes the deal instead. The bond half of the test left with the vault.
    function test_regression_cppReclaimInFallbackJudging_defaultClosesTheDeal() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        AuthCaptureEscrow.PaymentInfo memory pi = _pi(t);
        vm.warp(_expiry(t));
        vm.prank(buyer);
        escrow.reclaim(pi);

        H.Payout[] memory p = new H.Payout[](1);
        p[0] = H.Payout(buyer, PRICE);
        (H.Delivery memory d,) = _delivery();
        H.Mutual memory m;
        m.hasDelivery = true;
        m.deliveryHash = hx.delivery(id, d);
        m.payouts = p;
        m.expiresAt = type(uint64).max;
        bytes32 h = hx.mutual(id, t.token, m);
        m.buyerSignature = _sign(BUYER_PK, h);
        m.sellerSignature = _sign(SELLER_PK, h);
        H.KeyProof memory none;
        vm.expectRevert(abi.encodeWithSelector(AuthCaptureEscrow.ZeroAuthorization.selector, escrow.getHash(pi)));
        rules.mutualSettle(t, m, d, none);

        rules.triggerDefault(t);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Refunded));
    }

    // L-6, closed by SC-5 (T-356, ADR-0031 §6). This test flipped as its note promised.
    /// The D31 shape this test showed: `deliverBy` and `judgeBy` after `authorizationExpiry`. The buyer could reclaim
    /// on CPP while the seller still had time to deliver; the seller delivered on time, neither the primary's accept
    /// nor its reject could capture, and the seller, who delivered on time per the terms, was never paid. Such terms
    /// put `fallbackBy` before `deliverBy`, so since SC-5 they are refused at funding and the deal never exists.
    function test_regression_L6_deadlinesAfterExpiry_refusedAtFunding() public {
        H.Terms memory t = _terms();
        uint64 now_ = uint64(block.timestamp);
        t.timing.deliverBy = now_ + 10 days;
        t.timing.judgeBy = now_ + 12 days; // fallbackBy stays now + 3 days: expiry = 3 + 1 + 1 = day 5
        assertLt(uint64(_expiry(t)), t.timing.deliverBy, "the shape L-6 needs");
        bytes memory ss = _sellerSig(t, SELLER_PK);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        uint256 b0 = usdc.balanceOf(buyer);
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.agreeAndFund(t, ss, acc, ag, f);
        assertEq(uint8(_stage(hx.id(t))), uint8(IHoldbackRules.Stage.None));
        assertEq(usdc.balanceOf(buyer), b0, "nothing held, so nothing to strand");
    }

    // ------------------------------------------------------------ after the expiry, no CPP reclaim

    function test_afterExpiry_reclaimStillVoids() public {
        (H.Terms memory t, bytes32 id) = _funded();
        vm.warp(_expiry(t));
        uint256 b0 = usdc.balanceOf(buyer);
        vm.recordLogs();
        rules.reclaim(t);
        (uint256 n, uint256 amount) = _refunds();
        assertEq(n, 1);
        assertEq(amount, PRICE + FEE);
        assertEq(usdc.balanceOf(buyer), b0 + PRICE + FEE, "refunded by the rules contract");
        assertEq(_capturable(t), 0);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Refunded));
    }

    function test_afterExpiry_defaultStillVoids() public {
        (H.Terms memory t,) = _escalated();
        vm.warp(_expiry(t) + 7 days);
        uint256 b0 = usdc.balanceOf(buyer);
        rules.triggerDefault(t);
        assertEq(usdc.balanceOf(buyer), b0 + PRICE + FEE);
        assertEq(_capturable(t), 0);
    }
}
