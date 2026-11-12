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

    /// A rules contract whose EXPIRY_MARGIN puts terms `t`'s escrow expiry at type(uint48).max plus `over`. Since T-380
    /// the terms cannot reach 48 bits (fallbackBy is bounded at the year 9999 and the escalation window at 32 bits), so
    /// only a deployment's margin can.
    function _withExpiryAt(H.Terms memory t, uint256 over) internal {
        uint256 margin = uint256(type(uint48).max) - t.timing.fallbackBy - t.timing.appealDecideSec + over;
        rules = new HoldbackRules(escrow, address(collector3009), uint64(margin), sim, address(usdc), 0);
    }

    /// fallbackBy + appealDecideSec + EXPIRY_MARGIN must fit CPP's uint48 authorizationExpiry.
    function test_refuses_expiryAboveUint48_unrepresentable() public {
        H.Terms memory t = _terms();
        _withExpiryAt(t, 1);
        _fundExpectingRevert(t, HoldbackRules.Unrepresentable.selector);
    }

    /// The other side of the expiry bound: an expiry of exactly type(uint48).max funds.
    function test_accepts_expiryAtUint48Max() public {
        H.Terms memory t = _terms();
        _withExpiryAt(t, 0);
        bytes32 id = _fund(t);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Held));
        assertEq(_held(t), PRICE + FEE);
    }

    /// fundBy must fit CPP's uint48 preApprovalExpiry. Since T-380 the year-9999 bound on fallbackBy refuses it first,
    /// and the separate fundBy clause in `_paymentInfo` is gone: fundBy is below fallbackBy, so it always fits.
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
