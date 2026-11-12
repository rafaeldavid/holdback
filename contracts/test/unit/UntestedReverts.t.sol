// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-335: the custom errors in contracts/src that no test named before that task. `AppealBondTooLarge` and
/// `AppealBondExists` left with HoldbackBonds (T-346, ADR-0031 §8); `Unrepresentable` (HoldbackRules) remains. D31:
/// the contract refuses what its encoding cannot represent (and, since SC-5, what settlement cannot process), so
/// each bound is tested on both sides where the other side can fund.
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

    /// fundBy must fit CPP's uint48 preApprovalExpiry. Since SC-5 strict order puts the escrow's expiry after fundBy,
    /// so a fundBy above uint48 also makes the expiry unrepresentable: this test pins the refusal, and no longer tells
    /// the fundBy clause of the check (`HoldbackRules._paymentInfo`) apart from the expiry clause (reviewer, SC-5).
    function test_refuses_fundByAboveUint48_unrepresentable() public {
        H.Terms memory t = _terms();
        t.timing.fundBy = uint64(type(uint48).max) + 1;
        // SC-5 (T-356): the later deadlines follow, so the terms are in strict order and only representability fails.
        t.timing.deliverBy = t.timing.fundBy + 1;
        t.timing.judgeBy = t.timing.fundBy + 2;
        t.timing.fallbackBy = t.timing.fundBy + 3;
        _fundExpectingRevert(t, HoldbackRules.Unrepresentable.selector);
    }
}
