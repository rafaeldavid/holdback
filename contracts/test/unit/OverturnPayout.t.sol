// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {HoldbackBonds} from "../../src/HoldbackBonds.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-206 I-8: an overturning appeal pays the wronged party the price from the first decider's bond, which has been
/// encumbered for the price since its decision (guaranteed mode, ADR-0007; SimChain's payFromBond; the formal
/// model's DecideAppeal). The appeal bond goes back to the appellant. L-7: only the party the decision went against
/// may appeal. The tests name the vault's event and function by signature, so they also compile against the
/// contracts before the fix and fail there.
contract OverturnPayoutTest is Base {
    uint256 internal constant APPEAL_BOND = 1_000;
    bytes32 internal constant BOND_SLASHED = keccak256("BondSlashed(bytes32,address,address,address,uint256)");

    function _firstDecision(uint8 outcome, bool byFallback) internal returns (H.Terms memory t, bytes32 id) {
        (t, id) = _funded();
        _deliver(t, id);
        if (!byFallback) {
            rules.decide(t, _primary(t, id, outcome), _noDelivery(), "");
            return (t, id);
        }
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        H.Decision memory m = _beaconDecision(id, H.ROLE_FALLBACK, outcome, t.timing.judgeBy);
        rules.decide(t, _signDecision(t, id, m, fallbackAdj, FB_PK), _noDelivery(), "");
    }

    function _appeal(H.Terms memory t, bytes32 id, uint8 appellant, uint256 bond)
        internal
        returns (H.Appeal memory a)
    {
        (address who, uint256 pk) = appellant == 0 ? (buyer, BUYER_PK) : (seller, SELLER_PK);
        vm.prank(who);
        usdc.approve(address(bonds), type(uint256).max);
        a = H.Appeal({appellant: appellant, groundsHash: keccak256("g"), bond: bond, filedAt: 0, signature: ""});
        a.signature = _sign(pk, hx.appeal(id, who, t.token, a));
    }

    function _appealBy(H.Terms memory t, bytes32 id, uint8 appellant) internal returns (uint64 round) {
        rules.fileAppeal(t, _appeal(t, id, appellant, APPEAL_BOND));
        round = uint64(rules.dealOf(id).t2) + 1;
        vm.warp(round);
    }

    /// The appeal adjudicator's decision, recording its logs; it carries the buyer's key only when asked.
    function _appealDecide(H.Terms memory t, bytes32 id, uint64 round, uint8 outcome, bool withKey) internal {
        H.Decision memory m = _beaconDecision(id, H.ROLE_APPEAL, outcome, round);
        if (!withKey) (m.keyScheme, m.keyCiphertext) = ("", "");
        m = _signDecision(t, id, m, appealAdj, AP_PK);
        vm.recordLogs();
        rules.decide(t, m, _noDelivery(), "");
    }

    /// Asserts the vault emitted exactly one BondSlashed since recordLogs, with these fields, or none when `amount`
    /// is 0.
    function _assertSlashed(bytes32 id, address adj, address to, uint256 amount) internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 n;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(bonds) || logs[i].topics[0] != BOND_SLASHED) continue;
            n++;
            assertEq(logs[i].topics[1], id);
            assertEq(address(uint160(uint256(logs[i].topics[2]))), adj, "paid from this adjudicator's bond");
            assertEq(address(uint160(uint256(logs[i].topics[3]))), to, "paid to the wronged party");
            (address token, uint256 paid) = abi.decode(logs[i].data, (address, uint256));
            assertEq(token, address(usdc));
            assertEq(paid, amount);
        }
        assertEq(n, amount == 0 ? 0 : 1, "BondSlashed events");
    }

    // ------------------------------------------------------------ overturns pay from the bond

    function test_overturnedAccept_paysTheBuyerThePriceFromThePrimarysBond() public {
        (H.Terms memory t, bytes32 id) = _firstDecision(H.OUTCOME_ACCEPT, false);
        uint64 round = _appealBy(t, id, 0);
        uint256 b0 = usdc.balanceOf(buyer);
        uint256 s0 = usdc.balanceOf(seller);
        _appealDecide(t, id, round, H.OUTCOME_REJECT, false);

        _assertSlashed(id, adjudicator, buyer, PRICE);
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Overturned));
        assertEq(usdc.balanceOf(buyer) - b0, PRICE + APPEAL_BOND, "the price from the bond and the appeal bond back");
        assertEq(usdc.balanceOf(seller), s0, "the seller keeps the payment it had");
        assertEq(bonds.bondOf(adjudicator, address(usdc)), BOND - PRICE);
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
    }

    function test_overturnedReject_paysTheSellerThePriceFromThePrimarysBond() public {
        (H.Terms memory t, bytes32 id) = _firstDecision(H.OUTCOME_REJECT, false);
        uint64 round = _appealBy(t, id, 1);
        uint256 b0 = usdc.balanceOf(buyer);
        uint256 s0 = usdc.balanceOf(seller);
        _appealDecide(t, id, round, H.OUTCOME_ACCEPT, false);

        _assertSlashed(id, adjudicator, seller, PRICE);
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Overturned));
        assertEq(usdc.balanceOf(seller) - s0, PRICE + APPEAL_BOND, "the price from the bond and the appeal bond back");
        assertEq(usdc.balanceOf(buyer), b0, "the buyer keeps its refund");
        assertEq(bonds.bondOf(adjudicator, address(usdc)), BOND - PRICE);
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
    }

    /// The fallback decided, so its bond pays; the silent primary's was released at the fallback's decision.
    function test_overturnedFallbackDecision_paysFromTheFallbacksBond() public {
        (H.Terms memory t, bytes32 id) = _firstDecision(H.OUTCOME_ACCEPT, true);
        uint64 round = _appealBy(t, id, 0);
        uint256 b0 = usdc.balanceOf(buyer);
        _appealDecide(t, id, round, H.OUTCOME_REJECT, false);

        _assertSlashed(id, fallbackAdj, buyer, PRICE);
        assertEq(usdc.balanceOf(buyer) - b0, PRICE + APPEAL_BOND);
        assertEq(bonds.bondOf(fallbackAdj, address(usdc)), BOND - PRICE);
        assertEq(bonds.encumberedOf(fallbackAdj, address(usdc)), 0);
        assertEq(bonds.bondOf(adjudicator, address(usdc)), BOND, "the primary did not decide");
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
    }

    /// An upheld appeal moves no bond money: the decider's reservation is released and the forfeited appeal bond
    /// joins its bond (ADR-0014 §2a).
    function test_upheldAppeal_paysNothingFromTheBond() public {
        (H.Terms memory t, bytes32 id) = _firstDecision(H.OUTCOME_ACCEPT, false);
        uint64 round = _appealBy(t, id, 0);
        uint256 b0 = usdc.balanceOf(buyer);
        _appealDecide(t, id, round, H.OUTCOME_ACCEPT, true);

        _assertSlashed(id, adjudicator, buyer, 0);
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Upheld));
        assertEq(usdc.balanceOf(buyer), b0);
        assertEq(bonds.bondOf(adjudicator, address(usdc)), BOND + APPEAL_BOND);
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
    }

    /// The paid-out part of the bond is gone: the adjudicator withdraws only what is left.
    function test_afterAnOverturn_theAdjudicatorWithdrawsOnlyTheRest() public {
        (H.Terms memory t, bytes32 id) = _firstDecision(H.OUTCOME_ACCEPT, false);
        _appealDecide(t, id, _appealBy(t, id, 0), H.OUTCOME_REJECT, false);

        vm.startPrank(adjudicator);
        vm.expectRevert(abi.encodeWithSelector(HoldbackBonds.InsufficientFreeBond.selector, BOND - PRICE, BOND));
        bonds.withdraw(address(usdc), BOND);
        bonds.withdraw(address(usdc), BOND - PRICE);
        vm.stopPrank();
        assertEq(bonds.bondOf(adjudicator, address(usdc)), 0);
    }

    /// An undecided appeal still expires with the first decision standing and nothing paid from the bond.
    function test_undecidedAppeal_expiresWithoutAPayout() public {
        (H.Terms memory t, bytes32 id) = _firstDecision(H.OUTCOME_ACCEPT, false);
        _appealBy(t, id, 0);
        vm.warp(uint256(rules.dealOf(id).t1) + t.timing.appealWindowSec + t.timing.appealDecideSec);
        rules.expireAppeal(t);
        assertEq(bonds.bondOf(adjudicator, address(usdc)), BOND);
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
    }

    /// Only the rules contract moves bond money; anyone else's call to the payout reverts.
    function test_slash_onlyTheRulesContract() public {
        _bond(adjudicator, BOND);
        (bool ok,) = address(bonds).call(
            abi.encodeWithSignature(
                "slash(bytes32,address,address,uint256,address)", bytes32(0), adjudicator, address(usdc), 1, address(this)
            )
        );
        assertFalse(ok);
        assertEq(bonds.bondOf(adjudicator, address(usdc)), 2 * BOND);
    }

    // ------------------------------------------------------------ L-7: the appeal slot

    function test_favouredSeller_cannotAppealAnAccept() public {
        (H.Terms memory t, bytes32 id) = _firstDecision(H.OUTCOME_ACCEPT, false);
        H.Appeal memory a = _appeal(t, id, 1, 0);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.fileAppeal(t, a);
    }

    function test_favouredBuyer_cannotAppealAReject() public {
        (H.Terms memory t, bytes32 id) = _firstDecision(H.OUTCOME_REJECT, false);
        H.Appeal memory a = _appeal(t, id, 0, 0);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.fileAppeal(t, a);
    }
}
