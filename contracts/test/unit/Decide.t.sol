// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

contract DeliverTest is Base {
    function test_deliver_movesToDelivered() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Delivered));
        assertEq(rules.dealOf(id).attempt, 1);
    }

    function test_deliver_refusesAnotherSigner() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d,) = _delivery();
        bytes memory sig = _deliverySig(id, d, OTHER_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.deliver(t, d, sig);
    }

    function test_deliver_refusesAfterDeliverBy() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d,) = _delivery();
        bytes memory sig = _deliverySig(id, d, SELLER_PK);
        vm.warp(t.timing.deliverBy);
        vm.expectRevert(HoldbackRules.DeadlinePassed.selector);
        rules.deliver(t, d, sig);
    }

    function test_deliver_refusesASecondDelivery() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d,) = _deliver(t, id);
        bytes memory sig = _deliverySig(id, d, SELLER_PK);
        vm.expectRevert(abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.Delivered));
        rules.deliver(t, d, sig);
    }
}

contract DecideTest is Base {
    event KeyReleased(bytes32 indexed id, address indexed recipient, uint8 path, string scheme, string ciphertext);

    function test_accept_paysSellerAndFee_andReleasesKeyInTheSameTransaction() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        uint256 s0 = usdc.balanceOf(seller);
        H.Decision memory m = _primary(t, id, H.OUTCOME_ACCEPT);
        vm.expectEmit(true, true, false, true, address(rules));
        emit KeyReleased(id, buyer, 0, KEY_SCHEME, KEY_CT);
        vm.prank(relayer);
        rules.decide(t, m, _noDelivery(), "");
        assertEq(usdc.balanceOf(seller), s0 + PRICE);
        assertEq(usdc.balanceOf(adjudicator), FEE);
        assertEq(_held(t), 0);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
    }

    function test_reject_feeOnlyCaptureThenVoid() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        uint256 b0 = usdc.balanceOf(buyer);
        rules.decide(t, _primary(t, id, H.OUTCOME_REJECT), _noDelivery(), "");
        assertEq(usdc.balanceOf(buyer), b0 + PRICE);
        assertEq(usdc.balanceOf(adjudicator), FEE);
        assertEq(usdc.balanceOf(seller), 1_000_000_000);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
    }

    function test_decisionCarriesTheDelivery_twoTransactionHappyPath() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d,) = _delivery();
        bytes memory dsig = _deliverySig(id, d, SELLER_PK);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), d, dsig);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
        assertEq(usdc.balanceOf(adjudicator), FEE);
    }

    function test_decisionCarryingADeliveryRefusesAForgedOne() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d,) = _delivery();
        bytes memory dsig = _deliverySig(id, d, OTHER_PK);
        H.Decision memory m = _primary(t, id, H.OUTCOME_ACCEPT);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.decide(t, m, d, dsig);
    }

    function test_refuses_wrongSigner() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        H.Decision memory m = _signDecision(t, id, _decision(H.ROLE_PRIMARY, H.OUTCOME_ACCEPT), adjudicator, OTHER_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    function test_refuses_seedNotThePrimaryCommitment() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        H.Decision memory m = _decision(H.ROLE_PRIMARY, H.OUTCOME_ACCEPT);
        m.seed = keccak256("a seed chosen after reading the work");
        m = _signDecision(t, id, m, adjudicator, ADJ_PK);
        vm.expectRevert(HoldbackRules.BadSeed.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    function test_refuses_afterJudgeBy() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        H.Decision memory m = _primary(t, id, H.OUTCOME_ACCEPT);
        vm.warp(t.timing.judgeBy);
        vm.expectRevert(HoldbackRules.DeadlinePassed.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    function test_refuses_acceptWithoutTheBuyersKey() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        H.Decision memory m = _decision(H.ROLE_PRIMARY, H.OUTCOME_ACCEPT);
        m.keyScheme = "";
        m.keyCiphertext = "";
        m = _signDecision(t, id, m, adjudicator, ADJ_PK);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    function test_refuses_secondSettle() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        H.Decision memory m = _primary(t, id, H.OUTCOME_ACCEPT);
        rules.decide(t, m, _noDelivery(), "");
        vm.expectRevert(abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.Released));
        rules.decide(t, m, _noDelivery(), "");
        H.Decision memory r = _primary(t, id, H.OUTCOME_REJECT);
        vm.expectRevert(abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.Released));
        rules.decide(t, r, _noDelivery(), "");
    }

    function test_refuses_expiredMessage() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        H.Decision memory m = _decision(H.ROLE_PRIMARY, H.OUTCOME_ACCEPT);
        m.expiresAt = uint64(block.timestamp);
        m = _signDecision(t, id, m, adjudicator, ADJ_PK);
        vm.expectRevert(HoldbackRules.MessageExpired.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    // ------------------------------------------------------------ fallback and escalation

    function _toFallback() internal returns (H.Terms memory t, bytes32 id) {
        (t, id) = _funded();
        _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        vm.prank(relayer);
        rules.triggerFallback(t);
    }

    function test_fallback_decidesWithTheBeaconSeedAtJudgeBy() public {
        (H.Terms memory t, bytes32 id) = _toFallback();
        H.Decision memory m = _beaconDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, t.timing.judgeBy);
        m = _signDecision(t, id, m, fallbackAdj, FB_PK);
        rules.decide(t, m, _noDelivery(), "");
        assertEq(usdc.balanceOf(fallbackAdj), FEE, "the fee goes to the adjudicator whose decision settles");
    }

    /// Moved from BondConsent.t.sol (T-346): an escalation by the fallback moves no money and hands the case to the
    /// appeal adjudicator.
    function test_fallback_mayEscalate() public {
        (H.Terms memory t, bytes32 id) = _toFallback();
        H.Decision memory m = _beaconDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ESCALATE, t.timing.judgeBy);
        rules.decide(t, _signDecision(t, id, m, fallbackAdj, FB_PK), _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Escalated));
    }

    /// Moved from BondConsent.t.sol (T-346): one address named as primary and fallback decides as the fallback after
    /// the takeover, with the beacon seed, and the deal settles.
    function test_fallback_sameAddressAsPrimary_decides() public {
        H.Terms memory t = _terms();
        t.fallbackAdjudicator = adjudicator;
        bytes32 id = _fund(t);
        _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        H.Decision memory m = _beaconDecision(id, H.ROLE_FALLBACK, H.OUTCOME_REJECT, t.timing.judgeBy);
        rules.decide(t, _signDecision(t, id, m, adjudicator, ADJ_PK), _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
    }

    function test_fallback_refusesAChosenSeed() public {
        (H.Terms memory t, bytes32 id) = _toFallback();
        H.Decision memory m = _beaconDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, t.timing.judgeBy);
        m.seed = keccak256("shopped panel");
        m = _signDecision(t, id, m, fallbackAdj, FB_PK);
        vm.expectRevert(HoldbackRules.BadSeed.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    function test_fallback_refusesAnotherRound() public {
        (H.Terms memory t, bytes32 id) = _toFallback();
        H.Decision memory m = _beaconDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, t.timing.judgeBy + 3);
        m = _signDecision(t, id, m, fallbackAdj, FB_PK);
        vm.expectRevert(HoldbackRules.BadSeed.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    function test_fallback_refusesThePrimaryAfterTakeover() public {
        (H.Terms memory t, bytes32 id) = _toFallback();
        H.Decision memory m = _primary(t, id, H.OUTCOME_ACCEPT);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    function _escalated() internal returns (H.Terms memory t, bytes32 id, uint64 escalatedAt) {
        (t, id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        escalatedAt = uint64(block.timestamp);
    }

    function test_escalate_movesNoMoney_thenAppealAdjudicatorDecides() public {
        (H.Terms memory t, bytes32 id, uint64 at) = _escalated();
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Escalated));
        assertEq(_held(t), PRICE + FEE);
        vm.warp(at + 1); // the appeal round is the first one after the escalation: wait for it
        H.Decision memory m = _beaconDecision(id, H.ROLE_APPEAL, H.OUTCOME_REJECT, at + 1);
        m = _signDecision(t, id, m, appealAdj, AP_PK);
        rules.decide(t, m, _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
        assertEq(usdc.balanceOf(appealAdj), FEE);
    }

    /// Moved from Settle.t.sol's AppealTest (T-346): the appeal adjudicator's decision on an escalated case, signed by
    /// another key, is refused.
    function test_escalated_refusesAnotherSigner() public {
        (H.Terms memory t, bytes32 id, uint64 at) = _escalated();
        vm.warp(at + 1); // the appeal round is the first one after the escalation: wait for it
        H.Decision memory m = _beaconDecision(id, H.ROLE_APPEAL, H.OUTCOME_ACCEPT, at + 1);
        m = _signDecision(t, id, m, appealAdj, ADJ_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    function test_escalated_appealAdjudicatorCannotEscalate() public {
        (H.Terms memory t, bytes32 id, uint64 at) = _escalated();
        vm.warp(at + 1); // the appeal round is the first one after the escalation: wait for it
        H.Decision memory m = _beaconDecision(id, H.ROLE_APPEAL, H.OUTCOME_ESCALATE, at + 1);
        m = _signDecision(t, id, m, appealAdj, AP_PK);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
    }
}
