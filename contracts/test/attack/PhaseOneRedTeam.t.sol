// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {IHoldbackRules} from "../../src/IHoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "../unit/Base.sol";

/// Red team of T-346 (SC-7, ADR-0031 §8): phase one has no party appeal and no bond.
/// Three questions: can a funded deal get stuck; can held funds or the buyer's key move outside the signed terms; is
/// a state reachable that `docs/audit/state-model.md` §9.3 calls illegal.
///
/// Naming: `test_attack_*` and `test_neutrality_*` assert that a defence holds (a pass means the defence held).
/// `test_issue_*` asserts that a weakness exists (a pass means the weakness is present); each names its finding.
contract PhaseOneRedTeamTest is Base {
    bytes32 internal constant KEY_RELEASED =
        keccak256("KeyReleased(bytes32,address,uint8,string,string)");

    // ------------------------------------------------------------ helpers

    /// Delivers and has the primary escalate at the current block time; returns that time (t1).
    function _escalateByPrimary(H.Terms memory t, bytes32 id) internal returns (uint64 at) {
        _deliver(t, id);
        at = uint64(block.timestamp);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Escalated));
    }

    /// The appeal adjudicator's signed decision on a case escalated at `at` (round at + 1 on the sim beacon).
    function _appealDecision(H.Terms memory t, bytes32 id, uint8 outcome, uint64 at)
        internal
        view
        returns (H.Decision memory m)
    {
        m = _beaconDecision(id, H.ROLE_APPEAL, outcome, at + 1);
        m = _signDecision(t, id, m, appealAdj, AP_PK);
    }

    function _refundable(H.Terms memory t) internal view returns (uint120 capturable, uint120 refundable) {
        (, capturable, refundable) = escrow.paymentState(escrow.getHash(_pi(t)));
    }

    function _keyReleases(Vm.Log[] memory logs) internal pure returns (uint256 n) {
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == KEY_RELEASED) n++;
        }
    }

    // ------------------------------------------------------------ Q2: no money or key after a final decision

    /// The old KEY_APPEAL path: an accept from the appeal adjudicator, carrying the buyer's key, on a deal the primary
    /// rejected. Before the cut the contract refused a key on a Refunded deal by an explicit check; that check left
    /// with the appeal branch. The stage now refuses it: no key, no money.
    function test_attack_appealAcceptWithKeyOnRefundedDeal_releasesNothing() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_REJECT), _noDelivery(), "");
        uint64 at = rules.dealOf(id).t1;
        vm.warp(at + 1);
        H.Decision memory m = _appealDecision(t, id, H.OUTCOME_ACCEPT, at); // carries KEY_CT
        assertGt(bytes(m.keyCiphertext).length, 0);
        uint256 b0 = usdc.balanceOf(buyer);
        uint256 s0 = usdc.balanceOf(seller);
        vm.recordLogs();
        vm.expectRevert(abi.encodeWithSelector(IHoldbackRules.WrongStage.selector, IHoldbackRules.Stage.Refunded));
        rules.decide(t, m, _noDelivery(), "");
        assertEq(_keyReleases(vm.getRecordedLogs()), 0, "no key left");
        assertEq(usdc.balanceOf(buyer), b0);
        assertEq(usdc.balanceOf(seller), s0);
    }

    /// The fallback cannot reopen a primary's accept after judgeBy: WrongStage(Released).
    function test_attack_fallbackDecisionOnReleasedDeal_isRefused() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        vm.warp(t.timing.judgeBy);
        H.Decision memory m = _beaconDecision(id, H.ROLE_FALLBACK, H.OUTCOME_REJECT, t.timing.judgeBy);
        m = _signDecision(t, id, m, fallbackAdj, FB_PK);
        vm.expectRevert(abi.encodeWithSelector(IHoldbackRules.WrongStage.selector, IHoldbackRules.Stage.Released));
        rules.decide(t, m, _noDelivery(), "");
        vm.expectRevert(abi.encodeWithSelector(IHoldbackRules.WrongStage.selector, IHoldbackRules.Stage.Released));
        rules.triggerFallback(t);
    }

    /// The primary cannot decide twice (a second, opposite decision with another nonce).
    function test_attack_primaryCannotDecideTwice() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_REJECT), _noDelivery(), "");
        H.Decision memory m = _decision(H.ROLE_PRIMARY, H.OUTCOME_ACCEPT);
        m.nonce = keccak256("second");
        m = _signDecision(t, id, m, adjudicator, ADJ_PK);
        vm.expectRevert(abi.encodeWithSelector(IHoldbackRules.WrongStage.selector, IHoldbackRules.Stage.Refunded));
        rules.decide(t, m, _noDelivery(), "");
    }

    /// No timeout and no settlement reopens a decided deal.
    function test_attack_noExitAppliesToADecidedDeal() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        vm.warp(t.timing.fallbackBy + t.timing.appealDecideSec + MARGIN);
        bytes memory wrong = abi.encodeWithSelector(IHoldbackRules.WrongStage.selector, IHoldbackRules.Stage.Released);
        vm.expectRevert(wrong);
        rules.reclaim(t);
        vm.expectRevert(wrong);
        rules.triggerFallback(t);
        vm.expectRevert(wrong);
        rules.triggerDefault(t);
    }

    /// An escalation's reject cannot carry the buyer's key.
    function test_attack_escalationRejectCarryingKey_isRefused() public {
        (H.Terms memory t, bytes32 id) = _funded();
        uint64 at = _escalateByPrimary(t, id);
        vm.warp(at + 1);
        H.Decision memory m = _beaconDecision(id, H.ROLE_APPEAL, H.OUTCOME_REJECT, at + 1);
        (m.keyScheme, m.keyCiphertext) = (KEY_SCHEME, KEY_CT);
        m = _signDecision(t, id, m, appealAdj, AP_PK);
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    /// Only the appeal adjudicator decides an escalated case: the primary and the fallback, under their own roles,
    /// are refused.
    function test_attack_primaryOrFallbackCannotDecideAnEscalatedCase() public {
        (H.Terms memory t, bytes32 id) = _funded();
        uint64 at = _escalateByPrimary(t, id);
        vm.warp(at + 1);
        H.Decision memory p = _decision(H.ROLE_PRIMARY, H.OUTCOME_ACCEPT);
        p.nonce = keccak256("after escalation");
        p = _signDecision(t, id, p, adjudicator, ADJ_PK);
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.decide(t, p, _noDelivery(), "");
        H.Decision memory f = _beaconDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, t.timing.judgeBy);
        f = _signDecision(t, id, f, fallbackAdj, FB_PK);
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.decide(t, f, _noDelivery(), "");
    }

    /// An escalation's accept pays the price to the seller and the fee to the appeal adjudicator, nobody else, and
    /// releases the key to the buyer in the same transaction.
    function test_attack_escalationAccept_paysTheTermsPartiesOnly() public {
        (H.Terms memory t, bytes32 id) = _funded();
        uint64 at = _escalateByPrimary(t, id);
        vm.warp(at + 1);
        uint256 s0 = usdc.balanceOf(seller);
        vm.recordLogs();
        rules.decide(t, _appealDecision(t, id, H.OUTCOME_ACCEPT, at), _noDelivery(), "");
        assertEq(_keyReleases(vm.getRecordedLogs()), 1, "one key release");
        assertEq(usdc.balanceOf(seller) - s0, PRICE, "the seller gets the price");
        assertEq(usdc.balanceOf(appealAdj), FEE, "the appeal adjudicator gets the fee");
        assertEq(usdc.balanceOf(adjudicator), 0, "the escalating primary gets nothing");
        assertEq(usdc.balanceOf(fallbackAdj), 0);
        assertEq(_held(t), 0, "nothing stays in the escrow");
    }

    // ------------------------------------------------------------ Q1: every funded stage has an exit anyone takes

    /// neutrality: the primary and the fallback both go silent after the delivery. A stranger triggers the fallback
    /// and then the default; the buyer gets price + fee back. No adjudicator, operator or party is needed.
    function test_neutrality_everyAdjudicatorOffline_strangerCloses() public {
        uint256 b0 = usdc.balanceOf(buyer);
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        address stranger = makeAddr("stranger");
        vm.warp(t.timing.judgeBy);
        vm.prank(stranger);
        rules.triggerFallback(t);
        vm.warp(t.timing.fallbackBy);
        vm.prank(stranger);
        rules.triggerDefault(t);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Refunded));
        assertEq(usdc.balanceOf(buyer), b0, "price + fee back to the buyer");
        assertEq(_held(t), 0);
    }

    /// neutrality: the appeal adjudicator goes silent after the primary escalates. The default is due exactly at
    /// t1 + appealDecideSec and not a second before.
    function test_neutrality_appealAdjudicatorOffline_afterPrimaryEscalation() public {
        uint256 b0 = usdc.balanceOf(buyer);
        (H.Terms memory t, bytes32 id) = _funded();
        uint64 at = _escalateByPrimary(t, id);
        vm.warp(uint256(at) + t.timing.appealDecideSec - 1);
        vm.expectRevert(IHoldbackRules.TooEarly.selector);
        rules.triggerDefault(t);
        vm.warp(uint256(at) + t.timing.appealDecideSec);
        vm.prank(makeAddr("stranger"));
        rules.triggerDefault(t);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Refunded));
        assertEq(usdc.balanceOf(buyer), b0);
    }

    /// The latest possible capture: the fallback escalates in the last second of its turn, and the appeal adjudicator
    /// accepts in the last second of its window. The escrow's expiry (fallbackBy + appealDecideSec + margin) is still
    /// ahead, so the capture succeeds; with no appeal window left, nothing is decided later than this.
    function test_neutrality_latestEscalationDecision_stillCaptures() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        vm.warp(t.timing.fallbackBy - 1);
        uint64 at = uint64(block.timestamp);
        H.Decision memory f = _beaconDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ESCALATE, t.timing.judgeBy);
        rules.decide(t, _signDecision(t, id, f, fallbackAdj, FB_PK), _noDelivery(), "");
        vm.warp(uint256(at) + t.timing.appealDecideSec - 1);
        assertLt(block.timestamp, _pi(t).authorizationExpiry, "before the escrow's expiry");
        rules.decide(t, _appealDecision(t, id, H.OUTCOME_ACCEPT, at), _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Released));
        assertEq(usdc.balanceOf(appealAdj), FEE);
    }

    /// After the escrow's expiry the buyer reclaims on the escrow directly; the escalated deal still closes by the
    /// timeout (no exit always reverts).
    function test_neutrality_escalatedDeal_closesAfterTheBuyersOwnReclaim() public {
        uint256 b0 = usdc.balanceOf(buyer);
        (H.Terms memory t, bytes32 id) = _funded();
        _escalateByPrimary(t, id);
        AuthCaptureEscrow.PaymentInfo memory pi = _pi(t);
        vm.warp(pi.authorizationExpiry);
        vm.prank(buyer);
        escrow.reclaim(pi);
        assertEq(usdc.balanceOf(buyer), b0, "the buyer has everything back");
        rules.triggerDefault(t);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Refunded), "the deal still closes");
    }

    // ------------------------------------------------------------ issues

    /// Finding RT-2 (Info): the appeal adjudicator's decision on an escalation may carry any `appealGround`. The
    /// first-instance check (`_firstInstance`) refuses a nonempty ground; `_escalationDecision` checks nothing. The
    /// state model's §8.3 verdict 8 says phase one enforces it empty for every role. Money and key are unaffected.
    function test_issue_escalationDecisionAcceptsAnyAppealGround() public {
        (H.Terms memory t, bytes32 id) = _funded();
        uint64 at = _escalateByPrimary(t, id);
        vm.warp(at + 1);
        H.Decision memory m = _beaconDecision(id, H.ROLE_APPEAL, H.OUTCOME_REJECT, at + 1);
        m.appealGroundHash = keccak256("the buyer appealed and won");
        m = _signDecision(t, id, m, appealAdj, AP_PK);
        rules.decide(t, m, _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Refunded), "accepted with a nonempty appeal ground");
    }

    /// Finding RT-1 (Low): the stored word does not record who decided. A primary's accept (§9.3 row P06, fee to the
    /// primary) and an appeal adjudicator's accept of the primary's escalation (row P10, fee to the appeal
    /// adjudicator) leave identical words when the primary acts in the same second.
    function test_issue_wordCannotTellPrimaryAcceptFromEscalationAccept() public {
        (H.Terms memory ta, bytes32 a) = _funded();
        (H.Terms memory tb, bytes32 b) = _funded();
        _deliver(ta, a);
        rules.decide(ta, _primary(ta, a, H.OUTCOME_ACCEPT), _noDelivery(), "");
        uint64 at = _escalateByPrimary(tb, b);
        vm.warp(at + 1);
        rules.decide(tb, _appealDecision(tb, b, H.OUTCOME_ACCEPT, at), _noDelivery(), "");

        IHoldbackRules.Deal memory da = rules.dealOf(a);
        IHoldbackRules.Deal memory db = rules.dealOf(b);
        assertEq(uint8(da.stage), uint8(db.stage), "stage");
        assertEq(da.attempt, db.attempt, "attempt");
        assertEq(da.t1, db.t1, "t1");
        // Since L-4 (T-380) each deal's tag binds its own ID: it says which deal, never who decided.
        assertEq(da.seedTag, H.seedTag(keccak256(abi.encodePacked(SEED)), a), "seedTag a");
        assertEq(db.seedTag, H.seedTag(keccak256(abi.encodePacked(SEED)), b), "seedTag b");
        assertEq(usdc.balanceOf(adjudicator), FEE, "P06 paid the primary");
        assertEq(usdc.balanceOf(appealAdj), FEE, "P10 paid the appeal adjudicator");
    }

    /// Finding RT-1 (Low): an escalation's reject (§9.3 row P11, the fee to the appeal adjudicator) and a default
    /// after an escalation (row P12, everything back to the buyer) leave identical words. Only the escrow's
    /// refundable amount, or the events, tell them apart.
    function test_issue_wordCannotTellEscalationRejectFromDefault() public {
        (H.Terms memory ta, bytes32 a) = _funded();
        (H.Terms memory tb, bytes32 b) = _funded();
        uint64 at = _escalateByPrimary(ta, a);
        assertEq(_escalateByPrimary(tb, b), at);
        vm.warp(at + 1);
        rules.decide(ta, _appealDecision(ta, a, H.OUTCOME_REJECT, at), _noDelivery(), "");
        vm.warp(uint256(at) + tb.timing.appealDecideSec);
        rules.triggerDefault(tb);

        IHoldbackRules.Deal memory da = rules.dealOf(a);
        IHoldbackRules.Deal memory db = rules.dealOf(b);
        assertEq(uint8(da.stage), uint8(IHoldbackRules.Stage.Refunded));
        assertEq(uint8(da.stage), uint8(db.stage), "stage");
        assertEq(da.attempt, db.attempt, "attempt");
        assertEq(da.t1, db.t1, "t1");
        // Since L-4 (T-380) each deal's tag binds its own ID: it says which deal, never who decided.
        assertEq(da.seedTag, H.seedTag(keccak256(abi.encodePacked(SEED)), a), "seedTag a");
        assertEq(db.seedTag, H.seedTag(keccak256(abi.encodePacked(SEED)), b), "seedTag b");
        (, uint120 ra) = _refundable(ta);
        (, uint120 rb) = _refundable(tb);
        assertEq(ra, FEE, "P11: the fee was captured");
        assertEq(rb, 0, "P12: nothing was captured");
    }
}
