// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {DrandQuicknetBeacon} from "../../src/DrandQuicknetBeacon.sol";

/// Public-audit cross-check, BLS classes (NCC blst ETHF002-007/-013/-019, Kudelski gnark-crypto KS-SBCF-O-01, the
/// EIP-2537 test suite): points outside G1, non-canonical encodings, and the "two encodings, two seeds" question. The
/// beacon's value is sha256(signature bytes), so a second accepted encoding of a round would hand the decider a second
/// panel seed. Exactly one 48-byte string must verify per round.
contract DrandEncodingsTest is Test {
    bytes internal constant SIG_1000 =
        hex"b44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39";
    // SIG_1000 + (0, 2), where (0, 2) has order 3: on the curve, outside G1 (computed with noble-curves 1.9.1).
    bytes internal constant SIG_1000_PLUS_TORSION =
        hex"abbaa2cd356c8b543308abe2c07d92facb092294f841b0c295786b635167aba148d4e2e86fedf3cf2c04c43b68a5aaee";

    DrandQuicknetBeacon internal beacon;

    function setUp() public {
        beacon = new DrandQuicknetBeacon();
    }

    function _refused(bytes memory s) internal {
        vm.expectRevert(DrandQuicknetBeacon.InvalidSignature.selector);
        beacon.beaconValue(1000, s);
    }

    function test_defense_validSignaturePlusAnOrder3Point_refused() public {
        assertEq(SIG_1000_PLUS_TORSION.length, 48);
        _refused(SIG_1000_PLUS_TORSION);
    }

    function test_defense_order3Points_refused() public {
        bytes memory zero = new bytes(48);
        zero[0] = 0x80; // (0, 2)
        _refused(zero);
        zero[0] = 0xa0; // (0, -2)
        _refused(zero);
    }

    function test_defense_xAboveP_refused() public {
        _refused(hex"9a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaac"); // p + 1
        bytes memory max = new bytes(48);
        for (uint256 i; i < 48; ++i) {
            max[i] = 0xff;
        }
        max[0] = 0x9f; // 2^381 - 1
        _refused(max);
    }

    /// The top three bits of byte 0 are the flags; of the eight values on SIG_1000's x, only the published one verifies.
    function test_defense_onlyThePublishedFlagsVerify() public {
        bytes memory s = SIG_1000;
        uint8 published = uint8(s[0]) >> 5;
        for (uint8 f; f < 8; ++f) {
            s[0] = bytes1(uint8(uint8(s[0]) & 0x1f) | (f << 5));
            if (f == published) assertEq(beacon.beaconValue(1000, s), sha256(SIG_1000));
            else _refused(s);
        }
    }
}
