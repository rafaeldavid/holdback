// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-335: the T-206 adversarial pass's CppReclaimStrandsBonds tests (2026-11-03, against baac930), ported to HEAD.
/// ADR-0003 keeps the payer's CPP `reclaim` after `authorizationExpiry` as the liveness backstop. At baac930 every
/// rules exit that voids then reverted with `ZeroAuthorization`, so the deal never closed and its bonds stayed
/// encumbered (finding M-1). Fixed in PR #122: from the expiry on, `_refundAll` skips the void when CPP holds
/// nothing. L-6 (`authorizationExpiry` ignores `judgeBy`) is still open; the third test keeps that half attack-shaped.
contract CppReclaimStrandsBondsTest is Base {
    function _expiry(H.Terms memory t) internal pure returns (uint64) {
        return t.timing.fallbackBy + t.timing.appealDecideSec + MARGIN;
    }

    /// M-1, fixed in PR #122. Was test_attack_cpp_reclaim_in_held_strands_primary_bond: after the buyer's CPP
    /// reclaim, `rules.reclaim` reverted and the primary's bond stayed encumbered. Now it closes the deal and frees it.
    function test_regression_cpp_reclaim_in_held_strands_primary_bond() public {
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
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0, "the primary's bond is free");
        vm.prank(adjudicator);
        bonds.withdraw(address(usdc), BOND);
        assertEq(bonds.bondOf(adjudicator, address(usdc)), 0);
    }

    /// M-1, fixed in PR #122. Was test_attack_cpp_reclaim_in_fallbackJudging_strands_two_bonds. Since M-3 (PR #135)
    /// the takeover reserves nothing for the fallback, so only the primary's bond was at stake here. A mutual
    /// settlement still reverts, because CPP holds nothing to void; `triggerDefault` closes the deal instead.
    function test_regression_cpp_reclaim_in_fallbackJudging_strands_two_bonds() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        assertEq(bonds.encumberedOf(fallbackAdj, address(usdc)), 0, "M-3: the takeover reserves nothing");
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), PRICE);
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
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
        assertEq(bonds.encumberedOf(fallbackAdj, address(usdc)), 0);
    }

    // Open: L-6. This test flips when the contract lane (T-212 / pilot C3-C5) fixes it.
    /// D31 shape: `deliverBy` and `judgeBy` after `authorizationExpiry`. The buyer reclaims on CPP while the seller
    /// still has time to deliver; the seller delivers on time, and neither the primary's accept nor its reject can
    /// capture. The bond-stranding half of the original test is fixed by M-1 (PR #122): the default now closes the
    /// deal and frees both bonds. The seller, who delivered on time per the terms, is never paid (L-6).
    function test_attack_d31_deadlines_after_expiry_leave_seller_unpaid() public {
        H.Terms memory t = _terms();
        uint64 now_ = uint64(block.timestamp);
        t.timing.deliverBy = now_ + 10 days;
        t.timing.judgeBy = now_ + 12 days; // fallbackBy stays now + 3 days: expiry = 3 + 1 + 1 = day 5
        bytes32 id = _fund(t);
        uint64 expiry = _expiry(t);
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
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
        assertEq(bonds.encumberedOf(fallbackAdj, address(usdc)), 0);
        assertEq(usdc.balanceOf(seller), 1_000_000_000, "the seller delivered on time and is never paid");
    }
}
