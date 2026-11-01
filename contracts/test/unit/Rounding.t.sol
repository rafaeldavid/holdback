// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {HoldbackTypes as H, Money} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// ADR-0022 on chain: each rate multiplication names its direction, and every postings-table row conserves the pot
/// (price + fee): what the parties and adjudicators receive equals what left the hold, with nothing left behind.
contract MoneyTest is Test {
    function testFuzz_split_shareRoundsDown_remainderClosesThePot(uint128 pot, uint16 bps) public pure {
        bps = uint16(bound(bps, 0, 10_000));
        (uint256 share, uint256 rest) = Money.split(pot, bps);
        assertEq(share + rest, pot);
        assertLe(share * 10_000, uint256(pot) * bps);
    }

    function testFuzz_requirement_roundsUp(uint128 amount, uint16 bps) public pure {
        bps = uint16(bound(bps, 0, 10_000));
        uint256 r = Money.requirement(amount, bps);
        assertGe(r * 10_000, uint256(amount) * bps);
        assertLt(r * 10_000, uint256(amount) * bps + 10_000);
    }

    function testFuzz_payout_roundsDown(uint128 amount, uint16 bps) public pure {
        bps = uint16(bound(bps, 0, 10_000));
        assertLe(Money.payout(amount, bps) * 10_000, uint256(amount) * bps);
    }

    function test_split_dustGoesToTheRemainder() public pure {
        (uint256 share, uint256 rest) = Money.split(3, 5_000);
        assertEq(share, 1);
        assertEq(rest, 2);
    }
}

contract PostingsTest is Base {
    address internal constant THIRD = address(0x7777);

    function _balances() internal view returns (uint256[5] memory b) {
        b = [
            usdc.balanceOf(buyer),
            usdc.balanceOf(seller),
            usdc.balanceOf(adjudicator) + usdc.balanceOf(fallbackAdj) + usdc.balanceOf(appealAdj),
            usdc.balanceOf(THIRD),
            0
        ];
    }

    function _assertConserved(H.Terms memory t, uint256[5] memory b0) internal view {
        uint256[5] memory b1 = _balances();
        uint256 paid = (b1[0] - b0[0]) + (b1[1] - b0[1]) + (b1[2] - b0[2]) + (b1[3] - b0[3]);
        assertEq(paid, PRICE + FEE, "payouts equal the pot");
        assertEq(_held(t), 0, "nothing left in the hold");
    }

    function test_release() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        uint256[5] memory b0 = _balances();
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        _assertConserved(t, b0);
    }

    function test_refund() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        uint256[5] memory b0 = _balances();
        rules.decide(t, _primary(t, id, H.OUTCOME_REJECT), _noDelivery(), "");
        _assertConserved(t, b0);
    }

    function test_earlyAcceptance() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _delivery();
        H.EarlyAccept memory m = H.EarlyAccept({attempt: 1, nonce: 0, expiresAt: type(uint64).max, signature: ""});
        m.signature = _sign(BUYER_PK, hx.early(id, buyer, m));
        uint256[5] memory b0 = _balances();
        rules.earlyAccept(t, m, d, _deliverySig(id, d, SELLER_PK), k);
        _assertConserved(t, b0);
    }

    function test_reclaim() public {
        (H.Terms memory t,) = _funded();
        vm.warp(t.timing.deliverBy);
        uint256[5] memory b0 = _balances();
        rules.reclaim(t);
        _assertConserved(t, b0);
    }

    function test_defaultOutcome() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        vm.warp(t.timing.fallbackBy);
        uint256[5] memory b0 = _balances();
        rules.triggerDefault(t);
        _assertConserved(t, b0);
    }

    function test_mutualSettlement() public {
        (H.Terms memory t, bytes32 id) = _funded();
        H.Mutual memory m;
        m.payouts = new H.Payout[](3);
        m.payouts[0] = H.Payout(seller, 7_000_001);
        m.payouts[1] = H.Payout(THIRD, 9_999_999);
        m.payouts[2] = H.Payout(buyer, PRICE - 17_000_000);
        m.expiresAt = type(uint64).max;
        bytes32 h = hx.mutual(id, t.token, m);
        m.buyerSignature = _sign(BUYER_PK, h);
        m.sellerSignature = _sign(SELLER_PK, h);
        H.KeyProof memory none;
        uint256[5] memory b0 = _balances();
        rules.mutualSettle(t, m, _noDelivery(), none);
        _assertConserved(t, b0);
    }
}
