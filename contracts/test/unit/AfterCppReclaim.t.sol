// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-206 M-1: after authorizationExpiry the buyer may reclaim on CPP directly (ADR-0003's backstop). The rules
/// contract's timeouts must still close the deal and release every bond it encumbered, moving no money and
/// reporting no refund it did not make. If the buyer has not reclaimed, they still void.
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

    function test_held_reclaimReleasesThePrimaryBond() public {
        (H.Terms memory t, bytes32 id) = _funded();
        vm.warp(_expiry(t));
        _cppReclaim(t);
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), PRICE);
        uint256 b0 = usdc.balanceOf(buyer);
        vm.recordLogs();
        rules.reclaim(t);
        (uint256 n,) = _refunds();
        assertEq(n, 0, "no Refunded for money the rules contract did not move");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
        assertEq(usdc.balanceOf(buyer), b0, "the buyer was refunded once, by CPP");
        vm.expectRevert(abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.Refunded));
        rules.reclaim(t);
    }

    function test_delivered_fallbackThenDefaultReleasesBothBonds() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        vm.warp(_expiry(t));
        _cppReclaim(t);
        rules.triggerFallback(t);
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), PRICE);
        rules.triggerDefault(t);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
        assertEq(bonds.encumberedOf(fallbackAdj, address(usdc)), 0);
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

    /// The other money paths still revert after a CPP reclaim (nothing left to capture or void); the timeouts
    /// close the deal instead.
    function test_otherPathsRevert_timeoutsClose() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory dv, H.KeyProof memory k) = _deliver(t, id);
        vm.warp(_expiry(t));
        _cppReclaim(t);
        H.EarlyAccept memory m = H.EarlyAccept({attempt: 1, nonce: 0, expiresAt: type(uint64).max, signature: ""});
        m.signature = _sign(BUYER_PK, hx.early(id, buyer, m));
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
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
        assertEq(bonds.encumberedOf(fallbackAdj, address(usdc)), 0);
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
        assertEq(bonds.encumberedOf(appealAdj, address(usdc)), 0);
    }
}
