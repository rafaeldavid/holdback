// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "../unit/Base.sol";

/// Red-team cross-check, a class the review's B-table does not list: "the winning party occupies the single appeal
/// slot" (Kleros: appeals are fundable by anyone but each round has one slot per side; UMA: only the disputer posts
/// a bond). `fileAppeal` used to accept an appeal from either party against any first-instance outcome, and took one
/// appeal per commitment, so the party the decision favoured could file first, at no cost (a zero bond needs no
/// allowance, T-206 L-3), and the losing party could never appeal. Since T-206 L-7 only the party the decision went
/// against may appeal; these tests were the attacks and now pin the refusal.
contract AppealSlotTest is Base {
    function _appeal(bytes32 id, H.Terms memory t, uint8 who, uint256 pk, uint256 bond)
        internal
        view
        returns (H.Appeal memory a)
    {
        a = H.Appeal({
            appellant: who,
            groundsHash: keccak256("grounds"),
            bond: bond,
            filedAt: uint64(block.timestamp),
            signature: ""
        });
        a.signature = _sign(pk, hx.appeal(id, who == 0 ? t.buyer : t.seller, t.token, a));
    }

    function _decided(uint8 outcome) internal returns (H.Terms memory t, bytes32 id) {
        (t, id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, outcome), _noDelivery(), "");
    }

    /// The primary accepts; the seller (who won) cannot take the slot with a zero-bond appeal; the buyer's bonded
    /// appeal opens it.
    function test_defense_winnerCannotTakeTheSlot_loserAppeals() public {
        (H.Terms memory t, bytes32 id) = _decided(H.OUTCOME_ACCEPT);

        vm.prank(makeAddr("anyone"));
        H.Appeal memory sellers = _appeal(id, t, 1, SELLER_PK, 0);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.fileAppeal(t, sellers);

        vm.prank(buyer);
        usdc.approve(address(bonds), type(uint256).max);
        rules.fileAppeal(t, _appeal(id, t, 0, BUYER_PK, 1_300_000));
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Open));
        (address appellant, uint96 held) = bonds.appealBondOf(id);
        assertEq(appellant, buyer);
        assertEq(held, 1_300_000);
    }

    /// The mirror image after a reject: the refunded buyer cannot block the seller's appeal.
    function test_defense_afterReject_refundedBuyerCannotBlockTheSeller() public {
        (H.Terms memory t, bytes32 id) = _decided(H.OUTCOME_REJECT);
        H.Appeal memory buyers = _appeal(id, t, 0, BUYER_PK, 0);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.fileAppeal(t, buyers);

        vm.prank(seller);
        usdc.approve(address(bonds), type(uint256).max);
        rules.fileAppeal(t, _appeal(id, t, 1, SELLER_PK, 1_300_000));
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Open));
    }

    /// What is left of the angle (T-206 L-3, recorded): the losing party's zero-bond appeal still extends the first
    /// decider's bond lock by appealDecideSec. A minimum appeal bond is Phase 4; the winner can no longer do this.
    function test_residual_loserZeroBondAppealExtendsTheDecidersLock() public {
        (H.Terms memory t, bytes32 id) = _decided(H.OUTCOME_ACCEPT);
        uint64 decidedAt = uint64(block.timestamp);
        rules.fileAppeal(t, _appeal(id, t, 0, BUYER_PK, 0));
        vm.warp(decidedAt + t.timing.appealWindowSec);
        vm.expectRevert(HoldbackRules.TooEarly.selector);
        rules.expireAppeal(t);
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), PRICE, "still locked past the appeal window");
        vm.warp(decidedAt + t.timing.appealWindowSec + t.timing.appealDecideSec);
        rules.expireAppeal(t);
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
    }
}
