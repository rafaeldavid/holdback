// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackBonds} from "../../src/HoldbackBonds.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

contract AgreeAndFundTest is Base {
    function test_erc3009_holdsPricePlusFee_andEncumbersThePrimary() public {
        H.Terms memory t = _terms();
        uint256 before = usdc.balanceOf(buyer);
        bytes32 id = _fund(t);
        assertEq(id, hx.id(t));
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Held));
        assertEq(usdc.balanceOf(buyer), before - PRICE - FEE);
        assertEq(_held(t), PRICE + FEE);
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), PRICE);
        assertEq(usdc.balanceOf(address(rules)), 0, "the rules contract never holds funds");
    }

    function test_permit2_funds() public {
        H.Terms memory t = _terms();
        vm.prank(buyer);
        usdc.approve(permit2, type(uint256).max);
        bytes32 id = rules.agreeAndFund(
            t, _sellerSig(t, SELLER_PK), _acceptance(t, ADJ_PK), _agree(t, BUYER_PK), _permit2(t, BUYER_PK)
        );
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Held));
        assertEq(_held(t), PRICE + FEE);
    }

    function test_refuses_sellerSignatureFromAnotherKey() public {
        H.Terms memory t = _terms();
        H.Acceptance memory a = _acceptance(t, ADJ_PK);
        H.Agree memory g = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        bytes memory s = _sellerSig(t, OTHER_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.agreeAndFund(t, s, a, g, f);
    }

    function test_refuses_acceptanceFromAnotherKey() public {
        H.Terms memory t = _terms();
        H.Acceptance memory a = _acceptance(t, FB_PK);
        H.Agree memory g = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        bytes memory s = _sellerSig(t, SELLER_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.agreeAndFund(t, s, a, g, f);
    }

    function test_refuses_agreeFromAnotherKey() public {
        H.Terms memory t = _terms();
        H.Acceptance memory a = _acceptance(t, ADJ_PK);
        H.Agree memory g = _agree(t, OTHER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        bytes memory s = _sellerSig(t, SELLER_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.agreeAndFund(t, s, a, g, f);
    }

    function test_refuses_missingSignature() public {
        H.Terms memory t = _terms();
        H.Acceptance memory a = _acceptance(t, ADJ_PK);
        H.Agree memory g = _agree(t, BUYER_PK);
        g.signature = "";
        H.Funding memory f = _erc3009(t, BUYER_PK);
        bytes memory s = _sellerSig(t, SELLER_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.agreeAndFund(t, s, a, g, f);
    }

    function test_refuses_termsChangedAfterSigning() public {
        H.Terms memory t = _terms();
        bytes memory s = _sellerSig(t, SELLER_PK);
        H.Acceptance memory a = _acceptance(t, ADJ_PK);
        H.Agree memory g = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        t.price = PRICE - 1; // a relayer edits the view: the commitment ID moves, every signature fails
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.agreeAndFund(t, s, a, g, f);
    }

    function test_refuses_replay() public {
        H.Terms memory t = _terms();
        bytes memory s = _sellerSig(t, SELLER_PK);
        H.Acceptance memory a = _acceptance(t, ADJ_PK);
        H.Agree memory g = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        rules.agreeAndFund(t, s, a, g, f);
        vm.expectRevert(abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.Held));
        rules.agreeAndFund(t, s, a, g, f);
    }

    function test_refuses_afterOfferExpiry() public {
        H.Terms memory t = _terms();
        bytes memory s = _sellerSig(t, SELLER_PK);
        H.Acceptance memory a = _acceptance(t, ADJ_PK);
        H.Agree memory g = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        vm.warp(t.timing.offerExpiresAt);
        vm.expectRevert(HoldbackRules.DeadlinePassed.selector);
        rules.agreeAndFund(t, s, a, g, f);
    }

    function test_refuses_bondReservedBelowPrice() public {
        H.Terms memory t = _terms();
        H.Acceptance memory a = _acceptance(t, ADJ_PK);
        a.bondReserved = PRICE - 1;
        a.signature = _sign(ADJ_PK, hx.acceptance(hx.id(t), t, a));
        H.Agree memory g = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        bytes memory s = _sellerSig(t, SELLER_PK);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.agreeAndFund(t, s, a, g, f);
    }

    function test_refuses_primaryWithoutFreeBond() public {
        H.Terms memory t = _terms();
        t.price = BOND + 1;
        usdc.mint(buyer, BOND * 2);
        bytes memory s = _sellerSig(t, SELLER_PK);
        H.Acceptance memory a = _acceptance(t, ADJ_PK);
        H.Agree memory g = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        vm.expectRevert(abi.encodeWithSelector(HoldbackBonds.InsufficientFreeBond.selector, BOND, BOND + 1));
        rules.agreeAndFund(t, s, a, g, f);
    }

    function test_refuses_fundingSignedByAnotherKey() public {
        H.Terms memory t = _terms();
        bytes memory s = _sellerSig(t, SELLER_PK);
        H.Acceptance memory a = _acceptance(t, ADJ_PK);
        H.Agree memory g = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, OTHER_PK);
        vm.expectRevert(bytes("MockERC3009: invalid signature"));
        rules.agreeAndFund(t, s, a, g, f);
    }
}
