// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackBonds} from "../../src/HoldbackBonds.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-335: the three custom errors in contracts/src that no test named before this task: `Unrepresentable`
/// (HoldbackRules), `AppealBondTooLarge` and `AppealBondExists` (HoldbackBonds). D31: the contract refuses only what
/// its encoding cannot represent, so each bound is tested on both sides where the other side can fund.
contract UntestedRevertsTest is Base {
    function _fundExpectingRevert(H.Terms memory t, bytes4 selector) internal {
        bytes memory s = _sellerSig(t, SELLER_PK);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        vm.expectRevert(selector);
        rules.agreeAndFund(t, s, acc, ag, f);
        assertEq(uint8(_stage(hx.id(t))), uint8(HoldbackRules.Stage.None));
    }

    // ------------------------------------------------------------ Unrepresentable (CPP's PaymentInfo widths)

    /// price + fee must fit CPP's uint120 maxAmount.
    function test_refuses_holdAboveUint120_unrepresentable() public {
        H.Terms memory t = _terms();
        t.price = uint256(type(uint120).max) - t.fee + 1;
        _fundExpectingRevert(t, HoldbackRules.Unrepresentable.selector);
    }

    /// fallbackBy + appealDecideSec + EXPIRY_MARGIN must fit CPP's uint48 authorizationExpiry.
    function test_refuses_expiryAboveUint48_unrepresentable() public {
        H.Terms memory t = _terms();
        t.timing.fallbackBy = uint64(type(uint48).max) - t.timing.appealDecideSec - MARGIN + 1;
        _fundExpectingRevert(t, HoldbackRules.Unrepresentable.selector);
    }

    /// The other side of the expiry bound: an expiry of exactly type(uint48).max funds (D31: far-future deadlines are
    /// the parties' choice).
    function test_accepts_expiryAtUint48Max() public {
        H.Terms memory t = _terms();
        t.timing.fallbackBy = uint64(type(uint48).max) - t.timing.appealDecideSec - MARGIN;
        bytes32 id = _fund(t);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Held));
        assertEq(_held(t), PRICE + FEE);
    }

    /// fundBy must fit CPP's uint48 preApprovalExpiry.
    function test_refuses_fundByAboveUint48_unrepresentable() public {
        H.Terms memory t = _terms();
        t.timing.fundBy = uint64(type(uint48).max) + 1;
        _fundExpectingRevert(t, HoldbackRules.Unrepresentable.selector);
    }

    // ------------------------------------------------------------ appeal bonds

    function _decidedAccept() internal returns (H.Terms memory t, bytes32 id) {
        (t, id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
    }

    /// An appeal bond above uint96 (the vault's AppealBond slot) is refused, and the appeal stays unfiled.
    function test_refuses_appealBondAboveUint96() public {
        (H.Terms memory t, bytes32 id) = _decidedAccept();
        H.Appeal memory a = H.Appeal({
            appellant: 0,
            groundsHash: keccak256("g"),
            bond: uint256(type(uint96).max) + 1,
            filedAt: 0,
            signature: ""
        });
        a.signature = _sign(BUYER_PK, hx.appeal(id, buyer, t.token, a));
        vm.expectRevert(HoldbackBonds.AppealBondTooLarge.selector);
        rules.fileAppeal(t, a);
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.None));
    }

    /// The vault holds one appeal bond per commitment. Through the rules contract `fileAppeal`'s WrongAppealState
    /// check refuses a second appeal first, so this guard is defence in depth [inferred]; the test calls the vault as
    /// RULES. A zero-amount bond still occupies the slot.
    function test_refuses_secondAppealBondForOneCommitment() public {
        bytes32 id = keccak256("one commitment");
        vm.prank(buyer);
        usdc.approve(address(bonds), type(uint256).max);
        vm.prank(address(rules));
        bonds.takeAppealBond(id, buyer, address(usdc), 0);
        vm.prank(address(rules));
        vm.expectRevert(HoldbackBonds.AppealBondExists.selector);
        bonds.takeAppealBond(id, seller, address(usdc), 1_000);
        (address who, uint96 amount) = bonds.appealBondOf(id);
        assertEq(who, buyer);
        assertEq(amount, 0);
    }
}
