// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

contract AgreeAndFundTest is Base {
    function test_erc3009_holdsPricePlusFee() public {
        H.Terms memory t = _terms();
        uint256 before = usdc.balanceOf(buyer);
        bytes32 id = _fund(t);
        assertEq(id, hx.id(t));
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Held));
        assertEq(usdc.balanceOf(buyer), before - PRICE - FEE);
        assertEq(_held(t), PRICE + FEE);
        assertEq(usdc.balanceOf(address(rules)), 0, "the rules contract never holds funds");
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

    /// Phase one reserves no bond (ADR-0031 §8, point 2): any nonzero bondReserved is refused, here one below the price
    /// (the rule before T-346 refused only that side). PhaseOneNoBonds.t.sol covers 1, the price and uint256 max.
    function test_refuses_bondReservedNonzero_belowPrice() public {
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
