// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H, Money} from "../../src/HoldbackTypes.sol";
import {Base} from "../unit/Base.sol";

/// @title PostingsFuzzTest
/// @notice T-203: each postings-table row that moves held money, for random price and fee (and random mutual
///         splits), pays every party exactly its share and leaves nothing in the hold (docs/architecture.md,
///         ADR-0022). The primary's guaranteed-mode bond requirement is the ceiling of 100% of the price, and it is
///         released in full when the commitment closes.
contract PostingsFuzzTest is Base {
    address internal constant THIRD = address(0x7777);

    struct Snap {
        uint256 buyer;
        uint256 seller;
        uint256 adj;
        uint256 third;
    }

    function _snap() internal view returns (Snap memory s) {
        s = Snap(usdc.balanceOf(buyer), usdc.balanceOf(seller), usdc.balanceOf(adjudicator), usdc.balanceOf(THIRD));
    }

    function _fundedWith(uint256 price, uint256 fee) internal returns (H.Terms memory t, bytes32 id) {
        t = _terms();
        t.price = bound(price, 1, 400_000_000);
        t.fee = bound(fee, 0, 100_000_000);
        id = _fund(t);
        assertEq(_held(t), t.price + t.fee, "hold != price + fee");
        assertEq(
            bonds.encumberedOf(adjudicator, address(usdc)),
            Money.requirement(t.price, Money.ALL_BPS),
            "guaranteed requirement is not ceil(100% of price)"
        );
    }

    function _closed(H.Terms memory t) internal view {
        assertEq(_held(t), 0, "hold not empty");
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0, "bond still encumbered");
    }

    function testFuzz_release(uint256 price, uint256 fee) public {
        (H.Terms memory t, bytes32 id) = _fundedWith(price, fee);
        _deliver(t, id);
        Snap memory s0 = _snap();
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        Snap memory s1 = _snap();
        assertEq(s1.seller - s0.seller, t.price);
        assertEq(s1.adj - s0.adj, t.fee);
        assertEq(s1.buyer, s0.buyer);
        // The decider's bond stays encumbered until the appeal window closes.
        assertEq(_held(t), 0);
    }

    function testFuzz_refund(uint256 price, uint256 fee) public {
        (H.Terms memory t, bytes32 id) = _fundedWith(price, fee);
        _deliver(t, id);
        Snap memory s0 = _snap();
        rules.decide(t, _primary(t, id, H.OUTCOME_REJECT), _noDelivery(), "");
        Snap memory s1 = _snap();
        assertEq(s1.buyer - s0.buyer, t.price);
        assertEq(s1.adj - s0.adj, t.fee);
        assertEq(s1.seller, s0.seller);
        assertEq(_held(t), 0);
    }

    function testFuzz_earlyAcceptance(uint256 price, uint256 fee) public {
        (H.Terms memory t, bytes32 id) = _fundedWith(price, fee);
        (H.Delivery memory d, H.KeyProof memory k) = _delivery();
        H.EarlyAccept memory m = H.EarlyAccept({attempt: 1, nonce: 0, expiresAt: type(uint64).max, signature: ""});
        m.signature = _sign(BUYER_PK, hx.early(id, buyer, m));
        Snap memory s0 = _snap();
        rules.earlyAccept(t, m, d, _deliverySig(id, d, SELLER_PK), k);
        Snap memory s1 = _snap();
        assertEq(s1.seller - s0.seller, t.price);
        assertEq(s1.buyer - s0.buyer, t.fee, "no adjudicator judged: the fee goes back to the buyer");
        assertEq(s1.adj, s0.adj);
        _closed(t);
    }

    function testFuzz_reclaim(uint256 price, uint256 fee) public {
        (H.Terms memory t,) = _fundedWith(price, fee);
        vm.warp(t.timing.deliverBy);
        Snap memory s0 = _snap();
        rules.reclaim(t);
        assertEq(_snap().buyer - s0.buyer, t.price + t.fee);
        _closed(t);
    }

    function testFuzz_defaultOutcome(uint256 price, uint256 fee) public {
        (H.Terms memory t, bytes32 id) = _fundedWith(price, fee);
        _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        vm.warp(t.timing.fallbackBy);
        Snap memory s0 = _snap();
        rules.triggerDefault(t);
        assertEq(_snap().buyer - s0.buyer, t.price + t.fee);
        _closed(t);
        assertEq(bonds.encumberedOf(fallbackAdj, address(usdc)), 0);
    }

    /// A random three-way split of the price; the fee share is 0 bps, so the whole fee is the buyer's remainder.
    function testFuzz_mutualSettlement(uint256 price, uint256 fee, uint256 a, uint256 b) public {
        (H.Terms memory t, bytes32 id) = _fundedWith(price, fee);
        a = bound(a, 0, t.price);
        b = bound(b, 0, t.price - a);
        uint256 c = t.price - a - b;
        H.Mutual memory m;
        m.payouts = new H.Payout[]((a > 0 ? 1 : 0) + (b > 0 ? 1 : 0) + (c > 0 ? 1 : 0));
        uint256 j;
        if (a > 0) m.payouts[j++] = H.Payout(seller, a);
        if (b > 0) m.payouts[j++] = H.Payout(THIRD, b);
        if (c > 0) m.payouts[j++] = H.Payout(buyer, c);
        m.expiresAt = type(uint64).max;
        bytes32 h = hx.mutual(id, t.token, m);
        m.buyerSignature = _sign(BUYER_PK, h);
        m.sellerSignature = _sign(SELLER_PK, h);
        H.KeyProof memory none;
        Snap memory s0 = _snap();
        rules.mutualSettle(t, m, _noDelivery(), none);
        Snap memory s1 = _snap();
        (uint256 share, uint256 rest) = Money.split(t.fee, rules.MUTUAL_FEE_SHARE_BPS());
        assertEq(s1.seller - s0.seller, a);
        assertEq(s1.third - s0.third, b);
        assertEq(s1.buyer - s0.buyer, c + rest);
        assertEq(s1.adj - s0.adj, share);
        _closed(t);
    }

    /// Payouts that do not sum to the price are refused and nothing moves.
    function testFuzz_mutualSettlement_wrongSum_refused(uint256 price, uint256 fee, uint256 x) public {
        (H.Terms memory t, bytes32 id) = _fundedWith(price, fee);
        x = bound(x, 1, type(uint128).max);
        vm.assume(x != t.price);
        H.Mutual memory m;
        m.payouts = new H.Payout[](1);
        m.payouts[0] = H.Payout(seller, x);
        m.expiresAt = type(uint64).max;
        bytes32 h = hx.mutual(id, t.token, m);
        m.buyerSignature = _sign(BUYER_PK, h);
        m.sellerSignature = _sign(SELLER_PK, h);
        H.KeyProof memory none;
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.mutualSettle(t, m, _noDelivery(), none);
        assertEq(_held(t), t.price + t.fee);
    }
}
