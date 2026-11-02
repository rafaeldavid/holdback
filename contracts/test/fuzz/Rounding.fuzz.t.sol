// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Money} from "../../src/HoldbackTypes.sol";

/// @title RoundingFuzzTest
/// @notice T-203, ADR-0022 on chain, exact: for random amounts and rates,
///         - a split's share plus its remainder is the pot, and the share is the floor;
///         - a requirement is the ceiling (never short by a unit, never over by a unit);
///         - a bond payout is the floor (the bond keeps the dust).
///         Amounts go up to 2^200 and rates up to 2^40 bps (D31: any representable rate), so the reference
///         arithmetic below cannot overflow. Above that, solady's mulDiv reverts when amount × bps overflows
///         (it never wraps); held amounts are capped at uint120 by the rules contract, far below that.
contract RoundingFuzzTest is Test {
    uint256 internal constant BPS = 10_000;

    function testFuzz_split_shareIsTheFloor_remainderClosesThePot(uint256 pot, uint256 bps) public pure {
        pot = bound(pot, 0, 2 ** 200);
        bps = bound(bps, 0, BPS); // a split of one pot cannot exceed 100%
        (uint256 share, uint256 rest) = Money.split(pot, bps);
        assertEq(share + rest, pot, "share + remainder != pot");
        assertEq(share, (pot * bps) / BPS, "share is not the floor");
        assertLe(share, pot);
    }

    function testFuzz_split_overHundredPercent_refused(uint256 pot, uint256 bps) public {
        pot = bound(pot, 1, 2 ** 200);
        bps = bound(bps, BPS + 1, 2 ** 40);
        vm.assume((pot * bps) / BPS > pot);
        vm.expectRevert(); // the remainder would be negative: unrepresentable, so refused
        this.split(pot, bps);
    }

    function split(uint256 pot, uint256 bps) external pure returns (uint256, uint256) {
        return Money.split(pot, bps);
    }

    function testFuzz_requirement_isTheCeiling(uint256 amount, uint256 bps) public pure {
        amount = bound(amount, 0, 2 ** 200);
        bps = bound(bps, 0, 2 ** 40);
        uint256 r = Money.requirement(amount, bps);
        uint256 exact = amount * bps;
        assertGe(r * BPS, exact, "requirement rounded down");
        if (r > 0) assertLt((r - 1) * BPS, exact, "requirement over by a unit");
        assertEq(r, (exact + BPS - 1) / BPS);
    }

    function testFuzz_payout_isTheFloor(uint256 amount, uint256 bps) public pure {
        amount = bound(amount, 0, 2 ** 200);
        bps = bound(bps, 0, 2 ** 40);
        uint256 p = Money.payout(amount, bps);
        uint256 exact = amount * bps;
        assertLe(p * BPS, exact, "payout rounded up");
        assertGt((p + 1) * BPS, exact, "payout short by a unit");
    }

    /// The two directions differ by exactly one unit whenever the product is not a whole number of units.
    function testFuzz_requirementAndPayout_bracketTheExactValue(uint256 amount, uint256 bps) public pure {
        amount = bound(amount, 0, 2 ** 200);
        bps = bound(bps, 0, 2 ** 40);
        uint256 up = Money.requirement(amount, bps);
        uint256 down = Money.payout(amount, bps);
        assertEq(up - down, (amount * bps) % BPS == 0 ? 0 : 1);
    }

    /// At the top of uint256: when amount × bps overflows every function reverts (never a wrapped, wrong value);
    /// otherwise the rounding directions still hold.
    function testFuzz_topOfRange_revertsOrRoundsRight(uint256 amount, uint256 bps) public {
        amount = bound(amount, 2 ** 200, type(uint256).max);
        bps = bound(bps, 1, BPS);
        if (amount > type(uint256).max / bps) {
            vm.expectRevert();
            this.requirement(amount, bps);
            vm.expectRevert();
            this.payout(amount, bps);
            vm.expectRevert();
            this.split(amount, bps);
        } else {
            (uint256 share, uint256 rest) = Money.split(amount, bps);
            assertEq(share + rest, amount);
            assertEq(Money.payout(amount, bps), share);
            uint256 up = Money.requirement(amount, bps);
            assertEq(up - share, (amount * bps) % BPS == 0 ? 0 : 1);
        }
    }

    /// Every amount a hold can carry (uint120, the CPP maxAmount type) at any rate up to 100% stays in range.
    function testFuzz_holdRange_neverReverts(uint120 amount, uint256 bps) public pure {
        bps = bound(bps, 0, BPS);
        assertGe(Money.requirement(amount, bps), Money.payout(amount, bps));
        (uint256 share, uint256 rest) = Money.split(amount, bps);
        assertEq(share + rest, amount);
    }

    function requirement(uint256 amount, uint256 bps) external pure returns (uint256) {
        return Money.requirement(amount, bps);
    }

    function payout(uint256 amount, uint256 bps) external pure returns (uint256) {
        return Money.payout(amount, bps);
    }
}
