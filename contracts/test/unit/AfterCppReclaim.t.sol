// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
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
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
        assertEq(usdc.balanceOf(buyer), b0, "the buyer was refunded once, by CPP");
        vm.expectRevert(abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.Refunded));
        rules.reclaim(t);
    }

    function test_delivered_fallbackThenDefaultClosesTheDeal() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        vm.warp(_expiry(t));
        _cppReclaim(t);
        rules.triggerFallback(t);
        rules.triggerDefault(t);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
    }

    function test_escalated_defaultClosesTheDeal() public {
        (H.Terms memory t, bytes32 id) = _escalated();
        vm.warp(_expiry(t));
        _cppReclaim(t);
        vm.recordLogs();
        rules.triggerDefault(t);
        (uint256 n,) = _refunds();
        assertEq(n, 0, "no Refunded for money the rules contract did not move");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
    }

    /// D31 allows a deliverBy after authorizationExpiry. Then nobody can reclaim through the rules contract before
    /// CPP lets the buyer reclaim, and the deal must still close once deliverBy passes.
    function test_deliverByAfterExpiry_reclaimStillClosesTheDeal() public {
        H.Terms memory t = _terms();
        t.timing.deliverBy = uint64(_expiry(t) + 1 days);
        bytes32 id = _fund(t);
        vm.warp(_expiry(t));
        vm.expectRevert(HoldbackRules.TooEarly.selector);
        rules.reclaim(t);
        _cppReclaim(t);
        vm.warp(t.timing.deliverBy);
        rules.reclaim(t);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
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
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
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
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded), "the deal closes");
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
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
    }

    // Open: L-6. This test flips when the contract lane (T-212 / pilot C3-C5) fixes it.
    /// D31 shape: `deliverBy` and `judgeBy` after `authorizationExpiry`. The buyer reclaims on CPP while the seller
    /// still has time to deliver; the seller delivers on time, and neither the primary's accept nor its reject can
    /// capture. The default closes the deal (M-1, PR #122). The seller, who delivered on time per the terms, is never
    /// paid (L-6).
    function test_attack_d31_deadlines_after_expiry_leave_seller_unpaid() public {
        H.Terms memory t = _terms();
        uint64 now_ = uint64(block.timestamp);
        t.timing.deliverBy = now_ + 10 days;
        t.timing.judgeBy = now_ + 12 days; // fallbackBy stays now + 3 days: expiry = 3 + 1 + 1 = day 5
        bytes32 id = _fund(t);
        uint64 expiry = uint64(_expiry(t));
        assertLt(expiry, t.timing.deliverBy);
        AuthCaptureEscrow.PaymentInfo memory pi = _pi(t);

        vm.warp(expiry);
        vm.expectRevert(HoldbackRules.TooEarly.selector); // the rules reclaim is not open yet...
        rules.reclaim(t);
        vm.prank(buyer);
        escrow.reclaim(pi); // ...but CPP's is

        vm.warp(expiry + 1 days);
        (H.Delivery memory d,) = _delivery();
        rules.deliver(t, d, _deliverySig(id, d, SELLER_PK)); // on time per the terms
        H.Decision memory m = _primary(t, id, H.OUTCOME_ACCEPT); // on time per the terms
        vm.expectRevert(
            abi.encodeWithSelector(
                AuthCaptureEscrow.AfterAuthorizationExpiry.selector, uint48(block.timestamp), uint48(expiry)
            )
        );
        rules.decide(t, m, _noDelivery(), "");
        H.Decision memory r = _primary(t, id, H.OUTCOME_REJECT); // the fee capture fails the same way
        vm.expectRevert(
            abi.encodeWithSelector(
                AuthCaptureEscrow.AfterAuthorizationExpiry.selector, uint48(block.timestamp), uint48(expiry)
            )
        );
        rules.decide(t, r, _noDelivery(), "");

        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        rules.triggerDefault(t); // M-1 fixed: the deal closes
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
        assertEq(usdc.balanceOf(seller), 1_000_000_000, "the seller delivered on time and is never paid");
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
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
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
