// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {RulesHandler} from "../handlers/RulesHandler.sol";

/// T-203: every handler action can succeed. Scripted walks through the handler (seed 0 picks the authorised key
/// and the first matching commitment), so a handler that silently refuses a path fails here instead of making
/// the invariant campaign vacuous. A refused handler call reverts with `Refused()`, which fails the test.
contract HandlerSmokeTest is Test {
    RulesHandler internal h;
    HoldbackRules internal rules;

    // seed bits: [0..1] pick mode (1 = stage-aware), so 1 picks the first matching commitment from index 0.
    uint256 internal constant PICK = 1;
    // An ordered-timing usdc offer: price and fee from bits 8.. and 40.., roles primary/fallback/appeal = 2/3/4.
    // Bit 148 gives a 16 s appealDecideSec (T-209: the appeal adjudicator must outlast the wait for its beacon round;
    // with a 1 s window the round after an escalation is never available in time and the default path applies).
    uint256 internal constant OFFER = (uint256(26_000_000) << 8) | (uint256(500_000) << 40) | (uint256(1) << 76)
        | (uint256(2) << 80) | (uint256(1) << 88) | (uint256(1) << 148);

    function setUp() public {
        h = new RulesHandler();
        (rules,,) = h.system();
    }

    function _stage() internal view returns (HoldbackRules.Stage) {
        return h.word(h.dealId(0)).stage;
    }

    /// T-375 (RF-4): the closing reason and the decider the word of deal 0 stores.
    function _closedAs(HoldbackRules.Reason reason, HoldbackRules.Decider decider) internal view {
        HoldbackRules.Deal memory d = h.word(h.dealId(0));
        assertEq(uint8(d.reason), uint8(reason), "stored closing reason");
        assertEq(uint8(d.decider), uint8(decider), "stored decider");
    }

    function _warpTo(uint256 t) internal {
        vm.warp(t);
    }

    function _funded() internal {
        h.offer(OFFER);
        h.agreeAndFund(PICK, 0, 0);
        assertEq(uint8(_stage()), uint8(HoldbackRules.Stage.Held));
    }

    /// T-346 (SC-7): the first decision is final. A later decision, the appeal filing and the appeal expiry are
    /// refused on the phase-one contract: the handler re-reverts each with `Refused()`.
    function test_offer_fund_deliver_decide_isFinal() public {
        _funded();
        h.deliver(PICK, 5, 0);
        h.decide(PICK, 6, 0, H.OUTCOME_ACCEPT);
        assertEq(uint8(_stage()), uint8(HoldbackRules.Stage.Released));
        _closedAs(HoldbackRules.Reason.Decided, HoldbackRules.Decider.Primary);
        assertEq(h.closings(h.dealId(0)), 1);
        assertEq(h.closedBy(h.dealId(0)), h.R_DECIDED());
        assertEq(h.closedDecider(h.dealId(0)), h.D_PRIMARY());
        vm.expectRevert(RulesHandler.Refused.selector);
        h.fileAppeal(PICK, 1, 0, 0);
        _warpTo(block.timestamp + 1);
        vm.expectRevert(RulesHandler.Refused.selector);
        h.decide(PICK, 6, 0, H.OUTCOME_REJECT);
        vm.expectRevert(RulesHandler.Refused.selector);
        h.decideAppeal(PICK, 6, H.OUTCOME_REJECT);
        H.Terms memory t = h.termsOf(0);
        _warpTo(h.word(h.dealId(0)).t1 + t.timing.appealWindowSec);
        vm.expectRevert(RulesHandler.Refused.selector);
        h.expireAppeal(PICK, 6);
        assertEq(uint8(_stage()), uint8(HoldbackRules.Stage.Released));
        assertEq(h.closings(h.dealId(0)), 1);
    }

    function test_decide_carriesDelivery() public {
        _funded();
        h.decide(PICK, 0, 0, H.OUTCOME_REJECT);
        assertEq(uint8(_stage()), uint8(HoldbackRules.Stage.Refunded));
        _closedAs(HoldbackRules.Reason.Decided, HoldbackRules.Decider.Primary);
        assertEq(h.closedBy(h.dealId(0)), h.R_DECIDED());
    }

    function test_escalate_thenAppealAdjudicatorDecides() public {
        _funded();
        h.deliver(PICK, 0, 0);
        h.decide(PICK, 0, 0, H.OUTCOME_ESCALATE);
        assertEq(uint8(_stage()), uint8(HoldbackRules.Stage.Escalated));
        _closedAs(HoldbackRules.Reason.Open, HoldbackRules.Decider.None);
        _warpTo(block.timestamp + 1); // T-209: wait for the first round after the escalation
        h.decide(PICK, 0, 0, H.OUTCOME_ACCEPT);
        assertEq(uint8(_stage()), uint8(HoldbackRules.Stage.Released));
        _closedAs(HoldbackRules.Reason.Decided, HoldbackRules.Decider.Appeal);
    }

    function test_fallback_thenDefault() public {
        _funded();
        h.deliver(PICK, 0, 0);
        H.Terms memory t = h.termsOf(0);
        _warpTo(t.timing.judgeBy);
        h.triggerFallback(PICK, 6);
        _warpTo(t.timing.fallbackBy);
        h.triggerDefault(PICK, 5);
        assertEq(uint8(_stage()), uint8(HoldbackRules.Stage.Refunded));
        _closedAs(HoldbackRules.Reason.Defaulted, HoldbackRules.Decider.None);
    }

    function test_fallbackDecides() public {
        _funded();
        h.deliver(PICK, 0, 0);
        _warpTo(h.termsOf(0).timing.judgeBy);
        h.triggerFallback(PICK, 6);
        h.decide(PICK, 0, 0, H.OUTCOME_ACCEPT);
        assertEq(uint8(_stage()), uint8(HoldbackRules.Stage.Released));
        _closedAs(HoldbackRules.Reason.Decided, HoldbackRules.Decider.Fallback);
    }

    function test_earlyAccept() public {
        _funded();
        h.earlyAccept(PICK, 3, 0);
        assertEq(uint8(_stage()), uint8(HoldbackRules.Stage.Released));
        _closedAs(HoldbackRules.Reason.AcceptedEarly, HoldbackRules.Decider.None);
    }

    function test_mutualSettle() public {
        _funded();
        // a = 10, b = 20 of the price; the rest to the operator; with delivery and key release.
        uint256 split = 10 | (uint256(20) << 48) | (uint256(3) << 130);
        h.mutualSettle(PICK, 0, 0, split);
        assertEq(uint8(_stage()), uint8(HoldbackRules.Stage.Settled));
        _closedAs(HoldbackRules.Reason.Settled, HoldbackRules.Decider.None);
    }

    function test_reclaim() public {
        _funded();
        _warpTo(h.termsOf(0).timing.deliverBy);
        h.reclaim(PICK, 6);
        assertEq(uint8(_stage()), uint8(HoldbackRules.Stage.Refunded));
        _closedAs(HoldbackRules.Reason.Reclaimed, HoldbackRules.Decider.None);
    }

    /// SC-6 (T-356): the phase-one contract has no `expireOffer`. The handler's action, kept for the side-by-side
    /// harness, is refused with no violation, and the offer past its expiry stays unfunded and cannot fund.
    function test_expireOffer_isGone_offerStaysUnfundedAndCannotFund() public {
        h.offer(OFFER);
        _warpTo(h.termsOf(0).timing.offerExpiresAt);
        vm.expectRevert(RulesHandler.Refused.selector);
        h.expireOffer(PICK, 6);
        assertEq(uint8(_stage()), uint8(HoldbackRules.Stage.None));
        vm.expectRevert(RulesHandler.Refused.selector);
        h.agreeAndFund(PICK, 0, 0);
        assertEq(uint8(_stage()), uint8(HoldbackRules.Stage.None));
        assertEq(h.timeoutMismatch(), 0);
    }

    function test_cppReclaim_afterAuthorizationExpiry() public {
        _funded();
        H.Terms memory t = h.termsOf(0);
        _warpTo(uint256(t.timing.fallbackBy) + t.timing.appealDecideSec + 1 days);
        h.cppReclaim(PICK);
        assertTrue(h.cppReclaimed(h.dealId(0)));
    }

    function test_warp() public {
        h.offer(OFFER);
        h.warp(1 << 8);
    }

    // T-336: the delivery counter moves on every path that carries a delivery, so `invariant_deliveryHashStored`
    // cannot pass vacuously, and the posted delivery's hash is the one stored on chain.

    function _deliveredOnce() internal view {
        bytes32 id = h.dealId(0);
        assertEq(h.deliveries(), 1, "the handler did not count the delivery");
        assertTrue(h.postedHash(id) != bytes32(0), "no posted hash recorded");
        assertEq(rules.deliveryHashOf(id), h.postedHash(id), "stored hash != the posted delivery's");
        assertEq(h.deliveryHashLost(), 0);
        assertEq(h.deliverRefused(), 0);
    }

    function test_deliveryCounter_deliver() public {
        _funded();
        assertEq(h.deliveries(), 0);
        h.deliver(PICK, 5, 0);
        _deliveredOnce();
    }

    function test_deliveryCounter_decisionCarriesTheDelivery() public {
        _funded();
        h.decide(PICK, 0, 0, H.OUTCOME_REJECT);
        _deliveredOnce();
    }

    function test_deliveryCounter_earlyAcceptCarriesTheDelivery() public {
        _funded();
        h.earlyAccept(PICK, 3, 0);
        _deliveredOnce();
    }

    function test_deliveryCounter_decideFallbackPostsTheDelivery() public {
        _funded();
        h.decideFallback(PICK, 0, H.OUTCOME_ACCEPT);
        assertEq(uint8(_stage()), uint8(HoldbackRules.Stage.Released));
        _deliveredOnce();
    }

    function test_deliveryCounter_staysAtZeroWhenTheDeliveryIsLate() public {
        _funded();
        _warpTo(h.termsOf(0).timing.deliverBy);
        vm.expectRevert(RulesHandler.Refused.selector);
        h.deliver(PICK, 5, 0);
        assertEq(h.deliveries(), 0);
        assertEq(h.postedHash(h.dealId(0)), bytes32(0));
        assertEq(rules.deliveryHashOf(h.dealId(0)), bytes32(0));
    }

    // T-375 (triage item 43): the decision counter moves on every path that decides after a delivery, and the gate
    // counts a disagreement in either direction: a timely decision refused (forced here by a failing escrow), or a
    // decision that lands although the predicate calls it untimely. An untimely refusal is not a violation.

    function test_decisionCounter_everyRole() public {
        _funded();
        h.decide(PICK, 0, 0, H.OUTCOME_ESCALATE); // the primary, carrying the delivery
        _warpTo(block.timestamp + 1); // the escalation's beacon round is public from t1 + 1
        h.decide(PICK, 0, 0, H.OUTCOME_ACCEPT); // the appeal adjudicator
        assertEq(h.decisions(), 2);
        h.offer(OFFER ^ (uint256(1) << 9)); // a second deal (another price), for the fallback
        h.agreeAndFund(PICK, 0, 0);
        h.decideFallback(PICK, 0, H.OUTCOME_REJECT);
        assertEq(h.decisions(), 3);
        assertEq(h.decideRefused(), 0);
    }

    function test_decisionCounter_lateDecisionIsRefusedWithoutAViolation() public {
        _funded();
        h.deliver(PICK, 5, 0);
        _warpTo(h.termsOf(0).timing.judgeBy);
        vm.expectRevert(RulesHandler.Refused.selector);
        h.decide(PICK, 0, 0, H.OUTCOME_ACCEPT);
        assertEq(h.decisions(), 0);
        assertEq(h.decideRefused(), 0);
    }

    function test_decisionCounter_timelyRefusalIsAViolation() public {
        _funded();
        h.deliver(PICK, 5, 0);
        (, , AuthCaptureEscrow escrow) = h.system();
        vm.mockCallRevert(address(escrow), abi.encodeWithSelector(AuthCaptureEscrow.capture.selector), "escrow down");
        h.decide(PICK, 0, 0, H.OUTCOME_ACCEPT); // no Refused(): the refusal is a violation, so the handler returns
        assertEq(h.decisions(), 0);
        assertEq(h.decideRefused(), 1);
        assertEq(h.lastViolation(), "decide: an authorised, timely decision was refused");
    }

    // T-375 (triage item 46): the boundary offers (`RulesHandler._boundary`) are drawn, sit exactly on their bound,
    // and fund or are refused as the bound says. The search repeats the handler's draw, and skips offers that another
    // rare draw (another token, an appeal window, deadlines out of order) would refuse first.

    function _boundarySeed(uint256 kind) internal pure returns (uint256 s) {
        for (s = 1; s < 100_000; s++) {
            uint256 b = uint256(keccak256(abi.encode("boundary", s)));
            if (b % 16 != 0 || (b >> 8) % 8 != kind) continue;
            if (uint256(keccak256(abi.encode("other token", s))) % 64 == 0) continue;
            if (uint256(keccak256(abi.encode("appeal window", s))) % 32 == 0) continue;
            if (uint256(keccak256(abi.encode("any order", s))) % 32 == 0) continue;
            return s;
        }
        revert("no seed draws this boundary");
    }

    function test_boundaryOffers_sitOnTheirBounds() public {
        // T-380: eight kinds; 2 and 3 are the escalation window's 32 bits, 4 and 5 the year 9999 (fallbackBy).
        for (uint256 kind; kind < 8; kind++) {
            RulesHandler x = new RulesHandler();
            x.offer(_boundarySeed(kind));
            H.Terms memory t = x.termsOf(0);
            if (kind <= 1) assertEq(t.price + t.fee, uint256(type(uint120).max) + kind, "hold bound");
            if (kind == 2 || kind == 3) assertEq(t.timing.appealDecideSec, uint256(type(uint32).max) + kind - 2, "window");
            if (kind == 4 || kind == 5) assertEq(t.timing.fallbackBy, 253_402_387_139 + kind - 4, "year 9999");
            if (kind >= 6) {
                assertEq(t.timing.fallbackBy - t.timing.offerExpiresAt, 4, "deadlines one second apart");
                assertEq(t.timing.appealDecideSec, kind - 5, "the smallest escalation windows");
            }
            // Kinds 2 to 7 keep the drawn price and fee, so price 0 with fee 0, which the escrow cannot hold, is
            // possible in the handler (about one offer in 40 million); the seeds found here fund.
            bool lands = kind != 1 && kind != 3 && kind != 5;
            if (!lands) vm.expectRevert(RulesHandler.Refused.selector);
            x.agreeAndFund(PICK, 0, 0);
            HoldbackRules.Stage s = x.word(x.dealId(0)).stage;
            assertEq(uint8(s), uint8(lands ? HoldbackRules.Stage.Held : HoldbackRules.Stage.None), "funding outcome");
        }
    }

    function test_stranger_isRefused() public {
        _funded();
        for (uint256 w; w < 8; w++) {
            vm.expectRevert(RulesHandler.Refused.selector);
            h.stranger(6, w, 1);
        }
    }
}
