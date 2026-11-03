// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackBonds} from "../../src/HoldbackBonds.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-206 M-3 (from the public-audit cross-check, class "locking a third party's collateral without its consent"):
/// the fallback and appeal adjudicators sign nothing at agreement, so nothing may reserve their bonds until they act
/// (ADR-0016 §1: "Sham commitments cannot lock a bond the adjudicator never reserved"). The fallback reserves its own
/// bond by deciding; uncovered, it cannot decide and the deal defaults.
contract BondConsentTest is Base {
    uint64 internal constant LONG = 36_500 days;

    /// A sham deal: one actor is buyer, seller and primary, the price is the victims' whole free bond, and every
    /// window is a century (D31).
    function _sham() internal returns (H.Terms memory t, bytes32 id) {
        usdc.mint(buyer, BOND);
        t = _terms();
        t.price = BOND;
        t.timing.fallbackBy = t.timing.judgeBy + LONG;
        t.timing.appealDecideSec = LONG;
        id = _fund(t);
        _deliver(t, id);
    }

    /// The victim's bond is still free: it can withdraw it and accept a new deal as primary.
    function _assertFree(address victim, uint256 victimPk) internal {
        assertEq(bonds.freeOf(victim, address(usdc)), BOND);
        H.Terms memory honest = _terms();
        honest.adjudicator = victim;
        bytes memory sellerSig = _sellerSig(honest, SELLER_PK);
        H.Acceptance memory acc = _acceptance(honest, victimPk);
        H.Agree memory ag = _agree(honest, BUYER_PK);
        H.Funding memory f = _erc3009(honest, BUYER_PK);
        rules.agreeAndFund(honest, sellerSig, acc, ag, f);
    }

    function test_shamDeal_triggerFallbackReservesNothing() public {
        (H.Terms memory t,) = _sham();
        vm.warp(t.timing.judgeBy);
        vm.prank(makeAddr("anyone"));
        rules.triggerFallback(t);
        _assertFree(fallbackAdj, FB_PK);
    }

    function test_shamEscalation_reservesNothingForTheAppealAdjudicator() public {
        (H.Terms memory t, bytes32 id) = _sham();
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        _assertFree(appealAdj, AP_PK);
    }

    function _toFallback() internal returns (H.Terms memory t, bytes32 id) {
        (t, id) = _funded();
        _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
    }

    /// The fallback withdrew its whole bond before the takeover, so it has no cover when it takes the case.
    function _toUncoveredFallback() internal returns (H.Terms memory t, bytes32 id) {
        (t, id) = _funded();
        _deliver(t, id);
        vm.prank(fallbackAdj);
        bonds.withdraw(address(usdc), BOND);
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
    }

    function _fallbackDecision(H.Terms memory t, bytes32 id, uint8 outcome) internal view returns (H.Decision memory) {
        H.Decision memory m = _beaconDecision(id, H.ROLE_FALLBACK, outcome, t.timing.judgeBy);
        return _signDecision(t, id, m, fallbackAdj, FB_PK);
    }

    /// Deciding is the fallback's consent: its bond backs the decision until the appeal closes.
    function test_fallbackDecision_reservesItsBondUntilTheAppealCloses() public {
        (H.Terms memory t, bytes32 id) = _toFallback();
        rules.decide(t, _fallbackDecision(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        assertEq(bonds.encumberedOf(fallbackAdj, address(usdc)), PRICE);
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0, "the silent primary's reservation is released");
        vm.warp(block.timestamp + t.timing.appealWindowSec);
        rules.expireAppeal(t);
        assertEq(bonds.encumberedOf(fallbackAdj, address(usdc)), 0);
    }

    /// ADR-0016 §1: a fallback that lacks coverage when it takes the case cannot decide; the deal defaults.
    function test_uncoveredFallback_cannotDecide_dealDefaults() public {
        (H.Terms memory t, bytes32 id) = _toUncoveredFallback();
        H.Decision memory m = _fallbackDecision(t, id, H.OUTCOME_ACCEPT);
        vm.expectRevert(abi.encodeWithSelector(HoldbackBonds.InsufficientFreeBond.selector, 0, PRICE));
        rules.decide(t, m, _noDelivery(), "");
        vm.warp(t.timing.fallbackBy);
        uint256 b0 = usdc.balanceOf(buyer);
        rules.triggerDefault(t);
        assertEq(usdc.balanceOf(buyer), b0 + PRICE + FEE);
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
    }

    /// An escalation moves no money, so an uncovered fallback may still hand the case to the appeal adjudicator.
    function test_uncoveredFallback_mayEscalate() public {
        (H.Terms memory t, bytes32 id) = _toUncoveredFallback();
        rules.decide(t, _fallbackDecision(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Escalated));
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
    }

    /// One address as primary and fallback, its bond fully booked by this deal: the release and the fallback's own
    /// reservation net to one reservation.
    function test_samePrimaryAndFallback_fullyBooked_decidesWithOneReservation() public {
        H.Terms memory t = _terms();
        t.fallbackAdjudicator = adjudicator;
        t.price = BOND;
        usdc.mint(buyer, BOND);
        bytes32 id = _fund(t);
        _deliver(t, id);
        assertEq(bonds.freeOf(adjudicator, address(usdc)), 0);
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        H.Decision memory m = _beaconDecision(id, H.ROLE_FALLBACK, H.OUTCOME_REJECT, t.timing.judgeBy);
        rules.decide(t, _signDecision(t, id, m, adjudicator, ADJ_PK), _noDelivery(), "");
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), BOND);
        assertEq(uint8(rules.dealOf(id).flags), 2 | 8, "F_FALLBACK | F_BY_FALLBACK");
    }
}
