// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {IHoldbackRules} from "../../src/IHoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

contract EarlyAcceptTest is Base {
    event KeyReleased(bytes32 indexed id, address indexed recipient, uint8 path, string scheme, string ciphertext);

    function test_pricetoSeller_feeBack_keyReleased_deliveryCarried() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _delivery();
        uint256 b0 = usdc.balanceOf(buyer);
        uint256 s0 = usdc.balanceOf(seller);
        H.EarlyAccept memory m = _early(t, id, BUYER_PK);
        bytes memory dsig = _deliverySig(id, d, SELLER_PK);
        vm.expectEmit(true, true, false, true, address(rules));
        emit KeyReleased(id, buyer, 1, KEY_SCHEME, "buyer-envelope");
        vm.prank(relayer);
        rules.earlyAccept(t, m, d, dsig, k);
        assertEq(usdc.balanceOf(seller), s0 + PRICE);
        assertEq(usdc.balanceOf(buyer), b0 + FEE, "no adjudicator judged: the fee returns");
        assertEq(_held(t), 0);
    }

    function test_afterOnChainDelivery() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _deliver(t, id);
        rules.earlyAccept(t, _early(t, id, BUYER_PK), d, _deliverySig(id, d, SELLER_PK), k);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Released));
    }

    function test_refuses_notTheBuyer() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _delivery();
        H.EarlyAccept memory m = _early(t, id, OTHER_PK);
        bytes memory dsig = _deliverySig(id, d, SELLER_PK);
        vm.expectRevert(IHoldbackRules.BadSignature.selector);
        rules.earlyAccept(t, m, d, dsig, k);
    }

    function test_refuses_aKeyNotInTheDelivery() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _delivery();
        k.ciphertext = "an envelope the seller never sealed";
        H.EarlyAccept memory m = _early(t, id, BUYER_PK);
        bytes memory dsig = _deliverySig(id, d, SELLER_PK);
        vm.expectRevert(IHoldbackRules.BadKeyProof.selector);
        rules.earlyAccept(t, m, d, dsig, k);
    }

    function test_refuses_secondSettle() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _delivery();
        H.EarlyAccept memory m = _early(t, id, BUYER_PK);
        bytes memory dsig = _deliverySig(id, d, SELLER_PK);
        rules.earlyAccept(t, m, d, dsig, k);
        vm.expectRevert(abi.encodeWithSelector(IHoldbackRules.WrongStage.selector, IHoldbackRules.Stage.Released));
        rules.earlyAccept(t, m, d, dsig, k);
    }
}

contract MutualSettleTest is Base {
    function _mutual(H.Terms memory t, bytes32 id, H.Payout[] memory payouts, bool releaseKey, bytes32 dh)
        internal
        view
        returns (H.Mutual memory m)
    {
        m.hasDelivery = dh != bytes32(0);
        m.deliveryHash = dh;
        m.payouts = payouts;
        m.releaseKey = releaseKey;
        m.nonce = keccak256("mutual");
        m.expiresAt = type(uint64).max;
        bytes32 h = hx.mutual(id, t.token, m);
        m.buyerSignature = _sign(BUYER_PK, h);
        m.sellerSignature = _sign(SELLER_PK, h);
    }

    /// Any split of the price between the parties. Since SC-3 (ADR-0031 §4) the payees are the buyer and the seller
    /// only; `PartiesOnlyPayout.t.sol` shows a third address refused. The buyer is named twice here to show the contract
    /// adds the shares up; the API's parser takes each payee once (`packages/core/src/parse.ts`), so an agent sends one.
    function test_paysAnySplit_feeBackToBuyer_releasesKey() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _deliver(t, id);
        uint256 b0 = usdc.balanceOf(buyer);
        uint256 s0 = usdc.balanceOf(seller);
        H.Payout[] memory p = new H.Payout[](3);
        p[0] = H.Payout(seller, 13_000_000);
        p[1] = H.Payout(buyer, 3_000_000);
        p[2] = H.Payout(buyer, 10_000_000);
        H.Mutual memory m = _mutual(t, id, p, true, hx.delivery(id, d));
        vm.prank(relayer);
        rules.mutualSettle(t, m, d, k);
        assertEq(usdc.balanceOf(seller), s0 + 13_000_000);
        assertEq(usdc.balanceOf(buyer), b0 + 13_000_000 + FEE);
        assertEq(_held(t), 0);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Settled));
    }

    function test_beforeDelivery_noKey() public {
        (H.Terms memory t, bytes32 id) = _funded();
        H.Payout[] memory p = new H.Payout[](1);
        p[0] = H.Payout(buyer, PRICE);
        H.Mutual memory m = _mutual(t, id, p, false, bytes32(0));
        H.KeyProof memory none;
        rules.mutualSettle(t, m, _noDelivery(), none);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Settled));
        assertEq(_held(t), 0);
    }

    function test_refuses_payoutsNotSummingToThePrice() public {
        (H.Terms memory t, bytes32 id) = _funded();
        H.Payout[] memory p = new H.Payout[](1);
        p[0] = H.Payout(seller, PRICE + FEE);
        H.Mutual memory m = _mutual(t, id, p, false, bytes32(0));
        H.KeyProof memory none;
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.mutualSettle(t, m, _noDelivery(), none);
    }

    function test_refuses_oneSignatureOnly() public {
        (H.Terms memory t, bytes32 id) = _funded();
        H.Payout[] memory p = new H.Payout[](1);
        p[0] = H.Payout(seller, PRICE);
        H.Mutual memory m = _mutual(t, id, p, false, bytes32(0));
        m.sellerSignature = m.buyerSignature;
        H.KeyProof memory none;
        vm.expectRevert(IHoldbackRules.BadSignature.selector);
        rules.mutualSettle(t, m, _noDelivery(), none);
    }

    function test_refuses_secondSettle() public {
        (H.Terms memory t, bytes32 id) = _funded();
        H.Payout[] memory p = new H.Payout[](1);
        p[0] = H.Payout(seller, PRICE);
        H.Mutual memory m = _mutual(t, id, p, false, bytes32(0));
        H.KeyProof memory none;
        rules.mutualSettle(t, m, _noDelivery(), none);
        vm.expectRevert(abi.encodeWithSelector(IHoldbackRules.WrongStage.selector, IHoldbackRules.Stage.Settled));
        rules.mutualSettle(t, m, _noDelivery(), none);
    }
}
