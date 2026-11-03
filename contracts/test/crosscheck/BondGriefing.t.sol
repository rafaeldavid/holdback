// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackBonds} from "../../src/HoldbackBonds.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "../unit/Base.sol";

/// Public-audit cross-check, class "locking a third party's collateral without its consent" (staking and bond
/// griefing). ADR-0016 §1: "Sham commitments cannot lock a bond the adjudicator never reserved", and the fallback and
/// appeal adjudicators' bond "is reserved only when they take a case". On chain, the fallback's bond is encumbered by
/// `triggerFallback` (anyone, at judgeBy) and the appeal adjudicator's by the primary's escalation, and neither signs
/// anything. One actor holding the buyer, seller and primary keys names a bonded victim and chooses how long the lock
/// lasts (every window is a free parameter, D31).
contract BondGriefingTest is Base {
    uint64 internal constant LONG = 36_500 days;

    /// A sham deal: the attacker is buyer, seller and primary; the price equals the victims' whole free bond.
    function _sham() internal returns (H.Terms memory t, bytes32 id) {
        usdc.mint(buyer, BOND);
        t = _terms();
        t.price = BOND;
        t.timing.fallbackBy = t.timing.judgeBy + LONG;
        t.timing.appealDecideSec = LONG;
        id = _fund(t);
        _deliver(t, id);
    }

    /// The victim's free bond is gone, so it can neither withdraw nor accept a new deal as primary.
    function _assertLocked(address victim, uint256 victimPk) internal {
        assertEq(bonds.freeOf(victim, address(usdc)), 0);
        vm.prank(victim);
        vm.expectRevert(abi.encodeWithSelector(HoldbackBonds.InsufficientFreeBond.selector, 0, 1));
        bonds.withdraw(address(usdc), 1);

        H.Terms memory honest = _terms();
        honest.adjudicator = victim;
        bytes memory sellerSig = _sellerSig(honest, SELLER_PK);
        H.Acceptance memory acc = _acceptance(honest, victimPk);
        H.Agree memory ag = _agree(honest, BUYER_PK);
        H.Funding memory f = _erc3009(honest, BUYER_PK);
        vm.expectRevert(abi.encodeWithSelector(HoldbackBonds.InsufficientFreeBond.selector, 0, PRICE));
        rules.agreeAndFund(honest, sellerSig, acc, ag, f);
    }

    function test_attack_shamDeal_triggerFallbackLocksTheNamedFallbacksBond() public {
        (H.Terms memory t,) = _sham();
        vm.warp(t.timing.judgeBy);
        vm.prank(makeAddr("anyone"));
        rules.triggerFallback(t);
        _assertLocked(fallbackAdj, FB_PK);
        vm.warp(t.timing.fallbackBy - 1);
        assertEq(bonds.freeOf(fallbackAdj, address(usdc)), 0, "still locked a century later");
    }

    function test_attack_shamEscalation_locksTheNamedAppealAdjudicatorsBond() public {
        (H.Terms memory t, bytes32 id) = _sham();
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        _assertLocked(appealAdj, AP_PK);
        vm.expectRevert(HoldbackRules.TooEarly.selector);
        rules.triggerDefault(t);
    }

    /// The victim is not stuck if it is watching: as fallback it can sign an escalation, which releases its bond (and
    /// moves the lock to the named appeal adjudicator). Bounded, but it costs the victim attention for a deal it never
    /// accepted, and the attacker can release everything at will with a mutual settlement.
    function test_defense_fallbackEscapesByEscalating_lockMovesToTheAppealAdjudicator() public {
        (H.Terms memory t, bytes32 id) = _sham();
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        H.Decision memory m = _beaconDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ESCALATE, t.timing.judgeBy);
        rules.decide(t, _signDecision(t, id, m, fallbackAdj, FB_PK), _noDelivery(), "");
        assertEq(bonds.freeOf(fallbackAdj, address(usdc)), BOND);
        assertEq(bonds.freeOf(appealAdj, address(usdc)), 0);
    }
}
