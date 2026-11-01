// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";
import {HoldbackRules} from "../src/HoldbackRules.sol";
import {SpikeBase} from "./SpikeBase.sol";

/// T-201 spike: can a no-admin rules contract drive CPP AuthCaptureEscrow v1.1.0 under Holdback's rules?
contract HoldbackRulesTest is SpikeBase {
    bytes32 internal constant ID = keccak256("commitment-1");

    // ---------------------------------------------------------------- Q1, Q7: funding

    function test_fund_anyRelayerSubmitsBuyerSignature_fundsAreHeld() public {
        HoldbackRules.Terms memory t = _terms(ID);
        _fund(t);

        bytes32 h = rules.hashTerms(t);
        assertEq(uint8(rules.stage(h)), uint8(HoldbackRules.Stage.Held));
        assertEq(usdc.balanceOf(buyer), 1_000_000_000 - PRICE);
        assertEq(usdc.balanceOf(escrow.getTokenStore(address(rules))), PRICE);
        (bool collected, uint120 capturable,) = escrow.paymentState(escrow.getHash(rules.paymentInfoFor(t)));
        assertTrue(collected);
        assertEq(capturable, PRICE);
    }

    function test_fund_paymentInfoBindsOperatorAndTerms() public view {
        HoldbackRules.Terms memory t = _terms(ID);
        AuthCaptureEscrow.PaymentInfo memory pi = rules.paymentInfoFor(t);
        assertEq(pi.operator, address(rules));
        assertEq(pi.payer, buyer);
        assertEq(pi.receiver, seller);
        assertEq(pi.maxAmount, PRICE);
        assertEq(pi.minFeeBps, 0);
        assertEq(pi.maxFeeBps, 10_000);
        assertEq(pi.feeReceiver, address(0));
        assertEq(pi.authorizationExpiry, t.holdExpiry);
        assertEq(pi.refundExpiry, t.holdExpiry);
        assertEq(pi.salt, uint256(rules.hashTerms(t)));
    }

    function test_fund_signatureCannotBeUsedByAnotherOperator() public {
        HoldbackRules.Terms memory t = _terms(ID);
        AuthCaptureEscrow.PaymentInfo memory pi = rules.paymentInfoFor(t);
        bytes memory sig = _signFunding(pi, BUYER_PK);

        // An EOA tries to become the operator of the same buyer signature.
        address rogue = makeAddr("rogue-operator");
        pi.operator = rogue;
        vm.prank(rogue);
        vm.expectRevert(); // ERC-3009 nonce = payer-agnostic hash including the operator: signature invalid
        escrow.authorize(pi, PRICE, address(collector), sig);
    }

    function test_fund_signatureForOtherTermsIsRejected() public {
        HoldbackRules.Terms memory t = _terms(ID);
        bytes memory sig = _signFunding(rules.paymentInfoFor(t), BUYER_PK);
        t.adjudicator = makeAddr("swapped-adjudicator"); // relayer swaps a term the buyer did not sign
        vm.expectRevert();
        rules.fund(t, sig);
    }

    function test_fund_replayReverts() public {
        HoldbackRules.Terms memory t = _terms(ID);
        bytes memory sig = _signFunding(rules.paymentInfoFor(t), BUYER_PK);
        rules.fund(t, sig);
        vm.expectRevert();
        rules.fund(t, sig);
    }

    // ---------------------------------------------------------------- happy path

    function test_happyPath_adjudicatorAccept_releasesPriceToSellerAndFeeToAdjudicator() public {
        HoldbackRules.Terms memory t = _terms(ID);
        _fund(t);
        bytes memory sig = _decisionSig(t, true, ADJ_PK);

        vm.prank(relayer);
        rules.decide(t, true, sig);

        assertEq(usdc.balanceOf(seller), PRICE - FEE);
        assertEq(usdc.balanceOf(adjudicator), FEE);
        assertEq(usdc.balanceOf(escrow.getTokenStore(address(rules))), 0);
        assertEq(uint8(rules.stage(rules.hashTerms(t))), uint8(HoldbackRules.Stage.Settled));
    }

    function test_earlyAccept_byBuyer_releasesFullPrice() public {
        HoldbackRules.Terms memory t = _terms(ID);
        _fund(t);
        bytes memory sig = _sign(BUYER_PK, rules.earlyAcceptDigest(rules.hashTerms(t)));

        vm.prank(relayer);
        rules.earlyAccept(t, sig);

        assertEq(usdc.balanceOf(seller), PRICE);
        assertEq(usdc.balanceOf(adjudicator), 0);
    }

    function test_earlyAccept_notByBuyer_reverts() public {
        HoldbackRules.Terms memory t = _terms(ID);
        _fund(t);
        bytes memory sig = _sign(OTHER_PK, rules.earlyAcceptDigest(rules.hashTerms(t)));
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.earlyAccept(t, sig);
    }

    // ---------------------------------------------------------------- Q3: reject path

    function test_reject_capturesOnlyTheFee_andRefundsTheRest() public {
        HoldbackRules.Terms memory t = _terms(ID);
        _fund(t);
        uint256 before = usdc.balanceOf(buyer);

        rules.decide(t, false, _decisionSig(t, false, ADJ_PK));

        assertEq(usdc.balanceOf(seller), 0, "seller gets nothing on reject");
        assertEq(usdc.balanceOf(adjudicator), FEE, "adjudicator is paid on the refund path too");
        assertEq(usdc.balanceOf(buyer), before + PRICE - FEE, "buyer gets the price minus the fee back");
        assertEq(usdc.balanceOf(escrow.getTokenStore(address(rules))), 0);
    }

    function test_reject_withZeroFee_voidsEverything() public {
        HoldbackRules.Terms memory t = _terms(ID);
        t.adjudicationFee = 0;
        _fund(t);
        rules.decide(t, false, _decisionSig(t, false, ADJ_PK));
        assertEq(usdc.balanceOf(buyer), 1_000_000_000);
    }

    function test_reject_feeEqualToPrice_capturesAllAsFee() public {
        HoldbackRules.Terms memory t = _terms(ID);
        t.adjudicationFee = PRICE; // agreed terms bind (D28); maxFeeBps = 10000 makes this representable
        _fund(t);
        rules.decide(t, false, _decisionSig(t, false, ADJ_PK));
        assertEq(usdc.balanceOf(adjudicator), PRICE);
        assertEq(usdc.balanceOf(seller), 0);
    }

    function test_decide_wrongSigner_reverts() public {
        HoldbackRules.Terms memory t = _terms(ID);
        _fund(t);
        bytes memory sig = _decisionSig(t, true, OTHER_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.decide(t, true, sig);
    }

    function test_decide_signatureForOtherOutcome_reverts() public {
        HoldbackRules.Terms memory t = _terms(ID);
        _fund(t);
        bytes memory rejectSig = _decisionSig(t, false, ADJ_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.decide(t, true, rejectSig); // relayer flips the outcome
    }

    function test_decide_signatureForOtherCommitment_reverts() public {
        HoldbackRules.Terms memory a = _terms(ID);
        HoldbackRules.Terms memory b = _terms(keccak256("commitment-2"));
        _fund(a);
        _fund(b);
        bytes memory sigA = _decisionSig(a, true, ADJ_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.decide(b, true, sigA);
    }

    // ---------------------------------------------------------------- Q4: idempotency / settle-once

    function test_decide_replay_revertsAlreadySettled() public {
        HoldbackRules.Terms memory t = _terms(ID);
        _fund(t);
        bytes memory sig = _decisionSig(t, false, ADJ_PK);
        rules.decide(t, false, sig);
        vm.expectRevert(abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.Settled));
        rules.decide(t, false, sig);
    }

    function test_conflictingDecisions_firstWins() public {
        HoldbackRules.Terms memory t = _terms(ID);
        _fund(t);
        rules.decide(t, true, _decisionSig(t, true, ADJ_PK));
        bytes memory rejectSig = _decisionSig(t, false, ADJ_PK);
        vm.expectRevert(abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.Settled));
        rules.decide(t, false, rejectSig);
        vm.expectRevert(abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.Settled));
        rules.timeout(t);
    }

    /// Why the rules contract needs its own guard: with feeReceiver = 0 and maxFeeBps = 10000 (needed for a
    /// fee-only capture on reject), CPP lets its operator call capture repeatedly, each time routing the whole
    /// amount as a "fee" to any address. CPP bounds the total by the hold, not the number or shape of captures.
    function test_cppAlone_allowsRepeatedAllFeeCapturesToAnyAddress() public {
        address eoaOperator = makeAddr("eoa-operator");
        AuthCaptureEscrow.PaymentInfo memory pi = AuthCaptureEscrow.PaymentInfo({
            operator: eoaOperator,
            payer: buyer,
            receiver: seller,
            token: address(usdc),
            maxAmount: PRICE,
            preApprovalExpiry: uint48(block.timestamp + 1 hours),
            authorizationExpiry: uint48(block.timestamp + 10 days),
            refundExpiry: uint48(block.timestamp + 10 days),
            minFeeBps: 0,
            maxFeeBps: 10_000,
            feeReceiver: address(0),
            salt: 1
        });
        bytes memory sig = _signFunding(pi, BUYER_PK);
        vm.startPrank(eoaOperator);
        escrow.authorize(pi, PRICE, address(collector), sig);
        escrow.capture(pi, FEE, FEE, makeAddr("x"));
        escrow.capture(pi, FEE, FEE, makeAddr("y")); // same call shape again: CPP accepts it
        escrow.capture(pi, PRICE - 2 * FEE, PRICE - 2 * FEE, makeAddr("z")); // and the rest, all as "fee"
        vm.stopPrank();
        assertEq(usdc.balanceOf(seller), 0);
        assertEq(usdc.balanceOf(makeAddr("z")), PRICE - 2 * FEE);
    }

    // ---------------------------------------------------------------- Q1: permissionless timeout

    function test_timeout_anyoneAfterDecideBy_refundsBuyerInFull() public {
        HoldbackRules.Terms memory t = _terms(ID);
        _fund(t);
        vm.warp(t.decideBy);
        vm.prank(makeAddr("anyone"));
        rules.timeout(t);
        assertEq(usdc.balanceOf(buyer), 1_000_000_000);
        assertEq(usdc.balanceOf(adjudicator), 0);
    }

    function test_timeout_beforeDecideBy_reverts() public {
        HoldbackRules.Terms memory t = _terms(ID);
        _fund(t);
        vm.warp(t.decideBy - 1);
        vm.expectRevert(HoldbackRules.TooEarly.selector);
        rules.timeout(t);
    }

    // ---------------------------------------------------------------- Q2: expiry and capture timing

    function test_holdStaysCapturableForAYear() public {
        HoldbackRules.Terms memory t = _terms(ID);
        t.decideBy = uint48(block.timestamp + 365 days);
        t.holdExpiry = uint48(block.timestamp + 400 days);
        _fund(t);
        vm.warp(block.timestamp + 364 days);
        rules.decide(t, true, _decisionSig(t, true, ADJ_PK));
        assertEq(usdc.balanceOf(seller), PRICE - FEE);
    }

    function test_farFutureExpiry_isRepresentable() public {
        // D31: any value the encoding can represent. uint48 seconds reaches the year 8,921,556.
        HoldbackRules.Terms memory t = _terms(ID);
        t.decideBy = type(uint48).max - 1;
        t.holdExpiry = type(uint48).max;
        _fund(t);
        rules.decide(t, false, _decisionSig(t, false, ADJ_PK));
        assertEq(usdc.balanceOf(buyer), 1_000_000_000 - FEE);
    }

    function test_decisionAfterHoldExpiry_cannotCapture_buyerReclaims() public {
        HoldbackRules.Terms memory t = _terms(ID);
        _fund(t);
        bytes memory acceptSig = _decisionSig(t, true, ADJ_PK);
        vm.warp(t.holdExpiry); // the accept was signed but never relayed in time
        vm.expectRevert(); // CPP: AfterAuthorizationExpiry
        rules.decide(t, true, acceptSig);
        vm.prank(buyer);
        escrow.reclaim(rules.paymentInfoFor(t));
        assertEq(usdc.balanceOf(buyer), 1_000_000_000);
    }

    function test_fund_holdExpiryBeforeDecideBy_reverts() public {
        HoldbackRules.Terms memory t = _terms(ID);
        t.holdExpiry = t.decideBy - 1; // self-contradictory: a decision window the hold cannot cover
        bytes memory sig = _signFunding(rules.paymentInfoFor(t), BUYER_PK);
        vm.expectRevert(HoldbackRules.InvalidTerms.selector);
        rules.fund(t, sig);
    }

    // ---------------------------------------------------------------- liveness backstop, no operator at all

    function test_payerReclaim_afterExpiry_withNoOperatorAction() public {
        HoldbackRules.Terms memory t = _terms(ID);
        _fund(t);
        AuthCaptureEscrow.PaymentInfo memory pi = rules.paymentInfoFor(t);

        vm.prank(buyer);
        vm.expectRevert(); // BeforeAuthorizationExpiry
        escrow.reclaim(pi);

        vm.warp(t.holdExpiry);
        vm.prank(buyer); // nobody touches HoldbackRules; the buyer calls CPP directly
        escrow.reclaim(pi);
        assertEq(usdc.balanceOf(buyer), 1_000_000_000);
    }

    function test_reclaim_isPayerOnly() public {
        HoldbackRules.Terms memory t = _terms(ID);
        _fund(t);
        vm.warp(t.holdExpiry);
        AuthCaptureEscrow.PaymentInfo memory pi = rules.paymentInfoFor(t);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(AuthCaptureEscrow.InvalidSender.selector, relayer, buyer));
        escrow.reclaim(pi);
    }
}
