// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {IHoldbackBeacon} from "../../src/IHoldbackBeacon.sol";
import {DrandQuicknetBeacon} from "../../src/DrandQuicknetBeacon.sol";
import {SimBeacon} from "../../script/SimBeacon.sol";
import {Base} from "./Base.sol";

/// The rules contract with its internal round rule exposed, for the delay property (ADR-0032 §3.6).
contract RoundsHarness is HoldbackRules {
    constructor(AuthCaptureEscrow escrow, IHoldbackBeacon beacon, uint64 beaconMargin)
        HoldbackRules(escrow, address(2), 1 days, beacon, address(3), beaconMargin)
    {}

    function roundAfter(uint256 lastChoice) external view returns (uint64) {
        return _roundAfter(lastChoice);
    }
}

/// @title The beacon margin on the sim beacon (T-380, R8 fix 2; ADR-0032)
/// @notice The rules contract takes each panel's round BEACON_MARGIN seconds after the last moment a choice can
///         still be made: `roundAt(lastChoice + BEACON_MARGIN) + 1`, with lastChoice = judgeBy - 1 for the fallback
///         and the escalation's block time for the appeal adjudicator. On the sim beacon (round(t) = t) with a margin
///         of 7 s, the fallback's round is judgeBy + 7 and an escalation's at t1 is t1 + 8, and each settles once the
///         clock reaches it. On the parent the rounds were judgeBy and t1 + 1: the tests that name the margin rounds
///         fail there. The drand tests (`DrandRedTeam.t.sol`, `DrandDecide.t.sol`) deploy with 29 s.
contract BeaconMarginTest is Base {
    uint64 internal constant M = 7;

    function _beaconMargin() internal pure override returns (uint64) {
        return M;
    }

    function _fallbackDecision(H.Terms memory t, bytes32 id, uint8 outcome, uint64 round)
        internal
        view
        returns (H.Decision memory m)
    {
        m = _signDecision(t, id, _beaconDecision(id, H.ROLE_FALLBACK, outcome, round), fallbackAdj, FB_PK);
    }

    function _appealDecision(H.Terms memory t, bytes32 id, uint8 outcome, uint64 round)
        internal
        view
        returns (H.Decision memory m)
    {
        m = _signDecision(t, id, _beaconDecision(id, H.ROLE_APPEAL, outcome, round), appealAdj, AP_PK);
    }

    function _toFallback() internal returns (H.Terms memory t, bytes32 id) {
        (t, id) = _funded();
        _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        vm.expectEmit(address(rules));
        emit HoldbackRules.FallbackTriggered(id, uint64(t.timing.judgeBy) + M);
        rules.triggerFallback(t);
    }

    function test_margin_isTheConstructorValue() public view {
        assertEq(rules.BEACON_MARGIN(), M);
    }

    function test_fallback_takesTheRoundAfterJudgeByPlusTheMargin() public {
        (H.Terms memory t, bytes32 id) = _toFallback();
        uint64 round = uint64(t.timing.judgeBy) + M;
        // The round at judgeBy, the parent's rule: refused.
        H.Decision memory old = _fallbackDecision(t, id, H.OUTCOME_ACCEPT, uint64(t.timing.judgeBy));
        vm.expectRevert(HoldbackRules.BadSeed.selector);
        rules.decide(t, old, _noDelivery(), "");
        // The margin round, before the clock reaches it: the beacon has no value yet.
        H.Decision memory m = _fallbackDecision(t, id, H.OUTCOME_ACCEPT, round);
        vm.expectRevert(SimBeacon.RoundUnavailable.selector);
        rules.decide(t, m, _noDelivery(), "");
        vm.warp(round);
        rules.decide(t, m, _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
    }

    function test_escalation_takesTheRoundAfterItsBlockPlusTheMargin() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        uint64 at = uint64(block.timestamp);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        vm.warp(at + 1);
        H.Decision memory old = _appealDecision(t, id, H.OUTCOME_REJECT, at + 1);
        vm.expectRevert(HoldbackRules.BadSeed.selector);
        rules.decide(t, old, _noDelivery(), "");
        vm.warp(at + M + 1);
        rules.decide(t, _appealDecision(t, id, H.OUTCOME_REJECT, at + M + 1), _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
    }

    /// A fallback that escalates: the round follows the block time of the fallback's escalation, not judgeBy.
    function test_fallbackEscalation_takesTheRoundAfterTheFallbacksEscalation() public {
        (H.Terms memory t, bytes32 id) = _toFallback();
        vm.warp(uint256(t.timing.judgeBy) + M + 100);
        uint64 at = uint64(block.timestamp);
        rules.decide(
            t, _fallbackDecision(t, id, H.OUTCOME_ESCALATE, uint64(t.timing.judgeBy) + M), _noDelivery(), ""
        );
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Escalated));
        assertEq(rules.dealOf(id).t1, at);
        vm.warp(at + M + 1);
        H.Decision memory old = _appealDecision(t, id, H.OUTCOME_ACCEPT, uint64(t.timing.judgeBy) + M + 1);
        vm.expectRevert(HoldbackRules.BadSeed.selector);
        rules.decide(t, old, _noDelivery(), "");
        rules.decide(t, _appealDecision(t, id, H.OUTCOME_ACCEPT, at + M + 1), _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
    }

    /// The window still counts from the escalation's block (ADR-0032 §5): the margin uses part of it, and a decision
    /// on the round at the deadline itself is refused as late.
    function test_escalation_deadlineUnchangedByTheMargin() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        uint64 at = uint64(block.timestamp);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        vm.warp(uint256(at) + t.timing.appealDecideSec);
        H.Decision memory late = _appealDecision(t, id, H.OUTCOME_REJECT, at + M + 1);
        vm.expectRevert(HoldbackRules.DeadlinePassed.selector);
        rules.decide(t, late, _noDelivery(), "");
        rules.triggerDefault(t);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
    }

    // ------------------------------------------------------------ the constructor (ADR-0032 §3.4)

    function test_constructor_refusesAZeroMarginOffTheLocalChain() public {
        vm.chainId(11_155_111); // Sepolia
        vm.expectRevert(HoldbackRules.NoBeaconMargin.selector);
        new HoldbackRules(escrow, address(collector3009), MARGIN, sim, address(usdc), 0);
        HoldbackRules ok = new HoldbackRules(escrow, address(collector3009), MARGIN, sim, address(usdc), 29);
        assertEq(ok.BEACON_MARGIN(), 29);
    }

    function test_constructor_takesAZeroMarginOnTheLocalChain() public {
        vm.chainId(31337);
        HoldbackRules ok = new HoldbackRules(escrow, address(collector3009), MARGIN, sim, address(usdc), 0);
        assertEq(ok.BEACON_MARGIN(), 0);
    }

    // ------------------------------------------------------------ the delay, as a property (ADR-0032 §3.6)

    /// For every lastChoice in 300 consecutive seconds of the drand clock, the round the contract demands is published
    /// between BEACON_MARGIN + 1 and BEACON_MARGIN + 3 seconds after it, and the round before it no later than
    /// lastChoice + BEACON_MARGIN.
    function test_property_drandRoundPublishesMarginPlusOneToThreeSecondsAfterTheLastChoice() public {
        DrandQuicknetBeacon drand = new DrandQuicknetBeacon();
        uint256 g = drand.GENESIS();
        for (uint64 margin = 0; margin <= 29; margin += 29) {
            RoundsHarness h = new RoundsHarness(escrow, drand, margin);
            for (uint256 t = 1_790_000_000; t < 1_790_000_300; t++) {
                uint256 r = h.roundAfter(t);
                uint256 published = g + (r - 1) * 3;
                assertGe(published, t + margin + 1, "published too early");
                assertLe(published, t + margin + 3, "published too late");
                assertLe(g + (r - 2) * 3, t + margin, "not the first such round");
            }
        }
    }
}
