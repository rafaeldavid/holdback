// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-335: the T-206 adversarial pass's OverturnKeyRelease tests (2026-11-03, against baac930), ported to HEAD.
/// At baac930 an overturned rejection released the buyer's content key while the buyer kept the refund and the seller
/// got nothing (finding H-2, ADR-0012), and the buyer could appeal its own refund (L-7). Since then:
/// - H-2 is fixed in PR #125: a decision carries the key only with an accept, never on a deal that stands Refunded.
/// - The overturn payout (D43) and L-7 are fixed in PR #160: an overturn pays the wronged party the price from the
///   first decider's bond, and only the party the decision went against may appeal (here the seller).
/// - L-3 (a zero-bond appeal is accepted) is still open, so two tests stay attack-shaped.
contract OverturnKeyReleaseTest is Base {
    bytes32 internal constant KEY_RELEASED = keccak256("KeyReleased(bytes32,address,uint8,string,string)");

    function _rejected() internal returns (H.Terms memory t, bytes32 id) {
        (t, id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_REJECT), _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
    }

    function _appeal(H.Terms memory t, bytes32 id, uint8 appellant, uint256 bond, bool approve)
        internal
        returns (H.Appeal memory a)
    {
        (address who, uint256 pk) = appellant == 0 ? (buyer, BUYER_PK) : (seller, SELLER_PK);
        if (approve) {
            vm.prank(who);
            usdc.approve(address(bonds), type(uint256).max);
        }
        a = H.Appeal({
            appellant: appellant,
            groundsHash: keccak256("wrongly rejected"),
            bond: bond,
            filedAt: uint64(block.timestamp),
            signature: ""
        });
        a.signature = _sign(pk, hx.appeal(id, who, t.token, a));
    }

    function _sellerAppeal(H.Terms memory t, bytes32 id, uint256 bond, bool approve) internal returns (uint64) {
        rules.fileAppeal(t, _appeal(t, id, 1, bond, approve));
        return uint64(block.timestamp);
    }

    function _overturn(H.Terms memory t, bytes32 id, uint64 round, bool withKey)
        internal
        view
        returns (H.Decision memory m)
    {
        m = _beaconDecision(id, H.ROLE_APPEAL, H.OUTCOME_ACCEPT, round); // carries the buyer's key by default
        if (!withKey) (m.keyScheme, m.keyCiphertext) = ("", "");
        m = _signDecision(t, id, m, appealAdj, AP_PK);
    }

    function _countKeyReleased() internal returns (uint256 n) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(rules) && logs[i].topics[0] == KEY_RELEASED) n++;
        }
    }

    /// H-2, fixed in PR #125; payout and L-7 fixed in PR #160. Was
    /// test_attack_overturned_reject_releases_key_without_paying_seller. Now the buyer cannot appeal its own refund,
    /// the key-carrying overturn is refused, and the overturn without the key pays the seller the price from the
    /// primary's bond.
    function test_regression_overturned_reject_releases_key_without_paying_seller() public {
        (H.Terms memory t, bytes32 id) = _rejected();
        uint256 s0 = usdc.balanceOf(seller);
        uint256 b0 = usdc.balanceOf(buyer); // the refund is already in
        assertEq(_held(t), 0, "the escrow settled at the first decision");

        H.Appeal memory byBuyer = _appeal(t, id, 0, 1_300_000, true);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector); // L-7: the favoured party cannot appeal
        rules.fileAppeal(t, byBuyer);

        uint64 opened = _sellerAppeal(t, id, 1_300_000, true);
        vm.warp(opened + 1);
        H.Decision memory withKey = _overturn(t, id, opened + 1, true);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector); // H-2: no key on a deal that stands Refunded
        rules.decide(t, withKey, _noDelivery(), "");
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Open), "the appeal stays open");

        vm.recordLogs();
        rules.decide(t, _overturn(t, id, opened + 1, false), _noDelivery(), "");
        assertEq(_countKeyReleased(), 0, "no key released");
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Overturned));
        assertEq(usdc.balanceOf(seller), s0 + PRICE, "the seller is paid the price; its appeal bond came back");
        assertEq(usdc.balanceOf(buyer), b0, "the buyer keeps the refund");
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
        assertEq(bonds.bondOf(adjudicator, address(usdc)), BOND - PRICE, "paid from the wrongful decider's bond");
        assertEq(usdc.balanceOf(adjudicator), FEE, "the wrongful decider keeps the fee");
    }

    // Open: L-3. This test flips when the contract lane (T-212 / pilot C3-C5) fixes it.
    /// The appeal bond is any amount the appellant names, including 0, and a zero transfer needs no allowance. The
    /// appellant is the seller now (L-7, PR #160); the rest is unchanged since baac930.
    function test_attack_zero_bond_appeal_accepted_without_allowance() public {
        (H.Terms memory t, bytes32 id) = _rejected();
        uint64 t1 = uint64(block.timestamp);
        _sellerAppeal(t, id, 0, false);
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Open));
        (address who, uint96 amount) = bonds.appealBondOf(id);
        assertEq(who, seller);
        assertEq(amount, 0);
        // The decider's bond that expireAppeal would free at appealBy stays encumbered for appealDecideSec more, and
        // the appeal adjudicator must now work for no fee and no bond.
        vm.warp(t1 + t.timing.appealWindowSec);
        vm.expectRevert(HoldbackRules.TooEarly.selector);
        rules.expireAppeal(t);
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), PRICE);
    }

    // Open: L-3. This test flips when the contract lane (T-212 / pilot C3-C5) fixes it.
    /// Was test_attack_free_appeal_then_key_for_nothing. Its key half is fixed (H-2, PR #125): the key-carrying
    /// overturn is refused. Since the overturn payout (PR #160), the same free appeal wins the seller the price from
    /// the primary's bond while the seller risked nothing.
    function test_attack_free_appeal_wins_the_price_from_the_bond() public {
        (H.Terms memory t, bytes32 id) = _rejected();
        uint256 s0 = usdc.balanceOf(seller);
        uint256 b0 = usdc.balanceOf(buyer);
        uint64 opened = _sellerAppeal(t, id, 0, false);
        vm.warp(opened + 1);
        H.Decision memory withKey = _overturn(t, id, opened + 1, true);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, withKey, _noDelivery(), "");

        vm.recordLogs();
        rules.decide(t, _overturn(t, id, opened + 1, false), _noDelivery(), "");
        assertEq(_countKeyReleased(), 0, "no key for nothing");
        assertEq(usdc.balanceOf(seller), s0 + PRICE, "a zero-bond appeal won the price");
        assertEq(usdc.balanceOf(buyer), b0);
        assertEq(bonds.bondOf(adjudicator, address(usdc)), BOND - PRICE);
        assertEq(bonds.encumberedOf(appealAdj, address(usdc)), 0, "the appeal adjudicator never had bond at stake");
    }
}
