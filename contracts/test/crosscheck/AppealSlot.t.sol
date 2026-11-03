// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "../unit/Base.sol";

/// Red-team cross-check, a class the review's B-table does not list: "the winning party occupies the single appeal
/// slot" (Kleros: appeals are fundable by anyone but each round has one slot per side; UMA: only the disputer posts
/// a bond). `fileAppeal` accepts an appeal from either party against any first-instance outcome, takes one appeal per
/// commitment (`AppealState.Open` refuses a second), and a zero bond needs no allowance (T-206 L-3). So the party the
/// decision favoured can file first, at no cost, and the losing party can never appeal.
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

    function _accepted() internal returns (H.Terms memory t, bytes32 id) {
        (t, id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
    }

    /// The primary accepts; the seller (who won) files a zero-bond appeal; the buyer's bonded appeal is refused; the
    /// appeal expires undecided and the accept stands. The seller risked nothing and the buyer never got its appeal.
    function test_attack_winnerFilesAZeroBondAppeal_loserCannotAppeal() public {
        (H.Terms memory t, bytes32 id) = _accepted();
        uint64 decidedAt = uint64(block.timestamp);

        vm.prank(makeAddr("anyone"));
        rules.fileAppeal(t, _appeal(id, t, 1, SELLER_PK, 0));
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Open));
        (, uint96 held) = bonds.appealBondOf(id);
        assertEq(held, 0, "the seller's appeal cost nothing");

        vm.prank(buyer);
        usdc.approve(address(bonds), type(uint256).max);
        H.Appeal memory buyers = _appeal(id, t, 0, BUYER_PK, 1_300_000);
        vm.expectRevert(abi.encodeWithSelector(HoldbackRules.WrongAppealState.selector, HoldbackRules.AppealState.Open));
        rules.fileAppeal(t, buyers);

        // Nothing reopens the slot: the window closes, the appeal expires, the first decision stands.
        vm.warp(decidedAt + t.timing.appealWindowSec + t.timing.appealDecideSec);
        rules.expireAppeal(t);
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Expired));
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
        vm.expectRevert(
            abi.encodeWithSelector(HoldbackRules.WrongAppealState.selector, HoldbackRules.AppealState.Expired)
        );
        rules.fileAppeal(t, buyers);
    }

    /// The mirror image after a reject: the buyer (refunded) occupies the slot and the seller cannot appeal.
    function test_attack_afterReject_refundedBuyerBlocksTheSellersAppeal() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_REJECT), _noDelivery(), "");
        rules.fileAppeal(t, _appeal(id, t, 0, BUYER_PK, 0));
        vm.prank(seller);
        usdc.approve(address(bonds), type(uint256).max);
        H.Appeal memory sellers = _appeal(id, t, 1, SELLER_PK, 1_300_000);
        vm.expectRevert(abi.encodeWithSelector(HoldbackRules.WrongAppealState.selector, HoldbackRules.AppealState.Open));
        rules.fileAppeal(t, sellers);
    }

    /// The same slot also lets the winner extend the first decider's bond lock by appealDecideSec at no cost
    /// (T-206 L-3's angle), and, with an in-flight PA-M1 fix, a fallback that decided is locked for the full
    /// appealWindowSec + appealDecideSec the terms chose.
    function test_attack_zeroBondAppealExtendsTheDecidersLock() public {
        (H.Terms memory t, bytes32 id) = _accepted();
        uint64 decidedAt = uint64(block.timestamp);
        rules.fileAppeal(t, _appeal(id, t, 1, SELLER_PK, 0));
        vm.warp(decidedAt + t.timing.appealWindowSec);
        vm.expectRevert(HoldbackRules.TooEarly.selector);
        rules.expireAppeal(t);
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), PRICE, "still locked past the appeal window");
        vm.warp(decidedAt + t.timing.appealWindowSec + t.timing.appealDecideSec);
        rules.expireAppeal(t);
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
    }
}
