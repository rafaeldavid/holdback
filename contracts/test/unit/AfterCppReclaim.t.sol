// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-206 finding 2: after authorizationExpiry the buyer may reclaim on CPP directly (ADR-0003's backstop). The
/// rules contract's timeouts must still close the deal and release every bond it encumbered, moving no money.
contract AfterCppReclaimTest is Base {
    function _expiry(H.Terms memory t) internal pure returns (uint256) {
        return uint256(t.timing.fallbackBy) + t.timing.appealDecideSec + MARGIN;
    }

    function _cppReclaim(H.Terms memory t) internal {
        AuthCaptureEscrow.PaymentInfo memory pi = _pi(t);
        vm.prank(buyer);
        escrow.reclaim(pi);
    }

    function test_held_reclaimReleasesThePrimaryBond() public {
        (H.Terms memory t, bytes32 id) = _funded();
        vm.warp(_expiry(t));
        _cppReclaim(t);
        uint256 b0 = usdc.balanceOf(buyer);
        rules.reclaim(t);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
        assertEq(usdc.balanceOf(buyer), b0, "the buyer was refunded once, by CPP");
    }

    function test_delivered_fallbackThenDefaultReleasesBothBonds() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        vm.warp(_expiry(t));
        _cppReclaim(t);
        rules.triggerFallback(t);
        rules.triggerDefault(t);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
        assertEq(bonds.encumberedOf(fallbackAdj, address(usdc)), 0);
    }

    function test_escalated_defaultReleasesTheAppealBond() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        vm.warp(_expiry(t));
        _cppReclaim(t);
        rules.triggerDefault(t);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
        assertEq(bonds.encumberedOf(appealAdj, address(usdc)), 0);
    }

    /// D31 allows a deliverBy after authorizationExpiry. Then nobody can reclaim through the rules contract before
    /// CPP lets the buyer reclaim, so the primary's bond must not depend on someone calling first.
    function test_deliverByAfterExpiry_reclaimStillReleasesThePrimaryBond() public {
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
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
    }
}
