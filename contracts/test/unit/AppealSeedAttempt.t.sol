// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-335: the T-206 adversarial pass's AppealSeedAttempt tests (2026-11-03, against baac930), ported to HEAD.
/// Finding H-1 (litmus 3, ADR-0018: no field the decider controls may change the seed). `panelSeed` hashes the
/// Decision's `attempt`; at baac930 only `_firstInstance` compared it with the delivered attempt, so the appeal
/// adjudicator could pick among 256 valid seeds for one beacon round. Fixed in PR #120: `decide` compares the attempt
/// for every role. The three attacks are regressions now; the fallback control kept its name.
contract AppealSeedAttemptTest is Base {
    function _appealWithAttempt(bytes32 id, uint8 outcome, uint64 round, uint8 attempt)
        internal
        view
        returns (H.Decision memory m)
    {
        m = _decision(H.ROLE_APPEAL, outcome);
        m.attempt = attempt;
        m.beaconSourceHash = keccak256("sim");
        m.beaconRound = round;
        m.beaconValue = _simValue(round);
        m.seed = hx.panelSeed(id, H.ROLE_APPEAL, attempt, m.beaconValue);
    }

    function _escalated() internal returns (H.Terms memory t, bytes32 id, uint64 at) {
        (t, id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        at = uint64(block.timestamp);
    }

    /// H-1, fixed in PR #120. Was test_attack_appeal_after_escalation_attempt_changes_seed: after an escalation the
    /// appeal adjudicator signed attempt 7 (the delivery is attempt 1) and got another panel seed, final. Now the
    /// attempt-7 decision is refused, and the honest attempt-1 decision still settles.
    function test_regression_appeal_after_escalation_attempt_changes_seed() public {
        (H.Terms memory t, bytes32 id, uint64 at) = _escalated();
        vm.warp(at + 1);
        bytes32 honest = hx.panelSeed(id, H.ROLE_APPEAL, 1, _simValue(at + 1));
        H.Decision memory m = _appealWithAttempt(id, H.OUTCOME_ACCEPT, at + 1, 7);
        assertTrue(m.seed != honest, "attempt 7 names a different panel");
        m = _signDecision(t, id, m, appealAdj, AP_PK);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Escalated), "nothing settled");

        H.Decision memory ok = _appealWithAttempt(id, H.OUTCOME_ACCEPT, at + 1, 1);
        assertEq(ok.seed, honest);
        rules.decide(t, _signDecision(t, id, ok, appealAdj, AP_PK), _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
        assertEq(rules.dealOf(id).attempt, 1, "the chain records delivery attempt 1");
    }

    /// H-1, fixed in PR #120. Was test_attack_appeal_attempt_gives_256_valid_seeds: attempts 0, 77 and 255 were each
    /// accepted on three deals. Now each is refused. Every attempt byte still hashes to a distinct seed, which is why
    /// the contract must pin it.
    function test_regression_appeal_attempt_gives_256_valid_seeds() public {
        uint8[3] memory attempts = [0, 77, 255];
        for (uint256 i; i < attempts.length; i++) {
            (H.Terms memory t, bytes32 id, uint64 at) = _escalated();
            vm.warp(at + 1);
            H.Decision memory m = _appealWithAttempt(id, H.OUTCOME_REJECT, at + 1, attempts[i]);
            m = _signDecision(t, id, m, appealAdj, AP_PK);
            vm.expectRevert(HoldbackRules.InvalidMessage.selector);
            rules.decide(t, m, _noDelivery(), "");
            assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Escalated));
        }
        bytes32 v = _simValue(12345);
        bytes32 id0 = keccak256("any commitment");
        bytes32 honest = hx.panelSeed(id0, H.ROLE_APPEAL, 1, v);
        for (uint256 a; a < 256; a++) {
            if (a == 1) continue;
            assertTrue(hx.panelSeed(id0, H.ROLE_APPEAL, uint8(a), v) != honest, "each attempt is another seed");
        }
    }

    /// H-1, fixed in PR #120. Was test_attack_party_appeal_attempt_changes_seed: the same gap on a party appeal, with
    /// attempt 200. Now refused; the appeal stays open.
    function test_regression_party_appeal_attempt_changes_seed() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        vm.prank(buyer);
        usdc.approve(address(bonds), type(uint256).max);
        H.Appeal memory a = H.Appeal({
            appellant: 0,
            groundsHash: keccak256("fails check rows"),
            bond: 1_300_000,
            filedAt: uint64(block.timestamp),
            signature: ""
        });
        a.signature = _sign(BUYER_PK, hx.appeal(id, buyer, t.token, a));
        rules.fileAppeal(t, a);
        uint64 opened = uint64(block.timestamp);
        vm.warp(opened + 1);
        H.Decision memory m = _appealWithAttempt(id, H.OUTCOME_REJECT, opened + 1, 200);
        m = _signDecision(t, id, m, appealAdj, AP_PK);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Open));
    }

    /// Control, unchanged since baac930: the fallback role is bound to the delivery attempt.
    function test_defense_fallback_attempt_is_bound() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        H.Decision memory m = _decision(H.ROLE_FALLBACK, H.OUTCOME_ACCEPT);
        m.attempt = 7;
        m.beaconSourceHash = keccak256("sim");
        m.beaconRound = t.timing.judgeBy;
        m.beaconValue = _simValue(t.timing.judgeBy);
        m.seed = hx.panelSeed(id, H.ROLE_FALLBACK, 7, m.beaconValue);
        m = _signDecision(t, id, m, fallbackAdj, FB_PK);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
    }
}
