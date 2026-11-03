// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackBonds} from "../../src/HoldbackBonds.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// Every TimeoutKind is callable by any address once its deadline passes, and refused before it.
contract TimeoutsTest is Base {
    address internal anyone = address(0xA11);

    function test_expireOffer() public {
        H.Terms memory t = _terms();
        bytes32 id = hx.id(t);
        vm.expectRevert(HoldbackRules.TooEarly.selector);
        rules.expireOffer(t);
        vm.warp(t.timing.offerExpiresAt);
        vm.prank(anyone);
        rules.expireOffer(t);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Expired));
        vm.expectRevert(abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.Expired));
        rules.expireOffer(t);
    }

    function test_reclaim_refundsPricePlusFee() public {
        (H.Terms memory t, bytes32 id) = _funded();
        vm.expectRevert(HoldbackRules.TooEarly.selector);
        rules.reclaim(t);
        uint256 b0 = usdc.balanceOf(buyer);
        vm.warp(t.timing.deliverBy);
        vm.prank(anyone);
        rules.reclaim(t);
        assertEq(usdc.balanceOf(buyer), b0 + PRICE + FEE);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
        vm.expectRevert(abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.Refunded));
        rules.reclaim(t);
    }

    function test_reclaim_refusedOnceDeliveredOnChain() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        vm.warp(t.timing.deliverBy);
        vm.expectRevert(abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.Delivered));
        rules.reclaim(t);
    }

    function test_fallback() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        vm.expectRevert(HoldbackRules.TooEarly.selector);
        rules.triggerFallback(t);
        vm.warp(t.timing.judgeBy);
        vm.prank(anyone);
        rules.triggerFallback(t);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.FallbackJudging));
        assertEq(bonds.encumberedOf(fallbackAdj, address(usdc)), 0, "reserved only when the fallback decides");
    }

    function test_default_fromFallbackJudging_inOneCall() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        vm.expectRevert(HoldbackRules.TooEarly.selector);
        rules.triggerDefault(t);
        uint256 b0 = usdc.balanceOf(buyer);
        vm.warp(t.timing.fallbackBy);
        vm.prank(anyone);
        rules.triggerDefault(t);
        assertEq(usdc.balanceOf(buyer), b0 + PRICE + FEE);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
        assertEq(bonds.encumberedOf(fallbackAdj, address(usdc)), 0);
    }

    function test_default_afterEscalation() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        vm.expectRevert(HoldbackRules.TooEarly.selector);
        rules.triggerDefault(t);
        vm.warp(block.timestamp + t.timing.appealDecideSec);
        vm.prank(anyone);
        rules.triggerDefault(t);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
        assertEq(_held(t), 0);
        assertEq(bonds.encumberedOf(appealAdj, address(usdc)), 0);
    }

    function test_default_refusedWhileThePrimaryStillHasItsTurn() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        vm.warp(t.timing.fallbackBy);
        vm.expectRevert(abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.Delivered));
        rules.triggerDefault(t);
    }

    function test_appealExpiry_releasesTheDecidersBond() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        vm.expectRevert(HoldbackRules.TooEarly.selector);
        rules.expireAppeal(t);
        vm.warp(block.timestamp + t.timing.appealWindowSec);
        vm.prank(anyone);
        rules.expireAppeal(t);
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Expired));
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
        vm.expectRevert(
            abi.encodeWithSelector(HoldbackRules.WrongAppealState.selector, HoldbackRules.AppealState.Expired)
        );
        rules.expireAppeal(t);
    }

    function test_appealExpiry_openAppealUndecided_returnsTheBond() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        vm.prank(buyer);
        usdc.approve(address(bonds), type(uint256).max);
        H.Appeal memory a = H.Appeal({appellant: 0, groundsHash: keccak256("g"), bond: 1_000, filedAt: 0, signature: ""});
        a.signature = _sign(BUYER_PK, hx.appeal(id, buyer, t.token, a));
        rules.fileAppeal(t, a);
        uint256 b0 = usdc.balanceOf(buyer);
        vm.warp(block.timestamp + t.timing.appealWindowSec);
        vm.expectRevert(HoldbackRules.TooEarly.selector);
        rules.expireAppeal(t);
        vm.warp(block.timestamp + t.timing.appealDecideSec);
        rules.expireAppeal(t);
        assertEq(usdc.balanceOf(buyer), b0 + 1_000);
    }

    function test_buyerReclaimOnCppAfterExpiry_needsNoOperator() public {
        (H.Terms memory t,) = _funded();
        vm.warp(t.timing.fallbackBy + t.timing.appealDecideSec + MARGIN);
        uint256 b0 = usdc.balanceOf(buyer);
        AuthCaptureEscrow.PaymentInfo memory pi = _pi(t);
        vm.prank(buyer);
        escrow.reclaim(pi);
        assertEq(usdc.balanceOf(buyer), b0 + PRICE + FEE);
    }
}

contract BondsTest is Base {
    function test_withdraw_onlyWhatIsFree() public {
        (H.Terms memory t,) = _funded();
        vm.startPrank(adjudicator);
        vm.expectRevert(abi.encodeWithSelector(HoldbackBonds.InsufficientFreeBond.selector, BOND - PRICE, BOND));
        bonds.withdraw(t.token, BOND);
        bonds.withdraw(t.token, BOND - PRICE);
        vm.stopPrank();
        assertEq(usdc.balanceOf(adjudicator), BOND - PRICE);
    }

    function test_withdraw_afterSettlementReleasesTheBond() public {
        (H.Terms memory t,) = _funded();
        vm.warp(t.timing.deliverBy);
        rules.reclaim(t);
        vm.prank(adjudicator);
        bonds.withdraw(t.token, BOND);
        assertEq(usdc.balanceOf(adjudicator), BOND);
    }

    function test_onlyRulesEncumbers() public {
        vm.expectRevert(HoldbackBonds.NotRules.selector);
        bonds.encumber(adjudicator, address(usdc), 1);
        vm.expectRevert(HoldbackBonds.NotRules.selector);
        bonds.release(adjudicator, address(usdc), 0);
        vm.expectRevert(HoldbackBonds.NotRules.selector);
        bonds.takeAppealBond(bytes32(0), buyer, address(usdc), 0);
        vm.expectRevert(HoldbackBonds.NotRules.selector);
        bonds.payAppealBond(bytes32(0), address(usdc), adjudicator);
    }

    function test_deposit_creditsTheCaller() public {
        usdc.mint(address(this), 5);
        usdc.approve(address(bonds), 5);
        bonds.deposit(address(usdc), 5);
        assertEq(bonds.bondOf(address(this), address(usdc)), 5);
    }

    function test_deposit_refusesWithoutTheTokens() public {
        vm.expectRevert(SafeTransferLib.TransferFromFailed.selector);
        bonds.deposit(address(usdc), 5);
    }
}
