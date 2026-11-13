// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {IHoldbackRules} from "../../src/IHoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-335: the T-206 adversarial pass's LateDelivery tests (2026-11-03, against baac930), ported to HEAD. Finding M-2
/// (litmus 2): at baac930 `deliver` enforced `deliverBy`, but the delivery a `decide` carried in `Held` did not, so
/// after `deliverBy` a late accept or escalation raced the buyer's reclaim. Fixed in PR #127: `_acceptDelivery`
/// refuses a delivery at or after `deliverBy`, whichever call carries it. The two attacks are regressions now.
/// The recovered source had one edit that did not apply; this port follows the review's description of the attack.
contract LateDeliveryTest is Base {
    /// M-2, fixed in PR #127. Was test_attack_late_delivery_carried_by_decide_beats_reclaim: on deal B the late
    /// delivery rode on the primary's accept and took the price. Now that accept is refused and both deals reclaim.
    function test_regression_late_delivery_carried_by_decide_beats_reclaim() public {
        (H.Terms memory tA, bytes32 idA) = _funded();
        (H.Terms memory tB, bytes32 idB) = _funded();
        (H.Delivery memory d,) = _delivery();
        bytes memory sigA = _deliverySig(idA, d, SELLER_PK);
        vm.warp(tA.timing.deliverBy + 1 hours); // past deliverBy, before judgeBy

        vm.expectRevert(IHoldbackRules.DeadlinePassed.selector);
        rules.deliver(tA, d, sigA);
        rules.reclaim(tA);
        assertEq(uint8(_stage(idA)), uint8(IHoldbackRules.Stage.Refunded));

        // Deal B, same instant: the late delivery carried by the primary's accept is refused.
        uint256 s0 = usdc.balanceOf(seller);
        bytes memory dsig = _deliverySig(idB, d, SELLER_PK);
        H.Decision memory accept = _primary(tB, idB, H.OUTCOME_ACCEPT);
        vm.expectRevert(IHoldbackRules.DeadlinePassed.selector);
        rules.decide(tB, accept, d, dsig);
        assertEq(usdc.balanceOf(seller), s0, "no price for work delivered after deliverBy");
        rules.reclaim(tB);
        assertEq(uint8(_stage(idB)), uint8(IHoldbackRules.Stage.Refunded));
    }

    /// M-2, fixed in PR #127. Was test_attack_late_delivery_carried_by_escalate_blocks_reclaim: a late escalation
    /// turned a reclaimable hold into an Escalated case. Now it is refused and the reclaim goes through.
    function test_regression_late_delivery_carried_by_escalate_blocks_reclaim() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d,) = _delivery();
        vm.warp(t.timing.deliverBy + 1 hours);
        H.Decision memory esc = _primary(t, id, H.OUTCOME_ESCALATE);
        bytes memory dsig = _deliverySig(id, d, SELLER_PK);
        vm.expectRevert(IHoldbackRules.DeadlinePassed.selector);
        rules.decide(t, esc, d, dsig);
        rules.reclaim(t);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Refunded));
    }
}
