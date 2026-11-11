// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// @title agreeAndFund refuses an expired acceptance and an expired agreement (T-352)
/// @notice `agreeAndFund` refuses the adjudicator's acceptance and the buyer's agree from their `expiresAt` on
///         (`HoldbackRules.sol:204`). Before this file no test reached that revert: the first mutation run on main
///         (T-352, 2026-11-11) found that dropping either half of the check left every test passing (mutants M005 and
///         M006), and `forge coverage` showed the revert branch never ran. Each check is pinned on both sides of its
///         boundary: refused at `expiresAt`, funded one second before it.
contract AgreeAndFundExpiryTest is Base {
    /// The acceptance at its expiresAt: refused, and nothing is held or encumbered.
    function test_refusesAnAcceptanceAtItsExpiry() public {
        H.Terms memory t = _terms();
        H.Acceptance memory acc = _acceptanceUntil(t, uint64(block.timestamp));
        bytes memory sellerSig = _sellerSig(t, SELLER_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        vm.expectRevert(HoldbackRules.MessageExpired.selector);
        rules.agreeAndFund(t, sellerSig, acc, ag, f);
        assertEq(uint8(_stage(hx.id(t))), uint8(HoldbackRules.Stage.None));
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
    }

    /// The acceptance one second before its expiresAt: funded.
    function test_fundsWithAnAcceptanceOneSecondBeforeItsExpiry() public {
        H.Terms memory t = _terms();
        H.Acceptance memory acc = _acceptanceUntil(t, uint64(block.timestamp) + 1);
        bytes memory sellerSig = _sellerSig(t, SELLER_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        bytes32 id = rules.agreeAndFund(t, sellerSig, acc, ag, f);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Held));
        assertEq(_held(t), PRICE + FEE);
    }

    /// The buyer's agree at its expiresAt: refused, and the buyer keeps the money.
    function test_refusesAnAgreementAtItsExpiry() public {
        H.Terms memory t = _terms();
        H.Agree memory ag = _agreeUntil(t, uint64(block.timestamp));
        bytes memory sellerSig = _sellerSig(t, SELLER_PK);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        uint256 b0 = usdc.balanceOf(buyer);
        vm.expectRevert(HoldbackRules.MessageExpired.selector);
        rules.agreeAndFund(t, sellerSig, acc, ag, f);
        assertEq(uint8(_stage(hx.id(t))), uint8(HoldbackRules.Stage.None));
        assertEq(usdc.balanceOf(buyer), b0);
    }

    /// The buyer's agree one second before its expiresAt: funded.
    function test_fundsWithAnAgreementOneSecondBeforeItsExpiry() public {
        H.Terms memory t = _terms();
        H.Agree memory ag = _agreeUntil(t, uint64(block.timestamp) + 1);
        bytes memory sellerSig = _sellerSig(t, SELLER_PK);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        bytes32 id = rules.agreeAndFund(t, sellerSig, acc, ag, f);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Held));
        assertEq(_held(t), PRICE + FEE);
    }

    function _acceptanceUntil(H.Terms memory t, uint64 expiresAt) internal view returns (H.Acceptance memory acc) {
        acc = _acceptance(t, ADJ_PK);
        acc.expiresAt = expiresAt;
        acc.signature = _sign(ADJ_PK, hx.acceptance(hx.id(t), t, acc));
    }

    function _agreeUntil(H.Terms memory t, uint64 expiresAt) internal view returns (H.Agree memory ag) {
        ag = _agree(t, BUYER_PK);
        ag.expiresAt = expiresAt;
        ag.signature = _sign(BUYER_PK, hx.agree(hx.id(t), t.buyer, ag));
    }
}
