// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackBonds} from "../../src/HoldbackBonds.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-335: the T-206 adversarial pass's UnbondedDecider tests (2026-11-03, against baac930), ported to HEAD. Finding
/// L-5 (litmus 3, ADR-0016 §1): at baac930 a fallback or appeal adjudicator with no bond still decided. The fallback's
/// part is fixed in PR #135 (M-3): the fallback's own decision encumbers its bond, so an uncovered fallback cannot
/// decide and the deal defaults. The appeal adjudicator's part is still open; two tests stay attack-shaped.
contract UnbondedDeciderTest is Base {
    /// L-5 (fallback part), fixed in PR #135. Was test_attack_fallback_decides_with_no_bond_at_stake: the fallback
    /// withdrew its whole bond and was paid the fee for an accept. Now its decision is refused and the deal defaults.
    function test_regression_fallback_decides_with_no_bond_at_stake() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        vm.prank(fallbackAdj);
        bonds.withdraw(address(usdc), BOND); // nothing is encumbered on it yet: the whole bond leaves
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        H.Decision memory m = _beaconDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, t.timing.judgeBy);
        m = _signDecision(t, id, m, fallbackAdj, FB_PK);
        vm.expectRevert(abi.encodeWithSelector(HoldbackBonds.InsufficientFreeBond.selector, 0, PRICE));
        rules.decide(t, m, _noDelivery(), "");
        assertEq(usdc.balanceOf(fallbackAdj), BOND, "no fee without a bond at stake");

        vm.warp(t.timing.fallbackBy);
        rules.triggerDefault(t);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded), "the deal goes to the default outcome");
    }

    // Open: L-5. This test flips when the contract lane (T-212 / pilot C3-C5) fixes it.
    /// The appeal adjudicator withdraws its whole bond, and its decision after an escalation is final, unappealable
    /// and unbonded.
    function test_attack_appeal_adjudicator_decides_escalation_with_no_bond_at_stake() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        vm.prank(appealAdj);
        bonds.withdraw(address(usdc), BOND);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        assertEq(rules.dealOf(id).flags, 0, "no reservation at all remains on the deal");
        uint64 at = uint64(block.timestamp);
        vm.warp(at + 1);
        H.Decision memory m = _beaconDecision(id, H.ROLE_APPEAL, H.OUTCOME_ACCEPT, at + 1);
        m = _signDecision(t, id, m, appealAdj, AP_PK);
        rules.decide(t, m, _noDelivery(), ""); // final, not appealable, unbonded
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Closed));
        assertEq(bonds.bondOf(appealAdj, address(usdc)), 0);
        assertEq(usdc.balanceOf(appealAdj), BOND + FEE, "paid the fee with zero bond at stake");
    }

    // Open: L-5. This test flips when the contract lane (T-212 / pilot C3-C5) fixes it.
    /// On a party appeal the appeal adjudicator's bond is never encumbered. Extended past baac930: since the overturn
    /// payout (PR #160), the unbonded appeal adjudicator's overturn moves the price out of the primary's bond.
    function test_attack_party_appeal_adjudicator_has_nothing_at_stake() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        vm.prank(appealAdj);
        bonds.withdraw(address(usdc), BOND);
        vm.prank(buyer);
        usdc.approve(address(bonds), type(uint256).max);
        H.Appeal memory a =
            H.Appeal({appellant: 0, groundsHash: keccak256("g"), bond: 1_000, filedAt: 0, signature: ""});
        a.signature = _sign(BUYER_PK, hx.appeal(id, buyer, t.token, a));
        rules.fileAppeal(t, a);
        assertEq(bonds.encumberedOf(appealAdj, address(usdc)), 0);

        uint64 round = uint64(rules.dealOf(id).t2) + 1;
        vm.warp(round);
        uint256 b0 = usdc.balanceOf(buyer);
        H.Decision memory m = _beaconDecision(id, H.ROLE_APPEAL, H.OUTCOME_REJECT, round);
        rules.decide(t, _signDecision(t, id, m, appealAdj, AP_PK), _noDelivery(), "");
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Overturned));
        assertEq(usdc.balanceOf(buyer), b0 + PRICE + 1_000, "the price from the primary's bond, and the appeal bond");
        assertEq(bonds.bondOf(adjudicator, address(usdc)), BOND - PRICE);
        assertEq(bonds.bondOf(appealAdj, address(usdc)), 0, "the decider of the final word had nothing at stake");
    }
}
