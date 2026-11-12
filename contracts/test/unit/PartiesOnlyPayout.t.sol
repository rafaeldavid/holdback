// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {IHoldbackRules} from "../../src/IHoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// @title SC-3: a mutual settlement pays the buyer and the seller only (T-356, ADR-0031 §4)
/// @notice The all-fee capture that paid a third address through the escrow's fee slot left, with its counter and the
///         `Paid` event. A payout to any address but the buyer or the seller reverts `InvalidMessage`; the deal stays
///         open and nothing moves. Any split between the two parties still settles, the fee back to the buyer. D23's
///         payouts to other addresses are deferred past phase one, not dropped (roadmap row N81).
contract PartiesOnlyPayoutTest is Base {
    address internal constant THIRD = address(0x9999);

    function _mutual(H.Terms memory t, bytes32 id, H.Payout[] memory p) internal view returns (H.Mutual memory m) {
        m.payouts = p;
        m.nonce = keccak256("mutual");
        m.expiresAt = type(uint64).max;
        bytes32 h = hx.mutual(id, t.token, m);
        m.buyerSignature = _sign(BUYER_PK, h);
        m.sellerSignature = _sign(SELLER_PK, h);
    }

    /// The refused input: a settlement both parties signed that pays part of the price to a third address (the parent
    /// paid it as an all-fee capture, `test/differential/parent/`). Now it reverts and nothing moves.
    function test_thirdPartyPayout_refused() public {
        (H.Terms memory t, bytes32 id) = _funded();
        H.Payout[] memory p = new H.Payout[](3);
        p[0] = H.Payout(seller, 13_000_000);
        p[1] = H.Payout(THIRD, 3_000_000);
        p[2] = H.Payout(buyer, 10_000_000);
        H.Mutual memory m = _mutual(t, id, p);
        H.Delivery memory none;
        H.KeyProof memory k;
        uint256 s0 = usdc.balanceOf(seller);
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.mutualSettle(t, m, none, k);
        assertEq(uint8(rules.dealOf(id).stage), uint8(IHoldbackRules.Stage.Held), "the deal stays open");
        assertEq(_held(t), PRICE + FEE, "nothing moved");
        assertEq(usdc.balanceOf(THIRD), 0);
        assertEq(usdc.balanceOf(seller), s0);
    }

    /// The whole price to a third address, and the payee order reversed: refused alike.
    function test_wholePriceToThirdParty_refused() public {
        (H.Terms memory t, bytes32 id) = _funded();
        H.Payout[] memory p = new H.Payout[](1);
        p[0] = H.Payout(THIRD, PRICE);
        H.Mutual memory m = _mutual(t, id, p);
        H.Delivery memory none;
        H.KeyProof memory k;
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.mutualSettle(t, m, none, k);
        assertEq(_held(t), PRICE + FEE);
    }

    /// After a delivery, with the key: still refused for the third address, and the key is not released.
    function test_thirdPartyPayout_withKey_refused_noKeyReleased() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _deliver(t, id);
        H.Payout[] memory p = new H.Payout[](2);
        p[0] = H.Payout(THIRD, 1);
        p[1] = H.Payout(seller, PRICE - 1);
        H.Mutual memory m;
        m.payouts = p;
        m.hasDelivery = true;
        m.deliveryHash = hx.delivery(id, d);
        m.releaseKey = true;
        m.nonce = keccak256("mutual");
        m.expiresAt = type(uint64).max;
        bytes32 h = hx.mutual(id, t.token, m);
        m.buyerSignature = _sign(BUYER_PK, h);
        m.sellerSignature = _sign(SELLER_PK, h);
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.mutualSettle(t, m, d, k);
        assertEq(uint8(rules.dealOf(id).stage), uint8(IHoldbackRules.Stage.Delivered));
        assertEq(_held(t), PRICE + FEE);
    }

    /// The parties' own split settles: one capture to the seller, one void to the buyer, no other transfer.
    function test_partiesSplit_settles_twoTransfersOnly() public {
        (H.Terms memory t, bytes32 id) = _funded();
        H.Payout[] memory p = new H.Payout[](2);
        p[0] = H.Payout(seller, 20_000_000);
        p[1] = H.Payout(buyer, PRICE - 20_000_000);
        H.Mutual memory m = _mutual(t, id, p);
        H.Delivery memory none;
        H.KeyProof memory k;
        uint256 b0 = usdc.balanceOf(buyer);
        uint256 s0 = usdc.balanceOf(seller);
        vm.recordLogs();
        rules.mutualSettle(t, m, none, k);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 transfersOut;
        bytes32 store = bytes32(uint256(uint160(escrow.getTokenStore(address(rules)))));
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(usdc) && logs[i].topics[0] == keccak256("Transfer(address,address,uint256)")) {
                if (logs[i].topics[1] == store) transfersOut++;
            }
        }
        assertEq(transfersOut, 2, "one capture to the seller, one void to the buyer");
        assertEq(usdc.balanceOf(seller), s0 + 20_000_000);
        assertEq(usdc.balanceOf(buyer), b0 + PRICE - 20_000_000 + FEE);
        assertEq(_held(t), 0);
        assertEq(uint8(rules.dealOf(id).stage), uint8(IHoldbackRules.Stage.Settled));
    }
}
